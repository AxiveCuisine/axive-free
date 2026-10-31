import React, {useEffect, useState} from 'react'
import {attempt, call, say, setConfig, t, useAxive} from '../state.js'

const QUALITIES = ['best', '2160', '1440', '1080', '720', '480', 'mp3'] as const
const devModeWhere = (browser: string) => (/edge/i.test(browser) ? 'in the left pane, at the bottom' : 'top right')
import {Button, Select, Toggle} from '../ui.js'

/**
 * Settings › browser: the Axive extension for Chrome, Edge, Brave and Firefox.
 * The door it knocks on (on or off, its port), a one-press setup per browser,
 * the browsers paired so far, and the folders to load.
 */
type Ext = {on: boolean; running: boolean; port: number; error: string | null; paired: {id: string; browser: string; at: number; lastSeen?: number}[]; folder: boolean; firefoxFolder: boolean; firefoxSigned?: boolean; browsers: {id: string; name: string}[]; seen: number | null}

export function ExtensionSettings() {
  const [state, setState] = useState<Ext>()
  const [guide, setGuide] = useState<{browser: string; copied: boolean; firefox: boolean; mode?: string}>()
  const door = useAxive(s => s.door)
  const config = useAxive(s => s.config)
  const load = () => void call<Ext>('extension').then(setState, () => {})
  useEffect(load, [door?.running, door?.paired.length, door?.error])
  // a browser paired while the steps were showing: they are done
  useEffect(() => {
    if (guide && door?.paired.length && state && door.paired.length > state.paired.length) {
      say(`the extension in ${guide.browser} is connected to Axive`, 'ok')
      setGuide(undefined)
    }
  }, [door?.paired.length])
  const toggle = (on: boolean) =>
    void attempt(async () => {
      await call('extension-set', {on})
      say(on ? 'the browser extension can reach Axive again' : 'the browser extension can no longer reach Axive', 'ok')
      load()
    })
  const add = (browser: string) =>
    void attempt(async () => {
      const r = await call<{browser: string; copied: boolean; firefox: boolean; mode: string}>('extension-add', {browser})
      setGuide(r)
      load()
    })
  return (
    <div className="stack" style={{padding: 'var(--s4) 0'}}>
      <div className="label">{t('browser extension')}</div>
      <Toggle label="let the Axive extension hand links to Axive" value={Boolean(state?.on)} disabled={!state} onChange={toggle} hint="on this PC only (127.0.0.1): no web page can reach it, only the extension" />
      <Toggle label="start what the browser sends at once" value={config.browserStart !== false} onChange={v => setConfig({browserStart: v})} hint="a video is drawn, a file starts in the download manager; off: each waits for you to choose" />
      <Select label="video quality from the browser" value={(config.browserQuality ?? '1080') as (typeof QUALITIES)[number]} options={QUALITIES} show={q => t(q === 'best' ? 'best there is' : q === 'mp3' ? 'sound only (mp3)' : `up to ${q}p`)} onChange={v => setConfig({browserQuality: v})} />
      <Toggle label="ask before a browser connects" value={config.browserAsk === true} onChange={v => setConfig({browserAsk: v})} hint="off: the extension connects by itself the moment it is loaded" />
      <p className="meta">
        {t(state?.error ? state.error : state?.running ? `the door is open on port ${state.port}` : state?.on ? 'the door is opening…' : 'the door is closed')}
      </p>
      <div className="row-gap">
        {state?.browsers.map(b => (
          <Button key={b.id} disabled={b.id === 'firefox' ? !state.firefoxFolder && !state.firefoxSigned : !state.folder} hint={b.id === 'firefox' ? (state.firefoxSigned ? 'Firefox asks once whether to add Axive, and keeps it' : 'opens Firefox on its add-on debugging page, with the extension beside it') : `opens ${b.name} on its extensions page, with the folder beside it`} onClick={() => add(b.id)}>
            {`add to ${b.name}`}
          </Button>
        ))}
        <Button kind="quiet" disabled={!state?.folder} hint="Chrome, Edge, Brave: the folder to pick in Load unpacked" onClick={() => void attempt(() => call('extension-open'))}>
          the extension folder
        </Button>
        <Button kind="quiet" disabled={!state?.firefoxFolder} hint="Firefox: pick manifest.json in this folder" onClick={() => void attempt(() => call('extension-open', {firefox: true}))}>
          the Firefox folder
        </Button>
      </div>
      {guide ? (
        guide.firefox && guide.mode === 'signed' ? (
          <ol className="meta steps" aria-live="polite">
            <li>{t('Firefox asks whether to add Axive: press Add.')}</li>
            <li>{t('that is all: it connects by itself and stays after a restart. pin the Axive button to the toolbar to see it.')}</li>
          </ol>
        ) : guide.firefox ? (
          <ol className="meta steps" aria-live="polite">
            <li>{t('in Firefox, on the page that just opened, press Load Temporary Add-on…')}</li>
            <li>{t(`pick manifest.json in the folder that opened in Explorer${guide.copied ? ' (its path is on your clipboard: paste it in the file box)' : ''}.`)}</li>
            <li>{t('that is all: it connects by itself. pin the Axive button to the toolbar to see it.')}</li>
            <li>{t('do not drag the folder or a file into Firefox, and do not use Install Add-on From File: Firefox calls an add-on Mozilla has not signed “corrupt”. Load Temporary Add-on is the way for now.')}</li>
            <li>{t('Firefox forgets a temporary add-on when it closes. Until Axive is in Firefox Add-ons, add it again after a restart.')}</li>
          </ol>
        ) : (
          <ol className="meta steps" aria-live="polite">
            <li>{t(`in ${guide.browser}, on the page that just opened, turn on Developer mode (${devModeWhere(guide.browser)}).`)}</li>
            <li>{t(`drag the Axive extension folder from Explorer onto the page, or press Load unpacked and ${guide.copied ? 'paste the path (it is on your clipboard)' : 'pick that folder'}. Already loaded? Press its reload arrow.`)}</li>
            <li>{t('that is all: it connects by itself. pin the Axive button from the puzzle-piece menu to see it.')}</li>
          </ol>
        )
      ) : state && state.browsers.length === 0 ? (
        <p className="meta">{t('no Chrome, Edge, Brave or Firefox found. in another Chromium browser: its extensions page, Developer mode on, Load unpacked, the extension folder.')}</p>
      ) : null}
      {state?.paired.length ? (
        <div className="stack">
          <div className="label">{t('connected browsers')}</div>
          <ul className="arrivals">
            {state.paired.map(p => (
              <li key={p.id}>
                <span className="t">{`${p.browser} · ${t('since')} ${new Date(p.at).toLocaleDateString([], {dateStyle: 'medium'})}${p.lastSeen ? ` · ${t('last heard')} ${new Date(p.lastSeen).toLocaleString([], {dateStyle: 'short', timeStyle: 'short'})}` : ''}`}</span>
                <Button kind="quiet" hint="its key stops working at once; it connects again the next time it sends something, unless asking is on" onClick={() => void attempt(async () => (await call('door-unpair', {id: p.id}), load()))}>
                  forget
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="meta">{t('then press “draw with Axive” over a video, right-click a link, a video or the page and pick the Axive item, or press the Axive button in the toolbar. Downloads the browser starts are captured too (switch it off in the extension).')}</p>
    </div>
  )
}

/** A browser asks to pair (the extension's first knock): allow or refuse, wherever the window is. */
export function PairingPrompt() {
  const pending = useAxive(s => s.door?.pending)
  if (!pending) return null
  return (
    <div className="offering surface" role="alert">
      <span className="dot" aria-hidden />
      <span className="grow">{t(`the Axive extension in ${pending.browser} asks to send links here. allow it only if you just added it.`)}</span>
      <Button kind="primary" onClick={() => void attempt(async () => (await call('door-answer', {id: pending.id, allow: true}), say('paired: that browser can hand links to Axive', 'ok')))}>
        allow
      </Button>
      <Button kind="quiet" onClick={() => void call('door-answer', {id: pending.id, allow: false})}>
        refuse
      </Button>
    </div>
  )
}
