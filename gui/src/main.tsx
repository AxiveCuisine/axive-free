import React, {useEffect, useMemo, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {TIPS, WHISPERS} from '../../src/core/whispers.js'
import {formatSpeed} from '../../src/core/format.js'
import {FILTERS, inFilter, rowsOf, type Filter} from './model.js'
import {attempt, call, categoriesOf, connect, historyOf, queuesOf, recalled, remember, say, setConfig, t, useAxive} from './state.js'
import {Button, Icon, Keys, LanguagePicker, Scrambled, Sheet, Sigil, Sparkline, Tips, Toggle, Wordmark, type IconName} from './ui.js'
import {DrawSheet, OfferBar, offerDropped, offerPaths, offerText, openFile} from './views/draw.js'
import {DeleteSheet} from './views/discard.js'
import {LedgerView, VigilsView} from './views/keep.js'
import {PhoneView} from './views/phone.js'
import {SpotifyView} from './views/spotify.js'
import {PairingPrompt} from './views/extension.js'
import {QueuesView} from './views/queues.js'
import {SECTIONS, SettingsView, type SectionId} from './views/settings.js'
import {TelegramSheet} from './views/telegram.js'
import {TransfersView, type Scope} from './views/transfers.js'
import {useTick} from './views/vis.js'
import {Deep, useRipples, useTweened} from './alive.js'
import {FREE, PRODUCT} from './edition.js'
import {AxiveView} from './views/axive.js'
import './styles.css'

type View = 'list' | 'queues' | 'ledger' | 'vigils' | 'phone' | 'spotify' | 'settings' | 'axive'
const EVERY_DOOR: Array<{id: View; label: string; key: string; hint: string; icon: IconName}> = [
  {id: 'list', label: 'tunnels', key: '1', hint: 'every draw and every file in flight: pause, reorder, retry', icon: 'menu'},
  {id: 'queues', label: 'queues and schedule', key: '2', hint: 'named queues, their hours, and what happens when one empties', icon: 'clock'},
  {id: 'ledger', label: 'ledger', key: '3', hint: 'everything you have drawn, searchable', icon: 'book'},
  {id: 'vigils', label: 'vigils', key: '4', hint: 'keep watch on channels, draw only what is new', icon: 'eye'},
  {id: 'phone', label: 'phone', key: '5', hint: 'draw from your phone: the code to scan', icon: 'phone'},
  {id: 'spotify', label: 'Spotify library', key: '6', hint: 'your liked songs, playlists and saved albums, as tagged MP3s', icon: 'note'},
  {id: 'settings', label: 'settings', key: ',', hint: 'settings: where, how, and what happens after', icon: 'gear'},
  {id: 'axive', label: 'Axive', key: '7', hint: 'what the full Axive adds to Free, plainly', icon: 'plus'},
]
// Free's core carries the tunnels, the ledger and the settings; one door says what Axive adds
const FREE_DOORS: View[] = ['list', 'ledger', 'settings', 'axive']
const DOORS = EVERY_DOOR.filter(d => (FREE ? FREE_DOORS.includes(d.id) : d.id !== 'axive'))

/** The native window shows Axive's mark until the page says it has painted (native/AxiveWindow.cs). */
function painted(): void {
  requestAnimationFrame(() => requestAnimationFrame(() => (window as unknown as {chrome?: {webview?: {postMessage: (m: string) => void}}}).chrome?.webview?.postMessage('painted')))
}

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** The foot of the window: an offering waiting, else a notice, else the whispers (and tips) turning. */
function Foot() {
  const notice = useAxive(s => s.notice)
  const offerings = useAxive(s => s.offerings)
  const animations = useAxive(s => s.config.animations !== false)
  const order = useMemo(() => {
    const w = shuffled(WHISPERS)
    const tips = shuffled(TIPS)
    return w.flatMap((line, i) => (i % 2 === 1 ? [line, tips[(i >> 1) % tips.length]!] : [line]))
  }, [])
  const [index, setIndex] = useState(0)
  const [shown, setShown] = useState<typeof notice>()
  useEffect(() => {
    if (!animations) return
    const id = setInterval(() => setIndex(i => i + 1), 11_000)
    return () => clearInterval(id)
  }, [animations])
  useEffect(() => {
    if (!notice) return
    setShown(notice)
    if (notice.tone === 'error') return // errors stay until dismissed
    const id = setTimeout(() => setShown(s => (s?.id === notice.id ? undefined : s)), 5200)
    return () => clearTimeout(id)
  }, [notice?.id])

  const latest = offerings.at(-1)
  if (latest) {
    const site = (() => {
      try {
        return new URL(latest.url).hostname.replace(/^www\./, '')
      } catch {
        return 'link'
      }
    })()
    return (
      <div className="offering surface" role="status">
        <span className="dot" aria-hidden />
        <span className="grow">{t(`a ${site} link ${latest.from === 'ghost' ? 'surfaced on your clipboard' : latest.from === 'browser' ? 'came from the browser' : 'was offered remotely'}. draw it?`)}</span>
        <Button kind="primary" onClick={() => void attempt(() => call('offering', {url: latest.url, op: 'draw'}))}>
          draw ≤1080p
        </Button>
        <Button hint="look at it first: pick the vessel" onClick={() => (void call('offering', {url: latest.url, op: 'dismiss'}), window.dispatchEvent(new CustomEvent('axive-offer', {detail: latest.url})))}>
          choose
        </Button>
        <Button kind="quiet" onClick={() => void call('offering', {url: latest.url, op: 'dismiss'})}>
          ignore
        </Button>
      </div>
    )
  }
  if (shown) {
    const mark = shown.tone === 'ok' ? '∴' : shown.tone === 'error' ? '✗' : shown.tone === 'warn' ? '!' : '·'
    return (
      <div className={`notice ${shown.tone}`} role={shown.tone === 'error' ? 'alert' : 'status'}>
        <span aria-hidden>{mark}</span>
        <Scrambled text={t(shown.text)} ms={450} />
        <Button icon="close" label="dismiss" kind="quiet" onClick={() => setShown(undefined)} />
      </div>
    )
  }
  return (
    <div className="whisper" aria-hidden>
      <Scrambled key={index} text={t(order[index % order.length]!)} ms={1600} />
    </div>
  )
}

const KEYMAP: Array<[string, string]> = [
  ['ctrl+N', 'a new draw'],
  ['ctrl+V', 'outside a box: offer what you copied'],
  ['ctrl+L', 'the offer field, from anywhere'],
  ['ctrl+O', 'open the chosen file (none chosen: a file you have)'],
  ['ctrl+F', 'its folder'],
  ['ctrl+P', 'pause the chosen'],
  ['ctrl+R', 'resume or retry the chosen'],
  ['ctrl+I', 'details of the chosen'],
  ['Del', 'cancel or clear the chosen'],
  ['ctrl+A', 'choose every row'],
  ['esc', 'clear the choice, or close'],
  ['↑ ↓ space ↵', 'move, mark, open, in the list'],
  FREE ? ['ctrl+1 · 3 · 7', 'tunnels · ledger · Axive'] : ['ctrl+1 … 6', 'tunnels · queues · ledger · vigils · phone · Spotify library'],
  ['ctrl+,', 'settings'],
  ['?  or  F1', 'this sheet'],
]

function Guide({onClose, onGo}: {onClose: () => void; onGo: (v: View) => void}) {
  const plainWords = useAxive(s => Boolean(s.config.plainWords))
  const language = useAxive(s => String(s.config.language ?? 'en'))
  return (
    <Sheet title="keys" sub="every key, and every door" onClose={onClose} labelId="guide-title">
      <div className="guide-cols">
        <div>
          <div className="label ruled">{t('everywhere')}</div>
          <dl className="keys">
            {KEYMAP.map(([k, d]) => (
              <React.Fragment key={k}>
                <dt>
                  <Keys k={k} />
                </dt>
                <dd>{t(d)}</dd>
              </React.Fragment>
            ))}
            <dt>
              <kbd>{t('drop')}</kbd>
            </dt>
            <dd>{t(FREE ? 'a link anywhere on the window' : 'a link, a .torrent or a media file anywhere on the window')}</dd>
          </dl>
        </div>
        <div>
          <div className="label ruled">{t('every door')}</div>
          <dl className="keys">
            {DOORS.map(d => (
              <React.Fragment key={d.id}>
                <dt>
                  <button type="button" className="link" onClick={() => (onGo(d.id), onClose())}>
                    {t(d.label)}
                  </button>
                </dt>
                <dd>{t(d.hint)}</dd>
              </React.Fragment>
            ))}
            {FREE ? null : (
              <>
                <dt className="meta">{t('on a video')}</dt>
                <dd>{t('after you offer a video: trim, thumbnail, inspect, chapters')}</dd>
              </>
            )}
            <dt className="meta">{t('in the shell')}</dt>
            <dd>{t('also from PowerShell: axive --help')}</dd>
          </dl>
          <div className="label ruled">{t('words')}</div>
          <Toggle label="simple language" value={plainWords} onChange={v => setConfig({plainWords: v})} hint="everyday words instead of the house's own: draw, vessel, ledger…" />
          {FREE ? null : <LanguagePicker value={language} onChange={v => setConfig({language: v})} />}
        </div>
      </div>
    </Sheet>
  )
}

function Threshold() {
  const licence = useAxive(s => s.licence)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>(licence.reason === 'renew' ? 'your licence is renewed by the house every few days, and it could not be reached. connect to the internet and Axive opens again' : '')
  const bind = async () => {
    if (!key.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await call('licence', {key})
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="threshold">
      <span className="ticks" aria-hidden />
      <h1 className="sr-only">Axive</h1>
      <Wordmark size="grand" />
      <p className="view-sub surface">{t('this copy is not yet bound to anyone')}</p>
      <form className="offer surface" onSubmit={e => (e.preventDefault(), void bind())}>
        <label className="field big">
          <span className="sr-only">{t('Offer your key')}</span>
          <input autoFocus value={key} onChange={e => setKey(e.target.value)} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" spellCheck={false} autoComplete="off" />
          <Button kind="primary" type="submit" disabled={busy} hint="bind this key to this PC (↵)">
            {busy ? '…' : 'bind'}
          </Button>
        </label>
        <p className={error ? 'err' : 'meta'} role={error ? 'alert' : undefined}>
          {busy ? t('asking the house…') : error ? t(error) : t('the key was shown on the page after you paid')}
        </p>
      </form>
      <Button hint="opens axive.xyz in your browser: once, for life, crypto welcome" onClick={() => void call('open-url', {url: 'https://axive.xyz/buy/'})}>
        obtain a key · $7.99
      </Button>
      <p className="meta">{t('only the key and an anonymous id of this PC are sent, nothing else')}</p>
    </main>
  )
}

/**
 * The surfacing: while the core is not yet answering. Nothing for 150 ms (a
 * fast start never flashes), then the wordmark, a glint line, a caption, a
 * slower caption after 8 s. Only the in-app "animations" setting stills it.
 */
function Surfacing({leaving}: {leaving: boolean}) {
  const animations = useAxive(s => s.config.animations !== false)
  const [phase, setPhase] = useState(animations ? 0 : 3)
  useEffect(() => {
    const timers = [setTimeout(() => setPhase(p => Math.max(p, 1)), animations ? 150 : 0), setTimeout(() => setPhase(p => Math.max(p, 2)), animations ? 700 : 0), setTimeout(() => setPhase(p => Math.max(p, 3)), animations ? 1200 : 0), setTimeout(() => setPhase(4), 8000)]
    return () => timers.forEach(clearTimeout)
  }, [animations])
  const caption = phase >= 4 ? 'the core is slow to answer · it is still coming' : 'rising from the deep'
  return (
    <main className={`surfacing ${animations ? 'animate' : 'still'} ${leaving ? 'sinking' : ''}`}>
      <h1 className="sr-only">Axive</h1>
      <div className="sr-only" role="status" aria-busy={!leaving}>
        {t(caption)}
      </div>
      <div className={`surfacing-mark ${phase >= 1 ? 'shown' : ''}`} aria-hidden>
        <Wordmark size="grand" />
      </div>
      <div className={`surfacing-line ${phase >= 2 ? 'shown' : ''}`} aria-hidden>
        <i />
      </div>
      <p className={`surfacing-caption ${phase >= 3 ? 'shown' : ''}`} aria-hidden key={caption}>
        {phase >= 3 ? t(caption) : ''}
      </p>
    </main>
  )
}

/** First launch: the tools unpack while the window is already up, shown here, in the page. */
function Setup() {
  const setup = useAxive(s => s.setup)
  if (!setup) return null
  const fraction = 'error' in setup ? 0 : setup.done / Math.max(1, setup.total)
  return (
    <main className="threshold setup">
      <span className="ticks" aria-hidden />
      <Wordmark size="grand" />
      {'error' in setup ? (
        <>
          <p className="err" role="alert">
            {t(setup.error)}
          </p>
          <p className="view-sub">{t('an antivirus sometimes holds a new file for a moment; it has usually let go by now')}</p>
          <Button kind="primary" onClick={() => void attempt(() => call('setup-retry'))}>
            {t('try again')}
          </Button>
        </>
      ) : (
        <>
          <h1 className="view-title surface">{t('preparing the vessels')}</h1>
          <p className="view-sub">{t('Axive carries its own tools; unpacking them once')}</p>
          <div className="setup-bar">
            <div className="progress drawing" role="progressbar" aria-label={t('preparing the vessels')} aria-valuenow={Math.round(fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
              <i style={{width: `${fraction * 100}%`}} />
            </div>
            <p className="data meta">{setup.label === 'done' ? t('ready') : `${t(setup.label)} · ${Math.min(setup.done + 1, setup.total)} ${t('of')} ${setup.total}`}</p>
          </div>
        </>
      )}
    </main>
  )
}

/** C3: sleep, hibernate, shut down or quit after a tunnel emptied, with ten seconds to say no. */
function PowerBanner() {
  const power = useAxive(s => s.power)
  useTick(250)
  if (!power) return null
  const left = Math.max(0, Math.ceil((power.at - Date.now()) / 1000))
  const word: Record<string, string> = {quit: 'Axive closes', sleep: 'the PC sleeps', hibernate: 'the PC hibernates', shutdown: 'the PC shuts down'}
  return (
    <div className="power surface" role="alert">
      <span className="power-count data" aria-hidden>
        {left}
      </span>
      <span className="grow">{t(`${word[power.action] ?? power.action} in ${left} s: the tunnel emptied`)}</span>
      <Button kind="primary" onClick={() => void attempt(async () => (await call('power-cancel'), say('stopped: nothing happens', 'ok')))}>
        stop it
      </Button>
    </div>
  )
}

function Rail({view, setView, scope, setScope, onNew, onGuide, section}: {view: View; setView: (v: View) => void; scope: Scope; setScope: (s: Scope) => void; onNew: () => void; onGuide: () => void; section: SectionId}) {
  const all = useAxive(s => s)
  const rows = useMemo(() => rowsOf(all), [all.jobs, all.fetch, all.tasks, all.ledger, all.list, all.config.categories])
  const queues = useAxive(queuesOf)
  const cats = useAxive(categoriesOf)
  const plainWords = useAxive(s => Boolean(s.config.plainWords))
  const profile = useAxive(s => String(s.limits?.profile ?? s.config.speedProfile ?? 'full'))
  const version = useAxive(s => s.version)
  const ghostOn = useAxive(s => Boolean(s.ghost.on))
  const ghostAvailable = useAxive(s => s.ghost.available !== false)
  const connected = useAxive(s => (s.door?.paired.length ?? 0) > 0)
  // categories fold away; the choice is remembered by the core (the page's own storage forgets at every start)
  const catsOpen = useAxive(s => s.ui?.railCategories === true)
  const foldCats = () => remember({railCategories: !catsOpen})
  const toSettings = (section: SectionId) => window.dispatchEvent(new CustomEvent('axive-go', {detail: {view: 'settings', section}}))
  useTick()
  const speed = rows.reduce((s, r) => s + r.speed, 0)
  const gliding = useTweened(speed, 600)
  const history = historyOf('total')
  const count = (f: Filter) => rows.filter(r => inFilter(r, f)).length
  const listScope = (s: Scope) => (setScope(s), setView('list'))
  const isScope = (s: Partial<Scope>) => view === 'list' && scope.status === (s.status ?? 'all') && scope.category === s.category && scope.queue === s.queue
  const slow = profile === 'slow'
  return (
    <nav className="rail" aria-label="Axive">
      <div className="rail-mark">
        <Wordmark />
        <Sigil />
      </div>
      <Button kind="primary" icon="plus" className="new-draw" onClick={onNew} keys="Control+N" hint={FREE ? 'a link to a video, a song or any file' : 'a link, a playlist, a file, a magnet, or words to search'}>
        new draw
      </Button>
      <div className="rail-scroll">
        <div className="rail-group" role="group" aria-labelledby="rail-status">
          <h2 className="rail-title" id="rail-status">
            {t('tunnels')}
          </h2>
          {FILTERS.map(f => {
            const n = count(f.id)
            return (
              <button key={f.id} type="button" className={`door ${f.id}${f.id === 'active' && n ? ' busy' : ''}`} aria-current={isScope({status: f.id}) ? 'page' : undefined} onClick={() => listScope({status: f.id})} data-tip={t(f.hint)}>
                <span className={`door-mark ${f.id}`} aria-hidden />
                <span className="grow">{t(f.label)}</span>
                {n ? <span className={`count ${f.id === 'active' && n ? 'live' : ''}`}>{n}</span> : null}
              </button>
            )
          })}
        </div>
        {cats.length ? (
          <div className="rail-group" role="group" aria-labelledby="rail-cats">
            <h2 className="rail-title" id="rail-cats">
              <button type="button" className={`rail-fold ${catsOpen || scope.category ? 'open' : ''}`} aria-expanded={catsOpen || Boolean(scope.category)} aria-controls="rail-cats-list" onClick={foldCats}>
                <span>{t('categories')}</span>
                <Icon name="down" />
              </button>
            </h2>
            <div id="rail-cats-list" hidden={!(catsOpen || scope.category)}>
            {cats.map(c => {
              const n = rows.filter(r => r.category === c.id).length
              return (
                <button key={c.id} type="button" className={`door ${n ? '' : 'empty'}`} aria-current={isScope({category: c.id}) ? 'page' : undefined} onClick={() => listScope({status: 'all', category: c.id})}>
                  <span className="grow">{t(c.name)}</span>
                  {n ? <span className="count">{n}</span> : null}
                </button>
              )
            })}
            </div>
          </div>
        ) : null}
        {FREE ? null : (
        <div className="rail-group" role="group" aria-labelledby="rail-queues">
          <h2 className="rail-title" id="rail-queues">
            {t('queues')}
            <button type="button" className="rail-more" onClick={() => setView('queues')} aria-label={t('queues and schedule')} data-tip={t('manage the queues and their schedules (ctrl+2)')}>
              <Icon name="gear" />
            </button>
          </h2>
          {queues.map(q => {
            const n = rows.filter(r => r.queueId === q.id && r.status !== 'received').length
            return (
              <button key={q.id} type="button" className="door" aria-current={isScope({queue: q.id}) ? 'page' : undefined} onClick={() => listScope({status: 'all', queue: q.id})} data-tip={t(q.open === false ? 'closed by its schedule' : `${q.maxConcurrent} side by side`)}>
                <span className={`q-dot ${q.open === false ? '' : 'on'}`} aria-hidden />
                <span className="grow">{q.name}</span>
                {n ? <span className="count">{n}</span> : null}
              </button>
            )
          })}
        </div>
        )}
        <div className="rail-group" role="group" aria-labelledby="rail-doors">
          <h2 className="rail-title" id="rail-doors">
            {t('the house')}
          </h2>
          {FREE ? null : (
          <>
          <button type="button" className="door" aria-current={view === 'settings' && section === 'browser' ? 'page' : undefined} onClick={() => toSettings('browser')} data-tip={t(connected ? 'the browser extension: connected. its settings' : 'add Axive to your browser: draw with one press on any video')}>
            <Icon name="puzzle" />
            <span className="grow">{t('browser extension')}</span>
          </button>
          <button type="button" className="door" aria-current={view === 'settings' && section === 'tools' ? 'page' : undefined} onClick={() => toSettings('tools')} data-tip={t('clear the temporary files Windows leaves behind (only what is a day old)')}>
            <Icon name="trash" />
            <span className="grow">{t('temporary files')}</span>
          </button>
          </>
          )}
          {DOORS.filter(d => d.id !== 'list' && d.id !== 'queues').map(d => (
            <button key={d.id} type="button" className="door" aria-current={view === d.id && !(d.id === 'settings' && (section === 'browser' || section === 'tools')) ? 'page' : undefined} onClick={() => setView(d.id)} data-tip={`${t(d.hint)} (ctrl+${d.key})`}>
              <Icon name={d.icon} />
              <span className="grow">{t(d.label)}</span>
              {d.id === 'phone' && all.phone.on ? <span className="count live">{t('on')}</span> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="rail-foot">
        {FREE ? null : <Toggle label="ghost" className="caps" value={ghostOn} disabled={!ghostAvailable} onChange={on => void attempt(() => call('ghost', {on}))} hint={ghostAvailable ? 'watch the clipboard: a link you copy anywhere is offered at once, without opening Axive' : "watching the clipboard needs Axive's helper: repair the tools in settings"} />}
        <div className="speed-block" aria-label={`${t('download speed')}: ${speed ? formatSpeed(speed) : t('idle')}`} role="group">
          <div className="speed-line">
            <span className="label">{t('download speed')}</span>
            <span className={`data speed ${speed ? 'live' : ''}`}>{speed ? `↓ ${formatSpeed(gliding)}` : t('idle')}</span>
          </div>
          <Sparkline values={history} label="download speed over the last minute" width={196} height={26} />
        </div>
        {FREE ? null : <Toggle label="slow mode" value={slow} onChange={on => void attempt(() => call('speed-profile', {profile: on ? 'slow' : 'full'}).catch(() => call('config', {patch: {speedProfile: on ? 'slow' : 'full'}})))} hint="one click: every download keeps to the slow limit, for calls and streams" />}
        <Toggle label="simple language" value={plainWords} onChange={v => setConfig({plainWords: v})} hint="everyday words instead of the house's own: draw, vessel, ledger…" />
        <div className="rail-end">
          <button type="button" className="link meta" onClick={onGuide} data-tip={t('every key, and every door (?)')}>
            {t('? keys')}
          </button>
          <span className="meta">{`${PRODUCT} ${version}`}</span>
        </div>
      </div>
    </nav>
  )
}

const send = (op: string) => window.dispatchEvent(new CustomEvent('axive-list', {detail: op}))

function App() {
  useRipples()
  const connected = useAxive(s => s.connected)
  const licensed = useAxive(s => s.licence.state === 'licensed')
  const setup = useAxive(s => s.setup)
  const animations = useAxive(s => s.config.animations !== false)
  const [view, setView] = useState<View>('list')
  const [scope, setScope] = useState<Scope>({status: 'all'})
  const [section, setSection] = useState<SectionId>('general')
  const [search, setSearch] = useState('')
  const [guide, setGuide] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [telegram, setTelegram] = useState<{file?: string}>()
  const main = useRef<HTMLElement>(null)
  const born = useRef(performance.now())
  // the window opens the way it was left: its page, the settings section, the list's filter
  const restored = useRef(false)
  useEffect(() => {
    if (!connected || restored.current) return
    restored.current = true
    const v = recalled('view', 'list')
    if (DOORS.some(d => d.id === v)) setView(v as View)
    const sec = recalled('section', 'general')
    if (SECTIONS.some(s => s.id === sec)) setSection(sec as SectionId)
    const status = recalled('scopeStatus', 'all')
    const category = recalled('scopeCategory', '')
    const queue = recalled('scopeQueue', '')
    setScope({status: FILTERS.some(f => f.id === status) ? (status as Filter) : 'all', ...(category ? {category} : {}), ...(queue ? {queue} : {})})
  }, [connected])
  useEffect(() => {
    if (restored.current) remember({view, section, scopeStatus: scope.status, scopeCategory: scope.category ?? '', scopeQueue: scope.queue ?? ''})
  }, [view, section, scope])
  const [surfacing, setSurfacing] = useState(true)
  const [risen, setRisen] = useState(false)
  useEffect(() => {
    if (!connected) return setSurfacing(true)
    if (performance.now() - born.current < 150) return setSurfacing(false)
    const id = setTimeout(() => (setSurfacing(false), setRisen(true)), 280)
    born.current = -Infinity
    return () => clearTimeout(id)
  }, [connected])

  useEffect(() => {
    document.documentElement.lang = 'en'
    document.title = PRODUCT
    painted()
  }, [])
  useEffect(() => main.current?.focus({preventScroll: true}), [view])

  // the one add funnel: everything offered opens the draw sheet with it (D1)
  useEffect(() => {
    const offer = (e: Event) => {
      setDrawing(true)
      const text = (e as CustomEvent<string>).detail
      setTimeout(() => void offerText(text), 0)
    }
    const convert = (e: Event) => {
      setDrawing(true)
      const file = (e as CustomEvent<string>).detail
      setTimeout(() => void offerPaths([file]), 0)
    }
    const go = (e: Event) => {
      const d = (e as CustomEvent<{view: View; section?: SectionId}>).detail
      setDrawing(false)
      setView(d.view)
      if (d.section) setSection(d.section)
    }
    const fileDoor = () => (setDrawing(true), setTimeout(() => void openFile(), 0))
    const telegramDoor = (e: Event) => setTelegram((e as CustomEvent<{file?: string}>).detail ?? {})
    const pasteDoor = () =>
      void call<{link: string | null}>('clipboard').then(r => (r.link ? window.dispatchEvent(new CustomEvent('axive-offer', {detail: r.link})) : (setDrawing(true), say('the clipboard holds no link', 'info'))), () => setDrawing(true))
    window.addEventListener('axive-offer', offer)
    window.addEventListener('axive-convert', convert)
    window.addEventListener('axive-go', go)
    window.addEventListener('axive-open-file', fileDoor)
    window.addEventListener('axive-paste', pasteDoor)
    window.addEventListener('axive-telegram', telegramDoor)
    return () => {
      window.removeEventListener('axive-telegram', telegramDoor)
      window.removeEventListener('axive-offer', offer)
      window.removeEventListener('axive-convert', convert)
      window.removeEventListener('axive-go', go)
      window.removeEventListener('axive-open-file', fileDoor)
      window.removeEventListener('axive-paste', pasteDoor)
    }
  }, [])
  // the ghost card's "choose" sends a link here
  const navigate = useAxive(s => s.navigate)
  useEffect(() => {
    if (navigate?.offer) window.dispatchEvent(new CustomEvent('axive-offer', {detail: navigate.offer}))
  }, [navigate?.at])

  // the keyboard map (H2)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const inField = Boolean(el.closest?.('input, textarea, select'))
      const sheet = Boolean(document.querySelector('.veil'))
      const k = e.key.toLowerCase()
      if ((e.key === '?' && !inField) || e.key === 'F1') return (e.preventDefault(), setGuide(g => !g))
      if (sheet) return
      const ctrl = e.ctrlKey && !e.altKey && !e.shiftKey
      if (ctrl && k === 'n') return (e.preventDefault(), setDrawing(true))
      if (ctrl && k === 'l') return (e.preventDefault(), window.dispatchEvent(new CustomEvent('axive-focus-offer')))
      if (ctrl && k === ',') return (e.preventDefault(), setView('settings'))
      if (ctrl && k === 'o') {
        e.preventDefault()
        const chosen = document.querySelector('.grid tr.selected')
        if (view === 'list' && chosen && chosen.classList.contains('received')) return send('open-file')
        return window.dispatchEvent(new CustomEvent('axive-open-file'))
      }
      const door = ctrl ? DOORS.find(d => d.key === e.key) : undefined
      if (door) return (e.preventDefault(), setView(door.id))
      if (view !== 'list' || inField) return
      if (ctrl && k === 'f') return (e.preventDefault(), send('open-folder'))
      if (ctrl && k === 'p') return (e.preventDefault(), send('pause'))
      if (ctrl && k === 'r') return (e.preventDefault(), send('resume'))
      if (ctrl && k === 'i') return (e.preventDefault(), send('details'))
      if (ctrl && k === 'a') return (e.preventDefault(), send('select-all'))
      if (e.key === 'Delete') return (e.preventDefault(), send('delete'))
      if (e.key === 'Escape') return send('clear')
    }
    // ctrl+v with no box in focus: offer what was copied (D6)
    const paste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, textarea') || document.querySelector('.veil')) return
      const text = e.clipboardData?.getData('text') ?? ''
      if (!text.trim()) return
      window.dispatchEvent(new CustomEvent('axive-offer', {detail: text}))
    }
    window.addEventListener('keydown', key)
    window.addEventListener('paste', paste)
    return () => (window.removeEventListener('keydown', key), window.removeEventListener('paste', paste))
  }, [view])

  // D5: a link, a .torrent or a media file anywhere on the window
  useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent) => (e.preventDefault(), depth++, setDropping(true))
    const over = (e: DragEvent) => e.preventDefault()
    const leave = () => (depth = Math.max(0, depth - 1)) === 0 && setDropping(false)
    const drop = (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setDropping(false)
      if (!e.dataTransfer) return
      const files = [...e.dataTransfer.files]
      const webview = (window as unknown as {chrome?: {webview?: {postMessageWithAdditionalObjects?: (m: unknown, o: unknown) => void}}}).chrome?.webview
      if (files.length && webview?.postMessageWithAdditionalObjects) {
        // the page cannot read a dropped file's path; the window can
        webview.postMessageWithAdditionalObjects('dropped', e.dataTransfer.files)
        setDrawing(true)
        return
      }
      if (files.length) return say('drop a link here; to convert a file, open Axive in its own window', 'warn')
      setDrawing(true)
      const data = e.dataTransfer
      setTimeout(() => void offerDropped(data), 0)
    }
    const fromWindow = (e: MessageEvent) => {
      const paths = (e.data as {dropped?: string[]})?.dropped
      if (paths?.length) (setDrawing(true), setTimeout(() => void offerPaths(paths), 0))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    const webview = (window as unknown as {chrome?: {webview?: EventTarget}}).chrome?.webview
    webview?.addEventListener('message', fromWindow as EventListener)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      webview?.removeEventListener('message', fromWindow as EventListener)
    }
  }, [])

  if (!connected || surfacing) return <Surfacing leaving={connected} />
  if (setup) return <Setup />
  if (!licensed) return <Threshold />

  const label = DOORS.find(d => d.id === view)!.label
  return (
    <div className={`app ${animations ? 'animate' : 'still'} ${risen ? 'risen' : ''}`}>
      <Rail view={view} setView={v => (setView(v), setSearch(''))} scope={scope} setScope={setScope} onNew={() => setDrawing(true)} onGuide={() => setGuide(true)} section={section} />
      <div className="stage">
        <header className="topbar">
          <OfferBar onOpen={() => setDrawing(true)} />
          {view === 'list' ? (
            <label className="field search">
              <span className="sr-only">{t('find in the list')}</span>
              <Icon name="search" />
              <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('find in the list')} spellCheck={false} />
            </label>
          ) : null}
          <Button kind="quiet" icon="why" label="every key, and every door" hint="?" onClick={() => setGuide(true)} />
        </header>
        <PowerBanner />
        <PairingPrompt />
        <main className="main" ref={main} tabIndex={-1} aria-label={t(label)}>
          {view === 'list' ? <TransfersView scope={scope} search={search} onNew={() => setDrawing(true)} onScope={setScope} /> : null}
          {view === 'queues' ? <QueuesView /> : null}
          {view === 'ledger' ? <LedgerView onOffer={url => window.dispatchEvent(new CustomEvent('axive-offer', {detail: url}))} /> : null}
          {view === 'vigils' ? <VigilsView /> : null}
          {view === 'phone' ? <PhoneView /> : null}
          {view === 'spotify' ? <SpotifyView onTunnels={() => setView('list')} /> : null}
          {view === 'settings' ? <SettingsView section={section} onSection={setSection} /> : null}
          {view === 'axive' ? <AxiveView /> : null}
        </main>
        <footer className="foot" aria-live="polite">
          <Foot />
        </footer>
      </div>
      {dropping ? (
        <div className="drop-veil" aria-hidden>
          <div className="drop-plate">
            <span className="ticks" />
            <p className="view-title">{t('let it fall')}</p>
            <p className="meta">{t(FREE ? 'a link' : 'a link, a .torrent, a media file or a disc folder')}</p>
          </div>
        </div>
      ) : null}
      <DrawSheet open={drawing} onClose={() => setDrawing(false)} onDrawn={() => (setDrawing(false), setView('list'))} />
      {guide ? <Guide onClose={() => setGuide(false)} onGo={setView} /> : null}
      {telegram ? <TelegramSheet file={telegram.file} onClose={() => setTelegram(undefined)} /> : null}
      <DeleteSheet />
      <Tips />
    </div>
  )
}

connect()
createRoot(document.getElementById('root')!).render(
  <>
    <Deep />
    <App />
  </>,
)
