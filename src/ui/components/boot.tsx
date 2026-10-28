import React, {useEffect, useMemo, useRef, useState} from 'react'
import {Box, useInput} from 'ink'
import {Text} from '../text.js'
import {scramble} from '../../core/scramble.js'
import {useTheme} from '../theme.js'
import {FullScreen} from './fullscreen.js'
import {Scrambled} from './scrambled.js'

/**
 * The opening: the ten sefirot of the tree of life light from the crown
 * down, and the twenty-two paths kindle as the flow — shefa — reaches both
 * of their ends. Any key skips it.
 */

// [column, row] in emanation order: keter, chokhmah, binah, chesed, gevurah,
// tiferet, netzach, hod, yesod, malkhut
const NODES: Array<[number, number]> = [
  [11, 0],
  [22, 2],
  [0, 2],
  [22, 6],
  [0, 6],
  [11, 8],
  [22, 10],
  [0, 10],
  [11, 12],
  [11, 14],
]
const PATHS: Array<[number, number]> = [
  [0, 1], [0, 2], [0, 5], [1, 2], [1, 5], [1, 3], [2, 5], [2, 4], [3, 4], [3, 5], [3, 6],
  [4, 5], [4, 7], [5, 6], [5, 8], [5, 7], [6, 7], [6, 8], [6, 9], [7, 8], [7, 9], [8, 9],
]
const WIDTH = 23
const HEIGHT = 15

const NODE_START_MS = 150
const NODE_GAP_MS = 120
const FLASH_MS = 220
const VERSE_AT_MS = 900
const VERSE_MS = 1200
const DEDICATION_AT_MS = 1900
const DEDICATION_MS = 600
const TOTAL_MS = 3300

const VERSE = 'and darkness was upon the face of the deep.'
// the name, quietly, and its Hebrew letters in visual order (terminals lay Hebrew out left to right)
const DEDICATION = 'a x i v e   ביסקא'

const litAt = (node: number) => NODE_START_MS + node * NODE_GAP_MS

// every cell on the grid: a sefirah, or the earliest path dotted through it
type Slot = {node?: number; path?: number}
function buildGrid(): Slot[][] {
  const grid: Slot[][] = Array.from({length: HEIGHT}, () => Array.from({length: WIDTH}, () => ({})))
  NODES.forEach(([x, y], node) => (grid[y]![x] = {node}))
  PATHS.forEach(([a, b], path) => {
    const [x0, y0] = NODES[a]!
    const [x1, y1] = NODES[b]!
    // a dot every other column sideways, every row downward
    const steps = Math.max(Math.ceil(Math.abs(x1 - x0) / 2), Math.abs(y1 - y0))
    for (let s = 1; s < steps; s++) {
      const slot = grid[Math.round(y0 + ((y1 - y0) * s) / steps)]![Math.round(x0 + ((x1 - x0) * s) / steps)]!
      if (slot.node !== undefined) continue
      if (slot.path === undefined || pathLitAt(path) < pathLitAt(slot.path)) slot.path = path
    }
  })
  return grid
}
const pathLitAt = (path: number) => Math.max(litAt(PATHS[path]![0]), litAt(PATHS[path]![1])) + 60

export function Boot({onDone}: {onDone: () => void}) {
  const theme = useTheme()
  const grid = useMemo(buildGrid, [])
  const [t, setT] = useState(0)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    const start = Date.now()
    const id = setInterval(() => {
      const elapsed = Date.now() - start
      if (elapsed >= TOTAL_MS) {
        clearInterval(id)
        doneRef.current()
      } else {
        setT(elapsed)
      }
    }, 40)
    return () => clearInterval(id)
  }, [])

  useInput(() => doneRef.current(), {isActive: Boolean(process.stdin.isTTY)})

  const faint = theme.whisper ?? theme.gray
  const cellAt = (slot: Slot): {ch: string; color?: string; dim: boolean} => {
    if (slot.node !== undefined) {
      const since = t - litAt(slot.node)
      if (since < 0) return {ch: '·', color: faint, dim: theme.dimSecondary}
      if (since < FLASH_MS) return {ch: '◉', color: theme.primary, dim: false}
      return {ch: '●', color: theme.accent, dim: false}
    }
    if (slot.path !== undefined) {
      const lit = t >= pathLitAt(slot.path)
      return {ch: '·', color: lit ? theme.gray : faint, dim: theme.dimSecondary && !lit}
    }
    return {ch: ' ', dim: false}
  }

  const verseProgress = Math.max(0, Math.min(1, (t - VERSE_AT_MS) / VERSE_MS))
  const dedicationProgress = Math.max(0, Math.min(1, (t - DEDICATION_AT_MS) / DEDICATION_MS))

  return (
    <FullScreen>
      <Box flexDirection="column" flexShrink={0}>
        {grid.map((row, y) => {
          // group same-colored runs so each row is a few spans, not 23
          const spans: Array<{text: string; color?: string; dim: boolean}> = []
          for (const slot of row) {
            const cell = cellAt(slot)
            const last = spans[spans.length - 1]
            if (last && ((last.color === cell.color && last.dim === cell.dim) || cell.ch === ' ')) last.text += cell.ch
            else spans.push({text: cell.ch, color: cell.color, dim: cell.dim})
          }
          return (
            <Text key={y}>
              {spans.map((span, i) => (
                <Text key={i} color={span.color} dimColor={span.dim}>
                  {span.text}
                </Text>
              ))}
            </Text>
          )
        })}
      </Box>
      <Text> </Text>
      <Scrambled
        cells={scramble(VERSE, verseProgress, 'in')}
        color={theme.gray}
        glyphColor={theme.accent}
        dim={theme.dimSecondary}
        italic
      />
      <Text> </Text>
      <Scrambled cells={scramble(DEDICATION, dedicationProgress, 'in')} color={theme.accent} glyphColor={theme.primary} />
    </FullScreen>
  )
}
