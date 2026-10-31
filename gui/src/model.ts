import {formatBytes, formatEta, formatSpeed} from '../../src/core/format.js'
import {categoriesOf, type Category, type FetchItem, type Job, type LedgerEntry, type State, type Task} from './state.js'

/**
 * One list for everything in flight: a yt-dlp draw (a job), a download
 * manager file, torrent or magnet (a fetch) and a convert/trim/distill task
 * become rows of the same shape, so the list can filter, sort and select
 * them together. What earlier sessions received comes back from the ledger
 * as received rows (kind 'past'), so the list, its filters and its categories
 * look the same after a restart. The originals ride along for the detail panel.
 */

/** ABDM's status grammar, in Axive's words: drawing, held, failed, preparing, received. */
export type Status = 'drawing' | 'preparing' | 'held' | 'failed' | 'received' | 'seeding'
export type Row = {
  key: string
  kind: 'job' | 'fetch' | 'task' | 'past'
  id: string
  name: string
  status: Status
  word: string
  detail: string
  size?: number
  done: number
  fraction?: number
  speed: number
  eta?: number
  added: number
  queueId: string
  category: string
  glyph: string
  thumb?: string
  file?: string
  folder?: string
  map?: string
  /** where it came from */
  url?: string
  job?: Job
  fetch?: FetchItem
  task?: Task
  past?: LedgerEntry
}

const ext = (name: string) => /\.([a-z0-9]{1,6})$/i.exec(name)?.[1]?.toLowerCase() ?? ''

export function categoryOf(name: string, cats: Category[], given?: string): string {
  if (given && cats.some(c => c.id === given)) return given
  const e = ext(name)
  return cats.find(c => c.exts.includes(e))?.id ?? (cats.length ? 'other' : '')
}

export function jobStatus(j: Job): {status: Status; word: string; detail: string} {
  const p = j.progress
  switch (j.state) {
    case 'running':
      if (j.stage === 'binding') return {status: 'preparing', word: 'binding', detail: 'binding…'}
      if (!p) return {status: 'preparing', word: 'preparing', detail: `${j.stage ?? 'opening'}…`}
      return {status: 'drawing', word: 'drawing', detail: [p.parts > 1 ? `part ${p.part + 1}/${p.parts}` : '', p.total ? `${formatBytes(p.done)} of ${formatBytes(p.total)}` : formatBytes(p.done)].filter(Boolean).join(' · ')}
    case 'queued':
      return {status: 'held', word: 'waiting', detail: j.retryAt ? `retrying in ${Math.max(1, Math.round((j.retryAt - Date.now()) / 1000))}s` : 'waiting for a free tunnel…'}
    case 'held':
      return {status: 'held', word: 'held', detail: j.startAt ? `held until ${new Date(j.startAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}` : 'held'}
    case 'paused':
      return {status: 'held', word: 'paused', detail: 'paused · the partial file waits'}
    case 'done':
      return {status: 'received', word: 'received', detail: j.vessel.replace(/ · ~.*$/, '')}
    case 'skipped':
      return {status: 'received', word: 'drawn before', detail: 'drawn before'}
    case 'failed':
      return {status: 'failed', word: 'failed', detail: j.error?.title ?? 'failed'}
    case 'cancelled':
      return {status: 'failed', word: 'cancelled', detail: 'cancelled'}
  }
}

export function fetchStatus(f: FetchItem): {status: Status; word: string; detail: string} {
  const who = f.kind === 'file' ? `${f.connections} connection${f.connections === 1 ? '' : 's'}` : `${f.connections} peer${f.connections === 1 ? '' : 's'}`
  switch (f.state) {
    case 'active':
      if (f.metadata) return {status: 'preparing', word: 'preparing', detail: f.connections ? `reading the magnet · ${who}…` : 'reading the magnet · looking for peers…'}
      if (!f.total && !f.done) return {status: 'preparing', word: 'preparing', detail: `opening · ${who}`}
      return {status: 'drawing', word: 'drawing', detail: [f.total ? `${formatBytes(f.done)} of ${formatBytes(f.total)}` : formatBytes(f.done), f.wanted && f.wanted < f.connections ? `${who}, stepping to ${f.wanted}` : who].join(' · ')}
    case 'seeding':
      return {status: 'seeding', word: 'sharing', detail: `received · sharing ${formatSpeed(f.upload) || 'quietly'}`}
    case 'waiting':
      if (f.held && !f.awaiting) return {status: 'held', word: 'held', detail: 'waiting for its tunnel to open'}
      return {status: 'held', word: 'waiting', detail: f.awaiting ? 'waiting for a fresh link from the browser' : 'waiting its turn'}
    case 'paused':
      return {status: 'held', word: 'paused', detail: `paused${f.total ? ` at ${Math.floor((f.done / f.total) * 100)}%` : ''}`}
    case 'done':
      return {status: 'received', word: 'received', detail: f.kind === 'file' ? 'file' : f.kind}
    case 'failed':
      return {status: 'failed', word: 'failed', detail: f.error ?? 'failed'}
    default:
      return {status: 'failed', word: 'removed', detail: 'removed'}
  }
}

export function rowsOf(s: State): Row[] {
  const cats = categoriesOf(s)
  const rows: Row[] = []
  for (const j of s.jobs) {
    const st = jobStatus(j)
    const total = j.progress?.total ?? j.size
    rows.push({
      key: `job:${j.id}`,
      kind: 'job',
      id: j.id,
      name: j.title,
      ...st,
      size: total,
      done: j.progress?.done ?? (j.state === 'done' ? j.size ?? 0 : 0),
      fraction: j.state === 'done' || j.state === 'skipped' ? 1 : j.progress?.total ? j.progress.done / j.progress.total : undefined,
      speed: j.state === 'running' ? j.progress?.speed ?? 0 : 0,
      eta: j.state === 'running' ? j.progress?.eta : undefined,
      added: j.createdAt,
      queueId: j.queueId ?? 'main',
      category: j.category ?? (cats.length ? (j.kind === 'audio' ? 'music' : j.kind === 'video' ? 'videos' : 'documents') : ''),
      glyph: j.kind === 'audio' ? '♪' : j.kind === 'video' ? '▶' : '¶',
      thumb: j.thumbnail,
      file: j.filepath,
      folder: j.folder,
      url: j.url,
      job: j,
    })
  }
  for (const f of s.fetch.items) {
    if (f.state === 'removed') continue
    const st = fetchStatus(f)
    rows.push({
      key: `fetch:${f.gid}`,
      kind: 'fetch',
      id: f.gid,
      name: f.name,
      ...st,
      size: f.total || undefined,
      done: f.done,
      fraction: f.state === 'done' || f.state === 'seeding' ? 1 : f.total ? f.done / f.total : undefined,
      speed: f.state === 'active' ? f.smooth ?? f.speed : 0,
      eta: f.state === 'active' ? f.eta : undefined,
      added: f.addedAt ?? 0,
      queueId: f.queueId ?? 'main',
      category: categoryOf(f.name, cats, f.category),
      glyph: f.kind === 'file' ? '◇' : '⁂',
      file: f.target,
      folder: f.dir,
      map: f.map,
      url: f.uri,
      fetch: f,
    })
  }
  for (const k of s.tasks) {
    rows.push({
      key: `task:${k.id}`,
      kind: 'task',
      id: k.id,
      name: k.label,
      status: k.state === 'running' ? 'drawing' : k.state === 'done' ? 'received' : 'failed',
      word: k.state === 'running' ? k.kind : k.state === 'done' ? 'received' : 'failed',
      detail: k.state === 'failed' ? k.error ?? 'failed' : k.kind,
      done: 0,
      fraction: k.fraction,
      speed: 0,
      added: 0,
      queueId: 'main',
      category: '',
      glyph: '∿',
      file: k.output,
      task: k,
    })
  }
  rows.push(...pastRows(s, rows, cats))
  return rows
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p
const folderOf = (p: string) => p.slice(0, Math.max(0, p.length - baseName(p).length - 1))

/** Received in earlier sessions (the ledger), unless shown live already, cleared, or hidden. */
function pastRows(s: State, live: Row[], cats: Category[]): Row[] {
  const files = new Set(live.map(r => r.file?.toLowerCase()).filter(Boolean))
  const urls = new Set(live.map(r => r.url).filter(Boolean))
  const since = s.list?.clearedAt ?? 0
  const hidden = new Set(s.list?.hidden ?? [])
  const out: Row[] = []
  for (const e of s.ledger) {
    if (e.at <= since || hidden.has(e.id)) continue
    if (e.filepath ? files.has(e.filepath.toLowerCase()) : urls.has(e.url)) continue
    const file = e.filepath ? baseName(e.filepath) : ''
    const audio = /^(mp3|m4a|opus|flac|wav|ogg|aac)$/i.test(ext(file)) || /audio|mp3|m4a/i.test(e.vessel ?? '')
    const fetched = e.vessel === 'file' || e.vessel === 'torrent'
    out.push({
      key: `past:${e.id}`,
      kind: 'past',
      id: e.id,
      name: e.title || file || e.url,
      status: 'received',
      word: e.exists ? 'received' : 'moved or deleted',
      detail: [new Date(e.at).toLocaleDateString([], {day: 'numeric', month: 'short'}), e.vessel && !fetched ? e.vessel.replace(/ · ~.*$/, '') : fetched ? e.vessel : ''].filter(Boolean).join(' · '),
      size: e.size,
      done: e.size ?? 0,
      fraction: 1,
      speed: 0,
      added: e.at,
      queueId: 'main',
      category: categoryOf(file, cats, e.category) || (cats.length ? (audio ? 'music' : 'videos') : ''),
      glyph: fetched ? '◇' : audio ? '♪' : '▶',
      thumb: e.thumbnail,
      file: e.exists ? e.filepath : undefined,
      folder: e.filepath ? folderOf(e.filepath) : undefined,
      url: e.url,
      past: e,
    })
  }
  return out
}

export type Filter = 'all' | 'active' | 'held' | 'received' | 'failed'
export const FILTERS: Array<{id: Filter; label: string; hint: string}> = [
  {id: 'all', label: 'everything', hint: 'every draw, file and torrent'},
  {id: 'active', label: 'drawing', hint: 'moving now, or getting ready'},
  {id: 'held', label: 'held', hint: 'paused, waiting their turn, or held by the clock'},
  {id: 'received', label: 'received', hint: 'finished: open, show, convert, send'},
  {id: 'failed', label: 'failed', hint: 'what went wrong, and what to do'},
]
export const inFilter = (r: Row, f: Filter) =>
  f === 'all' ? true : f === 'active' ? r.status === 'drawing' || r.status === 'preparing' : f === 'held' ? r.status === 'held' : f === 'received' ? r.status === 'received' || r.status === 'seeding' : r.status === 'failed'

export const SORT_KEYS = ['name', 'size', 'progress', 'speed', 'eta', 'added', 'status'] as const
export type SortKey = (typeof SORT_KEYS)[number]
const STATUS_ORDER: Record<Status, number> = {drawing: 0, preparing: 1, held: 2, failed: 3, seeding: 4, received: 5}
export function sortRows(rows: Row[], key: SortKey, dir: 1 | -1): Row[] {
  const v = (r: Row): number | string => {
    switch (key) {
      case 'name':
        return r.name.toLowerCase()
      case 'size':
        return r.size ?? -1
      case 'progress':
        return r.fraction ?? -1
      case 'speed':
        return r.speed
      case 'eta':
        return r.eta ?? Number.MAX_SAFE_INTEGER
      case 'added':
        return r.added
      default:
        return STATUS_ORDER[r.status]
    }
  }
  return [...rows].sort((a, b) => {
    const x = v(a)
    const y = v(b)
    const c = x < y ? -1 : x > y ? 1 : 0
    return c * dir || STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.added - a.added
  })
}

export const speedText = (n: number) => formatSpeed(n) || ''
export const etaText = (s?: number) => (s ? formatEta(s) : '')
export const sizeText = (n?: number) => (n ? formatBytes(n) : '')
