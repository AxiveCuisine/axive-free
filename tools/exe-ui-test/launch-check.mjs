// The launch check in the real exe: tamper with a tool in a sandbox data folder, open the
// terminal app normally (ConPTY), and expect the tool restored and the log to say so.
//   node launch-check.mjs <abs Axive-Free.exe> <abs sandbox data folder, already unpacked>
import fs from 'node:fs'
import path from 'node:path'
import pty from '@lydell/node-pty'

const [exe, home] = process.argv.slice(2)
const bin = path.join(home, 'bin')
const ffmpegDir = path.join(bin, 'ffmpeg')
// a fresh folder: one ordinary first launch unpacks everything and records the payload
const installed = path.join(bin, 'installed.json')
const setUp = () => fs.existsSync(installed) && Boolean(JSON.parse(fs.readFileSync(installed, 'utf8')).payload)
if (!setUp()) {
  const first = pty.spawn(exe, ['--in-terminal'], {cols: 140, rows: 46, env: {...process.env, AXIVE_HOME: home}})
  first.onData(() => {})
  for (let i = 0; i < 120 && !setUp(); i++) await new Promise(r => setTimeout(r, 1000))
  await new Promise(r => setTimeout(r, 3000))
  first.kill()
  await new Promise(r => setTimeout(r, 2000))
  if (!setUp()) throw new Error('the first launch did not finish unpacking')
}
const dll = fs.readdirSync(ffmpegDir).find(n => n.endsWith('.dll'))
const target = path.join(ffmpegDir, dll)
const before = fs.readFileSync(target)
fs.appendFileSync(target, 'x')
fs.writeFileSync(path.join(ffmpegDir, 'planted.dll'), 'planted')
const log = path.join(home, 'logs', 'axive.log')
const logBefore = fs.existsSync(log) ? fs.statSync(log).size : 0

const child = pty.spawn(exe, ['--in-terminal'], {cols: 140, rows: 46, env: {...process.env, AXIVE_HOME: home}})
child.onData(() => {})
const deadline = Date.now() + 60_000
let restored = false
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 1000))
  const now = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0)
  if (now.equals(before) && !fs.existsSync(path.join(ffmpegDir, 'planted.dll'))) {
    restored = true
    break
  }
}
await new Promise(r => setTimeout(r, 8000))
child.kill()
await new Promise(r => setTimeout(r, 1500))
const added = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').slice(logBefore) : ''
const results = [
  ['altered dll restored on a normal launch', restored],
  ['planted file removed', !fs.existsSync(path.join(ffmpegDir, 'planted.dll'))],
  ['log names the failed check', /tools failed their check: ffmpeg \(altered\)/.test(added)],
  ['log confirms the restore', /tools restored and verified/.test(added)],
  ['no crash', !/crash:/.test(added)],
]
for (const [name, ok] of results) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
process.exit(results.every(([, ok]) => ok) ? 0 : 1)
