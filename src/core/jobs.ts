import {spawn} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {getConfig} from './config.js'
import {backoffMs, classify, type Classified} from './errors.js'
import {record} from './ledger.js'
import {logEvent, writeReport} from './log.js'
import {addSpeedSource} from './history.js'
import {currentGlobalLimit} from './limits.js'
import {paths, readJson, writeFileAtomic} from './paths.js'
import {evaluateQueues, freeSlots, queueIdFor, registerMember} from './queues.js'
import {openPath, revealPath} from './reveal.js'
import {createStore} from './store.js'
import {tools} from './tools.js'
import {
  CancelledError,
  ToolError,
  download,
  removePartials,
  type DownloadChoice,
  type DownloadProgress,
  type DrawOptions,
} from './ytdlp.js'

export type JobState = 'queued' | 'held' | 'running' | 'paused' | 'done' | 'skipped' | 'failed' | 'cancelled'

export type Job = {
  id: string
  url: string
  title: string
  site?: string
  videoId?: string
  uploader?: string
  thumbnail?: string
  choice: DownloadChoice
  folder: string
  options: DrawOptions
  /** a probe's metadata, so the draw starts at once (single draws only) */
  infoJsonPath?: string
  state: JobState
  progress?: DownloadProgress
  stage?: string
  attempt: number
  retryAt?: number
  error?: Classified
  report?: string
  filepath?: string
  size?: number
  createdAt: number
  finishedAt?: number
  // -- 1.4
  /** the line it waits and runs in (Free keeps one: main) */
  queueId?: string
  /** category id for the ledger (videos, music) */
  category?: string
  // -- 2.4
  /** the files yt-dlp wrote to so far: a paused or cancelled draw's partial files, to keep or delete */
  partials?: string[]
}

export type NewJob = Omit<Job, 'id' | 'state' | 'attempt' | 'createdAt'>

export const jobsStore = createStore<Job[]>([])

const controllers = new Map<string, AbortController>()
let pumpTimer: NodeJS.Timeout | undefined
const ACTIVE: JobState[] = ['queued', 'running', 'paused']

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

function update(id: string, patch: Partial<Job>): void {
  jobsStore.set(jobs => jobs.map(job => (job.id === id ? {...job, ...patch} : job)))
}

export const getJob = (id: string) => jobsStore.get().find(job => job.id === id)

export function addJobs(items: NewJob[]): Job[] {
  const now = Date.now()
  const created = items.map<Job>(item => ({
    ...item,
    id: newId(),
    state: 'queued',
    attempt: 0,
    createdAt: now,
    queueId: queueIdFor(item.queueId),
  }))
  jobsStore.set(jobs => [...jobs, ...created])
  persist()
  pump()
  return created
}

/** Start as many queued draws as the line has room for (its room is shared with the fetches); wake again for retrying ones. */
export function pump(): void {
  if (pumpTimer) {
    clearTimeout(pumpTimer)
    pumpTimer = undefined
  }
  const now = Date.now()
  const current = jobsStore.get()
  const free = new Map<string, number>()
  for (const job of current) {
    if (job.state !== 'queued' || (job.retryAt && job.retryAt > now)) continue
    const q = queueIdFor(job.queueId)
    if (!free.has(q)) free.set(q, freeSlots(q))
    if (free.get(q)! <= 0) continue
    free.set(q, free.get(q)! - 1)
    void runJob(job.id)
  }
  // the next moment something becomes runnable
  const waits = jobsStore
    .get()
    .flatMap(job => (job.state === 'queued' && job.retryAt ? [job.retryAt] : []))
  if (waits.length) pumpTimer = setTimeout(pump, Math.max(250, Math.min(...waits) - now + 50))
}

async function runJob(id: string): Promise<void> {
  const job = getJob(id)
  if (!job) return
  const controller = new AbortController()
  controllers.set(id, controller)
  const attempt = job.attempt + 1
  update(id, {state: 'running', stage: 'opening', attempt, error: undefined, retryAt: undefined, progress: undefined})
  evaluateQueues()
  const handlers = {
    onProgress: (progress: DownloadProgress) => update(id, {progress, stage: 'descending'}),
    onProcessing: () => update(id, {stage: 'binding'}),
    onDestination: (file: string) => {
      const known = getJob(id)?.partials ?? []
      if (!known.includes(file)) update(id, {partials: [...known, file].slice(-8)})
    },
  }
  try {
    const t = tools()
    let filepath: string | undefined
    let skipped = false
    const choice = job.choice
    {
      const infoJson = job.infoJsonPath && fs.existsSync(job.infoJsonPath) ? job.infoJsonPath : undefined
      const base = {tools: t, url: job.url, choice, outDir: job.folder, job: id, extraArgs: limitArgs()}
      let result
      try {
        result = await download({...base, infoJsonPath: infoJson}, handlers, controller.signal)
      } catch (error) {
        if (controller.signal.aborted || !infoJson) throw error
        // media links inside the cached probe expire: draw once more from a fresh look
        update(id, {stage: 'the link went cold, drawing a fresh one', progress: undefined})
        result = await download(base, handlers, controller.signal)
      }
      filepath = result.filepath
      skipped = Boolean(result.skipped)
    }

    if (skipped) {
      update(id, {state: 'skipped', stage: 'drawn before · skipped', finishedAt: Date.now()})
      return
    }
    let size: number | undefined
    try {
      size = filepath ? fs.statSync(filepath).size : undefined
    } catch {
      size = undefined
    }
    // batch items start out named by their link; the file knows the real title
    const named = filepath && /^[\w.-]+\.[a-z]{2,}\//i.test(job.title) ? path.basename(filepath, path.extname(filepath)) : undefined
    update(id, {state: 'done', stage: 'received', filepath, size, finishedAt: Date.now(), progress: undefined, ...(named ? {title: named} : {})})
    const done = getJob(id)!
    record({url: done.url, title: done.title, site: done.site, videoId: done.videoId, uploader: done.uploader, filepath, size, vessel: choice.label, category: done.category ?? categoryOfChoice(choice.kind)})
  } catch (error) {
    const reason = controller.signal.reason as {pause?: boolean} | undefined
    if (controller.signal.aborted || error instanceof CancelledError) {
      update(id, reason?.pause ? {state: 'paused', stage: 'paused'} : {state: 'cancelled', stage: 'cancelled', finishedAt: Date.now()})
      return
    }
    const classified = classify(error)
    const latest = getJob(id)!
    if (classified.transient && latest.attempt <= getConfig().retries) {
      const wait = backoffMs(latest.attempt, classified.kind)
      update(id, {state: 'queued', stage: `${classified.title} · trying again`, retryAt: Date.now() + wait, error: classified})
      logEvent('warn', `retrying ${latest.url} in ${Math.round(wait / 1000)}s: ${classified.raw}`)
      return
    }
    const report = writeReport({
      title: `draw failed: ${latest.title}`,
      kind: classified.kind,
      url: latest.url,
      command: error instanceof ToolError ? error.command : undefined,
      stderr: error instanceof ToolError ? error.stderr : String((error as Error)?.stack ?? error),
      details: {vessel: latest.choice.label, attempt: String(latest.attempt), stage: latest.stage},
    })
    logEvent('error', `${latest.url}: ${classified.kind}: ${classified.raw}`)
    update(id, {state: 'failed', stage: classified.title, error: classified, report, finishedAt: Date.now(), progress: undefined})
  } finally {
    controllers.delete(id)
    persist()
    pump()
    evaluateQueues()
  }
}

const categoryOfChoice = (kind: string) => (kind === 'audio' ? 'music' : kind === 'video' ? 'videos' : undefined)

/** yt-dlp's --limit-rate for a draw starting now: the one speed limit, shared by what runs (ytdlp.ts adds none itself) */
function limitArgs(): string[] {
  const limit = currentGlobalLimit()
  return limit ? ['--limit-rate', String(limit)] : []
}

registerMember('job', {
  running: queueId => jobsStore.get().filter(j => j.state === 'running' && queueIdFor(j.queueId) === queueId).length,
  pending: queueId => jobsStore.get().filter(j => (j.state === 'running' || j.state === 'queued') && queueIdFor(j.queueId) === queueId).length,
  changed: () => pump(),
})

addSpeedSource('job', () => jobsStore.get().reduce((sum, j) => sum + (j.state === 'running' ? (j.progress?.speed ?? 0) : 0), 0))

// ---------------------------------------------------------------------------
// controls

export function pauseJob(id: string): void {
  const job = getJob(id)
  if (!job) return
  if (job.state === 'running') controllers.get(id)?.abort({pause: true, keepPartials: true})
  else if (job.state === 'queued') update(id, {state: 'paused', stage: 'paused'})
  persist()
}

export function resumeJob(id: string): void {
  const job = getJob(id)
  if (!job || (job.state !== 'paused' && job.state !== 'failed' && job.state !== 'cancelled')) return
  update(id, {state: 'queued', stage: 'waiting', retryAt: undefined, attempt: job.state === 'failed' ? 0 : job.attempt})
  persist()
  pump()
}

/**
 * Stop a draw for good. Its partial files go, unless `keepFiles` (the owner chose to keep
 * what arrived): a running draw's are known to yt-dlp, a paused one's were noted as it ran.
 */
export function cancelJob(id: string, {keepFiles = false}: {keepFiles?: boolean} = {}): void {
  const job = getJob(id)
  if (!job) return
  if (job.state === 'running') controllers.get(id)?.abort({keepPartials: keepFiles})
  else if (ACTIVE.includes(job.state)) {
    update(id, {state: 'cancelled', stage: 'cancelled', finishedAt: Date.now()})
    if (!keepFiles && job.partials?.length) void removePartials(job.partials)
  }
  persist()
}

/** Move a waiting draw to the front of the queue. */
export function prioritize(id: string): void {
  jobsStore.set(jobs => {
    const job = jobs.find(j => j.id === id)
    if (!job) return jobs
    return [job, ...jobs.filter(j => j.id !== id)]
  })
  persist()
  pump()
}

export function removeJob(id: string): void {
  const job = getJob(id)
  if (!job) return
  if (job.state === 'running') cancelJob(id)
  jobsStore.set(jobs => jobs.filter(j => j.id !== id))
  persist()
}

export function clearFinished(): void {
  jobsStore.set(jobs => jobs.filter(job => ACTIVE.includes(job.state)))
}

export function pauseAll(): void {
  for (const job of jobsStore.get()) if (job.state === 'running' || job.state === 'queued') pauseJob(job.id)
}

export function resumeAll(): void {
  for (const job of jobsStore.get()) if (job.state === 'paused') resumeJob(job.id)
}

export const activeCount = (jobs: Job[]) => jobs.filter(job => job.state === 'running' || job.state === 'queued').length

// ---------------------------------------------------------------------------
// surviving a restart: unfinished draws come back paused, to be resumed

type Saved = Omit<Job, 'progress' | 'infoJsonPath'>

export function persist(): void {
  const keep: Saved[] = jobsStore
    .get()
    .filter(job => ACTIVE.includes(job.state))
    .map(({progress: _progress, infoJsonPath: _info, ...job}) => ({...job, state: 'paused'}))
  try {
    if (keep.length) writeFileAtomic(paths.queue, JSON.stringify(keep))
    else fs.rmSync(paths.queue, {force: true})
  } catch {
    // best effort
  }
}

export function restoreQueue(): number {
  const saved = readJson<Saved[]>(paths.queue, [])
  if (!Array.isArray(saved) || !saved.length) return 0
  const restored: Job[] = saved
    .filter(job => job && typeof job.url === 'string' && job.choice && typeof job.folder === 'string')
    .map(job => ({...job, state: 'paused', stage: 'paused', attempt: 0}))
  jobsStore.set(jobs => [...jobs, ...restored])
  pump()
  return restored.length
}

