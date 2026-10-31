import React, {useEffect, useState} from 'react'
import {attempt, call, say, t, useAxive} from '../state.js'
import {Button, Field, Scrambled, Title} from '../ui.js'

type Account = {connected: boolean; clientId?: string; name?: string; redirect: string}
type Playlist = {id: string; name: string; count: number; owner: string; mine: boolean; cover?: string}
type Album = {id: string; name: string; artist: string; year?: string; count: number; cover?: string}
type Library = {account: string; liked: number; playlists: Playlist[]; albums: Album[]}
type Imported = {folder: string; total: number; collections: Array<{label: string; count: number; kept: number; note?: string; error?: string}>}

const DASHBOARD = 'https://developer.spotify.com/dashboard'

/**
 * Your Spotify library (rail): sign in to your own Spotify app once, check
 * liked songs, playlists and saved albums, and they queue as tagged MP3s,
 * each collection in a folder of its own. What Spotify allows and what the
 * sound really is are said plainly on the page.
 */
export function SpotifyView({onTunnels}: {onTunnels: () => void}) {
  const folder = useAxive(s => String(s.config.folder ?? ''))
  const [account, setAccount] = useState<Account>()
  const [clientId, setClientId] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [library, setLibrary] = useState<Library | 'loading' | string>()
  const [liked, setLiked] = useState(false)
  const [lists, setLists] = useState<Set<string>>(new Set())
  const [albums, setAlbums] = useState<Set<string>>(new Set())
  const [into, setInto] = useState<string>()
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<Imported>()

  const load = () => {
    setLibrary('loading')
    void call<Library>('spotify-library').then(setLibrary, (error: Error) => setLibrary(error.message))
  }
  useEffect(() => {
    void attempt(async () => {
      const a = await call<Account>('spotify-account')
      setAccount(a)
      setClientId(a.clientId ?? '')
      if (a.connected) load()
    })
  }, [])

  const connect = () =>
    void attempt(async () => {
      setConnecting(true)
      try {
        const a = await call<Account>('spotify-connect', {clientId})
        setAccount(a)
        say(`Spotify is connected: ${a.name}`, 'ok')
        load()
      } finally {
        setConnecting(false)
      }
    })

  const flip = (set: Set<string>, id: string, put: (s: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    put(next)
  }
  const lib = typeof library === 'object' ? library : undefined
  const chosenTracks = (liked && lib ? lib.liked : 0) + (lib?.playlists.filter(p => lists.has(p.id)).reduce((n, p) => n + p.count, 0) ?? 0) + (lib?.albums.filter(a => albums.has(a.id)).reduce((n, a) => n + a.count, 0) ?? 0)
  const root = `${into ?? folder}\\Spotify`

  const start = () =>
    void attempt(async () => {
      setImporting(true)
      try {
        const r = await call<Imported>('spotify-import', {
          liked,
          playlists: lib!.playlists.filter(p => lists.has(p.id)).map(p => ({id: p.id, name: p.name, mine: p.mine})),
          albums: [...albums],
          ...(into ? {folder: into} : {}),
        })
        setResult(r)
        const failed = r.collections.filter(c => c.error).length
        say(failed ? `${r.total} tracks queued; ${failed} could not be read from Spotify` : `${r.total} tracks queued from Spotify`, failed ? 'warn' : 'ok')
      } finally {
        setImporting(false)
      }
    })

  return (
    <div className="view spotify-view">
      <Title sub="your liked songs, playlists and saved albums, as tagged MP3s in folders of their own">Spotify library</Title>
      <p className="meta honest">
        {t('Only the track list comes from Spotify. Axive finds each song on YouTube and draws that upload’s sound, with Spotify’s title, artists, album, numbers and cover written into the MP3. It is not Spotify’s own audio, and making it an MP3 does not make it sound better than the upload it came from. A song with no reliable match is reported, not guessed.')}
      </p>

      {!account ? null : !account.connected ? (
        <section className="spotify-connect" aria-label={t('connect Spotify')}>
          <div className="label">{t('connect once')}</div>
          <p className="meta">{t('Spotify lets a program read your library only through a small app of your own (free to make), and only while that account has Spotify Premium. That is Spotify’s rule, not Axive’s. Without it, Spotify links to public playlists and albums still work: offer them like any link.')}</p>
          <ol className="steps">
            <li>
              {t('open the Spotify dashboard and sign in')}{' '}
              <Button kind="quiet" icon="open" onClick={() => void attempt(() => call('open-url', {url: DASHBOARD}))}>
                Spotify dashboard
              </Button>
            </li>
            <li>{t('press "Create app": any name and description, tick "Web API"')}</li>
            <li>
              {t('as its Redirect URI, add exactly')} <code className="data">{account.redirect}</code>{' '}
              <Button kind="quiet" icon="copy" label="copy" onClick={() => void attempt(async () => (await call('copy', {text: account.redirect}), say('copied', 'ok')))} />
            </li>
            <li>{t('save, then copy the app’s Client ID here and connect: Spotify asks you in your browser')}</li>
          </ol>
          <div className="row-gap">
            <Field label="Client ID" value={clientId} onChange={v => setClientId(v.trim())} placeholder="32 letters and digits" onEnter={connect} mono />
            <Button kind="primary" icon="link" disabled={connecting || !/^[0-9a-f]{32}$/i.test(clientId)} onClick={connect}>
              {connecting ? 'waiting for Spotify…' : 'connect'}
            </Button>
          </div>
          <p className="meta">{t('No password and no secret reach Axive: Spotify signs you in itself and hands Axive a key that can only read your library. It stays on this PC; "disconnect" forgets it.')}</p>
        </section>
      ) : (
        <>
          <div className="row-gap spotify-account">
            <p className="ok-line">∴ {t(`connected as ${account.name ?? 'your account'}`)}</p>
            <Button kind="quiet" icon="retry" onClick={load} disabled={library === 'loading'}>
              look again
            </Button>
            <Button kind="quiet" icon="close" onClick={() => void attempt(async () => (setAccount(await call<Account>('spotify-disconnect')), setLibrary(undefined)))}>
              disconnect
            </Button>
          </div>

          {library === 'loading' ? <p className="meta"><Scrambled text={t('reading your library…')} /></p> : null}
          {typeof library === 'string' && library !== 'loading' ? <p className="err">{t(library)}</p> : null}

          {lib ? (
            <div className="spotify-library">
              <ul className="checklist">
                <li>
                  <label className={liked ? 'checked' : ''}>
                    <input type="checkbox" checked={liked} onChange={() => setLiked(v => !v)} />
                    <span className="t">{t('Liked Songs')}</span>
                    <span className="data">{lib.liked}</span>
                  </label>
                </li>
              </ul>

              <div className="label">{t(`playlists · ${lib.playlists.length}`)}</div>
              {lib.playlists.length ? (
                <ul className="checklist">
                  {lib.playlists.map(p => (
                    <li key={p.id}>
                      <label className={lists.has(p.id) ? 'checked' : ''} data-tip={p.mine ? undefined : t('made by someone else: Spotify lets your app read only your own playlists, so Axive takes this one from its public page (the first 100 or so tracks)')}>
                        <input type="checkbox" checked={lists.has(p.id)} onChange={() => flip(lists, p.id, setLists)} />
                        <span className="t">{p.name}</span>
                        <span className="meta">{p.mine ? '' : t(`by ${p.owner} · public page`)}</span>
                        <span className="data">{p.count}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="meta">{t('no playlists')}</p>
              )}

              <div className="label">{t(`saved albums · ${lib.albums.length}`)}</div>
              {lib.albums.length ? (
                <ul className="checklist">
                  {lib.albums.map(a => (
                    <li key={a.id}>
                      <label className={albums.has(a.id) ? 'checked' : ''}>
                        <input type="checkbox" checked={albums.has(a.id)} onChange={() => flip(albums, a.id, setAlbums)} />
                        <span className="t">{a.name}</span>
                        <span className="meta">{[a.artist, a.year].filter(Boolean).join(' · ')}</span>
                        <span className="data">{a.count}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="meta">{t('no saved albums')}</p>
              )}

              <div className="where-line">
                <span className="label">{t('into')}</span>
                <code className="data">{root}</code>
                <Button kind="quiet" icon="folder" onClick={() => void attempt(async () => {
                  const r = await call<{path: string | null}>('pick-folder', {title: 'Where the Spotify folder goes', initial: into ?? folder})
                  if (r.path) setInto(r.path)
                })}>
                  change
                </Button>
              </div>
              <p className="meta">{t('Liked Songs\\Artist - Title.mp3 · Playlists\\name\\Artist - Title.mp3 · Albums\\Artist - Album (year)\\01 - Title.mp3. Importing again draws only what is new: a file already there is kept, never replaced, and nothing is ever deleted.')}</p>
              <div className="row-gap">
                <Button kind="primary" icon="down" disabled={importing || chosenTracks === 0} onClick={start}>
                  {importing ? 'reading the tracks…' : chosenTracks ? `import ${chosenTracks} tracks` : 'choose what to import'}
                </Button>
                {result ? (
                  <Button icon="menu" onClick={onTunnels}>
                    see them in the tunnels
                  </Button>
                ) : null}
              </div>
              {result ? (
                <ul className="import-result">
                  {result.collections.map((c, i) => (
                    <li key={i} className={c.error ? 'err' : ''}>
                      {c.error ? t(`${c.label}: ${c.error}`) : t(`${c.label}: ${c.count} tracks${c.kept ? `, ${c.kept} already there (kept)` : ''}`)}
                      {c.note ? <span className="meta"> · {t(c.note)}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
