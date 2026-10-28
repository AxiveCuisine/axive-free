/**
 * The piece map: aria2's bitfield turned into a small row of cells, and a
 * guess at where each connection is writing.
 *
 * aria2 reports which pieces are complete (a hex bitfield, one bit per piece,
 * most significant bit first) but not where its connections are. Each
 * connection fills its segment left to right, so a run of finished pieces
 * that grew since the last look is a segment, and the first missing piece
 * after it is where that connection writes next.
 *
 * Browser-safe: no Node imports (the window uses resample and totalSpeed).
 */

/** at most this many cells reach the screens */
export const MAP_CELLS = 96

/** 0/1 per piece, from aria2's hex bitfield (missing digits read as 0) */
export function decodeBitfield(hex: string, pieces: number): Uint8Array {
  const bits = new Uint8Array(Math.max(0, pieces))
  for (let i = 0; i < bits.length; i++) {
    const digit = parseInt(hex[i >> 2] ?? '0', 16)
    bits[i] = Number.isNaN(digit) ? 0 : (digit >> (3 - (i & 3))) & 1
  }
  return bits
}

/** the pieces bucket b of `cells` covers: [start, end) */
export function bucketRange(b: number, cells: number, pieces: number): [number, number] {
  return [Math.floor((b * pieces) / cells), Math.floor(((b + 1) * pieces) / cells)]
}

/** the bucket a piece falls in */
export function bucketOf(piece: number, cells: number, pieces: number): number {
  return Math.min(cells - 1, Math.floor((piece * cells) / pieces))
}

/** a fraction in eighths: 8 only when whole, a sliver (1) when anything at all */
export function eighths(fraction: number): number {
  if (fraction >= 1) return 8
  if (fraction <= 0) return 0
  return Math.max(1, Math.min(7, Math.floor(fraction * 8)))
}

/**
 * One digit 0-8 per bucket. `partial` adds fractions (0..1) of pieces that are
 * on their way (the frontier pieces).
 */
export function bucketize(bits: Uint8Array, cells = MAP_CELLS, partial?: Map<number, number>): string {
  const pieces = bits.length
  if (!pieces) return ''
  const count = Math.min(cells, pieces)
  let out = ''
  for (let b = 0; b < count; b++) {
    const [start, end] = bucketRange(b, count, pieces)
    let have = 0
    for (let i = start; i < end; i++) have += bits[i] ? 1 : (partial?.get(i) ?? 0)
    out += String(eighths(have / (end - start)))
  }
  return out
}

/** a digit map squeezed (or kept) to fit `width` cells */
export function resample(map: string, width: number): string {
  if (!map || width <= 0) return ''
  if (map.length <= width) return map
  let out = ''
  for (let c = 0; c < width; c++) {
    const [start, end] = bucketRange(c, width, map.length)
    let sum = 0
    let full = true
    for (let i = start; i < end; i++) {
      const v = Number(map[i])
      sum += v
      if (v < 8) full = false
    }
    out += full ? '8' : String(eighths(sum / ((end - start) * 8)))
  }
  return out
}

/** the cells of a resample that hold any of the given bucket indexes */
export function resampleEdges(edges: number[], from: number, width: number): Set<number> {
  const out = new Set<number>()
  if (!from || width <= 0) return out
  for (const e of edges) out.add(from <= width ? e : bucketOf(e, width, from))
  return out
}

/**
 * Where connections are writing: the first missing piece after each run of
 * finished pieces that grew since `prev`, the fastest-growing first, at most
 * `connections` of them. Without a previous look there is nothing to compare.
 */
export function inferEdges(prev: Uint8Array | undefined, bits: Uint8Array, connections: number): number[] {
  if (!prev || prev.length !== bits.length || connections <= 0) return []
  const found: {piece: number; growth: number}[] = []
  let start = -1
  let growth = 0
  for (let i = 0; i <= bits.length; i++) {
    if (i < bits.length && bits[i]) {
      if (start < 0) (start = i), (growth = 0)
      if (!prev[i]) growth++
      continue
    }
    // a run ended at i-1; i is the first missing piece after it
    if (start >= 0 && growth > 0 && i < bits.length) found.push({piece: i, growth})
    start = -1
  }
  return found
    .sort((a, b) => b.growth - a.growth || a.piece - b.piece)
    .slice(0, connections)
    .map(f => f.piece)
    .sort((a, b) => a - b)
}

/**
 * Connections that have not finished a piece yet leave no trace in the
 * bitfield. For a plain file aria2 gives each new connection the largest
 * missing, unused gap: its first piece when the piece before it is finished
 * (nobody will run into it), else its middle (the connection before it will).
 * Replaying that rule places the `count` connections we cannot see.
 */
export function placeHidden(bits: Uint8Array, known: number[], count: number): number[] {
  const n = bits.length
  const used = new Uint8Array(n)
  for (const k of known) if (k >= 0 && k < n) used[k] = 1
  const out: number[] = []
  for (let c = 0; c < count; c++) {
    let best: [number, number] | undefined
    for (let i = 0; i < n; ) {
      if (bits[i] || used[i]) {
        i++
        continue
      }
      let j = i
      while (j + 1 < n && !bits[j + 1] && !used[j + 1]) j++
      if (!best || j - i > best[1] - best[0]) best = [i, j]
      i = j + 1
    }
    if (!best) break
    const [a, b] = best
    const pick = a === 0 || (bits[a - 1] && !used[a - 1]) ? a : a + Math.floor((b - a + 1) / 2)
    used[pick] = 1
    out.push(pick)
  }
  return out
}

export type PieceView = {map: string; edges: number[]}

/**
 * The whole step: bitfield to map and edges. Bytes received beyond whole
 * pieces are spread over the edge pieces as their partial fill. `sequential`
 * (a plain file, not a torrent) also places the connections the bitfield
 * cannot show yet.
 */
export function pieceView(bits: Uint8Array, prev: Uint8Array | undefined, connections: number, completed: number, pieceLength: number, cells = MAP_CELLS, sequential = true): PieceView {
  const pieces = bits.length
  if (!pieces) return {map: '', edges: []}
  const seen = inferEdges(prev, bits, connections)
  const frontier = sequential && connections > seen.length ? [...seen, ...placeHidden(bits, seen, connections - seen.length)].sort((a, b) => a - b) : seen
  let whole = 0
  for (let i = 0; i < pieces; i++) whole += bits[i]
  const partial = new Map<number, number>()
  if (frontier.length && pieceLength > 0) {
    const extra = Math.max(0, completed - whole * pieceLength) / frontier.length
    const fraction = Math.min(0.99, extra / pieceLength)
    if (fraction > 0) for (const p of frontier) partial.set(p, fraction)
  }
  const count = Math.min(cells, pieces)
  const edges = [...new Set(frontier.map(p => bucketOf(p, count, pieces)))]
  return {map: bucketize(bits, cells, partial), edges}
}

/** received fraction of a digit map (for a label) */
export function mapFraction(map: string): number {
  if (!map) return 0
  let sum = 0
  for (const ch of map) sum += Number(ch)
  return sum / (map.length * 8)
}

type MovingJob = {state: string; progress?: {speed?: number}}
type MovingFetch = {state: string; speed: number; smooth?: number}

/** every byte per second Axive is pulling right now: draws plus fetches */
export function totalSpeed(jobs: readonly MovingJob[], items: readonly MovingFetch[]): number {
  let sum = 0
  for (const j of jobs) if (j.state === 'running') sum += j.progress?.speed ?? 0
  for (const i of items) if (i.state === 'active') sum += i.smooth ?? i.speed
  return Number.isFinite(sum) && sum > 0 ? sum : 0
}
