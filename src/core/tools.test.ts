import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const ownHome = !process.env.AXIVE_HOME
process.env.AXIVE_HOME ??= path.join(os.tmpdir(), `axive-tools-test-${process.pid}`)
test.after(() => ownHome && fs.rmSync(process.env.AXIVE_HOME!, {recursive: true, force: true}))
const {judgeItem} = await import('./tools.js')
const {paths} = await import('./paths.js')

const sha = (text: string) => crypto.createHash('sha256').update(text).digest('hex')
const lay = (files: Record<string, string>) => {
  fs.rmSync(path.join(paths.bin, 'ffmpeg'), {recursive: true, force: true})
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(paths.bin, rel)), {recursive: true})
    fs.writeFileSync(path.join(paths.bin, rel), body)
  }
}
const record = {'ffmpeg/ffmpeg.exe': sha('ffmpeg'), 'ffmpeg/ffprobe.exe': sha('ffprobe'), 'ffmpeg/avcodec-61.dll': sha('codec')}
const item = {name: 'ffmpeg', asset: 'ffmpeg.zip', kind: 'zip' as const, dest: 'ffmpeg', check: 'ffmpeg/ffmpeg.exe', sha256: sha('ffmpeg'), size: 1, files: record}
const intact = {'ffmpeg/ffmpeg.exe': 'ffmpeg', 'ffmpeg/ffprobe.exe': 'ffprobe', 'ffmpeg/avcodec-61.dll': 'codec'}

test('an intact folder passes', async () => {
  lay(intact)
  assert.deepEqual(await judgeItem(item, {}), {ok: true})
})

test('a swapped dll or ffprobe is caught, not only the exe', async () => {
  lay({...intact, 'ffmpeg/avcodec-61.dll': 'evil'})
  assert.deepEqual(await judgeItem(item, {}), {ok: false, reason: 'altered'})
  lay({...intact, 'ffmpeg/ffprobe.exe': 'evil'})
  assert.deepEqual(await judgeItem(item, {}), {ok: false, reason: 'altered'})
})

test('a file planted beside the tools is caught', async () => {
  lay({...intact, 'ffmpeg/version.dll': 'planted'})
  assert.deepEqual(await judgeItem(item, {}), {ok: false, reason: 'altered'})
})

test('a missing file is reported missing', async () => {
  const {'ffmpeg/ffprobe.exe': _gone, ...rest} = intact
  lay(rest)
  assert.deepEqual(await judgeItem(item, {}), {ok: false, reason: 'missing'})
})

test('a renewed yt-dlp is judged by its own whole record', async () => {
  const yt = {...item, name: 'yt-dlp', dest: 'ffmpeg', files: {'ffmpeg/ffmpeg.exe': sha('old')}}
  lay({'ffmpeg/ffmpeg.exe': 'new', 'ffmpeg/_internal/x.pyd': 'lib'})
  const state = {ytdlp: {version: '2', sha256: sha('new'), files: {'ffmpeg/ffmpeg.exe': sha('new'), 'ffmpeg/_internal/x.pyd': sha('lib')}}}
  assert.deepEqual(await judgeItem(yt, state), {ok: true})
  lay({'ffmpeg/ffmpeg.exe': 'new', 'ffmpeg/_internal/x.pyd': 'evil'})
  assert.deepEqual(await judgeItem(yt, state), {ok: false, reason: 'altered'})
})

test('a renewed record that points outside its folder counts as tampering', async () => {
  const yt = {...item, name: 'yt-dlp'}
  lay(intact)
  assert.deepEqual(await judgeItem(yt, {ytdlp: {version: '2', sha256: sha('x'), files: {'../outside.exe': sha('x')}}}), {ok: false, reason: 'altered'})
  assert.deepEqual(await judgeItem(yt, {ytdlp: {version: '2', sha256: sha('x'), files: {'node/node.exe': sha('x')}}}), {ok: false, reason: 'altered'})
})
