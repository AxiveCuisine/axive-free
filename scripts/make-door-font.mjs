// Turns the window's Cormorant SC 500 (OFL, WOFF2) into the TrueType file the
// window's door embeds (GDI+ reads TTF, not WOFF2): build\door-font.ttf.
//   node scripts/make-door-font.mjs
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'

const root = path.resolve(import.meta.dirname, '..')
const tooling = path.join(root, 'build', 'tooling')
if (!fs.existsSync(path.join(tooling, 'node_modules', 'wawoff2'))) {
  fs.mkdirSync(tooling, {recursive: true})
  if (!fs.existsSync(path.join(tooling, 'package.json'))) fs.writeFileSync(path.join(tooling, 'package.json'), '{"private":true}')
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', 'wawoff2@2.0.1', '--no-audit', '--no-fund'], {cwd: tooling, stdio: 'inherit', shell: process.platform === 'win32'})
}
const wawoff2 = createRequire(path.join(tooling, 'package.json'))('wawoff2')
const ttf = await wawoff2.decompress(fs.readFileSync(path.join(root, 'gui', 'fonts', 'cormorant-sc-500.woff2')))
fs.writeFileSync(path.join(root, 'build', 'door-font.ttf'), Buffer.from(ttf))
console.log(`door font: ${ttf.length} bytes`)
