import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {RELEASES as FREE_RELEASES} from './brand.js'
import {getConfig} from './config.js'
import {logEvent} from './log.js'
import {IS_WIN, ensureDir, paths, readJson, writeFileAtomic} from './paths.js'
import {forgetTools, recordRenewedYtdlp, renameWhenFree, tools, unzip, ytdlpVersion} from './tools.js'
import {collect} from './ytdlp.js'

/**
 * Renewal. yt-dlp breaks whenever a big site changes, so Axive looks for a
 * newer release once a day and renews it on request: the release zip is
 * fetched from GitHub, checked against the SHA2-256SUMS file published with
 * it, unpacked beside the old copy, tried, and only then swapped in.
 *
 * Axive Free checks its own GitHub releases and says when a newer build
 * exists (it does not replace itself).
 */

const RELEASES = 'https://github.com/yt-dlp/yt-dlp/releases'
const ASSET = 'yt-dlp_win.zip'
const DAY = 24 * 60 * 60 * 1000

type UpdateState = {checkedAt?: number; ytdlpLatest?: string; axiveLatest?: string; axiveUrl?: string; axiveNotes?: string}

const stateFile = () => path.join(paths.root, 'updates.json')

/** "2026.10.12" style versions compare as dotted numbers */
export function newer(candidate: string | undefined, current: string | undefined): boolean {
  if (!candidate || !current) return false
  const a = candidate.replace(/^v/, '').split(/[.\-]/).map(n => Number.parseInt(n, 10) || 0)
  const b = current.replace(/^v/, '').split(/[.\-]/).map(n => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

/** The newest stable yt-dlp tag, read from where /releases/latest redirects. */
export const latestYtdlp = (signal?: AbortSignal) => latestTag(RELEASES, signal)

/** The newest release tag of a GitHub project, from where /releases/latest redirects (no API, no rate limit). */
async function latestTag(releases: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${releases}/latest`, {redirect: 'manual', signal: signal ?? AbortSignal.timeout(15_000), headers: {'User-Agent': 'Axive'}})
  const location = res.headers.get('location') ?? ''
  const tag = /\/tag\/([^/?#]+)/.exec(location)?.[1]
  if (!tag) throw new Error(`could not read the latest release of ${releases}`)
  return decodeURIComponent(tag)
}

export type UpdateNews = {ytdlp?: {current: string; latest: string}; axive?: {current: string; latest: string; url?: string; notes?: string}}

/** At most once a day, unless forced. Never throws. */
export async function checkForUpdates(force = false): Promise<UpdateNews> {
  const news: UpdateNews = {}
  if (!getConfig().checkUpdates && !force) return news
  const state = readJson<UpdateState>(stateFile(), {})
  const fresh = !force && state.checkedAt && Date.now() - state.checkedAt < DAY
  try {
    if (!fresh) {
      state.ytdlpLatest = await latestYtdlp().catch(() => state.ytdlpLatest)
      const free = await latestTag(FREE_RELEASES).catch(() => undefined)
      if (free && /^v?\d+\.\d+\.\d+$/.test(free)) {
        state.axiveLatest = free.replace(/^v/, '')
        state.axiveUrl = `${FREE_RELEASES}/latest`
      }
      state.checkedAt = Date.now()
      writeFileAtomic(stateFile(), JSON.stringify(state))
    }
    const current = ytdlpVersion()
    if (newer(state.ytdlpLatest, current)) news.ytdlp = {current, latest: state.ytdlpLatest!}
    if (newer(state.axiveLatest, __AXIVE_VERSION__)) news.axive = {current: __AXIVE_VERSION__, latest: state.axiveLatest!, url: state.axiveUrl, notes: state.axiveNotes}
  } catch (error) {
    logEvent('warn', `update check failed: ${(error as Error).message}`)
  }
  return news
}

async function fetchBuffer(url: string, signal?: AbortSignal): Promise<Buffer> {
  const res = await fetch(url, {signal: signal ?? AbortSignal.timeout(5 * 60_000), headers: {'User-Agent': 'Axive'}})
  if (!res.ok) throw new Error(`${path.basename(url)}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Renew yt-dlp in place. Resolves with a line for the screen. On anything
 * but Windows' folder build, yt-dlp's own updater does the work.
 */
export async function renewYtdlp(onStage?: (stage: string) => void, signal?: AbortSignal): Promise<string> {
  const t = tools()
  const before = ytdlpVersion(t)
  const folderBuild = IS_WIN && path.basename(path.dirname(t.ytdlp)) === 'yt-dlp' && fs.existsSync(path.join(path.dirname(t.ytdlp), '_internal'))
  if (!folderBuild) {
    onStage?.('asking yt-dlp to renew itself')
    const {stdout, stderr} = await collect(t.ytdlp, ['--ignore-config', '-U'], signal)
    const last = `${stdout}\n${stderr}`.split('\n').map(l => l.trim()).filter(Boolean).at(-1) ?? ''
    const after = ytdlpVersion(t)
    if (after && after !== before) await recordRenewedYtdlp(after)
    return after && after !== before ? `yt-dlp renewed: ${before} → ${after}` : last || `yt-dlp ${after} is current`
  }

  onStage?.('looking for the newest yt-dlp')
  const latest = await latestYtdlp(signal)
  if (!newer(latest, before)) return `yt-dlp ${before} is already the newest`
  onStage?.(`fetching yt-dlp ${latest}`)
  const [sums, zip] = await Promise.all([fetchBuffer(`${RELEASES}/download/${latest}/SHA2-256SUMS`, signal), fetchBuffer(`${RELEASES}/download/${latest}/${ASSET}`, signal)])
  const expected = sums
    .toString('utf8')
    .split('\n')
    .map(line => line.trim().split(/\s+/))
    .find(([, name]) => name === ASSET)?.[0]
  const actual = crypto.createHash('sha256').update(zip).digest('hex')
  if (!expected || expected.toLowerCase() !== actual) throw new Error('the download did not match its published checksum. nothing was changed')

  onStage?.('unpacking')
  const home = path.dirname(t.ytdlp)
  const staging = ensureDir(path.join(paths.bin, '.staging'))
  const archive = path.join(staging, ASSET)
  fs.writeFileSync(archive, zip)
  const fresh = `${home}.new`
  fs.rmSync(fresh, {recursive: true, force: true})
  ensureDir(fresh)
  await unzip(archive, fresh)
  fs.rmSync(archive, {force: true})
  // yt-dlp.exe + _internal, at the zip's root or one folder down
  let root = fresh
  if (!fs.existsSync(path.join(root, 'yt-dlp.exe'))) {
    root = fs
      .readdirSync(fresh)
      .map(name => path.join(fresh, name))
      .find(dir => fs.existsSync(path.join(dir, 'yt-dlp.exe'))) ?? fresh
  }
  const freshExe = path.join(root, 'yt-dlp.exe')
  if (!fs.existsSync(freshExe)) throw new Error('the new yt-dlp is not where it should be. nothing was changed')
  onStage?.('trying it')
  const tried = ytdlpVersion({...t, ytdlp: freshExe})
  if (!tried) throw new Error('the new yt-dlp would not start. nothing was changed')

  // the old folder steps aside under a name of its own (a scan may hold it a moment); a swap
  // that fails half way puts it back. Its new hash is recorded before anything is tidied, so a
  // folder that will not delete yet can never make the new yt-dlp look tampered with
  const old = `${home}.${Date.now().toString(16)}.old`
  await renameWhenFree(home, old)
  try {
    await renameWhenFree(root, home)
  } catch (error) {
    await renameWhenFree(old, home).catch(() => undefined)
    throw new Error(`the new yt-dlp could not be put in place (${(error as Error).message}). nothing was changed`)
  }
  forgetTools()
  await recordRenewedYtdlp(tried)
  await fs.promises.rm(fresh, {recursive: true, force: true}).catch(() => undefined)
  await fs.promises.rm(old, {recursive: true, force: true, maxRetries: 5, retryDelay: 300}).catch(() => undefined)
  logEvent('info', `yt-dlp renewed ${before} -> ${tried}`)
  return `yt-dlp renewed: ${before} → ${tried}`
}
