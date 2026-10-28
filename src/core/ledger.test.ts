import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'axive-ledger-'))
process.env.AXIVE_HOME = sandbox
const {migrateFromShefa} = await import('./ledger.js')
const {paths} = await import('./paths.js')

test.after(() => fs.rmSync(sandbox, {recursive: true, force: true}))

test('a sandbox (AXIVE_HOME) never inherits Shefa history or cookies', () => {
  // whether or not ~/.shefa exists on this machine, a sandbox must stay clean
  assert.equal(migrateFromShefa(), false)
  assert.equal(fs.existsSync(paths.inputs), false)
  assert.equal(fs.existsSync(paths.cookies), false)
})

test('an export names files but never their folders, and carries no cookies', async () => {
  const {exportLedger, record} = await import('./ledger.js')
  record({url: 'https://example.com/tool.zip', title: 'tool.zip', filepath: path.join(os.homedir(), 'Downloads', 'tool.zip'), size: 10, vessel: 'file', category: 'compressed'})
  record({url: 'C:/not/a/link.mp4', title: 'a local convert', vessel: 'convert'})
  const text = exportLedger([{url: 'magnet:?xt=urn:btih:abc', name: 'bbb', kind: 'fetch', state: 'paused'}])
  const file = JSON.parse(text)
  assert.equal(file.app, 'axive')
  assert.deepEqual(file.items.map((i: {url: string}) => i.url), ['magnet:?xt=urn:btih:abc', 'https://example.com/tool.zip'])
  assert.equal(file.items[1].name, 'tool.zip')
  assert.equal(file.items[1].category, 'compressed')
  assert.ok(!text.includes(os.homedir()) && !text.includes(os.homedir().replace(/\\/g, '\\\\')), 'no home folder in the export')
})

test('imports: our own export, other lists, plain text; junk and repeats dropped', async () => {
  const {exportLedger, importLinks} = await import('./ledger.js')
  const ours = importLinks(exportLedger())
  assert.ok(ours.links.some(l => l.url === 'https://example.com/tool.zip' && l.kind === 'fetch'))
  const other = importLinks(JSON.stringify([{link: 'https://a.example/x.iso', fileName: 'x.iso'}, {url: 'javascript:alert(1)'}, 'https://a.example/x.iso', 'ftp://m.example/f.gz']))
  assert.deepEqual(other.links.map(l => l.url), ['https://a.example/x.iso', 'ftp://m.example/f.gz'])
  assert.equal(other.links[0]!.name, 'x.iso')
  assert.equal(other.skipped, 2)
  const text = importLinks('# my list\nhttps://b.example/1.zip\r\n\nfile:///C:/Windows/win.ini\nhttps://b.example/2.zip')
  assert.deepEqual(text.links.map(l => l.url), ['https://b.example/1.zip', 'https://b.example/2.zip'])
  assert.equal(importLinks({downloads: [{url: 'https://c.example/a.bin'}]}).links.length, 1)
  assert.equal(importLinks(42).links.length, 0)
})
