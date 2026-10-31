import React, {memo, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {formatBytes, formatSpeed} from '../../../src/core/format.js'
import {t} from '../state.js'

/**
 * Seeing a download (features B1 to B4): the piece map (plexo's block grid,
 * one square per chunk), the 60 s throughput chart, the connections
 * converging into the file, and one row per connection. CSS transitions do
 * the moving; nothing here animates on a timer of its own.
 */

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

// ---------------------------------------------------------------- piece map

const CELL = 12
const GAP = 3
const ROW_H = 13
const MIN_COLS = 8
const VISIBLE_ROWS = 4
const INSET = 3
const BUFFER_ROWS = 2

type CellState = 'pending' | 'flight' | 'done' | 'retry'

// one square; it renders again only when its own fill or state changes
const Cell = memo(function Cell({v, state, index, rest}: {v: number; state: CellState; index: number; rest: boolean}) {
  const before = useRef<number | undefined>(undefined)
  const arrive = before.current !== undefined && before.current < 8 && v === 8
  before.current = v
  // a 6% sliver as soon as anything has landed, so the first bytes show
  const fill = v >= 8 ? 100 : v > 0 ? Math.max(6, Math.round((v / 8) * 100)) : state === 'flight' ? 6 : 0
  return (
    <span className={`pc ${state}${arrive ? ' arrive' : ''}${rest ? ' rest' : ''}`} data-i={index}>
      <i style={{width: `${fill}%`}} />
    </span>
  )
})

export type PieceMapProps = {
  /** one digit 0 to 8 per unit: eighths received */
  map: string
  /** units a connection writes into now */
  edges?: number[]
  /** units retrying after a refusal */
  retrying?: number[]
  rest?: boolean
  /** pieces behind each unit (aria2's own count), and their size */
  pieces?: number
  pieceSize?: number
  /** "connections" or "peers", with their count, for the idle readout */
  who?: string
  approximate?: boolean
}

/** The block grid. Squares never shrink: a big file makes a taller grid that scrolls, so a square always means one chunk. */
export function PieceMap({map, edges = [], retrying = [], rest = false, pieces, pieceSize, who, approximate}: PieceMapProps) {
  const [wrap, width] = useWidth<HTMLDivElement>()
  const scroller = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const [hover, setHover] = useState<number>()
  const units = map.length
  const cols = Math.max(1, Math.min(units, Math.max(MIN_COLS, Math.floor((Math.max(0, width - INSET * 2) + GAP) / (CELL + GAP)))))
  const rows = Math.ceil(units / cols)
  const viewH = Math.min(rows, VISIBLE_ROWS) * (ROW_H + GAP) - GAP
  const flight = useMemo(() => new Set(edges), [edges.join(',')])
  const retry = useMemo(() => new Set(retrying), [retrying.join(',')])
  const firstRow = Math.max(0, Math.floor(scroll / (ROW_H + GAP)) - BUFFER_ROWS)
  const lastRow = Math.min(rows - 1, Math.floor((scroll + viewH) / (ROW_H + GAP)) + BUFFER_ROWS)
  const per = pieces && units ? pieces / units : 1

  // the nearest row with a square in flight, when none is in view: the pill points to it
  const activeRows = useMemo(() => [...flight].map(i => Math.floor(i / cols)).sort((a, b) => a - b), [flight, cols])
  const topVisible = Math.floor(scroll / (ROW_H + GAP))
  const bottomVisible = Math.floor((scroll + viewH - 1) / (ROW_H + GAP))
  const inView = activeRows.some(r => r >= topVisible && r <= bottomVisible)
  const above = !rest && !inView ? activeRows.filter(r => r < topVisible).at(-1) : undefined
  const below = !rest && !inView ? activeRows.find(r => r > bottomVisible) : undefined
  const jump = (row: number) => scroller.current?.scrollTo({top: Math.max(0, row * (ROW_H + GAP) - (ROW_H + GAP)), behavior: reduced() ? 'auto' : 'smooth'})

  const unitWord = per > 1.01 ? 'chunk' : 'piece'
  const idle = [
    `${units} ${unitWord}${units === 1 ? '' : 's'}`,
    pieceSize ? `${formatBytes(Math.round(pieceSize * per))} each` : '',
    who ?? '',
    !rest && flight.size ? `${approximate ? 'about ' : ''}${flight.size} writing` : rest ? 'resting' : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const readout = (() => {
    if (hover === undefined || hover >= units) return idle
    const v = Number(map[hover])
    const held = v === 8 ? 'received' : v === 0 ? (flight.has(hover) ? 'opening' : 'queued') : `about ${Math.round((v / 8) * 100)}% in`
    const bytes = pieceSize ? ` · ${formatBytes(Math.round((v / 8) * pieceSize * per))} of ${formatBytes(Math.round(pieceSize * per))}` : ''
    return [`${unitWord} ${hover + 1}`, `${held}${v > 0 && v < 8 ? bytes : ''}`, retry.has(hover) ? 'retrying' : flight.has(hover) && !rest ? 'writing now' : ''].filter(Boolean).join(' · ')
  })()

  const cells: React.ReactNode[] = []
  for (let i = firstRow * cols; i < Math.min(units, (lastRow + 1) * cols); i++) {
    const v = Number(map[i])
    const state: CellState = retry.has(i) ? 'retry' : v >= 8 ? 'done' : flight.has(i) && !rest ? 'flight' : 'pending'
    cells.push(<Cell key={i} index={i} v={v} state={state} rest={rest} />)
  }
  const pct = Math.round((map ? [...map].reduce((s, c) => s + Number(c), 0) / (units * 8) : 0) * 100)
  return (
    <div className="pm-card">
      <div className="pm-frame" ref={wrap}>
        {above !== undefined ? (
          <button type="button" className="pm-jump top" onClick={() => jump(above)} aria-label={t('show the squares being written, above')}>
            ↑ {t('active')}
          </button>
        ) : null}
        <div className="pm-scroll" ref={scroller} tabIndex={0} role="region" aria-label={t('the piece map')} style={{height: viewH + INSET * 2}} onScroll={e => setScroll((e.target as HTMLElement).scrollTop)}>
          <div
            className={`pm${rest ? ' resting' : ''}`}
            role="img"
            aria-label={`${t('piece map')}: ${pct}% · ${t(idle)}`}
            style={{gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, paddingTop: firstRow * (ROW_H + GAP) + INSET, paddingBottom: Math.max(0, rows - lastRow - 1) * (ROW_H + GAP) + INSET}}
            onMouseOver={e => {
              const i = (e.target as HTMLElement).closest<HTMLElement>('[data-i]')?.dataset.i
              setHover(i === undefined ? undefined : Number(i))
            }}
            onMouseLeave={() => setHover(undefined)}
          >
            {cells}
          </div>
        </div>
        {below !== undefined ? (
          <button type="button" className="pm-jump bottom" onClick={() => jump(below)} aria-label={t('show the squares being written, below')}>
            ↓ {t('active')}
          </button>
        ) : null}
      </div>
      <p className="pm-readout data" aria-live="off">
        {t(readout)}
      </p>
    </div>
  )
}

/** A row's own small map: the same eighths, folded into a short strip. */
export function MiniMap({map, edges = [], rest}: {map: string; edges?: number[]; rest?: boolean}) {
  const n = Math.min(32, map.length)
  const per = map.length / n
  const lit = new Set(edges.map(e => Math.floor(e / per)))
  const cells = Array.from({length: n}, (_, i) => {
    let sum = 0
    let count = 0
    for (let k = Math.floor(i * per); k < Math.floor((i + 1) * per); k++) (sum += Number(map[k])), count++
    return count ? sum / (count * 8) : 0
  })
  return (
    <span className={`mini${rest ? ' rest' : ''}`} aria-hidden>
      {cells.map((f, i) => (
        <i key={i} className={f >= 1 ? 'done' : lit.has(i) && !rest ? 'flight' : ''} style={{opacity: f >= 1 ? undefined : 0.25 + f * 0.75}} />
      ))}
    </span>
  )
}

// ---------------------------------------------------------------- throughput chart

const nice = (max: number) => {
  if (max <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(max))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p
  return 10 * p
}

/** Sixty seconds, newest on the right, round-number gridlines; hover a second for its speed. Keeps its height while empty. */
export function Throughput({values, height = 104, label = 'speed over the last minute'}: {values: number[]; height?: number; label?: string}) {
  const [wrap, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number>()
  const n = 60
  const series = Array(Math.max(0, n - values.length)).fill(undefined).concat(values.slice(-n)) as Array<number | undefined>
  const max = nice(Math.max(0, ...values) * 1.1)
  const w = Math.max(120, width)
  const top = 6
  const bottom = height - 18
  const x = (i: number) => (i / (n - 1)) * (w - 1)
  const y = (v: number) => bottom - (v / max) * (bottom - top)
  const first = series.findIndex(v => v !== undefined)
  const pts = first < 0 ? [] : series.slice(first).map((v, k) => `${x(first + k).toFixed(1)},${y(v ?? 0).toFixed(1)}`)
  const grid = [0.5, 1].map(f => f * max)
  const at = hover !== undefined ? series[hover] : undefined
  const last = values.at(-1) ?? 0
  return (
    <div className="chart" ref={wrap}>
      <svg
        viewBox={`0 0 ${w} ${height}`}
        width={w}
        height={height}
        role="img"
        aria-label={`${t(label)}: ${t('now')} ${formatSpeed(last) || '0 B/s'}, ${t('highest')} ${formatSpeed(Math.max(0, ...values)) || '0 B/s'}`}
        onMouseMove={e => {
          const r = (e.currentTarget as SVGElement).getBoundingClientRect()
          setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))))
        }}
        onMouseLeave={() => setHover(undefined)}
      >
        {grid.map(g => (
          <g key={g}>
            <line className="gridline" x1={0} x2={w} y1={y(g)} y2={y(g)} />
            <text className="axis" x={w - 2} y={y(g) - 3} textAnchor="end">
              {formatSpeed(g)}
            </text>
          </g>
        ))}
        <line className="gridline base" x1={0} x2={w} y1={bottom} y2={bottom} />
        <text className="axis" x={0} y={height - 4}>
          {t('60 s ago')}
        </text>
        <text className="axis" x={w - 2} y={height - 4} textAnchor="end">
          {t('now')}
        </text>
        {pts.length > 1 ? (
          <>
            <path className="area" d={`M${x(first).toFixed(1)},${bottom} L${pts.join(' L')} L${x(n - 1).toFixed(1)},${bottom} Z`} />
            <path className="line" d={`M${pts.join(' L')}`} />
          </>
        ) : null}
        {hover !== undefined ? <line className="cursor" x1={x(hover)} x2={x(hover)} y1={top} y2={bottom} /> : null}
      </svg>
      <p className="chart-readout data">{hover !== undefined ? `${n - 1 - hover} s ${t('ago')} · ${at === undefined ? t('nothing yet') : formatSpeed(at) || '0 B/s'}` : `${t('now')} ${formatSpeed(last) || '0 B/s'} · ${t('highest')} ${formatSpeed(Math.max(0, ...values)) || '0 B/s'}`}</p>
    </div>
  )
}

// ---------------------------------------------------------------- connections converging into the file

export type Conn = {id: string; host: string; speed: number; range?: string; health?: 'ok' | 'slow' | 'dead' | 'backup' | 'idle'; seeder?: boolean}

/** plexo's CombineDiagram, for one network: every connection a line flowing into the file. */
export function Combine({conns, total, name, still}: {conns: Conn[]; total: number; name: string; still?: boolean}) {
  const [wrap, width] = useWidth<HTMLDivElement>()
  const shown = conns.slice(0, 12)
  const w = Math.max(260, width)
  const h = Math.max(92, shown.length * 16 + 28)
  const fx = w - 64
  const fy = h / 2
  const max = Math.max(1, ...shown.map(c => c.speed))
  return (
    <div className="combine" ref={wrap}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={`${shown.length} ${t(shown.length === 1 ? 'connection' : 'connections')} ${t('into the file')} · ${formatSpeed(total) || '0 B/s'}`}>
        {shown.map((c, i) => {
          const sy = 14 + i * ((h - 28) / Math.max(1, shown.length - 1 || 1))
          const y0 = shown.length === 1 ? fy : sy
          const live = !still && c.speed > 0 && c.health !== 'dead'
          const d = `M18,${y0} C${fx * 0.45},${y0} ${fx * 0.55},${fy} ${fx - 10},${fy}`
          return (
            <g key={c.id} className={`strand ${live ? 'live' : ''} ${c.health ?? ''}`}>
              <path className="strand-base" d={d} />
              <path className="strand-flow" d={d} style={{animationDuration: `${(1.1 + i * 0.2).toFixed(1)}s`, strokeWidth: 1 + (c.speed / max) * 1.2}} />
              <circle className="node" cx={12} cy={y0} r={2.5} />
            </g>
          )
        })}
        <g className="file-node">
          <rect x={fx - 10} y={fy - 14} width={22} height={28} />
          <path d={`M${fx + 4},${fy - 14} v6 h8`} />
        </g>
        <text className="axis" x={fx + 18} y={fy - 2}>
          {name.length > 10 ? `${name.slice(0, 9)}…` : name}
        </text>
        <text className="axis strong" x={fx + 18} y={fy + 11}>
          {formatSpeed(total) || '0 B/s'}
        </text>
      </svg>
    </div>
  )
}

/** One row per connection: host, range, speed, health; a hedge says "backup". */
export function ConnRows({conns, peers}: {conns: Conn[]; peers?: boolean}) {
  const max = Math.max(1, ...conns.map(c => c.speed))
  return (
    <table className="conns">
      <caption className="sr-only">{t(peers ? 'peers' : 'connections')}</caption>
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">{t(peers ? 'peer' : 'host')}</th>
          {peers ? null : <th scope="col">{t('range')}</th>}
          <th scope="col">{t('speed')}</th>
          <th scope="col">{t('health')}</th>
        </tr>
      </thead>
      <tbody>
        {conns.map((c, i) => (
          <tr key={c.id} className={c.health ?? ''}>
            <td className="data">{i + 1}</td>
            <td className="host" title={c.host}>
              {c.host}
            </td>
            {peers ? null : <td className="data">{c.range ?? ''}</td>}
            <td className="data speed-cell">
              <span className="bar" aria-hidden>
                <i style={{width: `${(c.speed / max) * 100}%`}} />
              </span>
              {formatSpeed(c.speed) || '0 B/s'}
            </td>
            <td>
              <span className={`health ${c.health ?? 'ok'}`}>{t(c.health === 'backup' ? 'backup' : c.health ?? (c.seeder ? 'seeder' : 'ok'))}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** A guess at health from speed alone, when the core does not say: slow under a tenth of the best. */
export function healthOf(speed: number, best: number): Conn['health'] {
  if (speed <= 0) return 'idle'
  return best > 0 && speed < best / 10 ? 'slow' : 'ok'
}

/** Re-render once a second while something moves (the chart's clock). */
export function useTick(ms = 1000): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setN(x => x + 1), ms)
    return () => clearInterval(id)
  }, [ms])
  return n
}
