import React, {type ReactNode} from 'react'
import {Box} from 'ink'
import {Text} from './text.js'
import {plain} from '../core/words.js'
import {useRegion} from './mouse.js'
import {useTheme, type Theme} from './theme.js'

/**
 * The small pieces every screen is built from, drawn to the window's design
 * system (gui/DESIGN.md) in terminal cells: square faces, hairline rules,
 * labels in small capitals, bone for what matters and dried blood only for
 * what is alive or wrong. Anything that does something is a real button: it
 * lights up under the mouse, says what it does in the foot line, and works
 * with a click; the keyboard shortcuts are extras.
 */

// explicit blank lines: empty <Box height={1}/> spacers can collapse, and
// ink boxes default to flexShrink=1, so spacers are the first thing yoga
// crushes when content overflows the terminal
export const Gap = ({lines = 1}: {lines?: number}) => (
  <Box flexDirection="column" flexShrink={0}>
    {Array.from({length: lines}, (_, i) => (
      <Text key={i}> </Text>
    ))}
  </Box>
)

/** secondary text: labels, metadata (ink 2) */
export function Quiet({children, italic = false, wrap}: {children: ReactNode; italic?: boolean; wrap?: 'wrap' | 'truncate-end'}) {
  const theme = useTheme()
  return (
    <Text color={theme.ink2} dimColor={theme.dimSecondary} italic={italic} wrap={wrap}>
      {children}
    </Text>
  )
}

/** decoration, never needed to understand (ink 3) */
export function Faint({children, italic = false}: {children: ReactNode; italic?: boolean}) {
  const theme = useTheme()
  return (
    <Text color={theme.ink3} dimColor={theme.dimSecondary} italic={italic}>
      {children}
    </Text>
  )
}

export function Title({children}: {children: ReactNode}) {
  const theme = useTheme()
  return (
    <Text bold color={theme.ink}>
      {children}
    </Text>
  )
}

/** Bright text (bone), for values. */
export function Ink({children, bold = false, verbatim = false, wrap}: {children: ReactNode; bold?: boolean; verbatim?: boolean; wrap?: 'wrap' | 'truncate-end'}) {
  const theme = useTheme()
  return (
    <Text color={theme.ink} bold={bold} verbatim={verbatim} wrap={wrap}>
      {children}
    </Text>
  )
}

/** Something alive, or wrong: the signal as text. */
export function Live({children, bold = false}: {children: ReactNode; bold?: boolean}) {
  const theme = useTheme()
  return (
    <Text color={theme.signalInk} bold={bold}>
      {children}
    </Text>
  )
}

export type ButtonProps = {
  label: string
  onPress: () => void
  hint?: string
  /** the one thing this screen is for: a bone face */
  primary?: boolean
  /** small capitals text, no face: for the least of actions */
  quiet?: boolean
  disabled?: boolean
  /** tighter padding, for rows of many small actions */
  compact?: boolean
  /** keyboard shortcut shown faintly after the face */
  keyHint?: string
  width?: number
  /** a destructive action: red under the mouse */
  danger?: boolean
}

function faceColors(theme: Theme, {primary, quiet, disabled, hovered, danger}: {primary: boolean; quiet: boolean; disabled: boolean; hovered: boolean; danger: boolean}) {
  if (quiet) return {bg: undefined, fg: disabled ? theme.ink3 : hovered ? (danger ? theme.signalInk : theme.ink) : theme.ink2}
  if (disabled) return {bg: theme.control, fg: theme.ink3}
  if (primary) return {bg: hovered ? theme.hover : theme.ink, fg: theme.ground}
  return {bg: hovered ? theme.controlHover : theme.control, fg: hovered ? (danger ? theme.signalInk : theme.hover) : theme.ink}
}

export function Button({label, onPress, hint, primary = false, quiet = false, disabled = false, compact = false, keyHint, width, danger = false}: ButtonProps) {
  const theme = useTheme()
  const face = plain(label)
  const {ref, hovered} = useRegion({onPress: disabled ? undefined : onPress, hint, disabled, label: face})
  const pad = compact || quiet ? ' ' : '  '
  const inner = width ? Math.max(face.length, width - pad.length * 2) : face.length
  const left = Math.floor((inner - face.length) / 2)
  const text = `${pad}${' '.repeat(left)}${face}${' '.repeat(inner - face.length - left)}${pad}`
  // no colours to lean on: brackets and inverse, as terminals have always done
  if (theme.mode === 'auto') {
    return (
      <Box ref={ref} flexShrink={0}>
        <Text verbatim inverse={primary || hovered} bold={primary} dimColor={disabled}>
          {quiet ? text : `[${text}]`}
        </Text>
        {keyHint ? <Faint>{` ${keyHint}`}</Faint> : null}
      </Box>
    )
  }
  const {bg, fg} = faceColors(theme, {primary, quiet, disabled, hovered, danger})
  return (
    <Box ref={ref} flexShrink={0}>
      <Text verbatim backgroundColor={bg} color={fg} bold={primary || (hovered && !quiet)} underline={quiet && hovered}>
        {text}
      </Text>
      {keyHint ? <Faint>{` ${keyHint}`}</Faint> : null}
    </Box>
  )
}

/** A row of buttons that wraps on narrow windows. */
export function ButtonRow({children, gap = 1, justify = 'flex-start'}: {children: ReactNode; gap?: number; justify?: 'center' | 'flex-start' | 'flex-end' | 'space-between'}) {
  return (
    <Box flexWrap="wrap" justifyContent={justify} columnGap={gap} rowGap={0} flexShrink={0}>
      {children}
    </Box>
  )
}

/** A square: □ off, ■ on, the label beside it. */
export function Toggle({label, value, onChange, hint, disabled = false, width}: {label: string; value: boolean; onChange: (next: boolean) => void; hint?: string; disabled?: boolean; width?: number}) {
  const theme = useTheme()
  const {ref, hovered} = useRegion({onPress: disabled ? undefined : () => onChange(!value), hint, disabled, label: plain(label)})
  return (
    <Box ref={ref} flexShrink={0} width={width}>
      <Text color={disabled ? theme.ink3 : value ? theme.ink : hovered ? theme.ink2 : theme.ink3}>{value ? '■' : '□'} </Text>
      <Text color={disabled ? theme.ink3 : hovered ? theme.hover : value ? theme.ink : theme.ink2} wrap="truncate-end">
        {label}
      </Text>
    </Box>
  )
}

/** A value that turns to the next one when clicked: `naming    title [id] ›` */
export function Cycle<T extends string>({label, value, options, display, onChange, hint, width, labelWidth}: {label: string; value: T; options: readonly T[]; display?: (v: T) => string; onChange: (next: T) => void; hint?: string; width?: number; labelWidth?: number}) {
  const theme = useTheme()
  const next = () => onChange(options[(options.indexOf(value) + 1) % options.length]!)
  const prev = () => onChange(options[(options.indexOf(value) - 1 + options.length) % options.length]!)
  const {ref, hovered} = useRegion({onPress: next, onWheel: dir => (dir === 'up' ? prev() : next()), hint, label: plain(label)})
  return (
    <Box ref={ref} flexShrink={0} width={width}>
      <Box width={labelWidth} flexShrink={0}>
        <Text color={hovered ? theme.ink : theme.ink2}>{label} </Text>
      </Box>
      <Text color={hovered ? theme.hover : theme.ink} bold={hovered}>
        {display ? display(value) : value}
      </Text>
      <Text color={hovered ? theme.ink : theme.ink3}> ›</Text>
    </Box>
  )
}

/** Clickable text: a link-like action inside a sentence. */
export function Action({children, onPress, hint}: {children: ReactNode; onPress: () => void; hint?: string}) {
  const theme = useTheme()
  const {ref, hovered} = useRegion({onPress, hint, label: typeof children === 'string' ? plain(children) : undefined})
  return (
    <Box ref={ref} flexShrink={0}>
      <Text color={hovered ? theme.hover : theme.ink} underline>
        {children}
      </Text>
    </Box>
  )
}

/** A section label in small capitals, then a hairline: `CONNECTIONS ──────` */
export function Rule({title, width, right}: {title?: string; width: number; right?: string}) {
  const theme = useTheme()
  const text = title ? `${smallCaps(plain(title))} ` : ''
  const tail = right ? ` ${plain(right)}` : ''
  return (
    <Box width={width} flexShrink={0}>
      <Text>
        <Text color={theme.ink2} dimColor={theme.dimSecondary}>
          {text}
        </Text>
        <Text color={theme.rule} dimColor={theme.dimSecondary}>
          {'─'.repeat(Math.max(0, width - text.length - tail.length))}
        </Text>
        <Text color={theme.ink3}>{tail}</Text>
      </Text>
    </Box>
  )
}

/** Terminal small capitals: the label's letters set in capitals, a hair apart for short ones. */
export function smallCaps(text: string): string {
  return text.toUpperCase()
}

/** A label column and its value: `folder        D:\\draws   change` */
export function Field({label, width = 18, children, hint}: {label: string; width?: number; children: ReactNode; hint?: string}) {
  const theme = useTheme()
  return (
    <Box flexShrink={0}>
      <Box width={width} flexShrink={0}>
        <Text color={theme.ink2} wrap="truncate-end">
          {label}
        </Text>
      </Box>
      <Box flexShrink={1} columnGap={1}>
        {children}
      </Box>
      {hint ? <Faint>{`  ${hint}`}</Faint> : null}
    </Box>
  )
}

/** Tabs across: the chosen one in bone, a bone hairline under it. */
export function Tabs<T extends string>({items, value, onChange, width}: {items: ReadonlyArray<readonly [T, string]>; value: T; onChange: (next: T) => void; width: number}) {
  const theme = useTheme()
  const widths = items.map(([, label]) => plain(label).length + 2)
  const total = widths.reduce((a, b) => a + b, 0) + Math.max(0, items.length - 1)
  return (
    <Box flexDirection="column" flexShrink={0} width={width}>
      <Box columnGap={1}>
        {items.map(([id, label]) => (
          <Tab key={id} label={label} active={id === value} onPress={() => onChange(id)} />
        ))}
      </Box>
      <Text>
        {items.map(([id], i) => (
          <Text key={id} color={id === value ? theme.ink : theme.rule}>
            {(id === value ? '━' : '─').repeat(widths[i]!)}
            {i < items.length - 1 ? <Text color={theme.rule}>─</Text> : null}
          </Text>
        ))}
        <Text color={theme.rule}>{'─'.repeat(Math.max(0, width - total))}</Text>
      </Text>
    </Box>
  )
}

function Tab({label, active, onPress}: {label: string; active: boolean; onPress: () => void}) {
  const theme = useTheme()
  const {ref, hovered} = useRegion({onPress, label: plain(label)})
  return (
    <Box ref={ref} flexShrink={0}>
      <Text color={active ? theme.ink : hovered ? theme.hover : theme.ink2} bold={active}>
        {` ${label} `}
      </Text>
    </Box>
  )
}

/** A status word in its colour: drawing (alive), held, failed (wrong), preparing, done (bone, ∴). */
export function StateTag({state, children}: {state: 'live' | 'held' | 'failed' | 'preparing' | 'done' | 'idle'; children: ReactNode}) {
  const theme = useTheme()
  const color = state === 'live' || state === 'failed' ? theme.signalInk : state === 'done' ? theme.ink : state === 'idle' ? theme.ink3 : theme.ink2
  return (
    <Text color={color} bold={state === 'failed'}>
      {children}
    </Text>
  )
}
