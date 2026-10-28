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

const {focusWindow, holder, offerTo} = await import('./instance.js')

/** Another Axive, in its own process: it holds the lock and answers on its keyed address. */
function otherAxive(kind: 'gui' | 'tui'): Promise<{child: ReturnType<typeof spawn>; events: string[]}> {
  const script = `
    process.env.AXIVE_HOME = ${JSON.stringify(home)}
    const {claimWithControl} = await import(${JSON.stringify(new URL('./instance.ts', import.meta.url).href)})
    await claimWithControl(${JSON.stringify(kind)}, {
      focus: () => console.log('focus'),
      offer: url => console.log('offer ' + url),
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

test('the open Axive Free comes forward and takes a link', async () => {
  const other = await otherAxive('tui')
  try {
    const held = holder()
    assert.equal(held?.kind, 'tui')
    assert.equal(held?.control, true)
    assert.equal(await focusWindow(held!), true)
    assert.equal(await offerTo(held!, 'https://example.com/v'), true)
    // a wrong key opens nothing
    assert.equal(await focusWindow({...held!, key: 'nope'}), false)
    // an offer also brings the window forward
    assert.deepEqual(other.events.filter(e => e !== 'ready'), ['focus', 'offer https://example.com/v', 'focus'])
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
