import React, {type ComponentProps} from 'react'
import {Text as InkText} from 'ink'
import {plain, plainWordsOn} from '../core/words.js'

/**
 * Ink's Text, with Simple Language: the strings it is given pass through
 * plain() before layout, so a plain screen is measured in its own words.
 * When the mode is off this is Ink's Text, untouched. `verbatim` keeps
 * what must never be reworded: what the user typed, tool output.
 */
export function Text({verbatim = false, children, ...props}: ComponentProps<typeof InkText> & {verbatim?: boolean}) {
  if (verbatim || !plainWordsOn()) return <InkText {...props}>{children}</InkText>
  return <InkText {...props}>{reword(children)}</InkText>
}

function reword(children: React.ReactNode): React.ReactNode {
  if (typeof children === 'string') return plain(children)
  if (!Array.isArray(children)) return children
  // `where shall {it} rest?` arrives in pieces: read whole sentences whole
  if (children.every(child => typeof child === 'string' || typeof child === 'number')) return plain(children.join(''))
  return children.map(child => (typeof child === 'string' ? plain(child) : child))
}
