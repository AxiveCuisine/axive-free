// Captures the README's screenshots from the real Axive-Free.exe: raw frames
// (.ansi) of each screen, turned into HTML by scripts/frame-to-html.mjs and
// photographed by Edge (headless). Nothing on the screens is mocked.
//   node shots.mjs <Axive-Free.exe> <out dir>
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import pty from '@lydell/node-pty'
import stringWidth from 'string-width'

const [exe, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, {recursive: true})
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'axive-free-shots-'))
const dl = path.join(home, 'Downloads')
fs.mkdirSync(dl)
const frameFile = path.join(home, 'frame.txt')
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({folder: dl, askWhere: false, animations: false, checkUpdates: false, openInTerminal: false}))

// a large file served from this PC at about 1.5 MB/s a connection, so the download manager has something to show
const SIZE = 3 * 1024 * 1024 * 1024
const server = http.createServer((req, res) => {
  if (req.url !== '/dataset-2026.zip') return res.writeHead(404).end()
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
  let start = 0
  let end = SIZE - 1
  if (m && m[1]) (start = Number(m[1])), (end = m[2] ? Math.min(Number(m[2]), SIZE - 1) : SIZE - 1)
  res.writeHead(m ? 206 : 200, {'Content-Type': 'application/zip', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(m ? {'Content-Range': `bytes ${start}-${end}/${SIZE}`} : {})})
  if (req.method === 'HEAD') return res.end()
  const chunk = Buffer.alloc(64 * 1024, 7)
  let at = start
  const tick = setInterval(() => {
    if (res.destroyed || at > end) return clearInterval(tick), res.end()
    res.write(chunk)
    at += chunk.length
  }, 40)
  req.on('close', () => clearInterval(tick))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const FILE_URL = `http://127.0.0.1:${server.address().port}/dataset-2026.zip`

const COLS = 124
const ROWS = 36
const term = pty.spawn(exe, ['--in-terminal'], {name: 'xterm-256color', cols: COLS, rows: ROWS, cwd: home, env: {...process.env, USERPROFILE: home, AXIVE_HOME: home, AXIVE_FRAME_DUMP: frameFile, WT_SESSION: 'shots'}})
term.onData(() => {})
const sleep = ms => new Promise(r => setTimeout(r, ms))
const frame = () => (fs.existsSync(frameFile) ? fs.readFileSync(frameFile, 'utf8') : '')
async function waitFor(pred, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const f = frame()
    if (typeof pred === 'string' ? f.toLowerCase().includes(pred.toLowerCase()) : pred(f)) return true
    await sleep(150)
  }
  return false
}
async function click(label, nth = 0) {
  const lines = frame().split('\n')
  let seen = 0
  for (let row = 0; row < lines.length; row++) {
    for (let from = 0; ; ) {
      const i = lines[row].indexOf(label, from)
      if (i < 0) break
      if (seen++ === nth) {
        const col = stringWidth(lines[row].slice(0, i)) + Math.ceil(stringWidth(label) / 2)
        term.write(`\x1b[<0;${col};${row + 1}M`)
        await sleep(40)
        term.write(`\x1b[<0;${col};${row + 1}m`)
        await sleep(300)
        return true
      }
      from = i + 1
    }
  }
  return false
}
const paste = async text => (term.write(`\x1b[200~${text}\x1b[201~`), await sleep(300))
const esc = async () => (term.write('\x1b'), await sleep(400))
const atHome = f => f.includes('Offer a link') && f.includes('ctrl+d download manager')
const backHome = async () => {
  for (let i = 0; i < 4 && !atHome(frame()); i++) await esc()
  await waitFor(atHome, 5000)
}
// park the mouse off every button, so no hover hint shows, then keep the frame
const shots = []
async function shot(name) {
  term.write(`\x1b[<35;${COLS};${ROWS - 1}M`)
  await sleep(1800)
  fs.copyFileSync(`${frameFile}.ansi`, path.join(outDir, `${name}.ansi`))
  shots.push(name)
  console.log(`caught ${name}`)
}

try {
  if (!(await waitFor(atHome, 240000))) throw new Error('home never appeared')
  await sleep(2500)
  await shot('home')

  await paste('https://www.youtube.com/watch?v=aqz-KE-bpKQ')
  term.write('\r')
  if (await waitFor(f => f.includes('Vessels') && /1080p/.test(f), 90000)) await shot('vessels')
  await backHome()

  term.write('\x04')
  await waitFor('Offer a file link', 8000)
  await paste(FILE_URL)
  term.write('\r')
  await waitFor('before it is added', 20000)
  term.write('\r')
  if (await waitFor(f => /16 connections/.test(f), 30000)) {
    await sleep(12000)
    await shot('download-manager')
  }
  await click('pause')
  await backHome()

  await click('Axive')
  if (await waitFor('free · axive', 8000)) await shot('axive')
  await backHome()

  await click('settings')
  if (await waitFor('renewal & tools', 8000)) await shot('settings')
  await backHome()
} catch (error) {
  console.error(error.message)
} finally {
  term.write('\x03')
  await sleep(2500)
  try {
    term.kill()
  } catch {}
  process.on('uncaughtException', () => {})
  await sleep(2000)
  server.close()
  fs.rmSync(home, {recursive: true, force: true, maxRetries: 10, retryDelay: 400})
}

// HTML, then a PNG of each through Edge (headless), on the house's own black
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p))
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'axive-free-edge-'))
for (const name of shots) {
  const ansi = path.join(outDir, `${name}.ansi`)
  const html = path.join(outDir, `${name}.html`)
  execFileSync(process.execPath, [path.join(import.meta.dirname, '..', '..', 'scripts', 'frame-to-html.mjs'), ansi, html])
  fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('html,body{margin:0;background:transparent}', 'html,body{margin:0;background:#0b0a0d}').replace('margin:36px', 'margin:28px'))
  const png = path.join(outDir, `${name}.png`)
  execFileSync(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${profile}`, '--force-device-scale-factor=1', `--window-size=1228,${ROWS * 20 + 92}`, `--screenshot=${png}`, pathToFileURL(html).href], {stdio: 'ignore'})
  fs.rmSync(ansi)
  fs.rmSync(html)
  console.log(`wrote ${png}`)
}
fs.rmSync(profile, {recursive: true, force: true, maxRetries: 10, retryDelay: 400})
process.exit(0)
