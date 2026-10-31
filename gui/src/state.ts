import {useRef, useSyncExternalStore} from 'react'
import {plain, setLanguage, setPlainWords} from '../../src/core/words.js'

// what the core sends (src/gui/main.ts, snapshot); kept loose where the window only reads
export type Job = {
  id: string
  url: string
  title: string
  site?: string
  uploader?: string
  thumbnail?: string
  vessel: string
  kind: string
  folder: string
  state: 'queued' | 'held' | 'running' | 'paused' | 'done' | 'skipped' | 'failed' | 'cancelled'
  stage?: string
  progress?: {done: number; total?: number; speed?: number; eta?: number; part: number; parts: number}
  error?: {title: string; detail: string; remedies: string[]; raw: string}
  filepath?: string
  size?: number
  createdAt: number
  finishedAt?: number
  startAt?: number
  retryAt?: number
  groupLabel?: string
  queueId?: string
  category?: string
  limit?: string
  openWhenDone?: boolean
  showWhenDone?: boolean
  /** it wrote partial files that a delete may take along */
  partial?: boolean
}
export type FetchItem = {
  gid: string
  kind: 'file' | 'torrent' | 'magnet'
  name: string
  state: string
  total: number
  done: number
  speed: number
  upload: number
  connections: number
  seeders?: number
  target?: string
  dir: string
  error?: string
  metadata?: boolean
  map?: string
  edges?: number[]
  pieces?: number
  pieceSize?: number
  smooth?: number
  eta?: number
  warning?: string
  uri?: string
  held?: boolean
  wanted?: number
  queueId?: string
  category?: string
  limit?: string
  awaiting?: boolean
  addedAt?: number
  openWhenDone?: boolean
  showWhenDone?: boolean
  verdict?: string
}

/** Open the convert panel for a file Axive made (the draw view picks it up). */
export const convertFile = (path?: string) => path && window.dispatchEvent(new CustomEvent('axive-convert', {detail: path}))

/** Hand a finished file to the Telegram bot; with no bot linked yet, the three linking steps open first. */
export const sendToTelegram = (path?: string) =>
  path &&
  (!state.config.telegramToken || !state.config.telegramChat
    ? void window.dispatchEvent(new CustomEvent('axive-telegram', {detail: {file: path}}))
    : void attempt(async () => {
        say('sending to telegram…')
        const r = await call<{sent: 'file' | 'message'; needsApi?: boolean}>('telegram-send', {path})
        say(r.sent === 'file' ? 'sent to telegram' : r.needsApi ? 'over 50 MB: telegram got the path. for the file itself, add an api_id and api_hash in settings › notifications' : 'over 2 GB: telegram got the path instead', r.sent === 'file' ? 'ok' : 'warn')
      }))

/** The Telegram linking steps, with nothing to send after (settings › notifications). */
export const linkTelegram = () => window.dispatchEvent(new CustomEvent('axive-telegram', {detail: {}}))

export type LedgerEntry = {id: string; url: string; title: string; site?: string; uploader?: string; filepath?: string; size?: number; vessel?: string; at: number; exists: boolean; thumbnail?: string; category?: string}
export type Vigil = {id: string; url: string; title: string; folder: string; vessel: string; maxHeight: number; added: number; lastCheck?: number; lastNew?: number}
export type Task = {id: string; kind: string; file: string; label: string; fraction: number; state: 'running' | 'done' | 'failed'; output?: string; error?: string}
export type Repair = {state: 'idle' | 'checking' | 'repairing' | 'done' | 'failed'; carries: boolean; health?: {name: string; ok: boolean; reason?: string}[]; label?: string; done?: number; total?: number; error?: string}
export type Meta = {kind: 'bool' | 'enum' | 'int' | 'string' | 'list' | 'json'; label: string; help: string; options?: string[]; min?: number; max?: number; secret?: boolean; section?: string}
export type Phone = {on: boolean; starting: boolean; lanUrl?: string; pairUrl?: string; svg?: string; rows?: string[]; network?: {name: string; category?: string}; note?: string; firewall?: 'open' | 'closed' | 'unknown'; firewallWhy?: 'no-rule' | 'other-port' | 'blocked' | 'policy'; guards?: string[]; answers?: boolean; seenAt?: number; checkedAt?: number; checking?: boolean; error?: string}
export type Schedule = {on: boolean; days: number[]; start?: string; stop?: string}
export type Queue = {id: string; name: string; maxConcurrent: number; speedLimit: string; schedule: Schedule; after: 'none' | 'notify' | 'quit' | 'sleep' | 'hibernate' | 'shutdown'; open?: boolean; running?: number; pending?: number; nextStart?: number; nextStop?: number}
export type Category = {id: string; name: string; exts: string[]; patterns: string[]; folder: string}
export type HostRule = {host: string; connections?: number; speedLimit?: string; userAgent?: string; referer?: string; user?: string; hasPassword?: boolean}
export type Power = {action: 'quit' | 'sleep' | 'hibernate' | 'shutdown'; at: number; queueId?: string}
export type Limits = {profile: string; global: number; present?: boolean; busy?: boolean}

export type State = {
  connected: boolean
  version: string
  setup?: {label: string; done: number; total: number} | {error: string} | null
  licence: {state: 'licensed' | 'unlicensed'; key?: string; reason?: string}
  config: Record<string, unknown>
  meta: Record<string, Meta>
  jobs: Job[]
  fetch: {running: boolean; starting: boolean; error?: string; items: FetchItem[]}
  offerings: {url: string; from: 'remote' | 'ghost' | 'browser'; at: number}[]
  ledger: LedgerEntry[]
  /** what the list keeps of earlier sessions: received rows after clearedAt, minus the hidden ones */
  list?: {clearedAt: number; hidden: string[]}
  /** how the window was left (its page, the list's sort, the last vessel), kept by the core */
  ui?: Record<string, string | number | boolean>
  vigils: Vigil[]
  ghost: {on: boolean; available: boolean; chimePausedUntil?: number}
  remote: {running: boolean; url?: string; lanUrl?: string; error?: string}
  phone: Phone
  /** the browser extension's door: open, its port, a browser asking to pair, the paired ones */
  door?: {running: boolean; port: number; error?: string; pending?: {id: string; browser: string; at: number}; paired: {id: string; browser: string; at: number; lastSeen?: number}[]}
  queues?: Queue[]
  power?: Power | null
  limits?: Limits
  history?: number[]
  awaiting?: {gid: string} | null
  tasks: Task[]
  repair?: Repair
  recent: string[]
  notice?: {id: number; text: string; tone: 'info' | 'ok' | 'warn' | 'error'} | null
  host: boolean
  navigate?: {offer: string; at: number}
}

let state: State = {
  connected: false,
  version: '',
  licence: {state: 'licensed'},
  config: {},
  meta: {},
  jobs: [],
  fetch: {running: false, starting: false, items: []},
  offerings: [],
  ledger: [],
  vigils: [],
  ghost: {on: false, available: false},
  remote: {running: false},
  phone: {on: false, starting: false},
  tasks: [],
  recent: [],
  host: false,
}
const listeners = new Set<() => void>()
const set = (patch: Partial<State>) => {
  state = {...state, ...patch}
  setPlainWords(Boolean(state.config.plainWords))
  setLanguage(state.config.language === 'nl' ? 'nl' : 'en')
  if ('jobs' in patch || 'fetch' in patch) sample()
  for (const l of [...listeners]) l()
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))
/** A part of the state; the same part object until the state itself changes (selectors may build arrays). */
export function useAxive<T>(select: (s: State) => T): T {
  const cache = useRef<{s?: State; sel?: unknown; v?: T}>({})
  return useSyncExternalStore(subscribe, () => {
    const c = cache.current
    if (c.s === state && c.sel === select) return c.v as T
    const v = select(state)
    cache.current = {s: state, sel: select, v}
    return v
  })
}
export const current = () => state

// ---------------------------------------------------------------- 60 s of speed, kept by the window
// The core sends a ring of its own (`history`) once its history module is in; until then, and per
// item, the window samples what it is sent once a second. Newest last.
export const HISTORY = 60
const rings = new Map<string, number[]>()
let lastSample = 0
function sample(): void {
  const now = Date.now()
  if (now - lastSample < 900) return
  lastSample = now
  const live = new Set<string>()
  const put = (id: string, v: number) => {
    live.add(id)
    const ring = rings.get(id) ?? []
    ring.push(v)
    if (ring.length > HISTORY) ring.splice(0, ring.length - HISTORY)
    rings.set(id, ring)
  }
  let total = 0
  for (const j of state.jobs) if (j.state === 'running') (put(`job:${j.id}`, j.progress?.speed ?? 0), (total += j.progress?.speed ?? 0))
  for (const f of state.fetch.items) if (f.state === 'active') (put(`fetch:${f.gid}`, f.smooth ?? f.speed), (total += f.smooth ?? f.speed))
  put('total', total)
  for (const id of rings.keys()) if (!live.has(id) && id !== 'total') rings.delete(id)
}
/** A copy of the ring, oldest first, padded with nothing on the left. */
export const historyOf = (id: string): number[] => (id === 'total' && state.history?.length ? state.history.slice(-HISTORY) : [...(rings.get(id) ?? [])])
setInterval(() => {
  // nothing arrives while all is still: the ring keeps moving at zero
  lastSample = 0
  sample()
}, 1000)

/** One event stream from the core: the whole state once, then each part as it changes. */
export function connect(): void {
  const source = new EventSource('/api/events')
  // "undefined" from an older core means the part is gone: never a reason to keep the old one
  const read = (e: Event) => {
    const data = (e as MessageEvent).data as string
    return data === 'undefined' ? null : JSON.parse(data)
  }
  source.addEventListener('state', e => set({...(read(e) as State), connected: true}))
  for (const part of ['jobs', 'fetch', 'config', 'ledger', 'list', 'ui', 'offerings', 'vigils', 'ghost', 'remote', 'phone', 'door', 'queues', 'power', 'limits', 'history', 'awaiting', 'tasks', 'repair', 'setup', 'licence', 'notice', 'recent'] as const) {
    source.addEventListener(part, e => {
      try {
        set({[part]: read(e)} as Partial<State>)
      } catch {
        // one malformed part never stops the others
      }
    })
  }
  source.addEventListener('navigate', e => set({navigate: {...JSON.parse((e as MessageEvent).data), at: Date.now()}}))
  source.onerror = () => set({connected: false})
}

/** Ask the core to do something. Errors come back as the core's own sentence. */
export async function call<T = Record<string, unknown>>(route: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Axive': '1'}, body: JSON.stringify(body)})
  const data = (await res.json().catch(() => ({}))) as T & {error?: string}
  if (res.status === 404) throw new Error('this part of Axive is not here yet')
  if (!res.ok) throw new Error(data.error ?? `${res.status}`)
  return data
}

/** A notice raised by the window itself (the core raises its own). */
export function say(text: string, tone: NonNullable<State['notice']>['tone'] = 'info'): void {
  set({notice: {id: Date.now(), text, tone}})
}

/** Every word on screen: the house's, or everyday ones (Simple Language). */
export const t = (text: string) => plain(text)

/** Calls that report their own failure as a notice. */
export async function attempt<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work()
  } catch (error) {
    say((error as Error).message, 'error')
    return undefined
  }
}

export const setConfig = (patch: Record<string, unknown>) => void attempt(() => call('config', {patch}))

/** Remember how the window is left (kept by the core, so the next start opens the same way). */
export function remember(patch: Record<string, string | number | boolean>): void {
  const ui = state.ui ?? {}
  if (Object.entries(patch).every(([k, v]) => ui[k] === v)) return
  set({ui: {...ui, ...patch}})
  void call('ui-set', {patch}).catch(() => {})
}
/** One thing the window remembered, or its usual value. */
export function recalled<T extends string | number | boolean>(key: string, fallback: T): T {
  const v = state.ui?.[key]
  return (typeof v === typeof fallback ? v : fallback) as T
}

/** The queues: the core's, or the one queue there always was (main, its count the old tunnels). */
export function queuesOf(s: State): Queue[] {
  if (s.queues?.length) return s.queues
  const fromConfig = s.config.queues as Queue[] | undefined
  if (Array.isArray(fromConfig) && fromConfig.length) return fromConfig
  return [{id: 'main', name: 'main', maxConcurrent: Number(s.config.tunnels ?? 2), speedLimit: '', schedule: {on: false, days: [0, 1, 2, 3, 4, 5, 6]}, after: 'none'}]
}
export const categoriesOf = (s: State): Category[] => (Array.isArray(s.config.categories) ? (s.config.categories as Category[]) : [])
