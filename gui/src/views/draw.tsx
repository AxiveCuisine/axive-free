import React, {useEffect, useRef, useState} from 'react'
import {formatBytes, formatDuration} from '../../../src/core/format.js'
import {attempt, call, categoriesOf, queuesOf, recalled, remember, say, t, useAxive} from '../state.js'
import {Button, Choice, Field, Scrambled, Select, Sheet, Thumb, Toggle, formatTime, parseTime} from '../ui.js'
import {DiscView, ToolsView, pickDiscFolder, pickMediaFile, readDisc, type Disc, type MediaKind} from './tools.js'
import {FREE} from '../edition.js'

/**
 * The one way in (D1): paste, drop, the extension, the phone, the ghost and
 * ctrl+v all land here. Axive reads what was offered and answers with the
 * right sheet: a video's vessels, a playlist's checklist, a Spotify list,
 * search results, a file's probe (size, resume, type, folder, queue), many
 * files to review, a file you already have, a disc.
 */

type Video = {
  kind: 'video'
  id: string
  url: string
  title: string
  uploader?: string
  duration?: number
  site?: string
  uploaded?: string
  thumbnail?: string
  thumbnails: {url: string; width?: number; height?: number}[]
  chapters: {start: number; end?: number; title?: string}[]
  choices: {label: string; kind: string; size?: number; height?: number}[]
  /** several audio tracks (YouTube dubs): the original or default first; absent with one */
  audioTracks?: {id: string; name: string; kind: string; label: string; isDefault: boolean}[]
  duplicate?: {at: number; filepath?: string; exists: boolean}
  free?: number
}
type Entry = {id?: string; url: string; title: string; duration?: number; uploader?: string; site?: string}
type Probed = {url: string; size?: number; resumable?: boolean; filename?: string; mime?: string; category?: string; error?: string; exists?: boolean}
export type Result =
  | Video
  | {kind: 'playlist'; playlist: {title: string; uploader?: string; url: string; isChannel: boolean; entries: Entry[]}}
  | {kind: 'spotify'; id: string; label: string; count: number; tracks: {title: string; artists: string[]; durationMs: number}[]}
  | {kind: 'search'; query: string; results: Entry[]}
  | {kind: 'batch'; urls: string[]; title?: string}
  | {kind: 'fetch'; count: number}
  | {kind: 'files'; items: Probed[]; media: string[]; title?: string}
  | {kind: 'torrent'; url: string; name: string; files: {index: number; path: string; size: number}[]}
  | {kind: 'file'; path: string; media?: MediaKind; targets: {id: string; label: string}[]}
  | ({kind: 'disc'} & Omit<Disc, 'kind'> & {disc: Disc['kind']})

const EXAMPLES = FREE
  ? ['https://… a video, a song, a file', 'a YouTube, TikTok, X or Instagram link', 'a link straight to a file: .zip, .iso, .mp4…']
  : ['https://… a video, a playlist, a file', 'a YouTube, TikTok, X or Instagram link', 'a Spotify track, album or playlist', 'a magnet, a .torrent, any file link', 'several links at once, or file[001-120].jpg', 'or words to search YouTube']

const VESSELS = ['1080', 'best', '720', '480', 'mp3', 'm4a'] as const
const vesselName = (v: string) => (v === 'best' ? 'best video' : v === 'mp3' || v === 'm4a' ? `audio · ${v}` : `video ≤ ${v}p`)

function nextAt(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  const at = new Date()
  at.setHours(h ?? 2, m ?? 0, 0, 0)
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1)
  return at.getTime()
}

type Where = {folder: string; queueId: string; later: boolean}

/** Where it rests, which tunnel it joins, now or later: always in view, changed in place. */
function WhereRow({where, set, noLater}: {where: Where; set: (w: Where) => void; noLater?: boolean}) {
  const queues = useAxive(queuesOf)
  const offPeak = useAxive(s => String(s.config.offPeak ?? '02:00'))
  const q = queues.find(x => x.id === where.queueId) ?? queues[0]
  return (
    <div className="where">
      <div className="where-line">
        <span className="label">{t('rests in')}</span>
        <span className="path data selectable" title={where.folder}>
          {where.folder}
        </span>
        <Button kind="quiet" icon="folder" hint="open the Windows folder picker" onClick={() => void attempt(async () => {
          const {path} = await call<{path: string | null}>('pick-folder', {title: 'Where should this draw rest?', initial: where.folder})
          if (path) set({...where, folder: path})
        })}>
          change
        </Button>
      </div>
      <div className="where-line">
        {queues.length > 1 ? (
          <>
            <span className="label">{t('tunnel')}</span>
            <Select label="tunnel" value={where.queueId} options={queues.map(x => x.id)} show={id => queues.find(x => x.id === id)?.name ?? id} onChange={queueId => set({...where, queueId})} />
          </>
        ) : null}
        {noLater || FREE ? null : <Toggle label={q?.schedule.on && q.schedule.start ? `later: when ${q.name} opens (${q.schedule.start})` : `hold until off-peak (${offPeak})`} value={where.later} onChange={later => set({...where, later})} hint="queue it now, start at night. leave Axive open" />}
      </div>
    </div>
  )
}

function useWhere(): [Where, (w: Where) => void, () => number | undefined] {
  const folder = useAxive(s => String(s.config.folder ?? ''))
  const offPeak = useAxive(s => String(s.config.offPeak ?? '02:00'))
  const queues = useAxive(queuesOf)
  const [where, setWhere] = useState<Where>({folder, queueId: queues[0]?.id ?? 'main', later: false})
  const startAt = () => {
    if (!where.later) return undefined
    const q = queues.find(x => x.id === where.queueId)
    return nextAt(q?.schedule.on && q.schedule.start ? q.schedule.start : offPeak)
  }
  return [where, setWhere, startAt]
}

/** A vessel as it is remembered: its kind and height (video:1080, audio:), whatever its label says today. */
const vesselKey = (c?: {kind: string; height?: number}) => (c ? `${c.kind}:${c.height ?? ''}` : '')

function VideoView({video, onDone}: {video: Video; onDone: (drew?: boolean) => void}) {
  // the vessel chosen last time, when this video offers it
  const [selected, setSelected] = useState(() => Math.max(0, video.choices.findIndex(c => vesselKey(c) === recalled('vessel', ''))))
  const [where, setWhere, startAt] = useWhere()
  const [trim, setTrim] = useState(false)
  const [from, setFrom] = useState('0:00')
  const [to, setTo] = useState(video.duration ? formatTime(video.duration) : '')
  const [precise, setPrecise] = useState(false)
  const [split, setSplit] = useState(false)
  const [cover, setCover] = useState<string>()
  const [busy, setBusy] = useState(false)
  const tracks = video.audioTracks ?? []
  const [track, setTrack] = useState(() => tracks[0]?.id ?? '')
  const [inspect, setInspect] = useState<{formatId: string; resolution: string; vcodec: string; acodec: string; size?: number; filename: string} | 'asking' | string>()
  const choice = video.choices[selected]
  const media = choice && (choice.kind === 'video' || choice.kind === 'audio')
  const start = parseTime(from)
  const end = parseTime(to)
  const validTrim = start !== undefined && end !== undefined && end > start && (!video.duration || start < video.duration)
  const tooBig = choice?.size && video.free !== undefined && choice.size * 1.05 > video.free
  useEffect(() => setInspect(undefined), [selected, track])

  const draw = () =>
    void attempt(async () => {
      if (trim && !validTrim) throw new Error('start and end like 1:23 or 0:01:23, the end after the start')
      setBusy(true)
      try {
        await call('draw', {
          id: video.id,
          choice: selected,
          ...(media && track ? {audioTrack: track} : {}),
          folder: where.folder,
          queueId: where.queueId,
          startAt: startAt(),
          options: {sections: trim && media ? {start, end: video.duration ? Math.min(end!, video.duration) : end, precise} : undefined, splitChapters: split, thumbnailUrl: cover},
        })
        if (choice && (choice.kind === 'video' || choice.kind === 'audio')) remember({vessel: vesselKey(choice)})
        onDone(true)
      } finally {
        setBusy(false)
      }
    })

  // ↑ ↓ choose, ↵ draws: the keyboard path through the vessels
  const keys = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return
    if (e.key === 'ArrowDown') (setSelected(i => Math.min(video.choices.length - 1, i + 1)), e.preventDefault())
    if (e.key === 'ArrowUp') (setSelected(i => Math.max(0, i - 1)), e.preventDefault())
    if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button:not([role="radio"])')) (e.preventDefault(), draw())
  }

  return (
    <div className="vessel-view" onKeyDown={keys}>
      <div className="vessel-side">
        <Thumb src={cover ?? video.thumbnail} alt="" className="poster lit" />
        <h3 className="section-title selectable">{video.title}</h3>
        <dl className="facts">
          {video.uploader ? (
            <>
              <dt>{t('channel')}</dt>
              <dd>{video.uploader}</dd>
            </>
          ) : null}
          {video.duration ? (
            <>
              <dt>{t('length')}</dt>
              <dd>{formatDuration(video.duration)}</dd>
            </>
          ) : null}
          {video.site ? (
            <>
              <dt>{t('site')}</dt>
              <dd>{video.site}</dd>
            </>
          ) : null}
          {video.uploaded ? (
            <>
              <dt>{t('uploaded')}</dt>
              <dd>{`${video.uploaded.slice(0, 4)}-${video.uploaded.slice(4, 6)}-${video.uploaded.slice(6, 8)}`}</dd>
            </>
          ) : null}
        </dl>
        {video.duplicate ? (
          <p className="meta">
            ∴ {t(`you drew this ${agoText(video.duplicate.at)}${video.duplicate.exists ? '' : ' (the file is gone)'}`)}{' '}
            {video.duplicate.exists && video.duplicate.filepath ? (
              <button className="link" type="button" onClick={() => void attempt(() => call('open', {path: video.duplicate!.filepath}))}>
                {t('open it')}
              </button>
            ) : null}
          </p>
        ) : null}
        {video.thumbnails.length > 1 && !FREE ? (
          <div>
            <div className="label">{t('cover')}</div>
            <div className="covers">
              {video.thumbnails.slice(0, 6).map(th => (
                <button key={th.url} type="button" className="cover" onClick={() => setCover(cover === th.url ? undefined : th.url)} aria-pressed={cover === th.url} aria-label={`${t('cover')} ${th.width ?? ''} × ${th.height ?? ''}`} data-tip={t('the draw carries this image as its cover')}>
                  <Thumb src={th.url} alt="" className={cover === th.url ? 'lit' : ''} />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="vessel-main">
        <div className="label" id="vessels-label">
          {t('Vessels')}
        </div>
        <div className="vessels" role="radiogroup" aria-labelledby="vessels-label">
          {video.choices.map((c, i) => {
            const [name, size] = c.label.split(' · ~')
            return (
              <button key={i} type="button" role="radio" aria-checked={i === selected} tabIndex={i === selected ? 0 : -1} onClick={() => setSelected(i)} onDoubleClick={draw} data-tip={t(c.kind === 'transcript' ? 'the words, as plain text' : c.kind === 'subtitles' ? 'timed subtitles, .srt' : `draw as ${c.label}`)}>
                <span className="vk" aria-hidden>
                  {c.kind === 'audio' ? '♪' : c.kind === 'video' ? '▶' : '¶'}
                </span>
                <span>{name}</span>
                <span className="size">{size ? `~${size}` : ''}</span>
              </button>
            )
          })}
        </div>
        {choice?.size ? (
          <p className={`meta ${tooBig ? 'err' : ''}`}>
            {`≈ ${formatBytes(choice.size)}${video.free !== undefined ? ` · ${formatBytes(video.free)} free` : ''}${tooBig ? ` · ${t('not enough room')}` : ''}`}
          </p>
        ) : null}

        {media && tracks.length > 1 ? (
          <div className="sound-track">
            <label className="label" htmlFor="audio-track">
              {t('sound')}
            </label>
            <span className="select-wrap">
              <select id="audio-track" className="select" value={track} onChange={e => setTrack(e.target.value)} data-tip={t('this video has more than one audio track: choose the language you want')}>
                {tracks.map(a => (
                  <option key={a.id} value={a.id}>
                    {t(a.label)}
                    {a.isDefault && a.kind !== 'original' ? ` (${t('default')})` : ''}
                  </option>
                ))}
              </select>
            </span>
            <span className="meta">{t(`${tracks.length} audio tracks`)}</span>
          </div>
        ) : null}

        {media && !FREE ? (
          <div className="options">
            <Toggle label="trim" value={trim} onChange={setTrim} hint="draw only a part: start and end" />
            {trim ? (
              <div className="stack trim-box">
                <div className="times">
                  <Field label="from" value={from} onChange={setFrom} placeholder="0:00" width={96} />
                  <span className="meta" aria-hidden>
                    →
                  </span>
                  <Field label="to" value={to} onChange={setTo} placeholder="1:30" width={96} />
                  {validTrim ? <span className="data">{formatTime((video.duration ? Math.min(end!, video.duration) : end!) - start!)}</span> : null}
                </div>
                {video.duration ? (
                  <div className="timeline" aria-hidden>
                    <div className="track" />
                    {video.chapters.map(c => (
                      <div key={c.start} className="chap" style={{left: `${(c.start / video.duration!) * 100}%`}} />
                    ))}
                    {validTrim ? <div className="span" style={{left: `${(start! / video.duration) * 100}%`, width: `${((Math.min(end!, video.duration) - start!) / video.duration) * 100}%`}} /> : null}
                  </div>
                ) : null}
                {video.chapters.length > 1 ? (
                  <div className="row-gap">
                    {video.chapters.slice(0, 8).map(c => (
                      <Button key={c.start} kind="quiet" hint={`${formatTime(c.start)} to ${c.end ? formatTime(c.end) : 'the end'}`} onClick={() => (setFrom(formatTime(c.start)), setTo(formatTime(c.end ?? video.duration ?? c.start + 60)))}>
                        {c.title?.slice(0, 24) || formatTime(c.start)}
                      </Button>
                    ))}
                  </div>
                ) : null}
                <Toggle label={precise ? 'exact cut (re-encodes, slower)' : 'lossless (instant, starts at the nearest keyframe)'} value={precise} onChange={setPrecise} hint="lossless copies the streams untouched: seconds even for 4K. exact lands on the very frame." />
              </div>
            ) : null}
            {video.chapters.length > 1 ? <Toggle label={`split into its ${video.chapters.length} chapters`} value={split} onChange={setSplit} hint={video.chapters.slice(0, 4).map(c => c.title).join(' · ')} /> : null}
            {inspect === undefined ? (
              <Button kind="quiet" icon="eye" hint="nothing is drawn: this is what would happen" onClick={() => void (async () => {
                setInspect('asking')
                try {
                  setInspect(await call('inspect', {id: video.id, choice: selected, ...(media && track ? {audioTrack: track} : {})}))
                } catch (e) {
                  setInspect((e as Error).message)
                }
              })()}>
                inspect
              </Button>
            ) : null}
          </div>
        ) : null}
        {inspect !== undefined ? (
          <div className="inspect">
            {inspect === 'asking' ? (
              <p className="meta">
                <Scrambled text={t('asking yt-dlp…')} />
              </p>
            ) : typeof inspect === 'string' ? (
              <p className="err">{t(inspect)}</p>
            ) : (
              <dl className="facts">
                <dt>{t('formats')}</dt>
                <dd className="data">{`${inspect.formatId} · ${inspect.resolution}${inspect.vcodec && inspect.vcodec !== 'none' ? ` · ${inspect.vcodec.split('.')[0]}` : ''}${inspect.acodec && inspect.acodec !== 'none' ? ` + ${inspect.acodec.split('.')[0]}` : ''}`}</dd>
                <dt>{t('size')}</dt>
                <dd className="data">{inspect.size ? `≈ ${formatBytes(inspect.size)}` : t('unknown until it starts')}</dd>
                <dt>{t('file')}</dt>
                <dd className="selectable">{inspect.filename.split(/[\\/]/).pop()}</dd>
              </dl>
            )}
          </div>
        ) : null}

        <WhereRow where={where} set={setWhere} />
        <div className="actions">
          <Button kind="primary" onClick={draw} disabled={busy || !choice} hint="↵">
            draw
          </Button>
          <Button kind="quiet" onClick={() => onDone()} hint="esc">
            back
          </Button>
        </div>
      </div>
    </div>
  )
}

const agoText = (at: number) => {
  const s = (Date.now() - at) / 1000
  if (s < 60) return 'moments ago'
  for (const [size, name] of [[31_536_000, 'year'], [2_592_000, 'month'], [86_400, 'day'], [3600, 'hour'], [60, 'minute']] as const) if (s >= size) return `${Math.floor(s / size)} ${name}${Math.floor(s / size) === 1 ? '' : 's'} ago`
  return 'moments ago'
}

/** A range like "1-10, 15, 20-": the TUI's playlist selector, typed. */
function parseRange(text: string, count: number): Set<number> | undefined {
  const out = new Set<number>()
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const m = /^(\d*)(-(\d*))?$/.exec(part)
    if (!m) return undefined
    const a = m[1] ? Number(m[1]) : 1
    const b = m[2] ? (m[3] ? Number(m[3]) : count) : a
    for (let i = Math.max(1, a); i <= Math.min(count, b); i++) out.add(i - 1)
  }
  return out
}

/** Many at once: a playlist, a channel, search results, a batch. Check what to keep. */
function ManyView({title, sub, entries, initial, onDone, grid}: {title: string; sub?: string; entries: Entry[]; initial: Set<number>; onDone: (drew?: boolean) => void; grid?: boolean}) {
  const [checked, setChecked] = useState(initial)
  const [vessel, setVessel] = useState<(typeof VESSELS)[number]>(() => {
    const last = recalled('manyVessel', '1080')
    return (VESSELS as readonly string[]).includes(last) ? (last as (typeof VESSELS)[number]) : '1080'
  })
  const [where, setWhere, startAt] = useWhere()
  const [range, setRange] = useState('')
  const flip = (i: number) =>
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  const draw = () =>
    void attempt(async () => {
      const items = entries.filter((_, i) => checked.has(i))
      if (!items.length) throw new Error('choose at least one: click the rows, or use the buttons above')
      await call<{count: number}>('draw-many', {items, vessel, folder: where.folder, queueId: where.queueId, label: title, startAt: startAt()})
      remember({manyVessel: vessel})
      onDone(true)
    })
  return (
    <div className="many">
      <p className="view-sub">
        {sub ? `${t(sub)} · ` : ''}
        {t(`${checked.size} chosen`)}
      </p>
      <div className="toolbar">
        <Button kind="quiet" onClick={() => setChecked(new Set(entries.map((_, i) => i)))}>
          all
        </Button>
        <Button kind="quiet" onClick={() => setChecked(new Set())}>
          none
        </Button>
        <Button kind="quiet" onClick={() => setChecked(new Set(entries.slice(0, 10).map((_, i) => i)))}>
          first 10
        </Button>
        <Button kind="quiet" onClick={() => setChecked(prev => new Set(entries.map((_, i) => i).filter(i => !prev.has(i))))}>
          invert
        </Button>
        {!grid && entries.length > 10 ? (
          <Field label="a range, like 1-10, 15" value={range} onChange={setRange} placeholder="a range: 1-10, 15, 20-" width={200} onEnter={() => {
            const r = parseRange(range, entries.length)
            if (r) setChecked(r)
            else say('a range like 1-10, 15, 20-', 'warn')
          }} />
        ) : null}
      </div>
      {grid ? (
        <div className="results">
          {entries.map((e, i) => (
            <button key={e.url} type="button" className={`result ${checked.has(i) ? 'lit checked' : ''}`} aria-pressed={checked.has(i)} onClick={() => flip(i)} onDoubleClick={() => window.dispatchEvent(new CustomEvent('axive-offer', {detail: e.url}))} data-tip={t('click to check · double-click to choose its vessel')}>
              <Thumb src={e.id ? `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg` : undefined} alt="" />
              <span className="t">{e.title}</span>
              <span className="meta">{[e.uploader, e.duration ? formatDuration(e.duration) : ''].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      ) : (
        <ul className="checklist">
          {entries.map((e, i) => (
            <li key={`${e.url}${i}`}>
              <label className={checked.has(i) ? 'checked' : ''}>
                <input type="checkbox" checked={checked.has(i)} onChange={() => flip(i)} />
                <span className="n">{i + 1}</span>
                <span className="t">{e.title}</span>
                <span className="data">{e.duration ? formatDuration(e.duration) : ''}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="where-line">
        <span className="label">{t('vessel')}</span>
        <Choice label="vessel" value={vessel} options={VESSELS} onChange={setVessel} show={vesselName} />
      </div>
      <WhereRow where={where} set={setWhere} />
      <div className="actions">
        <Button kind="primary" onClick={draw} disabled={!checked.size} hint="one tunnel per item; the archive skips repeats">
          {t(`draw ${checked.size}`)}
        </Button>
        <Button kind="quiet" onClick={() => onDone()}>
          back
        </Button>
      </div>
    </div>
  )
}

function SpotifyView({lot, onDone}: {lot: Extract<Result, {kind: 'spotify'}>; onDone: (drew?: boolean) => void}) {
  const [where, setWhere] = useWhere()
  return (
    <div className="many">
      <p className="view-sub">{t(`${lot.count} tracks from Spotify · each matched on YouTube and drawn as a tagged mp3`)}</p>
      <ul className="checklist">
        {lot.tracks.slice(0, 50).map((tr, i) => (
          <li key={i}>
            <label>
              <span />
              <span className="n">{i + 1}</span>
              <span className="t">{`${tr.artists.slice(0, 2).join(', ')} · ${tr.title}`}</span>
              <span className="data">{formatTime(tr.durationMs / 1000)}</span>
            </label>
          </li>
        ))}
      </ul>
      <WhereRow where={where} set={setWhere} noLater />
      <div className="actions">
        <Button kind="primary" onClick={() => void attempt(async () => (await call('draw-spotify', {id: lot.id, folder: where.folder, queueId: where.queueId}), onDone(true)))}>
          {t(`draw ${lot.count}`)}
        </Button>
        <Button kind="quiet" onClick={() => onDone()}>
          back
        </Button>
      </div>
    </div>
  )
}

const DUPLICATE = ['number', 'overwrite', 'skip', 'ask'] as const
const DUP_SHOW: Record<string, string> = {number: 'add a number', overwrite: 'replace it', skip: 'skip it', ask: 'ask me'}

/** D2, D3, D4: files looked at before they are fetched; one file, or many in a table with checkboxes and a total. */
function FilesView({lot, onDone}: {lot: Extract<Result, {kind: 'files'}>; onDone: (drew?: boolean) => void}) {
  const cats = useAxive(categoriesOf)
  const onDuplicate = useAxive(s => String(s.config.onDuplicate ?? 'number')) as (typeof DUPLICATE)[number]
  const [checked, setChecked] = useState(new Set(lot.items.map((x, i) => (x.error ? -1 : i)).filter(i => i >= 0)))
  const [where, setWhere, startAt] = useWhere()
  const [start, setStart] = useState(true)
  const [dup, setDup] = useState(onDuplicate)
  const [names, setNames] = useState(lot.items.map(x => x.filename ?? ''))
  const [peek, setPeek] = useState<Record<number, Array<{name: string; size: number; compressed: number}> | string>>({})
  const [busy, setBusy] = useState(false)
  const one = lot.items.length === 1
  const total = lot.items.reduce((s, x, i) => s + (checked.has(i) ? x.size ?? 0 : 0), 0)
  const unknown = lot.items.some((x, i) => checked.has(i) && !x.size)
  const flip = (i: number) => setChecked(p => {
    const n = new Set(p)
    if (n.has(i)) n.delete(i)
    else n.add(i)
    return n
  })
  const fetchThem = () =>
    void attempt(async () => {
      setBusy(true)
      try {
        const items = lot.items.map((x, i) => ({url: x.url, filename: names[i] || undefined, category: x.category})).filter((_, i) => checked.has(i))
        await call('fetch-add', {items, text: items.map(x => x.url).join('\n'), folder: where.folder, queueId: where.queueId, start: start && !where.later, startAt: startAt(), onDuplicate: dup})
        if (lot.media.length) {
          say(`${lot.media.length} video link${lot.media.length === 1 ? '' : 's'} go to the draws`, 'info')
          window.dispatchEvent(new CustomEvent('axive-offer', {detail: lot.media.join('\n')}))
        }
        onDone(true)
      } finally {
        setBusy(false)
      }
    })
  const isZip = (x: Probed, i: number) => /\.zip$/i.test(names[i] || x.filename || x.url)
  const look = (i: number) =>
    void (async () => {
      setPeek(p => ({...p, [i]: 'reading the archive…'}))
      try {
        const r = await call<{entries: Array<{name: string; size: number; compressed: number}>}>('zip-peek', {url: lot.items[i]!.url})
        setPeek(p => ({...p, [i]: r.entries}))
      } catch (e) {
        setPeek(p => ({...p, [i]: (e as Error).message}))
      }
    })()
  return (
    <div className="files-view">
      {one ? (
        (() => {
          const x = lot.items[0]!
          const cat = cats.find(c => c.id === x.category)
          return (
            <div className="probe-card">
              <div className="probe-glyph" aria-hidden>
                {(names[0] || x.filename || '').split('.').pop()?.slice(0, 4).toUpperCase() || '◇'}
              </div>
              <div className="stack">
                <Field label="file name" value={names[0] ?? ''} onChange={v => setNames([v])} placeholder="file name" />
                <dl className="facts">
                  <dt>{t('size')}</dt>
                  <dd className="data">{x.size ? formatBytes(x.size) : t('not told by the server')}</dd>
                  <dt>{t('resume')}</dt>
                  <dd>{x.error ? t(x.error) : t(x.resumable ? 'it can pause and resume, over many connections' : 'no: one connection, and a pause starts over')}</dd>
                  {x.mime ? (
                    <>
                      <dt>{t('type')}</dt>
                      <dd className="data">{x.mime}</dd>
                    </>
                  ) : null}
                  {cat ? (
                    <>
                      <dt>{t('category')}</dt>
                      <dd>{t(cat.name)}</dd>
                    </>
                  ) : null}
                </dl>
                {x.exists ? <p className="warn">{t('a file of that name is already there')}</p> : null}
              </div>
            </div>
          )
        })()
      ) : (
        <div className="table-wrap review">
          <table className="grid">
            <caption className="sr-only">{t('files to fetch')}</caption>
            <thead>
              <tr>
                <th className="c-check" scope="col">
                  <button type="button" className={`check ${checked.size === lot.items.length ? 'on' : checked.size ? 'some' : ''}`} aria-label={t(checked.size === lot.items.length ? 'choose none' : 'choose all')} onClick={() => setChecked(checked.size === lot.items.length ? new Set() : new Set(lot.items.map((_, i) => i)))} />
                </th>
                <th scope="col">{t('name')}</th>
                <th scope="col">{t('type')}</th>
                <th scope="col">{t('size')}</th>
                <th scope="col">{t('resume')}</th>
              </tr>
            </thead>
            <tbody>
              {lot.items.map((x, i) => (
                <tr key={x.url + i} className={checked.has(i) ? 'selected' : ''} onClick={() => flip(i)}>
                  <td className="c-check">
                    <input type="checkbox" checked={checked.has(i)} onChange={() => flip(i)} onClick={e => e.stopPropagation()} aria-label={names[i] || x.url} />
                  </td>
                  <td className="t" title={x.url}>
                    {names[i] || x.url}
                    {x.error ? <span className="err"> · {t(x.error)}</span> : null}
                  </td>
                  <td className="meta">{t(cats.find(c => c.id === x.category)?.name ?? '')}</td>
                  <td className="data">{x.size ? formatBytes(x.size) : ''}</td>
                  <td className="data">{x.error ? '' : x.resumable ? '∴' : '·'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="data total-line">
        {t(`${checked.size} of ${lot.items.length}`)} · {total ? formatBytes(total) : ''}
        {unknown ? ` ${t('and some of unknown size')}` : ''}
      </p>
      {lot.items.map((x, i) =>
        checked.has(i) && isZip(x, i) ? (
          <div key={`z${i}`} className="zip-peek">
            {peek[i] === undefined ? (
              <Button kind="quiet" icon="zip" hint="list what is inside, before any of it is fetched" onClick={() => look(i)}>
                {one ? 'look inside the archive' : `look inside ${names[i] || 'the archive'}`}
              </Button>
            ) : typeof peek[i] === 'string' ? (
              <p className="meta">{t(peek[i] as string)}</p>
            ) : (
              <>
                <div className="label">{t(`inside · ${(peek[i] as unknown[]).length} entries`)}</div>
                <ul className="zip-list">
                  {(peek[i] as Array<{name: string; size: number}>).slice(0, 200).map(z => (
                    <li key={z.name}>
                      <span className="t">{z.name}</span>
                      <span className="data">{z.size ? formatBytes(z.size) : ''}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : null,
      )}
      {lot.media.length ? <p className="meta">{t(`and ${lot.media.length} video link${lot.media.length === 1 ? '' : 's'}: they go to the draws after`)}</p> : null}
      <WhereRow where={where} set={setWhere} />
      <div className="where-line">
        <span className="label">{t('same name already there')}</span>
        <Choice label="same name already there" value={dup} options={DUPLICATE} onChange={setDup} show={v => DUP_SHOW[v] ?? v} />
      </div>
      <div className="where-line">
        <Toggle label="start now" value={start && !where.later} onChange={setStart} hint="off: added held; start it from the list when you like" />
      </div>
      <div className="actions">
        <Button kind="primary" disabled={busy || !checked.size} onClick={fetchThem} hint="↵">
          {one ? 'fetch' : `fetch ${checked.size}`}
        </Button>
        <Button kind="quiet" onClick={() => onDone()}>
          back
        </Button>
      </div>
    </div>
  )
}

/** A torrent's files, read before anything is fetched: keep only the ones ticked. */
function TorrentView({lot, onDone}: {lot: Extract<Result, {kind: 'torrent'}>; onDone: (drew?: boolean) => void}) {
  const [checked, setChecked] = useState(new Set(lot.files.map(f => f.index)))
  const [where, setWhere] = useWhere()
  const [start, setStart] = useState(true)
  const [busy, setBusy] = useState(false)
  const all = checked.size === lot.files.length
  const total = lot.files.reduce((s, f) => s + (checked.has(f.index) ? f.size : 0), 0)
  const flip = (i: number) => setChecked(p => {
    const n = new Set(p)
    if (n.has(i)) n.delete(i)
    else n.add(i)
    return n
  })
  const fetchThem = () =>
    void attempt(async () => {
      setBusy(true)
      try {
        await call('torrent-add', {url: lot.url, select: [...checked], folder: where.folder, queueId: where.queueId, start: start && !where.later})
        onDone(true)
      } finally {
        setBusy(false)
      }
    })
  return (
    <div className="files-view">
      <div className="table-wrap review">
        <table className="grid">
          <caption className="sr-only">{lot.name || t('files in the torrent')}</caption>
          <thead>
            <tr>
              <th className="c-check" scope="col">
                <button type="button" className={`check ${all ? 'on' : checked.size ? 'some' : ''}`} aria-label={t(all ? 'choose none' : 'choose all')} onClick={() => setChecked(all ? new Set() : new Set(lot.files.map(f => f.index)))} />
              </th>
              <th scope="col">{t('name')}</th>
              <th scope="col">{t('size')}</th>
            </tr>
          </thead>
          <tbody>
            {lot.files.map(f => (
              <tr key={f.index} className={checked.has(f.index) ? 'selected' : ''} onClick={() => flip(f.index)}>
                <td className="c-check">
                  <input type="checkbox" checked={checked.has(f.index)} onChange={() => flip(f.index)} onClick={e => e.stopPropagation()} aria-label={f.path} />
                </td>
                <td className="t" title={f.path}>
                  {f.path}
                </td>
                <td className="data">{formatBytes(f.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="data total-line">
        {t(`${checked.size} of ${lot.files.length}`)} · {formatBytes(total)}
      </p>
      <WhereRow where={where} set={setWhere} />
      <div className="where-line">
        <Toggle label="start now" value={start && !where.later} onChange={setStart} hint="off: added held; start it from the list when you like" />
      </div>
      <div className="actions">
        <Button kind="primary" disabled={busy || !checked.size} onClick={fetchThem} hint="↵">
          {`fetch ${checked.size}`}
        </Button>
        <Button kind="quiet" onClick={() => onDone()}>
          back
        </Button>
      </div>
    </div>
  )
}

let offerAgain: (text: string) => Promise<void> = async () => {}
let showResult: (r: Result) => void = () => {}

/** The offer field, as the top bar carries it everywhere. */
export function OfferBar({onOpen}: {onOpen: () => void}) {
  const animations = useAxive(s => s.config.animations !== false)
  const [value, setValue] = useState('')
  const [example, setExample] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!animations || value) return
    const id = setInterval(() => setExample(i => (i + 1) % EXAMPLES.length), 3600)
    return () => clearInterval(id)
  }, [animations, value])
  useEffect(() => {
    const focus = () => input.current?.focus()
    window.addEventListener('axive-focus-offer', focus)
    return () => window.removeEventListener('axive-focus-offer', focus)
  }, [])
  return (
    <form
      className="offer-bar"
      role="search"
      aria-label={t('Offer a link')}
      onSubmit={e => {
        e.preventDefault()
        if (!value.trim()) return onOpen()
        window.dispatchEvent(new CustomEvent('axive-offer', {detail: value}))
        setValue('')
      }}
    >
      <label className="field offer-field">
        <span className="sr-only">{t('Offer a link')}</span>
        <span className="offer-mark" aria-hidden>
          ⟶
        </span>
        <input ref={input} value={value} onChange={e => setValue(e.target.value)} placeholder={t(EXAMPLES[example]!)} spellCheck={false} autoComplete="off" aria-keyshortcuts="Control+L" />
        <kbd className="hint-key" aria-hidden>
          ctrl L
        </kbd>
      </label>
      <Button kind="primary" type="submit" icon="plus" hint="draw what you offered, or open a new draw (ctrl+n)">
        draw
      </Button>
    </form>
  )
}

/** The add sheet. It opens on its own when something is offered (paste, drop, the bar, an offering). */
export function DrawSheet({open, onClose, onDrawn}: {open: boolean; onClose: () => void; onDrawn: () => void}) {
  const recent = useAxive(s => s.recent)
  const [value, setValue] = useState('')
  const [result, setResult] = useState<Result>()
  const [reading, setReading] = useState<string>()
  const [clip, setClip] = useState<string>()

  const offer = async (text: string) => {
    const raw = text.trim()
    if (!raw || reading) return
    setReading(raw)
    try {
      // files go through a probe first (D2); a pattern like file[001-120].jpg becomes its links (D4)
      // one magnet or .torrent link: read its files first, so some can be left out
      if (!FREE && (/^magnet:\?\S+$/i.test(raw) || /^(https?|ftp):\/\/\S+\.torrent(\?\S*)?$/i.test(raw))) {
        const r = await call<Omit<Extract<Result, {kind: 'torrent'}>, 'kind' | 'url'>>('torrent-read', {url: raw})
        setResult({kind: 'torrent', url: raw, ...r})
        setValue('')
        return
      }
      let links = raw
      if (!FREE && /\[[^\]\s]+-[^\]\s]+\]/.test(raw) && /^(https?|ftp):\/\//i.test(raw) && !/\s/.test(raw)) {
        const r = await call<{links: string[]}>('batch-expand', {pattern: raw}).catch(() => undefined)
        if (r?.links.length) links = r.links.join('\n')
      }
      const sorted = await call<{files: string[]; media: string[]}>('classify', {text: links}).catch(() => undefined)
      if (sorted?.files.length) {
        const probed = await call<{items: Probed[]}>('probe', {urls: sorted.files}).catch(() => ({items: sorted.files.map(url => ({url, filename: url.split('/').pop()?.split('?')[0]}))}))
        setResult({kind: 'files', items: probed.items, media: sorted.media})
        setValue('')
        return
      }
      const r = await call<Result>('offer', {text: links})
      if (r.kind === 'fetch') {
        say(r.count === 1 ? 'fetching: it appears in the list' : `fetching ${r.count}: they appear in the list`, 'ok')
        onDrawn()
        return
      }
      setResult(r)
      setValue('')
    } catch (error) {
      say((error as Error).message, 'error')
    } finally {
      setReading(undefined)
    }
  }
  offerAgain = offer
  showResult = setResult

  useEffect(() => {
    if (!open) return
    void call<{link: string | null}>('clipboard').then(r => setClip(r.link ?? undefined), () => {})
  }, [open])

  const done = (drew?: boolean) => {
    setResult(undefined)
    if (drew) onDrawn()
  }
  const close = () => (setResult(undefined), onClose())
  if (!open) return null

  const titles: Partial<Record<Result['kind'], string>> = {video: 'choose a vessel', playlist: 'a playlist', search: 'search', batch: 'many links', spotify: 'from Spotify', files: 'files to fetch', torrent: 'files in the torrent', file: 'a file you have', disc: 'a disc folder'}
  const title = !result
    ? 'a new draw'
    : result.kind === 'playlist'
      ? result.playlist.title
      : result.kind === 'search'
        ? `“${result.query}”`
        : result.kind === 'spotify'
          ? result.label
          : result.kind === 'batch'
            ? result.title ?? 'many links'
            : titles[result.kind] ?? 'a new draw'

  return (
    <Sheet title={title} onClose={() => (result ? setResult(undefined) : close())} wide={result ? 'full' : true} labelId="draw-title">
      {result?.kind === 'video' ? (
        <VideoView video={result} onDone={done} />
      ) : result?.kind === 'playlist' ? (
        <ManyView title={result.playlist.title} sub={`${result.playlist.entries.length} items${result.playlist.uploader ? ` · ${result.playlist.uploader}` : ''}`} entries={result.playlist.entries} initial={new Set(result.playlist.entries.slice(0, result.playlist.entries.length > 50 ? 10 : result.playlist.entries.length).map((_, i) => i))} onDone={done} />
      ) : result?.kind === 'search' ? (
        <ManyView title={`“${result.query}”`} sub="results come from YouTube" entries={result.results} initial={new Set()} onDone={done} grid />
      ) : result?.kind === 'batch' ? (
        <ManyView title={result.title ?? 'batch'} sub={`${result.urls.length} links gathered`} entries={result.urls.map(url => ({url, title: url.replace(/^https?:\/\/(www\.)?/, '')}))} initial={new Set(result.urls.map((_, i) => i))} onDone={done} />
      ) : result?.kind === 'spotify' ? (
        <SpotifyView lot={result} onDone={done} />
      ) : result?.kind === 'files' ? (
        <FilesView lot={result} onDone={done} />
      ) : result?.kind === 'torrent' ? (
        <TorrentView lot={result} onDone={done} />
      ) : result?.kind === 'file' ? (
        <ToolsView file={result} onDone={() => setResult(undefined)} onAnother={() => void openFile()} />
      ) : result?.kind === 'disc' ? (
        <DiscView disc={{...result, kind: result.disc}} onDone={() => setResult(undefined)} onAnother={() => void openDisc()} />
      ) : (
        <div className="draw-start">
          <form className="offer" onSubmit={e => (e.preventDefault(), void offer(value))}>
            <label className="field big">
              <span className="sr-only">{t('Offer a link')}</span>
              <input autoFocus value={reading ? '' : value} onChange={e => setValue(e.target.value)} placeholder={reading ? t('reading…') : t(FREE ? 'a link to a video, a song or any file' : 'a link, many links, a magnet, file[001-120].jpg, or words to search')} disabled={Boolean(reading)} spellCheck={false} autoComplete="off" />
              <Button kind="primary" type="submit" disabled={Boolean(reading) || !value.trim()} hint="↵">
                draw
              </Button>
            </label>
            <div className="offer-hint" aria-live="polite">
              {reading ? (
                <Scrambled text={t('reading…')} />
              ) : clip && !value ? (
                <>
                  {t('a link waits in your clipboard ·')}{' '}
                  <button type="button" className="link" onClick={() => (setClip(undefined), void offer(clip))} data-tip={clip}>
                    {t('draw it')}
                  </button>
                </>
              ) : (
                t(FREE ? 'video and music from 1,800+ sites, up to 8K · any file over 16 connections' : 'video and music from 1,800+ sites · playlists and channels · Spotify · any file, torrent or magnet · or words to search')
              )}
            </div>
          </form>
          {FREE ? null : (
          <div className="draw-doors" role="group" aria-label={t('or begin from')}>
            <button type="button" className="door-card" onClick={() => void openFile()} data-tip={t('work on a file you already have: convert, trim, distill')}>
              <span className="label">{t('a file you have')}</span>
              <span className="meta">{t('convert, trim, distill')}</span>
            </button>
            <button type="button" className="door-card" onClick={() => void openList()} data-tip={t('a .txt with one link per line: each one becomes a draw')}>
              <span className="label">{t('a list file')}</span>
              <span className="meta">{t('one link per line')}</span>
            </button>
            <button type="button" className="door-card" onClick={() => void attempt(async () => {
              const r = await call<{count: number}>('fetch-torrent')
              if (r.count) (say('fetching the torrent: it appears in the list', 'ok'), onDrawn())
            })}>
              <span className="label">{t('a .torrent')}</span>
              <span className="meta">{t('from your PC')}</span>
            </button>
            <button type="button" className="door-card" onClick={() => void openDisc()} data-tip={t('a DVD or Blu-ray folder, or an .iso: convert a title')}>
              <span className="label">{t('a disc folder')}</span>
              <span className="meta">{t('DVD, Blu-ray, .iso')}</span>
            </button>
            <button type="button" className="door-card" onClick={() => void attempt(async () => {
              const r = await call<{count: number}>('import-list')
              if (r.count) (say(`${r.count} brought back into the list`, 'ok'), onDrawn())
            })} data-tip={t('a list Axive exported before: every file in it comes back')}>
              <span className="label">{t('an exported list')}</span>
              <span className="meta">{t('from another Axive')}</span>
            </button>
          </div>
          )}
          {recent.length ? (
            <nav className="recent" aria-label={t('offered before')}>
              <div className="label">{t('offered before')}</div>
              <ul>
                {recent.slice(0, 6).map(r => (
                  <li key={r}>
                    <button type="button" onClick={() => void offer(r)}>
                      {r}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
      )}
    </Sheet>
  )
}

/** Something dropped on the window: links go to the box; files come by path (see offerPaths). */
export async function offerDropped(data: DataTransfer): Promise<boolean> {
  const text = data.getData('text/uri-list') || data.getData('text/plain')
  if (!text) return false
  await offerAgain(text)
  return true
}
export const offerText = (text: string) => offerAgain(text)

/** Files dropped on the window (their paths come from the window itself): a .torrent is fetched, media is offered for conversion. */
export async function offerPaths(paths: string[]): Promise<void> {
  for (const path of paths.slice(0, 8)) {
    const r = await attempt(() => call<{kind: 'torrent'} | {kind: 'disc'; path: string} | Extract<Result, {kind: 'file'}>>('file-offer', {path}))
    if (r?.kind === 'file') showResult(r)
    else if (r?.kind === 'disc') await openDisc(r.path)
    else if (r?.kind === 'torrent') say('fetching the torrent: it appears in the list', 'ok')
  }
}

export async function openFile(): Promise<void> {
  const file = await attempt(pickMediaFile)
  if (file) showResult({kind: 'file', ...file})
}

export async function openList(): Promise<void> {
  const r = await attempt(() => call<{path: string | null; links?: string[]}>('pick-file', {kind: 'list', title: 'A list of links, one per line'}))
  if (!r?.path) return
  if (!r.links?.length) return say('that file holds no links: one https://… per line', 'warn')
  showResult({kind: 'batch', urls: r.links, title: r.path.split(/[\\/]/).pop()})
}

export async function openDisc(path?: string): Promise<void> {
  const disc = await attempt(() => (path ? readDisc(path) : pickDiscFolder()))
  if (disc) showResult({...disc, kind: 'disc', disc: disc.kind})
}
