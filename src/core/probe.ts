import fs from 'node:fs'
import path from 'node:path'
import {categoryFor} from './categories.js'
import type {Config} from './config.js'

/**
 * A look at a link before it is fetched: its size, whether the server lets
 * a download resume (byte ranges), its real file name and type. HEAD first,
 * then a one-byte ranged GET (servers that answer HEAD badly are common).
 * Redirects are followed by hand, at most 10, and a cookie or login never
 * follows a redirect to another host.
 */

export type ProbeResult = {
  size?: number
  resumable: boolean
  filename: string
  mime: string
  finalUrl: string
  /** the category id the file falls in */
  category: string
}

const SENSITIVE = ['cookie', 'authorization', 'proxy-authorization']
export const PROBE_TIMEOUT_MS = 12_000

/** characters Windows refuses in a name, control characters, reserved names */
export function safeFileName(raw: string, fallback = 'file'): string {
  let name = raw
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 200)
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(name)) name = `_${name}`
  return name || fallback
}

/** the file name in a Content-Disposition header (filename* wins), if any */
export function filenameFromDisposition(header: string | null | undefined): string | undefined {
  if (!header) return undefined
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header)
  if (star) {
    try {
      return decodeURIComponent(star[2]!.trim().replace(/^"|"$/g, ''))
    } catch {
      // fall through to the plain one
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header)
  const value = plain ? (plain[2] ?? plain[1]!).trim() : ''
  return value || undefined
}

export function nameFromUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
  } catch {
    return ''
  }
}

function sameOrigin(a: string, b: string): boolean {
  try {
    const x = new URL(a)
    const y = new URL(b)
    return x.protocol === y.protocol && x.host === y.host
  } catch {
    return false
  }
}

function cleanHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers ?? {})) if (/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k) && typeof v === 'string' && !/[\r\n\0]/.test(v)) out[k] = v
  return out
}

/** fetch with redirects followed by hand; returns the last response and its address */
export async function request(url: string, init: {method: string; headers?: Record<string, string>; signal?: AbortSignal}): Promise<{res: Response; url: string}> {
  let current = url
  let headers = cleanHeaders(init.headers)
  for (let hop = 0; hop <= 10; hop++) {
    const parsed = new URL(current)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('only web addresses (http, https) can be looked at')
    const res = await fetch(current, {method: init.method, headers, redirect: 'manual', signal: init.signal ?? AbortSignal.timeout(PROBE_TIMEOUT_MS)})
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined)
      const next = new URL(location, current).href
      if (!sameOrigin(current, next)) headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !SENSITIVE.includes(k.toLowerCase())))
      current = next
      continue
    }
    return {res, url: current}
  }
  throw new Error('that link redirects too many times')
}

/** probe a link (see above); throws only when the server cannot be reached at all */
export async function probeLink(url: string, headers?: Record<string, string>, categories?: Config['categories']): Promise<ProbeResult> {
  let size: number | undefined
  let resumable = false
  let mime = ''
  let filename: string | undefined
  let finalUrl = url
  let reached = false
  try {
    const {res, url: at} = await request(url, {method: 'HEAD', headers})
    reached = true
    if (res.ok) {
      finalUrl = at
      const length = Number(res.headers.get('content-length'))
      if (Number.isFinite(length) && length > 0) size = length
      resumable = /bytes/i.test(res.headers.get('accept-ranges') ?? '')
      mime = res.headers.get('content-type') ?? ''
      filename = filenameFromDisposition(res.headers.get('content-disposition'))
    }
  } catch {
    // the GET below tries again
  }
  // the ranged GET settles resumability (and the size, from Content-Range)
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      const {res, url: at} = await request(url, {method: 'GET', headers: {...headers, Range: 'bytes=0-0'}, signal: controller.signal})
      reached = true
      if (res.status === 206 || res.ok) {
        finalUrl = at
        const range = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')
        if (res.status === 206) {
          resumable = true
          if (range) size = Number(range[1])
        } else {
          resumable = false
          const length = Number(res.headers.get('content-length'))
          if (!size && Number.isFinite(length) && length > 0) size = length
        }
        mime ||= res.headers.get('content-type') ?? ''
        filename ??= filenameFromDisposition(res.headers.get('content-disposition'))
      }
      controller.abort()
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // a timeout or a dropped line after the headers changes nothing
  }
  if (!reached) throw new Error('that server could not be reached')
  const name = safeFileName(filename || nameFromUrl(finalUrl) || nameFromUrl(url))
  return {size, resumable, filename: name, mime: mime.split(';')[0]!.trim(), finalUrl, category: categoryFor(name, url, categories).id}
}

// ---------------------------------------------------------------------------
// a file of the same name already there

export type DuplicateChoice = 'number' | 'overwrite' | 'skip' | 'ask'

/** thrown by addLink for 'skip' and 'ask'; the screens ask, then add again with opts.onDuplicate */
export class DuplicateError extends Error {
  readonly code = 'duplicate'
  constructor(
    readonly file: string,
    readonly choice: 'skip' | 'ask',
  ) {
    super(`a file named ${file} already rests there`)
  }
}

/** "name (2).ext", "name (3).ext"… the first that is free in `dir` */
export function uniqueName(dir: string, name: string, taken: (file: string) => boolean = f => fs.existsSync(f)): string {
  if (!taken(path.join(dir, name)) && !taken(path.join(dir, `${name}.aria2`))) return name
  const ext = path.extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!taken(path.join(dir, candidate)) && !taken(path.join(dir, `${candidate}.aria2`))) return candidate
  }
  return `${stem} (${Date.now()})${ext}`
}

/**
 * What to do about `name` in `dir`. A partial file with its .aria2 control
 * file is not a duplicate: aria2 carries on from it.
 */
export function duplicatePlan(dir: string, name: string, choice: DuplicateChoice, exists: (file: string) => boolean = f => fs.existsSync(f)): {out: string; overwrite?: boolean} {
  const file = path.join(dir, name)
  if (!exists(file) || exists(`${file}.aria2`)) return {out: name}
  if (choice === 'overwrite') return {out: name, overwrite: true}
  if (choice === 'skip' || choice === 'ask') throw new DuplicateError(name, choice)
  return {out: uniqueName(dir, name, exists)}
}
