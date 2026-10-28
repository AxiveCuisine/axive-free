import {useEffect, useState} from 'react'
import {fetchStore} from '../core/fetcher.js'
import {jobsStore} from '../core/jobs.js'
import {totalSpeed} from '../core/pieces.js'
import {createStore} from '../core/store.js'

/**
 * Sixty seconds of speed, one sample a second, newest last: every draw and
 * fetch together, and each one on its own (by job id or gid), for the
 * sparklines. Sampled here, in the terminal, from the stores it already
 * reads; nothing is kept once an item stops moving for a minute.
 */
export const HISTORY_SECONDS = 60

export type SpeedHistory = {total: number[]; items: Record<string, number[]>}
export const speedHistory = createStore<SpeedHistory>({total: Array(HISTORY_SECONDS).fill(0), items: {}})

const push = (ring: number[] | undefined, value: number) => {
  const next = [...(ring ?? Array(HISTORY_SECONDS).fill(0)), value]
  return next.slice(-HISTORY_SECONDS)
}

let timer: NodeJS.Timeout | undefined
export function startSpeedHistory(): () => void {
  if (timer) return () => {}
  const sample = () => {
    const jobs = jobsStore.get()
    const fetches = fetchStore.get().items
    const prev = speedHistory.get()
    const items: Record<string, number[]> = {}
    for (const job of jobs) {
      const speed = job.state === 'running' ? job.progress?.speed ?? 0 : 0
      const ring = push(prev.items[job.id], speed)
      if (speed > 0 || ring.some(v => v > 0)) items[job.id] = ring
    }
    for (const item of fetches) {
      const speed = item.state === 'active' ? item.smooth ?? item.speed : 0
      const ring = push(prev.items[item.gid], speed)
      if (speed > 0 || ring.some(v => v > 0)) items[item.gid] = ring
    }
    speedHistory.set({total: push(prev.total, totalSpeed(jobs, fetches)), items})
  }
  timer = setInterval(sample, 1000)
  timer.unref?.()
  return () => {
    clearInterval(timer)
    timer = undefined
  }
}

/** A counter that turns every `ms` while `active`: cheap, shared motion (pulses, the comet). */
export function useTick(ms: number, active = true): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setTick(t => t + 1), ms)
    return () => clearInterval(id)
  }, [ms, active])
  return tick
}
