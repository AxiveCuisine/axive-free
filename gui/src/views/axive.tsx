import React from 'react'
import {attempt, call, t} from '../state.js'
import {Button, Title} from '../ui.js'
import {UPGRADE_URL} from '../edition.js'

/** what Free does, and what Axive adds: the same rows as the terminal's "Axive" screen */
const COURSES: Array<[what: string, free: string, axive: string]> = [
  ['quality', 'up to 8K, mp3 or m4a, any audio track', 'the same, plus subtitles and transcripts'],
  ['links', 'one at a time', 'playlists, whole channels, search, many links at once'],
  ['download manager', 'any file over 16 connections, pause and resume', 'plus torrents and magnets'],
  ['tunnels', '3 side by side', 'up to 4, named queues, schedules, off-peak hours'],
  ['the window', 'the window and the terminal', 'the same, with every door below'],
  ['Spotify', '·', 'tracks, albums, playlists and your own library as tagged MP3s'],
  ['browser', '·', 'an extension: one press on any page'],
  ['your phone', '·', 'send links from it, take files to it'],
  ['tools', '·', 'convert, trim, highlight reels, chapters, SponsorBlock'],
  ['clipboard', '·', 'ghost: a link you copy is offered at once'],
  ['and', '·', 'vigils on channels, signing in for private videos, Telegram, Dutch'],
]

/** Free's door to Axive: plainly what each one does, and where Axive is. */
export function AxiveView() {
  return (
    <div className="view axive-view">
      <Title sub="Free stays free: no account, no ads, no time limit">Axive Free · Axive</Title>
      <p className="meta">{t('Axive is the whole table: $7.99 once, for life, on 3 PCs, every 1.x and 2.x update, 14-day refund.')}</p>
      <table className="courses">
        <thead>
          <tr>
            <th scope="col" className="sr-only">
              {t('what')}
            </th>
            <th scope="col">{t('Axive Free')}</th>
            <th scope="col">{t('Axive')}</th>
          </tr>
        </thead>
        <tbody>
          {COURSES.map(([what, free, axive]) => (
            <tr key={what}>
              <th scope="row" className="label">
                {t(what)}
              </th>
              <td className={free === '·' ? 'meta' : ''}>{free === '·' ? '·' : t(free)}</td>
              <td>{t(axive)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-gap">
        <Button kind="primary" icon="open" onClick={() => void attempt(() => call('open-url', {url: UPGRADE_URL}))}>
          open axive.xyz
        </Button>
      </div>
    </div>
  )
}
