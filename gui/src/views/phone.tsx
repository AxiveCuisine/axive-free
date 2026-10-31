import React, {useEffect, useState} from 'react'
import {attempt, call, say, setConfig, t, useAxive} from '../state.js'
import {Button, Scrambled, Title, Toggle} from '../ui.js'

type Asked = {ok: boolean; why?: 'declined' | 'failed' | 'policy' | 'shield' | 'blocked-other'; unverified?: boolean}

/** What asking Windows came to, in a sentence: a rule is not a phone getting through, so none of these says it did. */
function sayAsked(r: Asked | undefined) {
  if (!r) return
  if (r.ok && r.unverified) return say('the rule is made, but Windows did not say whether it applies here. scan the code to try from your phone', 'warn')
  if (r.ok) return say('Windows Firewall now has a rule for phones on this network. scan the code: the last line shows when your phone gets through', 'ok')
  if (r.why === 'declined') return say('the Windows prompt was declined, so nothing changed. press "set up Windows Firewall" to be asked again', 'warn')
  if (r.why === 'policy') return say('this PC follows a policy that decides its firewall: ask whoever manages it', 'warn')
  if (r.why === 'shield') return say('Windows Firewall blocks all incoming connections on this network. Axive leaves that setting to you', 'warn')
  if (r.why === 'blocked-other') return say('a firewall rule that Axive did not make still blocks the phone port. Axive leaves it alone', 'warn')
  say('Windows did not make the rule. try again, or open "Windows Defender Firewall" and allow Axive there', 'warn')
}

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return `${Math.round(s / 3600)} h ago`
}

/**
 * The phone (G): one click from the rail. The QR is there at once, the link
 * opens in the default browser, "show bigger" opens the pair page, the
 * switches, and the connection: what this PC can check (the address answers,
 * the firewall rule) kept apart from the one real proof (a device on the
 * network reached Axive). The firewall button asks Windows (a UAC prompt),
 * so it happens only on the owner's click.
 */
export function PhoneView() {
  const phone = useAxive(s => s.phone)
  const remoteDraw = useAxive(s => s.config.remoteDraw !== false)
  const remoteFiles = useAxive(s => s.config.remoteFiles !== false)
  const [asking, setAsking] = useState(false)
  const [, tick] = useState(0)
  const on = phone.on
  // "2 min ago" keeps up; the check runs once when the view opens (it asks Windows nothing)
  useEffect(() => {
    if (on) void attempt(() => call('phone-check'))
    const id = setInterval(() => tick(n => n + 1), 30_000)
    return () => clearInterval(id)
  }, [on])

  const setUp = async () => {
    setAsking(true)
    const r = await attempt(() => call<Asked>('phone-firewall'))
    setAsking(false)
    sayAsked(r)
  }
  const host = phone.lanUrl?.replace(/^http:\/\/([^/]+)\/.*/, '$1')
  const firewallLine =
    phone.firewall === 'open'
      ? phone.firewallOff
        ? 'Windows Firewall is off on this network'
        : 'a Windows Firewall rule lets devices on this network reach Axive’s phone port'
      : phone.firewall === 'closed'
        ? phone.firewallWhy === 'blocked'
          ? 'Windows Firewall holds a block rule for Axive'
          : phone.firewallWhy === 'blocked-other'
            ? 'a Windows Firewall rule Axive did not make blocks the phone port'
            : phone.firewallWhy === 'other-port'
              ? 'Windows Firewall has an Axive rule for another port'
              : phone.firewallWhy === 'disabled'
                ? 'Axive’s firewall rule is turned off'
                : phone.firewallWhy === 'scope'
                  ? 'Axive’s firewall rule does not cover this network'
                  : phone.firewallWhy === 'shield'
                    ? 'Windows Firewall blocks all incoming connections here'
                    : phone.firewallWhy === 'policy'
                      ? 'a policy decides this PC’s firewall'
                      : 'Windows Firewall has no rule for Axive yet'
        : phone.checking
          ? 'asking Windows…'
          : phone.firewallWhy === 'maybe'
            ? 'Windows Firewall rules may or may not let your phone in'
            : 'Windows did not say how its firewall treats Axive'
  const asksNothing = phone.firewallWhy === 'policy' || phone.firewallWhy === 'shield' || phone.firewallWhy === 'blocked-other'

  return (
    <div className="view phone-view">
      <Title sub="draw from your phone: scan, then share any link to the page that opens">phone</Title>
      <div className="phone-grid">
        <section className={`qr-plate ${on ? 'on' : ''}`} aria-label={t('the code to scan')}>
          <span className="ticks" aria-hidden />
          {on && phone.svg ? (
            <div className="qr" role="img" aria-label={t('a QR code: scan it with your phone camera')} dangerouslySetInnerHTML={{__html: phone.svg.replace(/role="img" aria-label="QR code"/, 'aria-hidden="true"')}} />
          ) : (
            <div className="qr-off">
              <span className="seal-big" aria-hidden />
              <p className="meta">{phone.starting ? <Scrambled text={t('opening to your Wi-Fi…')} /> : t('the phone is off: turn it on and the code appears here')}</p>
            </div>
          )}
          {on && phone.lanUrl ? (
            <a
              className="phone-link data"
              href={phone.lanUrl}
              onClick={e => (e.preventDefault(), void attempt(() => call('phone-open-link')))}
              data-tip={t('open it in your browser on this PC, to see what the phone sees')}
            >
              {phone.lanUrl.replace(/\?t=.*/, '?t=…')}
            </a>
          ) : null}
        </section>

        <section className="phone-controls" aria-label={t('phone')}>
          <div className="setting-row big">
            <div>
              <div className="name">{t('phone')}</div>
              <div className="help">{t('opens the remote to this Wi-Fi only; every request carries a secret token')}</div>
            </div>
            <Toggle
              label={on ? 'on' : 'off'}
              value={on}
              disabled={phone.starting || asking}
              onChange={v =>
                void (async () => {
                  if (!v) return void attempt(() => call('phone-close'))
                  setAsking(true)
                  // Windows may ask (an administrator prompt) to let phones through its firewall
                  const r = await attempt(() => call<{firewall?: string; asked?: Asked}>('phone-open', {firewall: true}))
                  setAsking(false)
                  if (r?.asked) sayAsked(r.asked)
                  else if (r?.firewall === 'open') say('the firewall looks open for phones on this network: scan the code to try', 'ok')
                })()
              }
              hint="turn the phone page on or off; Windows may ask once to let phones through its firewall"
            />
          </div>

          {on ? (
            <div className="connection" aria-label={t('connection')} aria-live="polite">
              <div className="label">{t('connection')}</div>
              <ul className="checks">
                <li className={phone.answers ? 'yes' : phone.answers === false ? 'no' : ''}>
                  <span className="mark" aria-hidden>{phone.answers ? '∴' : phone.answers === false ? '✕' : '·'}</span>
                  <span>
                    {phone.answers === false ? t('Axive does not answer at its network address') : t(`Axive answers at ${host ?? 'its network address'}`)}
                    <span className="meta"> · {t('checked from this PC')}</span>
                  </span>
                </li>
                <li className={phone.firewall === 'open' ? 'yes' : phone.firewall === 'closed' ? 'no' : ''}>
                  <span className="mark" aria-hidden>{phone.firewall === 'open' ? '∴' : phone.firewall === 'closed' ? '✕' : '·'}</span>
                  <span>
                    {t(firewallLine)}
                    {phone.network?.category ? <span className="meta"> · {t(`${phone.network.category === 'Public' ? 'public' : phone.network.category === 'Private' ? 'private' : 'work'} network`)}</span> : null}
                    {phone.firewallRule && phone.firewall !== 'open' ? <span className="meta"> · {phone.firewallRule}</span> : null}
                    <span className="meta"> · {t('read from this PC')}</span>
                  </span>
                </li>
                <li className={phone.seenAt ? 'yes' : ''}>
                  <span className="mark" aria-hidden>{phone.seenAt ? '∴' : '·'}</span>
                  <span>
                    {phone.seenAt
                      ? t(`a device with the code reached Axive ${ago(phone.seenAt)}`)
                      : phone.reachedAt
                        ? t(`a device reached Axive ${ago(phone.reachedAt)}, but without the current code: scan it again`)
                        : t('waiting for your phone: this line changes when it gets through')}
                  </span>
                </li>
              </ul>
              {phone.note ? <p className="note-text">{t(phone.note)}</p> : null}
              <div className="row-gap">
                {!asksNothing ? (
                  <Button
                    icon="shield"
                    kind={phone.firewall === 'open' ? 'plain' : 'primary'}
                    disabled={asking}
                    hint="Windows asks you first (an administrator prompt). The rule opens only Axive's phone port, to devices on this network; the firewall stays on"
                    onClick={() => void setUp()}
                  >
                    {asking ? 'asking Windows…' : phone.firewall === 'open' ? 'set up the firewall again' : 'set up Windows Firewall'}
                  </Button>
                ) : null}
                <Button icon="retry" disabled={phone.checking || asking} hint="look again: the address, the firewall, the network (asks Windows for nothing)" onClick={() => void attempt(() => call('phone-check'))}>
                  {phone.checking ? 'checking…' : 'check again'}
                </Button>
              </div>
              {!phone.seenAt ? (
                <details className="trouble">
                  <summary>{t('if your phone still cannot open the page')}</summary>
                  <ul>
                    <li>{t('put the phone on the same Wi-Fi as this PC: not mobile data, not a guest network')}</li>
                    <li>{t('turn off a VPN or private relay on the phone or on this PC, then scan again')}</li>
                    <li>{t('some routers keep Wi-Fi devices apart ("AP isolation" or "client isolation"): turn that off in the router')}</li>
                    {phone.guards?.length ? <li>{t(`${phone.guards.join(', ')} also guards connections on this PC: allow Axive there too`)}</li> : null}
                    <li>{t('a router may give this PC a new address: Axive follows it, so scan the new code')}</li>
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}

          <div className="setting-row">
            <div>
              <div className="name">{t('phone may draw')}</div>
              <div className="help">{t('a link sent from your phone starts drawing at once (off: Axive asks on the PC first)')}</div>
            </div>
            <Toggle label={remoteDraw ? 'on' : 'off'} value={remoteDraw} onChange={v => setConfig({remoteDraw: v})} />
          </div>
          <div className="setting-row">
            <div>
              <div className="name">{t('phone may take files')}</div>
              <div className="help">{t('the phone page lists what Axive received: save a file to the phone, then delete it on the PC if you like (to its Recycle Bin)')}</div>
            </div>
            <Toggle label={remoteFiles ? 'on' : 'off'} value={remoteFiles} onChange={v => setConfig({remoteFiles: v})} />
          </div>
          <p className="meta">{t('from the phone: draw a link into any folder of this PC (Windows and program folders stay closed), take what Axive received, and delete it here once the phone has it.')}</p>
          <div className="row-gap">
            <Button icon="open" disabled={!on} hint="the same code, large, in your browser" onClick={() => void attempt(() => call('phone-popout'))}>
              show bigger
            </Button>
            <Button icon="copy" disabled={!on || !phone.lanUrl} onClick={() => void attempt(async () => (await call('copy', {text: phone.lanUrl}), say('copied', 'ok')))}>
              copy the link
            </Button>
          </div>
          {phone.error ? <p className="err">{t(phone.error)}</p> : null}
          <ol className="steps">
            <li>{t('turn the phone on')}</li>
            <li>{t('point the phone camera at the code')}</li>
            <li>{t('share a link to the page that opens, or paste it there')}</li>
          </ol>
        </section>
      </div>
    </div>
  )
}
