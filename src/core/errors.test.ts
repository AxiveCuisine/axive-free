import assert from 'node:assert/strict'
import test from 'node:test'
import {backoffMs, classify} from './errors.js'

test('classify recognises private videos', () => {
  const c = classify(new Error('ERROR: [youtube] x: Private video'))
  assert.equal(c.kind, 'private')
  assert.equal(c.raw, 'ERROR: [youtube] x: Private video')
})

test('classify recognises rate limits as transient', () => {
  const c = classify(new Error('HTTP Error 429: Too Many Requests'))
  assert.equal(c.kind, 'ratelimit')
  assert.equal(c.transient, true)
})

test('classify recognises age gates before generic sign-in prompts', () => {
  assert.equal(classify(new Error('Sign in to confirm your age')).kind, 'age')
})

test('classify recognises unsupported URLs', () => {
  assert.equal(classify(new Error('Unsupported URL: https://x')).kind, 'unsupported')
})

test('classify recognises network failures as transient', () => {
  const c = classify(new Error('Read timed out'))
  assert.equal(c.kind, 'network')
  assert.equal(c.transient, true)
})

test('classify falls back to unknown and is not transient', () => {
  const c = classify(new Error('something odd happened'))
  assert.equal(c.kind, 'unknown')
  assert.equal(c.transient, false)
  assert.equal(c.detail, 'something odd happened')
})

test('backoffMs grows with each attempt and respects its caps', () => {
  const realRandom = Math.random
  Math.random = () => 0.5 // jitter factor 1.0
  try {
    assert.equal(backoffMs(1, 'network'), 2_000)
    assert.equal(backoffMs(2, 'network'), 4_000)
    assert.equal(backoffMs(3, 'network'), 8_000)
    assert.equal(backoffMs(20, 'network'), 60_000)
    assert.equal(backoffMs(1, 'ratelimit'), 30_000)
    assert.equal(backoffMs(2, 'ratelimit'), 60_000)
    assert.equal(backoffMs(20, 'ratelimit'), 180_000)
  } finally {
    Math.random = realRandom
  }
})
