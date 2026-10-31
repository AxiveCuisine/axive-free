import React, {useMemo, useState} from 'react'
import {formatBytes} from '../../../src/core/format.js'
import {attempt, call, convertFile, say, sendToTelegram, t, useAxive} from '../state.js'
import {FREE} from '../edition.js'
import {Button, Choice, Thumb, Title, ago} from '../ui.js'
import {askDelete} from './discard.js'

/** The ledger: everything drawn, newest first, searchable, each with its file. */
export function LedgerView({onOffer}: {onOffer: (url: string) => void}) {
  const entries = useAxive(s => s.ledger)
  const [filter, setFilter] = useState('')
  const [confirm, setConfirm] = useState(false)
  const shown = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
    return words.length ? entries.filter(e => words.every(w => `${e.title} ${e.uploader ?? ''} ${e.url}`.toLowerCase().includes(w))) : entries
  }, [entries, filter])
  return (
    <div className="view gate">
      <span className="ticks" />
      <Title sub={entries.length ? `${entries.length} drawn. every collection is a portrait of its collector` : 'nothing drawn yet'}>ledger</Title>
      <div className="toolbar">
        <label className="field" style={{flex: 1, maxWidth: 520}}>
          <span className="sr-only">{t('Find')}</span>
          <input type="search" value={filter} onChange={e => setFilter(e.target.value)} placeholder={t('title, channel or link')} />
        </label>
        <span className="grow" />
        <Button kind="quiet" icon="up" hint="save the list of downloads as a file another Axive can bring back" onClick={() => void attempt(async () => {
          const r = await call<{path: string | null; count?: number}>('export-list')
          if (r.path) say(`${r.count ?? ''} written to ${r.path.split(/[\/]/).pop()}`, 'ok')
        })}>
          export the list
        </Button>
        <Button kind="quiet" icon="down" hint="bring back a list Axive exported: its files are fetched again" onClick={() => void attempt(async () => {
          const r = await call<{count: number}>('import-list')
          if (r.count) say(`${r.count} brought back into the list`, 'ok')
        })}>
          import
        </Button>
        {entries.length ? (
          confirm ? (
            <>
              <Button kind="danger" onClick={() => void attempt(async () => (await call('ledger-forget', {all: true}), setConfirm(false)))}>
                really forget all?
              </Button>
              <Button kind="quiet" onClick={() => setConfirm(false)}>no</Button>
            </>
          ) : (
            <Button kind="quiet" onClick={() => setConfirm(true)}>forget all</Button>
          )
        ) : null}
      </div>
      {shown.length ? (
        <ul className="rows">
          {shown.map(e => (
            <li key={e.id} className="row">
              <Thumb src={e.thumbnail} alt="" fallback={e.vessel?.includes('audio') ? 'audio' : ''} />
              <div className="body">
                <span className="t selectable" title={e.title}>
                  {e.title}
                </span>
                <span className="status">
                  <span className="data">{t(ago(e.at))}</span>
                  {e.size ? <span className="data">{formatBytes(e.size)}</span> : null}
                  {e.uploader ? <span className="meta">{e.uploader}</span> : null}
                  {!e.exists && e.filepath ? <span className="meta">{t('the file is gone')}</span> : null}
                </span>
              </div>
              <div className="controls">
                <Button icon="play" label="play" disabled={!e.exists} onClick={() => void attempt(() => call('open', {path: e.filepath}))} />
                <Button icon="folder" label="show in folder" disabled={!e.exists} onClick={() => void attempt(() => call('reveal', {path: e.filepath}))} />
                {FREE ? null : <Button icon="convert" label="convert" hint="into mp3, mp4, gif, flac…" disabled={!e.exists} onClick={() => convertFile(e.filepath)} />}
                {FREE ? null : <Button icon="send" label="send to telegram" hint="the file itself (up to 50 MB, or 2 GB with an api_id set)" disabled={!e.exists} onClick={() => sendToTelegram(e.filepath)} />}
                {/^https?:/.test(e.url) ? <Button icon="retry" label="draw again" hint={e.url} onClick={() => onOffer(e.url)} /> : null}
                {/^https?:/.test(e.url) ? <Button icon="copy" label="copy link" onClick={() => void attempt(async () => (await call('copy', {text: e.url}), say('copied', 'ok')))} /> : null}
                <Button icon="trash" label="delete" hint="from the ledger, and if you choose, the file from the drive" onClick={() => (e.exists ? askDelete({from: 'ledger', ids: [e.id], names: [e.title]}) : void attempt(() => call('ledger-forget', {id: e.id})))} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">{t(filter ? 'nothing matches.' : 'draws you finish are written here.')}</p>
      )}
    </div>
  )
}

/** Vigils: keep watch over channels, draw only what is new. */
export function VigilsView() {
  const vigils = useAxive(s => s.vigils)
  const config = useAxive(s => s.config)
  const [url, setUrl] = useState('')
  const [since, setSince] = useState<'now' | '3' | '10'>('now')
  const [vessel, setVessel] = useState<'1080' | '720' | 'mp3'>('1080')
  const [busy, setBusy] = useState<string>()
  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label)
    try {
      await work()
    } catch (error) {
      say((error as Error).message, 'error')
    } finally {
      setBusy(undefined)
    }
  }
  return (
    <div className="view gate">
      <span className="ticks" />
      <Title sub="keep watch over a channel; draw only what is new since you last looked">vigils</Title>
      <form
        className="fetch-bar"
        onSubmit={e => {
          e.preventDefault()
          void run('looking at it…', async () => {
            const r = await call<{title: string; queued: number}>('vigil-add', {url, since: since === 'now' ? 'now' : Number(since), vessel, height: vessel === 'mp3' ? 0 : Number(vessel), folder: config.folder})
            setUrl('')
            say(`keeping vigil over ${r.title}${r.queued ? ` · drawing the newest ${r.queued}` : ' · only new uploads will come'}`, 'ok')
          })
        }}
      >
        <label className="field">
          <span className="sr-only">{t('Keep vigil over')}</span>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder={t('youtube.com/@channel, a playlist, a subreddit…')} />
          <Button type="submit" disabled={Boolean(busy) || !url.trim()}>
            watch
          </Button>
        </label>
      </form>
      <div className="toolbar">
        <span className="label">{t('from')}</span>
        <Choice label="from" value={since} options={['now', '3', '10'] as const} onChange={setSince} show={v => (v === 'now' ? 'now on (only new uploads)' : `the newest ${v}, then new ones`)} />
        <span className="label">{t('as')}</span>
        <Choice label="as" value={vessel} options={['1080', '720', 'mp3'] as const} onChange={setVessel} show={v => (v === 'mp3' ? 'audio mp3' : `video ≤ ${v}p`)} />
      </div>
      {busy ? <p className="meta">{t(busy)}</p> : null}
      {vigils.length ? (
        <ul className="rows">
          {vigils.map(v => (
            <li key={v.id} className="row">
              <Thumb alt="" fallback={v.vessel === 'audio' ? 'mp3' : `${v.maxHeight}p`} />
              <div className="body">
                <span className="t selectable">{v.title}</span>
                <span className="status">
                  <span className="data">{t(v.lastCheck ? `looked ${ago(v.lastCheck)}` : 'never looked')}</span>
                  {v.lastNew ? <span className="data">{`${v.lastNew} new`}</span> : null}
                  <span className="meta">{v.folder}</span>
                </span>
              </div>
              <div className="controls">
                <Button kind="quiet" disabled={Boolean(busy)} onClick={() => void run('looking for new uploads…', async () => {
                  const {found} = await call<{found: number}>('vigil-sync', {id: v.id})
                  say(found ? `${found} new, drawing in the tunnels` : 'nothing new since the last look', found ? 'ok' : 'info')
                })}>
                  look at this one
                </Button>
                <Button icon="close" label="forget this vigil (drawn files stay)" onClick={() => void attempt(() => call('vigil-remove', {id: v.id}))} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">{t('no vigils yet.')}</p>
      )}
      {vigils.length ? (
        <div className="actions">
          <Button kind="primary" disabled={Boolean(busy)} hint="look at every vigil for new uploads" onClick={() => void run('keeping every vigil…', async () => {
            const r = await call<{found: number; failed: number}>('vigil-sync')
            say(`${r.found} new across ${vigils.length} vigil${vigils.length === 1 ? '' : 's'}${r.failed ? ` · ${r.failed} could not be read` : ''}`, r.found ? 'ok' : 'info')
          })}>
            keep all now
          </Button>
        </div>
      ) : null}
    </div>
  )
}
