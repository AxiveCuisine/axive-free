import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const ownHome = !process.env.AXIVE_HOME
process.env.AXIVE_HOME ??= path.join(os.tmpdir(), `axive-probe-test-${process.pid}`)
test.after(() => ownHome && fs.rmSync(process.env.AXIVE_HOME!, {recursive: true, force: true}))
const {DuplicateError, duplicatePlan, filenameFromDisposition, probeLink, safeFileName, uniqueName} = await import('./probe.js')

test('names from Content-Disposition, filename* first', () => {
  assert.equal(filenameFromDisposition('attachment; filename="report.pdf"'), 'report.pdf')
  assert.equal(filenameFromDisposition("attachment; filename=plain.zip; filename*=UTF-8''caf%C3%A9%20menu.zip"), 'café menu.zip')
  assert.equal(filenameFromDisposition('inline'), undefined)
  assert.equal(filenameFromDisposition(null), undefined)
})

test('a name Windows can keep', () => {
  assert.equal(safeFileName('a/b\\c:d*e?.zip'), 'a_b_c_d_e_.zip')
  assert.equal(safeFileName('..\\..\\evil.exe'), '_.._evil.exe')
  assert.equal(safeFileName('CON.txt'), '_CON.txt')
  assert.equal(safeFileName('   '), 'file')
  assert.equal(safeFileName('name. '), 'name')
})

test('duplicates: a number, a replace, a skip or a question; a partial with its control file carries on', () => {
  const files = new Set(['D:/dl/a.zip', 'D:/dl/a (2).zip', 'D:/dl/part.iso', 'D:/dl/part.iso.aria2'].map(f => path.join(f)))
  const exists = (f: string) => files.has(path.join(f))
  assert.deepEqual(duplicatePlan('D:/dl', 'new.zip', 'skip', exists), {out: 'new.zip'})
  assert.deepEqual(duplicatePlan('D:/dl', 'a.zip', 'number', exists), {out: 'a (3).zip'})
  assert.deepEqual(duplicatePlan('D:/dl', 'a.zip', 'overwrite', exists), {out: 'a.zip', overwrite: true})
  assert.throws(() => duplicatePlan('D:/dl', 'a.zip', 'skip', exists), (e: unknown) => e instanceof DuplicateError && e.choice === 'skip' && e.code === 'duplicate' && e.file === 'a.zip')
  assert.throws(() => duplicatePlan('D:/dl', 'a.zip', 'ask', exists), /already rests there/)
  assert.deepEqual(duplicatePlan('D:/dl', 'part.iso', 'ask', exists), {out: 'part.iso'})
  assert.equal(uniqueName('D:/dl', 'noext', f => path.basename(f) === 'noext'), 'noext (2)')
})

test('a probe reads size, resumability, name and type, through a redirect that drops the cookie', async () => {
  const seen: {url: string; cookie?: string}[] = []
  const server = http.createServer((req, res) => {
    seen.push({url: req.url!, cookie: req.headers.cookie})
    if (req.url === '/go') {
      res.writeHead(302, {Location: `http://localhost:${(server.address() as AddressInfo).port}/file`})
      return res.end()
    }
    if (req.url === '/head-broken' && req.method === 'HEAD') {
      res.writeHead(405)
      return res.end()
    }
    const size = 5000
    const headers: Record<string, string | number> = {'Content-Type': 'application/zip; charset=binary', 'Accept-Ranges': 'bytes', 'Content-Disposition': 'attachment; filename="Tool Setup.zip"'}
    if (req.headers.range) {
      res.writeHead(206, {...headers, 'Content-Range': `bytes 0-0/${size}`, 'Content-Length': 1})
      return res.end('x')
    }
    res.writeHead(200, {...headers, 'Content-Length': size})
    res.end(req.method === 'HEAD' ? undefined : Buffer.alloc(size))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  try {
    const p = await probeLink(`http://127.0.0.1:${port}/go`, {Cookie: 'session=secret'})
    assert.equal(p.size, 5000)
    assert.equal(p.resumable, true)
    assert.equal(p.filename, 'Tool Setup.zip')
    assert.equal(p.mime, 'application/zip')
    assert.equal(p.category, 'compressed')
    assert.match(p.finalUrl, /localhost:\d+\/file$/)
    assert.ok(seen.filter(s => s.url === '/go').every(s => s.cookie === 'session=secret'), 'the first host gets the cookie')
    assert.ok(seen.filter(s => s.url === '/file').every(s => s.cookie === undefined), 'another host (localhost vs 127.0.0.1) never does')
    const q = await probeLink(`http://127.0.0.1:${port}/head-broken`)
    assert.equal(q.resumable, true, 'a server that refuses HEAD still answers the ranged GET')
    assert.equal(q.size, 5000)
    await assert.rejects(probeLink('http://127.0.0.1:1/nothing-listens'), /could not be reached/)
    await assert.rejects(probeLink('file:///C:/Windows/win.ini'), /could not be reached/)
  } finally {
    server.close()
  }
})
