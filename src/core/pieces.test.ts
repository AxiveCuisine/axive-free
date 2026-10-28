import assert from 'node:assert/strict'
import test from 'node:test'
import {bucketize, decodeBitfield, eighths, inferEdges, mapFraction, pieceView, placeHidden, resample, resampleEdges, totalSpeed} from './pieces.js'

const bits = (s: string) => Uint8Array.from(s, c => (c === '1' ? 1 : 0))

test('the bitfield reads most significant bit first, one bit per piece', () => {
  assert.deepEqual([...decodeBitfield('a0', 8)], [1, 0, 1, 0, 0, 0, 0, 0])
  assert.deepEqual([...decodeBitfield('f8', 5)], [1, 1, 1, 1, 1], 'padding bits past numPieces are ignored')
  assert.deepEqual([...decodeBitfield('8', 6)], [1, 0, 0, 0, 0, 0], 'a short bitfield reads the rest as missing')
  assert.deepEqual([...decodeBitfield('zz', 4)], [0, 0, 0, 0], 'junk reads as missing')
})

test('eighths: whole only when whole, a sliver as soon as anything lands', () => {
  assert.equal(eighths(0), 0)
  assert.equal(eighths(0.01), 1)
  assert.equal(eighths(0.5), 4)
  assert.equal(eighths(0.999), 7)
  assert.equal(eighths(1), 8)
})

test('bucketize: one cell per piece when few, groups when many', () => {
  assert.equal(bucketize(bits('1010')), '8080')
  assert.equal(bucketize(bits('11110000'), 2), '80')
  assert.equal(bucketize(bits('11100000'), 2), '60')
  assert.equal(bucketize(bits('10000000'), 1), '1')
  assert.equal(bucketize(new Uint8Array(0)), '')
  assert.equal(bucketize(new Uint8Array(1000)).length, 96)
  assert.equal(bucketize(bits('0000'), 96, new Map([[1, 0.5]])), '0400', 'a piece on its way fills partly')
})

test('resample squeezes a map to the width, and keeps one that fits', () => {
  assert.equal(resample('8080', 10), '8080')
  assert.equal(resample('88880000', 2), '80')
  assert.equal(resample('88884488', 2), '86')
  assert.equal(resample('80', 1), '4')
  assert.deepEqual([...resampleEdges([1, 7], 8, 2)].sort(), [0, 1])
  assert.deepEqual([...resampleEdges([1, 3], 4, 10)].sort(), [1, 3])
})

test('edges: the first missing piece after each run that grew', () => {
  const prev = bits('1100000011000000')
  const now = bits('1110000011110000')
  assert.deepEqual(inferEdges(prev, now, 16), [3, 12])
  assert.deepEqual(inferEdges(prev, now, 1), [12], 'capped at the connection count, fastest first')
  assert.deepEqual(inferEdges(undefined, now, 16), [], 'the first look has nothing to compare')
  assert.deepEqual(inferEdges(now, now, 16), [], 'nothing grew: nothing is writing')
  assert.deepEqual(inferEdges(bits('0000'), bits('1111'), 4), [], 'a run that reached the end writes nowhere')
  // a torrent: scattered arrivals each make a frontier
  assert.deepEqual(inferEdges(bits('00000000'), bits('01000100'), 8), [2, 6])
})

test('pieceView spreads the bytes past whole pieces over the edges', () => {
  const prev = bits('10001000')
  const now = bits('11001100')
  // 4 whole pieces of 100 bytes, plus 100 bytes in flight over 2 edges: half each
  const view = pieceView(now, prev, 4, 500, 100, 96, false)
  assert.deepEqual(view.edges, [2, 6])
  assert.equal(view.map, '88408840')
  assert.equal(pieceView(now, undefined, 4, 500, 100, 96, false).map, '88008800', 'a torrent with no edges known: no partial fill')
  // a plain file: the two connections the bitfield cannot show are placed too, and share the bytes
  const file = pieceView(now, prev, 4, 500, 100)
  assert.deepEqual(file.edges, [2, 3, 6, 7])
  assert.equal(file.map, '88228822')
  assert.equal(mapFraction('8800'), 0.5)
})

test('hidden connections land where aria2 puts them: the start, then the middle of the largest gap', () => {
  assert.deepEqual(placeHidden(bits('00000000'), [], 1), [0])
  assert.deepEqual(placeHidden(bits('00000000'), [], 3), [0, 4, 2])
  assert.deepEqual(placeHidden(bits('11000000'), [], 1), [2], 'after a finished run nobody continues: its start')
  assert.deepEqual(placeHidden(bits('11000000'), [2], 1), [5], 'after a busy piece: the middle')
  assert.deepEqual(placeHidden(bits('1111'), [], 2), [], 'nothing left to place')
  // 16 connections on 24 pieces, nothing finished yet: spread over the file, never twice on one piece
  const spread = placeHidden(new Uint8Array(24), [], 16)
  assert.equal(new Set(spread).size, 16)
})

test('total speed sums running draws and active fetches only', () => {
  const jobs = [
    {state: 'running', progress: {speed: 1000}},
    {state: 'paused', progress: {speed: 500}},
    {state: 'running'},
  ]
  const items = [
    {state: 'active', speed: 300, smooth: 200},
    {state: 'active', speed: 50},
    {state: 'done', speed: 999},
  ]
  assert.equal(totalSpeed(jobs, items), 1250)
  assert.equal(totalSpeed([], []), 0)
})
