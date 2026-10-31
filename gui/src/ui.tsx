import React, {useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react'
import {scramble} from '../../src/core/scramble.js'
import {sigilsFor, turn} from '../../src/core/sigils.js'
import {t, useAxive} from './state.js'

/**
 * The pieces every view is made of. Anything that does something is a real
 * button with a name; its hint (the TUI's hover line) becomes a tooltip for
 * the pointer and an accessible description for a screen reader.
 */

type ButtonProps = {
  children?: ReactNode
  onClick?: (e: React.MouseEvent) => void
  hint?: string
  kind?: 'primary' | 'quiet' | 'danger' | 'plain' | 'seal'
  icon?: IconName
  label?: string
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
  keys?: string
  pressed?: boolean
}

export function Button({children, onClick, hint, kind = 'plain', icon, label, disabled, type = 'button', className = '', keys, pressed}: ButtonProps) {
  const name = label ? t(label) : undefined
  const tip = hint ? t(hint) : icon && name ? name : undefined
  const bare = icon && !children
  return (
    <button
      type={type}
      className={`btn ${kind === 'plain' ? '' : kind} ${bare ? 'icon' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={bare ? name : undefined}
      aria-description={hint ? t(hint) : undefined}
      aria-pressed={pressed}
      aria-keyshortcuts={keys}
      data-tip={keys && tip ? `${tip} (${keys.toLowerCase()})` : tip}
    >
      {icon ? <Icon name={icon} /> : null}
      {typeof children === 'string' ? <span>{t(children)}</span> : children}
    </button>
  )
}

/** English or Nederlands: each name in its own language, never translated */
export function LanguagePicker({value, onChange}: {value: string; onChange: (next: 'en' | 'nl') => void}) {
  return (
    <div className="lang-pick" role="group" aria-label="language · taal">
      {(['en', 'nl'] as const).map(code => (
        <button key={code} type="button" lang={code} aria-pressed={value === code} className={value === code ? 'on' : ''} onClick={() => onChange(code)}>
          {code === 'en' ? 'English' : 'Nederlands'}
        </button>
      ))}
    </div>
  )
}

export function Toggle({label, value, onChange, hint, disabled, id, className}: {label: string; value: boolean; onChange: (next: boolean) => void; hint?: string; disabled?: boolean; id?: string; className?: string}) {
  return (
    <button type="button" role="switch" id={id} className={`toggle ${className ?? ''}`} aria-checked={value} onClick={() => onChange(!value)} disabled={disabled} aria-description={hint ? t(hint) : undefined} data-tip={hint ? t(hint) : undefined}>
      <span className="box" aria-hidden />
      <span>{t(label)}</span>
    </button>
  )
}

/** A short row of mutually exclusive options: 1 2 3 4, mp3 m4a… (arrow keys move, as a radio group should) */
export function Choice<T extends string>({label, value, options, onChange, show, disabled}: {label: string; value: T; options: readonly T[]; onChange: (v: T) => void; show?: (v: T) => string; disabled?: boolean}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const at = Math.max(0, options.indexOf(value))
  const key = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (i + step + options.length) % options.length
    onChange(options[next]!)
    refs.current[next]?.focus()
  }
  return (
    <div className="choice" role="radiogroup" aria-label={t(label)}>
      {options.map((o, i) => (
        <button key={o} ref={el => void (refs.current[i] = el)} type="button" role="radio" aria-checked={o === value} tabIndex={i === at ? 0 : -1} disabled={disabled} onClick={() => onChange(o)} onKeyDown={e => key(e, i)}>
          {t(show ? show(o) : o)}
        </button>
      ))}
    </div>
  )
}

export function Select<T extends string>({label, value, options, onChange, show}: {label: string; value: T; options: readonly T[]; onChange: (v: T) => void; show?: (v: T) => string}) {
  return (
    <span className="select-wrap">
      <select className="select" aria-label={t(label)} value={value} onChange={e => onChange(e.target.value as T)}>
        {options.map(o => (
          <option key={o} value={o}>
            {t(show ? show(o) : o)}
          </option>
        ))}
      </select>
      <Icon name="down" />
    </span>
  )
}

/** A text field with its label for readers (and an optional button inside the well). */
export function Field({label, value, onChange, placeholder, onEnter, type = 'text', width, children, autoFocus, inputRef, mono, id}: {label: string; value: string; onChange: (v: string) => void; placeholder?: string; onEnter?: () => void; type?: string; width?: number | string; children?: ReactNode; autoFocus?: boolean; inputRef?: React.Ref<HTMLInputElement>; mono?: boolean; id?: string}) {
  return (
    <label className={`field ${mono ? 'mono' : ''}`} style={width ? {width} : undefined}>
      <span className="sr-only">{t(label)}</span>
      <input id={id} ref={inputRef} type={type} value={value} autoFocus={autoFocus} onChange={e => onChange(e.target.value)} placeholder={placeholder ? t(placeholder) : undefined} spellCheck={false} autoComplete="off" onKeyDown={e => e.key === 'Enter' && onEnter && (e.preventDefault(), onEnter())} />
      {children}
    </label>
  )
}

/** ABDM's grammar on one line: drawing (signal), held (dim), failed (hatched), preparing (a comet), received (bone). */
export function Progress({fraction, status = 'drawing', label, thin}: {fraction?: number; status?: string; label: string; thin?: boolean}) {
  const known = fraction !== undefined && Number.isFinite(fraction)
  const pct = known ? Math.round(Math.max(0, Math.min(1, fraction!)) * 1000) / 10 : undefined
  return (
    <div className={`progress ${status} ${known ? '' : 'unknown'} ${thin ? 'thin' : ''}`} role="progressbar" aria-label={t(label)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct === undefined ? undefined : Math.round(pct)}>
      <i style={known ? {width: `${pct}%`} : undefined} />
    </div>
  )
}

export function Thumb({src, alt, className = '', fallback}: {src?: string; alt: string; className?: string; fallback?: string}) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={`thumb ${className}`}>
      {src && !failed ? <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span aria-hidden>{fallback ?? ''}</span>}
    </div>
  )
}

// hairline icons: 16 grid, 1.25 stroke, square caps. No emoji, no icon font.
const ICONS = {
  pause: 'M5.5 3.5v9M10.5 3.5v9',
  play: 'M5 3.2l8 4.8-8 4.8z',
  close: 'M4 4l8 8M12 4l-8 8',
  folder: 'M2 4h4l1.5 1.5H14V13H2z',
  open: 'M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5',
  up: 'M8 13V3M4 7l4-4 4 4',
  down: 'M4 6l4 4 4-4',
  right: 'M6 4l4 4-4 4',
  retry: 'M13 8a5 5 0 1 1-1.5-3.5M12 2v3H9',
  why: 'M6 6a2 2 0 1 1 3 1.7c-.6.4-1 .8-1 1.6M8 12v.5',
  now: 'M3 8h9M9 5l3 3-3 3',
  copy: 'M5 5h8v8H5zM3 11V3h8',
  trash: 'M3 4h10M6 4V2.5h4V4M4.5 4l.8 9.5h5.4l.8-9.5',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  convert: 'M3 5h9M9 2l3 3-3 3M13 11H4M7 8l-3 3 3 3',
  send: 'M2 8l12-5-4 11-2.5-4.5zM7.5 9.5L14 3',
  plus: 'M8 3v10M3 8h10',
  search: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.5 10.5L14 14',
  link: 'M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1',
  phone: 'M5 1.5h6v13H5zM7.5 12.5h1',
  gear: 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
  book: 'M3 2.5h7.5a1.5 1.5 0 0 1 1.5 1.5v9.5H4.5A1.5 1.5 0 0 1 3 12zM3 12a1.5 1.5 0 0 1 1.5-1.5H12',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  file: 'M4 1.5h5.5L12 4v10.5H4zM9.5 1.5V4H12',
  check: 'M3 8.5l3 3 7-7',
  clock: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 4.5V8l2.5 1.5',
  queue: 'M2.5 4h11M2.5 8h11M2.5 12h7',
  slow: 'M2 11a6 6 0 0 1 12 0M8 11l3-4',
  key: 'M10 6.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM5.6 8.4L2 12v1.5h2V12h1.5v-1.5H7',
  globe: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13zM1.5 8h13M8 1.5c2 2 2.5 4.5 2.5 6.5S10 12.5 8 14.5C6 12.5 5.5 10 5.5 8S6 3.5 8 1.5z',
  note: 'M6 12.5a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 1 3.6 0zM6 12.5V3.2l7-1.4v8.7M13 10.5a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 1 3.6 0z',
  shield: 'M8 1.5l5.5 2v4.5c0 3.5-2.5 5.5-5.5 6.5-3-1-5.5-3-5.5-6.5V3.5z',
  zip: 'M4 1.5h8v13H4zM8 1.5v2M8 4.5v1M8 6.5v1M7 8.5h2v2H7z',
  hash: 'M3 6h10M3 10h10M6.5 2.5L5.5 13.5M10.5 2.5l-1 11',
  menu: 'M2.5 4h11M2.5 8h11M2.5 12h11',
  ghost: 'M4 14V7a4 4 0 0 1 8 0v7l-2-1.5L8 14l-2-1.5zM6.5 7.5h.01M9.5 7.5h.01',
  puzzle: 'M3 5h3a1.5 1.5 0 1 1 3 0h3v3a1.5 1.5 0 1 1 0 3v3H3z',
  tools: 'M10.5 2.5a3 3 0 0 0-3.4 4L2.5 11.1 4.9 13.5l4.6-4.6a3 3 0 0 0 4-3.4l-1.8 1.8-1.7-.4-.4-1.7z',
  eye_off: 'M2 2l12 12M6.5 6.6A2 2 0 0 0 9.4 9.5M4.2 4.3C2.6 5.5 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.4 0 2.6-.5 3.6-1.2M7 3.6c.3 0 .7-.1 1-.1 4 0 6.5 4.5 6.5 4.5s-.6 1.1-1.6 2.3',
} as const
export type IconName = keyof typeof ICONS

export function Icon({name}: {name: IconName}) {
  return (
    <svg className="ico" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d={ICONS[name]} />
    </svg>
  )
}

/**
 * The wordmark: AXIVE set in Cormorant SC, widely spaced, beside the seal (a
 * lozenge of dried blood with a bone hairline inside). Real type, a vector
 * mark: sharp at any size, nothing made of pixels.
 */
export function Seal({size = 12}: {size?: number}) {
  return (
    <svg className="seal" viewBox="0 0 16 16" width={size} height={size} aria-hidden focusable="false">
      <path d="M8 .8L15.2 8 8 15.2.8 8z" className="seal-fill" />
      <path d="M8 4.2L11.8 8 8 11.8 4.2 8z" className="seal-line" />
    </svg>
  )
}

export function Wordmark({size = 'small'}: {size?: 'small' | 'grand'}) {
  return (
    <span className={`wordmark ${size}`} role="img" aria-label="Axive">
      <Seal size={size === 'grand' ? 18 : 11} />
      <span className="letters" aria-hidden>
        AXIVE
      </span>
    </span>
  )
}

/**
 * The tooltip: one for the whole window. Anything with data-tip gets it,
 * after a breath (500ms) under the pointer, at once under keyboard focus.
 */
export function Tips() {
  const [tip, setTip] = useState<{text: string; x: number; y: number}>()
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    const show = (el: Element | null, delay: number) => {
      window.clearTimeout(timer.current)
      const host = el?.closest('[data-tip]')
      const text = host?.getAttribute('data-tip')
      if (!host || !text) return setTip(undefined)
      timer.current = window.setTimeout(() => {
        const r = host.getBoundingClientRect()
        setTip({text, x: Math.min(window.innerWidth - 352, Math.max(8, r.left)), y: r.bottom + 8 > window.innerHeight - 60 ? r.top - 44 : r.bottom + 8})
      }, delay)
    }
    const over = (e: PointerEvent) => show(e.target as Element, 500)
    const focus = (e: FocusEvent) => (e.target as Element).matches?.(':focus-visible') && show(e.target as Element, 0)
    const hide = () => (window.clearTimeout(timer.current), setTip(undefined))
    document.addEventListener('pointerover', over)
    document.addEventListener('focusin', focus)
    document.addEventListener('pointerdown', hide)
    document.addEventListener('focusout', hide)
    document.addEventListener('keydown', hide)
    return () => {
      document.removeEventListener('pointerover', over)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('pointerdown', hide)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('keydown', hide)
    }
  }, [])
  return tip ? (
    <div className="tip surface" style={{left: tip.x, top: tip.y}} aria-hidden>
      {tip.text}
    </div>
  ) : null
}

/** Text that surfaces out of Hebrew letters, as in the terminal. */
export function Scrambled({text, className, ms = 600}: {text: string; className?: string; ms?: number}) {
  const animate = useAxive(s => s.config.animations !== false)
  const [progress, setProgress] = useState(animate ? 0 : 1)
  useEffect(() => {
    // the owner's own switch decides (many PCs report reduced motion without anyone asking for it)
    if (!animate) return setProgress(1)
    setProgress(0)
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms)
      setProgress(p)
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [text, animate, ms])
  if (progress >= 1) return <span className={className}>{text}</span>
  const cells = scramble(text, progress, 'in')
  return (
    <span className={className} aria-label={text}>
      {cells.map((c, i) => (c.glyph ? <span key={i} className="glyph" aria-hidden>{c.ch}</span> : <React.Fragment key={i}>{c.ch}</React.Fragment>))}
    </span>
  )
}

// the line under the wordmark turns quickly: a short hold, then each word sinks and the next surfaces
const SIGIL_HOLD = 2400
const SIGIL_OUT = 360
const SIGIL_IN = 520
const SIGILS = sigilsFor(true)

/**
 * The sigil under the wordmark: the name in Hebrew, then words from other old
 * tongues (sigils.ts, the terminal's own), each sinking into its letters
 * before the next surfaces. Every cell keeps its width, so nothing shifts.
 * Only the in-app animations setting stills it.
 */
export function Sigil({className = 'sigil'}: {className?: string}) {
  const animate = useAxive(s => s.config.animations !== false)
  const [state, setState] = useState<{index: number; stage: 'hold' | 'out' | 'in'; progress: number}>({index: 0, stage: 'hold', progress: 0})
  useEffect(() => {
    if (!animate) return setState({index: 0, stage: 'hold', progress: 0})
    let frame = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = (stage: 'out' | 'in') => {
      const start = performance.now()
      const length = stage === 'out' ? SIGIL_OUT : SIGIL_IN
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / length)
        setState(s => ({...s, stage, progress}))
        if (progress < 1) frame = requestAnimationFrame(tick)
        else if (stage === 'out') (setState(s => ({index: (s.index + 1) % SIGILS.length, stage: 'in', progress: 0})), run('in'))
        else (setState(s => ({...s, stage: 'hold', progress: 0})), (timer = setTimeout(() => run('out'), SIGIL_HOLD)))
      }
      frame = requestAnimationFrame(tick)
    }
    timer = setTimeout(() => run('out'), SIGIL_HOLD)
    return () => (cancelAnimationFrame(frame), clearTimeout(timer))
  }, [animate])
  const sigil = SIGILS[state.index % SIGILS.length]!
  const chars = [...sigil.text]
  const cells = state.stage === 'hold' ? [...sigil.text].map(ch => ({ch, glyph: false})) : turn(sigil, state.progress, state.stage)
  return (
    <span className={className} aria-hidden title={sigil.gloss}>
      {cells.map((c, i) => (
        <span key={i} className={chars[i] === ' ' ? 'sc gap' : c.glyph ? 'sc glyph' : 'sc'}>
          {c.ch.trim() ? c.ch : ' '}
        </span>
      ))}
    </span>
  )
}

export function Title({children, sub, actions}: {children: string; sub?: string; actions?: ReactNode}) {
  return (
    <header className="view-head surface">
      <div>
        <h1 className="view-title">{t(children)}</h1>
        {sub ? <p className="view-sub">{t(sub)}</p> : null}
      </div>
      {actions ? <div className="view-actions">{actions}</div> : null}
    </header>
  )
}

/** A tab strip with arrow keys between tabs. */
export function Tabs<T extends string>({label, value, tabs, onChange, idBase}: {label: string; value: T; tabs: Array<{id: T; label: string; hint?: string; badge?: ReactNode}>; onChange: (v: T) => void; idBase: string}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const key = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (i + step + tabs.length) % tabs.length
    onChange(tabs[next]!.id)
    refs.current[next]?.focus()
  }
  return (
    <div className="tabs" role="tablist" aria-label={t(label)}>
      {tabs.map((x, i) => (
        <button
          key={x.id}
          ref={el => void (refs.current[i] = el)}
          type="button"
          role="tab"
          id={`${idBase}-tab-${x.id}`}
          aria-controls={`${idBase}-panel`}
          aria-selected={value === x.id}
          tabIndex={value === x.id ? 0 : -1}
          className="tab"
          onClick={() => onChange(x.id)}
          onKeyDown={e => key(e, i)}
          data-tip={x.hint ? t(x.hint) : undefined}
        >
          {t(x.label)}
          {x.badge}
        </button>
      ))}
    </div>
  )
}

/** A modal sheet: focus moves in, esc closes, focus goes back where it was. */
export function Sheet({title, sub, onClose, children, wide, labelId}: {title: string; sub?: string; onClose: () => void; children: ReactNode; wide?: boolean | 'full'; labelId?: string}) {
  const ref = useRef<HTMLDivElement>(null)
  const id = labelId ?? `sheet-${title.replace(/\W+/g, '-')}`
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('[autofocus], input, button, [tabindex="0"]')
    ;(first ?? ref.current)?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.menu')) (e.stopPropagation(), onClose())
      if (e.key === 'Tab' && ref.current) {
        const all = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex="0"]')]
        if (!all.length) return
        if (e.shiftKey && document.activeElement === all[0]) (e.preventDefault(), all.at(-1)!.focus())
        else if (!e.shiftKey && document.activeElement === all.at(-1)) (e.preventDefault(), all[0]!.focus())
      }
    }
    window.addEventListener('keydown', key, true)
    return () => (window.removeEventListener('keydown', key, true), before?.focus?.())
  }, [])
  return (
    <div className="veil" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`sheet surface ${wide === 'full' ? 'full' : wide ? 'wide' : ''}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <span className="ticks" aria-hidden />
        <header className="sheet-head">
          <div>
            <h2 className="sheet-title" id={id}>
              {t(title)}
            </h2>
            {sub ? <p className="view-sub">{t(sub)}</p> : null}
          </div>
          <Button icon="close" kind="quiet" label="close" hint="esc" onClick={onClose} />
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

export type MenuItem = {label: string; icon?: IconName; keys?: string; onSelect: () => void; danger?: boolean; disabled?: boolean} | 'rule'

/** The right-click menu (also the row's "more" menu): arrow keys, enter, esc. */
export function Menu({x, y, items, onClose, label}: {x: number; y: number; items: MenuItem[]; onClose: () => void; label: string}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({x, y})
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect()
    setPos({x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8)})
    ref.current!.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
  }, [x, y])
  useEffect(() => {
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const key = (e: KeyboardEvent) => {
      const all = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
      const at = all.indexOf(document.activeElement as HTMLElement)
      if (e.key === 'Escape' || e.key === 'Tab') (e.preventDefault(), e.stopPropagation(), onClose())
      else if (e.key === 'ArrowDown') (e.preventDefault(), all[(at + 1) % all.length]?.focus())
      else if (e.key === 'ArrowUp') (e.preventDefault(), all[(at - 1 + all.length) % all.length]?.focus())
    }
    window.addEventListener('mousedown', away, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', onClose)
    return () => (window.removeEventListener('mousedown', away, true), window.removeEventListener('keydown', key, true), window.removeEventListener('blur', onClose))
  }, [])
  return (
    <div className="menu surface" ref={ref} role="menu" aria-label={t(label)} style={{left: pos.x, top: pos.y}}>
      {items.map((item, i) =>
        item === 'rule' ? (
          <div key={i} className="menu-rule" role="separator" />
        ) : (
          <button key={i} type="button" role="menuitem" className={item.danger ? 'danger' : ''} disabled={item.disabled} onClick={() => (onClose(), item.onSelect())}>
            {item.icon ? <Icon name={item.icon} /> : <span className="ico" />}
            <span className="grow">{t(item.label)}</span>
            {item.keys ? <kbd>{item.keys}</kbd> : null}
          </button>
        ),
      )}
    </div>
  )
}

/** 60 seconds as a line, newest on the right. Keeps its height while empty. */
export function Sparkline({values, width = 168, height = 28, label}: {values: number[]; width?: number; height?: number; label: string}) {
  const n = 60
  const pad = Array(Math.max(0, n - values.length)).fill(0).concat(values.slice(-n)) as number[]
  const max = Math.max(1, ...pad)
  const pts = pad.map((v, i) => `${((i / (n - 1)) * width).toFixed(1)},${(height - 1 - (v / max) * (height - 3)).toFixed(1)}`)
  const live = (pad.at(-1) ?? 0) > 0
  const head = pts.at(-1)!.split(',')
  return (
    <svg className={`spark ${live ? 'live' : ''}`} viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={t(label)} preserveAspectRatio="none">
      <path className="spark-area" d={`M0,${height} L${pts.join(' L')} L${width},${height} Z`} />
      <path className="spark-line" d={`M${pts.join(' L')}`} />
      {live ? <circle className="spark-head" cx={Number(head[0]) - 2} cy={head[1]} r={2.2} /> : null}
    </svg>
  )
}

export const formatTime = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

/** "1:23", "01:02:03", "90", "1m30s" → seconds */
export function parseTime(text: string): number | undefined {
  const s = text.trim()
  if (!s) return undefined
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s)
  const hms = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/i.exec(s)
  if (hms && (hms[1] || hms[2] || hms[3])) return Number(hms[1] ?? 0) * 3600 + Number(hms[2] ?? 0) * 60 + Number(hms[3] ?? 0)
  const parts = s.split(':').map(Number)
  if (parts.length > 3 || parts.some(n => !Number.isFinite(n))) return undefined
  return parts.reduce((total, n) => total * 60 + n, 0)
}

export const ago = (at: number, now = Date.now()) => {
  const s = Math.max(0, (now - at) / 1000)
  if (s < 60) return 'moments ago'
  const units: Array<[number, string]> = [[31_536_000, 'year'], [2_592_000, 'month'], [86_400, 'day'], [3600, 'hour'], [60, 'minute']]
  for (const [size, name] of units) if (s >= size) return `${Math.floor(s / size)} ${name}${Math.floor(s / size) === 1 ? '' : 's'} ago`
  return 'moments ago'
}

/** Keyboard keys as the ? sheet and the empty states show them. */
export function Keys({k}: {k: string}) {
  return (
    <span className="keys-inline">
      {k.split('+').map((p, i) => (
        <React.Fragment key={i}>
          {i ? <span aria-hidden>+</span> : null}
          <kbd>{p}</kbd>
        </React.Fragment>
      ))}
    </span>
  )
}
