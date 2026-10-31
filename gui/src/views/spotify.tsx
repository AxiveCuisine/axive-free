import React, {useEffect, useRef, useState} from 'react'
import {attempt, call, say, t, useAxive, type SpotifyAccount, type SpotifyReport, type SpotifyRun} from '../state.js'
import {Button, Field, Scrambled, Title} from '../ui.js'

type Playlist = {id: string; name: string; count: number; owner: string; mine: boolean; cover?: string}
type Album = {id: string; name: string; artist: string; year?: string; count: number; cover?: string}
type Library = {account: string; liked: number; playlists: Playlist[]; albums: Album[]; more?: {playlists?: number; albums?: number}}

const DASHBOARD = 'https://developer.spotify.com/dashboard'

/** One collection's import in words: only what happened, each count once. */
function reportLine(r: SpotifyReport): string {
  if (r.error) return r.error
  const parts = [r.read < r.total ? `${r.songs} songs (${r.read} of ${r.total} read)` : `${r.songs} songs`]
  if (r.kept) parts.push(`${r.kept} already here, kept`)
  if (r.queued) parts.push(`${r.queued} queued${r.missing || r.again ? ` (${[r.missing ? `${r.missing} missing from the folder` : '', r.again ? `${r.again} unfinished last time` : ''].filter(Boolean).join(', ')})` : ''}`)
  if (r.waiting) parts.push(`${r.waiting} still in the tunnels`)
  if (r.overLimit) parts.push(`${r.overLimit} not queued: over the limit of one import`)
  if (r.duplicates) parts.push(`${r.duplicates} listed twice, one file each`)
  if (r.gone) parts.push(`${r.gone} no longer in it on Spotify, their files stay`)
  const left = r.leftOut.local + r.leftOut.episodes + r.leftOut.unavailable
  if (left) parts.push(`${left} left out (${[r.leftOut.local ? `${r.leftOut.local} local files` : '', r.leftOut.episodes ? `${r.leftOut.episodes} podcast episodes` : '', r.leftOut.unavailable ? `${r.leftOut.unavailable} no longer on Spotify` : ''].filter(Boolean).join(', ')})`)
  if (!r.queued && !r.waiting && !r.overLimit && r.kept === r.songs && r.songs) parts.push('nothing new')
  return parts.join(' · ')
}

/** How the import ended, said plainly: never as if all was read when it was not. */
function runLine(run: SpotifyRun): string {
  // a collection stopped or refused while it was read was not read
  const read = run.done.filter(r => !r.error)
  const unread = run.chosen - read.length
  const failed = run.done.length - read.length
  const partial = read.filter(r => r.read < r.total).length
  if (run.stopped === 'asked') return `stopped: ${read.length} of ${run.chosen} read · what was queued stays in the tunnels`
  if (run.stopped === 'account') return `the Spotify account changed, so the import stopped${unread ? ` with ${unread} not read` : ''} · what was queued stays in the tunnels`
  if (run.stopped === 'limit') return `one import queues at most ${run.limit} songs: ${run.queued} queued${unread ? `, ${unread} not read` : ''} · import again to go on`
  const short = [failed ? `${failed} of ${run.chosen} could not be read` : '', partial ? `${partial} read only in part` : ''].filter(Boolean)
  return `${run.queued} songs queued · ${short.length ? short.join(', ') : `all ${run.chosen} read`}`
}

/**
 * Your Spotify library (rail): sign in to your own Spotify app once, check
 * liked songs, playlists and saved albums, and they queue as tagged MP3s,
 * each collection in a folder of its own. What Spotify allows and what the
 * sound really is are said plainly on the page. The account connected stays
 * until another one has finished signing in; the import is followed live and
 * says what it kept, queued, left out and could not read.
 */
export function SpotifyView({onTunnels}: {onTunnels: () => void}) {
  const folder = useAxive(s => String(s.config.folder ?? ''))
  const live = useAxive(s => s.spotify)
  const [fallback, setFallback] = useState<SpotifyAccount>()
  const account = live?.account ?? fallback
  const run = live?.run ?? undefined
  const [clientId, setClientId] = useState('')
  const [another, setAnother] = useState(false)
  const [library, setLibrary] = useState<Library | 'loading' | string>()
  const [liked, setLiked] = useState(false)
  const [lists, setLists] = useState<Set<string>>(new Set())
  const [albums, setAlbums] = useState<Set<string>>(new Set())
  const [into, setInto] = useState<string>()
  const stopping = useRef(false)

  const load = () => {
    setLibrary('loading')
    void call<Library>('spotify-library').then(setLibrary, (error: Error) => setLibrary(error.message))
  }
  useEffect(() => {
    void attempt(async () => setFallback(await call<SpotifyAccount>('spotify-account')))
  }, [])
  useEffect(() => {
    if (account?.clientId && !clientId) setClientId(account.clientId)
  }, [account?.clientId])
  // another account (or none) means another library: what was chosen goes with the old one
  const who = account?.connected ? `${account.name ?? ''}` : ''
  useEffect(() => {
    setLiked(false)
    setLists(new Set())
    setAlbums(new Set())
    if (who) load()
    else setLibrary(undefined)
  }, [who, account?.connected])

  const connect = () =>
    void attempt(async () => {
      stopping.current = false
      try {
        const a = await call<SpotifyAccount>('spotify-connect', {clientId})
        setAnother(false)
        say(`Spotify is connected: ${a.name}`, 'ok')
      } catch (error) {
        if (!stopping.current) throw error
      }
    })
  const stopSigningIn = () => {
    stopping.current = true
    void attempt(() => call('spotify-connect-stop'))
  }

  const flip = (set: Set<string>, id: string, put: (s: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    put(next)
  }
  const lib = typeof library === 'object' ? library : undefined
  const chosenTracks = (liked && lib ? lib.liked : 0) + (lib?.playlists.filter(p => lists.has(p.id)).reduce((n, p) => n + p.count, 0) ?? 0) + (lib?.albums.filter(a => albums.has(a.id)).reduce((n, a) => n + a.count, 0) ?? 0)
  const root = `${into ?? folder}\\Spotify`
  const reading = Boolean(run?.running)

  const start = () =>
    void attempt(() =>
      call('spotify-import', {
        liked,
        playlists: lib!.playlists.filter(p => lists.has(p.id)).map(p => ({id: p.id, name: p.name, mine: p.mine, count: p.count})),
        albums: lib!.albums.filter(a => albums.has(a.id)).map(a => ({id: a.id, name: a.name})),
        ...(into ? {folder: into} : {}),
      }),
    )

  const signIn = account ? (
    <>
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
        <li>{t('save, then copy the app’s Client ID here and connect: Spotify asks you in your browser which account to use')}</li>
      </ol>
      <div className="row-gap">
        <Field label="Client ID" value={clientId} onChange={v => setClientId(v.trim())} placeholder="32 letters and digits" onEnter={connect} mono />
        <Button kind="primary" icon="link" disabled={account.signingIn || !/^[0-9a-f]{32}$/i.test(clientId)} onClick={connect}>
          {account.signingIn ? 'waiting for Spotify…' : 'connect'}
        </Button>
        {account.signingIn ? (
          <Button kind="quiet" icon="close" onClick={stopSigningIn}>
            stop
          </Button>
        ) : null}
      </div>
    </>
  ) : null

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
          {signIn}
          <p className="meta">{t('No password and no secret reach Axive: Spotify signs you in itself and hands Axive a key that can only read your library. It stays on this PC; "disconnect" forgets it.')}</p>
        </section>
      ) : (
        <>
          <div className="row-gap spotify-account">
            <p className="ok-line">∴ {t(`connected as ${account.name ?? 'your account'}`)}</p>
            <Button kind="quiet" icon="retry" onClick={load} disabled={library === 'loading'}>
              look again
            </Button>
            <Button kind="quiet" icon="link" onClick={() => setAnother(v => !v)} disabled={account.signingIn && !another}>
              another account
            </Button>
            <Button kind="quiet" icon="close" onClick={() => void attempt(() => call('spotify-disconnect'))}>
              disconnect
            </Button>
          </div>
          {another || account.signingIn ? (
            <section className="spotify-connect" aria-label={t('connect another Spotify account')}>
              <p className="meta">{t(`You stay connected as ${account.name ?? 'your account'} until the other account has finished signing in. Stopped or refused, nothing changes. The other account must be listed under "User Management" in your Spotify app.`)}</p>
              {signIn}
            </section>
          ) : null}

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
              {lib.more?.playlists ? <p className="meta">{t(`the first ${lib.playlists.length} of your ${lib.more.playlists} playlists`)}</p> : null}
              {lib.playlists.length ? (
                <ul className="checklist">
                  {lib.playlists.map(p => (
                    <li key={p.id}>
                      <label className={lists.has(p.id) ? 'checked' : ''} data-tip={p.mine ? undefined : t('made by someone else: Spotify lets your app read the songs of only playlists you made or collaborate on, so Axive may take this one from its public page (the first 100 or so tracks)')}>
                        <input type="checkbox" checked={lists.has(p.id)} onChange={() => flip(lists, p.id, setLists)} />
                        <span className="t">{p.name}</span>
                        <span className="meta">{p.mine ? '' : t(`by ${p.owner}`)}</span>
                        <span className="data">{p.count}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="meta">{t('no playlists')}</p>
              )}

              <div className="label">{t(`saved albums · ${lib.albums.length}`)}</div>
              {lib.more?.albums ? <p className="meta">{t(`the first ${lib.albums.length} of your ${lib.more.albums} saved albums`)}</p> : null}
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
              <p className="meta">{t('Liked Songs\\Artist - Title.mp3 · Playlists\\name\\Artist - Title.mp3 · Albums\\Artist - Album (year)\\01 - Title.mp3. Importing again draws only what is new or missing. Axive keeps a record by Spotify’s own IDs: a renamed playlist keeps its folder, and a file counts as imported only when Axive drew that song into it. Nothing is ever replaced or deleted.')}</p>
              <div className="row-gap">
                <Button kind="primary" icon="down" disabled={reading || chosenTracks === 0} onClick={start}>
                  {reading ? 'reading the tracks…' : chosenTracks ? `import ${chosenTracks} tracks` : 'choose what to import'}
                </Button>
                {reading ? (
                  <Button kind="quiet" icon="close" onClick={() => void attempt(() => call('spotify-import-stop'))}>
                    stop
                  </Button>
                ) : null}
                {run?.queued ? (
                  <Button icon="menu" onClick={onTunnels}>
                    see them in the tunnels
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}

      {run ? (
        <section className="import-run" aria-label={t('the import')} aria-live="polite">
          {run.running ? (
            <p className="meta">
              <Scrambled text={t(run.reading ? `reading ${run.reading} · ${run.done.length + 1} of ${run.chosen}` : 'reading…')} />
            </p>
          ) : (
            <p className={run.stopped || run.done.some(r => r.error || r.read < r.total) ? 'warn' : 'ok-line'}>{t(runLine(run))}</p>
          )}
          {run.done.length ? (
            <ul className="import-result">
              {run.done.map((r, i) => (
                <li key={i} className={r.error ? 'err' : ''}>
                  <span className="t">{r.label}</span>
                  {r.folder ? <span className="meta"> · {r.folder}</span> : null}: {t(reportLine(r))}
                  {r.renamed ? <span className="meta"> · {t(`now called "${r.renamed}" on Spotify: its folder keeps the first name`)}</span> : null}
                  {r.note ? <span className="meta"> · {t(r.note)}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
