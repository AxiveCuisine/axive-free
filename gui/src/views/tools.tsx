import React, {useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {attempt, call, t, useAxive, type Task} from '../state.js'
import {Button, Choice, Progress, Toggle, formatTime, parseTime} from '../ui.js'

/**
 * A file you already have: convert it, trim it, distill it. The same three
 * tools as the terminal (ConvertScreen, TrimScreen, DistillScreen), on one
 * panel with three tabs. Each tool runs as a task in the core; its progress
 * comes back through the tasks list, and a finished one offers play, show in
 * folder and done.
 */

export type MediaKind = 'video' | 'audio' | 'image'
export type ToolFile = {path: string; media?: MediaKind; targets: {id: string; label: string}[]}
type Tool = 'convert' | 'trim' | 'distill'

const TOOLS: Array<{id: Tool; label: string; hint: string}> = [
  {id: 'convert', label: 'convert', hint: 'turn it into another vessel: mp4, mp3, gif…'},
  {id: 'trim', label: 'trim', hint: 'keep only a part (lossless, in seconds)'},
  {id: 'distill', label: 'distill', hint: 'a highlight reel of the loudest moments'},
]

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p

/** The Windows picker, then what ffmpeg can make of the file. Undefined when nothing was chosen. */
export async function pickMediaFile(): Promise<ToolFile | undefined> {
  const picked = await call<{path: string | null; kind: MediaKind | null}>('pick-file', {kind: 'media', title: 'A file to convert, trim or distill'})
  if (!picked.path) return undefined
  if (!picked.kind) throw new Error('ffmpeg cannot convert that kind of file')
  const {kind, targets} = await call<{kind: MediaKind; targets: ToolFile['targets']}>('convert-targets', {file: picked.path})
  return {path: picked.path, media: kind, targets}
}

/** A running or finished task: its line, its progress, and what can be done next. */
function TaskPanel({task, onDone, onAgain}: {task: Task; onDone: () => void; onAgain: () => void}) {
  const running = task.state === 'running'
  return (
    <div className="tool-task stack surface" aria-live="polite">
      <div className="data selectable">{t(task.label)}</div>
      <Progress fraction={task.fraction} status={running ? "drawing" : task.state === "done" ? "received" : "failed"} label={running ? 'working…' : task.state === 'done' ? 'received.' : 'failed'} />
      {task.state === 'done' && task.output ? (
        <>
          <p className="meta">
            <span aria-hidden>∴ </span>
            {t('received.')} <span className="selectable">{baseName(task.output)}</span>
          </p>
          <div className="actions">
            <Button kind="primary" icon="play" onClick={() => void attempt(() => call('open', {path: task.output}))}>
              play
            </Button>
            <Button icon="folder" onClick={() => void attempt(() => call('reveal', {path: task.output}))}>
              show in folder
            </Button>
            <Button kind="quiet" onClick={onAgain} hint="another tool, the same file">
              again
            </Button>
            <Button kind="quiet" onClick={onDone}>
              done
            </Button>
          </div>
        </>
      ) : task.state === 'failed' ? (
        <>
          <p className="err" role="alert">
            {t(task.error ?? 'failed')}
          </p>
          <div className="actions">
            <Button onClick={onAgain}>try again</Button>
            <Button kind="quiet" onClick={onDone}>
              done
            </Button>
          </div>
        </>
      ) : (
        <div className="actions">
          <Button kind="quiet" icon="close" onClick={() => void call('task-stop', {id: task.id})} hint="esc">
            stop
          </Button>
        </div>
      )}
    </div>
  )
}

function ConvertTool({file, onStart}: {file: ToolFile; onStart: (task: string) => void}) {
  const [busy, setBusy] = useState(false)
  const start = (target: string) =>
    void attempt(async () => {
      if (busy) return
      setBusy(true)
      try {
        onStart((await call<{task: string}>('convert', {file: file.path, target})).task)
      } finally {
        setBusy(false)
      }
    })
  return (
    <>
      <p className="meta tool-lead">{t('choose what it becomes; the new file rests beside the old one')}</p>
      <div className="label" id="into-label">
        {t('Into')}
      </div>
      <div className="vessels tool-targets" role="group" aria-labelledby="into-label">
        {file.targets.map(target => (
          <button key={target.id} type="button" disabled={busy} onClick={() => start(target.id)} data-tip={t(`convert into ${target.label}`)}>
            <span>{target.label}</span>
            <span className="size" aria-hidden>
              →
            </span>
          </button>
        ))}
      </div>
    </>
  )
}

function TrimTool({file, duration, onStart}: {file: ToolFile; duration?: number; onStart: (task: string) => void}) {
  const [from, setFrom] = useState('0:00')
  const [to, setTo] = useState('')
  const [precise, setPrecise] = useState(false)
  const [busy, setBusy] = useState(false)
  // the end starts at the file's length, once it is known
  useEffect(() => {
    if (duration && !to) setTo(formatTime(duration))
  }, [duration])
  const start = parseTime(from)
  const rawEnd = parseTime(to)
  const end = rawEnd !== undefined && duration ? Math.min(rawEnd, duration) : rawEnd
  const valid = start !== undefined && end !== undefined && end > start && (!duration || start < duration)
  const trim = () =>
    void attempt(async () => {
      if (!valid) throw new Error('start and end like 1:23 or 0:01:23, the end after the start')
      setBusy(true)
      try {
        onStart((await call<{task: string}>('trim', {file: file.path, start, end, precise})).task)
      } finally {
        setBusy(false)
      }
    })
  return (
    <form className="stack" onSubmit={e => (e.preventDefault(), trim())}>
      <p className="meta tool-lead">{t('keep only a part (lossless, in seconds)')}</p>
      <div className="times">
        <label className="field">
          <span className="sr-only">{t('from')}</span>
          <input value={from} onChange={e => setFrom(e.target.value)} placeholder="0:00" spellCheck={false} autoComplete="off" />
        </label>
        <span className="meta" aria-hidden>
          →
        </span>
        <label className="field">
          <span className="sr-only">{t('to')}</span>
          <input value={to} onChange={e => setTo(e.target.value)} placeholder={duration ? formatTime(duration) : '1:30'} spellCheck={false} autoComplete="off" />
        </label>
        <span className="data" aria-live="polite">
          {valid ? t(`${formatTime(end! - start!)} kept`) : ''}
        </span>
      </div>
      {duration ? (
        <div className="timeline" aria-hidden>
          <div className="track" />
          {valid ? <div className="span" style={{left: `${(start! / duration) * 100}%`, width: `${((end! - start!) / duration) * 100}%`}} /> : null}
        </div>
      ) : null}
      <p className={`meta ${valid || !to ? '' : 'err'}`}>{t('times like 1:23, 01:02:03, 90 or 1m30s')}</p>
      <Toggle label={precise ? 'exact cut (re-encodes, slower)' : 'lossless (instant, starts at the nearest keyframe)'} value={precise} onChange={setPrecise} hint="lossless copies the streams untouched: seconds even for 4K. exact lands on the very frame." />
      <div className="actions">
        <Button kind="primary" type="submit" disabled={busy || !valid} hint="↵">
          trim
        </Button>
      </div>
    </form>
  )
}

const LENGTHS = ['60', '180', '300'] as const
const MOMENTS = ['8', '15', '30'] as const

function DistillTool({file, duration, onStart}: {file: ToolFile; duration?: number; onStart: (task: string) => void}) {
  const [output, setOutput] = useState<'reel' | 'chapters'>('reel')
  const [target, setTarget] = useState<(typeof LENGTHS)[number]>('180')
  const [segment, setSegment] = useState<(typeof MOMENTS)[number]>('15')
  const [precise, setPrecise] = useState(true)
  const [busy, setBusy] = useState(false)
  const distill = () =>
    void attempt(async () => {
      setBusy(true)
      try {
        onStart((await call<{task: string}>('distill', {file: file.path, target: Number(target), segment: Number(segment), output, precise})).task)
      } finally {
        setBusy(false)
      }
    })
  return (
    <div className="stack">
      <p className="meta tool-lead">{duration ? t(`length ${formatTime(duration)}. Axive listens for the loudest, liveliest stretches`) : t('a highlight reel of the loudest moments')}</p>
      <dl className="tool-rows">
        <dt className="label">{t('make')}</dt>
        <dd>
          <Choice label="make" value={output} options={['reel', 'chapters'] as const} onChange={setOutput} show={v => (v === 'reel' ? 'a highlight reel (new file)' : 'chapter marks at the peaks (a copy)')} />
        </dd>
        {output === 'reel' ? (
          <>
            <dt className="label">{t('reel length')}</dt>
            <dd>
              <Choice label="reel length" value={target} options={LENGTHS} onChange={setTarget} show={v => formatTime(Number(v))} />
            </dd>
          </>
        ) : null}
        <dt className="label">{t('each moment')}</dt>
        <dd>
          <Choice label="each moment" value={segment} options={MOMENTS} onChange={setSegment} show={v => `${v} seconds`} />
        </dd>
      </dl>
      {output === 'reel' ? <Toggle label={precise ? 'exact cuts (re-encodes)' : 'lossless cuts (fast, keyframe-snapped)'} value={precise} onChange={setPrecise} /> : null}
      <div className="actions">
        <Button kind="primary" onClick={distill} disabled={busy} hint="Axive listens first, then cuts">
          distill
        </Button>
      </div>
    </div>
  )
}

/**
 * The panel. `doors` is a spot in the header for more ways in (the lead's
 * "disc folder" button for DVD and Blu-ray goes here).
 */
export function ToolsView({file, initial = 'convert', onDone, onAnother, doors}: {file: ToolFile; initial?: Tool; onDone: () => void; onAnother?: () => void; doors?: ReactNode}) {
  const tasks = useAxive(s => s.tasks)
  const media = file.media ?? 'video'
  const timed = media !== 'image'
  const [tool, setTool] = useState<Tool>(timed ? initial : 'convert')
  const [started, setStarted] = useState<Partial<Record<Tool, string>>>({})
  const [duration, setDuration] = useState<number>()
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const name = useMemo(() => baseName(file.path), [file.path])
  const task = tasks.find(x => x.id === started[tool])

  useEffect(() => {
    setStarted({})
    setDuration(undefined)
    if (timed) void call<{seconds: number | null}>('duration', {file: file.path}).then(r => r.seconds && setDuration(r.seconds), () => {})
  }, [file.path])
  // esc: stop what runs, else leave the panel
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.veil')) return
      if (task?.state === 'running') void call('task-stop', {id: task.id})
      else onDone()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [task?.id, task?.state])

  const available = TOOLS.filter(x => timed || x.id === 'convert')
  // ← → between the tabs, as a tab list should
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (i + step + available.length) % available.length
    setTool(available[next]!.id)
    tabs.current[next]?.focus()
  }

  return (
    <div className="tools surface">
      <header className="view-head tools-head">
        <div>
          <div className="label">{t('a file you have')}</div>
          <h3 className="section-title selectable tools-name" title={file.path}>
            {name}
          </h3>
          <p className="view-sub data">{[t(media), duration ? t(`length ${formatTime(duration)}`) : ''].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="tools-doors">
          {/* more doors in (the disc folder) sit here, before "another file" */}
          {doors}
          {onAnother ? (
            <Button kind="quiet" onClick={onAnother} hint="open the Windows file picker (ctrl+o)">
              another file
            </Button>
          ) : null}
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label={t('tools')}>
        {available.map((x, i) => (
          <button
            key={x.id}
            ref={el => {
              tabs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`tool-tab-${x.id}`}
            aria-controls={`tool-panel-${x.id}`}
            aria-selected={tool === x.id}
            tabIndex={tool === x.id ? 0 : -1}
            className="tab"
            onClick={() => setTool(x.id)}
            onKeyDown={e => onTabKey(e, i)}
            data-tip={t(x.hint)}
          >
            {t(x.label)}
            {started[x.id] && tasks.find(k => k.id === started[x.id])?.state === 'running' ? <span className="tab-live" aria-label={t('working…')} /> : null}
          </button>
        ))}
      </div>
      {!timed ? <p className="meta">{t('trim and distill are for video and sound')}</p> : null}

      <section className="tool-panel" role="tabpanel" id={`tool-panel-${tool}`} aria-labelledby={`tool-tab-${tool}`} key={tool}>
        {task ? (
          <TaskPanel task={task} onDone={onDone} onAgain={() => setStarted(s => ({...s, [tool]: undefined}))} />
        ) : tool === 'convert' ? (
          <ConvertTool file={file} onStart={id => setStarted(s => ({...s, convert: id}))} />
        ) : tool === 'trim' ? (
          <TrimTool file={file} duration={duration} onStart={id => setStarted(s => ({...s, trim: id}))} />
        ) : (
          <DistillTool file={file} duration={duration} onStart={id => setStarted(s => ({...s, distill: id}))} />
        )}
      </section>

      <div className="actions">
        <Button kind="quiet" onClick={onDone} hint="esc">
          back
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- a disc folder (DVD, Blu-ray)

export type Disc = {
  path: string
  kind: 'dvd' | 'bluray'
  name: string
  encrypted: boolean
  message?: string
  warning?: string
  titles: {id: number; label: string; duration: number | null}[]
  main: number | null
  targets: {id: string; label: string}[]
}

/** The Windows folder picker, then what the disc holds. Undefined when nothing was chosen. */
export async function pickDiscFolder(): Promise<Disc | undefined> {
  const {path} = await call<{path: string | null}>('pick-folder', {title: 'A DVD or Blu-ray: the disc, its VIDEO_TS or BDMV folder'})
  if (!path) return undefined
  return readDisc(path)
}

export async function readDisc(path: string): Promise<Disc> {
  return {...(await call<Omit<Disc, 'path'>>('disc-detect', {path})), path}
}

export function DiscView({disc, onDone, onAnother}: {disc: Disc; onDone: () => void; onAnother?: () => void}) {
  const tasks = useAxive(s => s.tasks)
  const [title, setTitle] = useState<number | null>(disc.main ?? disc.titles[0]?.id ?? null)
  const [started, setStarted] = useState<string>()
  const [busy, setBusy] = useState(false)
  const task = tasks.find(x => x.id === started)
  const main = disc.titles.find(x => x.id === disc.main)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.veil')) return
      if (task?.state === 'running') void call('task-stop', {id: task.id})
      else onDone()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [task?.id, task?.state])
  const start = (target: string) =>
    void attempt(async () => {
      if (busy) return
      setBusy(true)
      try {
        setStarted((await call<{task: string}>('disc-convert', {path: disc.path, title, target})).task)
      } finally {
        setBusy(false)
      }
    })
  return (
    <div className="tools surface">
      <header className="view-head tools-head">
        <div>
          <div className="label">{t('a disc folder')}</div>
          <h3 className="section-title selectable tools-name" title={disc.path}>
            {disc.name}
          </h3>
          <p className="view-sub data">{[disc.kind === 'dvd' ? 'DVD' : 'Blu-ray', main ? `${t('main title')} ${main.label}` : ''].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="tools-doors">
          {onAnother ? (
            <Button kind="quiet" onClick={onAnother} hint="open the Windows folder picker">
              another disc
            </Button>
          ) : null}
        </div>
      </header>
      {disc.warning ? <p className="meta err">{t(disc.warning)}</p> : null}
      {disc.encrypted ? (
        <p className="err" role="alert">
          {disc.message ?? 'This disc is encrypted. Axive cannot convert it.'}
        </p>
      ) : task ? (
        <TaskPanel task={task} onDone={onDone} onAgain={() => setStarted(undefined)} />
      ) : (
        <div className="stack">
          <p className="meta tool-lead">{t('choose a title, then what it becomes; the new file rests in your default folder')}</p>
          <div className="label" id="disc-titles-label">
            {t('title')}
          </div>
          <div className="vessels tool-targets" role="radiogroup" aria-labelledby="disc-titles-label">
            {disc.titles.map(x => (
              <button key={x.id} type="button" role="radio" aria-checked={x.id === title} onClick={() => setTitle(x.id)}>
                <span>
                  {x.label}
                  {x.id === disc.main ? <span className="meta">{` · ${t('main')}`}</span> : null}
                </span>
                <span className="size">{x.duration ? formatTime(x.duration) : ''}</span>
              </button>
            ))}
          </div>
          <div className="label" id="disc-into-label">
            {t('Into')}
          </div>
          <div className="vessels tool-targets" role="group" aria-labelledby="disc-into-label">
            {disc.targets.map(target => (
              <button key={target.id} type="button" disabled={busy || title === null} onClick={() => start(target.id)} data-tip={t(`convert into ${target.label}`)}>
                <span>{target.label}</span>
                <span className="size" aria-hidden>
                  →
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="actions">
        <Button kind="quiet" onClick={onDone} hint="esc">
          back
        </Button>
      </div>
    </div>
  )
}
