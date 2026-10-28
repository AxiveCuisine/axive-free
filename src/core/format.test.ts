import assert from 'node:assert/strict'
import test from 'node:test'
import {clean} from './format.js'

test('clean strips escape sequences so hostile titles cannot drive the terminal', () => {
  const osc52 = 'nice video\x1b]52;c;ZWNobyBwd25lZA==\x07'
  assert.equal(clean(osc52).includes('\x1b'), false)
  assert.equal(clean(osc52).includes('\x07'), false)
  assert.equal(clean('\x1b[2J\x1b[Hfake prompt'), '[2J [Hfake prompt')
})

test('clean drops bidi overrides and C1 controls, keeps ordinary unicode', () => {
  assert.equal(clean('evil\u202egpj.exe'), 'evil gpj.exe')
  assert.equal(clean('a\u009bb'), 'a b')
  assert.equal(clean('תהום — the deep ✓'), 'תהום — the deep ✓')
})

test('clean flattens newlines and tabs into single spaces', () => {
  assert.equal(clean('line one\n\nline\ttwo  '), 'line one line two')
})
