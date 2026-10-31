import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

process.env.AXIVE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'axive-tracks-home-'))
test.after(() => fs.rmSync(process.env.AXIVE_HOME!, {recursive: true, force: true}))
const {AUDIO_M4A, TrackGoneError, audioTracks, buildChoices, capChoice, defaultAudioTrack, download, pinTrack, trackLabel, withAudioTrack} = await import('./ytdlp.js')
type Info = Parameters<typeof audioTracks>[0]
type Format = NonNullable<Info['formats']>[number]

// a real look at a dubbed YouTube video (yt-dlp 2026.08.19), trimmed: English (US) original, German and
// French dubs, every audio format of theirs including YouTube's HLS copies, two video formats; no links
const real = JSON.parse(fs.readFileSync(new URL('./fixtures/youtube-dubbed.json', import.meta.url), 'utf8')) as Info
const audioOf = (info: Info, language: string) => (info.formats ?? []).filter(f => f.language === language && f.vcodec === 'none' && f.acodec)
const vary = (change: (f: Format) => Format | Format[] | undefined, info: Info = real): Info => ({...info, formats: (info.formats ?? []).flatMap(f => change(structuredClone(f)) ?? [])})
const idsOf = (args: string[]) => /format_id~='\^\(\?:(.+?)\)\$'/.exec(args[args.indexOf('-f') + 1]!)?.[1]!.split('|').map(id => id.replace(/\\\./g, '.'))

// the dev tree's own yt-dlp, asked which formats it would draw (nothing is downloaded); skipped without it
const ytdlp = path.join(process.env.AXIVE_BIN ?? path.resolve('build', 'bin'), 'yt-dlp', 'yt-dlp.exe')
const haveYtdlp = process.platform === 'win32' && fs.existsSync(ytdlp)
function picks(info: Info, args: string[]): string {
  const file = path.join(process.env.AXIVE_HOME!, `look-${Math.random().toString(36).slice(2)}.json`)
  fs.writeFileSync(file, JSON.stringify(info))
  try {
    const out = execFileSync(ytdlp, ['--ignore-config', '--no-cache-dir', '--no-warnings', '--load-info-json', file, ...args.filter(a => a !== '-x'), '--simulate', '--print', 'format_id'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']})
    return out.trim()
  } catch (error) {
    return `error: ${String((error as {stderr?: string}).stderr ?? error).trim().split('\n').at(-1)}`
  } finally {
    fs.rmSync(file, {force: true})
  }
}

test('real metadata: one track per language, the original first, names and kinds from yt-dlp', () => {
  const tracks = audioTracks(real)
  assert.deepEqual(
    tracks.map(t => [t.id, trackLabel(t), t.isDefault]),
    [
      ['en-US', 'English (US) · original', true],
      // YouTube's HLS copies say "dubbed"; their own names ("Deutsch - dubbed") never become a track
      ['fr', 'French · dubbed', false],
      ['de', 'German · dubbed', false],
    ],
  )
  assert.equal(defaultAudioTrack(tracks)!.id, 'en-US')
  // a single track: nothing to choose, nothing pinned
  assert.deepEqual(audioTracks(vary(f => (f.language && f.language !== 'en-US' ? undefined : f))), [])
})

test('every chosen track, the first one too, is pinned to exactly its own formats', () => {
  for (const track of audioTracks(real)) {
    const choice = withAudioTrack(capChoice(1080), track)
    assert.equal(choice.audioTrack, track.id)
    const pinned = pinTrack(choice.args, real, track.id)!
    const own = audioOf(real, track.language).map(f => f.format_id)
    assert.deepEqual(idsOf(pinned)!.sort(), own.sort(), track.id)
    const spec = pinned[pinned.indexOf('-f') + 1]!
    // no single file with its own sound, no video stream that may carry some
    assert.ok(spec.split('/').every(alt => /^bv\[[^\]]*\]\+ba\[/.test(alt) || /^bv\+ba\[/.test(alt)), spec)
  }
  for (const c of buildChoices(real).filter(c => c.kind === 'audio')) {
    const spec = pinTrack(c.args, real, 'de')![c.args.indexOf('-f') + 1]!
    assert.ok(spec.split('/').every(alt => alt.startsWith('ba[')), spec)
  }
  // the vessel's own arguments stay plain: only the info a draw loads can say which ids carry the track
  assert.deepEqual(withAudioTrack(capChoice('mp3'), audioTracks(real)[2]!).args, capChoice('mp3').args)
  assert.match(withAudioTrack(capChoice(720), audioTracks(real)[2]!).suffix, /\[de\]$/)
})

test('an unavailable track is refused before yt-dlp runs: never another language instead', async () => {
  assert.equal(pinTrack(capChoice(1080).args, real, 'xx'), undefined)
  const german = audioTracks(real).find(t => t.id === 'de')!
  const withoutGerman = vary(f => (f.language === 'de' ? undefined : f))
  assert.equal(pinTrack(capChoice(1080).args, withoutGerman, 'de'), undefined)
  const file = path.join(process.env.AXIVE_HOME!, 'without-german.json')
  fs.writeFileSync(file, JSON.stringify(withoutGerman))
  const handlers = {onProgress() {}, onProcessing() {}}
  const tools = {ytdlp: path.join(process.env.AXIVE_HOME!, 'never-run.exe')} as never
  await assert.rejects(download({tools, url: 'https://www.youtube.com/watch?v=x', infoJsonPath: file, choice: withAudioTrack(capChoice('m4a'), german), outDir: process.env.AXIVE_HOME!}, handlers), TrackGoneError)
  // a pinned choice without an info to read is refused too (jobs.ts looks again first)
  await assert.rejects(download({tools, url: 'https://www.youtube.com/watch?v=x', choice: withAudioTrack(capChoice('m4a'), german), outDir: process.env.AXIVE_HOME!}, handlers), TrackGoneError)
})

test('original and default apart: each is the track asked for, and an unchosen draw is the original', () => {
  // yt-dlp's marks when YouTube's default is a dub: 10 for the original, 5 and "(default)" for the default
  const apart = vary(f => {
    if (f.language === 'en-US' && f.acodec) return {...f, language_preference: 10, format_note: (f.format_note ?? '').replace(' (default)', '')}
    if (f.language === 'de' && f.acodec) return {...f, language_preference: 5, format_note: (f.format_note ?? '').replace(/^German/, 'German (default)')}
    return f
  })
  const tracks = audioTracks(apart)
  assert.deepEqual(tracks.slice(0, 2).map(t => [t.id, t.kind, t.isDefault]), [
    ['en-US', 'original', false],
    ['de', 'dubbed', true],
  ])
  assert.equal(defaultAudioTrack(tracks)!.id, 'en-US')
  assert.deepEqual(idsOf(pinTrack(capChoice('mp3').args, apart, 'de')!)!.sort(), audioOf(apart, 'de').map(f => f.format_id).sort())
})

test('described audio under both labels, and two tracks in one language', () => {
  const english = audioOf(real, 'en-US')
  // "descriptive": yt-dlp writes the language as en-US-desc, preference -10
  const marked = {...real, formats: [...(real.formats ?? []), ...english.map(f => ({...f, format_id: `${f.format_id}d`, language: 'en-US-desc', language_preference: -10, format_note: (f.format_note ?? '').replace(/^English \(US\) original \(default\)/, 'English (US) descriptive')}))]}
  // "audio description": yt-dlp does not mark it, so it shares the original's language
  const words = {...real, formats: [...(real.formats ?? []), ...english.map(f => ({...f, format_id: `${f.format_id}a`, language_preference: -1, format_note: (f.format_note ?? '').replace(/^English \(US\) original \(default\)/, 'English (US) audio description')}))]}
  for (const [info, id] of [[marked, 'en-US-desc'], [words, 'en-US~desc']] as const) {
    const tracks = audioTracks(info)
    const described = tracks.find(t => t.kind === 'descriptive')!
    assert.equal(described.id, id)
    assert.equal(trackLabel(described), 'English (US) · audio description')
    assert.equal(tracks[0]!.id, 'en-US')
    // the original never takes a described format, and the described track only its own
    assert.ok(idsOf(pinTrack(capChoice('m4a').args, info, 'en-US')!)!.every(i => !/[da]$/.test(i)))
    assert.ok(idsOf(pinTrack(capChoice('m4a').args, info, id)!)!.every(i => /[da]$/.test(i)))
  }
  // two Spanish dubs under one code: split by their names, and a format naming neither is left out
  const spanish = (id: string, note: string): Format => ({format_id: id, ext: 'm4a', acodec: 'mp4a.40.2', vcodec: 'none', language: 'es', language_preference: -1, format_note: note, abr: 128})
  const two = {...real, formats: [...(real.formats ?? []), spanish('140-30', 'Spanish (Spain), medium'), spanish('251-30', 'Spanish (Spain), medium'), spanish('140-31', 'Spanish (Latin America), medium'), spanish('140-32', 'medium')]}
  const es = audioTracks(two).filter(t => t.language === 'es')
  assert.deepEqual(es.map(t => [t.id, t.name]), [
    ['es~spanish-latin-america', 'Spanish (Latin America)'],
    ['es~spanish-spain', 'Spanish (Spain)'],
  ])
  assert.deepEqual(idsOf(pinTrack(capChoice('m4a').args, two, 'es~spanish-spain')!), ['140-30', '251-30'])
  assert.deepEqual(idsOf(pinTrack(capChoice('m4a').args, two, 'es~spanish-latin-america')!), ['140-31'])
})

test('real yt-dlp draws exactly the chosen track, for video and audio alike', {skip: !haveYtdlp && 'no yt-dlp in build/bin'}, () => {
  const ids = (language: string) => audioOf(real, language).map(f => f.format_id)
  for (const track of audioTracks(real)) {
    for (const choice of [capChoice(1080), capChoice(360), capChoice('m4a'), capChoice('mp3')]) {
      const drawn = picks(real, pinTrack(withAudioTrack(choice, track).args, real, track.id)!)
      const audio = drawn.split('+').at(-1)!
      assert.ok(ids(track.language).includes(audio), `${track.id} ${choice.label}: ${drawn}`)
      if (choice.kind === 'video') assert.match(drawn, /^13[47]\+/, 'a video-only stream')
    }
  }
  // the m4a vessel keeps the track's own AAC when it has one
  assert.equal(picks(real, pinTrack(capChoice('m4a').args, real, 'de')!), '140-5')
  // a track gone from the look yt-dlp loads: it fails, it does not fall back
  assert.match(picks(vary(f => (f.language === 'de' ? undefined : f)), pinTrack(capChoice(1080).args, real, 'de')!), /^error: .*Requested format is not available/)
})

test('real yt-dlp: a draw nobody chose a track for takes the original, even when only a dub has AAC', {skip: !haveYtdlp && 'no yt-dlp in build/bin'}, () => {
  const opusOriginal = vary(f => (f.language === 'en-US' && /^1(39|40)-/.test(f.format_id) ? undefined : f))
  for (const choice of [capChoice(1080), capChoice('m4a'), capChoice('mp3')]) {
    const audio = picks(opusOriginal, choice.args).split('+').at(-1)!
    assert.equal(opusOriginal.formats!.find(f => f.format_id === audio)?.language, 'en-US', `${choice.label}: ${audio}`)
  }
  // what 2.5.0 asked for: the m4a filter and the AAC sort took a dub
  const languageOf = (drawn: string) => opusOriginal.formats!.find(f => f.format_id === drawn.split('+').at(-1))?.language
  assert.notEqual(languageOf(picks(opusOriginal, ['-f', 'ba[ext=m4a]/ba/b'])), 'en-US')
  assert.notEqual(languageOf(picks(opusOriginal, ['-f', 'bv*[height<=1080]+ba/b', '-S', 'res,vcodec:h264,acodec:aac'])), 'en-US')
  assert.deepEqual(AUDIO_M4A.slice(0, 4), ['-f', 'ba/b', '-S', 'lang,aext:m4a'])
})
