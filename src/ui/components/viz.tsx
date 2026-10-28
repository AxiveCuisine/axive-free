import React, {useRef, useState} from 'react'
import {Box} from 'ink'
import {Text} from '../text.js'
import {formatBytes, formatSpeed, truncate} from '../../core/format.js'
import {G} from '../../core/glyphs.js'
import {resample, resampleEdges} from '../../core/pieces.js'
import {useRegion} from '../mouse.js'
import {useTick} from '../speed.js'
import {useTheme} from '../theme.js'

/**
 * What a download looks like while it happens, in glyphs: the bar, the comet
 * while a size is unknown, the sparkline of the last minute, the piece map
 * (one cell per piece of the file, after plexo's block grid) and the
 * connection lines (after hydra's). Colour by state, never by decoration:
 * bone is what has arrived, dried blood is what is arriving now, red ░ is
 * a piece being tried again.
 */

const RICH = () => G.close === '✕'
export const PARTIAL = '▁▂▃▄▅▆▇'
const SPARK = '▁▂▃▄▅▆▇█'

export type Tone = 'live' | 'rest' | 'done' | 'failed'

/** `━━━━━━━━━──────── 52%`: heavy line received, hairline still to come. */
export function Bar({fraction, width, tone = 'live', percent = true}: {fraction: number; width: number; tone?: Tone; percent?: boolean}) {
  const theme = useTheme()
  const f = Math.max(0, Math.min(1, fraction || 0))
  const w = Math.max(4, width - (percent ? 5 : 0))
  const filled = Math.round(f * w)
  const color = tone === 'live' ? theme.signalInk : tone === 'failed' ? theme.signalInk : tone === 'done' ? theme.ink : theme.ink2
  return (
    <Text verbatim>
      <Text verbatim color={color}>{'━'.repeat(filled)}</Text>
      <Text verbatim color={theme.ruleStrong}>{'─'.repeat(w - filled)}</Text>
      {percent ? <Text verbatim color={theme.ink}>{`${Math.floor(f * 100)}%`.padStart(5)}</Text> : null}
    </Text>
  )
}

/** While the size is unknown: a short bright mark travels the track. */
export function Comet({width, animated = true}: {width: number; animated?: boolean}) {
  const theme = useTheme()
  const tick = useTick(90, animated)
  const w = Math.max(6, width)
  const len = Math.min(6, Math.floor(w / 4))
  const at = animated ? tick % (w + len) : Math.floor(w / 3)
  const cells = Array.from({length: w}, (_, i) => {
    const d = at - i
    return d >= 0 && d < len ? (d === 0 ? 'head' : 'tail') : 'track'
  })
  return (
    <Text verbatim>
      {cells.map((c, i) => (
        <Text key={i} verbatim color={c === 'head' ? theme.ink : c === 'tail' ? theme.signalInk : theme.ruleStrong}>
          {c === 'track' ? '─' : '━'}
        </Text>
      ))}
    </Text>
  )
}

/** The last minute of speed, newest on the right; the chart keeps its height while empty. */
export function Sparkline({values, width, live = false, max}: {values: number[]; width: number; live?: boolean; max?: number}) {
  const theme = useTheme()
  const w = Math.max(4, width)
  const shown = squeeze(values, w)
  const top = max ?? Math.max(1, ...shown)
  const glyphs = shown.map(v => (v <= 0 ? 0 : Math.max(1, Math.round((v / top) * 8))))
  const pad = w - glyphs.length
  return (
    <Text verbatim>
      {pad > 0 ? <Text verbatim color={theme.rule}>{'▁'.repeat(pad)}</Text> : null}
      {glyphs.map((g, i) => (
        <Text key={i} verbatim color={g === 0 ? theme.rule : live && i === glyphs.length - 1 ? theme.signalInk : theme.ink2}>
          {SPARK[Math.max(0, g - 1)]}
        </Text>
      ))}
    </Text>
  )
}

/** Average a series into `width` buckets (newest kept on the right). */
function squeeze(values: number[], width: number): number[] {
  if (values.length <= width) return values
  const out: number[] = []
  for (let b = 0; b < width; b++) {
    const from = Math.floor((b * values.length) / width)
    const to = Math.max(from + 1, Math.floor(((b + 1) * values.length) / width))
    const slice = values.slice(from, to)
    out.push(slice.reduce((a, v) => a + v, 0) / slice.length)
  }
  return out
}

/** the glyph for one cell: · waiting, ▁…▇ partly in, █ received (old consoles: ░ ▒ ▓ █) */
export function pieceGlyph(v: number, rich = RICH()): string {
  if (v >= 8) return '█'
  if (v <= 0) return rich ? '·' : '░'
  return rich ? PARTIAL[v - 1]! : v < 4 ? '▒' : '▓'
}

export type PieceGridLayout = {cols: number; rows: number; gap: number; cells: string}

/** How the map sits in `width`: cells a space apart when they fit in four rows, packed otherwise. */
export function pieceLayout(map: string, width: number, maxRows = 4): PieceGridLayout {
  const n = map.length
  if (!n) return {cols: 0, rows: 0, gap: 0, cells: ''}
  const spaced = Math.max(1, Math.floor((width + 1) / 2))
  if (Math.ceil(n / spaced) <= maxRows) {
    const rows = Math.ceil(n / spaced)
    return {cols: Math.ceil(n / rows), rows, gap: 1, cells: map}
  }
  const cols = Math.max(1, width)
  const cells = n > cols * maxRows ? resample(map, cols * maxRows) : map
  return {cols, rows: Math.ceil(cells.length / cols), gap: 0, cells}
}

/**
 * The piece map: one cell per piece (or per few), a grid of up to four rows.
 * In-flight cells breathe in dried blood; a piece that just arrived flashes
 * once before it settles to bone. Hovering a cell names it in `onHover`.
 */
export function PieceMap({
  map,
  edges = [],
  width,
  state = 'live',
  animated = true,
  onHover,
}: {
  map: string
  edges?: number[]
  width: number
  state?: Tone
  animated?: boolean
  onHover?: (cell: number | undefined, cells: number) => void
}) {
  const theme = useTheme()
  const layout = pieceLayout(map, width)
  const live = state === 'live'
  const edgeSet = state === 'done' ? new Set<number>() : layout.cells.length === map.length ? new Set(edges) : resampleEdges(edges, map.length, layout.cells.length)
  const pulse = useTick(700, animated && live && edgeSet.size > 0) % 2 === 1
  // what arrived since the last frame flashes once
  const prev = useRef<{cells: string; at: Map<number, number>}>({cells: layout.cells, at: new Map()})
  const now = Date.now()
  if (prev.current.cells !== layout.cells) {
    const before = prev.current.cells
    if (before.length === layout.cells.length)
      for (let i = 0; i < layout.cells.length; i++) if (layout.cells[i] === '8' && before[i] !== '8') prev.current.at.set(i, now)
    prev.current.cells = layout.cells
  }
  for (const [i, t] of prev.current.at) if (now - t > 600) prev.current.at.delete(i)
  useTick(300, animated && prev.current.at.size > 0)

  const {ref} = useRegion({
    onMove: onHover
      ? ({x, y}) => {
          const col = layout.gap ? Math.floor(x / 2) : x
          const index = y * layout.cols + col
          onHover(index < layout.cells.length && (!layout.gap || x % 2 === 0) ? index : undefined, layout.cells.length)
        }
      : undefined,
    onLeave: onHover ? () => onHover(undefined, layout.cells.length) : undefined,
  })

  const rows: React.ReactNode[] = []
  for (let r = 0; r < layout.rows; r++) {
    const runs: {color?: string; text: string}[] = []
    for (let c = 0; c < layout.cols; c++) {
      const i = r * layout.cols + c
      if (i >= layout.cells.length) break
      const v = Number(layout.cells[i])
      const edge = edgeSet.has(i)
      let glyph = pieceGlyph(edge && v === 0 ? 1 : v)
      let color: string | undefined
      if (edge && state === 'failed') (glyph = '░'), (color = theme.signalInk)
      else if (edge && live) color = pulse ? theme.signal : theme.signalInk
      else if (v >= 8) color = prev.current.at.has(i) && live ? theme.signalInk : live || state === 'done' ? theme.ink : theme.ink2
      else if (v === 0) color = theme.ink3
      else color = live ? theme.ink2 : theme.ink3
      const text = glyph + (layout.gap && c < layout.cols - 1 ? ' ' : '')
      const last = runs.at(-1)
      if (last && last.color === color) last.text += text
      else runs.push({color, text})
    }
    rows.push(
      <Text key={r} verbatim>
        {runs.map((run, i) => (
          <Text key={i} verbatim color={run.color}>
            {run.text}
          </Text>
        ))}
      </Text>,
    )
  }
  return (
    <Box ref={ref} flexDirection="column" flexShrink={0}>
      {rows}
    </Box>
  )
}

/** The piece map's readout: idle, it counts; hovered, it names the cell. */
export function pieceReadout({map, pieces, pieceSize, connections, edges, kind, state}: {map?: string; pieces?: number; pieceSize?: number; connections?: number; edges?: number[]; kind?: string; state?: string}, hover?: {cell: number; cells: number}): string {
  if (!map) return ''
  const n = pieces ?? map.length
  if (hover) {
    const from = Math.floor((hover.cell * n) / hover.cells)
    const to = Math.max(from, Math.floor(((hover.cell + 1) * n) / hover.cells) - 1)
    const source = hover.cells === map.length ? map : resample(map, hover.cells)
    const v = Number(source[hover.cell] ?? 0)
    const writing = (edges ?? []).some(e => Math.floor((e * hover.cells) / map.length) === hover.cell) && state === 'active'
    const label = from === to ? `piece ${from + 1}` : `pieces ${from + 1} to ${to + 1}`
    const amount = v >= 8 ? 'received' : v === 0 ? 'waiting' : `about ${Math.round((v / 8) * 100)}% in`
    return [label, amount, writing ? 'writing' : ''].filter(Boolean).join(' · ')
  }
  const writing = state === 'active' && edges?.length ? `${kind === 'file' ? '' : 'about '}${edges.length} writing` : ''
  return [`${n} piece${n === 1 ? '' : 's'}`, pieceSize ? `${formatBytes(pieceSize)} each` : '', connections ? `${connections} connection${connections === 1 ? '' : 's'}` : '', writing].filter(Boolean).join(' · ')
}

export type Connection = {uri?: string; host?: string; speed: number; range?: [number, number]; at?: number; backup?: boolean; health?: 'ok' | 'slow' | 'bad' | 'hung' | 'dead'}

/** Health from speed alone, against the median of its siblings. */
export function healthOf(speed: number, all: number[]): NonNullable<Connection['health']> {
  if (speed <= 0) return 'dead'
  const sorted = [...all].filter(v => v > 0).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? speed
  if (speed < median * 0.25) return 'bad'
  if (speed < median * 0.5) return 'slow'
  return 'ok'
}

const hostOf = (uri?: string) => {
  try {
    return uri ? new URL(uri).host : ''
  } catch {
    return uri ?? ''
  }
}

/**
 * One line per connection: health, number, host, a ten-cell bar (its cursor
 * in its own range, or its share of the fastest), range and speed.
 */
export function ConnectionLines({connections, width, limit = 8}: {connections: Connection[]; width: number; limit?: number}) {
  const theme = useTheme()
  const speeds = connections.map(c => c.speed)
  const fastest = Math.max(1, ...speeds)
  const hostW = Math.max(8, Math.min(28, width - 52))
  const shown = connections.slice(0, limit)
  return (
    <Box flexDirection="column" flexShrink={0}>
      {shown.map((c, i) => {
        const health = c.health ?? healthOf(c.speed, speeds)
        const tag = c.backup ? 'backup' : health
        const color = health === 'ok' ? theme.ink : health === 'dead' ? theme.ink3 : health === 'hung' ? theme.ink2 : theme.signalInk
        const fill = c.range && c.at !== undefined && c.range[1] > c.range[0] ? (c.at - c.range[0]) / (c.range[1] - c.range[0]) : c.speed / fastest
        const cells = Math.max(0, Math.min(10, Math.round(fill * 10)))
        return (
          <Box key={i} flexShrink={0}>
            <Box width={8} flexShrink={0}>
              <Text color={c.backup ? theme.ink2 : color}>{tag}</Text>
            </Box>
            <Box width={5} flexShrink={0}>
              <Text color={theme.ink3}>{`#${i + 1}`}</Text>
            </Box>
            <Box width={hostW + 2} flexShrink={0}>
              <Text color={theme.ink2} verbatim>
                {truncate(c.host ?? hostOf(c.uri), hostW)}
              </Text>
            </Box>
            <Text verbatim>
              <Text verbatim color={theme.ruleStrong}>[</Text>
              <Text verbatim color={health === 'ok' ? theme.ink : color}>{'▪'.repeat(cells)}</Text>
              <Text verbatim color={theme.ink3}>{'·'.repeat(10 - cells)}</Text>
              <Text verbatim color={theme.ruleStrong}>]</Text>
            </Text>
            {c.range ? <Text color={theme.ink3}>{`  ${formatBytes(c.range[0])}–${formatBytes(c.range[1])}`}</Text> : null}
            <Box flexGrow={1} />
            <Text color={c.speed > 0 ? theme.ink : theme.ink3}>{(formatSpeed(c.speed) || '0 B/s').padStart(11)}</Text>
          </Box>
        )
      })}
      {connections.length > shown.length ? <Text color={theme.ink3}>{`  and ${connections.length - shown.length} more`}</Text> : null}
    </Box>
  )
}

/** A hover readout line that holds its place: plexo's fixed line instead of tooltips. */
export function useHover(): [{cell: number; cells: number} | undefined, (cell: number | undefined, cells: number) => void] {
  const [hover, setHover] = useState<{cell: number; cells: number}>()
  return [hover, (cell, cells) => setHover(h => (cell === undefined ? undefined : h?.cell === cell && h.cells === cells ? h : {cell, cells}))]
}
