// Axive Free's window, end to end, on the packaged exe, in a sandbox (playwright-core
// drives the system Edge; axe-core checks every view):
//   the keyed server; only Free's doors on the rail; every Axive-only door and route
//   refused with one plain sentence; a 1.0 settings file carried over (2 tunnels stay 2,
//   4 is refused); a real file over 16 connections (hash checked) and a cancel;
//   a real YouTube video with several audio tracks drawn in German (filename tag and
//   ffprobe reads German in it); then the terminal door takes over
//   from the window (window exits, terminal holds the lock).
//   node free-gui.mjs <release\Axive-Free.exe> [--shots <dir>] [--no-net]
import {execFileSync, spawn} from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import {createRequire} from 'node:module'
import {chromium} from 'playwright-core'

const args = process.argv.slice(2)
const exe = path.resolve(args[0])
const shots = args.includes('--shots') ? path.resolve(args[args.indexOf('--shots') + 1]) : undefined
const net = !args.includes('--no-net')
if (shots) fs.mkdirSync(shots, {recursive: true})
const here = import.meta.dirname
// %TEMP% is inside AppData, which the app refuses as a download folder: sandbox beside the tests
const home = fs.mkdtempSync(path.join(here, 'sandbox-'))
const dl = path.join(home, 'dl')
fs.mkdirSync(dl)
// what Axive Free 1.0 left: two tunnels, a ledger line
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({folder: dl, askWhere: false, tunnels: 2, checkUpdates: false, openInTerminal: false}))
fs.writeFileSync(path.join(home, 'ledger.jsonl'), JSON.stringify({id: 'old1', at: Date.parse('2026-09-01T10:00:00Z'), url: 'https://example.com/v', title: 'A draw from Axive Free 1.0', site: 'generic', filepath: path.join(dl, 'gone.mp4'), vessel: 'best'}) + '\n')

let pass = 0, fail = 0
const check = (name, ok, detail = '') => (ok ? pass++ : fail++, console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  · ${detail}` : ''}`))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (what, ms, step = 500) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await what()
    if (v) return v
    await sleep(step)
  }
  return undefined
}

// a 40 MB file with ranges, a little slow per connection so many connections matter
const blob = crypto.randomBytes(40 * 1024 * 1024)
const blobSha = crypto.createHash('sha256').update(blob).digest('hex')
const files = http.createServer((req, res) => {
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '')
  const start = m ? Number(m[1]) : 0
  const end = m && m[2] ? Number(m[2]) : blob.length - 1
  res.writeHead(m ? 206 : 200, {'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(m ? {'Content-Range': `bytes ${start}-${end}/${blob.length}`} : {})})
  if (req.method === 'HEAD') return res.end()
  let at = start
  // the one to cancel crawls, so it is still running when cancelled
  const slow = req.url.includes('cancel')
  // the next piece waits for the last one to leave (a 256 KB write never returns true)
  const pump = () => {
    if (at > end) return res.end()
    const next = Math.min(end + 1, at + 64 * 1024)
    const chunk = blob.subarray(at, next)
    at = next
    res.write(chunk, () => setTimeout(pump, slow ? 250 : 10))
  }
  req.on('close', () => (at = end + 1))
  pump()
})
await new Promise(r => files.listen(0, '127.0.0.1', r))
const fileUrl = `http://127.0.0.1:${files.address().port}/free-test.bin`

const env = {...process.env, AXIVE_HOME: home, AXIVE_NO_ELEVATE: '1', AXIVE_GUI_NO_WINDOW: '1'}
const child = spawn(exe, ['--gui'], {cwd: home, env, stdio: ['ignore', 'pipe', 'pipe']})
let childExit
child.on('exit', code => (childExit = code ?? -1))
const url = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('the window server did not start')), 240_000)
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', c => {
    const m = /http:\/\/127\.0\.0\.1:\d+\/\?k=[\w-]+/.exec(c)
    if (m) (clearTimeout(timer), resolve(m[0]))
  })
  child.on('exit', code => reject(new Error(`exited ${code}`)))
})
const origin = new URL(url).origin
check('server: refuses a request without the key', (await fetch(`${origin}/api/state`).then(r => r.status)) === 403)
check('server: refuses another origin', (await fetch(`${origin}/api/state`, {headers: {Origin: 'https://evil.example'}}).then(r => r.status)) === 403)

const browser = await chromium.launch({channel: 'msedge', headless: true})
const page = await browser.newPage({viewport: {width: 1280, height: 640}})
const errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
const axeSource = fs.readFileSync(path.join(here, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8')
const axe = async name => {
  const v = await page.evaluate(async src => {
    if (!window.axe) (0, eval)(src)
    const r = await window.axe.run(document, {runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']})
    return r.violations.map(x => `${x.id}(${x.nodes.length}: ${x.nodes[0].target.join(' ')} ${x.nodes[0].any[0]?.message ?? ''})`)
  }, axeSource)
  check(`axe WCAG 2.1 AA: ${name}`, v.length === 0, v.join(' '))
}
const shot = async name => shots && page.screenshot({path: path.join(shots, `${name}.png`)})
/** a route, called the way the page calls it (its cookie, X-Axive, JSON) */
const call = (route, body = {}) =>
  page.evaluate(
    async ([r, b]) => {
      const res = await fetch(`/api/${r}`, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Axive': '1'}, body: JSON.stringify(b)})
      return {status: res.status, body: await res.json().catch(() => ({}))}
    },
    [route, body],
  )
const state = () => page.evaluate(() => fetch('/api/state').then(r => r.json()))

try {
  await page.goto(url)
  await page.waitForSelector('nav.rail', {timeout: 30000})
  check('page: paints its rail and draw bar', await page.locator('.offer-bar input').isVisible())
  check('page: titled Axive Free', (await page.title()) === 'Axive Free', await page.title())
  const rail = (await page.locator('nav.rail').innerText()).toLowerCase()
  check('rail: names Axive Free and its version', /axive free 1\.\d+\.\d+/.test(rail), rail.split('\n').slice(-2).join(' '))
  const absent = ['queues', 'vigils', 'phone', 'browser extension', 'temporary files', 'slow mode'].filter(w => rail.includes(w))
  check('rail: no Axive-only door', absent.length === 0, absent.join(', '))
  // the draw bar's examples turn every 3.6 s: none may promise what Free leaves to Axive
  const examples = new Set()
  for (let i = 0; i < 4; i++) (examples.add(await page.locator('.offer-bar input').getAttribute('placeholder')), await sleep(3700))
  const promised = [...examples].filter(e => /playlist|spotify|magnet|torrent|search|several links/i.test(e ?? ''))
  check('draw bar: its examples are all Free can do', examples.size >= 2 && promised.length === 0, [...examples].join(' | '))
  // the rows fade in (the motion layer): judge them once they rest
  await sleep(2500)
  await axe('the list')
  await shot('list-empty')

  // what Axive Free 1.0 left behind
  const s0 = await state()
  check('upgrade: 1.0 settings kept (2 tunnels, its folder)', s0.config?.tunnels === 2 && path.resolve(s0.config?.folder ?? '') === dl, `tunnels ${s0.config?.tunnels}`)
  await call('config', {patch: {tunnels: 3}})
  check('settings: 3 tunnels allowed', (await state()).config?.tunnels === 3)
  await call('config', {patch: {tunnels: 4}})
  check('settings: 4 tunnels refused', (await state()).config?.tunnels !== 4, `now ${(await state()).config?.tunnels}`)

  // Axive's doors, met in Free
  const refused = async (name, route, body, re = /axive\.xyz/) => {
    const r = await call(route, body)
    check(`refused plainly: ${name}`, r.status === 422 && re.test(r.body.error ?? ''), r.body.error ?? r.status)
  }
  await refused('a magnet', 'offer', {text: 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c'})
  await refused('a Spotify link', 'offer', {text: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'})
  await refused('two links at once', 'offer', {text: 'https://example.com/a.zip https://example.com/b.zip'})
  await refused('a search by words', 'offer', {text: 'some words to search'})
  await refused('a vigil (no such door)', 'vigil-add', {url: 'https://www.youtube.com/@x'})
  await refused('the phone (no such door)', 'phone', {on: true})
  await refused('a torrent to the download manager', 'fetch-add', {text: 'https://example.com/x.torrent'})

  // the ledger from 1.0, and Free's other doors
  await page.keyboard.press('Control+3').catch(() => {})
  await sleep(800)
  const ledger = await page.locator('main').innerText().catch(() => '')
  check('ledger: the 1.0 draw is listed', ledger.includes('A draw from Axive Free 1.0'))
  await axe('the ledger')
  await page.keyboard.press('Control+Comma')
  await sleep(800)
  const settings = (await page.locator('main').innerText()).toLowerCase()
  check('settings: no language picker, no phone, no notifications', !/dutch|nederlands|phone|telegram|discord/.test(settings))
  await axe('settings')
  await shot('settings')
  const axiveDoor = page.locator('nav.rail').getByText('Axive', {exact: true})
  if (await axiveDoor.count()) {
    await axiveDoor.first().click()
    await sleep(800)
    const what = (await page.locator('main').innerText()).toLowerCase()
    check('the Axive door: says what Axive adds, plainly', what.includes('playlists') && what.includes('torrents') && what.includes('axive.xyz'))
    await axe('the Axive door')
    await shot('axive')
  } else check('the Axive door: on the rail', false)

  // a real file, 16 connections, hash checked
  await page.keyboard.press('Control+1').catch(() => {})
  const added = await call('fetch-add', {text: fileUrl})
  check('download manager: takes a file link', added.status === 200, JSON.stringify(added.body))
  const got = await until(async () => {
    const f = (await state()).fetch?.items?.[0]
    return f && f.state === 'done' ? f : undefined
  }, 120_000)
  const saved = path.join(dl, 'free-test.bin')
  check('download manager: the file arrives whole', !!got && fs.existsSync(saved) && crypto.createHash('sha256').update(fs.readFileSync(saved)).digest('hex') === blobSha, got ? `${got.connections ?? '?'} connections` : 'not complete')
  // a second one, cancelled at once: nothing of it stays
  await call('fetch-add', {text: fileUrl.replace('free-test', 'free-cancel')})
  await sleep(1500)
  const live = (await state()).fetch?.items?.find(f => /free-cancel/.test(f.name ?? f.target ?? f.uri ?? ''))
  if (live) await call('fetch', {gid: live.gid, op: 'cancel'})
  await sleep(1500)
  check('download manager: a cancel leaves no file behind', !!live && !fs.existsSync(path.join(dl, 'free-cancel.bin')) && !fs.existsSync(path.join(dl, 'free-cancel.bin.aria2')), `${live ? live.state + ' ' + live.name : 'not seen: ' + JSON.stringify(((await state()).fetch?.items ?? []).map(x => [x.name, x.state]))} · left: ${fs.readdirSync(dl).filter(n => n.includes('cancel')).join(', ') || 'nothing'}`)

  // a real video with several audio tracks, drawn in German
  if (net) {
    const offered = await call('offer', {text: 'https://www.youtube.com/watch?v=0e3GPea1Tyg'})
    const tracks = offered.body.audioTracks ?? []
    check('audio tracks: offered for a dubbed video', offered.status === 200 && tracks.length > 3, `${tracks.length} tracks`)
    // Big Buck Bunny (Blender Foundation, CC BY 3.0): 4K, and the picture the README shows
    const big = await call('offer', {text: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'})
    const top = Math.max(...(big.body.choices ?? []).map(c => c.height ?? 0))
    check('quality: no 1080p cap in Free (a 4K video)', top > 1080, `best ${top}p`)
    const german = tracks.find(t => t.id === 'de')
    const m4a = (offered.body.choices ?? []).findIndex(c => /m4a/.test(c.label))
    const drawn = german && m4a >= 0 ? await call('draw', {id: offered.body.id, choice: m4a, audioTrack: 'de'}) : {status: 0, body: {}}
    check('audio tracks: a German draw starts', drawn.status === 200 && !!drawn.body.job, JSON.stringify(drawn.body))
    const file = await until(() => fs.readdirSync(dl).find(f => /\[de\]\.m4a$/.test(f)), 300_000, 2000)
    const job = await until(async () => {
      const j = ((await state()).jobs ?? []).find(x => x.id === drawn.body.job)
      return j && ['done', 'failed', 'cancelled'].includes(j.state) ? j : undefined
    }, 300_000, 2000)
    check('audio tracks: the file is named for its track', !!file && job?.state === 'done', file ?? job?.state)
    if (file) {
      // yt-dlp writes the drawn track's language into the file: ffprobe reads it back
      // (every m4a track of this video has the same size, so size cannot tell them apart)
      const probeExe = path.join(home, 'bin', 'ffmpeg', 'ffprobe.exe')
      let lang = ''
      try {
        lang = execFileSync(probeExe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream_tags=language', '-of', 'default=nw=1:nk=1', path.join(dl, file)], {encoding: 'utf8'}).trim()
      } catch (error) {
        lang = 'ffprobe: ' + error.message.split('\n')[0]
      }
      check('audio tracks: ffprobe reads German in the file', /^(ger|deu|de)$/.test(lang), lang || 'no language tag')
    }
    if (shots) {
      // the README's picture holds an open movie, not someone's channel
      await call('job', {id: drawn.body.job, op: 'remove'})
      const ledgerRows = (await state()).ledger ?? []
      await call('list-hide', {ids: ['old1', ...(Array.isArray(ledgerRows) ? ledgerRows : ledgerRows.items ?? []).filter(l => /Squid/.test(l.title ?? '')).map(l => l.id)]})
      const bunny = await call('draw', {id: big.body.id, choice: (big.body.choices ?? []).findIndex(c => /m4a/.test(c.label))})
      await until(async () => ((await state()).jobs ?? []).find(x => x.id === bunny.body.job && x.state === 'done'), 300_000, 2000)
    }
  }
  await page.keyboard.press('Control+1').catch(() => {})
  await sleep(800)
  await shot('window')
  check('page: no script errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (error) {
  check('the run', false, error.stack?.split('\n').slice(0, 3).join(' '))
} finally {
  await browser.close().catch(() => {})
}

// the terminal door takes over from the window
try {
  const ptyPath = createRequire(path.join(here, '..', 'exe-ui-test', 'package.json')).resolve('@lydell/node-pty')
  const pty = await import('file://' + ptyPath.replace(/\\/g, '/'))
  const term = (pty.default ?? pty).spawn(exe, ['--tui', '--in-terminal'], {name: 'xterm-256color', cols: 140, rows: 46, cwd: home, env})
  let screen = ''
  term.onData(d => (screen += d))
  const gone = await until(() => childExit !== undefined, 30_000)
  check('handover: the window steps aside for the terminal', !!gone && childExit === 0, `exit ${childExit}`)
  const lock = await until(() => {
    try {
      const l = JSON.parse(fs.readFileSync(path.join(home, 'axive.lock'), 'utf8'))
      return l.kind === 'tui' ? l : undefined
    } catch {
      return undefined
    }
  }, 30_000)
  check('handover: the terminal holds Axive Free', !!lock && screen.length > 0)
  term.kill()
  await sleep(1500)
} catch (error) {
  check('handover', false, error.message)
}

if (childExit === undefined) child.kill()
files.close()
await sleep(1500)
fs.rmSync(home, {recursive: true, force: true, maxRetries: 10, retryDelay: 500})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
