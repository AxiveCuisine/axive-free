import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {revealPlan} from './reveal.js'

const win = process.platform === 'win32'

test('revealPlan selects the file that landed, quoting only the path', {skip: !win}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axive reveal '))
  try {
    const file = path.join(dir, 'Hello, World [abc].mp4')
    fs.writeFileSync(file, 'x')
    const plan = revealPlan(file, os.homedir())!
    // Node's own quoting ("/select,C:\a b\c") makes Explorer open Documents
    assert.equal(plan.verbatim, true)
    assert.deepEqual(plan.args, [`/select,"${file}"`])
    assert.equal(plan.opened, file)
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

test('revealPlan falls back to the folder, then the default folder, never to nothing', {skip: !win}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axive reveal '))
  try {
    const gone = path.join(dir, 'moved away.mp4')
    assert.deepEqual(revealPlan(gone, os.homedir())!.args, [`"${dir}"`])
    assert.equal(revealPlan(dir)!.opened, dir)
    assert.equal(revealPlan('', dir)!.opened, dir)
    assert.equal(revealPlan(undefined, dir)!.opened, dir)
    assert.equal(revealPlan(path.join(dir, 'no', 'such', 'file.mp4'), dir)!.opened, dir)
    assert.equal(revealPlan(undefined, undefined), undefined)
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})
