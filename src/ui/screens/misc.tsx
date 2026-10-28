import React, {useEffect, useMemo, useRef, useState} from 'react'
import {Box, useApp as useInkApp} from 'ink'
import {Text} from '../text.js'
import {ONLY_IN_AXIVE} from '../../core/brand.js'
import {bridge} from '../../core/bridge.js'
import {updateConfig, useConfig} from '../../core/config.js'
import {type Classified, type Remedy} from '../../core/errors.js'
import {formatDuration, truncate} from '../../core/format.js'
import {G} from '../../core/glyphs.js'
import {useStore} from '../../core/store.js'
import {installTools, needsSetup, payload, verifyTools, type ToolHealth} from '../../core/tools.js'
import {tools} from '../../core/tools.js'
import {FramedInput} from '../components/framed-input.js'
import {useSize} from '../components/fullscreen.js'
import {List, ListRow} from '../components/list.js'
import {say} from '../components/notice.js'
import {Panel} from '../components/panel.js'
import {ProgressBar} from '../components/progress-bar.js'
import {Sigil} from '../components/sigil.js'
import {TextField} from '../components/text-field.js'
import {useApp, useBack} from '../context.js'
import {Action, Button, ButtonRow, Cycle, Gap, Quiet, Title} from '../kit.js'
import {useTheme} from '../theme.js'
import {ErrorCard} from './drawing.js'

export function ProbingScreen({url, status, animated, onCancel}: {url: string; status: string; animated: boolean; onCancel: () => void}) {
  const {columns} = useSize()
  const boxWidth = Math.max(20, Math.min(64, columns - 14))
  useBack(() => {
    onCancel()
    return true
  })
  return (
    <Box flexDirection="column" alignItems="center">
      <FramedInput title="Offer a link" width={boxWidth} button="draw" buttonDim>
        <Quiet>{url.length > boxWidth - 8 ? `${url.slice(0, boxWidth - 9)}…` : url}</Quiet>
      </FramedInput>
      <Gap />
      <Box>
        <Sigil />
        <Quiet>{` ${status}  `}</Quiet>
        <Action onPress={onCancel} hint="esc">
          cancel
        </Action>
      </Box>
    </Box>
  )
}

/** A failure before any draw started (reading the link, mostly). */
export function ErrorScreen({error, url, title, duration, report, retry}: {error: Classified; url?: string; title?: string; duration?: number; report?: string; retry?: () => void}) {
  const app = useApp()
  const {columns} = useSize()
  useBack(() => {
    app.nav.home(url)
    return true
  })
  const remedy = (r: Remedy | 'back' | 'copy') => {
    if (r === 'retry') (retry ?? (() => url && app.offerLink(url)))()
    else if (r === 'back' || r === 'vessel' || r === 'folder') app.nav.home(url)
    else if (r === 'copy') app.copy(error.raw)
    else if (r === 'login') app.nav.push({name: 'axive', why: ONLY_IN_AXIVE.login})
    else if (r === 'renew') app.nav.push({name: 'settings'})
    else if (r === 'mirror') app.nav.push({name: 'axive', why: ONLY_IN_AXIVE.mirror})
    else if (r === 'repair') app.nav.push({name: 'setup', repair: true})
  }
  return (
    <Box flexDirection="column" alignItems="center">
      <Gap />
      <ErrorCard error={error} width={Math.max(30, Math.min(columns - 6, 80))} onRemedy={remedy} report={report} />
      {error.kind === 'unsupported' && url && /^(https?|ftp):\/\//i.test(url) ? (
        <Box marginTop={1}>
          <Button compact label="fetch it as a file" onPress={() => app.nav.replace({name: 'fetch', add: [url]})} hint="not a video page? the download manager takes any file link" />
        </Box>
      ) : null}
    </Box>
  )
}

/**
 * First launch of a lone Axive.exe: unpack the tools it carries. Also the
 * repair screen: verify every tool against its recorded hash, restore what
 * is missing or altered — from the exe itself, no network needed.
 */
export function SetupScreen({repair = false, onReady}: {repair?: boolean; onReady?: () => void}) {
  const app = useApp()
  const theme = useTheme()
  const {exit} = useInkApp()
  const [health, setHealth] = useState<ToolHealth[]>()
  const [step, setStep] = useState<{label: string; done: number; total: number}>()
  const [error, setError] = useState<string>()
  const carries = Boolean(payload())

  useBack(() => {
    if (step) return true
    if (onReady) exit()
    else app.nav.back()
    return true
  })

  const install = async (only?: string[]) => {
    setError(undefined)
    try {
      await installTools(only, (label, done, total) => setStep({label, done, total}))
      setStep(undefined)
      setHealth(await verifyTools())
      say('the vessels are ready', 'ok')
      onReady?.()
    } catch (e) {
      setStep(undefined)
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    if (!repair && needsSetup()) void install()
    else void verifyTools().then(setHealth)
  }, [])

  const broken = health?.filter(h => !h.ok) ?? []
  return (
    <Box flexDirection="column" alignItems="center">
      {step ? (
        <>
          <Title>preparing the vessels</Title>
          <Quiet italic>Axive Free carries its own tools; unpacking them once</Quiet>
          <Gap />
          <ProgressBar percent={step.total ? step.done / step.total : 0} />
          <Text>
            <Sigil />
            <Quiet> {step.label}…</Quiet>
          </Text>
        </>
      ) : error ? (
        <>
          <Text color={theme.accent}>
            {G.cross} {error}
          </Text>
          <Gap />
          <ButtonRow>
            <Button label="try again" primary onPress={() => void install()} />
            <Button label="leave" onPress={() => exit()} />
          </ButtonRow>
        </>
      ) : health ? (
        <>
          <Title>{broken.length ? 'something is amiss' : 'every vessel is whole'}</Title>
          <Gap />
          {health.map(h => (
            <Text key={h.name} color={h.ok ? theme.primary : theme.accent}>
              {h.ok ? G.check : G.cross} {h.name}
              {h.reason ? `: ${h.reason}` : ''}
            </Text>
          ))}
          <Gap />
          <ButtonRow>
            {broken.length && carries ? <Button label="repair" primary onPress={() => void install(broken.map(b => b.name))} hint="restore from Axive Free itself" /> : null}
            {carries ? <Button label="restore everything" onPress={() => void install()} /> : null}
            <Button label={onReady ? 'continue' : 'back'} onPress={() => (onReady ? onReady() : app.nav.back())} />
          </ButtonRow>
          {!carries ? (
            <Box marginTop={1}>
              <Quiet>this build runs from a folder; repair by reinstalling, or set AXIVE_BIN.</Quiet>
            </Box>
          ) : null}
        </>
      ) : (
        <Text>
          <Sigil />
          <Quiet> checking every tool…</Quiet>
        </Text>
      )}
    </Box>
  )
}
