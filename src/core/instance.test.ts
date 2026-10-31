import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

// a sandbox data root before anything reads paths
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'axive-lock-'))
process.env.AXIVE_HOME = home
test.after(() => fs.rmSync(home, {recursive: true, force: true}))

const {focusWindow, holder, offerTo, openHolder, takeOver} = await import('./instance.js')

/** Another Axive, in its own process: it holds the lock and answers on its keyed address. */
function otherAxive(kind: 'gui' | 'tui'): Promise<{child: ReturnType<typeof spawn>; events: string[]}> {
  const script = `
    process.env.AXIVE_HOME = ${JSON.stringify(home)}
    const {claimWithControl} = await import(${JSON.stringify(new URL('./instance.ts', import.meta.url).href)})
    await claimWithControl(${JSON.stringify(kind)}, {
      focus: () => console.log('focus'),
      offer: url => console.log('offer ' + url),
      handover: async to => { console.log('handover ' + to); setTimeout(() => process.exit(0), 50) },
    })
    console.log('ready')
    setInterval(() => {}, 1000)
  `
  const tsx = path.join(import.meta.dirname, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const child = spawn(process.execPath, [tsx, '--input-type=module', '-e', script], {stdio: ['ignore', 'pipe', 'inherit']})
  const events: string[] = []
  return new Promise(resolve => {
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        events.push(line)
        if (line === 'ready') resolve({child, events})
      }
    })
  })
}

test('the open Axive comes forward and takes a link; the other door makes it let go', async () => {
  const other = await otherAxive('gui')
  try {
    const held = holder()
    assert.equal(held?.kind, 'gui')
    assert.equal(held?.control, true)
    assert.equal(await focusWindow(held!), true)
    assert.equal(await offerTo(held!, 'https://example.com/v'), true)
    // a wrong key opens nothing
    assert.equal(await focusWindow({...held!, key: 'nope'}), false)
    assert.equal(await takeOver(held!, 'tui', 8000), true)
    assert.equal(holder(), undefined)
    // its last line can still be on its way once it has gone
    await new Promise(resolve => (other.child.stdout!.readableEnded ? resolve(undefined) : other.child.stdout!.once('close', resolve)))
    assert.deepEqual(other.events.filter(e => e !== 'ready'), ['focus', 'offer https://example.com/v', 'focus', 'handover tui'])
  } finally {
    other.child.kill()
  }
})

test('a browser can never knock on the holder: an Origin is refused', async () => {
  const other = await otherAxive('tui')
  try {
    const held = holder()!
    const res = await fetch(`http://127.0.0.1:${held.port}/focus`, {method: 'POST', headers: {'X-Axive-Control': held.key!, Origin: 'https://evil.example'}, body: '{}'})
    assert.equal(res.status, 403)
    assert.deepEqual(other.events.filter(e => e !== 'ready'), [])
  } finally {
    other.child.kill()
  }
})

test('a lock left behind is no Axive: its number now runs another program, or nothing answers on its address', async () => {
  const lock = path.join(home, 'axive.lock')
  // Windows gave the old Axive's number to some other program
  const stranger = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'})
  try {
    fs.writeFileSync(lock, JSON.stringify({pid: stranger.pid, kind: 'tui', port: 1, key: 'k', control: true, at: Date.now(), image: 'Axive-2.4.2.exe'}))
    assert.equal(holder(), undefined)
    assert.equal(fs.existsSync(lock), false, 'the stale lock is cleared')
    // the right program, but its address is dead: that Axive is gone too
    const server = (await import('node:net')).createServer().listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    const port = (server.address() as {port: number}).port
    await new Promise(resolve => server.close(resolve))
    fs.writeFileSync(lock, JSON.stringify({pid: stranger.pid, kind: 'gui', port, key: 'k', control: true, at: Date.now(), image: path.basename(process.execPath)}))
    assert.equal(holder()?.pid, stranger.pid)
    assert.equal(await openHolder(), undefined)
    assert.equal(fs.existsSync(lock), false)
  } finally {
    stranger.kill()
  }
})

test('a live holder is still found by openHolder', async () => {
  const other = await otherAxive('tui')
  try {
    assert.equal((await openHolder())?.kind, 'tui')
  } finally {
    other.child.kill()
  }
})
