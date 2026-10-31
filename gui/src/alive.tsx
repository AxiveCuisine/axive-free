import React, {useEffect, useRef, useState} from 'react'
import {LETTERS} from '../../src/core/scramble.js'
import {useAxive} from './state.js'

/**
 * 2.4: the window breathes. Behind everything, the deep: letters and motes
 * rising slowly through black water, as on the site, and quickening (a few
 * of them warming to the seal's red) while something is drawing. Presses
 * leave a ring, like ink dropped in water. Only the in-app "animations"
 * setting stills it all (many PCs report reduced motion unasked: not a reason).
 */

const GREEK = [...'αβγδεζηθλμξπρσφψω']
const POOL = [...LETTERS, ...LETTERS, ...GREEK]

type Mote = {x: number; y: number; v: number; a: number; s: number; ch?: string; drift: number}

export function Deep() {
  const animate = useAxive(s => s.config.animations !== false)
  const speed = useAxive(s => s.jobs.reduce((n, j) => n + (j.state === 'running' ? (j.progress?.speed ?? 0) : 0), 0) + s.fetch.items.reduce((n, f) => n + (f.state === 'active' ? f.speed : 0), 0))
  const canvas = useRef<HTMLCanvasElement>(null)
  // how lively the water is: 0 still, up to 1 while drawing fast (read by the frame loop, not a re-render)
  const live = useRef(0)
  live.current = speed > 0 ? Math.min(1, 0.45 + Math.log10(1 + speed / 1e5) / 4) : 0

  useEffect(() => {
    const el = canvas.current
    if (!animate || !el) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    let w = 0
    let h = 0
    let motes: Mote[] = []
    let raf = 0
    let last = 0
    let energy = 0
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      w = el.clientWidth
      h = el.clientHeight
      el.width = Math.round(w * dpr)
      el.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.round((w * h) / 16000)
      motes = Array.from({length: count}, (_, i) => ({
        x: Math.random() * w,
        y: Math.random() * h,
        v: 0.08 + Math.random() * 0.26,
        a: Math.random() * Math.PI * 2,
        s: i % 3 === 0 ? 11 + Math.random() * 13 : 0.6 + Math.random() * 1.4,
        ch: i % 3 === 0 ? POOL[(Math.random() * POOL.length) | 0] : undefined,
        drift: (Math.random() - 0.5) * 0.25,
      }))
    }
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      // thirty frames a second is plenty for water
      if (t - last < 33) return
      const dt = Math.min(3, (t - last) / 16.7)
      last = t
      energy += (live.current - energy) * 0.04
      ctx.clearRect(0, 0, w, h)
      // the single light, wandering a little across the upper left
      const lx = w * (0.12 + 0.05 * Math.sin(t / 9000))
      const ly = h * (-0.05 + 0.04 * Math.cos(t / 11000))
      const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(w, h) * 0.75)
      glow.addColorStop(0, `rgba(216,208,191,${0.05 + energy * 0.025})`)
      glow.addColorStop(1, 'rgba(216,208,191,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, w, h)
      // while drawing, a slow red tide at the foot
      if (energy > 0.02) {
        const tide = ctx.createLinearGradient(0, h, 0, h * 0.55)
        tide.addColorStop(0, `rgba(125,15,23,${0.16 * energy * (0.75 + 0.25 * Math.sin(t / 1400))})`)
        tide.addColorStop(1, 'rgba(125,15,23,0)')
        ctx.fillStyle = tide
        ctx.fillRect(0, h * 0.55, w, h * 0.45)
      }
      const rise = 1 + energy * 2.6
      for (const m of motes) {
        m.y -= m.v * rise * dt
        m.x += (m.drift + Math.sin(t / 2600 + m.a) * 0.12) * dt
        if (m.y < -24) {
          m.y = h + 24
          m.x = Math.random() * w
          if (m.ch) m.ch = POOL[(Math.random() * POOL.length) | 0]
        }
        if (m.x < -24) m.x = w + 24
        else if (m.x > w + 24) m.x = -24
        const pulse = (Math.sin(t / 1700 + m.a) + 1) / 2
        const warm = energy > 0.1 && pulse > 0.86 - energy * 0.25
        const alpha = (m.ch ? 0.05 : 0.1) + pulse * (m.ch ? 0.12 : 0.22) + energy * 0.05
        ctx.fillStyle = warm ? `rgba(214,77,84,${Math.min(0.55, alpha + 0.12)})` : `rgba(${m.ch ? '154,148,160' : '216,208,191'},${alpha})`
        if (m.ch) {
          ctx.font = `${m.s}px 'Frank Ruhl Libre', FrankRuehl, David, serif`
          ctx.fillText(m.ch, m.x, m.y)
        } else {
          ctx.beginPath()
          ctx.arc(m.x, m.y, m.s * (warm ? 1.4 : 1), 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
    resize()
    window.addEventListener('resize', resize)
    const visible = () => {
      cancelAnimationFrame(raf)
      if (!document.hidden) raf = requestAnimationFrame(frame)
    }
    document.addEventListener('visibilitychange', visible)
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [animate])

  return animate ? <canvas ref={canvas} className="deep" aria-hidden /> : null
}

/** A press leaves a ring on buttons, doors and cards: ink dropped in water. */
export function useRipples(): void {
  const animate = useAxive(s => s.config.animations !== false)
  useEffect(() => {
    if (!animate) return
    const press = (e: PointerEvent) => {
      if (e.button !== 0) return
      const host = (e.target as HTMLElement).closest?.('.btn, .door, .door-card, .vessels button, .choice button, .settings-nav button, .result') as HTMLElement | null
      if (!host || (host as HTMLButtonElement).disabled) return
      const box = host.getBoundingClientRect()
      const ring = document.createElement('span')
      ring.className = 'ripple'
      const size = Math.max(box.width, box.height) * 2.2
      ring.style.width = ring.style.height = `${size}px`
      ring.style.left = `${e.clientX - box.left - size / 2}px`
      ring.style.top = `${e.clientY - box.top - size / 2}px`
      host.append(ring)
      ring.addEventListener('animationend', () => ring.remove(), {once: true})
      setTimeout(() => ring.remove(), 1200)
    }
    window.addEventListener('pointerdown', press, true)
    return () => window.removeEventListener('pointerdown', press, true)
  }, [animate])
}

/** A number that glides to its new value instead of jumping (speeds, counts). */
export function useTweened(value: number, ms = 420): number {
  const animate = useAxive(s => s.config.animations !== false)
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (!animate || !Number.isFinite(value)) return setShown(value)
    const start = performance.now()
    const begin = from.current
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms)
      const eased = 1 - Math.pow(1 - p, 3)
      const v = begin + (value - begin) * eased
      from.current = v
      setShown(v)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, animate])
  return shown
}
