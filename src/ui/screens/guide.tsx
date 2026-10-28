import React from 'react'
import {Box} from 'ink'
import {updateConfig, useConfig} from '../../core/config.js'
import {paths, readJson, writeFileAtomic} from '../../core/paths.js'
import {useSize} from '../components/fullscreen.js'
import {useApp, type Screen} from '../context.js'
import {Button, Faint, Gap, Quiet, Rule, Title, Toggle} from '../kit.js'
import {Text} from '../text.js'
import {useTheme} from '../theme.js'

/**
 * The ? sheet: what this screen answers to, what works everywhere, and every
 * door in Axive Free with one line on what is behind it. Opened with ? (in an
 * empty field too) or "? keys" at the foot of every screen; esc closes it.
 * Nothing here is new capability: it makes the existing capability legible.
 */

type Key = [keys: string, does: string]

const PLACE: Partial<Record<Screen['name'], string>> = {
  home: 'home',
  picking: 'a video',
  fetch: 'download manager',
  tunnels: 'tunnels',
  drawing: 'a draw',
  settings: 'settings',
  axive: 'Axive',
}

// what each screen answers to, beyond clicking its buttons
const HERE: Partial<Record<Screen['name'], Key[]>> = {
  home: [
    ['↵', 'draw what you offered'],
    ['tab', 'take the link waiting in your clipboard'],
    ['↑ ↓', 'links you offered before'],
    ['ctrl+d', 'the download manager'],
  ],
  picking: [
    ['↑ ↓', 'choose a vessel'],
    ['↵', 'draw it'],
    ['esc', 'home, with the link kept'],
  ],
  fetch: [
    ['↵', 'fetch what you offered'],
    ['paste', 'several file links at once'],
  ],
  drawing: [
    ['↵', 'draw another, once it is done'],
    ['o', 'show the file in Explorer'],
  ],
  settings: [['← →', 'the next or previous tab']],
  axive: [['↵', 'open axive.xyz']],
}

const EVERYWHERE: Key[] = [
  ['esc', 'go back, or close a sheet'],
  ['?', 'this sheet'],
  ['ctrl+n', 'a new link'],
  ['ctrl+l', 'the logs drawer'],
  ['right-click', 'paste into the field'],
  ['drag across text', 'copy it'],
]

type Door = {label: string; does: string; to: Screen}
const DOORS: Door[] = [
  {label: 'draw', does: 'draw a link: video or music from 1,800+ sites, up to 1080p', to: {name: 'home'}},
  {label: 'download manager', does: 'any file over up to 16 connections, pause and resume', to: {name: 'fetch'}},
  {label: 'tunnels', does: 'every draw in flight: pause, reorder, retry', to: {name: 'tunnels'}},
  {label: 'settings', does: 'folders, naming, speed limit, tunnels, looks', to: {name: 'settings'}},
  {label: 'Axive', does: 'the full table: 8K, playlists, Spotify, torrents, the window', to: {name: 'axive'}},
]
const ALSO = ['also from PowerShell: axive-free --help']

/** Whether the ? sheet has ever been opened (the first-run nudge on home goes quiet after). */
export function guideSeen(): boolean {
  return Boolean(readJson<{guideSeen?: boolean}>(paths.state, {}).guideSeen)
}

function markGuideSeen(): void {
  try {
    const state = readJson<Record<string, unknown>>(paths.state, {})
    if (!state.guideSeen) writeFileAtomic(paths.state, JSON.stringify({...state, guideSeen: true}))
  } catch {
    // a nicety
  }
}

function KeyRows({keys, width}: {keys: Key[]; width: number}) {
  const theme = useTheme()
  const column = Math.floor((width - 2) / 2)
  // two columns when it fits, one otherwise
  const pairs = width >= 76 ? Array.from({length: Math.ceil(keys.length / 2)}, (_, i) => [keys[i * 2]!, keys[i * 2 + 1]]) : keys.map(k => [k, undefined])
  const cell = (key: Key | undefined) =>
    key ? (
      <Box width={column} flexShrink={0} paddingRight={3}>
        <Box width={18} flexShrink={0}>
          <Text color={theme.accent}>{key[0]}</Text>
        </Box>
        <Text color={theme.primary} wrap="truncate-end">
          {key[1]}
        </Text>
      </Box>
    ) : null
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {pairs.map(([a, b], i) => (
        <Box key={i}>
          {cell(a)}
          {cell(b)}
        </Box>
      ))}
    </Box>
  )
}

export function GuideScreen({about}: {about: string}) {
  const app = useApp()
  const config = useConfig()
  const theme = useTheme()
  const {columns, rows} = useSize()
  const width = Math.max(44, Math.min(columns - 8, 96))
  React.useEffect(markGuideSeen, [])
  const here = HERE[about as Screen['name']]
  // on a short window the doors take one line each, without their description
  const roomy = rows >= 44
  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="column" alignItems="center">
        <Title>keys</Title>
        <Quiet>every key, and every door</Quiet>
      </Box>
      <Gap />
      {here ? (
        <>
          <Rule title={`here · ${PLACE[about as Screen['name']] ?? about}`} width={width} />
          <KeyRows keys={here} width={width} />
          <Gap />
        </>
      ) : null}
      <Rule title="everywhere" width={width} />
      <KeyRows keys={EVERYWHERE} width={width} />
      <Gap />
      <Rule title="every door" width={width} />
      <Box flexDirection="column" paddingLeft={2}>
        {DOORS.map(door => (
          <Box key={door.label}>
            <Box width={22} flexShrink={0}>
              <Button compact label={door.label} onPress={() => (door.to.name === 'home' ? app.nav.home() : app.nav.replace(door.to))} />
            </Box>
            {roomy || width >= 80 ? (
              <Text color={theme.gray} wrap="truncate-end">
                {door.does}
              </Text>
            ) : null}
          </Box>
        ))}
        {ALSO.map(line => (
          <Box key={line}>
            <Box width={22} flexShrink={0} />
            <Faint>{line}</Faint>
          </Box>
        ))}
      </Box>
      <Gap />
      <Rule title="words" width={width} />
      <Box paddingLeft={2} columnGap={3}>
        <Toggle label="simple language" value={config.plainWords} onChange={plainWords => updateConfig({plainWords})} hint="everyday words instead of the house's own: draw, vessel, ledger…" />
      </Box>
      <Gap />
      <Box justifyContent="center">
        <Button compact label="back" onPress={() => app.nav.back()} hint="esc" />
      </Box>
    </Box>
  )
}
