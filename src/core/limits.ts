import {configStore, getConfig, RATE} from './config.js'
import {createStore} from './store.js'

/**
 * The speed limit: one, for everything (`rateLimit`, empty for none). aria2
 * takes it live (max-overall-download-limit); yt-dlp takes --limit-rate when a
 * draw starts. (Speed profiles, per-queue and per-item limits are Axive's.)
 */

/** bytes per second from '512K', '2M', '1.5G', '800000'; 0 for none or nonsense */
export function parseRate(text: string | undefined): number {
  const m = text ? RATE.exec(text.trim()) : null
  if (!m) return 0
  const unit = (m[2] ?? '').toUpperCase()
  const n = Number(m[1]) * (unit === 'K' ? 1024 : unit === 'M' ? 1024 ** 2 : unit === 'G' ? 1024 ** 3 : 1)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 0
}

/** a valid limit ('' counts: no limit) */
export const isRate = (text: string) => text.trim() === '' || RATE.test(text.trim())

/** '2M', '512K', '900' from bytes per second; '' for 0 */
export function rateText(bytes: number): string {
  if (!bytes || bytes < 1) return ''
  if (bytes % 1024 ** 2 === 0) return `${bytes / 1024 ** 2}M`
  if (bytes % 1024 === 0) return `${bytes / 1024}K`
  return String(Math.floor(bytes))
}

/** the tightest of several limits, 0 meaning none */
export function tightest(...limits: number[]): number {
  const set = limits.filter(n => n > 0)
  return set.length ? Math.min(...set) : 0
}

export type LimitsState = {
  /** bytes per second in force now, 0 for none */
  global: number
}

export const limitsStore = createStore<LimitsState>({global: 0})
const listeners = new Set<() => void>()

/** the engines follow: fetcher.ts applies the limit to aria2 when this fires */
export function onLimitsChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** the bytes-per-second global limit right now */
export const currentGlobalLimit = () => parseRate(getConfig().rateLimit)

configStore.subscribe(() => {
  const global = currentGlobalLimit()
  if (limitsStore.get().global === global) return
  limitsStore.set({global})
  for (const l of [...listeners]) l()
})
