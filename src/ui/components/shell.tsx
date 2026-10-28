import React, {useEffect, useMemo, useState, type ReactNode} from 'react'
import {Box} from 'ink'
import {Text} from '../text.js'
import {G} from '../../core/glyphs.js'
import {sigilsFor, turn} from '../../core/sigils.js'
import {truncate} from '../../core/format.js'
import {plain} from '../../core/words.js'
import {setHalfRows} from '../frames.js'
import {useRegion} from '../mouse.js'
import {useTheme} from '../theme.js'
import {PanelSize, useTerminalSize} from './fullscreen.js'
import {Scrambled} from './scrambled.js'

/**
 * The shell every screen sits in, a held frame in four parts:
 *
 *   the header  one raised row: what moves, how fast, the phone, the ghost,
 *               and (in its own window) the window's own buttons
 *   the masthead the wordmark over the rail and the view's title beside it,
 *               both at double size where Windows Terminal draws DEC line
 *               sizes; then the title's line in italics, and a hairline
 *   the rail    every door, with its live count; the chosen one has a bone
 *               bar on its left edge (red is never selection)
 *   the foot    one raised row: the notice or the whisper, and the keys
 *               that work here
 *
 * The main panel gets the rest, and its size is what useSize() returns to
 * the screens inside it.
 */

export type ShellLayout = {columns: number; rows: number; railW: number; grand: boolean; mainW: number; bodyH: number; padX: number}

export function shellLayout(columns: number, rows: number, opts: {grandAllowed: boolean; drawerH: number}): ShellLayout {
  const railW = columns >= 118 ? 26 : columns >= 92 ? 22 : 0
  const grand = opts.grandAllowed && railW >= 26 && rows >= 30
  const mastRows = grand ? 2 : 1
  // header, masthead, its line, the hairline … the foot, the row left unused
  const bodyH = Math.max(6, rows - 1 - 1 - mastRows - 1 - 1 - 1 - opts.drawerH)
  const padX = columns >= 100 ? 3 : 2
  const mainW = Math.max(30, columns - (railW ? railW + 1 : 0) - padX * 2)
  return {columns, rows, railW, grand, mainW, bodyH, padX}
}

export function Shell({
  layout,
  header,
  title,
  sub,
  rail,
  children,
  center = false,
  drawer,
  footer,
  onHome,
}: {
  layout: ShellLayout
  header: ReactNode
  title: string
  sub?: string
  rail?: ReactNode
  children: ReactNode
  /** the draw view sits on the window's vertical axis; every other view is left-aligned */
  center?: boolean
  drawer?: ReactNode
  footer: ReactNode
  onHome: () => void
}) {
  const theme = useTheme()
  const {columns, rows, railW, grand, bodyH, padX, mainW} = layout
  // the masthead rows are the second and third of the screen
  useEffect(() => {
    if (!grand) return
    setHalfRows(() => 1)
    return () => setHalfRows(undefined)
  }, [grand])
  const panel = useMemo(() => ({columns: mainW, rows: bodyH - 1}), [mainW, bodyH])
  return (
    <Box width={columns} height={rows - 1} flexDirection="column" backgroundColor={theme.ground}>
      <Box width={columns} height={1} flexShrink={0} backgroundColor={theme.raised}>
        {header}
      </Box>
      <Masthead layout={layout} title={title} onHome={onHome} />
      <Box width={columns} height={1} flexShrink={0}>
        <Box width={railW ? railW + 1 : padX} flexShrink={0} paddingLeft={railW ? 3 : 0}>
          {railW ? <RailSigil /> : null}
        </Box>
        <Box paddingLeft={railW ? padX : 0} flexShrink={1}>
          <Text color={theme.ink2} italic wrap="truncate-end">
            {sub ? truncate(plain(sub), mainW) : ' '}
          </Text>
        </Box>
      </Box>
      <Text color={theme.rule}>{railW ? `${'─'.repeat(railW)}┬${'─'.repeat(Math.max(0, columns - railW - 1))}` : '─'.repeat(columns)}</Text>
      <Box width={columns} height={bodyH} flexShrink={0}>
        {railW ? (
          <Box width={railW + 1} height={bodyH} flexShrink={0} flexDirection="column" borderStyle="single" borderTop={false} borderBottom={false} borderLeft={false} borderColor={theme.rule} backgroundColor={theme.raised}>
            {rail}
          </Box>
        ) : null}
        <Box flexGrow={1} height={bodyH} flexDirection="column" paddingX={padX} paddingTop={1} overflow="hidden" alignItems={center ? 'center' : 'flex-start'}>
          <PanelSize.Provider value={panel}>
            <Box flexDirection="column" flexShrink={0} alignItems={center ? 'center' : 'flex-start'} width={center ? undefined : mainW}>
              {children}
            </Box>
          </PanelSize.Provider>
        </Box>
      </Box>
      {drawer ? (
        <Box width={columns} flexShrink={0} flexDirection="column" backgroundColor={theme.raised}>
          {drawer}
        </Box>
      ) : null}
      <Box width={columns} height={1} flexShrink={0} backgroundColor={theme.raised}>
        {footer}
      </Box>
    </Box>
  )
}

const WORDMARK = 'A X I V E'

/**
 * The wordmark and the view's title. At double size the row holds half as
 * many cells: Ink lays both out in the left half, frames.ts cuts the row to
 * that half and marks it, and the mouse halves its column there.
 */
function Masthead({layout, title, onHome}: {layout: ShellLayout; title: string; onHome: () => void}) {
  const theme = useTheme()
  const {columns, railW, grand, padX} = layout
  const {ref, hovered} = useRegion({onPress: onHome, hint: 'home', label: 'axive'})
  // titles are capitalised; the plain wording is keyed in lower case
  const lower = title.charAt(0).toLowerCase() + title.slice(1)
  const plainLower = plain(lower)
  const name = plainLower === lower ? plain(title) : plainLower.charAt(0).toUpperCase() + plainLower.slice(1)
  if (grand) {
    const half = Math.floor(columns / 2)
    const railHalf = railW / 2
    const titleAt = Math.ceil((railW + 1 + padX) / 2)
    const line = (
      <Box width={columns} height={1} flexShrink={0}>
        <Box ref={ref} width={railHalf} flexShrink={0} paddingLeft={1}>
          <Text color={hovered ? theme.hover : theme.ink}>{WORDMARK}</Text>
          <Text color={theme.signal}> ▪</Text>
        </Box>
        <Box width={titleAt - railHalf} flexShrink={0} />
        <Text color={theme.ink}>{truncate(name, Math.max(8, half - titleAt - 1))}</Text>
      </Box>
    )
    return (
      <Box flexDirection="column" flexShrink={0}>
        {line}
        {line}
      </Box>
    )
  }
  return (
    <Box width={columns} height={1} flexShrink={0}>
      <Box ref={ref} width={railW ? railW + 1 : WORDMARK.length + 5} flexShrink={0} paddingLeft={railW ? 3 : 2}>
        <Text color={hovered ? theme.hover : theme.ink} bold>
          {WORDMARK}
        </Text>
        <Text color={theme.signal}> ▪</Text>
      </Box>
      <Box paddingLeft={railW ? padX : 1}>
        <Text color={theme.ink} bold>
          {truncate(name, Math.max(8, columns - railW - padX * 2 - 2))}
        </Text>
      </Box>
    </Box>
  )
}

/** The name in Hebrew under the wordmark, turning slowly through its old tongues. */
function RailSigil() {
  const theme = useTheme()
  const sigils = useMemo(() => sigilsFor(false), [])
  const [state, setState] = useState<{index: number; stage: 'hold' | 'out' | 'in'; t: number}>({index: 0, stage: 'hold', t: 0})
  const animated = Boolean(process.stdout.isTTY) && !process.env.AXIVE_FRAME_DUMP
  useEffect(() => {
    if (!animated) return
    if (state.stage === 'hold') {
      const id = setTimeout(() => setState(s => ({...s, stage: 'out', t: 0})), 9000)
      return () => clearTimeout(id)
    }
    const duration = state.stage === 'out' ? 900 : 1300
    const start = Date.now()
    const id = setInterval(() => {
      const elapsed = Date.now() - start
      if (elapsed < duration) return setState(s => ({...s, t: elapsed}))
      setState(s => (s.stage === 'out' ? {index: (s.index + 1) % sigils.length, stage: 'in', t: 0} : {...s, stage: 'hold', t: 0}))
    }, 80)
    return () => clearInterval(id)
  }, [state.stage, animated])
  const sigil = sigils[state.index % sigils.length]!
  const cells = state.stage === 'hold' ? [...sigil.text].map(ch => ({ch, glyph: false})) : turn(sigil, state.t / (state.stage === 'out' ? 900 : 1300), state.stage)
  return <Scrambled cells={cells} color={theme.ink3} glyphColor={theme.signal} />
}

// ---------------------------------------------------------------- the rail

export type RailEntry = {id: string; label: string; hint: string; count?: string; tone?: 'live' | 'quiet'} | {group: string} | {gap: true}

export function Rail({entries, active, width, onChoose, foot}: {entries: RailEntry[]; active: string; width: number; onChoose: (id: string) => void; foot?: ReactNode}) {
  const theme = useTheme()
  return (
    <Box flexDirection="column" width={width} flexGrow={1} paddingTop={1}>
      {entries.map((entry, i) =>
        'gap' in entry ? (
          <Text key={i}> </Text>
        ) : 'group' in entry ? (
          <Box key={i} paddingLeft={3}>
            <Text color={theme.ink3}>{plain(entry.group).toUpperCase()}</Text>
          </Box>
        ) : (
          <RailItem key={entry.id} entry={entry} active={entry.id === active} width={width} onPress={() => onChoose(entry.id)} />
        ),
      )}
      <Box flexGrow={1} />
      {foot}
    </Box>
  )
}

function RailItem({entry, active, width, onPress}: {entry: Extract<RailEntry, {id: string}>; active: boolean; width: number; onPress: () => void}) {
  const theme = useTheme()
  const label = plain(entry.label)
  const {ref, hovered} = useRegion({onPress, hint: entry.hint, label})
  const count = entry.count ?? ''
  return (
    <Box ref={ref} width={width} flexShrink={0}>
      <Text color={active ? theme.ink : theme.raised ?? ' '}>{active ? '▎' : ' '}</Text>
      <Box width={width - 2 - count.length - 2} paddingLeft={2} flexShrink={0}>
        <Text color={active ? theme.ink : hovered ? theme.hover : theme.ink2} bold={active} wrap="truncate-end">
          {label}
        </Text>
      </Box>
      <Text color={entry.tone === 'live' ? theme.signalInk : theme.ink3}>{count}</Text>
    </Box>
  )
}

// ---------------------------------------------------------------- header pieces

/** A quiet word in the header that can be clicked: "◉ phone", "2 descending", "logs". */
export function Chip({children, onPress, hint, lit = false, label}: {children: ReactNode; onPress?: () => void; hint?: string; lit?: boolean; label?: string}) {
  const theme = useTheme()
  const {ref, hovered} = useRegion({onPress, hint, disabled: !onPress, label: label ?? (typeof children === 'string' ? plain(children) : undefined)})
  return (
    <Box ref={ref} flexShrink={0} marginRight={3}>
      <Text color={hovered ? theme.hover : lit ? theme.signalInk : theme.ink3} dimColor={!hovered && !lit && theme.dimSecondary}>
        {children}
      </Text>
    </Box>
  )
}

export function CaptionButton({glyph, onPress, hint, danger = false}: {glyph: string; onPress: () => void; hint: string; danger?: boolean}) {
  const theme = useTheme()
  const {ref, hovered} = useRegion({onPress, hint, label: hint})
  return (
    <Box ref={ref} flexShrink={0}>
      <Text color={hovered ? (danger ? '#efe7d6' : theme.ink) : theme.ink2} backgroundColor={hovered ? (danger ? '#a3141e' : theme.controlHover) : theme.raised} dimColor={!hovered && theme.dimSecondary}>
        {`  ${glyph}  `}
      </Text>
    </Box>
  )
}

export function DragArea({onDrag, onDouble}: {onDrag?: () => void; onDouble?: () => void}) {
  const {ref} = useRegion({onDown: onDrag, onDouble, disabled: !onDrag})
  return (
    <Box ref={ref} flexGrow={1} height={1}>
      <Text> </Text>
    </Box>
  )
}

/** The keys that work on this screen, at the right of the foot: `↵ draw · ctrl+d downloads · ? keys` */
export function KeyLine({keys, onGuide}: {keys: Array<[string, string]>; onGuide: () => void}) {
  const theme = useTheme()
  const {ref, hovered} = useRegion({onPress: onGuide, hint: 'every key, and every door (?)', label: '? keys'})
  return (
    <Box flexShrink={0} paddingRight={2}>
      {keys.map(([key, does]) => (
        <Box key={key} marginRight={3} flexShrink={0}>
          <Text color={theme.ink2}>{key} </Text>
          <Text color={theme.ink3}>{does}</Text>
        </Box>
      ))}
      <Box ref={ref} flexShrink={0}>
        <Text color={hovered ? theme.hover : theme.ink2}>? </Text>
        <Text color={hovered ? theme.hover : theme.ink3}>keys</Text>
      </Box>
    </Box>
  )
}

export {G}
