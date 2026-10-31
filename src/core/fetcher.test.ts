import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const ownHome = !process.env.AXIVE_HOME
process.env.AXIVE_HOME ??= path.join(os.tmpdir(), `axive-fetch-test-${process.pid}`)
// the sandbox data folder goes with the run (storage is limited)
test.after(() => ownHome && fs.rmSync(process.env.AXIVE_HOME!, {recursive: true, force: true}))
const {engineArgs, enrich, etaFrom, fetchKind, friendlyError, isMagnet, itemFrom, looksLikeHtml, MASQUERADE_WARNING, masqueradeExt, nextConnections, relinkTarget, carriedForRelink, removeWhenFree, smoothSpeed} = await import('./fetcher.js')

test('a server that refuses parallel streams gets 4, then 2, then 1, then the failure is shown', () => {
  assert.equal(nextConnections('22', 0), 4)
  assert.equal(nextConnections('22', 1), 2)
  assert.equal(nextConnections('22', 2), 1)
  assert.equal(nextConnections('22', 3), undefined)
  assert.equal(nextConnections('3', 0), undefined, 'a 404 is not retried')
  assert.equal(nextConnections('9', 0), undefined, 'a full disk is not retried')
})

test('fetchKind sends files to the download manager, media to yt-dlp; torrents and magnets to neither', () => {
  assert.equal(fetchKind('magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny'), undefined)
  assert.equal(fetchKind('https://example.com/files/ubuntu-24.04-desktop-amd64.iso'), 'file')
  assert.equal(fetchKind('https://example.com/a/setup.exe?token=1'), 'file')
  assert.equal(fetchKind('https://example.com/some%20archive.7z'), 'file')
  assert.equal(fetchKind('ftp://mirror.example.org/pub/tool.tar.gz'), 'file')
  assert.equal(fetchKind('https://example.com/ubuntu.torrent'), undefined)
  assert.equal(fetchKind('https://www.youtube.com/watch?v=jNQXAC9IVRw'), undefined)
  assert.equal(fetchKind('https://example.com/clip.mp4', false), undefined)
  // a video or audio file itself: many connections in the download manager
  assert.equal(fetchKind('https://example.com/clip.mp4', true), 'file')
  assert.equal(fetchKind('https://cdn.example.com/a/b/track.FLAC?sig=1', true), 'file')
  // playlists and pages stay with yt-dlp
  assert.equal(fetchKind('https://example.com/live/master.m3u8', true), undefined)
  assert.equal(fetchKind('https://example.com/watch/mp4', true), undefined)
  assert.equal(fetchKind('https://example.com/'), undefined)
  assert.equal(fetchKind('javascript:alert(1)'), undefined)
  assert.equal(fetchKind('not a link'), undefined)
})

test('isMagnet needs a real BitTorrent info hash', () => {
  assert.equal(isMagnet('magnet:?dn=x&xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c'), true)
  assert.equal(isMagnet('magnet:?xt=urn:btmh:1220abcdef'), true)
  assert.equal(isMagnet('magnet:?dn=nothing'), false)
  assert.equal(isMagnet('https://magnet.example/'), false)
})

test('the engine listens on localhost only, behind its secret, and dies with Axive', () => {
  const args = engineArgs(6800, 's3cret', 'C:/x/session.txt', 'C:/Downloads')
  assert.ok(args.includes('--rpc-listen-all=false'))
  assert.ok(args.includes('--rpc-allow-origin-all=false'))
  assert.ok(args.includes('--rpc-secret=s3cret'))
  assert.ok(args.includes('--no-conf=true'), 'a stray aria2.conf on the PC must not change behaviour')
  assert.ok(args.includes(`--stop-with-process=${process.pid}`))
  assert.ok(args.includes('--enable-dht=false'), 'Free never joins a swarm')
  assert.ok(args.includes('--follow-torrent=false'), 'a .torrent behind a link is saved, never followed')
  assert.ok(args.some(a => a === '--split=16'))
})

test('a magnet or a .torrent is refused with a word about Axive', async () => {
  const {addLink, isTorrent, TORRENTS_ARE_AXIVE} = await import('./fetcher.js')
  assert.equal(isTorrent('magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c'), true)
  assert.equal(isTorrent('https://example.com/a%20b.torrent?x=1'), true)
  assert.equal(isTorrent('https://example.com/a.zip'), false)
  await assert.rejects(addLink('magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c'), new RegExp(TORRENTS_ARE_AXIVE.slice(0, 20)))
})

test('itemFrom reads a plain file download', () => {
  const item = itemFrom({
    gid: 'a1',
    status: 'active',
    totalLength: '1000',
    completedLength: '250',
    downloadSpeed: '500',
    uploadSpeed: '0',
    connections: '16',
    dir: 'C:/Downloads',
    files: [{path: 'C:/Downloads/tool.zip', length: '1000', completedLength: '250', selected: 'true', uris: [{uri: 'https://example.com/tool.zip'}]}],
  })
  assert.equal(item.kind, 'file')
  assert.equal(item.name, 'tool.zip')
  assert.equal(item.state, 'active')
  assert.equal(item.connections, 16)
  assert.equal(item.target, 'C:/Downloads/tool.zip')
})

test('aria2 failures read as plain words', () => {
  assert.match(friendlyError('3'), /404/)
  assert.match(friendlyError('9'), /disk space/)
  assert.equal(friendlyError(undefined, 'weird'), 'weird')
})

test('a cancelled fetch leaves nothing behind: the file and its control file go, missing ones are fine', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axive-cancel-'))
  const file = path.join(dir, 'big.bin')
  fs.writeFileSync(file, 'partial')
  fs.writeFileSync(`${file}.aria2`, 'control')
  const left = await removeWhenFree([file, `${file}.aria2`, path.join(dir, 'never-made.bin')], 3)
  assert.deepEqual(left, [])
  assert.deepEqual(fs.readdirSync(dir), [])
  fs.rmSync(dir, {recursive: true, force: true})
})

test('the smoothed speed seeds on the first sample and forgets about 63 % of the past per 3 s', () => {
  assert.equal(smoothSpeed(undefined, 5000, 1000), 5000)
  const after = smoothSpeed(0, 1000, 3000)
  assert.ok(Math.abs(after - 1000 * (1 - Math.exp(-1))) < 1e-9)
  // a one-second spike barely moves it
  assert.ok(smoothSpeed(1000, 10_000, 1000) < 4000)
  assert.equal(etaFrom(10_240, 1024), 10)
  assert.equal(etaFrom(10_240, 100), undefined, 'under 1 KB/s there is no honest time left')
  assert.equal(etaFrom(0, 5000), undefined)
})

test('a web page saved under a binary name is recognised, and only then', () => {
  const bytes = (s: string) => new TextEncoder().encode(s)
  assert.equal(looksLikeHtml(bytes('<!DOCTYPE html><html><head>')), true)
  assert.equal(looksLikeHtml(bytes('\n\r\t  <html lang="en">')), true)
  assert.equal(looksLikeHtml(Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes('<!doctype html>')])), true, 'after a BOM')
  assert.equal(looksLikeHtml(bytes('<?xml version="1.0"?>\n<html xmlns="http://www.w3.org/1999/xhtml">')), true)
  assert.equal(looksLikeHtml(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0])), false, 'a real zip')
  assert.equal(looksLikeHtml(bytes('MZ\x90\x00')), false, 'a real exe')
  assert.equal(looksLikeHtml(bytes('<htmlish>')), false)
  assert.equal(looksLikeHtml(new Uint8Array(0)), false)
  assert.equal(masqueradeExt('tool.zip'), true)
  assert.equal(masqueradeExt('Setup.EXE'), true)
  assert.equal(masqueradeExt('clip.mp4'), false, 'media is yt-dlp business')
  assert.equal(masqueradeExt('notes.txt'), false, 'a text file may well be a page')
})

test('a finished file that came back as a web page is flagged, not deleted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axive-html-'))
  const file = path.join(dir, 'tool.zip')
  fs.writeFileSync(file, '<!doctype html><title>Sign in</title>')
  const status = {gid: 'h1', status: 'complete' as const, totalLength: '40', completedLength: '40', downloadSpeed: '0', uploadSpeed: '0', connections: '0', dir, files: [{path: file, length: '40', completedLength: '40', selected: 'true', uris: [{uri: 'https://example.com/tool.zip'}]}]}
  const item = enrich(itemFrom(status), status, Date.now())
  assert.equal(item.warning, MASQUERADE_WARNING)
  assert.ok(fs.existsSync(file))
  fs.rmSync(dir, {recursive: true, force: true})
})

test('an active file carries its piece map, edges and a steady speed', () => {
  const base = {gid: 'p1', status: 'active' as const, totalLength: '800', downloadSpeed: '2048', uploadSpeed: '0', connections: '2', numPieces: '8', pieceLength: '100', dir: 'C:/Downloads', files: [{path: 'C:/Downloads/a.iso', length: '800', completedLength: '0', selected: 'true'}]}
  const first = {...base, completedLength: '200', bitfield: '88'}
  const t0 = Date.now()
  const one = enrich(itemFrom(first), first, t0)
  assert.equal(one.map, '80008000')
  assert.deepEqual(one.edges, [1, 5], 'the first look places the connections where aria2 would have put them')
  assert.equal(one.smooth, 2048)
  const second = {...base, completedLength: '400', downloadSpeed: '4096', bitfield: 'cc'}
  const two = enrich(itemFrom(second), second, t0 + 1000)
  assert.equal(two.map, '88008800')
  assert.deepEqual(two.edges, [2, 6])
  assert.ok(two.smooth! > 2048 && two.smooth! < 4096)
  assert.ok(two.eta! > 0)
  assert.equal(two.pieces, 8)
})

test('headers for aria2 are checked: nothing can split a request, aria2 keeps its own', async () => {
  const {headerLines} = await import('./fetcher.js')
  assert.deepEqual(headerLines({headers: {Accept: '*/*', 'X-Token': 'a b'}, cookie: 'sid=1; t=2'}), ['Accept: */*', 'X-Token: a b', 'Cookie: sid=1; t=2'])
  assert.deepEqual(headerLines({headers: {Host: 'evil', Range: 'bytes=0-', Cookie: 'from=browser'}}), ['Cookie: from=browser'])
  assert.throws(() => headerLines({headers: {'X-A': 'one\r\nInjected: yes'}}), /header is not valid/)
  assert.throws(() => headerLines({headers: {'Bad Name': 'x'}}), /header is not valid/)
  assert.throws(() => headerLines({cookie: 'a=1\nb=2'}), /cookie is not valid/)
})

test('one add: what the call says reaches aria2, checked', async () => {
  const {addOptionsFor} = await import('./fetcher.js')
  const fromCall = addOptionsFor('https://dl.mirror.example/a.iso', {connections: 8, userAgent: 'Browser', referer: 'https://page.example/', cookie: 'k=v'})
  assert.equal(fromCall.split, '8')
  assert.equal(fromCall['max-connection-per-server'], '8')
  assert.equal(fromCall['user-agent'], 'Browser')
  assert.equal(fromCall.referer, 'https://page.example/')
  assert.deepEqual(fromCall.header, ['Cookie: k=v'])
  assert.deepEqual(addOptionsFor('https://elsewhere.example/a.iso', {}), {})
  assert.throws(() => addOptionsFor('https://x.example/a', {connections: 40}), /1 and 16/)
  assert.throws(() => addOptionsFor('https://x.example/a', {referer: 'javascript:x'}), /referer/)
})

test('climbing back: one connection per quiet minute, up to the ceiling; the verdict says why', async () => {
  const {climbStep, CLIMB_MS, rampVerdict} = await import('./fetcher.js')
  const ramp = {target: 16, current: 4, at: 0, climbed: false, refused: 16}
  assert.equal(climbStep(ramp, CLIMB_MS - 1), undefined)
  assert.equal(climbStep(ramp, CLIMB_MS), 5)
  assert.equal(climbStep(ramp, CLIMB_MS, false), undefined, 'the setting off: it stays')
  assert.equal(climbStep({...ramp, current: 7, ceiling: 7}, CLIMB_MS * 9), undefined, 'a refusal after a climb set a ceiling')
  assert.equal(climbStep({...ramp, current: 16}, CLIMB_MS * 9), undefined)
  assert.match(rampVerdict(ramp)!, /refused 16 connections; on 4 now, adding one back each minute/)
  assert.match(rampVerdict({...ramp, current: 7, ceiling: 7})!, /allows about 7 connections/)
  assert.equal(rampVerdict(undefined), undefined)
})

test('a held fetch reads as waiting, a fetch paused by hand stays paused', async () => {
  const {__test} = await import('./fetcher.js')
  const base = {gid: '0123456789abcdef', kind: 'file' as const, name: 'a.zip', state: 'paused' as const, total: 1, done: 0, speed: 0, upload: 0, connections: 0, dir: 'C:/d'}
  __test.setMeta('0123456789abcdef', {queueId: 'main', held: true, addedAt: 1})
  const held = __test.decorate({...base})
  assert.equal(held.state, 'waiting')
  assert.equal(held.held, true)
  assert.equal(held.queueId, 'main')
  __test.setMeta('0123456789abcdef', {userPaused: true, held: false})
  assert.equal(__test.decorate({...base}).state, 'paused')
  // an item from an older session, paused by aria2: a person paused it
  const old = __test.decorate({...base, gid: 'fedcba9876543210'})
  assert.equal(old.state, 'paused')
  assert.equal(__test.metaOf('fedcba9876543210')?.userPaused, true)
  assert.equal(old.category, 'compressed')
})

test('"open when done" never starts a program', async () => {
  const {openPlan} = await import('./fetcher.js')
  assert.equal(openPlan('C:/d/movie.mkv'), 'open')
  assert.equal(openPlan('C:/d/report.pdf'), 'open')
  assert.equal(openPlan('C:/d/setup.EXE'), 'show')
  assert.equal(openPlan('C:/d/run.ps1'), 'show')
  assert.equal(openPlan('C:/d/a.lnk'), 'show')
  assert.equal(openPlan('C:/d/tool.zip', MASQUERADE_WARNING), 'show', 'a web page in disguise is only shown')
})

test('the engine runs as many as Axive asks', async () => {
  const {ENGINE_SLOTS} = await import('./fetcher.js')
  const args = engineArgs(6800, 's', 'C:/x/s.txt', 'C:/d')
  assert.ok(args.includes(`--max-concurrent-downloads=${ENGINE_SLOTS}`))
  assert.ok(!args.some(a => a.startsWith('--max-overall-download-limit')), 'full speed: no limit')
})

test('a new link must be a web address', () => {
  assert.equal(relinkTarget(' https://example.com/fresh.zip?sig=1 '), 'https://example.com/fresh.zip?sig=1')
  assert.equal(relinkTarget('http://example.com/a.zip'), 'http://example.com/a.zip')
  assert.throws(() => relinkTarget('ftp://example.com/a.zip'), /https/)
  assert.throws(() => relinkTarget('javascript:alert(1)'), /https/)
  assert.throws(() => relinkTarget('file:///C:/Windows/win.ini'), /https/)
  assert.throws(() => relinkTarget('not a link'), /full address/)
})

test('a new link on another origin leaves the old credentials behind', () => {
  const old = {header: ['Authorization: Bearer DEMO', 'Cookie: sid=DEMO'], referer: 'https://a.example/page', 'http-user': 'me', 'http-passwd': 'pw', 'user-agent': 'UA', out: 'file.zip'}
  const same = carriedForRelink(old, 'https://a.example/old.zip?sig=1', 'https://a.example/new.zip?sig=2')
  assert.deepEqual(same, old)
  for (const elsewhere of ['https://b.example/new.zip', 'http://a.example/new.zip', 'https://a.example:8443/new.zip']) {
    const kept = carriedForRelink(old, 'https://a.example/old.zip', elsewhere)
    assert.deepEqual(kept, {'user-agent': 'UA', out: 'file.zip'}, elsewhere)
  }
  // an old address nobody knows is treated as another origin
  assert.deepEqual(carriedForRelink(old, undefined, 'https://a.example/new.zip'), {'user-agent': 'UA', out: 'file.zip'})
})
