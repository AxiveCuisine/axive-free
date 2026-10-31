import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import {isSea} from '../core/paths.js'
import {logEvent} from '../core/log.js'
import {ASSETS} from './bundle.generated.js'

/**
 * The GUI's door: a local HTTP server the window (or, failing WebView2, an
 * Edge app window) talks to. Same rules as the remote, tighter:
 *
 * - bound to 127.0.0.1 on a free port, never the network
 * - a fresh 32-byte key per launch: the window opens /?k=<key> once, gets it
 *   back as an HttpOnly, SameSite=Strict cookie, and every request after must
 *   carry it (constant-time compare). No key, no answer.
 * - the Host header must be this address (no DNS rebinding); a request from
 *   any other origin is refused; writes must be JSON with X-Axive: 1 (no form
 *   posts from elsewhere); bodies are capped
 * - a strict CSP: only this origin's scripts, styles and fonts; images also
 *   from https (thumbnails); nothing inline
 */

// while working on the window: AXIVE_GUI_DEV_DIR=<repo>/gui serves the page, script and styles fresh from disk (never in Axive.exe)
function devAsset(name: string): {type: string; body: string} | undefined {
  const dir = process.env.AXIVE_GUI_DEV_DIR
  if (!dir || isSea()) return undefined
  const file = name === '/index.html' ? path.join(dir, 'index.html') : ['/app.js', '/app.css'].includes(name) ? path.join(dir, 'dist', name.slice(1)) : undefined
  if (!file || !fs.existsSync(file)) return undefined
  return {type: ASSETS[name]?.type ?? 'text/plain', body: fs.readFileSync(file).toString('base64')}
}

export type Handler = (body: Record<string, unknown>) => Promise<unknown> | unknown

const BODY_LIMIT = 64 * 1024

export type GuiServer = {url: string; port: number; key: string; close: () => void; broadcast: (type: string, data: unknown) => void; listeners: () => number}

export function startGuiServer(routes: Record<string, Handler>, snapshot: () => unknown): Promise<GuiServer> {
  const key = crypto.randomBytes(32).toString('base64url')
  const streams = new Set<http.ServerResponse>()
  let port = 0
  const safeEqual = (a: string, b: string) => {
    const x = Buffer.from(a)
    const y = Buffer.from(b)
    return x.length === y.length && crypto.timingSafeEqual(x, y)
  }
  const cookieKey = (req: http.IncomingMessage) => /(?:^|;\s*)axive=([\w-]+)/.exec(req.headers.cookie ?? '')?.[1] ?? ''

  const headers = (type: string, extra: Record<string, string> = {}) => ({
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=()',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' https: data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    ...extra,
  })
  const send = (res: http.ServerResponse, status: number, body: string | Buffer, type = 'text/plain; charset=utf-8', extra?: Record<string, string>) => {
    res.writeHead(status, headers(type, extra))
    res.end(body)
  }

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const here = `127.0.0.1:${port}`
    if (req.headers.host !== here) return send(res, 421, 'wrong host')
    const origin = req.headers.origin
    if (origin && origin !== `http://${here}`) return send(res, 403, 'cross-origin requests are refused')
    const url = new URL(req.url ?? '/', `http://${here}`)

    // the one way in: the key in the address, traded for a cookie
    if (req.method === 'GET' && url.pathname === '/' && url.searchParams.has('k')) {
      if (!safeEqual(url.searchParams.get('k') ?? '', key)) return send(res, 403, 'this window needs its key')
      return send(res, 303, '', 'text/plain', {Location: '/', 'Set-Cookie': `axive=${key}; Path=/; HttpOnly; SameSite=Strict`})
    }
    if (!safeEqual(cookieKey(req), key)) return send(res, 403, 'open Axive from its own window')

    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, headers('text/event-stream', {Connection: 'keep-alive'}))
      res.write(`retry: 1500\n\nevent: state\ndata: ${JSON.stringify(snapshot())}\n\n`)
      streams.add(res)
      const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
      req.on('close', () => {
        clearInterval(ping)
        streams.delete(res)
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, JSON.stringify(snapshot()), 'application/json')
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json') || req.headers['x-axive'] !== '1') return send(res, 400, 'bad request')
      const route = routes[url.pathname.slice(5)]
      if (!route) return send(res, 404, 'nothing here')
      let raw = ''
      for await (const chunk of req) {
        raw += chunk
        if (raw.length > BODY_LIMIT) return send(res, 413, 'too large')
      }
      let body: Record<string, unknown>
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object')
      } catch {
        return send(res, 400, 'bad json')
      }
      try {
        const result = await route(body)
        return send(res, 200, JSON.stringify(result ?? {ok: true}), 'application/json')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logEvent('warn', `gui: ${url.pathname}: ${message}`)
        // the window shows one plain sentence; a stray stack or long tool output stays in the log
        const shown = message.split('\n')[0]!.slice(0, 300) || 'something in the dark resisted'
        return send(res, 422, JSON.stringify({error: shown}), 'application/json')
      }
    }
    if (req.method === 'GET') {
      const asset = devAsset(url.pathname === '/' ? '/index.html' : url.pathname) ?? ASSETS[url.pathname === '/' ? '/index.html' : url.pathname]
      if (asset) {
        const extra: Record<string, string> = /\/fonts\//.test(url.pathname) ? {'Cache-Control': 'max-age=31536000, immutable'} : {}
        res.writeHead(200, {...headers(asset.type), ...extra})
        return res.end(Buffer.from(asset.body, 'base64'))
      }
    }
    send(res, 404, 'nothing here')
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => void handler(req, res).catch(() => send(res, 500, 'error')))
    server.requestTimeout = 0 // the event stream stays open
    server.headersTimeout = 10_000
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as {port: number}).port
      resolve({
        url: `http://127.0.0.1:${port}/?k=${key}`,
        port,
        key,
        close: () => {
          for (const s of streams) s.end()
          server.close()
        },
        broadcast: (type, data) => {
          // a part that went away is null: JSON.stringify(undefined) is no JSON at all, and the page
          // would keep the old part (the first launch's "unpacking the tools" stayed up for good)
          const line = `event: ${type}\ndata: ${JSON.stringify(data ?? null)}\n\n`
          for (const s of streams) s.write(line)
        },
        listeners: () => streams.size,
      })
    })
  })
}
