import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import {startGuiServer} from './server.js'

/** reads the event stream until `until` shows up, calling `then` once the first state has arrived */
function listen(port: number, key: string, then: () => void, until: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = ''
    let started = false
    const req = http.get({host: '127.0.0.1', port, path: '/api/events', headers: {Cookie: `axive=${key}`}}, res => {
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        text += chunk
        if (!started && text.includes('event: state')) (started = true), then()
        if (text.includes(until)) {
          req.destroy()
          resolve(text)
        }
      })
    })
    req.on('error', error => (text.includes(until) ? resolve(text) : reject(error)))
    setTimeout(() => (req.destroy(), reject(new Error(`no "${until}" in: ${text}`))), 5000).unref()
  })
}

test('a part that went away reaches the page as null, never as "undefined"', async () => {
  const server = await startGuiServer({}, () => ({setup: null}))
  try {
    const text = await listen(server.port, server.key, () => server.broadcast('setup', undefined), 'event: setup')
    assert.match(text, /event: state\ndata: \{"setup":null\}/)
    assert.match(text, /event: setup\ndata: null\n/)
    assert.doesNotMatch(text, /data: undefined/, 'the page cannot parse that, and kept the first launch\'s setup screen up for good')
  } finally {
    server.close()
  }
})

test('the event stream needs the window\'s key', async () => {
  const server = await startGuiServer({}, () => ({}))
  try {
    const status = await new Promise<number>(resolve => http.get({host: '127.0.0.1', port: server.port, path: '/api/events', headers: {Cookie: 'axive=wrong'}}, res => (res.resume(), resolve(res.statusCode ?? 0))))
    assert.equal(status, 403)
  } finally {
    server.close()
  }
})
