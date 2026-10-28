import React, {useEffect, useState} from 'react'
import {Box} from 'ink'
import {Text} from '../text.js'
import {bridge} from '../../core/bridge.js'
import {AXIVE_PITCH, ONLY_IN_AXIVE} from '../../core/brand.js'
import {addLink, fetchKind, fetchStore, isMagnet} from '../../core/fetcher.js'
import {formatBytes, formatSpeed, truncate} from '../../core/format.js'
import {G} from '../../core/glyphs.js'
import {jobsStore, type Job} from '../../core/jobs.js'
import {loadRecent} from '../../core/ledger.js'
import {isProbablyUrl} from '../../core/platforms.js'
import {useStore} from '../../core/store.js'
import {FramedInput} from '../components/framed-input.js'
import {useSize} from '../components/fullscreen.js'
import {say} from '../components/notice.js'
import {Sigil} from '../components/sigil.js'
import {TextField} from '../components/text-field.js'
import {Bar, Comet} from '../components/viz.js'
import {useRegion} from '../mouse.js'
import {useApp} from '../context.js'
import {Action, Button, ButtonRow, Faint, Gap, Quiet, Rule} from '../kit.js'
import {guideSeen} from './guide.js'
import {useTheme} from '../theme.js'

export const TAGLINE = 'paste. draw. receive.'
// אקסיב in visual order: terminals lay Hebrew out left to right
export const NAME_HEBREW = 'ב · י · ס · ק · א'
export const DRAW_BUTTON = 'draw'

/** Every link in a paste (web addresses and magnets). */
export function linksIn(text: string): string[] {
  return [...new Set(text.split(/\s+/).map(s => s.trim()).filter(s => s && (isProbablyUrl(s) || isMagnet(s))))]
}

// the message for something that is not a link: on theme, and it sinks away by itself
const NOT_A_LINK = ['nothing answers to that. offer a full link, https://…', 'that is not a door the deep knows. paste a whole link', 'the vessel stays empty: a full link, if you please']

// what the link box takes, shown in turn while it is empty: the whole range, without a manual
export const EXAMPLES = ['https://youtube.com/watch?v=…', 'a YouTube, TikTok, X or Instagram link', 'a SoundCloud or Bandcamp track', 'any file link: .zip, .iso, .exe, .pdf…']

/** How many fetches are moving or queued: the download manager's own little count. */
export function fetchesUnderway(items: {state: string}[]): number {
  return items.filter(i => i.state === 'active' || i.state === 'waiting').length
}

type Moving = {id: string; title: string; fraction?: number; speed?: number; state: 'live' | 'rest' | 'done' | 'failed'; note: string; open: () => void}

/** One line of what moves now: mark, name, bar (or comet), speed. */
function MovingRow({m, width}: {m: Moving; width: number}) {
  const theme = useTheme()
  const {ref, hovered} = useRegion({onPress: m.open, hint: 'its details', label: m.title})
  const barW = Math.min(30, Math.max(12, Math.floor(width / 4)))
  const titleW = width - barW - 26
  return (
    <Box ref={ref} width={width} flexShrink={0}>
      <Box width={2} flexShrink={0}>
        {m.state === 'live' ? <Sigil /> : <Text color={m.state === 'failed' ? theme.signalInk : m.state === 'done' ? theme.ink : theme.ink3}>{m.state === 'failed' ? G.failed : m.state === 'done' ? G.done : G.paused}</Text>}
      </Box>
      <Box width={titleW} flexShrink={0}>
        <Text color={hovered ? theme.hover : theme.ink} wrap="truncate-end" verbatim>
          {truncate(m.title, titleW - 1)}
        </Text>
      </Box>
      <Box width={barW + 2} flexShrink={0}>{m.state === 'live' && m.fraction === undefined ? <Comet width={barW} /> : <Bar fraction={m.fraction ?? (m.state === 'done' ? 1 : 0)} width={barW} tone={m.state} />}</Box>
      <Box width={22} flexShrink={0} justifyContent="flex-end">
        <Text color={m.state === 'live' ? theme.ink : theme.ink3}>{m.note}</Text>
      </Box>
    </Box>
  )
}

const jobNote = (j: Job) => (j.state === 'running' ? formatSpeed(j.progress?.speed ?? 0) || 'opening' : j.state === 'done' ? (j.size ? formatBytes(j.size) : 'received') : j.state === 'failed' ? 'failed' : j.state === 'held' ? 'held' : j.state === 'paused' ? 'paused' : 'waiting')

export function HomeScreen({link, animated}: {link?: string; animated: boolean}) {
  const app = useApp()
  const {columns, rows} = useSize()
  const [value, setValue] = useState(link ?? '')
  const [recent] = useState(loadRecent)
  const [clipboard, setClipboard] = useState<string>()
  const [example, setExample] = useState(0)
  const [newcomer] = useState(() => !guideSeen())
  const jobs = useStore(jobsStore)
  const fetches = useStore(fetchStore).items
  const boxWidth = Math.max(24, Math.min(76, columns - 12))
  const listWidth = Math.min(columns, boxWidth + 10)

  // a link already on the clipboard is offered (read once, when home opens)
  useEffect(() => {
    // frame captures (tests, screenshots) never show what is on the clipboard
    if (process.env.AXIVE_FRAME_DUMP) return
    let live = true
    void bridge.readClipboard().then(text => {
      const clipped = text.trim()
      if (live && clipped && !/\s/.test(clipped) && isProbablyUrl(clipped)) setClipboard(clipped)
    })
    return () => {
      live = false
    }
  }, [])

  // the examples turn slowly, and only while the box is empty
  useEffect(() => {
    if (!animated || value) return
    const id = setInterval(() => setExample(i => (i + 1) % EXAMPLES.length), 3600)
    return () => clearInterval(id)
  }, [animated, value])

  const submit = (text: string) => {
    const links = linksIn(text)
    if (links.length === 0) {
      if (text.trim()) say(NOT_A_LINK[Math.floor(Math.random() * NOT_A_LINK.length)]!, 'warn', 3600)
      return
    }
    // files belong to the download manager; the rest is media
    const files = links.filter(l => fetchKind(l))
    const media = links.filter(l => !fetchKind(l))
    if (files.length && !media.length) {
      app.nav.push({name: 'fetch', add: files})
      return
    }
    if (files.length) {
      void Promise.all(files.map(l => addLink(l).catch(() => undefined))).then(() => say(`${files.length} file${files.length === 1 ? '' : 's'} handed to fetch`, 'ok', 3600))
    }
    if (media.length > 1) say(`${ONLY_IN_AXIVE.batch}. drawing the first`, 'info', 6000)
    app.offerLink(media[0]!)
  }

  const offered = clipboard && value === '' ? clipboard : undefined

  // what moves now: draws and fetches together, live first
  const moving: Moving[] = [
    ...jobs
      .filter(j => j.state !== 'cancelled' && j.state !== 'skipped')
      .map(j => ({
        id: j.id,
        title: j.title,
        fraction: j.progress?.totalBytes ? j.progress.downloadedBytes / j.progress.totalBytes : j.state === 'done' ? 1 : undefined,
        speed: j.progress?.speed,
        state: (j.state === 'running' ? 'live' : j.state === 'done' ? 'done' : j.state === 'failed' ? 'failed' : 'rest') as Moving['state'],
        note: jobNote(j),
        open: () => app.nav.push({name: 'drawing', jobId: j.id}),
        at: j.finishedAt ?? j.createdAt,
      })),
    ...fetches
      .filter(f => f.state !== 'removed')
      .map(f => ({
        id: f.gid,
        title: f.name,
        fraction: f.total ? f.done / f.total : f.state === 'done' ? 1 : undefined,
        speed: f.smooth ?? f.speed,
        state: (f.state === 'active' ? 'live' : f.state === 'done' || f.state === 'seeding' ? 'done' : f.state === 'failed' ? 'failed' : 'rest') as Moving['state'],
        note: f.state === 'active' ? formatSpeed(f.smooth ?? f.speed) || 'starting' : f.state === 'done' ? formatBytes(f.total) : f.state,
        open: () => app.nav.push({name: 'fetch'}),
        at: 0,
      })),
  ].sort((a, b) => (a.state === 'live' ? 0 : a.state === 'rest' ? 1 : 2) - (b.state === 'live' ? 0 : b.state === 'rest' ? 1 : 2))
  const room = Math.max(0, rows - 16)
  const shown = moving.slice(0, Math.min(8, room))
  const live = moving.filter(m => m.state === 'live').length

  return (
    <Box flexDirection="column" alignItems="center">
      <Gap lines={rows >= 32 ? 2 : 0} />
      <FramedInput title="Offer a link" width={boxWidth} button={DRAW_BUTTON} onButton={() => submit(value)} buttonHint="draw what you offered (↵)">
        <TextField
          value={value}
          onChange={setValue}
          onSubmit={submit}
          placeholder={EXAMPLES[example]}
          width={boxWidth - 6}
          history={recent}
          submitOnPaste={text => linksIn(text).length === 1 && !/\s/.test(text)}
          onTab={() => offered && setValue(offered)}
        />
      </FramedInput>
      <Box height={1}>
        {offered ? (
          <Box>
            <Quiet>a link waits in your clipboard · </Quiet>
            <Action onPress={() => submit(offered)} hint={offered}>
              draw it
            </Action>
            <Quiet> or tab to take it</Quiet>
          </Box>
        ) : newcomer ? (
          <Faint>new here? press ? for every key and every door</Faint>
        ) : (
          <Text> </Text>
        )}
      </Box>
      <Gap />
      <ButtonRow justify="center">
        <Button compact label="download manager" onPress={() => app.nav.push({name: 'fetch'})} hint="fetch: any file over up to 16 connections (ctrl+d)" />
        <Button compact label="tunnels" onPress={() => app.nav.push({name: 'tunnels'})} hint="every draw: pause, reorder, retry" />
        <Button compact label="settings" onPress={() => app.nav.push({name: 'settings'})} hint="where, how, and how fast" />
        <Button compact quiet label={`${G.star} Axive`} onPress={() => app.nav.push({name: 'axive'})} hint={AXIVE_PITCH} />
      </ButtonRow>
      <Gap lines={2} />
      {shown.length ? (
        <Box flexDirection="column" width={listWidth}>
          <Rule title={live ? 'now' : 'lately'} width={listWidth} right={live ? `${live} descending` : undefined} />
          {shown.map(m => (
            <MovingRow key={m.id} m={m} width={listWidth} />
          ))}
          {moving.length > shown.length ? (
            <Box marginTop={0}>
              <Action onPress={() => app.nav.push({name: 'tunnels'})}>{`and ${moving.length - shown.length} more in tunnels`}</Action>
            </Box>
          ) : null}
        </Box>
      ) : (
        <Box flexDirection="column" alignItems="center">
          <Faint>video · music · any file · 1,800+ sites · up to 1080p</Faint>
        </Box>
      )}
    </Box>
  )
}
