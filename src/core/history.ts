import {createStore} from './store.js'

/**
 * Throughput history: the last 60 seconds of total speed (draws plus
 * fetches), one sample a second, newest last, for the window's chart and the
 * TUI sparkline. fetcher.ts and jobs.ts each register a source of their
 * current speed; the ticker sums them.
 */

export const HISTORY_SECONDS = 60

export type HistoryState = {
  /** bytes per second, oldest first, always HISTORY_SECONDS long */
  total: number[]
  /** when the last sample was taken */
  at: number
}

export const historyStore = createStore<HistoryState>({total: new Array(HISTORY_SECONDS).fill(0), at: 0})

/** a new ring with `value` pushed at the end (the oldest drops off) */
export function pushRing(ring: readonly number[], value: number, size = HISTORY_SECONDS): number[] {
  const next = ring.length >= size ? ring.slice(ring.length - size + 1) : [...ring]
  next.push(Number.isFinite(value) && value > 0 ? Math.round(value) : 0)
  while (next.length < size) next.unshift(0)
  return next
}

const sources = new Map<string, () => number>()
let ticker: NodeJS.Timeout | undefined

/** take one sample now (the ticker calls this each second) */
export function sampleHistory(now = Date.now()): void {
  let sum = 0
  for (const read of sources.values()) {
    try {
      sum += read() || 0
    } catch {
      // a source that cannot answer counts as still
    }
  }
  historyStore.set(s => ({total: pushRing(s.total, sum), at: now}))
}

/** a speed source ('fetch', 'job'); the ticker starts with the first one */
export function addSpeedSource(name: string, read: () => number): void {
  sources.set(name, read)
  startHistory()
}

export function startHistory(): void {
  if (ticker) return
  ticker = setInterval(() => sampleHistory(), 1000)
  ticker.unref?.()
}

export function stopHistory(): void {
  if (ticker) clearInterval(ticker)
  ticker = undefined
}
