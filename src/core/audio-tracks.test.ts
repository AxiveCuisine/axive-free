import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

process.env.AXIVE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'axive-tracks-home-'))
const {audioTracks, buildChoices, capChoice, defaultAudioTrack, trackLabel, withAudioTrack} = await import('./ytdlp.js')

// the shape yt-dlp gives a YouTube video with dubs (format notes as YouTube writes them)
const audio = (id: string, language: string, note: string, pref = -1) => ({format_id: id, ext: 'm4a', acodec: 'mp4a.40.2', vcodec: 'none', abr: 128, language, language_preference: pref, format_note: note})
const info = {
  title: 'a dubbed video',
  extractor_key: 'Youtube',
  formats: [
    {format_id: '137', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 1080, tbr: 4000},
    audio('140-0', 'fr', 'French, medium'),
    audio('140-1', 'en-US', 'English (US) original (default), medium', 10),
    audio('251-1', 'en-US', 'English (US) original (default), medium', 10),
    audio('140-2', 'es', 'Spanish (dubbed-auto), medium'),
    audio('140-3', 'en', 'English descriptive, medium'),
  ],
}

test('audio tracks: one per language, the original first, only what the metadata says', () => {
  const tracks = audioTracks(info)
  assert.deepEqual(tracks.map(t => t.id), ['en-US', 'en~descriptive', 'fr', 'es'])
  assert.equal(tracks[0]!.id, 'en-US')
  assert.equal(trackLabel(tracks[0]!), 'English (US) · original')
  assert.equal(defaultAudioTrack(tracks)!.id, 'en-US')
  // French is not marked as dubbed by YouTube: it is not called dubbed
  assert.equal(trackLabel(tracks.find(t => t.id === 'fr')!), 'French')
  assert.equal(tracks.find(t => t.id === 'es')!.kind, 'auto-dubbed')
  assert.equal(tracks.find(t => t.id === 'en~descriptive')!.kind, 'descriptive')
  // one track: nothing to choose
  assert.deepEqual(audioTracks({...info, formats: [info.formats[0]!, info.formats[2]!, info.formats[3]!]}), [])
})

test('a chosen track filters every audio selector and drops fallbacks that bring another language', () => {
  const fr = audioTracks(info).find(t => t.id === 'fr')!
  const video = withAudioTrack(capChoice(1080), fr)
  const spec = video.args[video.args.indexOf('-f') + 1]!
  assert.equal(spec, 'bv*[height<=1080]+ba[language=fr][format_note!*=descriptive]/bv*+ba[language=fr][format_note!*=descriptive]')
  assert.ok(!spec.split('/').some(alt => /^b(\[|$)/.test(alt)), 'no single-file fallback')
  assert.match(video.suffix, /\[fr\]$/)
  assert.equal(video.audioTrack, 'fr')
  for (const c of buildChoices(info).filter(c => c.kind === 'audio')) {
    const s = withAudioTrack(c, fr).args
    assert.ok(s[s.indexOf('-f') + 1]!.split('/').every(alt => alt.includes('[language=fr]')))
  }
  const described = audioTracks(info).find(t => t.kind === 'descriptive')!
  assert.match(withAudioTrack(capChoice('mp3'), described).args[1]!, /\[language=en\]\[format_note\*=descriptive\]/)
})
