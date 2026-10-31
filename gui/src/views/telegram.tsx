import React, {useEffect, useState} from 'react'
import {attempt, call, say, t} from '../state.js'
import {Button, Field, Sheet} from '../ui.js'

/**
 * Link a Telegram bot, in three steps and no settings to hunt for: make a bot
 * with @BotFather and paste its token; send the bot any message; Axive finds
 * that chat itself (getUpdates). Opened by "send to telegram" when no bot is
 * linked yet (then the file goes as soon as it is linked), and from settings ›
 * notifications. The token is checked with Telegram and kept only in Axive's
 * settings on this PC.
 */
export function TelegramSheet({file, onClose}: {file?: string; onClose: () => void}) {
  const [token, setToken] = useState('')
  const [bot, setBot] = useState<{username: string; name: string}>()
  const [chat, setChat] = useState<{id: string; name: string}>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [listening, setListening] = useState(false)

  const check = async () => {
    setBusy(true)
    setError('')
    try {
      setBot(await call<{username: string; name: string}>('telegram-bot', {token}))
      setListening(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // the bot is known: listen (every 2 s, two minutes at most) for the message that tells Axive who you are
  useEffect(() => {
    if (!listening || chat) return
    let stop = false
    const until = Date.now() + 120_000
    const look = async () => {
      if (stop) return
      try {
        const r = await call<{chat: {id: string; name: string} | null}>('telegram-chat', {token})
        if (r.chat && !stop) return setChat(r.chat)
      } catch (e) {
        if (!stop) setError((e as Error).message)
      }
      if (Date.now() < until && !stop) setTimeout(() => void look(), 2000)
      else if (!stop) setListening(false)
    }
    void look()
    return () => {
      stop = true
    }
  }, [listening, chat])

  const link = () =>
    void attempt(async () => {
      setBusy(true)
      try {
        await call('telegram-link', {token, chat: chat!.id})
        say(`linked: ${bot!.name} writes to ${chat!.name}`, 'ok')
        if (file) {
          say('sending to telegram…')
          const r = await call<{sent: 'file' | 'message'; needsApi?: boolean}>('telegram-send', {path: file})
          say(r.sent === 'file' ? 'sent to telegram' : r.needsApi ? 'over 50 MB: telegram got the path. for the file itself, add an api_id and api_hash in settings › notifications' : 'over 2 GB: telegram got the path instead', r.sent === 'file' ? 'ok' : 'warn')
        }
        onClose()
      } finally {
        setBusy(false)
      }
    })

  return (
    <Sheet title="link your Telegram bot" sub={file ? 'then the file goes to your Telegram' : 'finished draws and files can come to your Telegram'} onClose={onClose} labelId="telegram-title">
      <ol className="steps telegram-steps">
        <li className={bot ? 'done' : ''}>
          <p>{t('in Telegram, open @BotFather and send /newbot. Give it any name; it answers with a token.')}</p>
          <div className="row-gap">
            <Button icon="link" onClick={() => void call('open-url', {url: 'https://t.me/BotFather'})} hint="opens Telegram (or its web page) on @BotFather">
              open @BotFather
            </Button>
          </div>
          <form className="relink" onSubmit={e => (e.preventDefault(), void check())}>
            <Field label="the bot token" value={token} onChange={v => (setToken(v), setBot(undefined), setChat(undefined), setListening(false))} placeholder="123456789:AAH…" autoFocus mono>
              <Button type="submit" kind={bot ? 'quiet' : 'primary'} disabled={busy || !token.trim()}>
                {busy && !bot ? '…' : 'check'}
              </Button>
            </Field>
          </form>
          {bot ? <p className="ok-line">∴ {t(`found your bot: @${bot.username}`)}</p> : null}
        </li>
        <li className={chat ? 'done' : bot ? '' : 'later'}>
          <p>{t('open your bot and send it any message (hello will do). Axive finds your chat from it.')}</p>
          {bot ? (
            <div className="row-gap">
              <Button icon="link" onClick={() => void call('open-url', {url: `https://t.me/${bot.username}`})}>
                {`open @${bot.username}`}
              </Button>
              {!chat && !listening ? (
                <Button kind="quiet" onClick={() => (setError(''), setListening(true))}>
                  look again
                </Button>
              ) : null}
            </div>
          ) : null}
          {chat ? <p className="ok-line">∴ {t(`found you: ${chat.name}`)}</p> : listening ? <p className="meta">{t('listening for your message…')}</p> : null}
        </li>
        <li className={chat ? '' : 'later'}>
          <p>{t(file ? 'link it, and the file goes at once.' : 'link it: Axive sends a hello so you know it works.')}</p>
          <Button kind="primary" icon="send" disabled={!chat || busy} onClick={link}>
            {file ? 'link and send' : 'link'}
          </Button>
        </li>
      </ol>
      {error ? (
        <p className="err" role="alert">
          {t(error)}
        </p>
      ) : null}
      <p className="meta">{t('the token stays in Axive on this PC. a file up to 50 MB goes as itself with nothing more; for up to 2 GB, add an api_id and api_hash later in settings › notifications.')}</p>
    </Sheet>
  )
}
