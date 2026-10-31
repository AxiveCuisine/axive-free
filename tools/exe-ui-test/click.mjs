// Drives the real Axive-Free.exe in a pseudo-terminal: a first launch in a
// fresh folder, every door, what Free leaves to Axive, a real draw from
// YouTube, and a 100 MB file through the download manager (served from this
// PC), checking each screen renders and the process never crashes.
//   node click.mjs <Axive-Free.exe>
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import pty from '@lydell/node-pty'
import stringWidth from 'string-width'

const [exe] = process.argv.slice(2)
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'axive-free-ui-'))
const dl = path.join(home, 'dl')
fs.mkdirSync(dl)
const frameFile = path.join(home, 'frame.txt')
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({folder: dl, askWhere: false, animations: false, checkUpdates: false, openInTerminal: false}))

// the 100 MB file comes from this PC, served in ranges and slowly (160 KB/s a connection)
const SIZE = 100 * 1024 * 1024
const byteAt = i => (i * 31 + 7) & 255
const slow = http.createServer((req, res) => {
  if (req.url !== '/100MB.bin') return res.writeHead(404).end()
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
  let start = 0
  let end = SIZE - 1
  if (m && (m[1] || m[2])) (start = m[1] ? Number(m[1]) : SIZE - Number(m[2])), (end = m[1] && m[2] ? Math.min(Number(m[2]), SIZE - 1) : SIZE - 1)
  res.writeHead(m ? 206 : 200, {'Content-Type': 'application/octet-stream', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(m ? {'Content-Range': `bytes ${start}-${end}/${SIZE}`} : {})})
  if (req.method === 'HEAD') return res.end()
  let at = start
  const tick = setInterval(() => {
    if (res.destroyed || at > end) return clearInterval(tick), res.end()
    const n = Math.min(16 * 1024, end - at + 1)
    const chunk = Buffer.alloc(n)
    for (let i = 0; i < n; i++) chunk[i] = byteAt(at + i)
    res.write(chunk)
    at += n
  }, 100)
  req.on('close', () => clearInterval(tick))
})
await new Promise(r => slow.listen(0, '127.0.0.1', r))
const FILE_URL = `http://127.0.0.1:${slow.address().port}/100MB.bin`

const results = []
const check = (name, ok, detail = '') => {
  results.push({name, ok, detail})
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`)
}

// the command line, without a terminal
const env = {...process.env, AXIVE_HOME: home}
const run = (...args) => spawnSync(exe, args, {encoding: 'utf8', env, timeout: 30000})
check('--version prints the version', /^\d+\.\d+\.\d+\s*$/.test(run('--version').stdout))
const help = run('--help').stdout
check('--help names Free and points at Axive', help.includes('axive free') && help.includes('axive.xyz') && !/—/.test(help))
const notices = run('--notices').stdout
check('--notices: GPL-3.0, the source, and each bundled program', notices.includes('GNU General Public License, version 3') && notices.includes('github.com/AxiveCuisine/axive-free') && /yt-dlp[\s\S]*FFmpeg[\s\S]*aria2[\s\S]*Node\.js/.test(notices) && notices.includes('WebView2') && notices.includes('Cormorant'))
check('config takes a third tunnel, refuses a fourth', run('config', 'set', 'tunnels', '3').status === 0 && run('config', 'set', 'tunnels', '4').status === 1)

const COLS = 140
const ROWS = 46
const term = pty.spawn(exe, ['--in-terminal'], {name: 'xterm-256color', cols: COLS, rows: ROWS, cwd: home, env: {...env, AXIVE_FRAME_DUMP: frameFile, WT_SESSION: 'test'}})
let exited = null
term.onExit(e => (exited = e))
term.onData(() => {})

const sleep = ms => new Promise(r => setTimeout(r, ms))
// rules are drawn in small capitals: compare without case
const frame = () => {
  try {
    return fs.readFileSync(frameFile, 'utf8')
  } catch {
    return ''
  }
}
const tail = (n = 6) => frame().split('\n').filter(l => l.trim()).slice(-n).join(' | ').replace(/\s+/g, ' ').slice(0, 260)
async function waitFor(pred, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (exited) return false
    const f = frame()
    const low = f.toLowerCase()
    if (typeof pred === 'string' ? f.includes(pred) || low.includes(pred.toLowerCase()) : pred(f) || pred(low)) return true
    await sleep(150)
  }
  return false
}
/** click the n-th occurrence of a label (by its centre), as a mouse press + release */
async function click(label, nth = 0) {
  const lines = frame().split('\n')
  let seen = 0
  for (let row = 0; row < lines.length; row++) {
    let from = 0
    for (;;) {
      const i = lines[row].indexOf(label, from)
      if (i < 0) break
      if (seen++ === nth) {
        const col = stringWidth(lines[row].slice(0, i)) + Math.ceil(stringWidth(label) / 2)
        term.write(`\x1b[<35;${col};${row + 1}M`)
        await sleep(60)
        term.write(`\x1b[<0;${col};${row + 1}M`)
        await sleep(40)
        term.write(`\x1b[<0;${col};${row + 1}m`)
        await sleep(250)
        return true
      }
      from = i + 1
    }
  }
  return false
}
const esc = async () => (term.write('\x1b'), await sleep(400))
const typeText = async text => {
  term.write(`\x1b[200~${text}\x1b[201~`)
  await sleep(300)
}
const homeMark = 'Offer a link'
// the reading screen keeps the link box: home is the box with home's own keys
const atHome = f => f.includes(homeMark) && f.includes('ctrl+d download manager')
const backHome = async () => {
  for (let i = 0; i < 4 && !atHome(frame()); i++) await esc()
  return waitFor(atHome, 5000)
}

try {
  // first launch in a fresh folder unpacks the tools, then lands home
  await waitFor(f => f.includes(homeMark) || f.includes('vessel'), 60000)
  if (!frame().includes(homeMark)) await waitFor(homeMark, 240000)
  check('first launch: tools unpack, home appears', frame().includes(homeMark) && !exited)

  const f0 = frame()
  check('home: the title bar and the rail say Axive Free', f0.includes('download manager') && f0.includes('tunnels') && f0.includes('settings') && f0.includes('Axive'))
  check('home: no door that belongs to the full Axive', !/\b(phone|ghost|ledger|vigils|login|convert|batch|queues)\b/.test(f0), (f0.match(/\b(phone|ghost|ledger|vigils|login|convert|batch|queues)\b/g) ?? []).join(','))
  check('home: no em dash on screen', !f0.includes('—'))

  term.write('?')
  check('? opens the sheet with Free\'s doors', await waitFor(f => f.includes('every key, and every door') && f.includes('the full table: playlists') && f.includes('the window'), 5000))
  await esc()
  check('the sheet: esc returns home', await waitFor(homeMark, 5000))

  term.write('\x04') // ctrl+d
  check('ctrl+d opens the download manager', await waitFor('Offer a file link', 6000))
  await backHome()

  // every door in the rail
  const doors = [
    ['download manager', f => f.includes('Offer a file link')],
    ['tunnels', f => f.includes('Tunnels') && !f.includes(homeMark)],
    ['settings', f => f.includes('renewal & tools') && f.includes("axive's settings also hold")],
    ['keys', f => f.includes('every key, and every door')],
  ]
  for (const [label, opened] of doors) {
    await backHome()
    await click(label)
    const ok = await waitFor(opened, 8000)
    check(`door: ${label}`, ok && !exited, ok ? '' : tail())
  }
  await backHome()

  // the Axive page: from the header chip, plainly what it adds
  await click('Axive', 0)
  const page = await waitFor(f => f.includes('free · axive') && f.includes('playlists') && f.includes('up to 8k, audio tracks') && f.includes('open axive.xyz') && f.includes('$7.99 once'), 8000)
  check('the Axive page lists what the full Axive adds', page, page ? '' : tail())
  await backHome()

  // settings: three tunnels at most, the speed limit is one for everything
  await click('settings')
  await waitFor('renewal & tools', 8000)
  check('settings: tunnels offer 1 to 3', frame().includes('tunnels') && !/tunnels\s+[‹<]?\s*[4-9]\b/.test(frame()))
  check('settings: simple language sits above the tabs', frame().indexOf('simple language') < frame().indexOf('renewal & tools'))
  await click('download manager', 1)
  check('settings: the download manager tab', await waitFor(f => f.includes('connections') && f.includes('same name'), 5000), tail())
  await backHome()

  // what only Axive does: said plainly, with the way there
  await typeText('magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny')
  term.write('\r')
  check('a magnet: torrents come with Axive', await waitFor(f => f.includes('torrents and magnets come with axive') && f.includes('free · axive'), 8000), tail())
  await backHome()
  await typeText('https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy')
  term.write('\r')
  check('a Spotify link: Spotify comes with Axive', await waitFor('Spotify tracks, albums and playlists come with Axive', 8000), tail())
  await backHome()

  // a real draw: a short public video, every quality it has, lands in the folder
  await typeText('https://www.youtube.com/watch?v=jNQXAC9IVRw')
  term.write('\r')
  const vessels = await waitFor(f => f.includes('Vessels') && f.includes('Me at the zoo'), 60000)
  check('a YouTube link opens its vessels', vessels, vessels ? '' : tail())
  check('the vessels: no cap line, audio offered', vessels && !/Axive draws those|1080p at most/i.test(frame()) && /mp3/i.test(frame()))
  term.write('\r')
  const drawn = await waitFor(f => f.includes('received.'), 120000)
  const file = fs.readdirSync(dl).find(n => /Me at the zoo/.test(n) && !/\.part$/.test(n))
  check('the draw is received into the folder', drawn && Boolean(file), file ?? tail())
  await backHome()

  // a playlist link: Free draws the video it points at; a bare playlist is Axive's
  await typeText('https://www.youtube.com/@YouTube/videos')
  term.write('\r')
  const listed = await waitFor('playlists and whole channels come with Axive', 90000)
  check('a playlist: playlists come with Axive', listed, listed ? '' : frame().replace(/s+/g, ' ').slice(0, 900))
  await backHome()

  // many links at once: the first is drawn, batch is Axive's
  await typeText('https://www.youtube.com/watch?v=jNQXAC9IVRw https://vimeo.com/76979871')
  term.write(String.fromCharCode(13))
  check('many video links: the first is taken, batch is named as Axive\'s', await waitFor(f => f.includes('comes with Axive'), 8000), tail())
  await backHome()

  // the download manager end to end: probe, add, many connections, pause, resume, cancel and delete
  await click('download manager')
  await waitFor('Offer a file link', 8000)
  await typeText(FILE_URL)
  term.write('\r')
  check('fetch: the link is looked at before it is added', await waitFor(f => f.includes('BEFORE IT IS ADDED') && f.includes('100 MB') && f.includes('resumes'), 20000), tail())
  check('fetch: no queue or per-file limit in Free', !/\bqueue\b/.test(frame()) && !frame().includes("this file's own limit"))
  term.write('\r')
  const head = () => (frame().split('\n').find(l => l.includes('100MB.BIN')) ?? '').replace(/^.{0,30}?│/, '').replace(/─+/g, ' ').trim()
  const descending = await waitFor(() => /of 100 MB/.test(head()), 30000)
  await sleep(4000)
  let peak = 0
  for (let t = 0; t < 16; t++) {
    peak = Math.max(peak, Number(/(\d+) connections?/.exec(head())?.[1] ?? 0))
    await sleep(250)
  }
  check('fetch: a file descends over parallel connections', descending && peak > 1 && !exited, `${head().slice(0, 110)} (peak ${peak} connections)${descending ? '' : ' ' + tail(16)}`)
  await click('pause')
  check('fetch: pause', await waitFor(() => /paused/.test(head()) || /\bresume\b/.test(frame()), 8000), head().slice(0, 110))
  await click('resume')
  check('fetch: resume carries on', await waitFor(() => /connection|received/.test(head()) && !/paused/.test(head()), 15000), head().slice(0, 110))
  await click('cancel')
  const asked = await waitFor(f => f.includes('also delete the partial file') && f.includes('stop, keep the file'), 5000)
  check('fetch: cancel asks whether the partial file goes too', asked, asked ? '' : tail())
  await click('also delete the partial file')
  await waitFor('delete, with the file', 3000)
  await click('delete, with the file')
  await waitFor(f => !f.includes('100MB.bin'), 8000)
  let left = []
  for (let t = 0; t < 40; t++) {
    left = fs.readdirSync(dl).filter(n => n.startsWith('100MB'))
    if (!left.length) break
    await sleep(200)
  }
  check('fetch: cancel removes the partial file and its control file', left.length === 0 && !exited, left.join(', ') || 'clean')
  await backHome()
  check('still running after every screen', !exited)
} catch (error) {
  check('harness', false, error.message)
} finally {
  const log = (() => {
    try {
      return fs.readFileSync(path.join(home, 'logs', 'axive.log'), 'utf8')
    } catch {
      return ''
    }
  })()
  const crashes = log.split('\n').filter(l => /crash|TypeError|ReferenceError|is not a function/.test(l))
  check('no crash in the log', crashes.length === 0, crashes.slice(0, 3).join(' | '))
  try {
    term.write('\x03')
  } catch {}
  await sleep(2500)
  if (!exited)
    try {
      term.kill()
    } catch {}
  process.on('uncaughtException', () => {})
  await sleep(2500)
  slow.close()
  fs.rmSync(home, {recursive: true, force: true, maxRetries: 10, retryDelay: 400})
  const failed = results.filter(r => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed; sandbox removed: ${!fs.existsSync(home)}`)
  process.exit(failed ? 1 : 0)
}
