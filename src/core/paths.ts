import {execFile} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const IS_WIN = process.platform === 'win32'
export const EXE = IS_WIN ? '.exe' : ''
export const SYSTEM32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')

/** true inside Axive.exe. node:sea is fetched at runtime: esbuild strips the node: prefix that module needs */
export function isSea(): boolean {
  try {
    return process.getBuiltinModule?.('node:sea')?.isSea() ?? false
  } catch {
    return false
  }
}

let root: string | undefined

/**
 * Where Axive keeps its tools, settings, ledger and logs:
 *  - AXIVE_HOME, when set (tests, power users)
 *  - an `axive-data` folder next to Axive.exe: portable mode, carry it on a stick
 *  - %LOCALAPPDATA%\Axive on Windows (XDG / Application Support elsewhere)
 */
export function dataRoot(): string {
  if (root) return root
  if (process.env.AXIVE_HOME) return (root = path.resolve(process.env.AXIVE_HOME))
  if (isSea()) {
    const beside = path.join(path.dirname(process.execPath), 'axive-free-data')
    if (fs.existsSync(beside)) return (root = beside)
  }
  return (root = defaultRoot())
}

/** The installed data folder, whatever AXIVE_HOME or a portable folder says. */
export function defaultRoot(): string {
  if (IS_WIN) return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Axive Free')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Axive Free')
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'axive-free')
}

export const portable = () => isSea() && dataRoot() === path.join(path.dirname(process.execPath), 'axive-free-data')

const at = (...parts: string[]) => path.join(dataRoot(), ...parts)

export const paths = {
  get root() {
    return dataRoot()
  },
  get bin() {
    return at('bin')
  },
  get config() {
    return at('config.json')
  },
  get ledger() {
    return at('ledger.jsonl')
  },
  get inputs() {
    return at('recent-links.json')
  },
  get archive() {
    return at('archive.txt')
  },
  get vigils() {
    return at('vigils.json')
  },
  get vigilArchives() {
    return at('vigils')
  },
  get recipes() {
    return at('recipes.json')
  },
  get queue() {
    return at('queue.json')
  },
  get cookies() {
    return at('cookies.txt')
  },
  get logs() {
    return at('logs')
  },
  get reports() {
    return at('logs', 'reports')
  },
  get cache() {
    return at('cache')
  },
  get state() {
    return at('state.json')
  },
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, {recursive: true})
  return dir
}

/** Write a file so a crash mid-write never leaves it half-written. */
export function writeFileAtomic(file: string, data: string, mode?: number): void {
  ensureDir(path.dirname(file))
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, data, mode === undefined ? undefined : {mode})
  fs.renameSync(temp, file)
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** ~\Downloads, or wherever the user moved their Downloads folder to. */
export const fallbackDownloads = () => path.join(os.homedir(), 'Downloads')

let downloadsCache: string | undefined

export function downloadsFolder(): Promise<string> {
  if (downloadsCache) return Promise.resolve(downloadsCache)
  if (!IS_WIN) return Promise.resolve((downloadsCache = fallbackDownloads()))
  // the Downloads known folder; the registry holds it unexpanded (%USERPROFILE%\Downloads)
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders'
  return new Promise(resolve => {
    execFile(
      path.join(SYSTEM32, 'reg.exe'),
      ['query', key, '/v', '{374DE290-123F-4565-9164-39C4925E467B}'],
      {windowsHide: true, timeout: 3000},
      (error, stdout) => {
        const raw = error ? undefined : /REG_(?:EXPAND_)?SZ\s+(.+)$/m.exec(stdout)?.[1]?.trim()
        const expanded = raw?.replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? `%${name}%`)
        downloadsCache = expanded && !expanded.includes('%') && path.isAbsolute(expanded) ? expanded : fallbackDownloads()
        resolve(downloadsCache)
      },
    )
  })
}

/** "~\Videos\clip.mp4" for display — and so screenshots don't carry the user's name. */
export function prettyPath(filepath: string): string {
  const home = os.homedir()
  if (filepath.toLowerCase().startsWith(home.toLowerCase())) return `~${filepath.slice(home.length)}`
  return filepath
}
