import {spawn, type ChildProcess} from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import {categoryFor, restingFolder} from './categories.js'
import {getConfig, loadConfig} from './config.js'
import {addSpeedSource, HISTORY_SECONDS, pushRing} from './history.js'
import {record} from './ledger.js'
import type {ExportItem} from './ledger.js'
import {currentGlobalLimit, onLimitsChanged, parseRate} from './limits.js'
import {logEvent} from './log.js'
import {decodeBitfield, MAP_CELLS, pieceView} from './pieces.js'
import {ensureDir, paths, readJson, writeFileAtomic} from './paths.js'
import {duplicatePlan, nameFromUrl as urlName, safeFileName, type DuplicateChoice} from './probe.js'
import {evaluateQueues, getQueues, MAIN_QUEUE, occupancy, queueIdFor, registerMember} from './queues.js'
import {openPath, revealPath} from './reveal.js'
import {createStore} from './store.js'
import {tools, whenToolsReady} from './tools.js'

/**
 * The download manager: any file over HTTP, HTTPS or FTP, drawn by aria2.
 * (Torrents and magnets are Axive's, not Free's.)
 *
 * aria2 runs as a child of Axive only while it is wanted. Its JSON-RPC listens
 * on 127.0.0.1 alone, on a free port, behind a fresh random secret, and it
 * stops itself when Axive goes (--stop-with-process). Each file is split into
 * up to 16 segments over parallel connections; unfinished work is kept in a
 * session file, so it resumes from where it was after a restart.
 *
 * Axive, not aria2, decides what runs: a fetch waits paused ("held") until
 * the line (queues.ts) has a free slot. aria2's own concurrency is set high
 * and unused. What aria2 does not keep (category, flags) lives in
 * fetch/meta.json, keyed by aria2's id (aria2 keeps ids across restarts).
 */

export type FetchKind = 'file'
export type FetchState = 'active' | 'waiting' | 'paused' | 'done' | 'failed' | 'removed' | 'seeding'

export type FetchItem = {
  gid: string
  kind: FetchKind
  name: string
  state: FetchState
  total: number
  done: number
  speed: number
  upload: number
  connections: number
  seeders?: number
  /** the file */
  target?: string
  dir: string
  error?: string
  /** aria2's error code, when it failed */
  code?: string
  /** the address a file is fetched from */
  uri?: string
  /** the piece map: one digit 0-8 (eighths received) per cell, at most 96 cells (src/core/pieces.ts) */
  map?: string
  /** cells where a connection is writing now */
  edges?: number[]
  /** aria2's piece count and piece length in bytes */
  pieces?: number
  pieceSize?: number
  /** speed averaged over a few seconds (speed stays aria2's raw number) */
  smooth?: number
  /** seconds left, from the smoothed speed */
  eta?: number
  /** a finished file that does not look like what its name says */
  warning?: string
  // -- 1.4
  /** the queue it belongs to */
  queueId?: string
  /** category id (categories.ts) */
  category?: string
  /** its own speed limit ('' or absent: none) */
  limit?: string
  /** waiting for a free slot in its queue (state reads 'waiting') */
  held?: boolean
  /** the connections it is meant to use now (after a step-down or a change) */
  wanted?: number
  openWhenDone?: boolean
  showWhenDone?: boolean
  /** waiting for a fresh link (awaitLink) */
  awaiting?: boolean
  addedAt?: number
}

export type FetchStatus = {running: boolean; starting: boolean; error?: string; items: FetchItem[]}
export const fetchStore = createStore<FetchStatus>({running: false, starting: false, items: []})

// ---------------------------------------------------------------------------
// what counts as a fetch

const MAGNET = /^magnet:\?(?:.*&)?xt=urn:(?:btih|btmh):[a-z0-9]+/i
const TORRENT_FILE = /\.torrent$/i
// direct files the media path (yt-dlp) has no business with
const FILE_EXT =
  /\.(zip|7z|rar|tar|gz|tgz|bz2|xz|zst|cab|iso|img|vhdx?|exe|msi|msix|msixbundle|appx|appxbundle|dmg|pkg|deb|rpm|apk|xapk|appimage|pdf|epub|mobi|azw3|djvu|cbz|cbr|docx?|xlsx?|pptx?|odt|ods|csv|txt|json|xml|sql|bin|jar|war|whl|nupkg|vsix|ttf|otf|woff2?|psd|ai|blend|fbx|obj|stl|safetensors|ckpt|gguf|onnx|pt|pth|torrent|metalink|meta4)$/i

/** a video or audio file itself (not a page, not a playlist): one server, so many connections beat one */
const MEDIA_FILE_EXT = /\.(mp4|m4v|mkv|webm|mov|avi|wmv|flv|mpe?g|3gp|mp3|m4a|aac|flac|wav|ogg|oga|opus|wma|alac|aiff?)$/i

export function isMagnet(text: string): boolean {
  return MAGNET.test(text.trim())
}

/** a magnet or a .torrent link: Free says these are Axive's instead of drawing them */
export function isTorrent(text: string): boolean {
  const value = text.trim()
  if (isMagnet(value)) return true
  try {
    return TORRENT_FILE.test(decodeURIComponent(new URL(value).pathname))
  } catch {
    return false
  }
}

/**
 * 'file' for links the download manager takes; undefined for media links (yt-dlp), magnets and torrents.
 * A direct video or audio file goes to the download manager too (`media`, the fetchMediaFiles
 * setting): yt-dlp would read it over one connection, aria2 over up to 16.
 */
export function fetchKind(text: string, media = getConfig().fetchMediaFiles): FetchKind | undefined {
  const value = text.trim()
  if (isTorrent(value)) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'ftp:') return undefined
  const file = decodeURIComponent(url.pathname.split('/').pop() ?? '')
  return FILE_EXT.test(file) || (media && MEDIA_FILE_EXT.test(file)) ? 'file' : undefined
}

// ---------------------------------------------------------------------------
// what Axive keeps beside aria2

export type FetchMeta = {
  queueId: string
  category?: string
  limit?: string
  /** connections asked for (a host rule, the add, or setConnections) */
  connections?: number
  openWhenDone?: boolean
  showWhenDone?: boolean
  /** paused by a person: the queue leaves it alone */
  userPaused?: boolean
  /** paused by its queue, to start when there is room */
  held?: boolean
  /** started by hand while its queue was closed: it runs regardless */
  force?: boolean
  addedAt: number
}

const metaFile = () => path.join(fetchDir(), 'meta.json')
let meta = new Map<string, FetchMeta>()
let metaLoaded = false
let metaTimer: NodeJS.Timeout | undefined

function loadMeta(): void {
  if (metaLoaded) return
  metaLoaded = true
  const raw = readJson<unknown>(metaFile(), {})
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  for (const [gid, m] of Object.entries(raw as Record<string, Partial<FetchMeta>>)) {
    if (!/^[0-9a-f]{16}$/i.test(gid) || !m || typeof m !== 'object') continue
    meta.set(gid, {
      queueId: typeof m.queueId === 'string' ? m.queueId : MAIN_QUEUE,
      category: typeof m.category === 'string' ? m.category : undefined,
      limit: typeof m.limit === 'string' ? m.limit : undefined,
      connections: typeof m.connections === 'number' ? m.connections : undefined,
      openWhenDone: m.openWhenDone === true || undefined,
      showWhenDone: m.showWhenDone === true || undefined,
      userPaused: m.userPaused === true || undefined,
      held: m.held === true || undefined,
      addedAt: typeof m.addedAt === 'number' ? m.addedAt : Date.now(),
    })
  }
}

function saveMetaSoon(): void {
  if (metaTimer) return
  metaTimer = setTimeout(() => {
    metaTimer = undefined
    try {
      // force is for this session only
      writeFileAtomic(metaFile(), JSON.stringify(Object.fromEntries([...meta].map(([gid, {force: _f, ...m}]) => [gid, m]))))
    } catch {
      // best effort
    }
  }, 400)
  metaTimer.unref?.()
}

function metaOf(gid: string): FetchMeta | undefined {
  loadMeta()
  return meta.get(gid)
}

function setMeta(gid: string, patch: Partial<FetchMeta>): FetchMeta {
  loadMeta()
  const next = {...(meta.get(gid) ?? {queueId: MAIN_QUEUE, addedAt: Date.now()}), ...patch}
  meta.set(gid, next)
  saveMetaSoon()
  return next
}

/** the same fetch under a new aria2 id (it was added again) */
function rekey(from: string, to: string, patch: Partial<FetchMeta> = {}): void {
  const m = metaOf(from)
  if (m) meta.delete(from)
  setMeta(to, {...(m ?? {}), ...patch})
  const opts = carried.get(from)
  if (opts) carried.set(to, opts)
}

// the options a fetch was added with (headers, login, name), so a step-down or
// a new link can add it again the same way. Memory only: aria2's own session
// file keeps them across restarts.
const carried = new Map<string, Record<string, string | string[]>>()
const CARRY = ['dir', 'out', 'header', 'referer', 'user-agent', 'http-user', 'http-passwd', 'ftp-user', 'ftp-passwd', 'max-download-limit', 'allow-overwrite', 'multiple-interface']

async function optionsFor(gid: string): Promise<Record<string, string | string[]>> {
  const mine = carried.get(gid)
  if (mine) return {...mine}
  const theirs = await rpc<Record<string, string | string[]>>('getOption', gid).catch(() => undefined)
  return theirs ? Object.fromEntries(Object.entries(theirs).filter(([k]) => CARRY.includes(k))) : {}
}

// ---------------------------------------------------------------------------
// the engine

type Engine = {child: ChildProcess; port: number; secret: string}
let engine: Engine | undefined
let starting: Promise<Engine> | undefined
let poller: NodeJS.Timeout | undefined
let seq = 0
const recorded = new Set<string>()

/** aria2 may run this many at once; Axive's queues decide what actually runs */
export const ENGINE_SLOTS = 32

const fetchDir = () => ensureDir(path.join(paths.root, 'fetch'))
// a headless caller may not have loaded the settings yet
export const defaultFolder = () => getConfig().folder || loadConfig().folder

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port
      server.close(() => resolve(port))
    })
  })
}

/** aria2's options for this session, from the settings */
export function engineArgs(port: number, secret: string, session: string, folder: string): string[] {
  const config = getConfig()
  const limit = currentGlobalLimit()
  return [
    '--no-conf=true',
    '--enable-rpc=true',
    `--rpc-listen-port=${port}`,
    '--rpc-listen-all=false',
    '--rpc-allow-origin-all=false',
    `--rpc-secret=${secret}`,
    `--stop-with-process=${process.pid}`,
    `--dir=${folder}`,
    `--input-file=${session}`,
    `--save-session=${session}`,
    '--save-session-interval=15',
    '--continue=true',
    `--max-concurrent-downloads=${ENGINE_SLOTS}`,
    `--max-connection-per-server=${config.fetchConnections}`,
    `--split=${config.fetchConnections}`,
    '--min-split-size=1M',
    '--uri-selector=adaptive',
    '--file-allocation=none',
    '--disk-cache=64M',
    '--auto-file-renaming=true',
    '--allow-overwrite=false',
    '--check-certificate=true',
    '--http-accept-gzip=true',
    '--max-tries=8',
    '--retry-wait=3',
    '--connect-timeout=20',
    '--timeout=40',
    // a .torrent or metalink behind a file link is saved as the file, never followed
    '--follow-torrent=false',
    '--follow-metalink=false',
    '--enable-dht=false',
    '--enable-dht6=false',
    '--bt-enable-lpd=false',
    '--enable-peer-exchange=false',
    '--console-log-level=error',
    '--summary-interval=0',
    '--quiet=true',
    ...(limit ? [`--max-overall-download-limit=${limit}`] : []),
  ]
}

export function ensureEngine(): Promise<Engine> {
  if (engine && engine.child.exitCode === null) return Promise.resolve(engine)
  starting ??= (async () => {
    fetchStore.set(s => ({...s, starting: true, error: undefined}))
    try {
      await whenToolsReady()
      const bin = tools().aria2
      if (!bin) throw new Error('the fetch engine is missing: run Repair in settings')
      loadMeta()
      const port = await freePort()
      const secret = crypto.randomBytes(24).toString('base64url')
      const session = path.join(fetchDir(), 'session.txt')
      if (!fs.existsSync(session)) fs.writeFileSync(session, '')
      const folder = ensureDir(defaultFolder())
      const child = spawn(bin, engineArgs(port, secret, session, folder), {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']})
      let stderr = ''
      child.stderr?.on('data', (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-2000)))
      const started: Engine = {child, port, secret}
      child.on('exit', code => {
        if (engine === started) engine = undefined
        stopPolling()
        fetchStore.set(s => ({...s, running: false, starting: false, error: code ? `the fetch engine stopped (${code})${stderr ? `: ${stderr.trim().split('\n').at(-1)}` : ''}` : undefined}))
        if (code) logEvent('error', `aria2 exited ${code}: ${stderr.trim().slice(-300)}`)
      })
      // ready once it answers
      for (let i = 0; i < 50; i++) {
        if (child.exitCode !== null) throw new Error(stderr.trim().split('\n').at(-1) || 'the fetch engine would not start')
        try {
          await call<{version: string}>(started, 'getVersion')
          engine = started
          lastGlobal = currentGlobalLimit()
          fetchStore.set(s => ({...s, running: true, starting: false}))
          logEvent('info', 'fetch engine started')
          startPolling()
          return started
        } catch {
          await new Promise(r => setTimeout(r, 100))
        }
      }
      child.kill()
      throw new Error('the fetch engine did not answer')
    } catch (error) {
      fetchStore.set(s => ({...s, starting: false, error: (error as Error).message}))
      throw error
    } finally {
      starting = undefined
    }
  })()
  return starting
}

/** stop aria2 now (it saves its session first) */
export async function stopEngine(): Promise<void> {
  const current = engine
  if (!current) return
  try {
    await call(current, 'shutdown')
  } catch {
    current.child.kill()
  }
}

/** stop aria2 and wait until it has written its session and gone (Axive moving to its other door picks it up) */
export async function stopEngineAndWait(): Promise<void> {
  const current = engine
  if (!current) return
  await call(current, 'saveSession').catch(() => undefined)
  await stopEngine()
  for (let i = 0; i < 60 && current.child.exitCode === null; i++) await new Promise(r => setTimeout(r, 100))
  if (current.child.exitCode === null) current.child.kill()
}

/** restart the engine (bonding changed): unfinished work carries on from the session */
export async function restartEngine(): Promise<void> {
  const current = engine
  if (!current) return
  await call(current, 'saveSession').catch(() => undefined)
  await stopEngine()
  for (let i = 0; i < 50 && current.child.exitCode === null; i++) await new Promise(r => setTimeout(r, 100))
  await ensureEngine()
}

async function call<T>(target: Engine, method: string, ...params: unknown[]): Promise<T> {
  const name = method.includes('.') ? method : `aria2.${method}`
  // system.* takes no token; each call inside a multicall carries its own
  const args = name.startsWith('system.') ? params : [`token:${target.secret}`, ...params]
  const res = await fetch(`http://127.0.0.1:${target.port}/jsonrpc`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: String(++seq), method: name, params: args}),
    signal: AbortSignal.timeout(10_000),
  })
  const body = (await res.json()) as {result?: T; error?: {message?: string}}
  if (body.error) throw new Error(body.error.message ?? 'aria2 refused')
  return body.result as T
}

async function rpc<T>(method: string, ...params: unknown[]): Promise<T> {
  return call<T>(await ensureEngine(), method, ...params)
}

// ---------------------------------------------------------------------------
// reading aria2's state

type Aria2File = {path: string; length: string; completedLength: string; selected: string; uris?: {uri: string}[]}
export type Aria2Status = {
  gid: string
  status: 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed'
  totalLength: string
  completedLength: string
  downloadSpeed: string
  uploadSpeed: string
  connections: string
  numSeeders?: string
  seeder?: string
  dir: string
  files: Aria2File[]
  errorMessage?: string
  errorCode?: string
  followedBy?: string[]
  bittorrent?: {info?: {name?: string}; mode?: string}
  bitfield?: string
  numPieces?: string
  pieceLength?: string
}

const KEYS = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'uploadSpeed', 'connections', 'numSeeders', 'seeder', 'dir', 'files', 'errorMessage', 'errorCode', 'followedBy', 'bittorrent', 'bitfield', 'numPieces', 'pieceLength']

/** aria2's view of one download, as the screen shows it */
export function itemFrom(s: Aria2Status): FetchItem {
  const torrent = Boolean(s.bittorrent)
  const firstFile = s.files[0]
  const metadata = torrent && !s.bittorrent?.info?.name && Boolean(firstFile?.path?.startsWith('[METADATA]') || !firstFile?.path)
  const fromUri = nameFromUri(firstFile?.uris?.[0]?.uri)
  const name = s.bittorrent?.info?.name || (firstFile?.path && !firstFile.path.startsWith('[METADATA]') ? path.basename(firstFile.path) : '') || fromUri || (metadata ? 'reading the magnet…' : 'a file')
  const total = Number(s.totalLength) || 0
  const done = Number(s.completedLength) || 0
  const target = s.bittorrent?.info?.name ? path.join(s.dir, s.bittorrent.info.name) : firstFile?.path && !firstFile.path.startsWith('[METADATA]') ? firstFile.path : undefined
  const state: FetchState =
    s.status === 'complete' ? 'done' : s.status === 'error' ? 'failed' : s.status === 'removed' ? 'removed' : s.status === 'active' && torrent && s.seeder === 'true' && total > 0 && done >= total ? 'seeding' : s.status
  return {
    gid: s.gid,
    kind: 'file',
    name,
    state,
    total,
    done,
    speed: Number(s.downloadSpeed) || 0,
    upload: Number(s.uploadSpeed) || 0,
    connections: Number(s.connections) || 0,
    seeders: s.numSeeders !== undefined ? Number(s.numSeeders) : undefined,
    target,
    dir: s.dir,
    error: s.status === 'error' ? friendlyError(s.errorCode, s.errorMessage) : undefined,
    code: s.status === 'error' ? s.errorCode : undefined,
    uri: torrent ? undefined : firstFile?.uris?.[0]?.uri,
  }
}

function nameFromUri(uri: string | undefined): string {
  if (!uri) return ''
  try {
    return decodeURIComponent(new URL(uri).pathname.split('/').pop() || '')
  } catch {
    return ''
  }
}

/** aria2's exit codes, in plain words */
export function friendlyError(code?: string, message?: string): string {
  switch (code) {
    case '3':
      return 'not found on the server (404)'
    case '9':
      return 'not enough disk space'
    case '13':
    case '12':
      return 'that file is already being fetched or exists'
    case '15':
    case '16':
      return 'could not write the file. check the folder'
    case '19':
      return 'the address could not be resolved. check the link or your connection'
    case '22':
      return 'the server refused (it may need a login or a fresh link)'
    case '24':
      return 'the server asked for a login'
    case '26':
      return 'the torrent or magnet is not valid'
    case '2':
    case '6':
      return 'the connection kept dropping. try again'
    default:
      return message ? message.slice(0, 140) : 'the fetch failed'
  }
}

// per fetch: the last 60 s of speed, for fetchDetail
const itemHistory = new Map<string, number[]>()

async function poll(): Promise<void> {
  if (!engine) return
  try {
    const [[active], [waiting], [stopped]] = await call<[[Aria2Status[]], [Aria2Status[]], [Aria2Status[]]]>(engine, 'system.multicall', [
      {methodName: 'aria2.tellActive', params: [`token:${engine.secret}`, KEYS]},
      {methodName: 'aria2.tellWaiting', params: [`token:${engine.secret}`, 0, 200, KEYS]},
      {methodName: 'aria2.tellStopped', params: [`token:${engine.secret}`, 0, 200, KEYS]},
    ])
    const all = [...active, ...waiting, ...stopped]
    const now = Date.now()
    const items = all.map(s => decorate(enrich(itemFrom(s), s, now)))
    forgetGone(items)
    for (const item of items) adapt(item)
    for (const item of items) {
      if (item.state === 'active' || item.state === 'seeding') itemHistory.set(item.gid, pushRing(itemHistory.get(item.gid) ?? [], item.speed))
      if (item.state === 'done' && !recorded.has(item.gid) && item.target) {
        recorded.add(item.gid)
        try {
          record({url: item.uri ?? `${item.kind}: ${item.name}`, title: item.name, filepath: item.target, size: item.total, vessel: 'file', category: item.category})
        } catch {
          // the ledger is a nicety
        }
        whenDone(item)
      }
    }
    fetchStore.set(s => ({...s, items}))
    await scheduleFetches()
    await climb(now)
    evaluateQueues()
  } catch {
    // the engine may be restarting; the next tick tries again
  }
}

/** the meta's view on an item: queue, category, flags, held items read as waiting */
function decorate(item: FetchItem): FetchItem {
  let m = metaOf(item.gid)
  // an item from an older session: aria2 paused it, so a person did
  if (!m) m = setMeta(item.gid, {queueId: MAIN_QUEUE, userPaused: item.state === 'paused' || undefined, category: categoryFor(item.name, item.uri).id})
  item.queueId = queueIdFor(m.queueId)
  item.category = m.category
  item.limit = m.limit
  item.openWhenDone = m.openWhenDone
  item.showWhenDone = m.showWhenDone
  item.addedAt = m.addedAt
  item.wanted = item.uri ? ramps.get(item.uri)?.current : undefined
  if (item.state === 'paused' && m.held && !m.userPaused) {
    item.state = 'waiting'
    item.held = true
  }
  if (awaitStore.get()?.gid === item.gid) item.awaiting = true
  return item
}

// ---------------------------------------------------------------------------
// what the screens draw on top of aria2's numbers: the piece map, a steady
// speed, and a warning for a file that came back as a web page

/** time constant of the smoothed speed: it forgets about 63 % of the past every 3 s */
export const SMOOTH_TAU_MS = 3000

/** an exponential moving average with a time constant, so uneven polls weigh right */
export function smoothSpeed(prev: number | undefined, raw: number, dtMs: number, tau = SMOOTH_TAU_MS): number {
  if (prev === undefined || !Number.isFinite(prev) || dtMs <= 0) return raw
  const a = 1 - Math.exp(-dtMs / tau)
  return prev + a * (raw - prev)
}

/** seconds left at a speed; nothing under 1 KB/s (no "9 days left") */
export function etaFrom(remaining: number, speed: number): number | undefined {
  return remaining > 0 && speed >= 1024 ? remaining / speed : undefined
}

// names that promise a binary file (media is yt-dlp's business)
const BINARY_EXT = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|zst|cab|iso|img|vhdx?|exe|msi|msix|appx|dmg|pkg|deb|rpm|apk|jar|pdf|epub)$/i

/** true when a file's name says it should be binary */
export function masqueradeExt(name: string): boolean {
  return BINARY_EXT.test(name.trim())
}

/** true when the first bytes of a file read like a web page */
export function looksLikeHtml(head: Uint8Array): boolean {
  let start = 0
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) start = 3 // UTF-8 BOM
  const text = Buffer.from(head.buffer, head.byteOffset + start, Math.max(0, Math.min(head.byteLength, 512) - start))
    .toString('latin1')
    .replace(/^\s+/, '')
    .toLowerCase()
  if (text.startsWith('<?xml')) return /<html[\s>]/.test(text)
  return /^<(!doctype html|html[\s>]|head[\s>]|body[\s>])/.test(text)
}

export const MASQUERADE_WARNING = 'this looks like a web page, not the file: the link may have expired or needed a login'

function checkMasquerade(file: string): string | undefined {
  if (!masqueradeExt(path.basename(file))) return undefined
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const head = Buffer.alloc(512)
    const read = fs.readSync(fd, head, 0, 512, 0)
    return looksLikeHtml(head.subarray(0, read)) ? MASQUERADE_WARNING : undefined
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

const lastBits = new Map<string, Uint8Array>()
const speeds = new Map<string, {value: number; at: number}>()
const warnings = new Map<string, string | undefined>()

/** the piece map, smoothed speed and masquerade warning for one item */
export function enrich(item: FetchItem, s: Aria2Status, now: number): FetchItem {
  const pieces = Number(s.numPieces) || 0
  const pieceSize = Number(s.pieceLength) || 0
  if (s.bitfield && pieces > 0 && item.state !== 'done' && item.state !== 'seeding' && item.state !== 'removed') {
    const bits = decodeBitfield(s.bitfield, pieces)
    const view = pieceView(bits, lastBits.get(item.gid), item.state === 'active' ? item.connections : 0, item.done, pieceSize, MAP_CELLS, item.kind === 'file')
    lastBits.set(item.gid, bits)
    Object.assign(item, {map: view.map, edges: view.edges, pieces, pieceSize})
  } else {
    lastBits.delete(item.gid)
  }
  if (item.state === 'active') {
    const prev = speeds.get(item.gid)
    const value = smoothSpeed(prev?.value, item.speed, prev ? now - prev.at : 0)
    speeds.set(item.gid, {value, at: now})
    item.smooth = value
    item.eta = item.total ? etaFrom(item.total - item.done, value) : undefined
  } else {
    speeds.delete(item.gid)
  }
  if (item.state === 'done' && item.kind === 'file' && item.target) {
    if (!warnings.has(item.gid)) {
      const warning = checkMasquerade(item.target)
      warnings.set(item.gid, warning)
      if (warning) logEvent('warn', 'fetch: a finished file looks like a web page')
    }
    item.warning = warnings.get(item.gid)
  }
  return item
}

function forgetGone(items: FetchItem[]): void {
  const live = new Set(items.map(i => i.gid))
  for (const map of [lastBits, speeds, warnings, itemHistory, appliedLimit] as Map<string, unknown>[]) for (const gid of [...map.keys()]) if (!live.has(gid)) map.delete(gid)
  loadMeta()
  let pruned = false
  for (const gid of [...meta.keys()]) if (!live.has(gid)) (meta.delete(gid), carried.delete(gid), (pruned = true))
  if (pruned) saveMetaSoon()
  const waiting = awaitStore.get()
  if (waiting && !live.has(waiting.gid)) awaitStore.set(undefined)
}

// ---------------------------------------------------------------------------
// queues: Axive starts and holds fetches, aria2 just draws them

const live = (i: FetchItem) => i.state === 'active' || (i.state === 'waiting' && !i.held)
const pendingState = (i: FetchItem) => (i.state === 'active' || i.state === 'waiting') && !metaOf(i.gid)?.userPaused

const appliedLimit = new Map<string, number>()
let scheduling = false

/** hold what must wait, start what may, share queue limits: after every poll and queue change */
export async function scheduleFetches(): Promise<void> {
  if (!engine || scheduling) return
  scheduling = true
  try {
    const items = fetchStore.get().items
    const mutated = new Map<string, Partial<FetchItem>>()
    for (const q of getQueues()) {
      const mine = items.filter(i => i.queueId === q.id)
      let free = q.maxConcurrent - occupancy(q.id)
      if (free < 0) {
        // the queue was made smaller: the newest wait again
        const extra = mine.filter(i => live(i) && !metaOf(i.gid)?.force).sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
        for (const i of extra.slice(0, -free)) {
          await rpc('forcePause', i.gid).catch(() => undefined)
          setMeta(i.gid, {held: true})
          mutated.set(i.gid, {state: 'waiting', held: true, speed: 0})
        }
        free = 0
      }
      const held = mine.filter(i => i.held && i.state === 'waiting').sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0))
      for (const i of held) {
        if (free <= 0) break
        await rpc('unpause', i.gid).catch(() => undefined)
        setMeta(i.gid, {held: false})
        mutated.set(i.gid, {held: false})
        free--
      }
    }
    if (mutated.size) fetchStore.set(s => ({...s, items: s.items.map(i => (mutated.has(i.gid) ? {...i, ...mutated.get(i.gid)} : i))}))
    // speed: an item's own limit (the overall one is aria2's own option)
    const tightened: string[] = []
    for (const i of fetchStore.get().items) {
      if (i.state !== 'active') continue
      const want = parseRate(i.limit)
      const had = appliedLimit.get(i.gid)
      if (had === want) continue
      appliedLimit.set(i.gid, want)
      await rpc('changeOption', i.gid, {'max-download-limit': String(want)}).catch(() => undefined)
      if (want > 0 && i.speed > want * 1.5) tightened.push(i.gid)
    }
    await resetAverages(tightened)
  } finally {
    scheduling = false
  }
}

/**
 * aria2 holds a newly lowered limit as an average since the download began:
 * a fast fetch would stand still for a long while to pay its speed back.
 * A quick pause and resume starts the average afresh (measured with 1.37:
 * 256 KB/s held from the next second). Held meanwhile, so its queue never
 * mistakes it for finished.
 */
async function resetAverages(gids: string[]): Promise<void> {
  if (!gids.length) return
  for (const gid of gids) setMeta(gid, {held: true})
  await Promise.all(gids.map(gid => rpc('forcePause', gid).catch(() => undefined)))
  for (let t = 0; t < 20; t++) {
    const states = await Promise.all(gids.map(gid => rpc<Aria2Status>('tellStatus', gid, ['status']).catch(() => undefined)))
    if (states.every(s => !s || s.status !== 'active')) break
    await new Promise(r => setTimeout(r, 100))
  }
  for (const gid of gids) {
    await rpc('unpause', gid).catch(() => undefined)
    setMeta(gid, {held: false})
  }
}

let lastGlobal = 0

registerMember('fetch', {
  running: queueId => fetchStore.get().items.filter(i => i.queueId === queueId && live(i)).length,
  pending: queueId => fetchStore.get().items.filter(i => i.queueId === queueId && pendingState(i)).length,
  changed: () => void scheduleFetches(),
  limit(gid, limit) {
    if (!fetchStore.get().items.some(i => i.gid === gid)) return false
    setMeta(gid, {limit: limit || undefined})
    appliedLimit.delete(gid)
    fetchStore.set(s => ({...s, items: s.items.map(i => (i.gid === gid ? {...i, limit: limit || undefined} : i))}))
    void scheduleFetches()
    return true
  },
})

addSpeedSource('fetch', () => fetchStore.get().items.reduce((sum, i) => sum + (i.state === 'active' ? (i.smooth ?? i.speed) : 0), 0))

onLimitsChanged(() => void applyFetchSettings())

// ---------------------------------------------------------------------------
// on completion: open the file or show it, as asked

// a downloaded program is never started by itself: its folder opens instead
const RUNS = /\.(exe|msi|msix|msixbundle|appx|appxbundle|bat|cmd|com|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|scr|lnk|pif|hta|cpl|reg|jar|application|gadget|msc)$/i

/** what "open when done" does with a file: 'open', or 'show' when opening would run it */
export const openPlan = (file: string, warning?: string): 'open' | 'show' => (RUNS.test(file) || warning ? 'show' : 'open')

function whenDone(item: FetchItem): void {
  if (!item.target) return
  if (item.openWhenDone) {
    if (openPlan(item.target, item.warning) === 'open') openFile(item.target)
    else revealPath(item.target)
  } else if (item.showWhenDone) revealPath(item.target)
}

/** hand a file to Windows to open with its usual program */
export function openFile(file: string): void {
  if (process.env.NODE_TEST_CONTEXT) return
  try {
    openPath(file)
  } catch {
    // the path is on screen anyway
  }
}

// ---------------------------------------------------------------------------
// Adaptive connections: many servers refuse or choke on 16 parallel streams from
// one client. When a file fails that way, it starts again from its partial file
// with 4 connections, then 1, before the failure is shown. Then, a minute at a
// time without refusals, it climbs back one connection (plexo's recovery), up
// to what was asked. A refusal after a climb settles one below and stays there.

// 2.4: and 2 before 1: speed-test servers (Hetzner) now allow exactly two streams and refuse the rest with 429
const STEP_DOWN = [4, 2, 1]
const RETRYABLE = new Set(['2', '6', '8', '22', '29'])
const steppedDown = new Map<string, number>()
const handled = new Set<string>()
export const CLIMB_MS = 60_000

type Ramp = {target: number; current: number; at: number; climbed: boolean; ceiling?: number; refused?: number}
const ramps = new Map<string, Ramp>()

/** the connection counts a failed file would retry with next, if any */
export function nextConnections(code: string | undefined, used: number): number | undefined {
  return code && RETRYABLE.has(code) ? STEP_DOWN[used] : undefined
}

/** one more connection after a quiet minute, up to the ceiling; undefined: stay */
export function climbStep(ramp: Ramp, now: number, on = true): number | undefined {
  if (!on || now - ramp.at < CLIMB_MS) return undefined
  const top = Math.min(ramp.target, ramp.ceiling ?? ramp.target)
  return ramp.current < top ? ramp.current + 1 : undefined
}

/** what the detail view says about the connection count */
export function rampVerdict(ramp: Ramp | undefined, on = true): string | undefined {
  if (!ramp) return undefined
  const top = Math.min(ramp.target, ramp.ceiling ?? ramp.target)
  if (ramp.ceiling !== undefined && ramp.current >= top && top < ramp.target) return `the server allows about ${top} connections; holding there`
  if (ramp.current >= ramp.target) return ramp.refused ? `back to ${ramp.target} connections after the server refused ${ramp.refused}` : undefined
  const why = ramp.refused ? `the server refused ${ramp.refused} connections; on ${ramp.current} now` : `on ${ramp.current} of ${ramp.target} connections`
  return on ? `${why}, adding one back each minute` : why
}

function adapt(item: FetchItem): void {
  if (item.state !== 'failed' || item.kind !== 'file' || !item.uri || handled.has(item.gid)) return
  const uri = item.uri
  const ramp = ramps.get(uri)
  let connections: number | undefined
  if (ramp?.climbed && item.code && RETRYABLE.has(item.code)) {
    // it refused after a climb: one below is where it holds
    connections = Math.max(1, ramp.current - 1)
    ramps.set(uri, {...ramp, current: connections, ceiling: connections, climbed: false, at: Date.now()})
  } else {
    const used = steppedDown.get(uri) ?? 0
    connections = nextConnections(item.code, used)
    if (!connections) return
    steppedDown.set(uri, used + 1)
    const target = metaOf(item.gid)?.connections ?? getConfig().fetchConnections
    ramps.set(uri, {target, current: connections, at: Date.now(), climbed: false, refused: ramp?.refused ?? (item.connections || item.wanted || target)})
  }
  if (!engine) return
  handled.add(item.gid)
  const gid = item.gid
  void (async () => {
    const opts = await optionsFor(gid)
    await rpc('removeDownloadResult', gid).catch(() => undefined)
    const next = await rpc<string>('addUri', [uri], {...opts, dir: item.dir, split: String(connections), 'max-connection-per-server': String(connections)}).catch(() => undefined)
    if (next) rekey(gid, next, {held: false})
    logEvent('info', `fetch: the server refused parallel streams (${item.code}); retrying with ${connections}`)
  })()
}

async function climb(now: number): Promise<void> {
  const on = getConfig().climbBack
  for (const item of fetchStore.get().items) {
    if (item.state !== 'active' || item.kind !== 'file' || !item.uri) continue
    const ramp = ramps.get(item.uri)
    if (!ramp) continue
    const next = climbStep(ramp, now, on)
    if (!next) continue
    ramps.set(item.uri, {...ramp, current: next, at: now, climbed: true})
    await rpc('changeOption', item.gid, {split: String(next), 'max-connection-per-server': String(next)}).catch(() => undefined)
    logEvent('info', `fetch: climbing back to ${next} connections`)
  }
}

/** change how many connections a fetch uses, now (aria2 reopens its connections; nothing received is lost) */
export async function setConnections(gid: string, n: number): Promise<void> {
  if (!Number.isInteger(n) || n < 1 || n > 16) throw new Error('between 1 and 16 connections')
  const item = fetchStore.get().items.find(i => i.gid === gid)
  if (!item || item.kind !== 'file') throw new Error('only a file splits into connections')
  setMeta(gid, {connections: n})
  if (item.uri) ramps.set(item.uri, {target: n, current: n, at: Date.now(), climbed: false})
  await rpc('changeOption', gid, {split: String(n), 'max-connection-per-server': String(n)})
  void poll()
}

function startPolling(): void {
  if (poller) return
  void poll()
  poller = setInterval(() => void poll(), 1000)
  poller.unref()
}

function stopPolling(): void {
  if (poller) clearInterval(poller)
  poller = undefined
}

// ---------------------------------------------------------------------------
// await a new link: the next link that arrives carries an expired fetch on

export type AwaitState = {gid: string; name: string; since: number}
export const awaitStore = createStore<AwaitState | undefined>(undefined)
export const AWAIT_MS = 15 * 60_000

/** mark a file to take the next link that arrives (paste, ghost, extension, phone); pauses it first */
export async function awaitLink(gid: string): Promise<AwaitState> {
  const item = fetchStore.get().items.find(i => i.gid === gid)
  if (!item || item.kind !== 'file') throw new Error('only a file can take a new link')
  if (item.state === 'done') throw new Error('that file is already complete')
  if (item.state === 'active' || item.state === 'waiting') {
    await pauseFetch(gid)
    // forcePause asks; aria2 lets go a moment later
    for (let i = 0; i < 15 && fetchStore.get().items.find(x => x.gid === gid)?.state === 'active'; i++) {
      await new Promise(r => setTimeout(r, 200))
      await poll()
    }
  }
  const state = {gid, name: item.name, since: Date.now()}
  awaitStore.set(state)
  fetchStore.set(s => ({...s, items: s.items.map(i => ({...i, awaiting: i.gid === gid || undefined}))}))
  return state
}

export function cancelAwait(): void {
  awaitStore.set(undefined)
  fetchStore.set(s => ({...s, items: s.items.map(i => (i.awaiting ? {...i, awaiting: undefined} : i))}))
}

/** the fetch awaiting a link, if any (an old wait lapses after 15 minutes) */
export function awaiting(): AwaitState | undefined {
  const state = awaitStore.get()
  if (state && Date.now() - state.since > AWAIT_MS) {
    cancelAwait()
    return undefined
  }
  return state
}

/**
 * For every path a link can arrive by: when a fetch awaits a link and this is
 * a web address, it carries that fetch on and resolves with its new id;
 * otherwise undefined and the caller treats the link as new.
 */
export async function takeAwaited(link: string, opts: Pick<AddOptions, 'headers' | 'cookie' | 'referer' | 'userAgent'> = {}): Promise<string | undefined> {
  const state = awaiting()
  if (!state || !/^https?:\/\//i.test(link.trim())) return undefined
  const next = await relinkFetch(state.gid, link, opts)
  cancelAwait()
  return next
}

// ---------------------------------------------------------------------------
// what the screens do

export type AddOptions = {
  /** extra request headers (a browser's), never logged */
  headers?: Record<string, string>
  referer?: string
  /** a Cookie header for this one fetch, never logged */
  cookie?: string
  userAgent?: string
  /** the file name to save as */
  filename?: string
  queueId?: string
  category?: string
  /** false: add it paused */
  start?: boolean
  connections?: number
  /** its own speed limit, like 2M */
  limit?: string
  /** override the onDuplicate setting for this add (the answer to 'ask') */
  onDuplicate?: DuplicateChoice
  openWhenDone?: boolean
  showWhenDone?: boolean
  /** true: never take this link for a fetch awaiting one */
  fresh?: boolean
}

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const noBreaks = (v: string) => !/[\r\n\0]/.test(v)

/** request headers for aria2's `header` option, checked; throws on anything that could split a request */
export function headerLines(opts: Pick<AddOptions, 'headers' | 'cookie'>): string[] {
  const out: string[] = []
  const entries = Object.entries(opts.headers ?? {})
  if (entries.length > 50) throw new Error('too many headers')
  for (const [name, value] of entries) {
    if (!HEADER_NAME.test(name) || typeof value !== 'string' || !noBreaks(value) || value.length > 8192) throw new Error('a header is not valid')
    // aria2 sets these itself (and a second Range breaks segmenting)
    if (/^(host|range|content-length|connection|transfer-encoding|referer|user-agent|cookie)$/i.test(name)) continue
    out.push(`${name}: ${value}`)
  }
  if (opts.cookie !== undefined) {
    if (!noBreaks(opts.cookie) || opts.cookie.length > 16_384) throw new Error('that cookie is not valid')
    if (opts.cookie.trim()) out.push(`Cookie: ${opts.cookie.trim()}`)
  }
  const cookieHeader = entries.find(([n]) => n.toLowerCase() === 'cookie')
  if (cookieHeader && opts.cookie === undefined && cookieHeader[1].trim()) out.push(`Cookie: ${cookieHeader[1].trim()}`)
  return out
}

/** aria2 options for one add, from the call, the host's rule and the settings (in that order) */
export function addOptionsFor(link: string, opts: AddOptions): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  const headers = headerLines(opts)
  if (headers.length) out.header = headers
  const referer = opts.referer ?? opts.headers?.Referer ?? opts.headers?.referer
  if (referer) {
    if (!/^https?:\/\/\S+$/i.test(referer) || referer.length > 4096) throw new Error('the referer must be a web address')
    out.referer = referer
  }
  const ua = opts.userAgent ?? opts.headers?.['User-Agent'] ?? opts.headers?.['user-agent']
  if (ua) {
    if (!noBreaks(ua) || ua.length > 1024) throw new Error('that user agent is not valid')
    out['user-agent'] = ua
  }
  const connections = opts.connections
  if (connections !== undefined) {
    if (!Number.isInteger(connections) || connections < 1 || connections > 16) throw new Error('between 1 and 16 connections')
    out.split = String(connections)
    out['max-connection-per-server'] = String(connections)
  }
  return out
}

/**
 * Add a file link; resolves with its id.
 * `opts` carries the browser's context (headers, cookie, referer, user agent),
 * the name, queue, category, connections, limit and completion flags.
 * Throws DuplicateError (probe.ts) for onDuplicate 'skip' and 'ask'.
 */
export async function addLink(link: string, folder = defaultFolder(), opts: AddOptions = {}): Promise<string> {
  const value = link.trim()
  if (isTorrent(value)) throw new Error(TORRENTS_ARE_AXIVES)
  if (!/^(https?|ftp):\/\//i.test(value)) throw new Error('not a link the fetcher takes')
  // a fetch that awaits a fresh link takes this one
  if (!opts.fresh) {
    // a failure here is shown: the person meant this link for that fetch
    const carried = await takeAwaited(value, opts)
    if (carried) return carried
  }
  const aria = addOptionsFor(value, opts)
  if (opts.limit !== undefined && opts.limit.trim() && !parseRate(opts.limit)) throw new Error('a speed limit looks like 512K, 2M or 1G')
  await ensureEngine()
  await poll()
  // the same address already on the list carries on instead of colliding with itself
  const existing = fetchStore.get().items.find(i => i.uri === value && i.state !== 'done' && i.state !== 'removed')
  if (existing) {
    if (existing.state === 'paused' || existing.state === 'failed') await resumeFetch(existing.gid)
    return existing.gid
  }
  const named = opts.filename ? safeFileName(opts.filename) : undefined
  const guess = named ?? urlName(value)
  const category = getCategoriesId(opts.category) ?? categoryFor(guess, value).id
  const dir = ensureDir(restingFolder(folder, category ? getCategoryById(category) : undefined))
  if (guess) {
    const busy = new Set(fetchStore.get().items.filter(i => i.target && i.state !== 'removed').map(i => path.resolve(i.target!).toLowerCase()))
    const plan = duplicatePlan(dir, safeFileName(guess), opts.onDuplicate ?? getConfig().onDuplicate, f => fs.existsSync(f) || busy.has(path.resolve(f).toLowerCase()))
    if (named || plan.out !== safeFileName(guess)) aria.out = plan.out
    if (plan.overwrite) aria['allow-overwrite'] = 'true'
  }
  const limit = opts.limit?.trim()
  if (limit) aria['max-download-limit'] = String(parseRate(limit))
  const queueId = queueIdFor(opts.queueId)
  // every add waits paused; the queue starts it when there is room (at once, usually)
  const gid = await rpc<string>('addUri', [value], {...aria, dir, pause: 'true'})
  carried.set(gid, {...aria, dir})
  setMeta(gid, {
    queueId,
    category,
    limit: limit || undefined,
    connections: opts.connections,
    openWhenDone: opts.openWhenDone || undefined,
    showWhenDone: opts.showWhenDone || undefined,
    userPaused: opts.start === false || undefined,
    held: opts.start !== false || undefined,
    addedAt: Date.now(),
  })
  await poll()
  logEvent('info', 'fetch added')
  return gid
}

const getCategoryById = (id: string) => getConfig().categories.find(c => c.id === id)
const getCategoriesId = (id: string | undefined) => (id && getCategoryById(id) ? id : undefined)

/** what a magnet or a .torrent link meets in Free */
export const TORRENTS_ARE_AXIVE = 'torrents and magnets come with Axive (axive.xyz). Free draws files, video and music'
const TORRENTS_ARE_AXIVES = TORRENTS_ARE_AXIVE

/** pause by hand: its queue leaves it alone until it is resumed */
export async function pauseFetch(gid: string): Promise<void> {
  setMeta(gid, {userPaused: true, held: false, force: false})
  await rpc('forcePause', gid).catch(() => undefined)
  await poll()
}

/**
 * Resume by hand. It takes its turn in its queue; when the queue is closed
 * (outside its hours) a person resuming it means now, so it runs regardless.
 */
export async function resumeFetch(gid: string): Promise<void> {
  const item = fetchStore.get().items.find(i => i.gid === gid)
  const m = metaOf(gid)
  // a failed fetch starts again from its partial file
  if (item?.state === 'failed') {
    const uri = item.uri ?? (await rpc<Aria2Status>('tellStatus', gid, ['files']).catch(() => undefined))?.files[0]?.uris?.[0]?.uri
    handled.add(gid)
    const opts = await optionsFor(gid)
    await rpc('removeDownloadResult', gid).catch(() => undefined)
    // a manual retry goes gently: the server already refused the full count once
    if (uri) {
      const next = await rpc<string>('addUri', [uri], {...opts, dir: item.dir, split: '4', 'max-connection-per-server': '4', pause: 'true'})
      rekey(gid, next, {held: true, userPaused: false, force: false})
    }
    await poll()
    return
  }
  const force = false
  setMeta(gid, {userPaused: false, held: !force, force})
  if (force) await rpc('unpause', gid).catch(() => undefined)
  await poll()
}

/** start now, whatever its queue says */
export async function startFetchNow(gid: string): Promise<void> {
  setMeta(gid, {userPaused: false, held: false, force: true})
  await rpc('unpause', gid).catch(() => undefined)
  void poll()
}

/** a fresh address for a fetch: http or https only */
export function relinkTarget(text: string): string {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    throw new Error('offer a full address (https://…)')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('a new link must start with https:// or http://')
  return url.href
}

// what proves who the user is to a server, and so must never follow a file to another one
const CREDENTIALS = ['header', 'referer', 'http-user', 'http-passwd', 'ftp-user', 'ftp-passwd']

const originOf = (uri: string | undefined): string | undefined => {
  try {
    return uri ? new URL(uri).origin : undefined
  } catch {
    return undefined
  }
}

/** The options a relinked file keeps: its credentials only while the origin stays the same (an unknown old one counts as different). */
export function carriedForRelink(old: Record<string, string | string[]>, oldUri: string | undefined, newUri: string): Record<string, string | string[]> {
  const before = originOf(oldUri)
  if (before && before !== 'null' && before === originOf(newUri)) return {...old}
  return Object.fromEntries(Object.entries(old).filter(([k]) => !CREDENTIALS.includes(k)))
}

/**
 * Give a paused or failed file a new address and carry on from what it has:
 * the partial file and its .aria2 control file stay where they are. Its
 * queue, flags and add options come along; `opts` may bring fresh headers.
 */
export async function relinkFetch(gid: string, text: string, opts: Pick<AddOptions, 'headers' | 'cookie' | 'referer' | 'userAgent'> = {}): Promise<string> {
  const uri = relinkTarget(text)
  const item = fetchStore.get().items.find(i => i.gid === gid)
  if (!item || item.kind !== 'file') throw new Error('only a file can take a new link')
  // a running one is taken off the list the same way (aria2 writes its control file as it stops)
  if (item.state === 'done' || item.state === 'seeding' || item.state === 'removed') throw new Error('that file is already complete')
  // Measured with aria2 1.37: changeUri on a paused download, then unpause,
  // left every connection open at 0 B/s. Taking it off the list (aria2 keeps
  // the partial file and writes its .aria2 control file) and adding the new
  // address under the same name resumes from that control file, reliably.
  const status = await rpc<Aria2Status>('tellStatus', gid, ['files', 'dir']).catch(() => undefined)
  const file = status?.files[0]?.path
  const old = carriedForRelink(await optionsFor(gid), item.uri ?? status?.files[0]?.uris?.[0]?.uri, uri)
  const fresh = opts.headers || opts.cookie || opts.referer || opts.userAgent ? addOptionsFor(uri, opts) : {}
  handled.add(gid)
  if (item.state !== 'failed') {
    await rpc('forceRemove', gid).catch(() => undefined)
    await settled(gid)
  }
  await rpc('removeDownloadResult', gid).catch(() => undefined)
  const next = await rpc<string>('addUri', [uri], {...old, ...fresh, dir: status?.dir ?? item.dir, pause: 'true', ...(file && !file.startsWith('[METADATA]') ? {out: path.basename(file)} : {})})
  rekey(gid, next, {userPaused: false, held: true})
  carried.set(next, {...old, ...fresh})
  if (awaitStore.get()?.gid === gid) cancelAwait()
  logEvent('info', 'fetch: carried on from a new link')
  await poll()
  return next
}

/** stop a fetch and delete what it had written (only its own files) */
/** Stop a fetch for good; its partial files (and the torrent's empty folders) go, unless `keepFiles`. */
export async function cancelFetch(gid: string, {keepFiles = false}: {keepFiles?: boolean} = {}): Promise<void> {
  const status = await rpc<Aria2Status>('tellStatus', gid, ['files', 'dir', 'status', 'bittorrent']).catch(() => undefined)
  await rpc('forceRemove', gid).catch(() => undefined)
  // forceRemove only asks: aria2 closes the file (and writes its .aria2 control
  // file) a moment later. Delete before that and the file is busy, or comes back.
  await settled(gid)
  await rpc('removeDownloadResult', gid).catch(() => undefined)
  meta.delete(gid)
  carried.delete(gid)
  saveMetaSoon()
  if (awaitStore.get()?.gid === gid) cancelAwait()
  if (status && status.status !== 'complete' && !keepFiles) {
    const dir = path.resolve(status.dir)
    const inside = (p: string) => path.resolve(p).startsWith(dir + path.sep)
    const folders = new Set<string>()
    const doomed: string[] = []
    for (const file of status.files) {
      if (!file.path || file.path.startsWith('[METADATA]') || !inside(file.path)) continue
      doomed.push(file.path, `${file.path}.aria2`)
      for (let d = path.dirname(path.resolve(file.path)); inside(d); d = path.dirname(d)) folders.add(d)
    }
    const name = status.bittorrent?.info?.name
    if (name) {
      const control = path.join(dir, `${name}.aria2`)
      if (inside(control)) doomed.push(control)
    }
    await removeWhenFree(doomed)
    // folders the torrent made, deepest first, and only once they are empty
    for (const folder of [...folders].sort((a, b) => b.length - a.length)) {
      try {
        fs.rmdirSync(folder)
      } catch {
        // not empty: something else lives there
      }
    }
  }
  void poll()
}

/** waits (up to 5 s) until aria2 has really let go of a removed download */
async function settled(gid: string): Promise<void> {
  for (let i = 0; i < 25; i++) {
    const now = await rpc<Aria2Status>('tellStatus', gid, ['status']).catch(() => undefined)
    if (!now || now.status === 'removed' || now.status === 'complete' || now.status === 'error') break
    await new Promise(r => setTimeout(r, 200))
  }
  await new Promise(r => setTimeout(r, 300)) // the control file is written as it stops
}

/**
 * Deletes files that may still be busy for a moment (aria2 flushing, an
 * antivirus scan), and sweeps once more in case a late write brought one back.
 */
export async function removeWhenFree(paths: string[], tries = 15): Promise<string[]> {
  let left = paths
  for (let i = 0; i < tries && left.length; i++) {
    if (i) await new Promise(r => setTimeout(r, Math.min(1000, 100 * i)))
    left = left.filter(p => {
      try {
        fs.rmSync(p, {force: true})
        return false
      } catch {
        return true
      }
    })
  }
  await new Promise(r => setTimeout(r, 500))
  for (const p of paths) {
    try {
      fs.rmSync(p, {force: true})
    } catch {
      // still held: reported below
    }
  }
  return paths.filter(p => fs.existsSync(p))
}

/** take a finished or failed fetch off the list (its file stays) */
export async function clearFetch(gid: string): Promise<void> {
  await rpc('removeDownloadResult', gid).catch(() => undefined)
  void poll()
}

/**
 * A received item leaves the list for good, a seeding torrent stops sharing
 * first and its files are let go of: what stays on the drive is the caller's
 * to keep or discard (discard.ts). Returns where it rests.
 */
export async function letGoFetch(gid: string): Promise<string | undefined> {
  const item = fetchStore.get().items.find(i => i.gid === gid)
  if (item?.state === 'seeding' || item?.state === 'active') {
    await rpc('forceRemove', gid).catch(() => undefined)
    await settled(gid)
  }
  await rpc('removeDownloadResult', gid).catch(() => undefined)
  meta.delete(gid)
  carried.delete(gid)
  saveMetaSoon()
  void poll()
  return item?.target
}

export async function clearFinishedFetches(): Promise<void> {
  await rpc('purgeDownloadResult').catch(() => undefined)
  void poll()
}

/** pause everything by hand */
export async function pauseAllFetches(): Promise<void> {
  for (const i of fetchStore.get().items) if (i.state === 'active' || i.state === 'waiting' || i.state === 'paused') setMeta(i.gid, {userPaused: true, held: false, force: false})
  await rpc('forcePauseAll').catch(() => undefined)
  void poll()
}

/** resume everything paused: each takes its turn in its queue */
export async function resumeAllFetches(): Promise<void> {
  for (const i of fetchStore.get().items) if (i.state === 'paused') setMeta(i.gid, {userPaused: false, held: true})
  await poll()
}

/** the settings changed: tell a running engine */
export async function applyFetchSettings(): Promise<void> {
  if (!engine) return
  const config = getConfig()
  const global = currentGlobalLimit()
  await call(engine, 'changeGlobalOption', {
    'max-concurrent-downloads': String(ENGINE_SLOTS),
    'max-connection-per-server': String(config.fetchConnections),
    split: String(config.fetchConnections),
    'max-overall-download-limit': String(global),
  }).catch(() => undefined)
  // a tighter limit for everything: start the running ones' averages afresh too
  const tighter = global > 0 && (lastGlobal === 0 || global < lastGlobal)
  lastGlobal = global
  if (tighter) {
    const fast = fetchStore.get().items.filter(i => i.state === 'active').reduce((sum, i) => sum + i.speed, 0) > global * 1.5
    if (fast) await resetAverages(fetchStore.get().items.filter(i => i.state === 'active').map(i => i.gid))
  }
  void scheduleFetches()
}

/** start the engine if a previous session left unfinished work, so it resumes */
export function resumeLeftovers(): void {
  try {
    const session = path.join(paths.root, 'fetch', 'session.txt')
    if (fs.existsSync(session) && fs.readFileSync(session, 'utf8').trim()) void ensureEngine().catch(() => undefined)
  } catch {
    // nothing to resume
  }
}

// ---------------------------------------------------------------------------
// the detail view of one fetch

export const DETAIL_CELLS = 480

export type FetchDetail = {
  item: FetchItem
  /** the piece map at up to 480 cells (pieces.ts digits) and the edges where connections write */
  pieces: {map: string; edges: number[]; count: number; size: number}
  /** one per connection: the address it reads and its speed */
  servers: {uri: string; speed: number}[]
  /** torrents: who it trades with (address, speed, whether they have it all) */
  peers?: {ip: string; speed: number; seeder: boolean}[]
  /** speed each second over the last 60 s, oldest first */
  history: number[]
  connections: number
  /** why it uses fewer connections than asked, when it does */
  rampVerdict?: string
}

/** everything about one fetch, for its detail view (aria2 getServers / getPeers) */
export async function fetchDetail(gid: string): Promise<FetchDetail> {
  const item = fetchStore.get().items.find(i => i.gid === gid)
  if (!item) throw new Error('that fetch is no longer on the list')
  const s = await rpc<Aria2Status>('tellStatus', gid, KEYS)
  let pieces = {map: item.map ?? '', edges: item.edges ?? [], count: Number(s.numPieces) || 0, size: Number(s.pieceLength) || 0}
  if (s.bitfield && pieces.count > 0) {
    const bits = decodeBitfield(s.bitfield, pieces.count)
    const view = pieceView(bits, undefined, item.state === 'active' ? item.connections : 0, Number(s.completedLength) || 0, pieces.size, DETAIL_CELLS, item.kind === 'file')
    pieces = {...pieces, map: view.map, edges: view.edges}
  }
  const servers: FetchDetail['servers'] = []
  if (item.state === 'active' && !s.bittorrent) {
    const list = await rpc<{servers: {currentUri: string; uri: string; downloadSpeed: string}[]}[]>('getServers', gid).catch(() => [])
    for (const f of list) for (const sv of f.servers) servers.push({uri: sv.currentUri || sv.uri, speed: Number(sv.downloadSpeed) || 0})
  }
  let peers: FetchDetail['peers']
  if (s.bittorrent && item.state === 'active') {
    const list = await rpc<{ip: string; downloadSpeed: string; seeder: string}[]>('getPeers', gid).catch(() => [])
    peers = list.slice(0, 200).map(p => ({ip: p.ip, speed: Number(p.downloadSpeed) || 0, seeder: p.seeder === 'true'}))
  }
  return {
    item,
    pieces,
    servers,
    peers,
    // pushRing keeps every ring exactly HISTORY_SECONDS long
    history: [...(itemHistory.get(gid) ?? new Array(HISTORY_SECONDS).fill(0))],
    connections: Number(s.connections) || 0,
    rampVerdict: item.uri ? rampVerdict(ramps.get(item.uri), getConfig().climbBack) : undefined,
  }
}

// ---------------------------------------------------------------------------
// export: the fetch list as links (no cookies, no headers, no paths)

export function exportFetches(): ExportItem[] {
  return fetchStore
    .get()
    .items.filter(i => i.uri && i.state !== 'removed')
    .map(i => ({url: i.uri!, name: i.name, kind: 'fetch' as const, state: i.state, size: i.total || undefined, category: i.category, queueId: i.queueId}))
}

/** @internal tests */
export const __test = {setMeta, metaOf, decorate, ramps}
