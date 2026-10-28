import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const ownHome = !process.env.AXIVE_HOME
process.env.AXIVE_HOME ??= path.join(os.tmpdir(), `axive-jobs-test-${process.pid}`)
// no tools in the sandbox: a draw that starts fails at once, which is all these tests need to see
process.env.AXIVE_BIN = path.join(process.env.AXIVE_HOME, 'no-tools')
test.after(() => ownHome && fs.rmSync(process.env.AXIVE_HOME!, {recursive: true, force: true}))
const jobs = await import('./jobs.js')
const {updateConfig} = await import('./config.js')

const draw = () => ({url: 'https://example.com/v', title: 'v', choice: {kind: 'video', label: 'best', args: []} as never, folder: process.env.AXIVE_HOME!, options: {}})

test('a draw joins the one line and starts when there is room', async () => {
  updateConfig({tunnels: 1})
  const [job] = jobs.addJobs([draw()])
  assert.equal(jobs.getJob(job!.id)!.queueId, 'main')
  await new Promise(r => setTimeout(r, 50))
  assert.notEqual(jobs.getJob(job!.id)!.attempt, 0, 'it was started')
  jobs.removeJob(job!.id)
})

test('a failed draw is retried into the line', async () => {
  const [job] = jobs.addJobs([draw()])
  await new Promise(r => setTimeout(r, 50))
  assert.equal(jobs.getJob(job!.id)!.state, 'failed', 'no tools in the sandbox')
  // every state it passes through on the way: back into the line, then started
  const seen: string[] = []
  const stop = jobs.jobsStore.subscribe(() => seen.push(jobs.getJob(job!.id)?.state ?? ''))
  jobs.resumeJob(job!.id)
  await new Promise(r => setTimeout(r, 50))
  stop()
  assert.ok(seen.includes('running'), `it was started again (${seen.join(', ')})`)
  jobs.removeJob(job!.id)
})
