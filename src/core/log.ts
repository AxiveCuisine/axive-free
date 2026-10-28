import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {ensureDir, paths} from './paths.js'
import {createStore} from './store.js'

/**
 * Two kinds of record, both under <data>\logs:
 *  - axive.log: a rolling diary of what happened (rotated at 2 MB)
 *  - reports\report-<utc time>-<what>.txt: one file per failure, holding the
 *    raw yt-dlp/ffmpeg output a developer needs — with the user's name,
 *    home folder, secrets and link tokens scrubbed out, and every timestamp
 *    in UTC so nothing gives away where the user lives.
 */

const MAX_LOG = 2 * 1024 * 1024
const RING = 400

export const utcStamp = (date = new Date()) => date.toISOString().replace(/\.\d+Z$/, 'Z')

let rotated = false
function logFile(): string {
  const file = path.join(ensureDir(paths.logs), 'axive.log')
  if (!rotated) {
    rotated = true
    try {
      if (fs.statSync(file).size > MAX_LOG) fs.renameSync(file, path.join(paths.logs, 'axive.1.log'))
    } catch {
      // no log yet
    }
  }
  return file
}

export function logEvent(level: 'info' | 'warn' | 'error', message: string): void {
  try {
    fs.appendFileSync(logFile(), `${utcStamp()} ${level.padEnd(5)} ${redact(message)}\n`)
  } catch {
    // logging must never break the app
  }
}

// ---------------------------------------------------------------------------
// raw tool output, per job, for the logs panel

export type RawLine = {at: number; job: string; text: string; stream: 'out' | 'err' | 'cmd'}
export const rawStore = createStore<RawLine[]>([])

export function rawLine(job: string, text: string, stream: RawLine['stream'] = 'out'): void {
  const clean = text.replace(/\r/g, '').trimEnd()
  if (!clean) return
  rawStore.set(lines => {
    const next = lines.length >= RING ? lines.slice(lines.length - RING + 1) : lines.slice()
    next.push({at: Date.now(), job, text: clean, stream})
    return next
  })
}

export const linesFor = (job?: string) => rawStore.get().filter(line => !job || line.job === job)

// ---------------------------------------------------------------------------
// scrubbing

const SAFE_QUERY = new Set(['v', 'list', 'index', 't', 'start', 'si', 'p', 'page'])
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Strip what identifies the user or unlocks their accounts from text bound for a report. */
export function redact(text: string): string {
  let out = text
  const home = os.homedir()
  for (const variant of new Set([home, home.replace(/\\/g, '/'), home.replace(/\\/g, '\\\\')])) {
    out = out.replace(new RegExp(escapeRe(variant), 'gi'), '~')
  }
  let user = ''
  try {
    user = os.userInfo().username
  } catch {
    // no user info in some sandboxes
  }
  if (user.length >= 3) out = out.replace(new RegExp(`\\b${escapeRe(user)}\\b`, 'gi'), '<user>')
  // telegram bot tokens look like 123456789:AA…; discord webhooks carry their secret in the path
  out = out.replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, '<bot-token>')
  out = out.replace(/(discord(?:app)?\.com\/api\/webhooks\/\d+\/)[A-Za-z0-9_-]+/gi, '$1<secret>')
  // links keep their host, path and harmless parameters; signatures and tokens go
  out = out.replace(/\bhttps?:\/\/[^\s"'<>]+/g, url => {
    try {
      const parsed = new URL(url)
      if (/googlevideo\.com$|\.fbcdn\.net$|\.cdninstagram\.com$|\.tiktokcdn/.test(parsed.hostname)) {
        return `${parsed.protocol}//${parsed.hostname}/…`
      }
      for (const key of [...parsed.searchParams.keys()]) {
        if (!SAFE_QUERY.has(key)) parsed.searchParams.set(key, '…')
      }
      parsed.username = ''
      parsed.password = ''
      return parsed.toString()
    } catch {
      return url
    }
  })
  // private network addresses
  out = out.replace(/\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g, '<lan-ip>')
  return out
}

// ---------------------------------------------------------------------------
// reports

export type ReportInput = {
  title: string
  kind?: string
  url?: string
  command?: string[]
  stderr?: string
  stdout?: string
  details?: Record<string, string | undefined>
}

const versionsStore: Record<string, string> = {}
export function setVersion(name: string, version: string): void {
  versionsStore[name] = version
}

/** Writes a report and returns its path (or undefined if the disk refused). */
export function writeReport(input: ReportInput): string | undefined {
  try {
    const dir = ensureDir(paths.reports)
    const slug = (input.kind ?? 'error').replace(/[^a-z0-9-]+/gi, '-').slice(0, 24)
    const file = path.join(dir, `report-${utcStamp().replace(/[:]/g, '')}-${slug}.txt`)
    const section = (name: string, body: string | undefined) => (body ? `\n── ${name} ${'─'.repeat(Math.max(4, 60 - name.length))}\n${body.trimEnd()}\n` : '')
    const versions = Object.entries(versionsStore)
      .map(([k, v]) => `${k} ${v}`)
      .join('\n')
    const details = Object.entries(input.details ?? {})
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
    const body = [
      `axive report · ${utcStamp()}`,
      `what: ${input.title}`,
      input.kind ? `kind: ${input.kind}` : '',
      input.url ? `link: ${input.url}` : '',
      section('versions', `${versions}\nos ${os.platform()} ${os.release()} ${os.arch()}\nterminal ${process.env.WT_SESSION ? 'windows-terminal' : process.env.TERM_PROGRAM ?? 'console'}`),
      section('details', details),
      section('command', input.command?.map(arg => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ')),
      section('stderr', input.stderr?.slice(-24_000)),
      section('stdout', input.stdout?.slice(-12_000)),
      '\nSend this file to the developer if you want help. Your name, home folder,',
      'tokens and link signatures have been removed; read it first if unsure.\n',
    ]
      .filter(Boolean)
      .join('\n')
    fs.writeFileSync(file, redact(body))
    pruneReports(dir)
    return file
  } catch {
    return undefined
  }
}

/** keep the newest 40 reports */
function pruneReports(dir: string): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter(name => name.startsWith('report-'))
      .sort()
    for (const name of files.slice(0, Math.max(0, files.length - 40))) fs.rmSync(path.join(dir, name), {force: true})
  } catch {
    // best effort
  }
}
