import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const ownHome = !process.env.AXIVE_HOME
process.env.AXIVE_HOME ??= path.join(os.tmpdir(), `axive-cat-test-${process.pid}`)
test.after(() => ownHome && fs.rmSync(process.env.AXIVE_HOME!, {recursive: true, force: true}))
const {addCategory, categoryFor, folderFor, getCategories, removeCategory, resetCategories, restingFolder, updateCategory, wildcard} = await import('./categories.js')
const {updateConfig} = await import('./config.js')

test('the six defaults and Other', () => {
  assert.deepEqual(getCategories().map(c => c.name), ['Compressed', 'Programs', 'Videos', 'Music', 'Pictures', 'Documents', 'Other'])
})

test('a file finds its category by extension, an address pattern wins, the rest is Other', () => {
  assert.equal(categoryFor('ubuntu.ISO').id, 'programs')
  assert.equal(categoryFor('song.flac').id, 'music')
  assert.equal(categoryFor('', 'https://x.example/files/archive.7z?sig=1').id, 'compressed')
  assert.equal(categoryFor('mystery.xyz').id, 'other')
  assert.equal(categoryFor(undefined).id, 'other')
  const games = addCategory({name: 'Games', exts: ['.PAK', 'wad'], patterns: ['*://*.gog.com/*'], folder: ''})
  assert.equal(games.id, 'games')
  assert.deepEqual(games.exts, ['pak', 'wad'])
  assert.equal(getCategories().at(-1)!.id, 'other', 'Other stays last')
  assert.equal(categoryFor('setup.exe', 'https://cdn.gog.com/setup.exe').id, 'games', 'the pattern beats the extension')
  assert.equal(wildcard('*.zip').test('A.ZIP'), true)
  assert.equal(wildcard('a?c').test('abc'), true)
  assert.equal(wildcard('a.c').test('abc'), false, 'a dot is a dot')
})

test('folders: under the base by name, or its own; Other stays in the base; only when the setting is on', () => {
  const base = path.join(os.tmpdir(), 'dl')
  const videos = getCategories().find(c => c.id === 'videos')!
  assert.equal(folderFor(videos, base), path.join(base, 'Videos'))
  const own = updateCategory('videos', {folder: path.join(os.tmpdir(), 'Movies')})
  assert.equal(folderFor(own, base), path.join(os.tmpdir(), 'Movies'))
  assert.equal(folderFor(getCategories().find(c => c.id === 'other'), base), base)
  updateConfig({categoryFolders: false})
  assert.equal(restingFolder(base, own), base)
  updateConfig({categoryFolders: true})
  assert.equal(restingFolder(base, own), path.join(os.tmpdir(), 'Movies'))
  updateConfig({categoryFolders: false})
})

test('names are checked; Other cannot go', () => {
  assert.throws(() => addCategory({name: 'a/b', exts: [], patterns: [], folder: ''}), /needs a name/)
  assert.throws(() => removeCategory('other'), /Other/)
  removeCategory('games')
  assert.ok(!getCategories().some(c => c.id === 'games'))
  resetCategories()
  assert.equal(getCategories().find(c => c.id === 'videos')!.folder, '')
})
