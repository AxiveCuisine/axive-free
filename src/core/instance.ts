import {spawnSync} from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import {IS_WIN, paths, readJson, SYSTEM32, writeFileAtomic} from './paths.js'
import {createStore} from './store.js'

/**
 * One Axive at a time per data folder. Two would both resume the same
 * unfinished downloads into the same files (the queue, the download
 * manager's session), so a second one never runs beside the first:
 *
 * - the same door again (a second window, a second terminal): the open one
 *   comes to the front;
 * - the other door (the terminal while the window is open, or the window
 *   while the terminal is): Axive moves. The open one saves what is moving,
 *   lets go and closes; the new one takes the lock and carries every
 *   download on. The last door you opened is the one you get.
 *
 * Each holder answers on a small keyed address on 127.0.0.1 (its port and key
 * are in the lock file, readable by this user only). Headless runs (--batch,
 * --sync) never take the lock.
 */

export type Holder = {pid: number; kind: 'gui' | 'tui'; port?: number; key?: string; control?: boolean; at: number; image?: string}

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

/** The program a process runs ("Axive-2.4.2.exe"), '' when there is none or Windows will not say. */
function imageOf(pid: number): string | undefined {
  if (!IS_WIN) return undefined
  const out = spawnSync(path.join(SYSTEM32, 'tasklist.exe'), ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {encoding: 'utf8', windowsHide: true, timeout: 5000})
  if (out.status !== 0) return undefined // tasklist itself failed: no verdict
  return /^"([^"]+)","(\d+)"/m.exec(out.stdout ?? '')?.[1] ?? ''
}

/**
 * Whether the process named in the lock is still that Axive. A lock outlives an Axive that was killed
 * (an update, a crash, the PC switched off), and Windows hands its number to the next process soon
 * enough: trusting the number alone said "Axive is already open" with no Axive anywhere. So the
 * program it runs must be the one that took the lock (older locks did not say: an Axive or Node).
 */
function stillAxive(held: Partial<Holder>): boolean {
  const image = imageOf(held.pid!)
  if (image === undefined) return true
  if (!image) return false
  return held.image ? image.toLowerCase() === held.image.toLowerCase() : /^(axive.*|node)\.exe$/i.test(image)
}

/** A lock nobody holds any more goes, so the next look does not stumble on it again. */
function dropStale(pid: number): void {
  try {
    if (readJson<Partial<Holder>>(lockFile(), {}).pid === pid) fs.rmSync(lockFile(), {force: true})
  } catch {
    // someone else's to clear
  }
}

/** Who holds Axive open right now (not this process), if anyone. */
export function holder(): Holder | undefined {
  const held = readJson<Partial<Holder>>(lockFile(), {})
  if (!held.pid || held.pid === process.pid) return undefined
  if (!alive(held.pid) || !stillAxive(held)) {
    dropStale(held.pid)
    return undefined
  }
  return held as Holder
}

/** Whether anything listens on the holder's address (refused: the Axive that wrote it is gone). */
function listening(port: number, ms = 1500): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({host: '127.0.0.1', port})
    const done = (yes: boolean) => {
      socket.destroy()
      resolve(yes)
    }
    socket.setTimeout(ms, () => done(true)) // slow is not gone
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/**
 * holder(), and for a holder that keeps an address (2.1 and later) also that it answers there.
 * Nothing listening means the lock is left over: it goes and this launch opens Axive itself.
 */
export async function openHolder(): Promise<Holder | undefined> {
  const held = holder()
  if (held?.control && held.port && !(await listening(held.port))) {
    dropStale(held.pid)
    return undefined
  }
  return held
}

/** Take the lock; it goes when this process does. */
export function claim(kind: Holder['kind'], extra: Pick<Holder, 'port' | 'key' | 'control'> = {}): void {
  try {
    fs.mkdirSync(paths.root, {recursive: true})
    writeFileAtomic(lockFile(), JSON.stringify({pid: process.pid, kind, ...extra, at: Date.now(), image: path.basename(process.execPath)}), 0o600)
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
  /** a link from outside (axive:// from the browser, a second launch with a link): an offering */
  offer(url: string): void
  /** another door opened: save what moves, let go, close. Resolves once the lock may be taken. */
  handover(to: Holder['kind']): Promise<void>
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
        if (req.url === '/handover') {
          // answer first: the caller waits for the lock, not for this reply
          reply(202, {ok: true})
          await handlers.handover(fields.to === 'tui' ? 'tui' : 'gui')
          return
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
  if (!held.port || !held.key) return false
  try {
    // a holder from 2.0 or older only knows its window's own address
    const res = held.control
      ? await fetch(`http://127.0.0.1:${held.port}/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Axive-Control': held.key}, body: JSON.stringify(body), signal: AbortSignal.timeout(ms)})
      : route === 'focus'
        ? await fetch(`http://127.0.0.1:${held.port}/api/focus`, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Axive': '1', Cookie: `axive=${held.key}`}, body: '{}', signal: AbortSignal.timeout(ms)})
        : undefined
    return Boolean(res?.ok)
  } catch {
    return false
  }
}

/** Ask the open Axive to come to the front. */
export const focusWindow = (held: Holder) => knock(held, 'focus')

/** Hand a link to the open Axive (it becomes an offering there, and it comes forward). */
export const offerTo = (held: Holder, url: string) => knock(held, 'offer', {url})

/**
 * Ask the open Axive (the other door) to move here, and wait until it has let
 * go. False when it could not be asked (an older Axive) or did not let go.
 */
export async function takeOver(held: Holder, to: Holder['kind'], waitMs = 20_000): Promise<boolean> {
  if (!(await knock(held, 'handover', {to}))) return false
  const until = Date.now() + waitMs
  while (Date.now() < until) {
    if (!alive(held.pid) || holder()?.pid !== held.pid) return true
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  return false
}

/** a link another launch offered to this open terminal (the TUI shows it) */
export const offeredStore = createStore<string | undefined>(undefined)
