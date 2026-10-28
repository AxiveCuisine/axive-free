/**
 * Every symbol Axive draws outside the block art and the Hebrew letters.
 * Windows Terminal finds a font for all of them; the old console host only
 * has what its one font carries and paints the rest as a box with a "?" —
 * so there, each one falls back to something every console font has.
 */
const RICH = {
  prompt: '❯',
  check: '✓',
  cross: '✗',
  therefore: '∴',
  dot: '·',
  video: '▶',
  audio: '♪',
  text: '¶',
  image: '◫',
  live: '◉',
  waiting: '◌',
  held: '◷',
  paused: '‖',
  done: '∴',
  failed: '✗',
  up: '▲',
  down: '▼',
  minimize: '─',
  maximize: '□',
  restore: '❐',
  close: '✕',
  boxOn: '■',
  boxOff: '·',
  arrow: '→',
  ellipsis: '…',
  scissors: '✂',
  star: '✦',
  pin: '⌖',
}

export type Glyphs = typeof RICH

const SAFE: Glyphs = {
  prompt: '>',
  check: '+',
  cross: 'x',
  therefore: ':',
  dot: '·',
  video: '►',
  audio: '♪',
  text: '¶',
  image: '■',
  live: '●',
  waiting: 'o',
  held: 'o',
  paused: '|',
  done: ':',
  failed: 'x',
  up: '▲',
  down: '▼',
  minimize: '_',
  maximize: '□',
  restore: '□',
  close: 'x',
  boxOn: '■',
  boxOff: '·',
  arrow: '>',
  ellipsis: '...',
  scissors: '%',
  star: '*',
  pin: '+',
}

export const G: Glyphs = {...RICH}

export function applySafeGlyphs(): void {
  Object.assign(G, SAFE)
}
