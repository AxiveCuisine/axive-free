import {spawn, spawnSync, type ChildProcess, type ChildProcessWithoutNullStreams} from 'node:child_process'
import {rmSync} from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {FREE_MAX_HEIGHT, getConfig, type Config} from './config.js'
import {clean, formatBytes} from './format.js'
import {rawLine} from './log.js'
import {SYSTEM32, ensureDir, paths} from './paths.js'
import {type Tools} from './tools.js'

// ---------------------------------------------------------------------------
// processes

const children = new Set<ChildProcess>()
const tempFiles = new Set<string>()

process.on('exit', () => {
  for (const child of children) killTree(child, true)
  for (const file of tempFiles) rmSync(file, {force: true})
})

/**
 * Cancelling has to take the whole tree down: yt-dlp hands merges to ffmpeg,
 * and an orphaned ffmpeg keeps the half-written file locked on Windows.
 */
export function killTree(child: ChildProcess, sync = false): void {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
  if (process.platform !== 'win32') {
    child.kill('SIGTERM')
    return
  }
  const args = ['/pid', String(child.pid), '/T', '/F']
  const taskkill = path.join(SYSTEM32, 'taskkill.exe')
  if (sync) spawnSync(taskkill, args, {stdio: 'ignore', windowsHide: true})
  else spawn(taskkill, args, {stdio: 'ignore', windowsHide: true}).on('error', () => {})
}

export function run(command: string, args: string[], signal?: AbortSignal, job?: string): ChildProcessWithoutNullStreams {
  if (job) rawLine(job, `$ ${path.basename(command)} ${args.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`, 'cmd')
  const child = spawn(command, args, {windowsHide: true, env: {...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1'}})
  children.add(child)
  child.on('close', () => children.delete(child))
  if (signal) {
    const onAbort = () => killTree(child)
    if (signal.aborted) onAbort()
    signal.addEventListener('abort', onAbort, {once: true})
    child.on('close', () => signal.removeEventListener('abort', onAbort))
  }
  return child
}

/** Run to completion, collecting output; rejects with the cleaned error on a non-zero exit. */
export function collect(command: string, args: string[], signal?: AbortSignal, job?: string): Promise<{stdout: string; stderr: string}> {
  return new Promise((resolve, reject) => {
    const child = run(command, args, signal, job)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += chunk))
    child.stderr.on('data', chunk => {
      stderr += chunk
      if (job) for (const line of String(chunk).split('\n')) rawLine(job, line, 'err')
    })
    child.on('error', reject)
    child.on('close', code => {
      if (signal?.aborted) reject(new CancelledError())
      else if (code !== 0) reject(new ToolError(cleanYtDlpError(stderr) || `${path.basename(command)} exited with code ${code}`, stderr, [command, ...args]))
      else resolve({stdout, stderr})
    })
  })
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled.')
  }
}

/** A tool failed; keeps its raw stderr and command line for the classifier and the debug report. */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly command: string[],
  ) {
    super(message)
  }
}

export function cleanYtDlpError(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('ERROR:'))
  const last = lines.at(-1)
  return last ? clean(last.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '')) : ''
}

// ---------------------------------------------------------------------------
// shared flags

/**
 * Flags every yt-dlp run shares. User config files are ignored so a stray
 * yt-dlp.conf can't change what Axive does; YouTube's challenges are solved
 * with the node runtime Axive carries.
 */
export function sharedArgs(t: Tools): string[] {
  const args = ['--ignore-config', '--no-js-runtimes']
  if (t.node) args.push('--js-runtimes', `node:${t.node}`)
  if (t.ffmpegDir) args.push('--ffmpeg-location', t.ffmpegDir)
  return args
}

const RETRY_ARGS = ['--retries', '10', '--fragment-retries', '10', '--extractor-retries', '3', '--retry-sleep', 'exp=1:30', '--retry-sleep', 'fragment:exp=1:20']

// ---------------------------------------------------------------------------
// probing

export type Thumbnail = {id?: string; url: string; width?: number; height?: number; preference?: number}
export type Chapter = {start_time: number; end_time?: number; title?: string}
export type SubtitleTrack = {ext?: string; url?: string; name?: string}

export type VideoInfo = {
  id?: string
  title: string
  uploader?: string
  channel?: string
  duration?: number
  upload_date?: string
  webpage_url?: string
  original_url?: string
  extractor_key?: string
  live_status?: string
  is_live?: boolean
  description?: string
  formats?: RawFormat[]
  thumbnails?: Thumbnail[]
  thumbnail?: string
  chapters?: Chapter[] | null
  subtitles?: Record<string, SubtitleTrack[]>
  automatic_captions?: Record<string, SubtitleTrack[]>
  view_count?: number
}

export type RawFormat = {
  format_id: string
  ext?: string
  vcodec?: string
  acodec?: string
  height?: number
  width?: number
  abr?: number
  tbr?: number
  filesize?: number
  filesize_approx?: number
}

export type PlaylistEntry = {id?: string; url: string; title: string; duration?: number; uploader?: string; ie_key?: string; view_count?: number}
export type Playlist = {title: string; uploader?: string; url: string; entries: PlaylistEntry[]; extractor_key?: string; isChannel: boolean}

export type ProbeResult = {kind: 'video'; info: VideoInfo; infoJsonPath: string} | {kind: 'playlist'; playlist: Playlist}

/** youtube.com/@name (no tab) → its Videos tab, which lists uploads newest first */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    if (/(^|\.)youtube\.com$/i.test(u.hostname)) {
      const parts = u.pathname.split('/').filter(Boolean)
      const channelRoot =
        (parts.length === 1 && parts[0]!.startsWith('@')) || (parts.length === 2 && ['channel', 'c', 'user'].includes(parts[0]!))
      if (channelRoot) {
        u.pathname = `/${parts.join('/')}/videos`
        return u.toString()
      }
    }
  } catch {
    // not a url: leave it
  }
  return url
}

const isChannelUrl = (url: string) => /youtube\.com\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/(videos|shorts|streams)/i.test(url)

function flatEntry(entry: Record<string, unknown>): PlaylistEntry | undefined {
  const id = typeof entry.id === 'string' ? entry.id : undefined
  const ie = typeof entry.ie_key === 'string' ? entry.ie_key : undefined
  let url = typeof entry.url === 'string' ? entry.url : typeof entry.webpage_url === 'string' ? entry.webpage_url : ''
  if (id && (ie === 'Youtube' || /youtube/i.test(String(entry.extractor_key ?? ''))) && !/^https?:/.test(url)) url = `https://www.youtube.com/watch?v=${id}`
  if (!url) return undefined
  return {
    id,
    url,
    title: clean(String(entry.title ?? id ?? url)),
    duration: typeof entry.duration === 'number' ? entry.duration : undefined,
    uploader: typeof entry.uploader === 'string' ? clean(entry.uploader) : typeof entry.channel === 'string' ? clean(entry.channel) : undefined,
    ie_key: ie,
    view_count: typeof entry.view_count === 'number' ? entry.view_count : undefined,
  }
}

/** One probe answers both questions: a single video (full info) or a playlist (flat entries). */
export async function probe(t: Tools, url: string, signal?: AbortSignal, job?: string): Promise<ProbeResult> {
  const target = normalizeUrl(url)
  // `--` ends option parsing: whatever the url holds, it can't become a flag
  const {stdout} = await collect(t.ytdlp, [...sharedArgs(t), '-J', '--flat-playlist', '--no-playlist', '--', target], signal, job)
  let data: Record<string, unknown>
  try {
    data = JSON.parse(stdout) as Record<string, unknown>
  } catch {
    throw new Error('yt-dlp answered with something that is not video info.')
  }
  if (data._type === 'playlist') {
    const entries = (Array.isArray(data.entries) ? data.entries : [])
      .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
      .map(flatEntry)
      .filter((e): e is PlaylistEntry => Boolean(e))
    return {
      kind: 'playlist',
      playlist: {
        title: clean(String(data.title ?? 'playlist')),
        uploader: typeof data.uploader === 'string' ? clean(data.uploader) : undefined,
        url: target,
        entries,
        extractor_key: typeof data.extractor_key === 'string' ? data.extractor_key : undefined,
        isChannel: isChannelUrl(target),
      },
    }
  }
  const info = data as unknown as VideoInfo
  // everything below is shown on screen and comes straight from the site
  info.title = clean(String(info.title ?? ''))
  if (info.uploader) info.uploader = clean(String(info.uploader))
  if (info.channel) info.channel = clean(String(info.channel))
  if (info.chapters) info.chapters = info.chapters.map(c => ({...c, title: clean(String(c.title ?? ''))}))
  const infoJsonPath = path.join(ensureDir(paths.cache), `probe-${process.pid}-${Date.now()}.json`)
  await fs.writeFile(infoJsonPath, stdout)
  tempFiles.add(infoJsonPath)
  return {kind: 'video', info, infoJsonPath}
}

export function discardTemp(file: string | undefined): void {
  if (!file || !tempFiles.delete(file)) return
  void fs.rm(file, {force: true})
}

export function trackTemp(file: string): void {
  tempFiles.add(file)
}

// ---------------------------------------------------------------------------
// vessels (what to draw)

export type ChoiceKind = 'video' | 'audio'

export type DownloadChoice = {
  label: string
  kind: ChoiceKind
  args: string[]
  /** appended to the title in the filename, so two resolutions of one video don't collide */
  suffix: string
  /** estimated bytes, when known */
  size?: number
  height?: number
}

const MAX_VIDEO_CHOICES = 8

// highest resolution first, then H.264 + AAC where the site offers them — an
// mp4 that plays everywhere, not AV1/Opus that many players still refuse
const COMPATIBLE_SORT = ['-S', 'res,vcodec:h264,acodec:aac']

// Free draws never above FREE_MAX_HEIGHT: when a site offers nothing that low, the smallest it has
const capped = (height: number) => `bv*[height<=${height}]+ba/b[height<=${height}]/wv*+ba/w`

export const videoArgs = (height: number = FREE_MAX_HEIGHT): string[] =>
  height < FREE_MAX_HEIGHT
    ? ['-f', `bv*[height=${height}]+ba/b[height=${height}]/${capped(height)}`, ...COMPATIBLE_SORT, '--merge-output-format', 'mp4']
    : ['-f', `bv*[height=${FREE_MAX_HEIGHT}]+ba/b[height=${FREE_MAX_HEIGHT}]/${capped(FREE_MAX_HEIGHT)}`, ...COMPATIBLE_SORT, '--merge-output-format', 'mp4']

export const AUDIO_MP3 = ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0']
export const AUDIO_M4A = ['-f', 'ba[ext=m4a]/ba/b', '-x', '--audio-format', 'm4a']

/** Best ≤ height (never above FREE_MAX_HEIGHT), when the vessel is chosen before the formats are known. */
export function capChoice(wanted: number | 'best' | 'mp3' | 'm4a'): DownloadChoice {
  if (wanted === 'mp3') return {label: 'audio · mp3', kind: 'audio', args: AUDIO_MP3, suffix: ''}
  if (wanted === 'm4a') return {label: 'audio · m4a', kind: 'audio', args: AUDIO_M4A, suffix: ''}
  const height = wanted === 'best' ? FREE_MAX_HEIGHT : Math.min(wanted, FREE_MAX_HEIGHT)
  return {
    label: `≤ ${height}p · mp4`,
    kind: 'video',
    args: ['-f', capped(height), ...COMPATIBLE_SORT, '--merge-output-format', 'mp4'],
    suffix: '',
    height,
  }
}

export function buildChoices(info: VideoInfo): DownloadChoice[] {
  const formats = info.formats ?? []
  const choices: DownloadChoice[] = []
  // HLS formats often carry no size; estimate it the way yt-dlp's -F table does
  const sizeOf = (f: RawFormat | undefined) =>
    f?.filesize ?? f?.filesize_approx ?? (f?.tbr && info.duration ? f.tbr * 125 * info.duration : 0)

  const audioOnly = formats.filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
  const bestAudio = [...audioOnly].sort((a, b) => scoreAudio(b) - scoreAudio(a))[0]
  const audioSize = sizeOf(bestAudio)

  const videos = formats.filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
  const heights = [...new Set(videos.map(f => f.height as number))].filter(h => h <= FREE_MAX_HEIGHT).sort((a, b) => b - a)

  for (const height of heights.slice(0, MAX_VIDEO_CHOICES)) {
    const candidates = videos.filter(f => f.height === height)
    // the format yt-dlp will pick under COMPATIBLE_SORT, for an honest size label
    const best = [...candidates].sort((a, b) => scoreVideo(b) - scoreVideo(a))[0]!
    const muxed = best.acodec && best.acodec !== 'none'
    const size = sizeOf(best) + (muxed ? 0 : audioSize)
    const sizeLabel = size > 0 ? ` · ~${formatBytes(size)}` : ''
    choices.push({kind: 'video', label: `${height}p · mp4${sizeLabel}`, args: videoArgs(height), suffix: ` [${height}p]`, size: size || undefined, height})
  }

  if (choices.length === 0) {
    choices.push({kind: 'video', label: `best ≤ ${FREE_MAX_HEIGHT}p · mp4`, args: videoArgs(), suffix: ''})
  }

  const audioSizeLabel = audioSize ? ` · ~${formatBytes(audioSize)}` : ''
  choices.push({kind: 'audio', label: `audio · mp3${audioSizeLabel}`, args: AUDIO_MP3, suffix: '', size: audioSize || undefined})
  if (audioOnly.some(f => f.ext === 'm4a' || f.acodec?.startsWith('mp4a'))) {
    choices.push({kind: 'audio', label: `audio · m4a${audioSizeLabel}`, args: AUDIO_M4A, suffix: '', size: audioSize || undefined})
  }
  return choices
}

/** The heights a video has above what Free draws (1440p, 4K, 8K): Axive draws those. */
export function heightsAboveFree(info: VideoInfo): number[] {
  const heights = (info.formats ?? []).filter(f => f.vcodec && f.vcodec !== 'none' && f.height && f.height > FREE_MAX_HEIGHT).map(f => f.height as number)
  return [...new Set(heights)].sort((a, b) => b - a)
}

function scoreVideo(f: RawFormat): number {
  let score = Math.min(f.tbr ?? 0, 99_999)
  if (f.vcodec?.startsWith('avc')) score += 1_000_000
  return score
}

function scoreAudio(f: RawFormat): number {
  return (f.abr ?? f.tbr ?? 0) + (f.acodec?.startsWith('mp4a') ? 100_000 : 0)
}

export const isYouTube = (info: Pick<VideoInfo, 'extractor_key'> | undefined) => /^youtube/i.test(info?.extractor_key ?? '')

// ---------------------------------------------------------------------------
// drawing

export type DownloadProgress = {
  downloadedBytes: number
  totalBytes?: number
  speed?: number
  eta?: number
  part: number
  /** How many files this download resolves to (video+audio merges are 2). */
  totalParts: number
}

export type DownloadHandlers = {
  onProgress: (progress: DownloadProgress) => void
  onProcessing: (what?: string) => void
  /** a file yt-dlp writes to (its .part pieces sit beside it): what a cancelled draw may leave behind */
  onDestination?: (file: string) => void
}

/** what a draw may be asked beyond its vessel (trim, chapters and a chosen thumbnail are Axive's) */
export type DrawOptions = Record<string, never>

export type DrawResult = {filepath?: string; skipped?: boolean; files: string[]}

const PROGRESS_PREFIX = 'AXIVE|'
const PROGRESS_TEMPLATE = `${PROGRESS_PREFIX}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`

export function clock(seconds: number): string {
  const s = Math.max(0, seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s - h * 3600 - m * 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`
}

/** Output template from the settings: optional sort folders, then the chosen name pattern. */
export function outputTemplate(dir: string, suffix: string, config: Config = getConfig()): string {
  const sub =
    config.organize === 'channel'
      ? '%(uploader,channel,uploader_id|unknown)s'
      : config.organize === 'date'
        ? '%(upload_date>%Y-%m|undated)s'
        : config.organize === 'channel-date'
          ? '%(uploader,channel,uploader_id|unknown)s/%(upload_date>%Y-%m|undated)s'
          : ''
  const name =
    config.naming === 'title-id'
      ? '%(title).90B [%(id)s]'
      : config.naming === 'uploader-title'
        ? '%(uploader,channel|unknown).40B - %(title).80B'
        : config.naming === 'date-title'
          ? '%(upload_date>%Y-%m-%d|undated)s %(title).90B'
          : '%(title).100B'
  return path.join(dir, ...(sub ? [sub] : []), `${name}${suffix}.%(ext)s`)
}

export function postArgs(choice: DownloadChoice, config: Config = getConfig()): string[] {
  const args: string[] = []
  if (choice.kind === 'video' || choice.kind === 'audio') {
    if (config.embedMetadata) args.push('--embed-metadata')
    if (config.embedThumbnail) args.push('--embed-thumbnail', '--convert-thumbnails', 'jpg')
  }
  return args
}

export function download(
  opts: {
    tools: Tools
    url: string
    /** reuse a probe's metadata: starts at once instead of re-extracting */
    infoJsonPath?: string
    choice: DownloadChoice
    outDir: string
    /** full -o template; replaces the settings-based one */
    outputTemplate?: string
    options?: DrawOptions
    job?: string
    /** skip the archive even when the settings keep one */
    archive?: string | false
    extraArgs?: string[]
  },
  handlers: DownloadHandlers,
  signal?: AbortSignal,
): Promise<DrawResult> {
  const config = getConfig()
  const {choice} = opts
  const archive = opts.archive === false ? undefined : opts.archive ?? (config.skipArchived ? paths.archive : undefined)
  const args = [
    ...sharedArgs(opts.tools),
    ...RETRY_ARGS,
    ...(config.rateLimit ? ['--limit-rate', config.rateLimit] : []),
    ...(archive ? ['--download-archive', archive] : []),
    ...(opts.infoJsonPath ? ['--load-info-json', opts.infoJsonPath] : []),
    ...choice.args,
    ...postArgs(choice, config),
    ...(opts.extraArgs ?? []),
    // HLS/DASH fragments in parallel; single-file formats are unaffected
    '--concurrent-fragments',
    '8',
    '--newline',
    // --print implies --quiet, which hides the progress lines and the
    // [Merger]/[ExtractAudio] lines the processing phase is read from
    '--no-quiet',
    '--progress',
    '--progress-template',
    `download:${PROGRESS_TEMPLATE}`,
    '--print',
    'after_move:filepath',
    '--no-simulate',
    '-o',
    opts.outputTemplate ?? outputTemplate(opts.outDir, choice.suffix, config),
    ...(opts.infoJsonPath ? [] : ['--', opts.url]),
  ]

  return new Promise((resolve, reject) => {
    const child = run(opts.tools.ytdlp, args, signal, opts.job)
    let stderr = ''
    let stdoutTail = ''
    const files: string[] = []
    let skipped = false
    let part = 0
    let totalParts = 1
    let lastDownloaded = 0
    let buffer = ''
    // every file yt-dlp writes this run, so a cancel can clean up after itself
    const destinations: string[] = []

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const rawText of lines) {
        const line = rawText.trim()
        if (!line) continue
        if (line.startsWith(PROGRESS_PREFIX)) {
          const [downloaded, total, totalEstimate, speed, eta] = line.slice(PROGRESS_PREFIX.length).split('|')
          const downloadedBytes = toNumber(downloaded) ?? 0
          if (downloadedBytes < lastDownloaded) part++
          lastDownloaded = downloadedBytes
          handlers.onProgress({
            downloadedBytes,
            totalBytes: toNumber(total) ?? toNumber(totalEstimate),
            speed: toNumber(speed),
            eta: toNumber(eta),
            part,
            totalParts,
          })
          continue
        }
        stdoutTail = (stdoutTail + line + '\n').slice(-12_000)
        if (opts.job) rawLine(opts.job, line)
        if (line.includes('Downloading 1 format(s):')) {
          // "[info] xxx: Downloading 1 format(s): 395+251" — each id is one file
          totalParts = (line.split('format(s):')[1] ?? '').trim().split('+').length
        } else if (line.includes('has already been recorded in the archive')) {
          skipped = true
        } else if (/^\[(Merger|ExtractAudio|EmbedThumbnail|FFmpeg\w*|SponsorBlock|ModifyChapters|SplitChapters|Metadata)\]/.test(line)) {
          const merging = /^\[Merger\] Merging formats into "(.+)"$/.exec(line)?.[1]
          const extracting = /^\[ExtractAudio\] Destination: (.+)$/.exec(line)?.[1]
          const target = merging ?? extracting
          if (target) (destinations.push(target), handlers.onDestination?.(target))
          handlers.onProcessing(/^\[(\w+)/.exec(line)?.[1])
        } else if (line.startsWith('[download] Destination: ')) {
          const target = line.slice('[download] Destination: '.length)
          destinations.push(target)
          handlers.onDestination?.(target)
        } else if (path.isAbsolute(line) && !line.startsWith('[')) {
          files.push(line)
        }
      }
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
      if (opts.job) for (const line of String(chunk).split('\n')) rawLine(opts.job, line, 'err')
    })
    child.on('error', reject)
    child.on('close', code => {
      if (signal?.aborted) {
        // cancelled on purpose — don't leave half-written files behind
        // (a pause aborts too, but keeps the .part files: see jobs.ts)
        if ((signal.reason as {keepPartials?: boolean} | undefined)?.keepPartials !== true) void removePartials(destinations)
        reject(new CancelledError())
        return
      }
      if (code === 0 && (files.length || skipped)) {
        resolve({filepath: files.at(-1), skipped: skipped && !files.length, files})
      } else {
        const error = new ToolError(cleanYtDlpError(stderr) || `the draw failed (yt-dlp exit code ${code})`, `${stderr}\n${stdoutTail}`, [opts.tools.ytdlp, ...args])
        reject(error)
      }
    })
  })
}

export async function removePartials(destinations: string[]): Promise<void> {
  await Promise.allSettled(
    destinations.map(async dest => {
      const dir = path.dirname(dest)
      const base = path.basename(dest)
      const ext = path.extname(base)
      const stem = base.slice(0, base.length - ext.length)
      const names = await fs.readdir(dir).catch(() => [] as string[])
      // the file itself, its .part, and -N's .part-FragN pieces; ffmpeg's half-merged
      // "<name>.temp.<ext>"; and the cover written beside it to be embedded
      const doomed = names.filter(
        name =>
          name === base ||
          name.startsWith(`${base}.part`) ||
          name === `${base}.ytdl` ||
          (ext && name === `${stem}.temp${ext}`) ||
          (ext && /^\.(jpe?g|webp|png)$/i.test(name.slice(stem.length)) && name.startsWith(stem) && name.length > stem.length && name[stem.length] === '.'),
      )
      // a killed ffmpeg can hold its handle for a moment after taskkill returns
      await Promise.allSettled(doomed.map(name => fs.rm(path.join(dir, name), {force: true, maxRetries: 10, retryDelay: 200})))
    }),
  )
}

function toNumber(value: string | undefined): number | undefined {
  if (!value || value === 'NA' || value === 'None') return undefined
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : undefined
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Make text safe as a Windows file name (no extension handling). */
export function sanitizeName(name: string): string {
  let out = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  if (out.length > 120) out = out.slice(0, 120).replace(/[. ]+$/, '')
  if (RESERVED.test(out.split('.')[0] ?? '')) out = `_${out}`
  return out || 'axive'
}

export const tempDir = () => ensureDir(path.join(os.tmpdir(), 'axive'))
