import path from 'node:path'
import React, {useState} from 'react'
import {Box, useInput} from 'ink'
import {Text} from '../text.js'
import {ONLY_IN_AXIVE} from '../../core/brand.js'
import {type Classified, type Remedy} from '../../core/errors.js'
import {formatBytes, formatEta, formatSpeed, truncate} from '../../core/format.js'
import {G} from '../../core/glyphs.js'
import {cancelJob, jobsStore, pauseJob, resumeJob, type Job} from '../../core/jobs.js'
import {paths, prettyPath} from '../../core/paths.js'
import {useStore} from '../../core/store.js'
import {DeleteAsk} from '../components/delete-ask.js'
import {useSize} from '../components/fullscreen.js'
import {ProgressBar} from '../components/progress-bar.js'
import {Sigil} from '../components/sigil.js'
import {openFile, reveal, useApp, useBack} from '../context.js'
import {Action, Button, ButtonRow, Gap, Quiet} from '../kit.js'
import {useTheme} from '../theme.js'

// fixed-width slots — the centred line must not change width as values tick
export function progressMeta(job: Job): string {
  const p = job.progress
  if (!p) return job.stage ?? 'opening…'
  const part = p.totalParts > 1 ? `part ${p.part + 1}/${p.totalParts}  ` : ''
  if (p.totalBytes) {
    const speed = p.speed ? formatSpeed(p.speed) : ''
    const eta = p.eta ? `${formatEta(p.eta)} left` : ''
    return `${part}${speed.padStart(10)}  ${eta.padEnd(12)}`
  }
  return `${part}${formatBytes(p.downloadedBytes).padStart(8)}  ${(p.speed ? formatSpeed(p.speed) : '').padEnd(10)}`
}

export const jobFraction = (job: Job) => (job.progress?.totalBytes ? job.progress.downloadedBytes / job.progress.totalBytes : job.state === 'done' ? 1 : 0)

/** The themed failure card: what happened, plainly, and what can be done. */
export function ErrorCard({error, width, onRemedy, report}: {error: Classified; width: number; onRemedy: (remedy: Remedy | 'back' | 'copy') => void; report?: string}) {
  const theme = useTheme()
  const label: Record<Remedy, string> = {retry: 'try again', login: 'sign in · Axive', renew: 'renew yt-dlp', mirror: 'seek a mirror · Axive', repair: 'repair tools', folder: 'another folder', vessel: 'another vessel'}
  return (
    <Box flexDirection="column" alignItems="center" width={width}>
      <Text>
        <Text bold color={theme.accent}>
          {G.cross}{' '}
        </Text>
        <Text bold color={theme.primary}>
          {error.title}
        </Text>
      </Text>
      <Gap />
      <Box width={Math.min(width, 76)} justifyContent="center">
        <Text color={theme.gray} wrap="wrap">
          {error.detail}
        </Text>
      </Box>
      <Gap />
      <ButtonRow>
        {error.remedies.map((remedy, i) => (
          <Button key={remedy} label={label[remedy]} primary={i === 0} onPress={() => onRemedy(remedy)} />
        ))}
        <Button label="back" onPress={() => onRemedy('back')} hint="esc" />
      </ButtonRow>
      {report ? (
        <Box marginTop={1}>
          <Quiet>{`a report for the developer rests in ${truncate(prettyPath(path.dirname(report)), 40)} `}</Quiet>
          <Action onPress={() => reveal(report, true)} hint={prettyPath(report)}>
            show it
          </Action>
          <Quiet> · </Quiet>
          <Action onPress={() => onRemedy('copy')} hint="copy the raw error text">
            copy error
          </Action>
        </Box>
      ) : null}
    </Box>
  )
}

/** The after-draw actions for a finished file. */
export function DoneActions({job, compact = false}: {job: Job; compact?: boolean}) {
  const app = useApp()
  const file = job.filepath
  return (
    <ButtonRow>
      {file ? <Button compact label="open" onPress={() => openFile(file)} hint="play or open it" /> : null}
      {file ? <Button compact label="reveal" onPress={() => reveal(file, true)} hint="show the file in Explorer" /> : null}
      {compact ? null : <Button compact label="tunnels" onPress={() => app.nav.push({name: 'tunnels'})} hint="every draw" />}
    </ButtonRow>
  )
}

export function DrawingScreen({jobId, animated}: {jobId: string; animated: boolean}) {
  const theme = useTheme()
  const app = useApp()
  const {columns} = useSize()
  const job = useStore(jobsStore, jobs => jobs.find(j => j.id === jobId))
  const width = Math.max(30, Math.min(columns - 6, 80))
  const [asking, setAsking] = useState(false)

  useBack(() => {
    // leaving doesn't stop the draw: it carries on in its tunnel
    app.nav.home()
    return true
  })

  useInput(
    (input, key) => {
      if (!job) return
      if (job.state === 'done' && key.return) app.nav.home()
      if (job.state === 'done' && input === 'o' && job.filepath) reveal(job.filepath, true)
    },
    {isActive: Boolean(process.stdin.isTTY)},
  )

  if (!job) {
    return (
      <Box flexDirection="column" alignItems="center">
        <Gap />
        <Quiet>that draw is gone from the tunnels.</Quiet>
      </Box>
    )
  }

  const remedy = (r: Remedy | 'back' | 'copy') => {
    if (r === 'retry') resumeJob(job.id)
    else if (r === 'back') app.nav.home(job.url)
    else if (r === 'copy') app.copy(job.error?.raw ?? '')
    else if (r === 'login') app.nav.push({name: 'axive', why: ONLY_IN_AXIVE.login})
    else if (r === 'renew') app.nav.push({name: 'settings'})
    else if (r === 'mirror') app.nav.push({name: 'axive', why: ONLY_IN_AXIVE.mirror})
    else if (r === 'repair') app.nav.push({name: 'setup', repair: true})
    else if (r === 'folder' || r === 'vessel') app.offerLink(job.url)
  }

  const header = (
    <Quiet>
      {truncate(job.title, Math.max(10, width - job.choice.label.length - 4))} · {job.choice.label}
    </Quiet>
  )

  return (
    <Box flexDirection="column" alignItems="center">
      <Gap />
      {job.state === 'done' ? (
        <Box flexDirection="column" alignItems="center">
          <Text>
            <Text bold color={theme.accent}>
              {G.therefore} received.{' '}
            </Text>
            <Text color={theme.primary}>it rests in:</Text>
          </Text>
          <Quiet>{truncate(prettyPath(job.filepath ?? job.folder), Math.max(20, width))}</Quiet>
          <Gap />
          <ButtonRow gap={2}>
            <Button label="draw another" primary onPress={() => app.nav.home()} hint="↵" />
            <Button label="open folder" onPress={() => reveal(job.filepath ?? job.folder, Boolean(job.filepath))} hint="o · show it in Explorer" />
            {job.filepath ? <Button label="play" onPress={() => openFile(job.filepath!)} hint="open with your default player" /> : null}
          </ButtonRow>
          <Gap />
          <DoneActions job={job} />
        </Box>
      ) : job.state === 'skipped' ? (
        <Box flexDirection="column" alignItems="center">
          <Text color={theme.primary}>{G.therefore} already drawn before: the archive skipped it.</Text>
          <Gap />
          <ButtonRow>
            <Button label="draw another" primary onPress={() => app.nav.home()} />
          </ButtonRow>
        </Box>
      ) : job.state === 'failed' && job.error ? (
        <ErrorCard error={job.error} width={width} onRemedy={remedy} report={job.report} />
      ) : (
        <Box flexDirection="column" alignItems="center">
          {header}
          <Gap />
          {/* every branch is exactly three rows — bar, gap, meta — so the layout never jumps */}
          {job.stage === 'binding' ? (
            <>
              <ProgressBar percent={1} />
              <Gap />
              <Text>
                <Sigil />
                <Quiet> binding…</Quiet>
              </Text>
            </>
          ) : job.progress?.totalBytes ? (
            <>
              <ProgressBar percent={jobFraction(job)} />
              <Gap />
              <Quiet>{progressMeta(job)}</Quiet>
            </>
          ) : job.progress ? (
            <>
              <Text>
                <Sigil />
                <Quiet> descending…</Quiet>
              </Text>
              <Gap />
              <Quiet>{progressMeta(job)}</Quiet>
            </>
          ) : (
            <>
              <ProgressBar percent={0} />
              <Gap />
              <Text>
                {job.state === 'running' ? <Sigil /> : <Text color={theme.gray}>{job.state === 'paused' ? G.paused : job.state === 'held' ? G.held : G.waiting}</Text>}
                <Quiet>
                  {' '}
                  {job.state === 'queued'
                      ? job.retryAt
                        ? `${job.stage} in ${Math.max(1, Math.round((job.retryAt - Date.now()) / 1000))}s`
                        : 'waiting for a free tunnel…'
                      : job.state === 'paused'
                        ? 'paused · the partial file waits'
                        : job.state === 'cancelled'
                          ? 'cancelled'
                          : `${job.stage ?? 'opening'}…`}
                </Quiet>
              </Text>
            </>
          )}
          <Gap />
          {asking ? <DeleteAsk what={job.title} live width={width} onAnswer={drive => (setAsking(false), drive === undefined ? undefined : cancelJob(job.id, {keepFiles: !drive}))} /> : null}
          <ButtonRow>
            {job.state === 'running' || job.state === 'queued' || job.state === 'held' ? (
              <Button compact label="pause" onPress={() => pauseJob(job.id)} hint="stop for now; resume picks up where it stopped" />
            ) : null}
            {job.state === 'paused' || job.state === 'cancelled' ? <Button compact label="resume" primary onPress={() => resumeJob(job.id)} /> : null}
            {job.state !== 'cancelled' && job.state !== 'failed' ? <Button compact label="cancel" onPress={() => setAsking(true)} hint="stop it: you choose whether its partial file goes too" /> : null}
            <Button compact label="home" onPress={() => app.nav.home()} hint="the draw carries on in its tunnel" />
            <Button compact label="tunnels" onPress={() => app.nav.push({name: 'tunnels'})} hint="every draw at once" />
          </ButtonRow>
          <Box marginTop={1}>
            <Quiet italic>{`resting in ${truncate(prettyPath(job.folder), 50)}${job.folder === paths.root ? '' : ''}`}</Quiet>
          </Box>
        </Box>
      )}
    </Box>
  )
}
