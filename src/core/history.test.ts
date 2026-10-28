import assert from 'node:assert/strict'
import test from 'node:test'
import {addSpeedSource, HISTORY_SECONDS, historyStore, pushRing, sampleHistory, stopHistory} from './history.js'

test('the ring is always 60 long, newest last', () => {
  let ring: number[] = []
  ring = pushRing(ring, 5)
  assert.equal(ring.length, HISTORY_SECONDS)
  assert.equal(ring.at(-1), 5)
  assert.equal(ring[0], 0)
  for (let i = 0; i < 70; i++) ring = pushRing(ring, i)
  assert.equal(ring.length, HISTORY_SECONDS)
  assert.equal(ring.at(-1), 69)
  assert.equal(ring[0], 10)
  assert.equal(pushRing([], Number.NaN).at(-1), 0, 'nonsense counts as still')
  assert.equal(pushRing([], -4).at(-1), 0)
})

test('a sample sums every source', () => {
  addSpeedSource('a', () => 1000)
  addSpeedSource('b', () => 24)
  addSpeedSource('broken', () => {
    throw new Error('x')
  })
  stopHistory()
  sampleHistory(123)
  assert.equal(historyStore.get().total.at(-1), 1024)
  assert.equal(historyStore.get().at, 123)
})
