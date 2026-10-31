import assert from 'node:assert/strict'
import test from 'node:test'
import {buildChoices, type VideoInfo} from './ytdlp.js'

// trimmed from a real YouTube -J: HLS formats come without any size field
const info: VideoInfo = {
  title: 'Big Buck Bunny',
  duration: 635,
  formats: [
    {format_id: '140', ext: 'm4a', acodec: 'mp4a.40.2', vcodec: 'none', abr: 129, filesize: 10_276_000},
    {format_id: '251', ext: 'webm', acodec: 'opus', vcodec: 'none', abr: 129, filesize: 10_200_000},
    {format_id: '312', ext: 'mp4', vcodec: 'avc1.64002A', acodec: 'none', height: 1080, tbr: 7418},
    {format_id: '399', ext: 'mp4', vcodec: 'av01.0.09M.08', acodec: 'none', height: 1080, tbr: 1568, filesize: 124_400_000},
    {format_id: '160', ext: 'mp4', vcodec: 'avc1.4D400C', acodec: 'none', height: 144, tbr: 55, filesize: 4_320_000},
  ],
}

test('sizes are estimated from bitrate when a format carries none', () => {
  const [p1080] = buildChoices(info)
  // h264 HLS at 7418 kbit/s for 635 s ≈ 589 MB, plus the m4a track
  assert.match(p1080!.label, /^1080p · mp4 · ~5\d\d MB$/)
})

test('each resolution gets its own filename', () => {
  const choices = buildChoices(info)
  assert.deepEqual(
    choices.map(c => c.suffix),
    [' [1080p]', ' [144p]', '', ''],
  )
})

test('video choices ask yt-dlp for the most compatible codecs at full resolution', () => {
  const [p1080] = buildChoices(info)
  const sort = p1080!.args[p1080!.args.indexOf('-S') + 1]
  // the original audio before a dub's AAC: yt-dlp ranks the user's -S above its own language preference
  assert.equal(sort, 'res,lang,vcodec:h264,acodec:aac')
})

test('removePartials: a draw cancelled mid-merge leaves nothing of its own behind', async () => {
  const fsp = await import('node:fs/promises')
  const os = await import('node:os')
  const pathMod = await import('node:path')
  const dir = await fsp.mkdtemp(pathMod.join(os.tmpdir(), 'axive-partials-'))
  const stem = 'Big Buck Bunny [1080p]'
  const ours = [`${stem}.mp4`, `${stem}.temp.mp4`, `${stem}.jpg`, `${stem}.f137.mp4.part`, `${stem}.f137.mp4.part-Frag3`]
  const theirs = ['Big Buck Bunny [720p].mp4', 'cover.jpg', `${stem} (extra).jpg`]
  for (const name of [...ours, ...theirs]) await fsp.writeFile(pathMod.join(dir, name), 'x')
  const {removePartials} = await import('./ytdlp.js')
  await removePartials([pathMod.join(dir, `${stem}.mp4`), pathMod.join(dir, `${stem}.f137.mp4`)])
  const left = (await fsp.readdir(dir)).sort()
  assert.deepEqual(left, [...theirs].sort())
  await fsp.rm(dir, {recursive: true, force: true})
})
