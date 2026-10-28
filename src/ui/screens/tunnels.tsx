import React, {useState} from 'react'
import {Box} from 'ink'
import {Text} from '../text.js'
import {updateConfig, useConfig} from '../../core/config.js'
import {discard, discardSentence} from '../../core/discard.js'
import {formatBytes, truncate} from '../../core/format.js'
import {G} from '../../core/glyphs.js'
import {cancelJob, clearFinished, jobsStore, pauseAll, pauseJob, prioritize, removeJob, resumeAll, resumeJob, type Job} from '../../core/jobs.js'
import {useStore} from '../../core/store.js'
import {DeleteAsk} from '../components/delete-ask.js'
import {useSize} from '../components/fullscreen.js'
import {say} from '../components/notice.js'
import {ProgressBar} from '../components/progress-bar.js'
import {Sigil} from '../components/sigil.js'
import {openFile, reveal, useApp, useBack} from '../context.js'
import {Button, ButtonRow, Cycle, Gap, Quiet, Title} from '../kit.js'
import {useTheme} from '../theme.js'
import {jobFraction, progressMeta} from './drawing.js'

function stateMark(job: Job, theme: ReturnType<typeof useTheme>) {
  switch (job.state) {
    case 'running':
      return <Sigil />
    case 'done':
      return <Text color={theme.accent}>{G.done}</Text>
    case 'failed':
      return <Text color={theme.accent}>{G.failed}</Text>
    case 'paused':
      return <Text color={theme.gray}>{G.paused}</Text>
    case 'held':
      return <Text color={theme.gray}>{G.held}</Text>
    case 'skipped':
      return <Text color={theme.gray}>{G.dot}</Text>
    case 'cancelled':
      return <Text color={theme.whisper}>{G.cross}</Text>
    default:
      return <Text color={theme.gray}>{G.waiting}</Text>
  }
}

function statusText(job: Job): string {
  switch (job.state) {
    case 'running':
      return job.stage === 'binding' ? 'binding…' : job.progress ? progressMeta(job).trim() : `${job.stage ?? 'opening'}…`
    case 'queued':
      return job.retryAt ? `retrying in ${Math.max(1, Math.round((job.retryAt - Date.now()) / 1000))}s` : 'waiting'
    case 'held':
      return 'held'
    case 'paused':
      return 'paused'
    case 'done':
      return `received${job.size ? ` · ${formatBytes(job.size)}` : ''}`
    case 'skipped':
      return 'drawn before'
    case 'failed':
      return job.error?.title ?? 'failed'
    case 'cancelled':
      return 'cancelled'
  }
}

/** One lane: title and controls on the first row, the bar (or status) under it. */
function Tunnel({job, width}: {job: Job; width: number}) {
  const theme = useTheme()
  const app = useApp()
  const active = job.state === 'running' || job.state === 'queued' || job.state === 'held'
  const titleWidth = Math.max(10, width - 34)
  const [asking, setAsking] = useState(false)
  const live = active || job.state === 'paused'
  // something of it on the drive: ask first (only the line, or the file too); else it just leaves
  const onDrive = live || (job.state === 'done' && Boolean(job.filepath)) || Boolean(job.partials?.length)
  const answer = async (drive: boolean | undefined) => {
    setAsking(false)
    if (drive === undefined) return
    if (live) cancelJob(job.id, {keepFiles: !drive})
    const file = job.state === 'done' ? job.filepath : undefined
    removeJob(job.id)
    if (drive && file) say(discardSentence(await discard([file])), 'ok', 4000)
  }
  if (asking) return (
    <Box width={width} flexShrink={0} marginBottom={1}>
      <DeleteAsk what={job.title} live={live} width={width} onAnswer={drive => void answer(drive)} />
    </Box>
  )
  return (
    <Box flexDirection="column" width={width} flexShrink={0} marginBottom={1}>
      <Box>
        <Box width={2}>{stateMark(job, theme)}</Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text color={job.state === 'cancelled' ? theme.gray : theme.primary} bold={job.state === 'running'} wrap="truncate-end">
            {truncate(job.title, titleWidth)}
          </Text>
          <Quiet>{` · ${job.choice.label.replace(/ · ~.*$/, '')}`}</Quiet>
        </Box>
        <Box columnGap={1} flexShrink={0}>
          {job.state === 'queued' || job.state === 'paused' ? <Button compact label={G.up} onPress={() => prioritize(job.id)} hint="move to the front" /> : null}
          {active ? <Button compact label="pause" onPress={() => pauseJob(job.id)} /> : null}
          {job.state === 'paused' || job.state === 'failed' || job.state === 'cancelled' ? <Button compact label={job.state === 'failed' ? 'retry' : 'resume'} onPress={() => resumeJob(job.id)} /> : null}
          {job.state === 'done' && job.filepath ? <Button compact label="play" onPress={() => openFile(job.filepath!)} /> : null}
          {job.state === 'done' ? <Button compact label="folder" onPress={() => reveal(job.filepath ?? job.folder, Boolean(job.filepath))} /> : null}
          {job.state === 'failed' ? <Button compact label="why" onPress={() => app.nav.push({name: 'drawing', jobId: job.id})} hint="what happened, and what to do" /> : null}
          {onDrive ? (
            <Button compact label={G.close} onPress={() => setAsking(true)} hint={live ? 'stop it: you choose whether its partial file goes too' : 'delete: you choose whether the file goes too'} />
          ) : (
            <Button compact label={G.close} onPress={() => removeJob(job.id)} hint="clear from the list" />
          )}
        </Box>
      </Box>
      <Box paddingLeft={2}>
        {job.state === 'running' && job.progress?.totalBytes ? (
          <Text>
            <ProgressBar percent={jobFraction(job)} width={Math.max(10, Math.min(30, width - 40))} />
            <Quiet>{`  ${statusText(job)}`}</Quiet>
          </Text>
        ) : (
          <Quiet>{statusText(job)}</Quiet>
        )}
      </Box>
    </Box>
  )
}

export function TunnelsScreen() {
  const app = useApp()
  const config = useConfig()
  const {columns, rows} = useSize()
  const jobs = useStore(jobsStore)
  const width = Math.max(40, Math.min(columns - 6, 100))
  const capacity = Math.max(2, Math.floor((rows - 14) / 3))

  useBack(() => {
    app.nav.home()
    return true
  })

  // running first, then waiting, then the rest (newest finished first)
  const order: Record<Job['state'], number> = {running: 0, queued: 1, held: 2, paused: 3, failed: 4, done: 5, skipped: 6, cancelled: 7}
  const sorted = [...jobs].sort((a, b) => order[a.state] - order[b.state] || (order[a.state] >= 4 ? (b.finishedAt ?? 0) - (a.finishedAt ?? 0) : 0))
  const shown = sorted.slice(0, capacity)
  const hidden = sorted.length - shown.length
  const running = jobs.filter(j => j.state === 'running').length
  const paused = jobs.filter(j => j.state === 'paused').length
  const finished = jobs.filter(j => ['done', 'failed', 'skipped', 'cancelled'].includes(j.state)).length

  return (
    <Box flexDirection="column" alignItems="center">
      <Title>tunnels</Title>
      <Quiet italic>{jobs.length ? `${running} descending · ${jobs.length} in all` : 'nothing is being drawn'}</Quiet>
      <Gap />
      {shown.map(job => (
        <Tunnel key={job.id} job={job} width={width} />
      ))}
      {hidden > 0 ? <Quiet>{`…and ${hidden} more`}</Quiet> : null}
      {jobs.length === 0 ? (
        <>
          <Quiet>offer a link on the home screen; draws appear here, side by side.</Quiet>
          <Gap />
        </>
      ) : null}
      <Gap />
      <ButtonRow>
        <Cycle label="tunnels" value={String(config.tunnels) as '1' | '2' | '3' | '4'} options={['1', '2', '3', '4']} onChange={v => updateConfig({tunnels: Number(v)})} hint="how many draws run side by side" />
        <Box width={2} />
        {running ? <Button compact label="pause all" onPress={pauseAll} /> : null}
        {paused ? <Button compact label="resume all" onPress={resumeAll} /> : null}
        {finished ? <Button compact label="clear finished" onPress={clearFinished} hint="tidy the list (files stay)" /> : null}
        <Button compact label="home" onPress={() => app.nav.home()} />
      </ButtonRow>
    </Box>
  )
}
