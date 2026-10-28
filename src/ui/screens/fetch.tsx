import React, {useEffect, useRef, useState} from 'react'
import {Box, useInput} from 'ink'
import {Text} from '../text.js'
import {bridge} from '../../core/bridge.js'
import {ONLY_IN_AXIVE} from '../../core/brand.js'
import {getCategories} from '../../core/categories.js'
import {discard, discardSentence} from '../../core/discard.js'
import {updateConfig, useConfig} from '../../core/config.js'
import {
  applyFetchSettings,
  cancelFetch,
  clearFetch,
  clearFinishedFetches,
  ensureEngine,
  fetchStore,
  isMagnet,
  isTorrent,
  letGoFetch,
  openFile as openFetched,
  pauseAllFetches,
  pauseFetch,
  relinkFetch,
  relinkTarget,
  resumeAllFetches,
  resumeFetch,
  type FetchItem,
} from '../../core/fetcher.js'
import {formatBytes, formatEta, formatSpeed, truncate} from '../../core/format.js'
import {G} from '../../core/glyphs.js'
import {resample} from '../../core/pieces.js'
import {prettyPath} from '../../core/paths.js'
import {useStore} from '../../core/store.js'
import {DeleteAsk} from '../components/delete-ask.js'
import {FramedInput} from '../components/framed-input.js'
import {useSize} from '../components/fullscreen.js'
import {say} from '../components/notice.js'
import {Sigil} from '../components/sigil.js'
import {TextField} from '../components/text-field.js'
import {openUrl, reveal, useApp, useBack} from '../context.js'
import {useRegion} from '../mouse.js'
import {Button, ButtonRow, Cycle, Faint, Quiet, Rule} from '../kit.js'
import {useTheme} from '../theme.js'
import {AddCard, BatchReview} from './fetch-add.js'

const fetchTone = (item: FetchItem) => (item.state === 'active' ? 'live' : item.state === 'failed' ? 'failed' : item.state === 'done' || item.state === 'seeding' ? 'done' : 'rest') as 'live' | 'failed' | 'done' | 'rest'

/** every link in a paste the fetcher can take: http(s)/ftp addresses (magnets are caught, to say they are Axive's) */
export function fetchLinks(text: string): string[] {
  return [...new Set(text.split(/\s+/).map(s => s.trim()).filter(s => s && (isMagnet(s) || /^(https?|ftp):\/\/\S+$/i.test(s))))]
}

const percent = (item: FetchItem) => (item.total ? Math.min(1, item.done / item.total) : 0)

export function fetchStatus(item: FetchItem): string {
  switch (item.state) {
    case 'active': {
      const eta = item.eta ? `${formatEta(item.eta)} left` : ''
      const who = item.kind === 'file' ? `${item.connections} connection${item.connections === 1 ? '' : 's'}` : `${item.connections} peer${item.connections === 1 ? '' : 's'}${item.seeders !== undefined ? ` · ${item.seeders} seeding` : ''}`
      return [item.total ? `${formatBytes(item.done)} of ${formatBytes(item.total)}` : formatBytes(item.done), formatSpeed(item.smooth ?? item.speed), eta, who].filter(Boolean).join(' · ')
    }
    case 'seeding':
      return `received · sharing ${formatSpeed(item.upload) || 'quietly'}`
    case 'waiting':
      return item.held ? 'waiting for a free tunnel' : 'waiting its turn'
    case 'paused':
      return `paused${item.total ? ` at ${Math.floor(percent(item) * 100)}%` : ''}`
    case 'done':
      return `received${item.total ? ` · ${formatBytes(item.total)}` : ''}`
    case 'failed':
      return item.error ?? 'failed'
    default:
      return 'removed'
  }
}

type Filter = 'all' | 'active' | 'held' | 'done' | 'failed'
type Sort = 'state' | 'newest' | 'name' | 'size'
const inFilter = (item: FetchItem, f: Filter) =>
  f === 'all' || (f === 'active' ? item.state === 'active' : f === 'held' ? item.state === 'paused' || item.state === 'waiting' : f === 'done' ? item.state === 'done' || item.state === 'seeding' : item.state === 'failed')
const ORDER: Record<FetchItem['state'], number> = {active: 0, waiting: 1, paused: 2, seeding: 3, failed: 4, done: 5, removed: 6}

/** the row's own small map: each cell some pieces, ░ none, ▒ some, ▓ most, █ all */
function miniMap(item: FetchItem, width: number): {text: string; levels: number[]} {
  const map = item.map ? resample(item.map, width) : ''
  const levels = map ? [...map].map(Number) : Array.from({length: width}, (_, i) => (item.total && i < Math.round(percent(item) * width) ? 8 : item.state === 'done' ? 8 : 0))
  return {text: levels.map(v => (v >= 8 ? '█' : v >= 5 ? '▓' : v >= 1 ? '▒' : '░')).join(''), levels}
}

function FetchRow({item, width, selected, marked, onPress, onMark}: {item: FetchItem; width: number; selected: boolean; marked: boolean; onPress: () => void; onMark: () => void}) {
  const theme = useTheme()
  const {ref, hovered} = useRegion({onPress, onDouble: () => item.target && (item.state === 'done' || item.state === 'seeding') && openFetched(item.target), hint: fetchStatus(item), label: item.name})
  const mark = useRegion({onPress: onMark, hint: 'mark it (space): several at once', label: `mark ${item.name}`})
  const tone = fetchTone(item)
  const mapW = width >= 110 ? 18 : 12
  const mini = miniMap(item, mapW)
  const category = getCategories().find(c => c.id === item.category)?.name ?? item.kind
  const nameW = Math.max(12, width - mapW - 54)
  const stateGlyph = item.state === 'active' ? <Sigil /> : <Text color={tone === 'failed' ? theme.signalInk : tone === 'done' ? theme.ink : theme.ink3}>{item.state === 'done' ? G.done : item.state === 'seeding' ? G.live : item.state === 'failed' ? G.failed : item.state === 'paused' ? G.paused : G.waiting}</Text>
  return (
    <Box width={width} flexShrink={0}>
      <Text color={selected ? theme.ink : theme.ground}>{selected ? '▎' : ' '}</Text>
      <Box ref={mark.ref} width={2} flexShrink={0}>
        <Text color={marked ? theme.ink : mark.hovered ? theme.ink2 : theme.rule}>{marked ? '■' : '□'}</Text>
      </Box>
      <Box ref={ref} flexGrow={1}>
        <Box width={2} flexShrink={0}>
          {stateGlyph}
        </Box>
        <Box width={nameW} flexShrink={0}>
          <Text color={selected || hovered ? theme.ink : tone === 'rest' ? theme.ink2 : theme.ink} bold={selected} verbatim wrap="truncate-end">
            {item.name}
          </Text>
        </Box>
        <Box width={12} flexShrink={0}>
          <Text color={theme.ink3} wrap="truncate-end">
            {category}
          </Text>
        </Box>
        <Box width={mapW + 1} flexShrink={0}>
          <Text verbatim>
            {mini.levels.map((v, i) => (
              <Text key={i} verbatim color={v >= 8 ? (tone === 'rest' ? theme.ink2 : theme.ink) : v >= 1 ? (tone === 'live' ? theme.signalInk : theme.ink3) : theme.ruleStrong}>
                {mini.text[i]}
              </Text>
            ))}
          </Text>
        </Box>
        <Box width={5} flexShrink={0} justifyContent="flex-end">
          <Text color={theme.ink2}>{item.total ? `${Math.floor(percent(item) * 100)}%` : ''}</Text>
        </Box>
        <Box width={11} flexShrink={0} justifyContent="flex-end">
          <Text color={theme.ink3}>{item.total ? formatBytes(item.total) : ''}</Text>
        </Box>
        <Box width={12} flexShrink={0} justifyContent="flex-end">
          <Text color={item.state === 'active' ? theme.ink : theme.ink3}>{item.state === 'active' ? formatSpeed(item.smooth ?? item.speed) || '…' : item.state === 'failed' ? 'failed' : item.state === 'paused' ? 'paused' : item.state === 'waiting' ? (item.held ? 'held' : 'waiting') : item.state === 'seeding' ? 'sharing' : 'received'}</Text>
        </Box>
        <Box width={9} flexShrink={0} justifyContent="flex-end">
          <Text color={theme.ink3}>{item.state === 'active' && item.eta ? formatEta(item.eta) : ''}</Text>
        </Box>
      </Box>
    </Box>
  )
}

/** a filter word with its count, the chosen one in bone */
function FilterChip({label, count, active, onPress}: {label: string; count: number; active: boolean; onPress: () => void}) {
  const theme = useTheme()
  const {ref, hovered} = useRegion({onPress, label})
  return (
    <Box ref={ref} flexShrink={0} marginRight={2}>
      <Text color={active ? theme.ink : hovered ? theme.hover : theme.ink2} bold={active} underline={active}>
        {label}
      </Text>
      <Text color={theme.ink3}>{` ${count}`}</Text>
    </Box>
  )
}

type Mode = 'field' | 'list' | 'find' | 'relink'
type Adding = {kind: 'card'; url: string} | {kind: 'review'; urls: string[]}

/** The download manager: any file, up to 16 connections per file. */
export function FetchScreen({add}: {add?: string[]}) {
  const app = useApp()
  const config = useConfig()
  const theme = useTheme()
  const {columns, rows} = useSize()
  const status = useStore(fetchStore)
  const [value, setValue] = useState('')
  const [folder, setFolder] = useState(config.folder)
  const [mode, setMode] = useState<Mode>('field')
  const [adding, setAdding] = useState<Adding>()
  const [selected, setSelected] = useState<string>()
  const [marks, setMarks] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<Filter>('all')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState<Sort>('state')
  const [find, setFind] = useState('')
  const [relink, setRelink] = useState('')
  const [offset, setOffset] = useState(0)
  // delete asks first: only the line, or the files too
  const [asking, setAsking] = useState(false)
  const added = useRef(false)
  const width = columns

  const items = status.items.filter(i => i.state !== 'removed')
  const categories = getCategories()
  const filtered = items
    .filter(i => inFilter(i, filter) && (category === 'all' || i.category === category) && (!find || i.name.toLowerCase().includes(find.toLowerCase())))
    .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'size' ? b.total - a.total : sort === 'newest' ? (b.addedAt ?? 0) - (a.addedAt ?? 0) : ORDER[a.state] - ORDER[b.state]))
  const current = filtered.find(i => i.gid === selected) ?? filtered[0]
  const markedItems = items.filter(i => marks.has(i.gid))
  const targets = markedItems.length ? markedItems : current ? [current] : []

  // what an earlier session left shows at once; links handed over from elsewhere are looked at first
  const take = (all: string[]) => {
    // torrents and magnets are the full Axive's
    const links = all.filter(l => !isMagnet(l) && !isTorrent(l))
    if (links.length < all.length) say(`${ONLY_IN_AXIVE.torrents} (axive.xyz)`, 'info', 6000)
    if (!links.length) return
    if (links.length === 1) setAdding({kind: 'card', url: links[0]!})
    else setAdding({kind: 'review', urls: links})
  }
  useEffect(() => {
    void ensureEngine()
      .then(() => {
        if (add?.length && !added.current) {
          added.current = true
          take(add)
        }
      })
      .catch((error: unknown) => say((error as Error).message, 'error', 8000))
  }, [])

  useBack(() => {
    if (adding) return setAdding(undefined), true
    if (mode !== 'field' && mode !== 'list') return setMode('field'), true
    if (marks.size) return setMarks(new Set()), true
    if (filter !== 'all' || category !== 'all' || find) return setFilter('all'), setCategory('all'), setFind(''), true
    if (mode === 'list') return setMode('field'), true
    app.nav.back()
    return true
  })

  const submit = (text: string) => {
    const trimmed = text.trim()
    const links = fetchLinks(text)
    if (!links.length) {
      if (trimmed) say('offer a full address (https://…)', 'warn', 3600)
      return
    }
    setValue('')
    take(links)
  }

  const act = async (what: 'pause' | 'resume' | 'delete', list = targets, drive = false) => {
    const files: string[] = []
    for (const item of list) {
      try {
        if (what === 'pause' && (item.state === 'active' || item.state === 'waiting')) await pauseFetch(item.gid)
        if (what === 'resume' && (item.state === 'paused' || item.state === 'failed')) await resumeFetch(item.gid)
        if (what === 'delete' && (item.state === 'done' || item.state === 'seeding')) {
          if (!drive) await clearFetch(item.gid)
          else {
            const target = await letGoFetch(item.gid)
            if (target) files.push(target)
          }
        } else if (what === 'delete') await cancelFetch(item.gid, {keepFiles: !drive})
      } catch (error) {
        say((error as Error).message, 'warn', 4000)
      }
    }
    if (files.length) say(discardSentence(await discard(files)), 'ok', 5000)
    if (what === 'delete') setMarks(new Set())
  }

  const doRelink = (text: string) => {
    if (!current) return
    try {
      relinkTarget(text)
    } catch (error) {
      say((error as Error).message, 'warn', 3600)
      return
    }
    void relinkFetch(current.gid, text)
      .then(() => (setRelink(''), setMode('list'), say('carrying on from the new link', 'ok', 2600)))
      .catch((error: unknown) => say(`could not use that link: ${(error as Error).message}`, 'error', 6000))
  }

  useInput(
    (input, key) => {
      if (adding || mode === 'find' || mode === 'relink') return
      const listKeys = mode === 'list' || value === ''
      if (!listKeys) return
      const i = filtered.findIndex(x => x.gid === current?.gid)
      if (key.downArrow) (setMode('list'), filtered[i + 1] && setSelected(filtered[i + 1]!.gid))
      else if (key.upArrow && mode === 'list') i > 0 ? setSelected(filtered[i - 1]!.gid) : setMode('field')
      else if (mode === 'list' && input === ' ' && current) setMarks(m => (m.has(current.gid) ? (m.delete(current.gid), new Set(m)) : new Set(m.add(current.gid))))
      else if (key.ctrl && input === 'a' && mode === 'list') setMarks(new Set(filtered.map(x => x.gid)))
      else if (key.ctrl && input === 'p') void act('pause')
      else if (key.ctrl && input === 'r') void act('resume')
      else if (key.ctrl && input === 'o' && current?.target) openFetched(current.target)
      else if (key.ctrl && input === 'f' && current) reveal(current.target ?? current.dir, Boolean(current.target))
      else if (key.delete && mode === 'list' && targets.length) setAsking(true)
      else if (key.return && mode === 'list' && current?.target && (current.state === 'done' || current.state === 'seeding')) openFetched(current.target)
      else if (mode === 'list' && input === '/') setMode('find')
    },
    {isActive: Boolean(process.stdin.isTTY)},
  )

  const counts = {all: items.length, active: items.filter(i => inFilter(i, 'active')).length, held: items.filter(i => inFilter(i, 'held')).length, done: items.filter(i => inFilter(i, 'done')).length, failed: items.filter(i => inFilter(i, 'failed')).length}
  const detailH = current ? 4 : 0
  const room = Math.max(3, rows - 11 - detailH)
  const first = Math.max(0, Math.min(offset, Math.max(0, filtered.length - room)))
  const atIndex = filtered.findIndex(x => x.gid === current?.gid)
  const start = atIndex >= 0 && atIndex < first ? atIndex : atIndex >= first + room ? atIndex - room + 1 : first
  if (start !== offset) setTimeout(() => setOffset(start), 0)
  const shown = filtered.slice(start, start + room)
  const listRegion = useRegion({onWheel: dir => setOffset(o => Math.max(0, Math.min(Math.max(0, filtered.length - room), o + (dir === 'up' ? -2 : 2))))})
  const live = items.filter(i => i.state === 'active').length
  const boxWidth = Math.min(width - 10, 90)

  return (
    <Box flexDirection="column" width={width}>
      <FramedInput title="Offer a file link" width={boxWidth} button="fetch" onButton={() => submit(value)} buttonHint="look at it before it is added (↵)" onFrame={() => setMode('field')}>
        <TextField value={value} onChange={setValue} onSubmit={submit} placeholder="https://… any file: .zip, .iso, .exe, .pdf, .mp4…" width={boxWidth - 6} submitOnPaste={text => fetchLinks(text).length > 0} focus={mode === 'field' && !adding} />
      </FramedInput>
      <Box columnGap={1}>
        <Quiet>{`into ${truncate(prettyPath(folder), 34)}`}</Quiet>
        <Button compact quiet label="change" onPress={() => void bridge.pickFolder('Where fetched files rest', folder).then(f => f && setFolder(f))} hint="open the Windows folder picker" />
        <Button compact quiet label={`${G.star} torrents`} onPress={() => app.nav.push({name: 'axive', why: ONLY_IN_AXIVE.torrents})} hint="torrents and magnets come with Axive" />
      </Box>
      <Box marginTop={1} flexDirection="column" width={width}>
        {adding ? (
          adding.kind === 'card' ? (
            <AddCard url={adding.url} folder={folder} width={width} onDone={gid => (setAdding(undefined), gid && setSelected(gid))} onCancel={() => setAdding(undefined)} />
          ) : (
            <BatchReview urls={adding.urls} folder={folder} width={width} rows={rows} onDone={() => setAdding(undefined)} onCancel={() => setAdding(undefined)} />
          )
        ) : (
          <>
            <Box width={width}>
              {(['all', 'active', 'held', 'done', 'failed'] as Filter[]).map(f => (
                <FilterChip key={f} label={f} count={counts[f]} active={filter === f} onPress={() => setFilter(f)} />
              ))}
              <Box flexGrow={1} />
              <Cycle label="kind" value={category} options={['all', ...categories.map(c => c.id)]} display={id => (id === 'all' ? 'every kind' : categories.find(c => c.id === id)?.name ?? id)} onChange={setCategory} hint="files by type: compressed, programs, videos…" />
              <Box width={3} />
              <Cycle label="sort" value={sort} options={['state', 'newest', 'name', 'size'] as Sort[]} display={s => (s === 'state' ? 'by state' : s === 'newest' ? 'newest' : s === 'name' ? 'by name' : 'largest')} onChange={setSort} />
              <Box width={3} />
              {mode === 'find' ? (
                <Box>
                  <Quiet>find </Quiet>
                  <TextField value={find} onChange={setFind} onSubmit={() => setMode('list')} width={16} />
                </Box>
              ) : (
                <Button compact quiet label={find ? `find: ${truncate(find, 10)}` : 'find'} keyHint="/" onPress={() => setMode('find')} />
              )}
              {filter !== 'all' || category !== 'all' || find ? <Button compact quiet label="clear filters" onPress={() => (setFilter('all'), setCategory('all'), setFind(''))} /> : null}
            </Box>
            <Rule width={width} />
            {status.starting && !items.length ? (
              <Text>
                <Sigil />
                <Quiet> waking the engine…</Quiet>
              </Text>
            ) : status.error && !status.running ? (
              <Text color={theme.signalInk}>{status.error}</Text>
            ) : !items.length ? (
              <Box flexDirection="column">
                <Quiet>nothing yet. paste a file link above (ctrl+v).</Quiet>
                <Faint>↵ looks at it first · several links at once are reviewed together · ctrl+d opens this from anywhere</Faint>
              </Box>
            ) : !filtered.length ? (
              <Quiet>nothing matches. esc clears the filters.</Quiet>
            ) : (
              <Box ref={listRegion.ref} flexDirection="column">
                {shown.map(item => (
                  <FetchRow
                    key={item.gid}
                    item={item}
                    width={width}
                    selected={item.gid === current?.gid}
                    marked={marks.has(item.gid)}
                    onPress={() => (setSelected(item.gid), setMode('list'))}
                    onMark={() => setMarks(m => (m.has(item.gid) ? (m.delete(item.gid), new Set(m)) : new Set(m.add(item.gid))))}
                  />
                ))}
                {filtered.length > shown.length ? <Faint>{`  ${filtered.length - shown.length} more · the wheel or ↑ ↓ scroll`}</Faint> : null}
              </Box>
            )}
            {targets.length && asking ? (
              <Box marginTop={1} width={width}>
                <DeleteAsk what={targets.length === 1 ? targets[0]!.name : `${targets.length} downloads`} live={targets.some(t => t.state !== 'done' && t.state !== 'seeding')} width={width} onAnswer={drive => (setAsking(false), drive === undefined ? undefined : void act('delete', targets, drive))} />
              </Box>
            ) : targets.length ? (
              <Box marginTop={1} width={width}>
                <ButtonRow>
                  {markedItems.length ? <Text color={theme.ink}>{`${markedItems.length} marked `}</Text> : null}
                  {targets.some(t => t.state === 'active' || t.state === 'waiting') ? <Button compact label="pause" keyHint="ctrl+p" onPress={() => void act('pause')} /> : null}
                  {targets.some(t => t.state === 'paused' || t.state === 'failed') ? <Button compact label={targets.every(t => t.state === 'failed') ? 'retry' : 'resume'} keyHint="ctrl+r" onPress={() => void act('resume')} /> : null}
                  {current && !markedItems.length && current.kind === 'file' && (current.state === 'paused' || current.state === 'failed') ? <Button compact label="new link" onPress={() => (setRelink(''), setMode('relink'))} hint="the link expired? paste a fresh one and keep what is already here" /> : null}
                  <Button compact danger label={`${G.close} ${targets.every(t => t.state === 'done' || t.state === 'seeding') ? 'delete' : 'cancel'}`} keyHint="del" onPress={() => setAsking(true)} hint="asks first: only from the list, or the file too" />
                  {markedItems.length ? <Button compact quiet label="unmark" onPress={() => setMarks(new Set())} /> : null}
                </ButtonRow>
              </Box>
            ) : null}
            {mode === 'relink' && current ? (
              <Box columnGap={1}>
                <Quiet>new link</Quiet>
                <TextField value={relink} onChange={setRelink} onSubmit={doRelink} placeholder="https://… a fresh link to the same file" width={Math.max(16, width - 34)} submitOnPaste={text => /^https?:\/\/\S+$/i.test(text.trim())} />
                <Button compact primary label="use it" onPress={() => doRelink(relink)} hint="carry on from the new link; what is already here stays" />
                <Button compact quiet label="never mind" onPress={() => setMode('list')} />
              </Box>
            ) : null}
            {current ? (
              <Box marginTop={1} flexDirection="column" width={width}>
                <Rule title={truncate(current.name, 60)} width={width} right={current.state === 'active' ? fetchStatus(current) : undefined} />
                {current.warning ? <Text color={theme.signalInk}>{`${G.cross} ${current.warning}`}</Text> : null}
                {current.state === 'failed' ? <Text color={theme.signalInk}>{current.error ?? 'failed'}</Text> : null}
                <ButtonRow>
                  {current.target && current.state === 'done' ? <Button compact label="open" keyHint="ctrl+o" onPress={() => openFetched(current.target!)} /> : null}
                  <Button compact quiet label="show in folder" keyHint="ctrl+f" onPress={() => reveal(current.target ?? current.dir, Boolean(current.target))} />
                  {current.state === 'active' ? <Faint>{` ${G.dot} Axive shows each connection and its piece map`}</Faint> : null}
                </ButtonRow>
              </Box>
            ) : null}
          </>
        )}
      </Box>
      <Box marginTop={1} columnGap={2}>
        <Cycle label="side by side" value={String(config.tunnels)} options={['1', '2']} onChange={v => (updateConfig({tunnels: Number(v)}), void applyFetchSettings())} hint="how many run at once (Axive runs up to 4)" />
        <Cycle label="connections" value={String(config.fetchConnections)} options={['4', '8', '16']} onChange={v => (updateConfig({fetchConnections: Number(v)}), void applyFetchSettings())} hint="parallel streams per file: more is faster on servers that allow it" />
        <ButtonRow>
          {live ? <Button compact quiet label="pause all" onPress={() => void pauseAllFetches()} /> : null}
          {items.some(i => i.state === 'paused') ? <Button compact quiet label="resume all" onPress={() => void resumeAllFetches()} /> : null}
          {items.some(i => i.state === 'done' || i.state === 'failed') ? <Button compact quiet label="clear finished" onPress={() => void clearFinishedFetches()} hint="tidy the list (files stay)" /> : null}
        </ButtonRow>
      </Box>
    </Box>
  )
}
