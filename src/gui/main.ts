import {spawn} from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {ONLY_IN_AXIVE} from '../core/brand.js'
import {bridge, runPowerShell} from '../core/bridge.js'
import {resetCategories} from '../core/categories.js'
import {DEFAULTS, META, configStore, getConfig, updateConfig, type Config} from '../core/config.js'
import {discard, discardSentence} from '../core/discard.js'
import {
  TORRENTS_ARE_AXIVE,
  addLink,
  applyFetchSettings,
  awaitLink,
  awaitStore,
  cancelAwait,
  cancelFetch,
  clearFetch,
  clearFinishedFetches,
  ensureEngine,
  exportFetches,
  fetchDetail,
  fetchKind,
  fetchStore,
  isMagnet,
  isTorrent,
  letGoFetch,
  pauseAllFetches,
  pauseFetch,
  relinkFetch,
  resumeAllFetches,
  resumeFetch,
  resumeLeftovers,
  setConnections,
  stopEngine,
  stopEngineAndWait,
} from '../core/fetcher.js'
import {historyStore} from '../core/history.js'
import {claimWithControl, focusWindow, offerTo, openHolder, release, takeOver} from '../core/instance.js'
import {addJobs, cancelJob, carryOver, clearFinished, jobsStore, pauseAll, pauseJob, prioritize, removeJob, resumeAll, resumeJob, restoreQueue, type Job} from '../core/jobs.js'
import {exportLedger, findDuplicate, forget as forgetEntry, forgetAll, importLinks, ledgerStore, loadRecent, rememberLink} from '../core/ledger.js'
import {limitsStore} from '../core/limits.js'
import {logEvent} from '../core/log.js'
import {NOTICES} from '../core/notices.js'
import {IS_WIN, ensureDir, paths, readJson, writeFileAtomic} from '../core/paths.js'
import {isProbablyUrl} from '../core/platforms.js'
import {probeLink} from '../core/probe.js'
import {queuesStore} from '../core/queues.js'
import {openPath, revealPath} from '../core/reveal.js'
import {createStore} from '../core/store.js'
import {checkTools, forgetTools, hostIntact, installTools, itemIntact, needsSetup, payload, payloadNamesExcept, resolveTools, tools, verifyTools, whenToolsReady, windowExe, type ToolHealth} from '../core/tools.js'
import {checkForUpdates, renewYtdlp} from '../core/update.js'
import {audioTracks, buildChoices, capChoice, defaultAudioTrack, probe, removePartials, trackLabel, withAudioTrack, type AudioTrack, type DownloadChoice, type VideoInfo} from '../core/ytdlp.js'
import {startGuiServer, type GuiServer} from './server.js'

/**
 * Axive Free with a window: the same core as its terminal (the queue, the
 * download manager, the ledger, the settings), served to the window Axive Free
 * shares with Axive (gui/, built for this edition) over a local, keyed API.
 * Started by a double-click on Axive-Free.exe, or `Axive-Free.exe --gui`.
 * What Free leaves to Axive has no route here: asked anyway, it says so.
 */

type Notice = {id: number; text: string; tone: 'info' | 'ok' | 'warn' | 'error'}
type Setup = {label: string; done: number; total: number} | {error: string} | undefined
type Repair = {state: 'idle' | 'checking' | 'repairing' | 'done' | 'failed'; carries: boolean; health?: ToolHealth[]; label?: string; done?: number; total?: number; error?: string}

const setupStore = createStore<Setup>(undefined)
/** set while a failed first unpack waits for the page's "try again" */
let retrySetup: (() => void) | undefined
const noticeStore = createStore<Notice | undefined>(undefined)
const repairStore = createStore<Repair>({state: 'idle', carries: false})
let noticeId = 1
const say = (text: string, tone: Notice['tone'] = 'info') => noticeStore.set({id: noticeId++, text, tone})

// what a probe found, kept here; the window only ever sees an id and a summary
const probes = new Map<string, {url: string; info: VideoInfo; infoJsonPath: string; choices: DownloadChoice[]; tracks: AudioTrack[]}>()
/**
 * The vessel with the audio track asked for: a track the video does not offer
 * is refused, never swapped. With several tracks every draw names one, the
 * original too (none asked: the one the list shows first).
 */
function chosenVessel(lot: {choices: DownloadChoice[]; tracks: AudioTrack[]}, index: unknown, track: unknown): DownloadChoice | undefined {
  const choice = lot.choices[num(index) ?? -1]
  if (!choice || !lot.tracks.length || (choice.kind !== 'video' && choice.kind !== 'audio')) return choice
  const found = track ? lot.tracks.find(t => t.id === str(track, 160)) : defaultAudioTrack(lot.tracks)
  if (!found) throw new Error('that audio track is not offered for this video')
  return withAudioTrack(choice, found)
}
const newId = () => crypto.randomBytes(6).toString('base64url')
/** what Free leaves to Axive, said where it is met */
const axive = (why: string) => new Error(`${why} (axive.xyz)`)

// ---------------------------------------------------------------- what the window sees

const slimJob = (j: Job) => ({
  id: j.id,
  url: j.url,
  title: j.title,
  site: j.site,
  uploader: j.uploader,
  thumbnail: j.thumbnail ?? (j.site === 'youtube' && j.videoId ? `https://i.ytimg.com/vi/${j.videoId}/mqdefault.jpg` : undefined),
  vessel: j.choice.label,
  kind: j.choice.kind,
  folder: j.folder,
  state: j.state,
  stage: j.stage,
  progress: j.progress ? {done: j.progress.downloadedBytes, total: j.progress.totalBytes, speed: j.progress.speed, eta: j.progress.eta, part: j.progress.part, parts: j.progress.totalParts} : undefined,
  error: j.error ? {title: j.error.title, detail: j.error.detail, remedies: j.error.remedies, raw: j.error.raw} : undefined,
  filepath: j.filepath,
  size: j.size,
  createdAt: j.createdAt,
  finishedAt: j.finishedAt,
  retryAt: j.retryAt,
  queueId: 'main',
  category: j.category,
  partial: Boolean(j.partials?.length),
})

const slimLedger = () =>
  ledgerStore
    .get()
    .slice(0, 400)
    .map(e => ({...e, exists: e.filepath ? fs.existsSync(e.filepath) : false, thumbnail: e.site === 'youtube' && e.videoId ? `https://i.ytimg.com/vi/${e.videoId}/mqdefault.jpg` : undefined}))

// the one tunnel, in the shape the window knows (Free has no schedules)
const queuesView = () => queuesStore.get().map(q => ({...q, schedule: {on: false, days: [0, 1, 2, 3, 4, 5, 6]}, after: 'none'}))

/** What the list keeps of earlier sessions: received rows after clearedAt, minus the hidden ones. */
type ListView = {clearedAt: number; hidden: string[]}
const listStore = createStore<ListView>({clearedAt: 0, hidden: []})
function loadListView(): void {
  const saved = readJson<{list?: Partial<ListView>}>(paths.state, {}).list
  listStore.set({clearedAt: typeof saved?.clearedAt === 'number' ? saved.clearedAt : 0, hidden: Array.isArray(saved?.hidden) ? saved.hidden.filter((x): x is string => typeof x === 'string').slice(-2000) : []})
}
function saveState(key: string, value: unknown): void {
  try {
    writeFileAtomic(paths.state, JSON.stringify({...readJson<Record<string, unknown>>(paths.state, {}), [key]: value}))
  } catch {
    // remembered for this session only
  }
}
function saveListView(next: ListView): void {
  listStore.set(next)
  saveState('list', next)
}

/** How the window was left: its page, the settings section, the list's sort, the last vessel. */
type UiPrefs = Record<string, string | number | boolean>
const UI_KEYS: Record<string, 'string' | 'number' | 'boolean'> = {view: 'string', section: 'string', sortKey: 'string', sortDir: 'number', scopeStatus: 'string', scopeCategory: 'string', scopeQueue: 'string', railCategories: 'boolean', vessel: 'string', manyVessel: 'string', ledgerFilter: 'string'}
function cleanUi(raw: unknown): UiPrefs {
  const out: UiPrefs = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const kind = UI_KEYS[k]
    if (kind === 'string' && typeof v === 'string' && v.length <= 64 && /^[\w .:+-]*$/.test(v)) out[k] = v
    else if (kind === 'number' && typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (kind === 'boolean' && typeof v === 'boolean') out[k] = v
  }
  return out
}
const uiStore = createStore<UiPrefs>({})

const META_VIEW = Object.fromEntries((Object.keys(META) as Array<keyof Config>).map(k => [k, {...META[k], default: DEFAULTS[k]}]))

function snapshot() {
  return {
    version: __AXIVE_VERSION__,
    // null, never left out: a page that reconnects must learn a part is gone
    setup: setupStore.get() ?? null,
    // Free is everyone's: nothing to bind
    licence: {state: 'licensed'},
    config: getConfig(),
    meta: META_VIEW,
    jobs: jobsStore.get().map(slimJob),
    fetch: fetchStore.get(),
    offerings: [],
    ledger: slimLedger(),
    list: listStore.get(),
    ui: uiStore.get(),
    vigils: [],
    ghost: {on: false, available: false},
    remote: {running: false},
    phone: {on: false, starting: false},
    queues: queuesView(),
    power: null,
    limits: limitsStore.get(),
    history: historyStore.get().total,
    awaiting: awaitStore.get() ?? null,
    tasks: [],
    repair: repairStore.get(),
    recent: loadRecent().slice(0, 8),
    notice: noticeStore.get() ?? null,
    host: bridge.available,
  }
}

// ---------------------------------------------------------------- guards

/** Only paths Axive Free itself produced, or chose, can be opened or revealed. */
const madeHere = new Set<string>()
function knownPath(p: unknown): string {
  if (typeof p !== 'string' || !p) throw new Error('no such file')
  const target = path.resolve(p).toLowerCase()
  const allowed = new Set<string>()
  const add = (x?: string) => x && allowed.add(path.resolve(x).toLowerCase())
  for (const j of jobsStore.get()) (add(j.filepath), add(j.folder))
  for (const e of ledgerStore.get()) add(e.filepath)
  for (const f of fetchStore.get().items) (add(f.target), add(f.dir))
  for (const m of madeHere) add(m)
  add(getConfig().folder)
  add(paths.root)
  add(paths.logs)
  if (!allowed.has(target)) throw new Error('Axive Free only opens what it made')
  return p
}

const str = (v: unknown, max = 4096) => (typeof v === 'string' && v.length <= max ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function linksIn(text: string): string[] {
  return [...new Set(text.split(/\s+/).map(s => s.trim()).filter(s => s && (isProbablyUrl(s) || isMagnet(s))))]
}

function folderOr(given: unknown): string {
  const folder = str(given) || getConfig().folder
  fs.mkdirSync(folder, {recursive: true})
  fs.accessSync(folder, fs.constants.W_OK)
  if (folder !== getConfig().folder) updateConfig({folder})
  return folder
}

function freeSpace(dir: string): number | undefined {
  try {
    let probeDir = dir
    while (!fs.existsSync(probeDir)) probeDir = path.dirname(probeDir)
    const stat = fs.statfsSync(probeDir)
    return stat.bavail * stat.bsize
  } catch {
    return undefined
  }
}

const openInBrowser = (url: string) => spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'rundll32.exe'), ['url.dll,FileProtocolHandler', url], {detached: true, stdio: 'ignore'}).unref()

// ---------------------------------------------------------------- the routes

const routes: Record<string, (b: Record<string, unknown>) => unknown> = {
  /** One link, pasted, typed or dropped: a video's vessels, or a file for the download manager. */
  async offer(b) {
    const text = str(b.text, 64 * 1024).trim()
    if (!text) throw new Error('nothing was offered')
    const links = linksIn(text)
    if (!links.length) {
      if (/^[\w.-]+\.[a-z]{2,}\//i.test(text)) throw new Error('nothing answers to that. offer a full link, https://…')
      throw axive('searching YouTube by words comes with Axive. offer a link')
    }
    if (links.some(l => isTorrent(l))) throw new Error(TORRENTS_ARE_AXIVE)
    const media = links.filter(l => !fetchKind(l))
    const files = links.filter(l => fetchKind(l))
    if (media.length + files.length > 1) throw axive(`${ONLY_IN_AXIVE.batch}. offer one link`)
    rememberLink(links[0]!)
    if (files.length) {
      await ensureEngine()
      await addLink(files[0]!, getConfig().folder)
      return {kind: 'fetch', count: 1}
    }
    const url = media[0]!
    if (/^https?:\/\/(open|play)\.spotify\.com\//i.test(url)) throw axive(ONLY_IN_AXIVE.spotify)
    await whenToolsReady()
    const result = await probe(tools(), url)
    if (result.kind === 'playlist') throw axive(`${ONLY_IN_AXIVE.playlist}. offer one video of it`)
    const id = newId()
    const choices = buildChoices(result.info)
    const tracks = audioTracks(result.info)
    probes.set(id, {url, info: result.info, infoJsonPath: result.infoJsonPath, choices, tracks})
    const info = result.info
    const config = getConfig()
    const duplicate = config.warnDuplicates ? findDuplicate(info.extractor_key?.toLowerCase(), info.id, url) : undefined
    return {
      kind: 'video',
      id,
      url,
      title: info.title,
      uploader: info.uploader ?? info.channel,
      duration: info.duration,
      site: info.extractor_key,
      uploaded: info.upload_date,
      thumbnail: info.thumbnail,
      thumbnails: [],
      chapters: [],
      choices: choices.map(c => ({label: c.label, kind: c.kind, size: c.size, height: c.height})),
      ...(tracks.length ? {audioTracks: tracks.map(a => ({id: a.id, name: a.name, kind: a.kind, label: trackLabel(a), isDefault: a.isDefault}))} : {}),
      duplicate: duplicate ? {at: duplicate.at, filepath: duplicate.filepath, exists: duplicate.filepath ? fs.existsSync(duplicate.filepath) : false} : undefined,
      free: freeSpace(config.folder),
    }
  },

  draw(b) {
    const found = probes.get(str(b.id))
    if (!found) throw new Error('that link has gone cold. offer it again')
    const choice = chosenVessel(found, b.choice, b.audioTrack)
    if (!choice) throw new Error('choose a vessel')
    const folder = folderOr(b.folder)
    const [job] = addJobs([
      {
        url: found.url,
        title: found.info.title,
        site: found.info.extractor_key?.toLowerCase(),
        videoId: found.info.id,
        uploader: found.info.uploader ?? found.info.channel,
        thumbnail: found.info.thumbnail,
        choice,
        folder,
        options: {},
        infoJsonPath: found.infoJsonPath,
      },
    ])
    return {job: job?.id}
  },

  job(b) {
    const id = str(b.id)
    const ops: Record<string, (id: string) => void> = {pause: pauseJob, resume: resumeJob, cancel: cancelJob, remove: removeJob, prioritize, now: prioritize}
    const op = ops[str(b.op)]
    if (!op) throw new Error('unknown')
    op(id)
    return {ok: true}
  },

  jobs(b) {
    if (b.op === 'pause-all') pauseAll()
    else if (b.op === 'resume-all') resumeAll()
    else if (b.op === 'clear') {
      clearFinished()
      // what earlier sessions received leaves the list too (the ledger keeps it)
      saveListView({clearedAt: Date.now(), hidden: []})
    }
    return {ok: true}
  },

  'ui-set'(b) {
    const next = {...uiStore.get(), ...cleanUi(b.patch)}
    uiStore.set(next)
    saveState('ui', next)
    return {ok: true}
  },

  /** one received row from an earlier session leaves the list (the file and the ledger stay) */
  'list-hide'(b) {
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(id => str(id, 64)).filter(Boolean)
    if (ids.length) saveListView({...listStore.get(), hidden: [...listStore.get().hidden, ...ids].slice(-2000)})
    return {ok: true}
  },

  async 'fetch-add'(b) {
    const links = linksIn(str(b.text, 64 * 1024)).filter(l => /^(https?|ftp):\/\//i.test(l))
    if (!links.length) throw new Error(linksIn(str(b.text, 64 * 1024)).some(isMagnet) ? TORRENTS_ARE_AXIVE : 'offer a full address (https://…)')
    if (links.some(l => isTorrent(l))) throw new Error(TORRENTS_ARE_AXIVE)
    await ensureEngine()
    const folder = folderOr(b.folder)
    for (const l of links) await addLink(l, folder, {start: b.start !== false})
    return {count: links.length}
  },

  async fetch(b) {
    const gid = str(b.gid, 64)
    const ops: Record<string, (gid: string) => Promise<void>> = {pause: pauseFetch, resume: resumeFetch, cancel: cancelFetch, clear: clearFetch}
    const op = ops[str(b.op)]
    if (!op) throw new Error('unknown')
    await op(gid)
    return {ok: true}
  },

  async 'fetch-relink'(b) {
    await relinkFetch(str(b.gid, 64), str(b.url, 8 * 1024))
    return {ok: true}
  },

  async fetches(b) {
    if (b.op === 'pause-all') await pauseAllFetches()
    else if (b.op === 'resume-all') await resumeAllFetches()
    else if (b.op === 'clear') await clearFinishedFetches()
    return {ok: true}
  },

  async config(b) {
    const patch = (b.patch ?? {}) as Record<string, unknown>
    const clean: Partial<Config> = {}
    for (const [k, v] of Object.entries(patch)) if (k in DEFAULTS) (clean as Record<string, unknown>)[k] = v
    updateConfig(clean)
    if ('fetchConnections' in clean || 'tunnels' in clean) await applyFetchSettings()
    return {ok: true}
  },

  async 'pick-folder'(b) {
    return {path: (await bridge.pickFolder(str(b.title, 200) || 'Choose a folder', str(b.initial) || getConfig().folder)) ?? null}
  },

  async 'pick-file'(b) {
    if (b.kind !== 'list') throw axive('working on a file you have (convert, trim) comes with Axive')
    throw axive(ONLY_IN_AXIVE.batch)
  },

  reveal(b) {
    revealPath(knownPath(b.path), getConfig().folder)
    return {ok: true}
  },

  open(b) {
    const p = knownPath(b.path)
    if (!fs.existsSync(p)) throw new Error('that file is no longer where it was left')
    openPath(p)
    return {ok: true}
  },

  'open-url'(b) {
    const url = str(b.url, 2048)
    if (!/^https:\/\/[\w.-]+(\/\S*)?$/.test(url)) throw new Error('not a web page')
    openInBrowser(url)
    return {ok: true}
  },

  async copy(b) {
    await bridge.writeClipboard(str(b.text, 8192))
    return {ok: true}
  },

  /** A link already on the clipboard, offered when the window opens; anything else stays unread. */
  async clipboard() {
    const text = (await bridge.readClipboard()).trim()
    return {link: text && !/\s/.test(text) && isProbablyUrl(text) ? text : null}
  },

  'ledger-forget'(b) {
    if (b.all) forgetAll()
    else forgetEntry(str(b.id, 64))
    return {ok: true}
  },

  /** ledger entries leave the ledger; with `drive`, their files go to the Recycle Bin (only paths the ledger holds) */
  async 'ledger-delete'(b) {
    const ids = new Set((Array.isArray(b.ids) ? b.ids : []).map(id => str(id, 64)).filter(Boolean))
    const entries = ledgerStore.get().filter(e => ids.has(e.id))
    const result = b.drive === true ? await discard(entries.map(e => e.filepath ?? '')) : undefined
    const kept = new Set(result?.kept.filter(k => k.why === 'in use' || k.why === 'failed').map(k => k.path.toLowerCase()))
    // a file that could not go keeps its line, so it can be tried again
    for (const e of entries) if (!e.filepath || !kept.has(path.resolve(e.filepath).toLowerCase())) forgetEntry(e.id)
    return {sentence: result ? discardSentence(result) : `${entries.length} removed from the ledger`, removed: result?.removed.length ?? 0}
  },

  /** finished rows leave the list; with `drive`, what they received goes to the Recycle Bin */
  async 'rows-delete'(b) {
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 2000).map(i => ({kind: str((i as Record<string, unknown>)?.kind, 8), id: str((i as Record<string, unknown>)?.id, 64)}))
    const drive = b.drive === true
    const files: string[] = []
    const hide: string[] = []
    let stopped = 0
    for (const {kind, id} of items) {
      if (kind === 'job') {
        const job = jobsStore.get().find(j => j.id === id)
        if (!job) continue
        if (job.state !== 'done' && job.state !== 'failed' && job.state !== 'cancelled' && job.state !== 'skipped') {
          // still drawing, waiting or paused: it stops, and its partial files go only when the owner said so
          cancelJob(id, {keepFiles: !drive})
          removeJob(id)
          stopped++
          continue
        }
        if (job.filepath) files.push(job.filepath)
        else if (drive && job.partials?.length) await removePartials(job.partials)
        removeJob(id)
      } else if (kind === 'fetch') {
        const item = fetchStore.get().items.find(i => i.gid === id)
        if (!item) continue
        if (item.state !== 'done' && item.state !== 'removed') {
          await cancelFetch(id, {keepFiles: !drive})
          stopped++
          continue
        }
        const target = await letGoFetch(id)
        if (target && item.state !== 'removed') files.push(target)
      } else if (kind === 'past') {
        const entry = ledgerStore.get().find(e => e.id === id)
        if (entry?.filepath) files.push(entry.filepath)
        hide.push(id)
      }
    }
    if (hide.length) saveListView({...listStore.get(), hidden: [...listStore.get().hidden, ...hide].slice(-2000)})
    const result = drive && files.length ? await discard(files) : undefined
    const partly = stopped ? `${stopped === 1 ? 'one stopped' : `${stopped} stopped`}${drive ? ', its partial files deleted' : ', what arrived stays'}` : ''
    const sentence = result ? discardSentence(result) + (partly ? ` · ${partly}` : '') : partly || (drive ? 'deleted' : 'cleared from the list · the files stay')
    return {sentence, removed: result?.removed.length ?? 0}
  },

  async renew() {
    if (jobsStore.get().some(j => j.state === 'running')) throw new Error('let the running draws finish (or pause them) before renewing yt-dlp')
    return {line: await renewYtdlp()}
  },

  async 'check-updates'() {
    const found = await checkForUpdates(true)
    return {ytdlp: found.ytdlp ?? null, axive: found.axive ?? null}
  },

  // ---------------------------------------------------------------- the tools: check & repair (as the terminal's)

  async 'tools-check'() {
    if (repairStore.get().state === 'checking' || repairStore.get().state === 'repairing') return repairStore.get()
    const carries = Boolean(payload())
    repairStore.set({state: 'checking', carries})
    try {
      repairStore.set({state: 'done', carries, health: await verifyTools()})
    } catch (error) {
      repairStore.set({state: 'failed', carries, error: (error as Error).message})
    }
    return repairStore.get()
  },

  'setup-retry'() {
    const again = retrySetup
    if (!again) throw new Error('the tools are not waiting for another try')
    retrySetup = undefined
    again()
    return {ok: true}
  },

  'tools-repair'() {
    const now = repairStore.get()
    if (now.state === 'checking' || now.state === 'repairing') throw new Error('the tools are already being looked at')
    if (!payload()) throw new Error('this build runs from a folder; repair by reinstalling, or set AXIVE_BIN.')
    if (jobsStore.get().some(j => j.state === 'running')) throw new Error('let the running draws finish (or pause them) before repairing the tools')
    const broken = (now.health ?? []).filter(h => !h.ok).map(h => h.name)
    if (!broken.length) throw new Error('every vessel is whole')
    repairStore.set({state: 'repairing', carries: true, health: now.health, label: broken[0], done: 0, total: broken.length})
    void (async () => {
      try {
        // the download manager's engine is one of the tools: it lets go of its file first
        if (broken.includes('aria2') && !fetchStore.get().items.some(i => i.state === 'active')) await stopEngine().catch(() => {})
        await installTools(broken, (label, done, total) => repairStore.set(r => ({...r, label, done, total})))
        resolveTools()
        const health = await verifyTools()
        repairStore.set({state: 'done', carries: true, health})
        say(health.every(h => h.ok) ? 'the vessels are ready' : 'something is amiss', health.every(h => h.ok) ? 'ok' : 'warn')
      } catch (error) {
        repairStore.set(r => ({state: 'failed', carries: true, health: r.health, error: (error as Error).message}))
      }
    })()
    return {ok: true}
  },

  focus() {
    void bridge.window('focus')
    return {ok: true}
  },

  'fetch-connections'(b) {
    const n = Math.round(num(b.n) ?? 16)
    return setConnections(str(b.gid, 40), Math.min(16, Math.max(1, n))).then(() => ({ok: true}))
  },
  'fetch-detail'(b) {
    return fetchDetail(str(b.gid, 40))
  },
  'await-link'(b) {
    return awaitLink(str(b.gid, 40))
  },
  'await-cancel'() {
    cancelAwait()
    return {ok: true}
  },
  'categories-reset'() {
    resetCategories()
    return {ok: true}
  },
  classify(b) {
    const links = linksIn(str(b.text, 200_000))
    if (links.some(l => isTorrent(l))) throw new Error(TORRENTS_ARE_AXIVE)
    if (links.length > 1) throw axive(`${ONLY_IN_AXIVE.batch}. offer one link`)
    return {files: links.filter(l => fetchKind(l)), media: links.filter(l => !fetchKind(l))}
  },
  async probe(b) {
    const urls = (Array.isArray(b.urls) ? b.urls : []).filter((u): u is string => typeof u === 'string' && /^(https?|ftp):\/\//i.test(u)).slice(0, 1)
    const items: Array<Record<string, unknown>> = []
    for (const url of urls) {
      try {
        items.push({url, ...(await probeLink(url))})
      } catch (error) {
        items.push({url, filename: url.split('/').pop()?.split('?')[0], error: (error as Error).message})
      }
    }
    return {items}
  },
  /** D8: the sum of a received file, to compare with the one a site gives */
  async checksum(b) {
    const file = knownPath(b.path)
    const algo = b.algo === 'sha1' || b.algo === 'md5' ? b.algo : 'sha256'
    const hash = crypto.createHash(algo)
    await new Promise<void>((resolve, reject) => fs.createReadStream(file).on('data', chunk => hash.update(chunk)).on('end', () => resolve()).on('error', reject))
    return {hex: hash.digest('hex')}
  },
  'file-rename'(b) {
    const file = knownPath(b.path)
    const name = str(b.name, 255).trim()
    if (!name || /[\\/:*?"<>|]/.test(name) || name === '.' || name === '..') throw new Error('a name without \\ / : * ? " < > |')
    const to = path.join(path.dirname(file), name)
    if (fs.existsSync(to)) throw new Error('a file with that name already rests there')
    fs.renameSync(file, to)
    madeHere.add(to)
    return {path: to}
  },
  'file-move'(b) {
    const file = knownPath(b.path)
    const folder = str(b.folder)
    if (!folder || !fs.statSync(folder).isDirectory()) throw new Error('that folder is not there')
    const to = path.join(folder, path.basename(file))
    if (fs.existsSync(to)) throw new Error('a file with that name already rests there')
    try {
      fs.renameSync(file, to)
    } catch {
      // another drive: copy, then let go of the original
      fs.copyFileSync(file, to)
      fs.rmSync(file)
    }
    madeHere.add(to)
    return {path: to}
  },
  'export-list'() {
    const text = exportLedger(exportFetches())
    const file = path.join(getConfig().folder, `axive-free-links-${new Date().toISOString().slice(0, 10)}.json`)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, text)
    madeHere.add(file)
    return {path: file, count: (JSON.parse(text) as {items: unknown[]}).items.length}
  },
  async 'import-list'() {
    const file = await bridge.pickFile('Choose a list Axive Free exported', 'Links', '*.json', getConfig().folder)
    if (!file) return {count: 0}
    const {links} = importLinks(fs.readFileSync(file, 'utf8'))
    for (const l of links) {
      if (fetchKind(l.url)) await addLink(l.url, undefined, {category: l.category, filename: l.name}).catch(() => undefined)
      else addJobs([{url: l.url, title: l.name ?? l.url.replace(/^https?:\/\/(www\.)?/, ''), choice: capChoice('best'), folder: getConfig().folder, options: {}}])
    }
    return {count: links.length}
  },
  notices() {
    return {text: NOTICES}
  },
}

// ---------------------------------------------------------------- the window

function edgePath(): string | undefined {
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean) as string[]
  return roots.map(r => path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find(p => fs.existsSync(p))
}

export async function runGui(offered?: string): Promise<number> {
  // one Axive Free per data folder: a window already open comes forward (with the link, if one came);
  // the terminal open: Axive Free moves here, every draw carried on
  const held = await openHolder()
  if (held?.kind === 'gui') {
    if (offered) await offerTo(held, offered)
    else await focusWindow(held)
    return 0
  }
  if (held && !(await takeOver(held, 'gui'))) {
    if (offered) await offerTo(held, offered)
    if (await focusWindow(held)) return 0
    await runPowerShell('Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show("Axive Free is open in its terminal window and could not move. Close it there, then open the window.", "Axive Free")', 120_000).catch(() => {})
    return 0
  }
  const movedHere = Boolean(held)
  ensureDir(paths.root)
  loadListView()
  uiStore.set(cleanUi(readJson<{ui?: unknown}>(paths.state, {}).ui))

  let server: GuiServer
  try {
    // what Free leaves to Axive has no route: asked anyway, it says where it is
    const known = new Set(Object.keys(routes))
    server = await startGuiServer(
      new Proxy(routes, {
        get: (target, name) => (typeof name === 'string' && known.has(name) ? target[name] : typeof name === 'string' && /^[a-z][a-z-]{1,40}$/.test(name) ? () => Promise.reject(axive('that comes with Axive')) : undefined),
      }),
      snapshot,
    )
  } catch (error) {
    logEvent('error', `gui: the interface could not start: ${(error as Error).message}`)
    return 1
  }
  // the next launch knocks here: the window again comes forward, the terminal asks Axive Free to move there
  let closeWindow = () => {}
  await claimWithControl('gui', {
    focus: () => void bridge.window('focus').catch(() => {}),
    // the page offers it, as if pasted: the vessels, or the download manager
    offer: url => server.broadcast('navigate', {offer: url}),
    async handover() {
      carryOver()
      await stopEngineAndWait().catch(() => {})
      closeWindow()
      server.close()
      release()
      process.exit(0)
    },
  })
  if (movedHere) say('Axive Free moved here from the terminal: every draw carries on', 'ok')

  // every change in the core reaches the window, a few times a second at most
  const pending = new Map<string, () => unknown>()
  let flushTimer: NodeJS.Timeout | undefined
  const push = (type: string, read: () => unknown) => {
    pending.set(type, read)
    flushTimer ??= setTimeout(() => {
      flushTimer = undefined
      for (const [t, r] of pending) server.broadcast(t, r())
      pending.clear()
    }, 120)
  }
  jobsStore.subscribe(() => push('jobs', () => jobsStore.get().map(slimJob)))
  fetchStore.subscribe(() => push('fetch', () => fetchStore.get()))
  configStore.subscribe(() => push('config', getConfig))
  ledgerStore.subscribe(() => push('ledger', slimLedger))
  listStore.subscribe(() => push('list', () => listStore.get()))
  uiStore.subscribe(() => push('ui', () => uiStore.get()))
  queuesStore.subscribe(() => push('queues', queuesView))
  limitsStore.subscribe(() => push('limits', () => limitsStore.get()))
  historyStore.subscribe(() => push('history', () => historyStore.get().total))
  awaitStore.subscribe(() => push('awaiting', () => awaitStore.get() ?? null))
  repairStore.subscribe(() => push('repair', () => repairStore.get()))
  setupStore.subscribe(() => push('setup', () => setupStore.get()))
  noticeStore.subscribe(() => push('notice', () => noticeStore.get()))

  // finished, failed: said once, in the window's own voice
  const told = new Set(jobsStore.get().filter(j => ['done', 'failed'].includes(j.state)).map(j => j.id))
  jobsStore.subscribe(() => {
    for (const j of jobsStore.get()) {
      if (told.has(j.id) || !['done', 'failed'].includes(j.state)) continue
      told.add(j.id)
      if (j.state === 'done') say(`received: ${j.title}`, 'ok')
      else say(`${j.error?.title ?? 'failed'}: ${j.title}`, 'error')
    }
  })

  const step = (label: string, done: number, total: number) => setupStore.set({label, done, total})
  const finish = async (code: number) => {
    try {
      await stopEngine()
    } catch {
      // the engine stops with this process anyway
    }
    server.close()
    release()
    process.exit(code)
  }

  const testing = process.env.AXIVE_GUI_NO_WINDOW === '1'
  const data = ensureDir(path.join(paths.root, 'gui'))
  let windowOpened = false
  let resolveExit: (code: number) => void = () => {}
  const exited = new Promise<number>(resolve => (resolveExit = resolve))

  const viaEdge = () => {
    const edge = edgePath()
    if (!edge) {
      logEvent('error', 'gui: neither WebView2 nor Edge was found')
      return false
    }
    spawn(edge, [`--app=${server.url}`, `--user-data-dir=${path.join(data, 'edge')}`, '--no-first-run', '--no-default-browser-check', '--disable-features=Translate'], {detached: true, stdio: 'ignore'}).unref()
    // no window to wait on: Axive Free stays while the page listens, and goes when it has been closed a while
    let quiet = 0
    let seen = false
    setInterval(() => {
      if (server.listeners() > 0) (seen = true), (quiet = 0)
      else if (seen && ++quiet >= 8) void finish(0)
      else if (!seen && ++quiet >= 60) void finish(1)
    }, 2500)
    return true
  }

  const windowExeNow = () => {
    try {
      return tools().window ?? windowExe()
    } catch {
      return windowExe()
    }
  }
  /** The window opens as soon as its own small exe is on disk: the page itself shows the rest unpacking. */
  const openWindow = () => {
    if (windowOpened || testing) return
    windowOpened = true
    const exe = windowExeNow()
    if (!exe || !IS_WIN) {
      if (!viaEdge()) resolveExit(1)
      return
    }
    const child = spawn(exe, ['--url', server.url, '--data', data, '--title', 'Axive Free'], {stdio: ['ignore', 'pipe', 'ignore'], windowsHide: false})
    closeWindow = () => void child.kill()
    child.stdout.setEncoding('utf8')
    let noRuntime = false
    child.stdout.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        try {
          if ((JSON.parse(line) as {event: string}).event === 'noruntime') noRuntime = true
        } catch {
          // not ours
        }
      }
    })
    child.on('exit', code => {
      if (noRuntime || code === 3) {
        logEvent('warn', 'gui: WebView2 is missing; opening in an Edge app window')
        if (!viaEdge()) resolveExit(1)
        return
      }
      void finish(0).then(() => resolveExit(0))
    })
  }

  // the tools: on a first launch (or a new build) the window's own exe is unpacked first, then
  // the window opens and shows the rest arriving; on every other launch it opens at once
  const ready = (async () => {
    try {
      for (;;) {
        try {
          if (needsSetup()) {
            step('the window', 0, 1)
            await installTools(['window'], step)
            openWindow()
            await installTools(payloadNamesExcept('window'), step, {complete: true})
            setupStore.set(undefined)
          } else {
            // the window exe starts before the full check: its own hash first, else the check restores it
            if (!itemIntact('window', windowExe())) await checkTools().catch(error => logEvent('error', (error as Error).message))
            openWindow()
          }
          break
        } catch (error) {
          setupStore.set({error: (error as Error).message})
          openWindow()
          logEvent('error', `gui: the tools would not unpack: ${(error as Error).message}`)
          if (testing) return false
          // the page offers another try: an antivirus that held a file has usually let go by then
          await new Promise<void>(resolve => (retrySetup = resolve))
          step('the tools', 0, 1)
        }
      }
      forgetTools()
      resolveTools()
      // every tool is hashed in the background from here; nothing runs one until it passes
      const checked = checkTools()
      checked.catch(error => logEvent('error', (error as Error).message))
      if (hostIntact(tools().host)) bridge.start(tools().host)
      else await checked.then(() => bridge.start(tools().host), () => undefined)
      restoreQueue()
      resumeLeftovers()
      if (offered) server.broadcast('navigate', {offer: offered})
      return true
    } catch (error) {
      setupStore.set({error: (error as Error).message})
      openWindow()
      return false
    }
  })()

  // tests and screenshots drive the page from a browser of their own: no window
  if (testing) {
    await ready
    process.stdout.write(`${server.url}\n`)
    return new Promise<number>(() => {})
  }
  return exited
}
