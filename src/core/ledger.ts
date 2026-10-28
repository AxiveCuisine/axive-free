import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {defaultRoot, ensureDir, paths, readJson, writeFileAtomic} from './paths.js'
import {createStore} from './store.js'

/**
 * The ledger: everything Axive has drawn, newest first. One JSON object per
 * line, appended as draws finish — browsable, searchable, and what duplicate
 * warnings ("you drew this 3 days ago as foo.mp4") are answered from.
 */
export type LedgerEntry = {
  id: string
  url: string
  title: string
  /** site + video id, the identity duplicates are matched on */
  site?: string
  videoId?: string
  uploader?: string
  filepath?: string
  size?: number
  vessel?: string
  /** category id (categories.ts), for fetched files and draws */
  category?: string
  at: number
}

const LIMIT = 5000

export const ledgerStore = createStore<LedgerEntry[]>([])

export function loadLedger(): LedgerEntry[] {
  let entries: LedgerEntry[] = []
  try {
    const lines = fs.readFileSync(paths.ledger, 'utf8').split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as LedgerEntry
        if (entry && typeof entry.url === 'string' && typeof entry.at === 'number') entries.push(entry)
      } catch {
        // a torn line from a crash: skip it
      }
    }
  } catch {
    // no ledger yet
  }
  entries = entries.sort((a, b) => b.at - a.at).slice(0, LIMIT)
  ledgerStore.set(entries)
  return entries
}

export function record(entry: Omit<LedgerEntry, 'id' | 'at'> & {at?: number}): LedgerEntry {
  const full: LedgerEntry = {...entry, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: entry.at ?? Date.now()}
  try {
    ensureDir(path.dirname(paths.ledger))
    fs.appendFileSync(paths.ledger, `${JSON.stringify(full)}\n`)
  } catch {
    // the ledger is a nicety — never let it break a draw
  }
  ledgerStore.set(entries => [full, ...entries].slice(0, LIMIT))
  return full
}

export function forget(id: string): void {
  const next = ledgerStore.get().filter(entry => entry.id !== id)
  ledgerStore.set(next)
  rewrite(next)
}

export function forgetAll(): void {
  ledgerStore.set([])
  rewrite([])
}

function rewrite(entries: LedgerEntry[]): void {
  try {
    writeFileAtomic(paths.ledger, entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''))
  } catch {
    // best effort
  }
}

/** The last time this exact video (site + id) was drawn, if ever. */
export function findDuplicate(site: string | undefined, videoId: string | undefined, url?: string): LedgerEntry | undefined {
  return ledgerStore.get().find(entry => (site && videoId && entry.site === site && entry.videoId === videoId) || (url && entry.url === url))
}

export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return 'moments ago'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`
  const mo = Math.round(d / 30)
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`
  const y = Math.round(mo / 12)
  return `${y} year${y === 1 ? '' : 's'} ago`
}

// ---------------------------------------------------------------------------
// recent links, recalled with ↑ in the link box

const RECENT_LIMIT = 50

export function loadRecent(): string[] {
  const parsed = readJson<unknown>(paths.inputs, [])
  return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === 'string').slice(0, RECENT_LIMIT) : []
}

export function rememberLink(url: string): string[] {
  const next = [url, ...loadRecent().filter(entry => entry !== url)].slice(0, RECENT_LIMIT)
  try {
    writeFileAtomic(paths.inputs, `${JSON.stringify(next, null, 2)}\n`)
  } catch {
    // a nicety
  }
  return next
}

// ---------------------------------------------------------------------------
// coming over from Shefa: its link history and pasted cookies

export function migrateFromShefa(): boolean {
  const old = path.join(os.homedir(), '.shefa')
  const marker = path.join(paths.root, '.migrated')
  // only the real data folder inherits Shefa: a sandbox (AXIVE_HOME) or a portable copy must start clean
  if (process.env.AXIVE_HOME || paths.root !== defaultRoot()) return false
  if (!fs.existsSync(old) || fs.existsSync(marker)) return false
  try {
    const history = readJson<unknown>(path.join(old, 'history.json'), [])
    if (Array.isArray(history) && history.length && !fs.existsSync(paths.inputs)) {
      writeFileAtomic(paths.inputs, `${JSON.stringify(history.filter(h => typeof h === 'string').slice(0, RECENT_LIMIT), null, 2)}\n`)
    }
    const cookies = path.join(old, 'cookies.txt')
    if (fs.existsSync(cookies) && !fs.existsSync(paths.cookies)) {
      writeFileAtomic(paths.cookies, fs.readFileSync(cookies, 'utf8'), 0o600)
    }
    writeFileAtomic(marker, new Date().toISOString())
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// export and import of link lists (the ledger and the fetch list)

/** one link in an exported list: no cookies, no headers, no local paths */
export type ExportItem = {url: string; name?: string; kind: 'fetch' | 'draw'; state?: string; size?: number; category?: string; queueId?: string; at?: number}
export type ExportFile = {app: 'axive'; kind: 'links'; version: 1; exported: string; items: ExportItem[]}

export const MAX_IMPORT = 5000
const LINKISH = /^(https?:\/\/|ftp:\/\/|magnet:\?)\S+$/i

/**
 * The ledger (and any extra items, e.g. fetcher's exportFetches()) as a JSON
 * text to save. Files are named, never located: a list passed to a friend
 * carries no user name or folder.
 */
export function exportLedger(extra: ExportItem[] = [], includeLedger = true): string {
  const fromLedger: ExportItem[] = includeLedger
    ? ledgerStore
        .get()
        .filter(e => LINKISH.test(e.url))
        .map(e => ({url: e.url, name: e.filepath ? path.basename(e.filepath) : e.title, kind: e.vessel === 'file' || e.vessel === 'torrent' ? 'fetch' : 'draw', size: e.size, category: e.category, at: e.at}))
    : []
  const seen = new Set<string>()
  const items = [...extra, ...fromLedger].filter(i => LINKISH.test(i.url) && !seen.has(i.url) && seen.add(i.url))
  const file: ExportFile = {app: 'axive', kind: 'links', version: 1, exported: new Date().toISOString(), items}
  return `${JSON.stringify(file, null, 2)}\n`
}

export type ImportedLink = {url: string; name?: string; kind?: 'fetch' | 'draw'; category?: string; queueId?: string}

const CONTROL = /[\u0000-\u001f\u007f]/g

/**
 * Links from a saved list: Axive's own export, a JSON array of links or of
 * objects with url/link (other managers' exports), or plain text, one link a
 * line. Only http, https, ftp and magnet links; duplicates dropped; 5,000 at most.
 */
export function importLinks(input: string | unknown): {links: ImportedLink[]; skipped: number} {
  let data: unknown = input
  if (typeof input === 'string') {
    const text = input.replace(/^﻿/, '').trim()
    try {
      data = JSON.parse(text)
    } catch {
      data = text
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'))
    }
  }
  const box = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined
  const raw: unknown[] = Array.isArray(data) ? data : Array.isArray(box?.items) ? (box.items as unknown[]) : Array.isArray(box?.downloads) ? (box.downloads as unknown[]) : []
  const links: ImportedLink[] = []
  const seen = new Set<string>()
  let skipped = 0
  const short = (v: unknown, n: number) => (typeof v === 'string' && v.length <= n ? v.replace(CONTROL, '').trim() || undefined : undefined)
  for (const entry of raw) {
    const o = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : undefined
    const url = typeof entry === 'string' ? entry.trim() : short(o?.url ?? o?.link ?? o?.uri, 8192)
    if (!url || url.length > 8192 || !LINKISH.test(url) || seen.has(url) || links.length >= MAX_IMPORT) {
      skipped++
      continue
    }
    seen.add(url)
    const kind = o?.kind === 'fetch' || o?.kind === 'draw' ? o.kind : undefined
    links.push({url, name: short(o?.name ?? o?.fileName ?? o?.filename, 255), kind, category: short(o?.category, 32), queueId: short(o?.queueId, 32)})
  }
  return {links, skipped}
}
