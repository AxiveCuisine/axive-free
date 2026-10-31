import React, {useEffect, useState} from 'react'
import {formatBytes, formatEta, formatSpeed} from '../../../src/core/format.js'
import {type Row} from '../model.js'
import {attempt, call, convertFile, historyOf, queuesOf, say, sendToTelegram, t, useAxive} from '../state.js'
import {FREE} from '../edition.js'
import {Button, Choice, Field, Progress, Select, Tabs, Thumb, Toggle} from '../ui.js'
import {act, deleteOp, deleteRows} from './transfers.js'
import {Combine, ConnRows, PieceMap, Throughput, healthOf, useTick, type Conn} from './vis.js'

/**
 * The detail panel (B8): what one transfer is doing, in tabs. Status holds the
 * piece map, the minute of speed, the connections converging into the file
 * and one row per connection; speed holds its own limit and connection count;
 * when done holds what happens after, and the checksum; info holds where it
 * came from, a fresh link, and what went wrong.
 */

type FetchDetail = {
  pieces?: {map: string; edges?: number[]; retrying?: number[]} | string
  servers?: Array<{uri: string; speed: number; range?: string; health?: Conn['health']}>
  connections?: Array<{host: string; speed: number; range?: string; health?: Conn['health']; backup?: boolean}>
  peers?: Array<{ip: string; speed: number; seeder?: boolean}>
  history?: number[]
  rampVerdict?: string
}

const hostOf = (u: string) => {
  try {
    return new URL(u).host
  } catch {
    return u.slice(0, 40)
  }
}

function useFetchDetail(gid: string | undefined, liveish: boolean): FetchDetail | undefined {
  const [d, setD] = useState<FetchDetail>()
  useEffect(() => {
    setD(undefined)
    if (!gid) return
    let stop = false
    let missing = false
    const pull = () =>
      !missing &&
      call<FetchDetail>('fetch-detail', {gid}).then(
        r => !stop && setD(r),
        e => ((e as Error).message.includes('not here yet') ? (missing = true) : undefined),
      )
    void pull()
    const id = liveish ? setInterval(pull, 1000) : undefined
    return () => {
      stop = true
      if (id) clearInterval(id)
    }
  }, [gid, liveish])
  return d
}

type Tab = 'status' | 'speed' | 'done' | 'info'

export function Detail({row, onClose, live}: {row: Row; onClose: () => void; live?: {on: boolean; set: (v: boolean) => void}}) {
  const [tab, setTab] = useState<Tab>('status')
  const maxConn = useAxive(s => Number(s.config.fetchConnections ?? 16))
  useTick()
  const f = row.fetch
  const j = row.job
  const moving = row.status === 'drawing' || row.status === 'preparing'
  const detail = useFetchDetail(f?.gid, moving || row.status === 'held')
  const done = row.status === 'received' || row.status === 'seeding'
  useEffect(() => setTab('status'), [row.key])

  const history = detail?.history?.length ? detail.history : historyOf(row.key)
  const pieces = typeof detail?.pieces === 'string' ? {map: detail.pieces} : detail?.pieces
  const map = pieces?.map && pieces.map.length >= (f?.map?.length ?? 0) ? pieces.map : f?.map
  const edges = pieces?.map && pieces.map === map ? pieces.edges ?? f?.edges : f?.edges
  const conns: Conn[] = (() => {
    if (detail?.connections?.length) return detail.connections.map((c, i) => ({id: String(i), host: c.host, speed: c.speed, range: c.range, health: c.backup ? 'backup' : c.health}))
    if (detail?.peers?.length) {
      const best = Math.max(0, ...detail.peers.map(p => p.speed))
      return detail.peers.map((p, i) => ({id: String(i), host: p.ip, speed: p.speed, seeder: p.seeder, health: healthOf(p.speed, best)}))
    }
    if (detail?.servers?.length) {
      const best = Math.max(0, ...detail.servers.map(s => s.speed))
      return detail.servers.map((s, i) => ({id: String(i), host: hostOf(s.uri), speed: s.speed, range: s.range, health: s.health ?? healthOf(s.speed, best)}))
    }
    return []
  })()

  return (
    <aside className="detail surface" aria-labelledby="detail-title">
      <header className="detail-head">
        <Thumb src={row.thumb} alt="" fallback={row.glyph} className="detail-thumb" />
        <div className="detail-name">
          <h2 id="detail-title" className="section-title" title={row.name}>
            {row.name}
          </h2>
          <p className={`st ${row.status}`}>{t(row.detail)}</p>
        </div>
        <Button icon="close" kind="quiet" label="close the details" hint="ctrl+I" onClick={onClose} />
      </header>

      <dl className="figures">
        <div>
          <dt>{t('speed')}</dt>
          <dd className="data">{row.speed ? formatSpeed(row.speed) : '·'}</dd>
        </div>
        <div>
          <dt>{t('left')}</dt>
          <dd className="data">{row.eta ? formatEta(row.eta) : '·'}</dd>
        </div>
        <div>
          <dt>{t('received')}</dt>
          <dd className="data">{row.size ? `${formatBytes(row.done)} / ${formatBytes(row.size)}` : row.done ? formatBytes(row.done) : '·'}</dd>
        </div>
        <div>
          <dt>{t(f && f.kind !== 'file' ? 'peers' : 'connections')}</dt>
          <dd className="data">{f ? `${f.connections}${f.kind === 'file' ? ` / ${maxConn}` : f.seeders !== undefined ? ` · ${f.seeders} ${t('seeding')}` : ''}` : row.kind === 'job' ? '1' : '·'}</dd>
        </div>
      </dl>

      <Tabs
        label="details"
        idBase="detail"
        value={tab}
        onChange={setTab}
        tabs={[
          {id: 'status', label: 'status'},
          ...(row.kind === 'task' ? [] : [...(row.kind === 'past' ? [] : [{id: 'speed' as const, label: 'speed'}]), {id: 'done' as const, label: 'when done'}, {id: 'info' as const, label: 'info'}]),
        ]}
      />
      <div className="detail-body" role="tabpanel" id="detail-panel" aria-labelledby={`detail-tab-${tab}`} tabIndex={0}>
        {tab === 'status' ? (
          <>
            {done ? <Completion row={row} /> : null}
            {row.status === 'failed' && j?.error ? <Failure row={row} /> : null}
            {row.status === 'failed' && f?.error ? <p className="err">{t(f.error)}</p> : null}
            {f?.warning ? <p className="warn">{t(f.warning)}</p> : null}
            {map && !done ? (
              <section className="block">
                <h3 className="label">{t('piece map')}</h3>
                <PieceMap map={map} edges={edges} retrying={pieces?.retrying} rest={row.status !== 'drawing'} pieces={f?.pieces} pieceSize={f?.pieceSize} who={f ? `${f.connections} ${f.kind === 'file' ? (f.connections === 1 ? 'connection' : 'connections') : f.connections === 1 ? 'peer' : 'peers'}` : undefined} approximate={f?.kind !== 'file'} />
              </section>
            ) : !done ? (
              <section className="block">
                <Progress fraction={row.fraction} status={row.status} label={row.name} />
              </section>
            ) : null}
            {!done && row.kind !== 'task' ? (
              <section className="block">
                <h3 className="label">{t('the last minute')}</h3>
                <Throughput values={history} />
              </section>
            ) : null}
            {f && !done && (conns.length || f.connections) ? (
              <section className="block">
                <h3 className="label">{t(f.kind === 'file' ? 'connections into the file' : 'peers into the file')}</h3>
                <Combine conns={conns.length ? conns : Array.from({length: Math.min(12, f.connections)}, (_, i) => ({id: String(i), host: '', speed: f.connections ? (f.smooth ?? f.speed) / f.connections : 0}))} total={f.smooth ?? f.speed} name={f.name} still={row.status !== 'drawing'} />
                {conns.length ? <ConnRows conns={conns} peers={f.kind !== 'file'} /> : <p className="meta">{t('each connection appears here once the engine reports it')}</p>}
                {detail?.rampVerdict ? <p className="meta">{t(detail.rampVerdict)}</p> : null}
              </section>
            ) : null}
            {row.kind === 'task' && row.task?.state === 'failed' ? <p className="err">{t(row.task.error ?? 'failed')}</p> : null}
          </>
        ) : tab === 'speed' ? (
          <SpeedTab row={row} verdict={detail?.rampVerdict} />
        ) : tab === 'done' ? (
          <WhenDone row={row} />
        ) : (
          <Info row={row} />
        )}
      </div>
      <footer className="detail-foot">
        {row.status === 'drawing' || row.status === 'preparing' || (row.status === 'held' && row.word !== 'paused') ? (
          <Button icon="pause" keys="Control+P" onClick={() => void act(row, 'pause')}>
            pause
          </Button>
        ) : row.word === 'paused' || row.word === 'cancelled' ? (
          <Button kind="primary" icon="play" keys="Control+R" onClick={() => void act(row, 'resume')}>
            resume
          </Button>
        ) : row.status === 'failed' ? (
          <Button kind="primary" icon="retry" keys="Control+R" onClick={() => void act(row, 'retry')}>
            retry
          </Button>
        ) : null}
        <span className="grow" />
        {live ? <Toggle label="live details" value={live.on} onChange={live.set} hint="keep the details of what downloads in view, without a click" /> : null}
        {row.kind === 'task' ? null : deleteOp(row) === 'cancel' ? (
          <Button kind="danger" icon="trash" keys="Delete" onClick={() => deleteRows([row])} hint="it stops; you choose whether its partial file goes too">
            stop and delete
          </Button>
        ) : (
          <Button kind="quiet" icon="trash" keys="Delete" onClick={() => deleteRows([row])} hint="from the list, and if you choose, from the drive">
            delete
          </Button>
        )}
      </footer>
    </aside>
  )
}

/** The completion card (B9): open, its folder, move or rename, convert, send. */
function Completion({row}: {row: Row}) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  const file = row.file
  const base = file?.split(/[\\/]/).pop() ?? ''
  return (
    <section className="completion">
      <p className="received">
        <span aria-hidden>∴ </span>
        {t('received.')} <span className="data">{row.size ? formatBytes(row.size) : ''}</span>
      </p>
      {file ? <p className="meta path selectable">{base}</p> : row.kind === 'past' ? <p className="meta">{t('the file is no longer where it was received: moved or deleted')}</p> : null}
      <div className="row-gap">
        {file ? (
          <Button kind="primary" icon="play" keys="Control+O" onClick={() => void attempt(() => call('open', {path: file}))}>
            open
          </Button>
        ) : null}
        <Button icon="folder" keys="Control+F" onClick={() => void attempt(() => call('reveal', {path: file ?? row.past?.filepath ?? row.folder}))}>
          show in folder
        </Button>
        {file && row.kind !== 'task' && !FREE ? (
          <Button icon="convert" hint="into mp3, mp4, gif, flac… or trim and distill" onClick={() => convertFile(file)}>
            convert
          </Button>
        ) : null}
        {file && !FREE ? (
          <Button icon="send" hint="to your Telegram bot (the file up to 50 MB, its path past that)" onClick={() => sendToTelegram(file)}>
            send
          </Button>
        ) : null}
      </div>
      {file ? (
        renaming ? (
          <form className="relink" onSubmit={e => (e.preventDefault(), void attempt(async () => (await call('file-rename', {path: file, name}), setRenaming(false), say('renamed', 'ok'))))}>
            <Field label="a new name" value={name} onChange={setName} autoFocus>
              <Button type="submit" disabled={!name.trim() || name === base}>
                rename
              </Button>
            </Field>
            <Button kind="quiet" onClick={() => setRenaming(false)}>
              never mind
            </Button>
          </form>
        ) : (
          <div className="row-gap">
            <Button kind="quiet" onClick={() => (setName(base), setRenaming(true))}>
              rename
            </Button>
            <Button kind="quiet" hint="choose another folder in the Windows picker" onClick={() => void attempt(async () => {
              const {path} = await call<{path: string | null}>('pick-folder', {title: 'Move it to'})
              if (path) (await call('file-move', {path: file, folder: path}), say('moved', 'ok'))
            })}>
              move…
            </Button>
          </div>
        )
      ) : null}
    </section>
  )
}

const REMEDY: Record<string, string> = {retry: 'try again', login: 'login', renew: 'renew yt-dlp', mirror: 'seek a mirror', repair: 'repair tools', folder: 'another folder', vessel: 'another vessel'}

/** What went wrong with a draw, and what to do (the TUI's error card). */
function Failure({row}: {row: Row}) {
  const e = row.job!.error!
  const [mirrors, setMirrors] = useState<Array<{url: string; source: string; title: string; duration?: number; note?: string}>>()
  const [seeking, setSeeking] = useState(false)
  const remedy = (r: string) => {
    if (r === 'retry') return void act(row, 'retry')
    // signing in and mirrors are Axive's: Free's door to Axive says so
    if (FREE && (r === 'login' || r === 'mirror')) return window.dispatchEvent(new CustomEvent('axive-go', {detail: {view: 'axive'}}))
    if (r === 'login') return window.dispatchEvent(new CustomEvent('axive-go', {detail: {view: 'settings', section: 'login'}}))
    if (r === 'repair') return window.dispatchEvent(new CustomEvent('axive-go', {detail: {view: 'settings', section: 'tools'}}))
    if (r === 'renew') return void attempt(async () => (say('renewing yt-dlp…'), say((await call<{line: string}>('renew')).line, 'ok')))
    if (r === 'folder' || r === 'vessel') return window.dispatchEvent(new CustomEvent('axive-offer', {detail: row.job!.url}))
    if (r === 'mirror')
      return void attempt(async () => {
        setSeeking(true)
        try {
          setMirrors((await call<{mirrors: NonNullable<typeof mirrors>}>('mirrors', {url: row.job!.url, title: row.job!.title})).mirrors)
        } finally {
          setSeeking(false)
        }
      })
  }
  return (
    <section className="failure">
      <p className="err">
        <span aria-hidden>✗ </span>
        {t(e.title)}
      </p>
      <p className="meta selectable">{t(e.detail)}</p>
      <div className="row-gap">
        {e.remedies.map((r, i) => (
          <Button key={r} kind={i === 0 ? 'primary' : 'plain'} onClick={() => remedy(r)}>
            {REMEDY[r] ?? r}
          </Button>
        ))}
        <Button kind="quiet" icon="copy" hint="copy the raw error text" onClick={() => void attempt(async () => (await call('copy', {text: e.raw}), say('copied', 'ok')))}>
          copy error
        </Button>
      </div>
      {seeking ? <p className="meta">{t('seeking…')}</p> : null}
      {mirrors ? (
        mirrors.length ? (
          <ul className="mirrors">
            {mirrors.map(m => (
              <li key={m.url}>
                <button type="button" className="link" onClick={() => window.dispatchEvent(new CustomEvent('axive-offer', {detail: m.url}))} data-tip={m.url}>
                  {`${m.source} · ${m.title}`}
                </button>
                <span className="meta">{m.note ?? ''}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="meta">{t('no mirror surfaced. the deep keeps some things.')}</p>
        )
      ) : null}
    </section>
  )
}

const LIMITS = ['', '256K', '512K', '1M', '2M', '5M', '10M'] as const

function SpeedTab({row, verdict}: {row: Row; verdict?: string}) {
  const queues = useAxive(queuesOf)
  const f = row.fetch
  const limit = (row.job?.limit ?? f?.limit ?? '') as string
  const [custom, setCustom] = useState(LIMITS.includes(limit as (typeof LIMITS)[number]) ? '' : limit)
  const kind = row.kind as 'job' | 'fetch'
  const setLimit = (l: string) => void attempt(async () => (await call('item-limit', {kind, id: row.id, limit: l}), say(l ? `held to ${l}B/s` : 'no limit of its own', 'ok')))
  return (
    <div className="stack">
      {FREE ? null : (
      <div className="setting-row">
        <div>
          <div className="name">{t('its own speed limit')}</div>
          <div className="help">{t('on top of the global and the tunnel limit; the tightest one wins')}</div>
        </div>
        <Choice label="its own speed limit" value={(LIMITS.includes(limit as (typeof LIMITS)[number]) ? limit : '') as (typeof LIMITS)[number]} options={LIMITS} onChange={setLimit} show={v => (v ? `${v}B/s` : 'none')} />
        <Field label="another limit, like 750K" value={custom} onChange={setCustom} placeholder="750K" width={120} onEnter={() => setLimit(custom.trim())} />
      </div>
      )}
      {f?.kind === 'file' && row.status !== 'received' ? (
        <div className="setting-row">
          <div>
            <div className="name">{t('connections')}</div>
            <div className="help">{t('change it while it runs; Axive steps down when a server refuses and climbs back after')}</div>
          </div>
          <Choice label="connections" value={String(Math.max(1, f.connections))} options={['1', '2', '4', '8', '12', '16'] as const as readonly string[]} onChange={n => void attempt(() => call('fetch-connections', {gid: f.gid, n: Number(n)}))} />
          {verdict ? <p className="meta">{t(verdict)}</p> : null}
        </div>
      ) : null}
      {queues.length > 1 && row.status !== 'received' ? (
        <div className="setting-row">
          <div>
            <div className="name">{t('tunnel')}</div>
            <div className="help">{t('which queue it waits and runs in')}</div>
          </div>
          <Select label="tunnel" value={row.queueId} options={queues.map(q => q.id)} show={id => queues.find(q => q.id === id)?.name ?? id} onChange={q => void attempt(() => call('move-queue', {kind, id: row.id, queueId: q}))} />
        </div>
      ) : null}
    </div>
  )
}

function WhenDone({row}: {row: Row}) {
  const item = (row.job ?? row.fetch ?? {}) as {openWhenDone?: boolean; showWhenDone?: boolean}
  const [flags, setFlags] = useState({openWhenDone: Boolean(item.openWhenDone), showWhenDone: Boolean(item.showWhenDone)})
  const flip = (k: keyof typeof flags, v: boolean) => {
    const next = {...flags, [k]: v}
    setFlags(next)
    void attempt(() => call('completion', {kind: row.kind, id: row.id, flags: next}))
  }
  const done = row.status === 'received' || row.status === 'seeding'
  return (
    <div className="stack">
      {!done && !FREE ? (
        <>
          <Toggle label="open it when it is received" value={flags.openWhenDone} onChange={v => flip('openWhenDone', v)} />
          <Toggle label="show it in its folder when it is received" value={flags.showWhenDone} onChange={v => flip('showWhenDone', v)} />
          <p className="meta">{t('what happens when a whole tunnel empties (sleep, shut down…) is set per tunnel')}</p>
          <Button kind="quiet" icon="queue" onClick={() => window.dispatchEvent(new CustomEvent('axive-go', {detail: {view: 'queues'}}))}>
            tunnels and their schedules
          </Button>
        </>
      ) : null}
      {done && row.file ? <Checksum file={row.file} /> : null}
    </div>
  )
}

/** D8: SHA-256, SHA-1 or MD5 of a received file, compared with the sum the site gives. */
export function Checksum({file}: {file: string}) {
  const [algo, setAlgo] = useState<'sha256' | 'sha1' | 'md5'>('sha256')
  const [expected, setExpected] = useState('')
  const [hex, setHex] = useState<string>()
  const [busy, setBusy] = useState(false)
  const clean = expected.trim().toLowerCase().replace(/^(sha256|sha1|md5)[:=\s]+/, '')
  const match = hex && clean ? hex === clean : undefined
  return (
    <section className="block checksum">
      <h3 className="label">{t('checksum')}</h3>
      <p className="meta">{t('paste the sum the site gives; Axive reads the whole file and compares')}</p>
      <Choice label="checksum" value={algo} options={['sha256', 'sha1', 'md5'] as const} onChange={a => (setAlgo(a), setHex(undefined))} show={a => a.toUpperCase().replace('SHA', 'SHA-')} />
      <Field label="the expected sum" value={expected} onChange={setExpected} placeholder="the expected sum (optional)" mono />
      <div className="row-gap">
        <Button disabled={busy} icon="hash" onClick={() => void attempt(async () => {
          setBusy(true)
          try {
            setHex((await call<{hex: string}>('checksum', {path: file, algo})).hex)
          } finally {
            setBusy(false)
          }
        })}>
          {busy ? 'reading…' : 'verify'}
        </Button>
      </div>
      {hex ? <p className="data selectable hex">{hex}</p> : null}
      {match === true ? <p className="ok-line">∴ {t('it matches')}</p> : match === false ? <p className="err">✗ {t('it does not match: the file differs from what the site published')}</p> : null}
    </section>
  )
}

function Info({row}: {row: Row}) {
  const f = row.fetch
  const url = row.url
  const [relink, setRelink] = useState(false)
  const [fresh, setFresh] = useState('')
  const awaiting = useAxive(s => s.awaiting?.gid === f?.gid || f?.awaiting)
  const canRelink = f?.kind === 'file' && (f.state === 'paused' || f.state === 'failed' || f.state === 'waiting')
  return (
    <div className="stack">
      <dl className="facts">
        {url ? (
          <>
            <dt>{t('link')}</dt>
            <dd className="selectable link-line">
              {url}
              <Button kind="quiet" icon="copy" label="copy link" onClick={() => void attempt(async () => (await call('copy', {text: url}), say('copied', 'ok')))} />
            </dd>
          </>
        ) : null}
        {row.folder ? (
          <>
            <dt>{t('rests in')}</dt>
            <dd className="selectable">{row.folder}</dd>
          </>
        ) : null}
        {row.job ? (
          <>
            <dt>{t('vessel')}</dt>
            <dd>{row.job.vessel}</dd>
          </>
        ) : null}
        {f ? (
          <>
            <dt>{t('kind')}</dt>
            <dd>{t(f.kind === 'file' ? 'file' : f.kind)}</dd>
          </>
        ) : null}
        {row.category ? (
          <>
            <dt>{t('category')}</dt>
            <dd>{t(row.category)}</dd>
          </>
        ) : null}
      </dl>
      {canRelink ? (
        <section className="block">
          <h3 className="label">{t('a fresh link')}</h3>
          <p className="meta">{t('the link expired? give it a fresh one and keep what is already here')}</p>
          {relink ? (
            <form className="relink" onSubmit={e => (e.preventDefault(), void attempt(async () => (await call('fetch-relink', {gid: f!.gid, url: fresh.trim()}), setRelink(false), setFresh(''), say('carrying on from the new link', 'ok'))))}>
              <Field label="a fresh link to the same file" value={fresh} onChange={setFresh} placeholder="https://… a fresh link to the same file" autoFocus>
                <Button type="submit" disabled={!/^https?:\/\/\S+$/i.test(fresh.trim())}>
                  use it
                </Button>
              </Field>
            </form>
          ) : (
            <div className="row-gap">
              <Button icon="link" onClick={() => setRelink(true)}>
                new link
              </Button>
              {awaiting ? (
                <Button kind="quiet" onClick={() => void attempt(() => call('await-cancel'))}>
                  stop waiting
                </Button>
              ) : (
                <Button kind="quiet" hint="the next link you send from the browser, the phone or the clipboard goes to this file instead of a new one" onClick={() => void attempt(async () => (await call('await-link', {gid: f!.gid}), say('waiting for the next link from the browser', 'ok')))}>
                  await a link from the browser
                </Button>
              )}
            </div>
          )}
        </section>
      ) : null}
    </div>
  )
}
