import {getConfig} from './config.js'
import {logEvent} from './log.js'
import {createStore} from './store.js'

/**
 * The one line of work Axive Free keeps: yt-dlp draws (jobs.ts) and aria2
 * fetches (fetcher.ts) share it, and `tunnels` in the settings says how many
 * run at once. (Named queues with their own hours, limits and after-actions
 * are Axive's, not Free's.)
 *
 * This module knows neither jobs nor fetches: each registers as a member and
 * answers how much work it holds. That keeps imports one way.
 */

export const MAIN_QUEUE = 'main'
export type Queue = {id: string; name: string; maxConcurrent: number; speedLimit: string}
export type ItemKind = 'job' | 'fetch'

export type QueueMember = {
  /** items running now */
  running(queueId: string): number
  /** items still to do (running, waiting their turn, retrying); not paused by hand */
  pending(queueId: string): number
  /** the line changed: start what may start */
  changed(): void
  /** a speed limit for one item ('' for none) */
  limit?(id: string, limit: string): boolean
}

export type CompletionFlags = {openWhenDone?: boolean; showWhenDone?: boolean}

export type QueueView = Queue & {open: boolean; running: number; pending: number}

export const queuesStore = createStore<QueueView[]>([])

const members = new Map<ItemKind, QueueMember>()
let evaluating = false

export function registerMember(kind: ItemKind, member: QueueMember): void {
  members.set(kind, member)
}

const main = (): Queue => ({id: MAIN_QUEUE, name: 'main', maxConcurrent: getConfig().tunnels, speedLimit: ''})
export const getQueues = (): Queue[] => [main()]
export const getQueue = (_id?: string): Queue => main()
export const queueIdFor = (_id?: string): string => MAIN_QUEUE
export const queueOpen = (_id?: string): boolean => true

/** running items, draws and fetches together */
export function occupancy(_id?: string): number {
  let n = 0
  for (const m of members.values()) n += m.running(MAIN_QUEUE)
  return n
}

/** how many more may start now */
export const freeSlots = (_id?: string): number => Math.max(0, main().maxConcurrent - occupancy())

/** the view the screens read; members call it whenever their items change state */
export function evaluateQueues(): void {
  if (evaluating) return
  evaluating = true
  try {
    let running = 0
    let pending = 0
    for (const m of members.values()) {
      running += m.running(MAIN_QUEUE)
      pending += m.pending(MAIN_QUEUE)
    }
    queuesStore.set([{...main(), open: true, running, pending}])
  } catch (error) {
    logEvent('warn', `queues: ${(error as Error).message}`)
  } finally {
    evaluating = false
  }
}

/** kept for the members' sake: there is no schedule to tick in Free */
export function startScheduler(): void {}

/** @internal limits.ts routes per-item limits through the members */
export const memberFor = (kind: ItemKind) => members.get(kind)

/** @internal tests: forget the runtime state */
export function resetQueuesForTest(): void {
  members.clear()
}
