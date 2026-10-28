import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import {paths, readJson, writeFileAtomic} from './paths.js'
import {createStore} from './store.js'

/**
 * One Axive at a time per data folder. Two would both resume the same
 * unfinished downloads into the same files (the queue, the download
 * manager's session), so a second one never runs beside the first:
 *
 * a second launch brings the open one to the front, and a link it was given
 * is offered there instead.
 *
 * Each holder answers on a small keyed address on 127.0.0.1 (its port and key
 * are in the lock file, readable by this user only). Headless runs (--batch,
 * --sync) never take the lock.
 */

export type Holder = {pid: number; kind: 'tui'; port?: number; key?: string; control?: boolean; at: number}

const lockFile = () => path.join(paths.root, 'axive.lock')

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: it exists, it just is not ours to signal
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Who holds Axive open right now (not this process), if anyone. */
export function holder(): Holder | undefined {
  const held = readJson<Partial<Holder>>(lockFile(), {})
  if (!held.pid || held.pid === process.pid || !alive(held.pid)) return undefined
  return held as Holder
}

/** Take the lock; it goes when this process does. */
export function claim(kind: Holder['kind'], extra: Pick<Holder, 'port' | 'key' | 'control'> = {}): void {
  try {
    fs.mkdirSync(paths.root, {recursive: true})
    writeFileAtomic(lockFile(), JSON.stringify({pid: process.pid, kind, ...extra, at: Date.now()}), 0o600)
  } catch {
    return // a read-only data folder: nothing to guard
  }
  process.once('exit', release)
}

export function release(): void {
  try {
    if (readJson<Partial<Holder>>(lockFile(), {}).pid === process.pid) fs.rmSync(lockFile(), {force: true})
  } catch {
    // already gone
  }
}

// ---------------------------------------------------------------- the holder's own address

/** What the open Axive does when another launch asks. */
export type ControlHandlers = {
  /** come to the front */
  focus(): void | Promise<void>
  /** a second launch with a link: it opens here */
  offer(url: string): void
}

const MAX_BODY = 8192

/**
 * Listen on 127.0.0.1 for the next launch, then take the lock with the address in it.
 * Only a caller that read the lock file (this user) knows the key; browsers are refused outright.
 */
export async function claimWithControl(kind: Holder['kind'], handlers: ControlHandlers): Promise<void> {
  const key = crypto.randomBytes(24).toString('base64url')
  const server = http.createServer((req, res) => {
    const reply = (status: number, body: unknown = {}) => {
      res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'})
      res.end(JSON.stringify(body))
    }
    const port = (server.address() as {port: number} | null)?.port
    const given = Buffer.from(String(req.headers['x-axive-control'] ?? ''))
    const want = Buffer.from(key)
    // a web page always carries an Origin: none of them may knock here
    if (req.headers.origin || req.headers.host !== `127.0.0.1:${port}` || req.method !== 'POST') return reply(403)
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return reply(403)
    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => {
      body += chunk
      if (body.length > MAX_BODY) req.destroy()
    })
    req.on('end', () => {
      let fields: Record<string, unknown> = {}
      try {
        fields = body ? (JSON.parse(body) as Record<string, unknown>) : {}
      } catch {
        return reply(400)
      }
      void (async () => {
        if (req.url === '/focus') {
          await handlers.focus()
          return reply(200, {ok: true})
        }
        if (req.url === '/offer' && typeof fields.url === 'string' && fields.url.length <= 4096) {
          handlers.offer(fields.url)
          await handlers.focus()
          return reply(200, {ok: true})
        }
        reply(404)
      })().catch(() => {
        if (!res.headersSent) reply(500)
      })
    })
  })
  server.requestTimeout = 5000
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as {port: number}).port))
  }).catch(() => undefined)
  server.unref()
  claim(kind, port ? {port, key, control: true} : {})
}

async function knock(held: Holder, route: string, body: Record<string, unknown> = {}, ms = 3000): Promise<boolean> {
  if (!held.port || !held.key || !held.control) return false
  try {
    const res = await fetch(`http://127.0.0.1:${held.port}/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Axive-Control': held.key}, body: JSON.stringify(body), signal: AbortSignal.timeout(ms)})
    return res.ok
  } catch {
    return false
  }
}

/** Ask the open Axive to come to the front. */
export const focusWindow = (held: Holder) => knock(held, 'focus')

/** Hand a link to the open Axive (it becomes an offering there, and it comes forward). */
export const offerTo = (held: Holder, url: string) => knock(held, 'offer', {url})


/** a link a second launch handed over: the open Axive Free takes it up (app.tsx) */
export const offeredStore = createStore<string | undefined>(undefined)
