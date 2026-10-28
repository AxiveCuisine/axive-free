/** the twenty-two letters */
export const LETTERS = [...'אבגדהוזחטיכלמנסעפצקרשת']

export const randomLetter = () => LETTERS[Math.floor(Math.random() * LETTERS.length)]!

export type Cell = {ch: string; glyph: boolean}

/**
 * One frame of text surfacing from (or sinking into) Hebrew letters, swept
 * left to right. `progress` runs 0→1. Every cell keeps its width — one
 * narrow char in, one narrow char out — so the line never shifts.
 */
export function scramble(text: string, progress: number, direction: 'in' | 'out'): Cell[] {
  const chars = [...text]
  const n = Math.max(1, chars.length)
  return chars.map((ch, i) => {
    if (ch === ' ') return {ch, glyph: false}
    const local = (progress - (i / n) * 0.7) / 0.3
    if (local > 0 && local < 1) return {ch: randomLetter(), glyph: true}
    const shown = direction === 'in' ? local >= 1 : local <= 0
    return {ch: shown ? ch : ' ', glyph: false}
  })
}
