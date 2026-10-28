import React, {useEffect, useRef, type ReactNode} from 'react'
import {Box, useInput} from 'ink'
import {Text} from '../text.js'
import {G} from '../../core/glyphs.js'
import {useRegion} from '../mouse.js'
import {useTheme} from '../theme.js'

export type ListProps<T> = {
  items: T[]
  render: (item: T, state: {selected: boolean; hovered: boolean; index: number}) => ReactNode
  selected: number
  onSelect: (index: number) => void
  onChoose: (index: number) => void
  /** space pressed (checklists) */
  onToggle?: (index: number) => void
  /** visible rows */
  limit: number
  /** whether this list takes the arrow keys */
  active?: boolean
  width?: number
  hintFor?: (item: T) => string | undefined
}

function Row({children, onPress, onWheel, hint, width}: {children: (hovered: boolean) => ReactNode; onPress: () => void; onWheel: (dir: 'up' | 'down') => void; hint?: string; width?: number}) {
  const {ref, hovered} = useRegion({onPress, onWheel, hint})
  return (
    <Box ref={ref} width={width} flexShrink={0}>
      {children(hovered)}
    </Box>
  )
}

function More({label, onPress, onWheel}: {label: string; onPress: () => void; onWheel: (dir: 'up' | 'down') => void}) {
  const theme = useTheme()
  const {ref, hovered} = useRegion({onPress, onWheel})
  return (
    <Box ref={ref} flexShrink={0}>
      <Text color={hovered ? theme.hover : theme.ink3} dimColor={theme.dimSecondary}>
        {label}
      </Text>
    </Box>
  )
}

/**
 * A scrolling list: arrows, page keys, home/end and ↵ — or the mouse: click a
 * row to choose it, the wheel to scroll, the "more" lines to page.
 */
export function List<T>({items, render, selected, onSelect, onChoose, onToggle, limit, active = true, width, hintFor}: ListProps<T>) {
  const offsetRef = useRef(0)
  const count = items.length
  const span = Math.max(1, Math.min(limit, count))

  const clamp = (index: number) => Math.max(0, Math.min(count - 1, index))
  const move = (by: number) => count && onSelect(clamp(selected + by))

  useInput(
    (input, key) => {
      if (!count) return
      if (key.upArrow) move(-1)
      else if (key.downArrow) move(1)
      else if (key.pageUp) move(-span)
      else if (key.pageDown) move(span)
      else if (key.home) onSelect(0)
      else if (key.end) onSelect(count - 1)
      else if (key.return) onChoose(selected)
      else if (input === ' ' && onToggle) onToggle(selected)
    },
    {isActive: active && Boolean(process.stdin.isTTY)},
  )

  // keep the selection on screen
  let offset = Math.min(offsetRef.current, Math.max(0, count - span))
  if (selected < offset) offset = selected
  if (selected >= offset + span) offset = selected - span + 1
  offsetRef.current = Math.max(0, offset)

  useEffect(() => {
    if (count && selected >= count) onSelect(count - 1)
  }, [count, selected, onSelect])

  const wheel = (dir: 'up' | 'down') => move(dir === 'up' ? -3 : 3)
  const visible = items.slice(offsetRef.current, offsetRef.current + span)
  const above = offsetRef.current
  const below = Math.max(0, count - offsetRef.current - span)

  return (
    <Box flexDirection="column" flexShrink={0} width={width}>
      {above > 0 ? <More label={`  ${G.up} ${above} more`} onPress={() => move(-span)} onWheel={wheel} /> : null}
      {visible.map((item, i) => {
        const index = offsetRef.current + i
        return (
          <Row key={index} onPress={() => (index === selected ? onChoose(index) : (onSelect(index), onChoose(index)))} onWheel={wheel} hint={hintFor?.(item)} width={width}>
            {hovered => render(item, {selected: index === selected, hovered, index})}
          </Row>
        )
      })}
      {below > 0 ? <More label={`  ${G.down} ${below} more`} onPress={() => move(span)} onWheel={wheel} /> : null}
    </Box>
  )
}

/** The usual row: cursor mark, then the label; bold when selected, bright when hovered. */
export function ListRow({label, selected, hovered, right, dim = false}: {label: string; selected: boolean; hovered: boolean; right?: string; dim?: boolean}) {
  const theme = useTheme()
  return (
    <>
      <Text color={theme.ink}>{selected ? '▎ ' : '  '}</Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text color={hovered ? theme.hover : selected ? theme.ink : dim ? theme.ink3 : theme.ink2} bold={selected} wrap="truncate-end">
          {label}
        </Text>
      </Box>
      {right ? (
        <Text color={theme.ink3} dimColor={theme.dimSecondary}>
          {` ${right}`}
        </Text>
      ) : null}
    </>
  )
}
