import stringWidth from 'string-width'
import {type Cell, LETTERS} from './scramble.js'

/**
 * The line under the crest. It keeps turning: the name in Hebrew, then a word
 * from another old tongue, each sinking back into its own letters before the
 * next surfaces. Hebrew is written in visual order (terminals lay it out left
 * to right), and the first one is always the name.
 */
export type Sigil = {text: string; noise: readonly string[]; gloss: string; rich?: boolean}

const GREEK = [...'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ']
const LATIN = [...'ABCDEFGHIKLMNOPQRSTVXYZ']
const KANJI = [...'先付八寸向焚合強肴止椀香物菓子鉢蓋煮凌']

export const SIGILS: readonly Sigil[] = [
  // אקסיב — the name
  {text: 'ב · י · ס · ק · א', noise: LETTERS, gloss: 'axive'},
  // ἄξιος — worthy (of being kept)
  {text: 'Α · Ξ · Ι · Ο · Σ', noise: GREEK, gloss: 'axios, worthy'},
  // שבירה — the breaking of the vessels
  {text: 'ה · ר · י · ב · ש', noise: LETTERS, gloss: 'shevirah, the breaking of the vessels'},
  // sapor — taste
  {text: 'S · A · P · O · R', noise: LATIN, gloss: 'sapor, taste'},
  // kaiseki: the first courses
  {text: '先付 · 八寸 · 向付', noise: KANJI, gloss: 'sakizuke · hassun · mukozuke', rich: true},
  // δράκων — the great red dragon
  {text: 'Δ · Ρ · Α · Κ · Ω · Ν', noise: GREEK, gloss: 'drakon, the great red dragon'},
  // œuvre — the work
  {text: 'Œ · U · V · R · E', noise: LATIN, gloss: 'oeuvre, the work'},
  // תיקון — repair, the gathering of the light
  {text: 'ן · ו · ק · י · ת', noise: LETTERS, gloss: 'tikkun, repair'},
  // dolce — the last course
  {text: 'D · O · L · C · E', noise: LATIN, gloss: 'dolce'},
]

/** The sigils this terminal can draw: kanji need a terminal that falls back to other fonts. */
export function sigilsFor(rich: boolean): Sigil[] {
  return SIGILS.filter(s => rich || !s.rich)
}

/**
 * One frame of a sigil surfacing from (or sinking into) its own letters.
 * A wide character is only ever swapped for another wide one, so the line
 * never shifts while it turns.
 */
export function turn(sigil: Sigil, progress: number, direction: 'in' | 'out'): Cell[] {
  const chars = [...sigil.text]
  const n = Math.max(1, chars.length)
  return chars.map((ch, i) => {
    if (ch === ' ' || ch === '·') return {ch, glyph: false}
    const local = (progress - (i / n) * 0.6) / 0.4
    if (local > 0 && local < 1) {
      const pool = stringWidth(ch) === 2 ? KANJI : sigil.noise
      return {ch: pool[Math.floor(Math.random() * pool.length)]!, glyph: true}
    }
    const shown = direction === 'in' ? local >= 1 : local <= 0
    return {ch: shown ? ch : stringWidth(ch) === 2 ? '  ' : ' ', glyph: false}
  })
}
