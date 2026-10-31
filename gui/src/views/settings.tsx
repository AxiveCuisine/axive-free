import React, {useEffect, useState} from 'react'
import {attempt, call, categoriesOf, linkTelegram, say, setConfig, t, useAxive, type Category, type HostRule, type Meta} from '../state.js'
import {Button, Choice, Field, LanguagePicker, Progress, Toggle} from '../ui.js'
import {ExtensionSettings} from './extension.js'
import {formatBytes} from '../../../src/core/format.js'
import {FREE, PRODUCT} from '../edition.js'

/**
 * The settings (H3): a left menu of sections, each a column of grouped rows,
 * drawn from the same definitions as the terminal and `axive config` (META in
 * src/core/config.ts). Simple Language sits above everything (H1): the switch
 * that explains every other word is the first control on the page.
 */

const SHOW: Record<string, Record<string, string>> = {
  organize: {none: 'one folder', channel: 'a folder per channel', date: 'a folder per month', 'channel-date': 'channel / month'},
  naming: {title: 'title', 'title-id': 'title [id]', 'uploader-title': 'channel - title', 'date-title': 'date title'},
  sponsorblock: {off: 'left alone', remove: 'cut out', mark: 'marked as chapters'},
  autoConvert: {'': 'nothing'},
  speedProfile: {full: 'full speed', slow: 'slow mode', custom: 'my own limit'},
  onDuplicate: {number: 'add a number', overwrite: 'replace it', skip: 'skip it', ask: 'ask me'},
}

type Extra = 'sweep' | 'peers' | 'folder' | 'recipes' | 'categories' | 'hosts' | 'bond' | 'queues' | 'browser' | 'phone' | 'login' | 'renewal' | 'about' | 'chime' | 'telegram' | 'telegramLarge'
export type SectionId = 'general' | 'draws' | 'files' | 'speed' | 'queues' | 'browser' | 'phone' | 'ghost' | 'notify' | 'login' | 'tools' | 'about'
const EVERY_SECTION: Array<{id: SectionId; title: string; groups: Array<{title?: string; keys: string[]; extra?: Extra[]}>}> = [
  {id: 'general', title: 'general', groups: [{title: 'where draws rest', keys: ['askWhere'], extra: ['folder']}, {title: 'words and motion', keys: ['animations', 'hoverHints', 'liveDetails']}, {title: 'with Windows', keys: ['riseWithWindows']}]},
  {
    id: 'draws',
    title: 'draws',
    groups: [
      {title: 'files and names', keys: ['organize', 'naming', 'skipArchived', 'warnDuplicates', 'retries']},
      {title: 'inside the file', keys: ['embedMetadata', 'embedThumbnail', 'embedChapters', 'embedSubs', 'subLangs']},
      {title: 'sponsorblock', keys: ['sponsorblock', 'sponsorCategories']},
      {title: 'after drawing', keys: ['autoConvert', 'runAfter']},
      {title: 'recipes', keys: [], extra: ['recipes']},
    ],
  },
  {id: 'files', title: 'files and categories', groups: [{title: 'filing', keys: ['categoryFolders', 'onDuplicate']}, {title: 'categories', keys: [], extra: ['categories']}]},
  {
    id: 'speed',
    title: 'connection and speed',
    groups: [
      {title: 'speed', keys: ['speedProfile', 'slowLimit', 'rateLimit', 'limitWhenBusy', 'busyIdleSeconds']},
      {title: 'connections', keys: ['fetchConnections', 'climbBack', 'fetchSeed', 'fetchTrackers', 'fetchMediaFiles'], extra: ['peers']},
      {title: 'bond networks', keys: [], extra: ['bond']},
      {title: 'per-site settings', keys: [], extra: ['hosts']},
    ],
  },
  {id: 'queues', title: 'queues and schedule', groups: [{keys: ['offPeak', 'vigilsOnStart'], extra: ['queues']}]},
  {id: 'browser', title: 'browser', groups: [{keys: [], extra: ['browser']}]},
  {id: 'phone', title: 'phone', groups: [{keys: ['remote', 'remoteDraw', 'remoteFiles', 'remotePort'], extra: ['phone']}]},
  {id: 'ghost', title: 'ghost', groups: [{keys: ['ghost', 'ghostNotice', 'ghostHotkey'], extra: []}, {title: 'its chime', keys: ['ghostChime', 'ghostChimeLimit', 'ghostChimeWindow'], extra: ['chime']}]},
  {id: 'notify', title: 'notifications', groups: [{title: 'on this PC', keys: ['notifyToast', 'notifySound']}, {title: 'elsewhere', keys: ['webhookUrl']}, {title: 'telegram', keys: ['telegramToken', 'telegramChat'], extra: ['telegram']}, {title: 'telegram: files over 50 MB', keys: ['telegramApiId', 'telegramApiHash'], extra: ['telegramLarge']}]},
  {id: 'login', title: 'login', groups: [{keys: [], extra: ['login']}]},
  {id: 'tools', title: 'renewal and tools', groups: [{keys: ['checkUpdates'], extra: ['renewal']}, {title: 'temporary files', keys: [], extra: ['sweep']}]},
  {id: 'about', title: 'about', groups: [{keys: [], extra: ['about']}]},
]
// Free carries these sections, and of their extras only these; a setting Free's core lacks has no meta, so its row stays away by itself
const FREE_SECTIONS: SectionId[] = ['general', 'draws', 'files', 'speed', 'tools', 'about']
const FREE_EXTRAS: Extra[] = ['folder', 'categories', 'renewal', 'about']
export const SECTIONS = FREE
  ? EVERY_SECTION.filter(s => FREE_SECTIONS.includes(s.id)).map(s => ({...s, groups: s.groups.map(g => ({...g, extra: g.extra?.filter(x => FREE_EXTRAS.includes(x))}))}))
  : EVERY_SECTION

const set = (patch: Record<string, unknown>) => setConfig(patch)

function TextSetting({k, meta, value}: {k: string; meta: Meta; value: string}) {
  const [draft, setDraft] = useState(meta.secret ? '' : value)
  useEffect(() => setDraft(meta.secret ? '' : value), [value, meta.secret])
  const save = () => {
    if (meta.secret && !draft) return
    if (draft !== value) set({[k]: draft.trim()})
  }
  return (
    <div className="row-gap">
      <label className="field">
        <span className="sr-only">{t(meta.label)}</span>
        <input
          type={meta.secret ? 'password' : 'text'}
          value={draft}
          placeholder={meta.secret ? (value ? t('set · type to replace') : t('not set')) : t(meta.help)}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={e => e.key === 'Enter' && save()}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      {value ? (
        <Button kind="quiet" onClick={() => set({[k]: ''})}>
          clear
        </Button>
      ) : null}
      {k === 'runAfter' ? (
        <Button kind="quiet" onClick={() => void attempt(async () => {
          const {path} = await call<{path: string | null}>('pick-file', {kind: 'program', title: 'A program or script to run after each draw'})
          if (path) set({runAfter: path})
        })}>
          choose…
        </Button>
      ) : null}
    </div>
  )
}

/** Ghost's own switch: what the helper really does, the same state the rail's switch shows. */
function GhostSwitch({hint}: {hint: string}) {
  const ghost = useAxive(s => s.ghost)
  return <Toggle label={ghost.on ? 'on' : 'off'} value={ghost.on} disabled={!ghost.available} onChange={on => void attempt(() => call('ghost', {on}))} hint={ghost.available ? hint : "watching the clipboard needs Axive's helper: repair the tools below"} />
}

function Control({k, meta, value}: {k: string; meta: Meta; value: unknown}) {
  if (k === 'ghost') return <GhostSwitch hint={meta.help} />
  if (k === 'speedProfile') return <Choice label={meta.label} value={String(value)} options={meta.options ?? []} onChange={v => void attempt(() => call('speed-profile', {profile: v}).catch(() => call('config', {patch: {speedProfile: v}})))} show={v => SHOW.speedProfile![v] ?? v} />
  switch (meta.kind) {
    case 'bool':
      return <Toggle label={value ? 'on' : 'off'} value={Boolean(value)} onChange={v => set({[k]: v})} hint={meta.help} />
    case 'enum': {
      const options = meta.options ?? []
      return options.length <= 4 ? (
        <Choice label={meta.label} value={String(value)} options={options} onChange={v => set({[k]: v})} show={v => SHOW[k]?.[v] ?? v} />
      ) : (
        <span className="select-wrap">
          <select className="select" aria-label={t(meta.label)} value={String(value)} onChange={e => set({[k]: e.target.value})}>
            {options.map(o => (
              <option key={o} value={o}>
                {t(SHOW[k]?.[o] ?? o)}
              </option>
            ))}
          </select>
        </span>
      )
    }
    case 'int': {
      const steps: Record<string, number[]> = {tunnels: [1, 2, 3, 4], retries: [0, 3, 5, 10], fetchConnections: [1, 4, 8, 16], ghostChimeLimit: [2, 3, 5, 10], ghostChimeWindow: [30, 60, 120, 300], busyIdleSeconds: [60, 120, 300, 900]}
      const options = steps[k]
      if (!options) return <IntSetting k={k} meta={meta} value={Number(value)} />
      const list = [...new Set([...options, Number(value)])].sort((a, b) => a - b).map(String)
      return <Choice label={meta.label} value={String(value)} options={list} onChange={v => set({[k]: Number(v)})} show={v => (k === 'busyIdleSeconds' || k === 'ghostChimeWindow' ? `${v} s` : v)} />
    }
    case 'list': {
      if (k === 'fetchInterfaces') return null
      const list = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="row-gap">
          {(meta.options ?? []).map(o => (
            <Toggle key={o} label={o.replace('music_offtopic', 'non-music').replace('selfpromo', 'self-promo')} value={list.includes(o)} onChange={on => set({[k]: on ? [...list, o] : list.filter(x => x !== o)})} />
          ))}
        </div>
      )
    }
    case 'json':
      return null
    default:
      if (k === 'rateLimit' || k === 'slowLimit') return <Choice label={meta.label} value={String(value)} options={k === 'rateLimit' ? ['', '500K', '1M', '2M', '5M', '10M'] : ['256K', '512K', '1M', '2M']} onChange={v => set({[k]: v})} show={v => (v ? `${v}B/s` : 'none')} />
      if (k === 'offPeak') return <Choice label={meta.label} value={String(value)} options={['00:00', '01:00', '02:00', '03:00', '04:00', '05:00']} onChange={v => set({offPeak: v})} />
      return <TextSetting k={k} meta={meta} value={String(value ?? '')} />
  }
}

function IntSetting({k, meta, value}: {k: string; meta: Meta; value: number}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const save = () => {
    const n = Number(draft)
    if (Number.isInteger(n) && (meta.min === undefined || n >= meta.min) && (meta.max === undefined || n <= meta.max)) set({[k]: n})
    else (say(`a whole number from ${meta.min} to ${meta.max}`, 'warn'), setDraft(String(value)))
  }
  return (
    <label className="field" style={{width: 120}}>
      <span className="sr-only">{t(meta.label)}</span>
      <input inputMode="numeric" value={draft} onChange={e => setDraft(e.target.value)} onBlur={save} onKeyDown={e => e.key === 'Enter' && save()} />
    </label>
  )
}

function Row({k}: {k: string}) {
  const meta = useAxive(s => s.meta[k])
  const value = useAxive(s => s.config[k])
  // ghost's own settings rest with it: dimmed while it does not watch
  const resting = useAxive(s => k !== 'ghost' && k.startsWith('ghost') && !s.ghost.on)
  if (!meta) return null
  const control = <Control k={k} meta={meta} value={value} />
  return (
    <div className={`setting${resting ? ' resting' : ''}`}>
      <div>
        <div className="name">{t(meta.label)}</div>
        <div className="help">{t(meta.help)}</div>
      </div>
      <div className="control">{control}</div>
    </div>
  )
}

function Folder() {
  const folder = useAxive(s => String(s.config.folder ?? ''))
  return (
    <div className="setting">
      <div>
        <div className="name">{t('default folder')}</div>
        <div className="help">{t('where draws rest when Axive does not ask')}</div>
      </div>
      <div className="control">
        <span className="data selectable path">{folder}</span>
        <Button kind="quiet" icon="folder" hint="open the Windows folder picker" onClick={() => void attempt(async () => {
          const {path} = await call<{path: string | null}>('pick-folder', {title: 'Default folder for draws'})
          if (path) set({folder: path})
        })}>
          change
        </Button>
      </div>
    </div>
  )
}

/** Categories (C4, C8): extensions and address patterns per kind of file, each with its own folder. */
function Categories() {
  const cats = useAxive(categoriesOf)
  const [open, setOpen] = useState<string>()
  const save = (next: Category[]) => set({categories: next})
  const patch = (id: string, p: Partial<Category>) => save(cats.map(c => (c.id === id ? {...c, ...p} : c)))
  const [name, setName] = useState('')
  return (
    <div className="cat-list">
      {cats.map(c => (
        <div key={c.id} className="cat">
          <button type="button" className="cat-head" aria-expanded={open === c.id} onClick={() => setOpen(o => (o === c.id ? undefined : c.id))}>
            <span className="name">{t(c.name)}</span>
            <span className="meta">{c.id === 'other' ? t('everything else') : `${c.exts.slice(0, 8).join(' ')}${c.exts.length > 8 ? ' …' : ''}`}</span>
            <span className="data meta">{c.folder ? c.folder.split(/[\\/]/).pop() : t(`· ${c.name}`)}</span>
          </button>
          {open === c.id ? (
            <div className="cat-body stack">
              {c.id === 'other' ? null : <CatList label="extensions" value={c.exts} onSave={exts => patch(c.id, {exts})} placeholder="zip rar 7z" />}
              {c.id === 'other' ? null : <CatList label="address patterns" value={c.patterns} onSave={patterns => patch(c.id, {patterns})} placeholder="*.example.com/files/*" />}
              <div className="row-gap">
                <span className="label">{t('folder')}</span>
                <span className="data path">{c.folder || t('inside the download folder')}</span>
                <Button kind="quiet" icon="folder" onClick={() => void attempt(async () => {
                  const {path} = await call<{path: string | null}>('pick-folder', {title: `A folder for ${c.name}`})
                  if (path) patch(c.id, {folder: path})
                })}>
                  choose
                </Button>
                {c.folder ? (
                  <Button kind="quiet" onClick={() => patch(c.id, {folder: ''})}>
                    the default
                  </Button>
                ) : null}
                {['compressed', 'programs', 'videos', 'music', 'pictures', 'documents', 'other'].includes(c.id) ? null : (
                  <Button kind="quiet" icon="trash" onClick={() => save(cats.filter(x => x.id !== c.id))}>
                    remove
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ))}
      <form className="row-gap" onSubmit={e => (e.preventDefault(), name.trim() && (save([...cats.slice(0, -1), {id: name.trim().toLowerCase().replace(/\W+/g, '-'), name: name.trim(), exts: [], patterns: [], folder: ''}, cats.at(-1)!]), setName('')))}>
        <Field label="a new category" value={name} onChange={setName} placeholder="a new category" width={240} />
        <Button type="submit" icon="plus" disabled={!name.trim()}>
          add
        </Button>
        <Button kind="quiet" onClick={() => void attempt(() => call('categories-reset').catch(() => call('config', {patch: {categories: null}})))}>
          back to the defaults
        </Button>
      </form>
    </div>
  )
}

function CatList({label, value, onSave, placeholder}: {label: string; value: string[]; onSave: (v: string[]) => void; placeholder: string}) {
  const [draft, setDraft] = useState(value.join(' '))
  useEffect(() => setDraft(value.join(' ')), [value.join(' ')])
  const save = () => onSave(draft.split(/[\s,]+/).map(x => x.replace(/^\./, '').trim()).filter(Boolean))
  return (
    <div className="row-gap">
      <span className="label">{t(label)}</span>
      <Field label={label} value={draft} onChange={setDraft} placeholder={placeholder} width={420} onEnter={save} />
      {draft !== value.join(' ') ? (
        <Button kind="quiet" onClick={save}>
          keep
        </Button>
      ) : null}
    </div>
  )
}

/** C7: connections, speed, user agent, referer and a login for every fetch from one site. */
function Hosts() {
  const fromConfig = useAxive(s => (Array.isArray(s.config.hosts) ? (s.config.hosts as HostRule[]) : []))
  const [rules, setRules] = useState<HostRule[]>(fromConfig)
  const [draft, setDraft] = useState<HostRule & {password?: string}>({host: ''})
  useEffect(() => void call<{hosts: HostRule[]}>('hosts').then(r => setRules(r.hosts), () => setRules(fromConfig)), [fromConfig.length])
  const save = () =>
    void attempt(async () => {
      if (!draft.host.trim()) throw new Error('a site, like files.example.com')
      const r = await call<{hosts: HostRule[]}>('host-set', {...draft, host: draft.host.trim()})
      setRules(r.hosts)
      setDraft({host: ''})
      say(`kept: ${draft.host.trim()}`, 'ok')
    })
  return (
    <div className="stack">
      {rules.length ? (
        <table className="hosts">
          <caption className="sr-only">{t('per-site settings')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('site')}</th>
              <th scope="col">{t('connections')}</th>
              <th scope="col">{t('speed')}</th>
              <th scope="col">{t('more')}</th>
              <th scope="col">
                <span className="sr-only">{t('remove')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rules.map(h => (
              <tr key={h.host}>
                <td className="data">{h.host}</td>
                <td className="data">{h.connections ?? ''}</td>
                <td className="data">{h.speedLimit ?? ''}</td>
                <td className="meta">{[h.userAgent ? t('user agent') : '', h.referer ? t('referer') : '', h.user ? t(`login ${h.user}${h.hasPassword ? ' · password kept' : ''}`) : ''].filter(Boolean).join(' · ')}</td>
                <td>
                  <Button kind="quiet" icon="trash" label={`forget ${h.host}`} onClick={() => void attempt(async () => setRules((await call<{hosts: HostRule[]}>('host-remove', {host: h.host})).hosts))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="meta">{t('no site has settings of its own yet')}</p>
      )}
      <form className="host-form" onSubmit={e => (e.preventDefault(), save())}>
        <Field label="site" value={draft.host} onChange={host => setDraft({...draft, host})} placeholder="files.example.com" />
        <Field label="connections, 1 to 16" value={draft.connections ? String(draft.connections) : ''} onChange={v => setDraft({...draft, connections: Number(v) || undefined})} placeholder="connections" width={120} />
        <Field label="speed limit, like 2M" value={draft.speedLimit ?? ''} onChange={speedLimit => setDraft({...draft, speedLimit})} placeholder="speed, 2M" width={120} />
        <Field label="user agent" value={draft.userAgent ?? ''} onChange={userAgent => setDraft({...draft, userAgent})} placeholder="user agent" />
        <Field label="referer" value={draft.referer ?? ''} onChange={referer => setDraft({...draft, referer})} placeholder="referer https://…" />
        <Field label="user name" value={draft.user ?? ''} onChange={user => setDraft({...draft, user})} placeholder="user name" width={160} />
        <Field label="password" type="password" value={draft.password ?? ''} onChange={password => setDraft({...draft, password})} placeholder="password" width={160} />
        <Button type="submit" icon="plus" disabled={!draft.host.trim()}>
          keep
        </Button>
      </form>
      <p className="meta">{t('a password is kept encrypted for this Windows user and never shown again')}</p>
    </div>
  )
}

/** A4: two or more network adapters to split each file across. */
/** Torrent peers may connect in: Axive's firewall rule for its engine, asked of Windows (UAC). */
function Peers() {
  const [state, setState] = useState<{firewall: 'open' | 'closed' | 'unknown'; busy: boolean}>()
  useEffect(() => void call<NonNullable<typeof state>>('peers').then(setState, () => {}), [])
  const flip = (on: boolean) =>
    void attempt(async () => {
      setState(s => (s ? {...s, busy: true} : s))
      const r = await call<NonNullable<typeof state>>('peers-set', {on})
      setState(r)
      const open = r.firewall === 'open'
      if (on) say(open ? 'torrent peers can now connect to this PC' : 'Windows did not add the rule: nothing changed', open ? 'ok' : 'warn')
      else say(open ? 'the rule is still there: Windows did not remove it' : 'the rule is gone: peers no longer connect in', open ? 'warn' : 'ok')
    })
  return (
    <div className="stack">
      <Toggle
        label="let Axive through the firewall"
        value={state?.firewall === 'open'}
        disabled={!state || state.busy}
        onChange={flip}
        hint="a Windows Firewall rule for Axive's torrent engine, so peers can reach you too: more peers, faster torrents. On by default"
      />
      <p className="meta">{t(state?.busy ? 'waiting for Windows…' : state?.firewall === 'open' ? 'peers can reach this PC' : state?.firewall === 'closed' ? 'Windows Firewall keeps peers out: torrents use only the peers Axive reaches itself' : 'asking Windows…')}</p>
    </div>
  )
}

function Bond() {
  const chosen = useAxive(s => (Array.isArray(s.config.fetchInterfaces) ? (s.config.fetchInterfaces as string[]) : []))
  const [list, setList] = useState<Array<{name: string; address: string; kind?: string}>>()
  useEffect(() => void call<{interfaces: NonNullable<typeof list>}>('interfaces').then(r => setList(r.interfaces), () => setList([])), [])
  const flip = (a: string, on: boolean) => set({fetchInterfaces: on ? [...chosen, a] : chosen.filter(x => x !== a)})
  return (
    <div className="stack">
      <p className="meta">{t('Wi-Fi, Ethernet, a phone on USB: choose two or more and each file is split across them. Applies when the engine next starts.')}</p>
      {list === undefined ? null : list.length ? (
        list.map(i => <Toggle key={i.address} label={`${i.name} · ${i.address}`} value={chosen.includes(i.address)} onChange={on => flip(i.address, on)} />)
      ) : (
        <p className="meta">{t('one network found: bonding needs two')}</p>
      )}
      {chosen.length === 1 ? <p className="warn">{t('choose one more: a single network is not bonded')}</p> : null}
    </div>
  )
}

function About() {
  const version = useAxive(s => s.version)
  const licence = useAxive(s => s.licence)
  const [notices, setNotices] = useState<string>()
  return (
    <div className="stack about">
      <p className="about-mark">
        <span className="data">{`${PRODUCT} ${version}`}</span>
      </p>
      {licence.key ? <p className="meta">{`${t('licence')} · ${licence.key}`}</p> : null}
      <div className="row-gap">
        {FREE ? (
          <Button kind="quiet" icon="globe" hint="its source, its releases and its licence (GPL-3.0)" onClick={() => void call('open-url', {url: 'https://github.com/AxiveCuisine/axive-free'})}>
            Axive Free on GitHub
          </Button>
        ) : (
          <Button kind="quiet" icon="globe" onClick={() => void call('open-url', {url: 'https://axive.xyz/'})}>
            axive.xyz
          </Button>
        )}
        <Button kind="quiet" icon="book" onClick={() => void attempt(async () => setNotices(notices ? undefined : (await call<{text: string}>('notices')).text))}>
          {notices ? 'hide the notices' : 'third-party notices'}
        </Button>
      </div>
      {notices ? <pre className="notices selectable">{notices}</pre> : null}
    </div>
  )
}

function Chime() {
  const ghost = useAxive(s => s.ghost)
  return (ghost.chimePausedUntil ?? 0) > Date.now() ? <p className="meta">{t(`sound paused for now · back in ${Math.ceil(((ghost.chimePausedUntil ?? 0) - Date.now()) / 60_000)} min`)}</p> : null
}

function PhoneLink() {
  const on = useAxive(s => s.phone.on)
  return (
    <div className="row-gap">
      <Button icon="phone" onClick={() => window.dispatchEvent(new CustomEvent('axive-go', {detail: {view: 'phone'}}))}>
        {on ? 'the phone is on: show the code' : 'open the phone view'}
      </Button>
    </div>
  )
}

function QueuesLink() {
  return (
    <div className="row-gap">
      <Button icon="queue" onClick={() => window.dispatchEvent(new CustomEvent('axive-go', {detail: {view: 'queues'}}))}>
        tunnels and their schedules
      </Button>
    </div>
  )
}

/** F (G side): what arrived from the browser lately. */
function Arrivals() {
  const offerings = useAxive(s => s.offerings.filter(o => o.from === 'browser'))
  return (
    <div className="stack">
      <div className="label">{t('arrived from the browser')}</div>
      {offerings.length ? (
        <ul className="arrivals">
          {offerings.slice(-12).reverse().map(o => (
            <li key={o.url + o.at}>
              <span className="t">{o.url}</span>
              <Button kind="quiet" onClick={() => window.dispatchEvent(new CustomEvent('axive-offer', {detail: o.url}))}>
                choose
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="meta">{t('nothing waits from the browser')}</p>
      )}
    </div>
  )
}

/** Settings › notifications › telegram: the three linking steps, and a test. */
function TelegramLink() {
  const linked = useAxive(s => Boolean(s.config.telegramToken && s.config.telegramChat))
  return (
    <div className="row-gap">
      <Button kind={linked ? 'plain' : 'primary'} icon="send" onClick={linkTelegram} hint="make a bot with @BotFather, paste its token, send it a message: Axive finds the rest">
        {linked ? 'link another bot…' : 'link your Telegram bot…'}
      </Button>
      {linked ? (
        <Button kind="quiet" onClick={() => void attempt(async () => (await call('telegram-test'), say('sent: look in Telegram', 'ok')))}>
          send a test
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Settings › notifications › telegram, past 50 MB: a bot alone may upload 50 MB.
 * For more (up to 2 GB) Telegram asks for an api_id and api_hash, made once at
 * my.telegram.org; the steps, with the address to open or copy.
 */
export function TelegramLarge() {
  const ready = useAxive(s => /^\d{4,12}$/.test(String(s.config.telegramApiId ?? '')) && Boolean(s.config.telegramApiHash))
  const page = 'https://my.telegram.org/apps'
  return (
    <div className="stack">
      <p className="meta">{t(ready ? 'set: files up to 2 GB go to Telegram as themselves.' : 'not needed for files up to 50 MB. for bigger files (up to 2 GB), Telegram asks for two values of your own:')}</p>
      <ol className="meta steps">
        <li>{t('open my.telegram.org and sign in with your phone number (Telegram sends you a code there).')}</li>
        <li>{t('choose API development tools, fill in any app name and short name (Axive will do), platform Desktop, and create it.')}</li>
        <li>{t('copy App api_id and App api_hash into the two fields above. they stay in Axive on this PC; Axive still signs in as your bot, never as you.')}</li>
      </ol>
      <div className="row-gap">
        <Button icon="link" onClick={() => void call('open-url', {url: page})} hint={page}>
          open my.telegram.org
        </Button>
        <Button kind="quiet" onClick={() => void navigator.clipboard.writeText(page).then(() => say('copied: https://my.telegram.org/apps', 'ok'), () => say(page))}>
          copy the address
        </Button>
      </div>
    </div>
  )
}

function ExtraBlock({x}: {x: Extra}) {
  switch (x) {
    case 'peers':
      return <Peers />
    case 'sweep':
      return <Sweep />
    case 'telegramLarge':
      return <TelegramLarge />
    case 'folder':
      return <Folder />
    case 'recipes':
      return <Recipes />
    case 'categories':
      return <Categories />
    case 'hosts':
      return <Hosts />
    case 'bond':
      return <Bond />
    case 'queues':
      return <QueuesLink />
    case 'browser':
      return (
        <>
          <ExtensionSettings />
          <Arrivals />
        </>
      )
    case 'phone':
      return <PhoneLink />
    case 'login':
      return <Login />
    case 'renewal':
      return (
        <>
          <Renewal />
          <Repair />
        </>
      )
    case 'about':
      return <About />
    case 'chime':
      return <Chime />
    case 'telegram':
      return <TelegramLink />
  }
}

export function SettingsView({section, onSection}: {section: SectionId; onSection: (s: SectionId) => void}) {
  const plainWords = useAxive(s => Boolean(s.config.plainWords))
  const language = useAxive(s => String(s.config.language ?? 'en'))
  const meta = useAxive(s => s.meta.plainWords)
  const current = SECTIONS.find(s => s.id === section) ?? SECTIONS[0]!
  const known = useAxive(s => s.meta)
  return (
    <div className="view settings">
      {/* H1: the switch that explains every other word, first, above everything */}
      <div className="setting settings-lead" role="group" aria-labelledby="plain-name">
        <div>
          <div className="name lead-name" id="plain-name">
            {t(meta?.label ?? 'simple language')}
          </div>
          <div className="help">{t(meta?.help ?? "everyday words instead of the house's own: draw, vessel, ledger…")}</div>
        </div>
        <div className="control">
          <Toggle id="plain-words" label={plainWords ? 'on' : 'off'} value={plainWords} onChange={v => set({plainWords: v})} />
        </div>
      </div>
      {FREE ? null : (
      <div className="setting settings-lead" role="group" aria-labelledby="lang-name">
        <div>
          <div className="name lead-name" id="lang-name">
            {t('language')} · taal
          </div>
          <div className="help">{t('English or Nederlands')}</div>
        </div>
        <div className="control">
          <LanguagePicker value={language} onChange={v => set({language: v})} />
        </div>
      </div>
      )}
      <header className="view-head">
        <h1 className="view-title">{t('settings')}</h1>
        <p className="view-sub">{t('manners are the last thing a person loses. set yours')}</p>
      </header>
      <div className="settings-grid">
        <nav aria-label={t('settings')} className="settings-nav">
          {SECTIONS.map(s => (
            <button key={s.id} type="button" aria-current={s.id === section ? 'page' : undefined} onClick={() => onSection(s.id)}>
              {t(s.title)}
            </button>
          ))}
        </nav>
        <section aria-labelledby="settings-section" className="settings-section surface" key={current.id}>
          <h2 className="section-title" id="settings-section">
            {t(current.title)}
          </h2>
          {current.groups.filter(g => g.keys.some(k => known[k]) || g.extra?.length).map((g, i) => (
            <div className="group" key={i}>
              {g.title ? <h3 className="label group-title">{t(g.title)}</h3> : null}
              {g.extra?.includes('folder') ? <Folder /> : null}
              {g.keys.map(k => (
                <Row key={k} k={k} />
              ))}
              {g.extra?.filter(x => x !== 'folder').map(x => <ExtraBlock key={x} x={x} />)}
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}



function Login() {
  const config = useAxive(s => s.config)
  const [info, setInfo] = useState<{browsers: {id: string; label: string; note?: string}[]; saved: {count: number; domains: string[]; stale: boolean} | null; active: boolean}>()
  const load = () => void call<NonNullable<typeof info>>('login').then(setInfo, () => {})
  useEffect(load, [config.cookies, config.cookieBrowser])
  const using =
    config.cookies === 'browser' && config.cookieBrowser
      ? info?.browsers.find(b => b.id === config.cookieBrowser)?.label ?? String(config.cookieBrowser)
      : config.cookies === 'file' && info?.saved
        ? `pasted cookies · ${info.saved.count} for ${info.saved.domains.slice(0, 3).join(', ')}${info.saved.stale ? ' · expired' : ''}`
        : 'no login'
  return (
    <div className="stack" style={{padding: 'var(--s4) 0'}}>
      <p className="view-sub" style={{margin: 0}}>{t('for what asks you to sign in: age-gated videos, members-only, private posts')}</p>
      <p>
        <span className="label">{t('now using')}</span> <span className="data">{t(using)}</span>
      </p>
      <div className="label">{t("borrow your browser's login")}</div>
      <div className="row-gap">
        {info?.browsers.map(b => (
          <Button key={b.id} kind={config.cookies === 'browser' && config.cookieBrowser === b.id ? 'primary' : 'plain'} hint={b.note ? `${b.label}: ${b.note}` : `use ${b.label}`} onClick={() => void attempt(async () => (await call('login-browser', {id: b.id}), say(`draws will borrow your ${b.label} login`, 'ok')))}>
            {b.label}
          </Button>
        ))}
      </div>
      <p className="meta">{t('pick the browser you are signed in with. yt-dlp asks it each time; Axive keeps nothing.')}</p>
      <div className="label">{t('or paste cookies')}</div>
      <p className="meta">{t('Cookie Editor extension → Export → “Netscape”, then press paste.')}</p>
      <div className="row-gap">
        <Button hint="read a Netscape cookies.txt export from your clipboard" onClick={() => void attempt(async () => {
          const r = await call<{count: number; domains: string[]}>('login-paste')
          say(`saved ${r.count} cookies · ${r.domains.join(', ')}`, 'ok')
          load()
        })}>
          paste cookies
        </Button>
        {info?.active ? <Button kind="quiet" onClick={() => void attempt(async () => (await call('login-forget'), say('Axive no longer uses any login', 'ok'), load()))}>forget login</Button> : null}
      </div>
    </div>
  )
}

function Renewal() {
  const version = useAxive(s => s.version)
  const [busy, setBusy] = useState<string>()
  const [news, setNews] = useState<string>()
  return (
    <div className="stack" style={{padding: 'var(--s4) 0'}}>
      <p className="data">{`Axive ${version}`}</p>
      <div className="row-gap">
        <Button kind="primary" disabled={Boolean(busy)} hint="sites change often; yt-dlp keeps up. checked against its published checksum" onClick={() => void (async () => {
          setBusy('renewing yt-dlp…')
          const r = await attempt(() => call<{line: string}>('renew'))
          setBusy(undefined)
          if (r) say(r.line, 'ok')
        })()}>
          renew yt-dlp
        </Button>
        <Button disabled={Boolean(busy)} onClick={() => void (async () => {
          setBusy('looking for renewal…')
          const r = await attempt(() => call<{ytdlp: {latest: string; current: string} | null; axive: {latest: string} | null}>('check-updates'))
          setBusy(undefined)
          if (r) setNews([r.ytdlp ? `yt-dlp ${r.ytdlp.latest} is out (you have ${r.ytdlp.current})` : 'yt-dlp is current', r.axive ? `Axive ${r.axive.latest} is out` : 'Axive is current'].join(' · '))
        })()}>
          look for renewal
        </Button>
      </div>
      {busy ? <p className="meta">{t(busy)}</p> : news ? <p className="meta">{t(news)}</p> : null}
    </div>
  )
}

type RecipeRow = {name: string; vessel: string; line: string; lines: string[]}
const RECIPE_VESSELS = ['best', '2160', '1440', '1080', '720', '480', 'mp3', 'm4a'] as const
const recipeVessel = (v: string) => (v === 'mp3' || v === 'm4a' ? `audio ${v}` : v === 'best' ? 'best video' : `≤ ${v}p`)
/** "label: value" from describeRecipe: the label is a setting's own name, said in the current words. */
const recipeLine = (line: string) => {
  const at = line.indexOf(': ')
  if (at === -1) return t(line)
  const value = line.slice(at + 2)
  return `${t(line.slice(0, at))}: ${t(value === 'true' ? 'on' : value === 'false' ? 'off' : value)}`
}

/** Recipes: the current settings under a name, shareable as one line (src/core/recipes.ts, as the terminal). */
function Recipes() {
  const [list, setList] = useState<RecipeRow[]>()
  const [name, setName] = useState('')
  const [vessel, setVessel] = useState<(typeof RECIPE_VESSELS)[number]>('1080')
  const [pending, setPending] = useState<{recipe: RecipeRow; replaces: boolean}>()
  useEffect(() => void call<{recipes: RecipeRow[]}>('recipes').then(r => setList(r.recipes), () => setList([])), [])
  const keep = () =>
    void attempt(async () => {
      if (!name.trim()) throw new Error('give the recipe a name')
      const r = await call<{name: string; recipes: RecipeRow[]}>('recipe-save', {name, vessel})
      setList(r.recipes)
      setName('')
      say(`recipe “${r.name}” kept`, 'ok')
    })
  const apply = (n: string) => void attempt(async () => (setList((await call<{recipes: RecipeRow[]}>('recipe-apply', {name: n})).recipes), say(`“${n}” applied to your settings`, 'ok')))
  const paste = () =>
    void attempt(async () => {
      const r = await call<{recipe: RecipeRow; replaces: boolean}>('recipe-decode')
      setPending(r)
    })
  return (
    <div className="stack recipes" style={{padding: 'var(--s4) 0'}}>
      <p className="view-sub" style={{margin: 0}}>{t('a whole setup under one name, shareable as a single line')}</p>
      {pending ? (
        <div className="recipe-confirm surface" role="group" aria-labelledby="recipe-confirm-title">
          <h3 className="section-title" id="recipe-confirm-title">
            {t(`apply “${pending.recipe.name}”?`)}
          </h3>
          <ul className="recipe-lines">
            <li>{t(`vessel: ${recipeVessel(pending.recipe.vessel)}`)}</li>
            {pending.recipe.lines.map(l => (
              <li key={l}>{recipeLine(l)}</li>
            ))}
          </ul>
          {pending.replaces ? <p className="meta">{t('it replaces the recipe kept under the same name')}</p> : null}
          <div className="actions">
            <Button
              kind="primary"
              onClick={() =>
                void attempt(async () => {
                  const r = await call<{name: string; recipes: RecipeRow[]}>('recipe-apply', {line: pending.recipe.line})
                  setList(r.recipes)
                  setPending(undefined)
                  say(`“${r.name}” applied to your settings`, 'ok')
                })
              }
            >
              apply & keep
            </Button>
            <Button kind="quiet" onClick={() => setPending(undefined)}>
              no
            </Button>
          </div>
        </div>
      ) : (
        <>
          <form className="recipe-new" onSubmit={e => (e.preventDefault(), keep())}>
            <label className="field">
              <span className="sr-only">{t('Keep the current settings as')}</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder={t('Keep the current settings as')} maxLength={40} spellCheck={false} autoComplete="off" />
              <Button kind="primary" type="submit" disabled={!name.trim()} hint="e.g. lectures, music, archive">
                keep
              </Button>
            </label>
            <div className="where" style={{marginTop: 'var(--s3)'}}>
              <span className="label">{t('with vessel')}</span>
              <Choice label="with vessel" value={vessel} options={RECIPE_VESSELS} onChange={setVessel} show={recipeVessel} />
            </div>
          </form>
          {list === undefined ? null : list.length ? (
            <ul className="recipe-list">
              {list.map(r => (
                <li key={r.name}>
                  <div className="recipe-head">
                    <span className="name selectable">{r.name}</span>
                    <span className="data">{t(recipeVessel(r.vessel))}</span>
                  </div>
                  <p className="meta">{r.lines.map(recipeLine).join(' · ')}</p>
                  <div className="row-gap">
                    <Button onClick={() => apply(r.name)} hint="its settings become yours now">
                      apply
                    </Button>
                    <Button kind="quiet" icon="copy" onClick={() => void attempt(async () => (await call('copy', {text: r.line}), say('copied: anyone can paste it into their recipes', 'ok')))} hint="the share code: anyone can paste it into their recipes">
                      copy as a line
                    </Button>
                    <Button kind="quiet" icon="trash" onClick={() => void attempt(async () => setList((await call<{recipes: RecipeRow[]}>('recipe-forget', {name: r.name})).recipes))}>
                      forget
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="meta">{t('no recipes yet.')}</p>
          )}
          <div className="row-gap">
            <Button onClick={paste} hint="from a share code on your clipboard">
              paste a recipe
            </Button>
          </div>
          <p className="meta">· {t('recipes never carry programs, webhooks, tokens or folders')}</p>
        </>
      )}
    </div>
  )
}

/** Check every tool against its recorded hash; restore what is missing or altered, from Axive itself (as the terminal's SetupScreen). */
type SweepState = {phase: 'idle' | 'measuring' | 'sweeping' | 'done'; found?: {bytes: number; files: number}; freed?: {bytes: number; files: number; busy: number}}

/** The temporary-file cleaner: what it would free, then the sweep (a day untouched, nothing in use). */
function Sweep() {
  const [state, setState] = useState<SweepState>()
  useEffect(() => void call<SweepState>('sweep-measure').then(setState, () => {}), [])
  const busy = !state || state.phase === 'measuring' || state.phase === 'sweeping'
  const run = () =>
    void attempt(async () => {
      setState(s => ({...s, phase: 'sweeping'}))
      const r = await call<SweepState>('sweep')
      setState(r)
      if (r.freed) say(`${formatBytes(r.freed.bytes) || '0 B'} freed · ${r.freed.files} files${r.freed.busy ? ` · ${r.freed.busy} in use, left alone` : ''}`, 'ok')
    })
  return (
    <div className="stack">
      <p className="meta">{t('Windows keeps temporary files and crash dumps long after the programs that made them are done. Only what nothing has touched for a day goes; a file a program still holds stays.')}</p>
      <div className="row-gap">
        <Button kind="primary" icon="trash" disabled={busy || !state?.found?.files} onClick={run}>
          {state?.phase === 'sweeping' ? 'cleaning…' : 'clean temporary files'}
        </Button>
      </div>
      <p className="data meta" role="status">
        {t(
          !state || state.phase === 'measuring'
            ? 'measuring…'
            : state.phase === 'done' && state.freed
              ? `freed ${formatBytes(state.freed.bytes) || '0 B'} · ${state.freed.files} files${state.freed.busy ? ` · ${state.freed.busy} in use, left alone` : ''}`
              : state.found?.files
                ? `${formatBytes(state.found.bytes)} in ${state.found.files} files can go`
                : 'nothing to clean',
        )}
      </p>
    </div>
  )
}

function Repair() {
  const repair = useAxive(s => s.repair)
  const busy = repair?.state === 'checking' || repair?.state === 'repairing'
  const broken = repair?.health?.filter(h => !h.ok) ?? []
  return (
    <div className="stack repair">
      <div className="row-gap">
        <Button disabled={busy} hint="check every tool against its recorded hash; restore anything damaged" onClick={() => void attempt(() => call('tools-check'))}>
          check & repair the tools
        </Button>
        {repair?.state === 'done' && broken.length && repair.carries ? (
          <Button kind="primary" disabled={busy} hint="restore from Axive itself" onClick={() => void attempt(() => call('tools-repair'))}>
            repair
          </Button>
        ) : null}
      </div>
      {repair?.state === 'checking' ? (
        <>
          <Progress status="preparing" label="checking every tool…" />
          <p className="meta">{t('checking every tool…')}</p>
        </>
      ) : repair?.state === 'repairing' ? (
        <>
          <Progress status="drawing" fraction={(repair.done ?? 0) / Math.max(1, repair.total ?? 1)} label="restoring the tools" />
          <p className="meta">{`${repair.label ?? ''}…`}</p>
        </>
      ) : repair?.state === 'failed' ? (
        <p className="err" role="alert">
          {t(repair.error ?? 'failed')}
        </p>
      ) : null}
      {repair?.health && !busy ? (
        <>
          <p className="data" role="status">
            {t(broken.length ? 'something is amiss' : 'every vessel is whole')}
          </p>
          <ul className="tool-health">
            {repair.health.map(h => (
              <li key={h.name} className={h.ok ? '' : 'err'}>
                <span aria-hidden>{h.ok ? '∴ ' : '✗ '}</span>
                {h.name}
                {h.reason ? `: ${t(h.reason)}` : ''}
              </li>
            ))}
          </ul>
          {!repair.carries ? <p className="meta">{t('this build runs from a folder; repair by reinstalling, or set AXIVE_BIN.')}</p> : null}
        </>
      ) : null}
    </div>
  )
}

