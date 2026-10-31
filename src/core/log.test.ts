import assert from 'node:assert/strict'
import os from 'node:os'
import test from 'node:test'
import {redact} from './log.js'

test('redact replaces the home folder with ~', () => {
  const home = os.homedir()
  const out = redact(`saved to ${home}\\Videos\\a.mp4`)
  assert.equal(out.includes(home), false)
  assert.ok(out.startsWith('saved to ~'))
})

test('redact keeps only harmless query parameters', () => {
  const out = redact('https://www.youtube.com/watch?v=abc123&list=PL1&t=10&sig=SECRET&token=XYZ')
  assert.ok(out.includes('v=abc123'))
  assert.ok(out.includes('list=PL1'))
  assert.ok(out.includes('t=10'))
  assert.equal(out.includes('SECRET'), false)
  assert.equal(out.includes('XYZ'), false)
})

test('redact replaces discord webhook secrets', () => {
  const out = redact('posting to https://discord.com/api/webhooks/123456789012345678/AbCdEf_-123456')
  assert.equal(out.includes('AbCdEf_-123456'), false)
  assert.ok(out.includes('discord.com/api/webhooks/123456789012345678/'))
})

test('redact replaces telegram bot tokens', () => {
  const token = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'
  const out = redact(`token ${token} used`)
  assert.equal(out.includes(token), false)
  assert.ok(out.includes('<bot-token>'))
})

test('redact drops link fragments, which often hold tokens', () => {
  const out = redact('back to https://example.com/cb#access_token=DEMO_SECRET&state=1')
  assert.equal(out.includes('DEMO_SECRET'), false)
  assert.ok(out.includes('https://example.com/cb#'))
})

test('redact hides credential headers however they are written', () => {
  for (const text of [
    'Authorization: Bearer DEMO_SECRET',
    '--add-header "Authorization:Basic DEMO_SECRET"',
    '{"authorization":"DEMO_SECRET"}',
    '--header=Cookie: sid=DEMO_SECRET; theme=dark',
    'Proxy-Authorization: Basic DEMO_SECRET',
    'sent bearer DEMO_SECRET_TOKEN',
    'body access_token=DEMO_SECRET&x=1',
  ]) {
    assert.equal(redact(text).includes('DEMO_SECRET'), false, text)
  }
})

test('redact leaves ordinary words alone', () => {
  assert.equal(redact('basic settings saved'), 'basic settings saved')
  assert.equal(redact('using --cookies-from-browser chrome'), 'using --cookies-from-browser chrome')
})
