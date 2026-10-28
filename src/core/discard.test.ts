import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {test} from 'node:test'

process.env.AXIVE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'axive-discard-home-'))
const {discard, discardSentence, refusedPlace} = await import('./discard.js')

test('deleting from the drive refuses drives, home folders and Axive itself', () => {
  const home = os.homedir()
  assert.equal(refusedPlace(path.parse(home).root), true)
  assert.equal(refusedPlace(home), true)
  assert.equal(refusedPlace(path.join(home, 'Downloads')), true)
  assert.equal(refusedPlace(path.join(home, 'Desktop')), true)
  assert.equal(refusedPlace(path.dirname(home)), true, 'a folder holding a guarded one')
  assert.equal(refusedPlace(path.join(process.env.AXIVE_HOME!, 'ledger.jsonl')), true)
  assert.equal(refusedPlace('relative\file.mp4'), true)
  assert.equal(refusedPlace(path.join(home, 'Downloads', 'clip.mp4')), false)
  assert.equal(refusedPlace(path.join(home, 'Downloads', 'Some Torrent')), false)
})

test('a file already gone is said plainly, nothing is touched', async () => {
  const r = await discard([path.join(os.tmpdir(), 'axive-not-here-' + Date.now() + '.mp4'), ''])
  assert.deepEqual(r.removed, [])
  assert.equal(r.kept[0]!.why, 'gone')
  assert.equal(discardSentence(r), 'nothing was on the drive to delete')
  assert.equal(discardSentence({removed: ['a', 'b'], kept: [{path: 'c', why: 'in use'}]}), '2 files moved to the Recycle Bin · 1 in use by another program, left where it is')
  fs.rmSync(process.env.AXIVE_HOME!, {recursive: true, force: true})
})
