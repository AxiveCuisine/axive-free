import {execFile, spawnSync} from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {logEvent, setVersion} from './log.js'
import {EXE, IS_WIN, SYSTEM32, ensureDir, isSea, paths, readJson, writeFileAtomic} from './paths.js'

/**
 * The binaries Axive drives, and how they get onto the machine.
 *
 * Axive.exe carries them inside itself (Node single-executable assets):
 * yt-dlp, ffmpeg + ffprobe, a node runtime for yt-dlp's YouTube solver,
 * aria2 for the download manager, the native host, and the icon. On first launch they are unpacked into
 * <data>\bin; on every launch the unpacked copies are checked against the
 * SHA-256 recorded at build time, and anything missing or altered can be
 * restored from the exe itself — no network needed. That is what makes a
 * lone Axive.exe work wherever it is put.
 *
 * While developing (plain node), AXIVE_BIN or ./build/bin holds the same layout.
 */

export type Tools = {
  ytdlp: string
  ffmpegDir?: string
  /** a real node for yt-dlp's JavaScript challenge solver */
  node?: string
  host?: string
  /** aria2c: the download manager's engine */
  aria2?: string
}

export type PayloadItem = {
  name: string
  asset: string
  kind: 'zip' | 'raw'
  /** folder (zip) or file (raw), relative to bin */
  dest: string
  /** file whose hash proves the item is intact, relative to bin */
  check: string
  sha256: string
  size: number
}

export type Payload = {version: string; items: PayloadItem[]}

type InstalledState = {payload?: string; ytdlp?: {version: string; sha256: string}}

const stateFile = () => path.join(paths.bin, 'installed.json')

function seaModule(): {getRawAsset(key: string): ArrayBuffer} | undefined {
  try {
    return process.getBuiltinModule?.('node:sea') as unknown as {getRawAsset(key: string): ArrayBuffer}
  } catch {
    return undefined
  }
}

export function payload(): Payload | undefined {
  if (!isSea()) return undefined
  try {
    const raw = seaModule()?.getRawAsset('payload.json')
    const pack = raw ? (JSON.parse(Buffer.from(raw).toString('utf8')) as Payload) : undefined
    // every path in the manifest must stay inside bin: a relative name, no way up
    if (pack && !pack.items.every(item => [item.asset, item.dest, item.check].every(insideBin))) return undefined
    return pack
  } catch {
    return undefined
  }
}

const insideBin = (rel: unknown): boolean =>
  typeof rel === 'string' && /^[\w.-]+(\/[\w.-]+)*$/.test(rel) && !rel.split('/').includes('..') && !path.isAbsolute(rel)

/** The bin folder: the unpacked payload, or a developer's override. */
export function binDir(): string {
  if (process.env.AXIVE_BIN) return path.resolve(process.env.AXIVE_BIN)
  if (isSea()) return paths.bin
  const script = path.dirname(path.resolve(process.argv[1] ?? '.'))
  const dev = path.join(script, '..', 'build', 'bin')
  return fs.existsSync(dev) ? dev : paths.bin
}

/** yt-dlp + friends, by absolute path — a bare `spawn('yt-dlp')` searches the current folder first on Windows. */
export function resolveTools(): Tools {
  const bin = binDir()
  const first = (...candidates: string[]) => candidates.map(c => path.join(bin, c)).find(c => fs.existsSync(c))
  const ytdlp = first(`yt-dlp/yt-dlp${EXE}`, `yt-dlp${EXE}`)
  if (!ytdlp) throw new ToolsMissingError(`yt-dlp is missing from ${bin}`)
  const ffmpeg = first(`ffmpeg/ffmpeg${EXE}`, `ffmpeg${EXE}`)
  return {
    ytdlp,
    ffmpegDir: ffmpeg ? path.dirname(ffmpeg) : undefined,
    node: first(`node/node${EXE}`, `node${EXE}`) ?? (isSea() ? undefined : process.execPath),
    host: first(`host/axive-host${EXE}`, `axive-host${EXE}`),
    aria2: first(`aria2/aria2c${EXE}`, `aria2c${EXE}`),
  }
}


export class ToolsMissingError extends Error {
  readonly missing = true
}

let cached: Tools | undefined
export function tools(): Tools {
  return (cached ??= resolveTools())
}
export function forgetTools(): void {
  cached = undefined
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    fs.createReadStream(file)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

// ---------------------------------------------------------------------------
// install / verify / repair

export type ToolHealth = {name: string; ok: boolean; reason?: string}

/** Quick: is every payload item present? (No hashing — runs before the first frame.) */
export function needsSetup(): boolean {
  const pack = payload()
  if (!pack) return false
  const state = readJson<InstalledState>(stateFile(), {})
  if (state.payload !== pack.version) return true
  return pack.items.some(item => !fs.existsSync(path.join(paths.bin, item.check)))
}

// what runs a tool waits while a first launch (or a new build) unpacks them: an aria2
// or yt-dlp started from the old folder would hold it and the unpack would fail
let readyWaiters: (() => void)[] = []

/** Resolves once every carried tool is unpacked (at once when they are, or in a dev checkout). */
export function whenToolsReady(): Promise<void> {
  if (!needsSetup()) return Promise.resolve()
  return new Promise(resolve => readyWaiters.push(resolve))
}

/** Full: hash every check file against the build-time record (or the renewed yt-dlp's own). */
export async function verifyTools(): Promise<ToolHealth[]> {
  const pack = payload()
  if (!pack) {
    try {
      resolveTools()
      return [{name: 'tools', ok: true}]
    } catch (error) {
      return [{name: 'yt-dlp', ok: false, reason: (error as Error).message}]
    }
  }
  const state = readJson<InstalledState>(stateFile(), {})
  const out: ToolHealth[] = []
  for (const item of pack.items) {
    const file = path.join(paths.bin, item.check)
    if (!fs.existsSync(file)) {
      out.push({name: item.name, ok: false, reason: 'missing'})
      continue
    }
    const expected = item.name === 'yt-dlp' && state.ytdlp ? state.ytdlp.sha256 : item.sha256
    const actual = await sha256File(file).catch(() => '')
    out.push(actual === expected ? {name: item.name, ok: true} : {name: item.name, ok: false, reason: 'altered'})
  }
  return out
}

/**
 * Unpack payload items (all, or the named ones) into bin. Each zip lands in
 * a fresh folder that only replaces the old one once its check file hashes
 * right, so a failed repair never leaves things worse than before.
 */
export async function installTools(only?: string[], onStep?: (label: string, done: number, total: number) => void, opts: {complete?: boolean} = {}): Promise<void> {
  try {
    await unpackTools(only, onStep, opts)
  } finally {
    // the whole set has landed, or failed: whoever waited goes on and meets the result
    if (!only || opts.complete) for (const resolve of readyWaiters.splice(0)) resolve()
  }
}

async function unpackTools(only: string[] | undefined, onStep: ((label: string, done: number, total: number) => void) | undefined, opts: {complete?: boolean}): Promise<void> {
  const pack = payload()
  const sea = seaModule()
  if (!pack || !sea) throw new Error('this build carries no tools to unpack')
  const bin = ensureDir(paths.bin)
  // folders an earlier unpack set aside and could not delete then
  for (const name of fs.readdirSync(bin)) if (name.endsWith('.old')) await fs.promises.rm(path.join(bin, name), {recursive: true, force: true}).catch(() => undefined)
  const staging = ensureDir(path.join(bin, '.staging'))
  const items = pack.items.filter(item => !only || only.includes(item.name))
  let index = 0
  for (const item of items) {
    onStep?.(item.name, index++, items.length)
    const bytes = Buffer.from(sea.getRawAsset(item.asset))
    // written without blocking: the window keeps drawing its progress while an antivirus reads each file
    if (item.kind === 'raw') {
      const dest = path.join(bin, item.dest)
      ensureDir(path.dirname(dest))
      const temp = `${dest}.new`
      await fs.promises.writeFile(temp, bytes)
      await fs.promises.rm(dest, {force: true, maxRetries: 10, retryDelay: 250})
      await renameWhenFree(temp, dest)
    } else {
      const archive = path.join(staging, item.asset)
      await fs.promises.writeFile(archive, bytes)
      const fresh = path.join(bin, `${item.dest}.new`)
      fs.rmSync(fresh, {recursive: true, force: true})
      ensureDir(fresh)
      await unzip(archive, fresh)
      fs.rmSync(archive, {force: true})
      const check = path.join(fresh, path.relative(item.dest, item.check))
      const actual = await sha256File(check).catch(() => '')
      if (actual !== item.sha256) {
        fs.rmSync(fresh, {recursive: true, force: true})
        throw new Error(`${item.name} did not unpack cleanly`)
      }
      const dest = path.join(bin, item.dest)
      // the old folder steps aside under a name of its own; a file in it that is still held (a scan, a
      // tool still running) only means it goes on a later start, never that the new one fails
      const old = `${dest}.${Date.now().toString(16)}.old`
      if (fs.existsSync(dest)) await renameWhenFree(dest, old)
      await renameWhenFree(fresh, dest)
      await fs.promises.rm(old, {recursive: true, force: true, maxRetries: 10, retryDelay: 250}).catch(() => undefined)
    }
    if (item.name === 'yt-dlp') {
      const state = readJson<InstalledState>(stateFile(), {})
      delete state.ytdlp
      writeFileAtomic(stateFile(), JSON.stringify(state))
    }
  }
  onStep?.('done', items.length, items.length)
  fs.rmSync(staging, {recursive: true, force: true})
  const state = readJson<InstalledState>(stateFile(), {})
  // a split install marks the payload whole once its last part lands
  if (!only || opts.complete) state.payload = pack.version
  writeFileAtomic(stateFile(), JSON.stringify(state))
  forgetTools()
  logEvent('info', `tools unpacked: ${items.map(i => i.name).join(', ')}`)
}

/**
 * Rename, waiting out Windows: an antivirus scanning a freshly unpacked exe
 * (aria2c and yt-dlp especially) holds its folder for a few seconds, and the
 * move fails with EPERM/EBUSY/EACCES until it lets go.
 */
export async function renameWhenFree(from: string, to: string, attempts = 40): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      fs.renameSync(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (i >= attempts || !(code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) throw error
      await new Promise(r => setTimeout(r, Math.min(1000, 100 * i)))
    }
  }
}

/** After a yt-dlp renewal: remember the new binary's hash so verification trusts it. */
export async function recordRenewedYtdlp(version: string): Promise<void> {
  const file = tools().ytdlp
  const state = readJson<InstalledState>(stateFile(), {})
  state.ytdlp = {version, sha256: await sha256File(file)}
  writeFileAtomic(stateFile(), JSON.stringify(state))
}

export function unzip(archive: string, dest: string): Promise<void> {
  // bsdtar ships with Windows 10 1803+ and reads zip
  const tar = IS_WIN ? path.join(SYSTEM32, 'tar.exe') : 'unzip'
  const args = IS_WIN ? ['-xf', archive, '-C', dest] : ['-q', '-o', archive, '-d', dest]
  return new Promise((resolve, reject) => {
    execFile(tar, args, {windowsHide: true, timeout: 5 * 60_000}, error => (error ? reject(new Error(`unpacking failed: ${error.message}`)) : resolve()))
  })
}

// ---------------------------------------------------------------------------
// versions

export function ytdlpVersion(t: Tools = tools()): string {
  try {
    const out = spawnSync(t.ytdlp, ['--version'], {encoding: 'utf8', windowsHide: true, timeout: 15_000})
    const version = out.stdout.trim().split(/\s+/)[0] ?? ''
    if (version) setVersion('yt-dlp', version)
    return version
  } catch {
    return ''
  }
}

export function ffmpegVersion(t: Tools = tools()): string {
  if (!t.ffmpegDir) return ''
  try {
    const out = spawnSync(path.join(t.ffmpegDir, `ffmpeg${EXE}`), ['-hide_banner', '-version'], {encoding: 'utf8', windowsHide: true, timeout: 10_000})
    const version = /ffmpeg version (\S+)/.exec(out.stdout)?.[1] ?? ''
    if (version) setVersion('ffmpeg', version)
    return version
  } catch {
    return ''
  }
}
