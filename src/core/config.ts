import {fallbackDownloads, paths, readJson, writeFileAtomic} from './paths.js'
import {createStore, useStore} from './store.js'
import {setPlainWords} from './words.js'

export const THEME_MODES = ['abyss', 'ash', 'auto'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

/** the highest a video comes in Axive Free; 1440p, 4K and 8K are Axive's */
export const FREE_MAX_HEIGHT = 1080
/** draws and fetches side by side in Axive Free */
export const FREE_MAX_TUNNELS = 2

// ---------------------------------------------------------------------------
// the shape kept inside the settings file for file categories. Defined here
// (not in categories.ts) so this module imports none of its users.

export type Category = {id: string; name: string; exts: string[]; patterns: string[]; /** absolute folder, '' = <download folder>/<name> */ folder: string}

/** a speed limit: '' for none, else bytes per second with an optional K, M or G (1024s) */
export const RATE = /^(\d+(?:\.\d+)?)\s*([KMG])?(?:i?B)?(?:\/s)?$/i
const clean = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max && !/[\r\n\0]/.test(v) ? v.trim() : undefined)

export const DEFAULT_CATEGORIES: Category[] = [
  {id: 'compressed', name: 'Compressed', exts: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', 'zst', 'lz', 'lzma', 'cab', 'arj', 'z'], patterns: [], folder: ''},
  {id: 'programs', name: 'Programs', exts: ['exe', 'msi', 'msix', 'msixbundle', 'appx', 'appxbundle', 'apk', 'xapk', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'iso', 'img', 'vhd', 'vhdx', 'jar', 'bin', 'run'], patterns: [], folder: ''},
  {id: 'videos', name: 'Videos', exts: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg', '3gp', 'ts', 'm2ts', 'mts', 'vob', 'ogv'], patterns: [], folder: ''},
  {id: 'music', name: 'Music', exts: ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus', 'wma', 'alac', 'aiff', 'ape', 'mka'], patterns: [], folder: ''},
  {id: 'pictures', name: 'Pictures', exts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg', 'heic', 'heif', 'avif', 'ico', 'psd', 'raw', 'cr2', 'nef', 'dng'], patterns: [], folder: ''},
  {id: 'documents', name: 'Documents', exts: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'txt', 'rtf', 'csv', 'epub', 'mobi', 'azw3', 'djvu', 'cbz', 'cbr', 'md'], patterns: [], folder: ''},
  {id: 'other', name: 'Other', exts: [], patterns: [], folder: ''},
]

export function sanitizeCategory(raw: unknown): Category | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const c = raw as Record<string, unknown>
  const id = typeof c.id === 'string' && /^[a-z0-9-]{1,32}$/.test(c.id) ? c.id : undefined
  const name = clean(c.name, 40)
  if (!id || !name || /[<>:"/\\|?*]/.test(name)) return undefined
  const exts = Array.isArray(c.exts) ? [...new Set(c.exts.map(e => (typeof e === 'string' ? e.trim().toLowerCase().replace(/^\./, '') : '')).filter(e => /^[a-z0-9]{1,12}$/.test(e)))].slice(0, 200) : []
  const patterns = Array.isArray(c.patterns) ? c.patterns.map(p => clean(p, 200)).filter((p): p is string => Boolean(p)).slice(0, 50) : []
  const folder = clean(c.folder, 1024) ?? ''
  return {id, name, exts, patterns, folder}
}

/** a valid list that always ends with Other */
export function sanitizeCategories(raw: unknown): Category[] {
  if (!Array.isArray(raw)) return DEFAULT_CATEGORIES.map(c => ({...c, exts: [...c.exts], patterns: []}))
  const seen = new Set<string>()
  const list = raw.map(sanitizeCategory).filter((c): c is Category => Boolean(c && !seen.has(c.id) && seen.add(c.id))).slice(0, 50)
  const other = list.find(c => c.id === 'other') ?? {...DEFAULT_CATEGORIES.at(-1)!}
  return [...list.filter(c => c.id !== 'other'), other]
}

/**
 * Everything the settings screen (and `config set`) can change. Kept flat so
 * every key is addressable from a terminal: `config set animations off`.
 */
export type Config = {
  theme: ThemeMode
  /** ask where to put each draw */
  askWhere: boolean
  folder: string
  organize: 'none' | 'channel' | 'date' | 'channel-date'
  naming: 'title' | 'title-id' | 'uploader-title' | 'date-title'
  /** downloads that run side by side */
  tunnels: number
  /** one speed limit for everything: '' for none, else e.g. 2M, 500K */
  rateLimit: string
  retries: number
  /** the download manager: parallel connections (segments) per file, 1-16 */
  fetchConnections: number
  /** a direct video or audio file link goes to the download manager (many connections) instead of yt-dlp (one) */
  fetchMediaFiles: boolean
  /** keep a download archive and skip anything already drawn */
  skipArchived: boolean
  warnDuplicates: boolean
  embedMetadata: boolean
  embedThumbnail: boolean
  checkUpdates: boolean
  animations: boolean
  grandSigil: boolean
  hoverHints: boolean
  vignette: boolean
  openInTerminal: boolean
  /** Simple Language: everyday words instead of the house's own */
  plainWords: boolean
  /** file types and where they rest */
  categories: Category[]
  /** file fetches into a folder per category */
  categoryFolders: boolean
  /** when a file of the same name is already there */
  onDuplicate: 'number' | 'overwrite' | 'skip' | 'ask'
  /** after a server refused many connections, add one back each minute */
  climbBack: boolean
}

export const DEFAULTS: Config = {
  theme: 'abyss',
  askWhere: false,
  folder: '',
  organize: 'none',
  naming: 'title',
  tunnels: 2,
  rateLimit: '',
  retries: 3,
  fetchConnections: 16,
  fetchMediaFiles: true,
  skipArchived: false,
  warnDuplicates: true,
  embedMetadata: true,
  embedThumbnail: true,
  checkUpdates: true,
  animations: true,
  grandSigil: true,
  hoverHints: true,
  vignette: true,
  openInTerminal: true,
  plainWords: false,
  categories: sanitizeCategories(undefined),
  categoryFolders: false,
  onDuplicate: 'number',
  climbBack: true,
}

type Kind = 'bool' | 'enum' | 'int' | 'string' | 'json'

export type FieldMeta = {
  kind: Kind
  label: string
  help: string
  options?: readonly string[]
  min?: number
  max?: number
  /** never printed in full, never logged */
  secret?: boolean
  section?: string
}

export const META: Record<keyof Config, FieldMeta> = {
  theme: {kind: 'enum', options: THEME_MODES, label: 'theme', help: 'abyss (bone on black water), ash (grey), auto (your terminal colours)'},
  askWhere: {kind: 'bool', label: 'ask where each draw rests', help: 'ask for a folder before drawing'},
  folder: {kind: 'string', label: 'default folder', help: 'where draws rest when Axive Free does not ask'},
  organize: {kind: 'enum', options: ['none', 'channel', 'date', 'channel-date'], label: 'sort into folders', help: 'none, by channel, by upload month, or both'},
  naming: {kind: 'enum', options: ['title', 'title-id', 'uploader-title', 'date-title'], label: 'file names', help: 'how finished files are named'},
  tunnels: {kind: 'int', min: 1, max: FREE_MAX_TUNNELS, label: 'tunnels', help: `how many downloads run side by side (1-${FREE_MAX_TUNNELS})`},
  rateLimit: {kind: 'string', label: 'speed limit', help: 'for everything together, like 2M or 500K; empty for none'},
  fetchConnections: {kind: 'int', min: 1, max: 16, label: 'connections per file', help: 'the download manager splits each file into this many parallel streams (1-16)'},
  fetchMediaFiles: {kind: 'bool', label: 'video files over many connections', help: 'a link straight to a video or audio file (.mp4, .mkv, .mp3…) goes to the download manager: up to 16 connections instead of one'},
  retries: {kind: 'int', min: 0, max: 10, label: 'retries', help: 'how often a draw that hit a network glitch is retried, with growing pauses'},
  skipArchived: {kind: 'bool', label: 'skip what was drawn before', help: 'keep an archive of every video id and never draw one twice'},
  warnDuplicates: {kind: 'bool', label: 'warn about duplicates', help: 'say so when a link was drawn before, and where it went'},
  embedMetadata: {kind: 'bool', label: 'embed metadata', help: 'title, artist, date and description inside the file'},
  embedThumbnail: {kind: 'bool', label: 'embed thumbnail', help: 'cover art inside mp4 / mp3 files'},
  checkUpdates: {kind: 'bool', label: 'check for renewal', help: 'look for a newer yt-dlp and Axive Free once a day'},
  animations: {kind: 'bool', label: 'animations', help: 'the shimmer, the whispers, the sigil'},
  grandSigil: {kind: 'bool', label: 'grand sigil', help: 'draw the turning line under the crest at double height (Windows Terminal)'},
  hoverHints: {kind: 'bool', label: 'hover hints', help: 'describe a button when the mouse rests on it'},
  vignette: {kind: 'bool', label: 'cinematic vignette', help: 'Windows Terminal shader: darkened corners, a little bloom on the red'},
  openInTerminal: {kind: 'bool', label: 'open in Windows Terminal', help: 'double-clicking the exe opens it in its own Windows Terminal window'},
  plainWords: {kind: 'bool', label: 'simple language', help: "everyday words instead of the house's own: draw, vessel, tunnel…"},
  categories: {kind: 'json', section: 'files', label: 'categories', help: 'file types by extension or address pattern, each with its own folder'},
  categoryFolders: {kind: 'bool', section: 'files', label: 'a folder per category', help: 'fetched files rest in Compressed, Programs, Videos… inside the download folder'},
  onDuplicate: {kind: 'enum', options: ['number', 'overwrite', 'skip', 'ask'], section: 'files', label: 'same name already there', help: 'add a number, replace it, skip the fetch, or ask each time'},
  climbBack: {kind: 'bool', section: 'network', label: 'climb back', help: 'after a server refused many connections, add one back each minute while it allows it'},
}

function coerce<K extends keyof Config>(key: K, value: unknown): Config[K] | undefined {
  const meta = META[key]
  switch (meta.kind) {
    case 'bool':
      return typeof value === 'boolean' ? (value as Config[K]) : undefined
    case 'enum':
      return typeof value === 'string' && meta.options!.includes(value) ? (value as Config[K]) : undefined
    case 'int': {
      if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
      if ((meta.min !== undefined && value < meta.min) || (meta.max !== undefined && value > meta.max)) return undefined
      return value as Config[K]
    }
    case 'string':
      if (key === 'rateLimit') return typeof value === 'string' && (value.trim() === '' || RATE.test(value.trim())) ? (value.trim() as Config[K]) : undefined
      return typeof value === 'string' && value.length <= 2048 ? (value as Config[K]) : undefined
    case 'json':
      return Array.isArray(value) ? (sanitizeCategories(value) as Config[K]) : undefined
  }
}

export function sanitizeConfig(raw: unknown): Config {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out = {...DEFAULTS}
  for (const key of Object.keys(DEFAULTS) as Array<keyof Config>) {
    if (!(key in input)) continue
    const value = coerce(key, input[key])
    if (value !== undefined) (out as Record<string, unknown>)[key] = value
  }
  return out
}

export const configStore = createStore<Config>(DEFAULTS)
// every later word on screen follows the Simple Language setting
configStore.subscribe(() => setPlainWords(configStore.get().plainWords))

export function loadConfig(): Config {
  const config = sanitizeConfig(readJson<unknown>(paths.config, {}))
  if (!config.folder) config.folder = fallbackDownloads()
  configStore.set(config)
  return config
}

export function saveConfig(config: Config = configStore.get()): void {
  writeFileAtomic(paths.config, `${JSON.stringify(config, null, 2)}\n`, 0o600)
}

export function updateConfig(patch: Partial<Config>): Config {
  const next = sanitizeConfig({...configStore.get(), ...patch})
  configStore.set(next)
  try {
    saveConfig(next)
  } catch {
    // a read-only data folder costs persistence, not the session
  }
  return next
}

export const getConfig = () => configStore.get()
export const useConfig = () => useStore(configStore)

/** Parse a value typed in a terminal for `config set <key> <value>`. */
export function parseConfigValue(key: string, text: string): {ok: true; key: keyof Config; value: unknown} | {ok: false; error: string} {
  if (!(key in META)) return {ok: false, error: `unknown setting “${key}”. try: config list`}
  const k = key as keyof Config
  const meta = META[k]
  let value: unknown = text
  if (meta.kind === 'bool') {
    if (/^(true|on|yes|1)$/i.test(text)) value = true
    else if (/^(false|off|no|0)$/i.test(text)) value = false
    else return {ok: false, error: `${key} is on or off`}
  } else if (meta.kind === 'int') {
    value = Number(text)
  } else if (meta.kind === 'json') {
    try {
      value = JSON.parse(text)
    } catch {
      return {ok: false, error: `${key} takes a JSON list`}
    }
  }
  if (coerce(k, value) === undefined) {
    const allowed = meta.options ? ` (${meta.options.join(', ')})` : meta.kind === 'int' ? ` (${meta.min}-${meta.max})` : ''
    return {ok: false, error: `“${text}” is not a valid ${key}${allowed}`}
  }
  return {ok: true, key: k, value}
}

export function displayValue(key: keyof Config, config: Config = configStore.get()): string {
  const value = config[key]
  if (META[key].kind === 'json') return JSON.stringify(value)
  if (value === '') return '""'
  return String(value)
}
