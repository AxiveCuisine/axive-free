import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const ownHome = !process.env.AXIVE_HOME
process.env.AXIVE_HOME ??= path.join(os.tmpdir(), `axive-config-test-${process.pid}`)
test.after(() => ownHome && fs.rmSync(process.env.AXIVE_HOME!, {recursive: true, force: true}))
const {DEFAULTS, FREE_MAX_TUNNELS, META, configStore, displayValue, parseConfigValue, sanitizeConfig, updateConfig} = await import('./config.js')

test('a settings file is checked key by key: junk falls back, what is valid stays', () => {
  const c = sanitizeConfig({tunnels: 9, rateLimit: 'fast', theme: 'ash', retries: 4, remoteToken: 'from the paid app'})
  assert.equal(c.tunnels, DEFAULTS.tunnels, `Free runs at most ${FREE_MAX_TUNNELS} side by side`)
  assert.equal(c.rateLimit, '')
  assert.equal(c.theme, 'ash')
  assert.equal(c.retries, 4)
  assert.ok(!('remoteToken' in c), 'keys Free does not know are dropped')
  assert.equal(sanitizeConfig({}).categories.at(-1)!.id, 'other')
})

test('the speed limit and tunnels change through updateConfig', () => {
  updateConfig({tunnels: 1, rateLimit: '2M'})
  assert.equal(configStore.get().tunnels, 1)
  assert.equal(configStore.get().rateLimit, '2M')
  updateConfig({rateLimit: ''})
  assert.equal(configStore.get().rateLimit, '')
})

test('config set parses each kind, and no label carries an em dash', () => {
  assert.deepEqual(parseConfigValue('animations', 'off'), {ok: true, key: 'animations', value: false})
  assert.equal(parseConfigValue('tunnels', '3').ok, false)
  assert.equal(parseConfigValue('nothing', '1').ok, false)
  const parsed = parseConfigValue('categories', '[{"id":"isos","name":"ISOs","exts":["iso"]}]')
  assert.ok(parsed.ok)
  assert.equal(parseConfigValue('categories', 'nope').ok, false)
  assert.equal(displayValue('rateLimit', {...DEFAULTS, rateLimit: ''}), '""')
  for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) assert.ok(!/—/.test(META[key].help + META[key].label), `${key} has an em dash`)
})
