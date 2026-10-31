import React, {useEffect, useMemo, useRef, useState} from 'react'
import {formatSpeed} from '../../../src/core/format.js'
import {SORT_KEYS, etaText, inFilter, rowsOf, sizeText, sortRows, speedText, type Filter, type Row, type SortKey} from '../model.js'
import {attempt, call, convertFile, queuesOf, recalled, remember, say, sendToTelegram, setConfig, t, useAxive, type Queue} from '../state.js'
import {FREE} from '../edition.js'
import {Button, Icon, Keys, Menu, Progress, Sigil, Thumb, Wordmark, type MenuItem} from '../ui.js'
import {Detail} from './detail.js'
import {askDelete} from './discard.js'
import {MiniMap} from './vis.js'

/**
 * Every transfer in one list: the draws (video, audio, Spotify), the download
 * manager's files, torrents and magnets, and the tools at work. Sortable
 * columns, inline progress (a small piece map for a file in flight), multi
 * select with a bulk bar, a right-click menu that mirrors the row's, and the
 * detail panel beside the list.
 */

export type Scope = {status: Filter; category?: string; queue?: string}

export const act = (r: Row, op: string) =>
  attempt(async () => {
    if (r.kind === 'job') {
      const map: Record<string, string> = {pause: 'pause', resume: 'resume', retry: 'resume', cancel: 'cancel', remove: 'remove', front: 'prioritize', now: 'now'}
      if (map[op]) return void (await call('job', {id: r.id, op: map[op]}))
    }
    if (r.kind === 'fetch') {
      const map: Record<string, string> = {pause: 'pause', resume: 'resume', retry: 'resume', cancel: 'cancel', remove: 'clear', unshare: 'clear'}
      if (map[op]) return void (await call('fetch', {gid: r.id, op: map[op]}))
    }
    if (r.kind === 'task' && (op === 'cancel' || op === 'stop')) return void (await call('task-stop', {id: r.id}))
    // received in an earlier session: it only leaves the list (the file and the ledger stay)
    if (r.kind === 'past' && op === 'remove') return void (await call('list-hide', {ids: [r.id]}))
  })

const live = (r: Row) => r.status === 'drawing' || r.status === 'preparing' || (r.status === 'held' && r.word !== 'paused')
const resumable = (r: Row) => r.word === 'paused' || r.word === 'cancelled'
/** Delete, said for what it does: live work stops (cancel), finished work leaves the list (remove). Both ask first. */
export const deleteOp = (r: Row) => (live(r) || r.word === 'paused' || (r.kind === 'fetch' && r.status === 'failed') ? 'cancel' : 'remove')
/** Something of it may be on the drive: a received file, or the partial files of a download that stops. */
const onDrive = (r: Row) => (r.file && (r.status === 'received' || r.status === 'seeding')) || (r.kind === 'fetch' && deleteOp(r) === 'cancel') || (r.kind === 'job' && (r.job?.state === 'running' || r.job?.state === 'paused' || Boolean(r.job?.partial)))

/**
 * Delete for any set of rows. Whenever a file (or a partial one) could go with it, the owner is
 * asked first: only the line, or the file too. Rows with nothing on the drive simply leave.
 */
export function deleteRows(rows: Row[]): void {
  const mine = rows.filter(r => r.kind !== 'task')
  if (!mine.length) return
  if (!mine.some(onDrive)) return mine.forEach(r => void act(r, deleteOp(r) === 'cancel' ? 'cancel' : 'remove'))
  askDelete({from: 'list', items: mine.map(r => ({kind: r.kind, id: r.id})), names: mine.map(r => r.name), live: mine.filter(r => deleteOp(r) === 'cancel').length})
}

export function rowMenu(r: Row, queues: Queue[], open: (r: Row) => void): MenuItem[] {
  const done = r.status === 'received' || r.status === 'seeding'
  const items: MenuItem[] = []
  if (done && r.file) items.push({label: 'open', icon: 'play', keys: 'ctrl+O', onSelect: () => void attempt(() => call('open', {path: r.file}))})
  if (done) items.push({label: 'show in folder', icon: 'folder', keys: 'ctrl+F', onSelect: () => void attempt(() => call('reveal', {path: r.file ?? r.folder}))})
  if (done && r.file && r.kind !== 'task' && !FREE) items.push({label: 'convert', icon: 'convert', onSelect: () => convertFile(r.file)})
  if (done && r.file && !FREE) items.push({label: 'send to telegram', icon: 'send', onSelect: () => sendToTelegram(r.file)})
  if (live(r) && r.kind !== 'task') items.push({label: 'pause', icon: 'pause', keys: 'ctrl+P', onSelect: () => void act(r, 'pause')})
  if (resumable(r)) items.push({label: 'resume', icon: 'play', keys: 'ctrl+R', onSelect: () => void act(r, 'resume')})
  if (r.status === 'failed' && r.word !== 'cancelled') items.push({label: 'retry', icon: 'retry', keys: 'ctrl+R', onSelect: () => void act(r, 'retry')})
  if (r.kind === 'job' && (r.job?.state === 'queued' || r.job?.state === 'paused')) items.push({label: 'move to the front', icon: 'up', onSelect: () => void act(r, 'front')})
  if (r.kind === 'job' && r.job?.state === 'held') items.push({label: "don't wait for the clock", icon: 'now', onSelect: () => void act(r, 'now')})
  if (r.kind !== 'task' && queues.length > 1 && !done)
    for (const q of queues.filter(q => q.id !== r.queueId)) items.push({label: `move to ${q.name}`, icon: 'queue', onSelect: () => void attempt(() => call('move-queue', {kind: r.kind, id: r.id, queueId: q.id}))})
  if (r.kind !== 'task' && r.url) {
    const url = r.url
    items.push({label: 'copy link', icon: 'copy', onSelect: () => void attempt(async () => (await call('copy', {text: url}), say('copied', 'ok')))})
    if (r.kind === 'past') items.push({label: 'draw it again', icon: 'retry', onSelect: () => window.dispatchEvent(new CustomEvent('axive-offer', {detail: url}))})
  }
  items.push({label: 'details', icon: 'eye', keys: 'ctrl+I', onSelect: () => open(r)})
  items.push('rule')
  if (r.status === 'seeding') items.push({label: 'stop sharing', icon: 'close', onSelect: () => void act(r, 'unshare')})
  else if (r.kind === 'task') r.status === 'drawing' && items.push({label: 'stop', icon: 'close', danger: true, onSelect: () => void act(r, 'cancel')})
  else items.push(onDrive(r) ? {label: deleteOp(r) === 'cancel' ? 'stop and delete…' : 'delete…', icon: 'trash', keys: 'Del', danger: deleteOp(r) === 'cancel', onSelect: () => deleteRows([r])} : {label: 'clear from the list', icon: 'close', keys: 'Del', onSelect: () => deleteRows([r])})
  return items
}

const STATUS_MARK: Record<Row['status'], string> = {drawing: '●', preparing: '◌', held: '‖', failed: '✗', received: '∴', seeding: '∴'}

const RowView = React.memo(function RowView({r, selected, focused, onPick, onMenu, onOpen}: {r: Row; selected: boolean; focused: boolean; onPick: (e: React.MouseEvent | React.KeyboardEvent, r: Row) => void; onMenu: (e: React.MouseEvent, r: Row) => void; onOpen: (r: Row) => void}) {
  const mapped = r.kind === 'fetch' && r.map && (r.status === 'drawing' || r.status === 'held' || r.status === 'failed')
  const pct = r.fraction !== undefined ? `${Math.floor(r.fraction * 100)}%` : ''
  return (
    <tr
      className={`tr ${r.status}${selected ? ' selected' : ''}`}
      aria-selected={selected}
      tabIndex={focused ? 0 : -1}
      data-key={r.key}
      onClick={e => onPick(e, r)}
      onDoubleClick={() => onOpen(r)}
      onContextMenu={e => onMenu(e, r)}
    >
      <td className="c-check">
        <span className={`check ${selected ? 'on' : ''}`} aria-hidden />
      </td>
      <td className="c-name">
        <div className="name-cell">
          <Thumb src={r.thumb} alt="" fallback={r.glyph} className="mini-thumb" />
          <div className="name-text">
            <span className="t" title={r.name}>
              {r.name}
            </span>
            <span className="sub">
              <span className={`st ${r.status}`}>
                <span aria-hidden>{STATUS_MARK[r.status]} </span>
                {t(r.word)}
              </span>
              <span className="meta">{t(r.detail)}</span>
            </span>
          </div>
        </div>
      </td>
      <td className="c-size data">{sizeText(r.size)}</td>
      <td className="c-prog">
        <div className="prog-cell">
          {mapped ? <MiniMap map={r.map!} edges={r.fetch?.edges} rest={r.status !== 'drawing'} /> : <Progress fraction={r.fraction} status={r.status} label={r.name} thin />}
          <span className="data pct">{pct}</span>
        </div>
      </td>
      <td className="c-speed data">{r.speed ? speedText(r.speed) : ''}</td>
      <td className="c-eta data">{etaText(r.eta)}</td>
      <td className="c-more">
        <button type="button" className="btn icon quiet" aria-label={t('more')} tabIndex={-1} onClick={e => (e.stopPropagation(), onMenu(e, r))}>
          <Icon name="more" />
        </button>
      </td>
    </tr>
  )
})

const COLS: Array<{key: SortKey; label: string; cls: string}> = [
  {key: 'name', label: 'name', cls: 'c-name'},
  {key: 'size', label: 'size', cls: 'c-size'},
  {key: 'progress', label: 'progress', cls: 'c-prog'},
  {key: 'speed', label: 'speed', cls: 'c-speed'},
  {key: 'eta', label: 'left', cls: 'c-eta'},
]

export function TransfersView({scope, search, onNew, onScope}: {scope: Scope; search: string; onNew: () => void; onScope: (s: Scope) => void}) {
  const all = useAxive(s => s)
  const queues = useAxive(queuesOf)
  const rows = useMemo(() => rowsOf(all), [all.jobs, all.fetch, all.tasks, all.ledger, all.list, all.config.categories])
  const liveDetails = useAxive(s => s.config.liveDetails !== false)
  // the sort the list was left in (kept by the core for the next start)
  const [sort, setSort] = useState<{key: SortKey; dir: 1 | -1}>(() => {
    const key = recalled('sortKey', 'status')
    return {key: (SORT_KEYS as readonly string[]).includes(key) ? (key as SortKey) : 'status', dir: recalled<number>('sortDir', 1) === -1 ? -1 : 1}
  })
  useEffect(() => remember({sortKey: sort.key, sortDir: sort.dir}), [sort])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string>()
  const [focus, setFocus] = useState<string>()
  const [detail, setDetail] = useState<string>()
  const [menu, setMenu] = useState<{x: number; y: number; r: Row}>()
  const body = useRef<HTMLTableSectionElement>(null)

  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean)
    const list = rows.filter(r => inFilter(r, scope.status) && (!scope.category || r.category === scope.category) && (!scope.queue || r.queueId === scope.queue) && words.every(w => `${r.name} ${r.job?.url ?? r.fetch?.uri ?? ''}`.toLowerCase().includes(w)))
    return sortRows(list, sort.key, sort.dir)
  }, [rows, scope, search, sort])
  const chosen = shown.filter(r => picked.has(r.key))
  const focusRow = shown.find(r => r.key === focus) ?? shown[0]

  // live details: while something downloads, its details stay in view without a click (settings › general)
  const lead = useMemo(() => rows.filter(r => r.status === 'drawing' || r.status === 'preparing').sort((a, b) => b.added - a.added)[0], [rows])
  const [followed, setFollowed] = useState<string>()
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    if (lead) setFollowed(lead.key)
  }, [lead?.key])
  // once nothing moves, the next download opens its details again
  useEffect(() => {
    if (!lead && dismissed) setDismissed(false)
  }, [Boolean(lead)])
  const following = !detail && liveDetails && !dismissed
  const detailRow = rows.find(r => r.key === detail) ?? (following && followed ? rows.find(r => r.key === followed) : undefined)
  const closeDetail = () => (detail ? setDetail(undefined) : setDismissed(true))

  // a row that went away leaves the selection
  useEffect(() => {
    const keys = new Set(rows.map(r => r.key))
    setPicked(p => (([...p].every(k => keys.has(k)) ? p : new Set([...p].filter(k => keys.has(k))))))
    if (detail && !keys.has(detail)) setDetail(undefined)
  }, [rows])

  const pick = (e: React.MouseEvent | React.KeyboardEvent, r: Row) => {
    setFocus(r.key)
    if (e.shiftKey && anchor) {
      const a = shown.findIndex(x => x.key === anchor)
      const b = shown.findIndex(x => x.key === r.key)
      const [lo, hi] = a < b ? [a, b] : [b, a]
      setPicked(new Set(shown.slice(lo, hi + 1).map(x => x.key)))
      return
    }
    setAnchor(r.key)
    if (e.ctrlKey || (e.target as HTMLElement).closest('.c-check')) {
      setPicked(p => {
        const n = new Set(p)
        if (n.has(r.key)) n.delete(r.key)
        else n.add(r.key)
        return n
      })
      return
    }
    setPicked(new Set([r.key]))
    if (detail || (following && detailRow)) setDetail(r.key)
  }
  const openMenu = (e: React.MouseEvent, r: Row) => {
    e.preventDefault()
    if (!picked.has(r.key)) setPicked(new Set([r.key]))
    setFocus(r.key)
    setMenu({x: e.clientX, y: e.clientY, r})
  }

  // the keyboard map (H2) for the list; the shell sends the global ones here as events
  useEffect(() => {
    const target = () => (chosen.length ? chosen : focusRow ? [focusRow] : [])
    const on = (e: Event) => {
      const op = (e as CustomEvent<string>).detail
      const list = target()
      if (op === 'select-all') return setPicked(new Set(shown.map(r => r.key)))
      if (op === 'clear') return (setPicked(new Set()), setDetail(undefined))
      if (op === 'details') return focusRow && setDetail(d => (d === (chosen[0] ?? focusRow).key ? undefined : (chosen[0] ?? focusRow).key))
      if (op === 'pause') return list.filter(live).forEach(r => void act(r, 'pause'))
      if (op === 'resume') return list.forEach(r => (resumable(r) ? act(r, 'resume') : r.status === 'failed' ? act(r, 'retry') : undefined))
      if (op === 'delete') return deleteRows(list)
      const r = list[0]
      if (op === 'open-file' && r?.file && (r.status === 'received' || r.status === 'seeding')) return void attempt(() => call('open', {path: r.file}))
      if (op === 'open-folder' && r && (r.file || r.folder)) return void attempt(() => call('reveal', {path: r.file ?? r.folder}))
    }
    window.addEventListener('axive-list', on)
    return () => window.removeEventListener('axive-list', on)
  })

  const rowKey = (e: React.KeyboardEvent) => {
    const at = shown.findIndex(r => r.key === focusRow?.key)
    const go = (i: number) => {
      const r = shown[Math.max(0, Math.min(shown.length - 1, i))]
      if (!r) return
      setFocus(r.key)
      if (!e.ctrlKey) (setPicked(e.shiftKey ? new Set([...picked, r.key]) : new Set([r.key])), detail && setDetail(r.key))
      setTimeout(() => body.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(r.key)}"]`)?.focus(), 0)
    }
    if (e.key === 'ArrowDown') (e.preventDefault(), go(at + 1))
    else if (e.key === 'ArrowUp') (e.preventDefault(), go(at - 1))
    else if (e.key === 'Home') (e.preventDefault(), go(0))
    else if (e.key === 'End') (e.preventDefault(), go(shown.length - 1))
    else if (e.key === ' ' && focusRow) {
      e.preventDefault()
      setPicked(p => {
        const n = new Set(p)
        if (n.has(focusRow.key)) n.delete(focusRow.key)
        else n.add(focusRow.key)
        return n
      })
    } else if (e.key === 'Enter' && focusRow) setDetail(focusRow.key)
    else if (e.key === 'ContextMenu' && focusRow) {
      e.preventDefault()
      const el = body.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusRow.key)}"]`)?.getBoundingClientRect()
      setMenu({x: (el?.left ?? 200) + 80, y: (el?.bottom ?? 200) - 8, r: focusRow})
    }
  }

  const speed = shown.reduce((s, r) => s + r.speed, 0)
  const totalSize = chosen.reduce((s, r) => s + (r.size ?? 0), 0)
  const moving = rows.filter(r => r.status === 'drawing').length
  const filtered = scope.status !== 'all' || scope.category || scope.queue || search

  return (
    <div className={`transfers ${detailRow ? 'with-detail' : ''}`}>
      <section className="list" aria-label={t('tunnels')}>
        <div className="list-head">
          <div>
            <h1 className="view-title">{t(scope.status === 'all' && !scope.category && !scope.queue ? 'tunnels' : scope.queue ? queues.find(q => q.id === scope.queue)?.name ?? 'tunnels' : scope.category ? (all.config.categories as {id: string; name: string}[] | undefined)?.find(c => c.id === scope.category)?.name ?? 'tunnels' : FILTER_TITLE[scope.status])}</h1>
            <p className="view-sub data">{t(`${shown.length} shown`)}{moving ? ` · ${t(`${moving} descending`)}` : ''}{speed ? ` · ${formatSpeed(speed)}` : ''}</p>
          </div>
          <div className="list-tools">
            {filtered ? (
              <Button kind="quiet" icon="close" onClick={() => onScope({status: 'all'})} hint="show everything again">
                clear filters
              </Button>
            ) : null}
            <Button kind="quiet" icon="pause" hint="pause every draw and file" onClick={() => void attempt(async () => (await call('jobs', {op: 'pause-all'}), await call('fetches', {op: 'pause-all'})))}>
              pause all
            </Button>
            <Button kind="quiet" icon="play" onClick={() => void attempt(async () => (await call('jobs', {op: 'resume-all'}), await call('fetches', {op: 'resume-all'})))}>
              resume all
            </Button>
            <Button kind="quiet" icon="check" hint="tidy the list (files stay)" onClick={() => void attempt(async () => (await call('jobs', {op: 'clear'}), await call('fetches', {op: 'clear'})))}>
              clear finished
            </Button>
          </div>
        </div>

        {chosen.length > 1 ? (
          <div className="bulk surface" role="toolbar" aria-label={t('for the chosen')}>
            <span className="data">{t(`${chosen.length} chosen`)}{totalSize ? ` · ${sizeText(totalSize)}` : ''}</span>
            <Button kind="quiet" icon="pause" keys="Control+P" onClick={() => chosen.filter(live).forEach(r => void act(r, 'pause'))}>
              pause
            </Button>
            <Button kind="quiet" icon="play" keys="Control+R" onClick={() => chosen.forEach(r => (resumable(r) ? act(r, 'resume') : r.status === 'failed' ? act(r, 'retry') : undefined))}>
              resume
            </Button>
            {queues.length > 1 ? (
              <span className="select-wrap">
                <select className="select" aria-label={t('move to tunnel')} value="" onChange={e => chosen.filter(r => r.kind !== 'task').forEach(r => void attempt(() => call('move-queue', {kind: r.kind, id: r.id, queueId: e.target.value})))}>
                  <option value="">{t('move to…')}</option>
                  {queues.map(q => (
                    <option key={q.id} value={q.id}>
                      {q.name}
                    </option>
                  ))}
                </select>
                <Icon name="down" />
              </span>
            ) : null}
            <Button kind="quiet" icon="trash" keys="Delete" hint="asks first: only from the list, or from the drive too (live ones stop)" onClick={() => deleteRows(chosen)}>
              delete
            </Button>
            <span className="grow" />
            <Button kind="quiet" icon="close" label="clear the choice" hint="esc" onClick={() => setPicked(new Set())} />
          </div>
        ) : null}

        {shown.length ? (
          <div className="table-wrap">
            <table className="grid" role="grid" aria-multiselectable="true" aria-label={t('tunnels')} aria-rowcount={shown.length}>
              <thead>
                <tr>
                  <th className="c-check" scope="col">
                    <button
                      type="button"
                      className={`check ${chosen.length && chosen.length === shown.length ? 'on' : chosen.length ? 'some' : ''}`}
                      aria-label={t(chosen.length === shown.length ? 'choose none' : 'choose all')}
                      onClick={() => setPicked(chosen.length === shown.length ? new Set() : new Set(shown.map(r => r.key)))}
                    />
                  </th>
                  {COLS.map(c => (
                    <th key={c.key} className={c.cls} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                      <button type="button" className="sort" onClick={() => setSort(s => ({key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : c.key === 'name' ? 1 : -1}))}>
                        {t(c.label)}
                        <span className="arrow" aria-hidden>
                          {sort.key === c.key ? (sort.dir === 1 ? '↑' : '↓') : ''}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th className="c-more" scope="col">
                    <span className="sr-only">{t('more')}</span>
                  </th>
                </tr>
              </thead>
              <tbody ref={body} onKeyDown={rowKey}>
                {shown.map(r => (
                  <RowView key={r.key} r={r} selected={picked.has(r.key)} focused={r.key === focusRow?.key} onPick={pick} onMenu={openMenu} onOpen={x => setDetail(x.key)} />
                ))}
              </tbody>
            </table>
          </div>
        ) : filtered ? (
          <div className="empty-list">
            <p className="empty">{t(emptyLine(scope, search, all.config.categories as {id: string; name: string}[] | undefined))}</p>
            <div className="row-gap">
              <Button kind="quiet" onClick={() => onScope({status: 'all'})}>
                show everything
              </Button>
              <Button kind="quiet" icon="plus" onClick={onNew}>
                a new draw
              </Button>
            </div>
          </div>
        ) : (
          <Empty onNew={onNew} />
        )}
      </section>
      {detailRow ? <Detail row={detailRow} onClose={closeDetail} live={{on: liveDetails, set: v => (setConfig({liveDetails: v}), v || setDismissed(false))}} /> : null}
      {menu ? <Menu x={menu.x} y={menu.y} label="what to do" onClose={() => setMenu(undefined)} items={chosen.length > 1 ? bulkMenu(chosen, queues) : rowMenu(menu.r, queues, r => setDetail(r.key))} /> : null}
    </div>
  )
}

const FILTER_TITLE: Record<Filter, string> = {all: 'tunnels', active: 'drawing', held: 'held', received: 'received', failed: 'failed'}

/** What an empty filter says: about that filter, never the welcome plate again. */
function emptyLine(scope: Scope, search: string, cats?: {id: string; name: string}[]): string {
  if (search.trim()) return `nothing here matches “${search.trim()}”.`
  if (scope.category) return `nothing in ${cats?.find(c => c.id === scope.category)?.name ?? 'this category'} yet. what you receive of this kind rests here.`
  if (scope.queue) return 'nothing waits in this tunnel.'
  const lines: Record<Filter, string> = {
    all: 'nothing here yet.',
    active: 'nothing is drawing right now.',
    held: 'nothing is paused or waiting.',
    received: 'nothing received yet. what you draw rests here, also after a restart.',
    failed: 'nothing has failed.',
  }
  return lines[scope.status]
}

function bulkMenu(rows: Row[], queues: Queue[]): MenuItem[] {
  return [
    {label: `pause ${rows.length}`, icon: 'pause', keys: 'ctrl+P', onSelect: () => rows.filter(live).forEach(r => void act(r, 'pause'))},
    {label: `resume ${rows.length}`, icon: 'play', keys: 'ctrl+R', onSelect: () => rows.forEach(r => (resumable(r) ? act(r, 'resume') : r.status === 'failed' ? act(r, 'retry') : undefined))},
    ...queues.map(q => ({label: `move to ${q.name}`, icon: 'queue' as const, onSelect: () => rows.filter(r => r.kind !== 'task').forEach(r => void attempt(() => call('move-queue', {kind: r.kind, id: r.id, queueId: q.id})))})),
    'rule',
    {label: `delete ${rows.length}`, icon: 'trash', keys: 'Del', danger: true, onSelect: () => deleteRows(rows)},
  ]
}

/** No transfers yet: the plate, with the ways in and their keys inline (H4). */
function Empty({onNew}: {onNew: () => void}) {
  const recent = useAxive(s => s.recent)
  return (
    <div className="plate surface">
      <span className="ticks" aria-hidden />
      <Wordmark size="grand" />
      <Sigil className="plate-sigil" />
      <p className="tagline">{t('paste. draw. receive.')}</p>
      <div className="plate-doors">
        <button type="button" className="door-card" onClick={onNew}>
          <Keys k="ctrl+N" />
          <span>{t('a new draw')}</span>
        </button>
        <button type="button" className="door-card" onClick={() => window.dispatchEvent(new CustomEvent('axive-paste'))}>
          <Keys k="ctrl+V" />
          <span>{t('offer what you copied')}</span>
        </button>
        {FREE ? null : (
          <button type="button" className="door-card" onClick={() => window.dispatchEvent(new CustomEvent('axive-open-file'))}>
            <Keys k="ctrl+O" />
            <span>{t('a file you have')}</span>
          </button>
        )}
        <div className="door-card still">
          <span className="keys-inline">
            <kbd>{t('drop')}</kbd>
          </span>
          <span>{t(FREE ? 'a link, anywhere' : 'a link, a .torrent or a file, anywhere')}</span>
        </div>
      </div>
      <p className="meta">{t(FREE ? 'video and music from 1,800+ sites, up to 8K · any file over 16 connections' : 'video and music from 1,800+ sites · playlists and channels · Spotify · any file, torrent or magnet · or words to search')}</p>
      {recent.length ? (
        <nav className="recent" aria-label={t('offered before')}>
          <div className="label">{t('offered before')}</div>
          <ul>
            {recent.slice(0, 4).map(r => (
              <li key={r}>
                <button type="button" className="link" onClick={() => window.dispatchEvent(new CustomEvent('axive-offer', {detail: r}))}>
                  {r}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  )
}
