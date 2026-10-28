import fs from 'node:fs'
import sliceAnsi from 'slice-ansi'
import stringWidth from 'string-width'

/**
 * Ink has no idea where things end up on screen, and the terminal's own
 * selection is switched off while Axive listens to the mouse. So we keep a
 * copy of every frame Ink writes — with and without colour — which lets us
 * pull the text under a drag (to copy it) and repaint rows exactly as they
 * were once a highlight goes away.
 *
 * Frame line i is terminal row i + 1: the app draws from the top of the
 * alternate screen, and FullScreen keeps every frame one row short of the
 * window, so nothing ever scrolls.
 */

// CSI/OSC sequences ink emits (colours, cursor moves, erase lines)
const ANSI = new RegExp(
  [
    '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
    '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))',
  ].join('|'),
  'g',
)
// what log-update puts before a frame: cursor moves, line erases, sync markers
const PREFIX = /^(?:\x1b\[[0-9;]*[ABCDEFGHJK]|\x1b\[\?2026[hl])+/

export const stripAnsi = (text: string) => text.replace(ANSI, '')

export const frame = {
  raw: [] as string[],
  plain: [] as string[],
}

type Overlay = () => string
let overlay: Overlay | undefined
let realWrite: ((text: string) => void) | undefined

export function setOverlay(next: Overlay | undefined): void {
  overlay = next
}

/** Write straight to the terminal, past Ink. */
export function writeRaw(text: string): void {
  if (realWrite) realWrite(text)
  else process.stdout.write(text)
}

// AXIVE_FRAME_DUMP=<file>: every frame's text is written there (tests read it)
const dumpFile = process.env.AXIVE_FRAME_DUMP
let dumpTimer: NodeJS.Timeout | undefined
// tests click buttons by name: the shell hands over what is clickable, and where
let regionDump: (() => unknown) | undefined
export function setRegionDump(fn: (() => unknown) | undefined): void {
  regionDump = fn
}
export const frameDumping = Boolean(dumpFile)
function dump(): void {
  if (!dumpFile || dumpTimer) return
  dumpTimer = setTimeout(() => {
    dumpTimer = undefined
    try {
      fs.writeFileSync(dumpFile, frame.plain.map(line => line.trimEnd()).join('\n'))
      fs.writeFileSync(`${dumpFile}.ansi`, frame.raw.join('\n'))
      fs.writeFileSync(`${dumpFile}.json`, JSON.stringify({doubled, regions: regionDump?.() ?? []}))
    } catch {
      // a test aid only
    }
  }, 120)
}

// ---------------------------------------------------------------------------
// double height: two rows the terminal draws as one line at twice the size
// (DECDHL, ESC # 3 / ESC # 4). Ink lays them out as two ordinary, identical
// rows; here they are cut to half the width (each cell is now two wide),
// re-centred, and marked. Rows that stop being doubled are made single again
// before the next frame lands on them, or full-width text would wrap.

type GrandRect = {x: number; y: number; w: number; h: number}
let grandRect: (() => GrandRect | undefined) | undefined
let doubled: number[] = []

export function setGrandRows(get: (() => GrandRect | undefined) | undefined): void {
  grandRect = get
}

// a pair of rows Ink already laid out at half width (the masthead): only cut to half and marked
let halfRow: (() => number | undefined) | undefined
/** The masthead: the row (and the one under it) the terminal draws at double size. */
export function setHalfRows(get: (() => number | undefined) | undefined): void {
  halfRow = get
}

/** Rows drawn at double size now: a click there lands on half the column. */
export const doubledRows = (): readonly number[] => doubled

function doubleRows(lines: string[], columns: number): {pre: string; post: string} {
  const top = halfRow?.()
  if (top !== undefined && lines[top + 1] !== undefined) {
    const rows = [top, top + 1]
    const stale = doubled.filter(row => !rows.includes(row))
    const pre = stale.length ? `\x1b7${stale.map(row => `\x1b[${row + 1};1H\x1b#5`).join('')}\x1b8` : ''
    const half = Math.floor(columns / 2)
    for (const row of rows) lines[row] = sliceAnsi(lines[row]!, 0, half)
    doubled = rows
    return {pre, post: `\x1b7\x1b[${top + 1};1H\x1b#3\x1b[${top + 2};1H\x1b#4\x1b8`}
  }
  const rect = grandRect?.()
  const rows = rect && rect.h >= 2 && rect.w > 0 && lines[rect.y + 1] !== undefined ? [rect.y, rect.y + 1] : []
  const stale = doubled.filter(row => !rows.includes(row))
  const pre = stale.length ? `\x1b7${stale.map(row => `\x1b[${row + 1};1H\x1b#5`).join('')}\x1b8` : ''
  let post = ''
  if (rect && rows.length) {
    const half = Math.floor(columns / 2)
    const pad = Math.max(0, Math.floor((half - rect.w) / 2))
    const tail = Math.max(0, half - pad - rect.w)
    for (const row of rows) {
      const line = lines[row]!
      lines[row] = sliceAnsi(line, 0, pad) + sliceAnsi(line, rect.x, rect.x + rect.w) + sliceAnsi(line, rect.x + rect.w, rect.x + rect.w + tail)
    }
    post = `\x1b7\x1b[${rows[0]! + 1};1H\x1b#3\x1b[${rows[1]! + 1};1H\x1b#4\x1b8`
  }
  doubled = rows
  return {pre, post}
}

export function captureFrames<T extends NodeJS.WriteStream>(stream: T): T {
  realWrite = text => {
    stream.write(text)
  }
  return new Proxy(stream, {
    get(target, prop) {
      if (prop === 'write') {
        return (chunk: unknown, ...rest: unknown[]) => {
          let text = String(chunk)
          const prefix = PREFIX.exec(text)?.[0] ?? ''
          const lines = text.slice(prefix.length).split('\n')
          const closed = lines.at(-1) === ''
          if (closed) lines.pop()
          const isFrame = lines.some(line => stripAnsi(line).trim() !== '')
          if (isFrame) {
            const {pre, post} = grandRect || halfRow || doubled.length ? doubleRows(lines, target.columns || 80) : {pre: '', post: ''}
            if (pre || post) text = `${pre}${prefix}${lines.join('\n')}${closed ? '\n' : ''}${post}`
            frame.raw = lines
            frame.plain = lines.map(stripAnsi)
            dump()
          }
          const result = (target.write as (...args: unknown[]) => boolean)(text, ...rest)
          if (isFrame && overlay) target.write(overlay())
          return result
        }
      }
      const value = Reflect.get(target, prop)
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })
}

/** Cells [from, to) of a plain line, counting wide characters as two cells. */
export function sliceCells(line: string, from: number, to: number): string {
  let col = 0
  let out = ''
  for (const ch of line) {
    const w = Math.max(1, stringWidth(ch))
    if (col >= from && col + w <= to) out += ch
    col += w
    if (col >= to) break
  }
  return out
}

export const lineWidth = (line: string) => stringWidth(line)

export type Cell = {x: number; y: number}

/** reading order: top-left first */
export function ordered(a: Cell, b: Cell): [Cell, Cell] {
  return a.y < b.y || (a.y === b.y && a.x <= b.x) ? [a, b] : [b, a]
}

export function selectedText(a: Cell, b: Cell): string {
  const [start, end] = ordered(a, b)
  const rows: string[] = []
  for (let y = start.y; y <= end.y; y++) {
    const line = frame.plain[y] ?? ''
    const from = y === start.y ? start.x : 0
    const to = y === end.y ? end.x + 1 : lineWidth(line)
    rows.push(sliceCells(line, from, to).trimEnd())
  }
  // drop blank edges, keep inner blank lines
  while (rows.length && !rows[0]!.trim()) rows.shift()
  while (rows.length && !rows.at(-1)!.trim()) rows.pop()
  return rows.join('\n')
}

/** Escape sequence painting a selection highlight over the current frame. */
export function highlightSequence(a: Cell, b: Cell, colors: {fg: string; bg: string}): string {
  const [start, end] = ordered(a, b)
  const sgr = `\x1b[0;38;2;${hex(colors.fg)};48;2;${hex(colors.bg)}m`
  let out = '\x1b7'
  for (let y = start.y; y <= end.y; y++) {
    const line = frame.plain[y] ?? ''
    const from = y === start.y ? start.x : 0
    const to = y === end.y ? end.x + 1 : Math.max(lineWidth(line), from + 1)
    const text = sliceCells(line, from, to)
    if (!text) continue
    out += `\x1b[${y + 1};${columnOf(line, from) + 1}H${sgr}${text}\x1b[0m`
  }
  return `${out}\x1b8`
}

/** Escape sequence repainting rows [fromRow, toRow] from the last frame. */
export function repaintRows(fromRow: number, toRow: number): string {
  let out = '\x1b7'
  for (let y = Math.max(0, fromRow); y <= toRow && y < frame.raw.length; y++) {
    out += `\x1b[${y + 1};1H\x1b[0m${frame.raw[y]}\x1b[0m`
  }
  return `${out}\x1b8`
}

/** The cell where the character starting at or after cell `cell` begins. */
function columnOf(line: string, cell: number): number {
  let col = 0
  for (const ch of line) {
    if (col >= cell) return col
    col += Math.max(1, stringWidth(ch))
  }
  return cell
}

function hex(color: string): string {
  const value = /^#?([0-9a-f]{6})$/i.exec(color)?.[1] ?? 'ffffff'
  return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16)).join(';')
}
