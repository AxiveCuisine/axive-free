import {execFile, spawnSync} from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {logEvent, setVersion} from './log.js'
import {EXE, IS_WIN, SYSTEM32, ensureDir, isSea, paths, readJson, writeFileAtomic} from './paths.js'

/**
 * The binaries Axive drives, and how they get onto the machine.
 *
 * Axive.exe carries them inside itself (Node single-executable assets):
 * yt-dlp, ffmpeg + ffprobe, a node runtime for yt-dlp's YouTube solver,
 * aria2 for the download manager, the native host, and the icon. On first launch they are unpacked into
 * <data>\bin; on every launch the unpacked copies are checked against the
 * SHA-256 recorded at build time, and anything missing or altered can be
 * restored from the exe itself — no network needed. That is what makes a
 * lone Axive.exe work wherever it is put.
 *
 * While developing (plain node), AXIVE_BIN or ./build/bin holds the same layout.
 */

export type Tools = {
  ytdlp: string
  ffmpegDir?: string
  /** a real node for yt-dlp's JavaScript challenge solver */
  node?: string
  host?: string
  /** aria2c: the download manager's engine (files, torrents, magnets) */
  aria2?: string
  /** axive-window.exe: the graphical interface's window (WebView2) */
  window?: string
}

export type PayloadItem = {
  name: string
  asset: string
  kind: 'zip' | 'raw'
  /** folder (zip) or file (raw), relative to bin */
  dest: string
  /** file whose hash proves the item is intact, relative to bin */
  check: string
  sha256: string
  size: number
  /** every file the item unpacks to (path in bin → SHA-256): all are hashed, not only the check file */
  files?: Record<string, string>
}

export type Payload = {version: string; items: PayloadItem[]}

type InstalledState = {payload?: string; ytdlp?: {version: string; sha256: string; files?: Record<string, string>}}

const stateFile = () => path.join(paths.bin, 'installed.json')

function seaModule(): {getRawAsset(key: string): ArrayBuffer} | undefined {
  try {
    return process.getBuiltinModule?.('node:sea') as unknown as {getRawAsset(key: string): ArrayBuffer}
  } catch {
    return undefined
  }
}

export function payload(): Payload | undefined {
  if (!isSea()) return undefined
  try {
    const raw = seaModule()?.getRawAsset('payload.json')
    const pack = raw ? (JSON.parse(Buffer.from(raw).toString('utf8')) as Payload) : undefined
    // every path in the manifest must stay inside bin: a relative name, no way up
    if (pack && !pack.items.every(item => [item.asset, item.dest, item.check, ...Object.keys(item.files ?? {})].every(insideBin))) return undefined
    return pack
  } catch {
    return undefined
  }
}

const insideBin = (rel: unknown): boolean =>
  typeof rel === 'string' && /^[\w.-]+(\/[\w.-]+)*$/.test(rel) && !rel.split('/').includes('..') && !path.isAbsolute(rel)

/** The bin folder: the unpacked payload, or a developer's override. */
export function binDir(): string {
  if (process.env.AXIVE_BIN) return path.resolve(process.env.AXIVE_BIN)
  if (isSea()) return paths.bin
  const script = path.dirname(path.resolve(process.argv[1] ?? '.'))
  const dev = path.join(script, '..', 'build', 'bin')
  return fs.existsSync(dev) ? dev : paths.bin
}

/** yt-dlp + friends, by absolute path — a bare `spawn('yt-dlp')` searches the current folder first on Windows. */
export function resolveTools(): Tools {
  const bin = binDir()
  const first = (...candidates: string[]) => candidates.map(c => path.join(bin, c)).find(c => fs.existsSync(c))
  const ytdlp = first(`yt-dlp/yt-dlp${EXE}`, `yt-dlp${EXE}`)
  if (!ytdlp) throw new ToolsMissingError(`yt-dlp is missing from ${bin}`)
  const ffmpeg = first(`ffmpeg/ffmpeg${EXE}`, `ffmpeg${EXE}`)
  return {
    ytdlp,
    ffmpegDir: ffmpeg ? path.dirname(ffmpeg) : undefined,
    node: first(`node/node${EXE}`, `node${EXE}`) ?? (isSea() ? undefined : process.execPath),
    host: first(`host/axive-host${EXE}`, `axive-host${EXE}`),
    aria2: first(`aria2/aria2c${EXE}`, `aria2c${EXE}`),
    window: first(`window/axive-window${EXE}`),
  }
}

/** axive-window.exe alone, before yt-dlp and the rest are unpacked: the window opens first. */
export function windowExe(): string | undefined {
  const exe = path.join(binDir(), 'window', `axive-window${EXE}`)
  return fs.existsSync(exe) ? exe : undefined
}

/** Names of every payload item but the given ones (the rest of a split install). */
export function payloadNamesExcept(...skip: string[]): string[] {
  return (payload()?.items ?? []).map(item => item.name).filter(name => !skip.includes(name))
}

export class ToolsMissingError extends Error {
  readonly missing = true
}

let cached: Tools | undefined
export function tools(): Tools {
  return (cached ??= resolveTools())
}
export function forgetTools(): void {
  cached = undefined
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    fs.createReadStream(file)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

// ---------------------------------------------------------------------------
// install / verify / repair

export type ToolHealth = {name: string; ok: boolean; reason?: string}

/** Quick: is every payload item present? (No hashing — runs before the first frame.) */
export function needsSetup(): boolean {
  const pack = payload()
  if (!pack) return false
  const state = readJson<InstalledState>(stateFile(), {})
  if (state.payload !== pack.version) return true
  return pack.items.some(item => !fs.existsSync(path.join(paths.bin, item.check)))
}

// what runs a tool waits while a first launch (or a new build) unpacks them: an aria2
// or yt-dlp started from the old folder would hold it and the unpack would fail
let readyWaiters: (() => void)[] = []

/** Resolves once every carried tool is unpacked (at once when they are, or in a dev checkout). */
export function whenToolsReady(): Promise<void> {
  const unpacked = needsSetup() ? new Promise<void>(resolve => readyWaiters.push(resolve)) : Promise.resolve()
  return unpacked.then(checkTools)
}

/** Full: hash every file of every item against the build-time record (or the renewed yt-dlp's own). */
export async function verifyTools(): Promise<ToolHealth[]> {
  const pack = payload()
  if (!pack) {
    try {
      resolveTools()
      return [{name: 'tools', ok: true}]
    } catch (error) {
      return [{name: 'yt-dlp', ok: false, reason: (error as Error).message}]
    }
  }
  const state = readJson<InstalledState>(stateFile(), {})
  const out: ToolHealth[] = []
  for (const item of pack.items) out.push({name: item.name, ...(await judgeItem(item, state))})
  return out
}

/** One item against its record: every file hashed, and (for a folder) nothing added beside them. */
export async function judgeItem(item: PayloadItem, state: InstalledState): Promise<{ok: boolean; reason?: string}> {
  const renewed = item.name === 'yt-dlp' ? state.ytdlp : undefined
  const expected = renewed ? (renewed.files ?? {[item.check]: renewed.sha256}) : (item.files ?? {[item.check]: item.sha256})
  // the renewed record lives in a file beside the tools: a path in it that leaves its folder is itself tampering
  if (!Object.keys(expected).every(rel => insideBin(rel) && rel.startsWith(`${item.dest.split('/')[0]}/`))) return {ok: false, reason: 'altered'}
  let reason: string | undefined
  for (const [rel, sha] of Object.entries(expected)) {
    const file = path.join(paths.bin, rel)
    if (!fs.existsSync(file)) {
      reason ??= 'missing'
      continue
    }
    if ((await sha256File(file).catch(() => '')) !== sha) return {ok: false, reason: 'altered'}
  }
  if (reason) return {ok: false, reason}
  // a whole-folder record also refuses what was added beside it: a planted dll loads as surely as a swapped one
  const whole = renewed ? renewed.files : item.files
  // (not the browser extensions: a browser may keep its own notes in a folder it loaded)
  if (whole && item.kind === 'zip' && !item.name.startsWith('extension')) {
    const known = new Set(Object.keys(whole).map(rel => path.join(paths.bin, rel).toLowerCase()))
    if (filesUnder(path.join(paths.bin, item.dest)).some(file => !known.has(file.toLowerCase()))) return {ok: false, reason: 'altered'}
  }
  return {ok: true}
}

function filesUnder(dir: string): string[] {
  const out: string[] = []
  const walk = (at: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(at, {withFileTypes: true})
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(at, entry.name)
      // a link or junction is never part of a payload: count it as a stray, never follow it
      if (entry.isDirectory()) walk(full)
      else out.push(full)
    }
  }
  walk(dir)
  return out
}

// the launch check: every tool hashed once per start, before anything runs one; what is altered or
// missing is restored from the exe itself, and what cannot be restored is refused, never run
let checking: Promise<void> | undefined
/** true once this start's check passed: the synchronous version probes run nothing before it */
let proven = false

/** Resolves once this start's tools are proven intact (restoring them if needed); rejects if they cannot be. */
export function checkTools(): Promise<void> {
  checking ??= (async () => {
    if (!payload()) return void (proven = true)
    const broken = (await verifyTools()).filter(h => !h.ok)
    if (!broken.length) return
    logEvent('warn', `tools failed their check: ${broken.map(h => `${h.name} (${h.reason})`).join(', ')}; restoring from the exe`)
    await unpackTools(broken.map(h => h.name), undefined, {})
    const still = (await verifyTools()).filter(h => !h.ok)
    if (still.length) throw new ToolsAlteredError(`${still.map(h => h.name).join(', ')} failed the integrity check and could not be restored: run Repair in settings`)
    logEvent('info', 'tools restored and verified')
  })().then(() => void (proven = true))
  // a failed check is asked again next time (after a Repair, say), not remembered as failed
  checking.catch(() => (checking = undefined))
  return checking
}

export class ToolsAlteredError extends Error {}

/** The native host alone, synchronously: it starts before the first frame, ahead of the full check. */
export const hostIntact = (file: string | undefined): boolean => itemIntact('host', file)

/** One single-file item (the host, the window), synchronously, for what must start before the full check. */
export function itemIntact(name: string, file: string | undefined): boolean {
  const pack = payload()
  if (!pack || !file) return Boolean(file)
  const item = pack.items.find(i => i.name === name)
  if (!item) return true
  try {
    return path.resolve(file) === path.resolve(paths.bin, item.check) && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === item.sha256
  } catch {
    return false
  }
}

/**
 * Unpack payload items (all, or the named ones) into bin. Each zip lands in
 * a fresh folder that only replaces the old one once its check file hashes
 * right, so a failed repair never leaves things worse than before.
 */
export async function installTools(only?: string[], onStep?: (label: string, done: number, total: number) => void, opts: {complete?: boolean} = {}): Promise<void> {
  try {
    await unpackTools(only, onStep, opts)
    // a whole set fresh out of the exe is this start's proof; after a partial repair the next check looks afresh
    if (!only) [checking, proven] = [Promise.resolve(), true]
    else checking = undefined
  } finally {
    // the whole set has landed, or failed: whoever waited goes on and meets the result
    if (!only || opts.complete) for (const resolve of readyWaiters.splice(0)) resolve()
  }
}

async function unpackTools(only: string[] | undefined, onStep: ((label: string, done: number, total: number) => void) | undefined, opts: {complete?: boolean}): Promise<void> {
  const pack = payload()
  const sea = seaModule()
  if (!pack || !sea) throw new Error('this build carries no tools to unpack')
  const bin = ensureDir(paths.bin)
  // folders an earlier unpack set aside and could not delete then
  for (const name of fs.readdirSync(bin)) if (name.endsWith('.old')) await fs.promises.rm(path.join(bin, name), {recursive: true, force: true}).catch(() => undefined)
  const staging = ensureDir(path.join(bin, '.staging'))
  const items = pack.items.filter(item => !only || only.includes(item.name))
  let index = 0
  for (const item of items) {
    onStep?.(item.name, index++, items.length)
    const bytes = Buffer.from(sea.getRawAsset(item.asset))
    // written without blocking: the window keeps drawing its progress while an antivirus reads each file
    if (item.kind === 'raw') {
      const dest = path.join(bin, item.dest)
      ensureDir(path.dirname(dest))
      const temp = `${dest}.new`
      await fs.promises.writeFile(temp, bytes)
      await fs.promises.rm(dest, {force: true, maxRetries: 10, retryDelay: 250})
      await renameWhenFree(temp, dest)
    } else {
      const archive = path.join(staging, item.asset)
      await fs.promises.writeFile(archive, bytes)
      const fresh = path.join(bin, `${item.dest}.new`)
      fs.rmSync(fresh, {recursive: true, force: true})
      ensureDir(fresh)
      await unzip(archive, fresh)
      fs.rmSync(archive, {force: true})
      const check = path.join(fresh, path.relative(item.dest, item.check))
      const actual = await sha256File(check).catch(() => '')
      if (actual !== item.sha256) {
        fs.rmSync(fresh, {recursive: true, force: true})
        throw new Error(`${item.name} did not unpack cleanly`)
      }
      const dest = path.join(bin, item.dest)
      // the old folder steps aside under a name of its own; a file in it that is still held (a scan, a
      // tool still running) only means it goes on a later start, never that the new one fails
      const old = `${dest}.${Date.now().toString(16)}.old`
      if (fs.existsSync(dest)) await renameWhenFree(dest, old)
      await renameWhenFree(fresh, dest)
      await fs.promises.rm(old, {recursive: true, force: true, maxRetries: 10, retryDelay: 250}).catch(() => undefined)
    }
    if (item.name === 'yt-dlp') {
      const state = readJson<InstalledState>(stateFile(), {})
      delete state.ytdlp
      writeFileAtomic(stateFile(), JSON.stringify(state))
    }
  }
  onStep?.('done', items.length, items.length)
  fs.rmSync(staging, {recursive: true, force: true})
  const state = readJson<InstalledState>(stateFile(), {})
  // a split install (the window first, then the rest) marks the payload whole once its last part lands
  if (!only || opts.complete) state.payload = pack.version
  writeFileAtomic(stateFile(), JSON.stringify(state))
  forgetTools()
  logEvent('info', `tools unpacked: ${items.map(i => i.name).join(', ')}`)
}

/**
 * Rename, waiting out Windows: an antivirus scanning a freshly unpacked exe
 * (aria2c and yt-dlp especially) holds its folder for a few seconds, and the
 * move fails with EPERM/EBUSY/EACCES until it lets go.
 */
export async function renameWhenFree(from: string, to: string, attempts = 40): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      fs.renameSync(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (i >= attempts || !(code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) throw error
      await new Promise(r => setTimeout(r, Math.min(1000, 100 * i)))
    }
  }
}

/** After a yt-dlp renewal: remember the new binary's hash so verification trusts it. */
export async function recordRenewedYtdlp(version: string): Promise<void> {
  const file = tools().ytdlp
  const state = readJson<InstalledState>(stateFile(), {})
  const home = path.dirname(file)
  // the folder build is recorded whole, as the build records it, so the launch check covers _internal too
  let files: Record<string, string> | undefined
  if (path.basename(home) === 'yt-dlp' && path.dirname(home) === paths.bin) {
    files = {}
    for (const each of filesUnder(home)) files[path.relative(paths.bin, each).split(path.sep).join('/')] = await sha256File(each)
  }
  state.ytdlp = {version, sha256: await sha256File(file), ...(files ? {files} : {})}
  writeFileAtomic(stateFile(), JSON.stringify(state))
}

export function unzip(archive: string, dest: string): Promise<void> {
  // bsdtar ships with Windows 10 1803+ and reads zip
  const tar = IS_WIN ? path.join(SYSTEM32, 'tar.exe') : 'unzip'
  const args = IS_WIN ? ['-xf', archive, '-C', dest] : ['-q', '-o', archive, '-d', dest]
  return new Promise((resolve, reject) => {
    execFile(tar, args, {windowsHide: true, timeout: 5 * 60_000}, error => (error ? reject(new Error(`unpacking failed: ${error.message}`)) : resolve()))
  })
}

// ---------------------------------------------------------------------------
// versions

// a renewal tries the new yt-dlp from its staging folder before swapping it in: that one is outside the check
const isTrial = (t: Tools): boolean => !path.resolve(t.ytdlp).toLowerCase().startsWith(path.resolve(paths.bin).toLowerCase() + path.sep) || /\.new[\\/]/i.test(t.ytdlp)


export function ytdlpVersion(t: Tools = tools()): string {
  if (!proven && !isTrial(t)) return ''
  try {
    const out = spawnSync(t.ytdlp, ['--version'], {encoding: 'utf8', windowsHide: true, timeout: 15_000})
    const version = out.stdout.trim().split(/\s+/)[0] ?? ''
    if (version) setVersion('yt-dlp', version)
    return version
  } catch {
    return ''
  }
}

export function ffmpegVersion(t: Tools = tools()): string {
  if (!t.ffmpegDir || !proven) return ''
  try {
    const out = spawnSync(path.join(t.ffmpegDir, `ffmpeg${EXE}`), ['-hide_banner', '-version'], {encoding: 'utf8', windowsHide: true, timeout: 10_000})
    const version = /ffmpeg version (\S+)/.exec(out.stdout)?.[1] ?? ''
    if (version) setVersion('ffmpeg', version)
    return version
  } catch {
    return ''
  }
}
