import React from 'react'
import {Text} from 'ink'
import {type Cell} from '../../core/scramble.js'

/** Renders scramble() cells as a few spans: settled text in one color, live letters in another. */
export function Scrambled({
  cells,
  color,
  glyphColor,
  dim = false,
  italic = false,
}: {
  cells: Cell[]
  color?: string
  glyphColor?: string
  dim?: boolean
  italic?: boolean
}) {
  const spans: Array<{text: string; glyph: boolean}> = []
  for (const cell of cells) {
    const last = spans[spans.length - 1]
    if (last && (last.glyph === cell.glyph || cell.ch === ' ')) last.text += cell.ch
    else spans.push({text: cell.ch, glyph: cell.glyph})
  }
  return (
    <Text>
      {spans.map((span, i) => (
        <Text key={i} color={span.glyph ? glyphColor : color} dimColor={dim} italic={italic && !span.glyph}>
          {span.text}
        </Text>
      ))}
    </Text>
  )
}
