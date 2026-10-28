import React, {useEffect, useState} from 'react'
import {Box, useInput} from 'ink'
import {Text} from '../text.js'
import {AXIVE_PITCH, UPGRADE_URL} from '../../core/brand.js'
import {bridge} from '../../core/bridge.js'
import {META, updateConfig, useConfig, type Config} from '../../core/config.js'
import {applyFetchSettings} from '../../core/fetcher.js'
import {truncate} from '../../core/format.js'
import {G} from '../../core/glyphs.js'
import {jobsStore} from '../../core/jobs.js'
import {paths, prettyPath} from '../../core/paths.js'
import {useStore} from '../../core/store.js'
import {installFragment, removeFragment, wtExe} from '../../core/terminal.js'
import {ffmpegVersion, ytdlpVersion} from '../../core/tools.js'
import {checkForUpdates, renewYtdlp} from '../../core/update.js'
import {useSize} from '../components/fullscreen.js'
import {say} from '../components/notice.js'
import {Sigil} from '../components/sigil.js'
import {openUrl, reveal, useApp, useBack} from '../context.js'
import {Button, ButtonRow, Cycle, Faint, Gap, Quiet, Rule, Title, Toggle} from '../kit.js'
import {useTheme} from '../theme.js'

type Tab = 'draw' | 'files' | 'renewal' | 'terminal'
const TABS: Array<[Tab, string]> = [
  ['draw', 'draw'],
  ['files', 'download manager'],
  ['renewal', 'renewal & tools'],
  ['terminal', 'terminal'],
]

// what the full Axive's settings add, one line each
const AXIVE_SETTINGS = ['subtitles, chapters and SponsorBlock', 'convert after drawing, run a program after', 'Telegram, Discord and toasts when done', 'ghost, the phone and the browser extension', 'named queues, schedules and off-peak hours', 'Dutch, as well as English']

function TabButton({label, active, onPress}: {label: string; active: boolean; onPress: () => void}) {
  return <Button compact label={label} primary={active} onPress={onPress} />
}

export function SettingsScreen() {
  const app = useApp()
  const theme = useTheme()
  const config = useConfig()
  const jobs = useStore(jobsStore)
  const {columns} = useSize()
  const [tab, setTab] = useState<Tab>('draw')
  const [busy, setBusy] = useState<string>()
  const [versions, setVersions] = useState<{ytdlp?: string; ffmpeg?: string}>({})
  const [news, setNews] = useState<string>()
  const width = Math.max(44, Math.min(columns - 8, 90))
  const half = Math.floor((width - 4) / 2)

  useBack(() => {
    app.nav.home()
    return true
  })

  useEffect(() => {
    if (tab === 'renewal') setVersions({ytdlp: ytdlpVersion(), ffmpeg: ffmpegVersion()})
  }, [tab])

  useInput(
    (_input, key) => {
      const i = TABS.findIndex(([t]) => t === tab)
      if (key.rightArrow) setTab(TABS[(i + 1) % TABS.length]![0])
      if (key.leftArrow) setTab(TABS[(i + TABS.length - 1) % TABS.length]![0])
    },
    {isActive: Boolean(process.stdin.isTTY)},
  )

  const set = (patch: Partial<Config>) => updateConfig(patch)
  const running = jobs.some(j => j.state === 'running')

  const renew = async () => {
    if (running) {
      say('let the running draws finish (or pause them) before renewing yt-dlp', 'warn')
      return
    }
    setBusy('renewing yt-dlp…')
    try {
      const line = await renewYtdlp(stage => setBusy(`${stage}…`))
      say(line, 'ok', 6000)
      setVersions({ytdlp: ytdlpVersion(), ffmpeg: ffmpegVersion()})
    } catch (error) {
      say(`renewal failed: ${(error as Error).message}`, 'error', 7000)
    } finally {
      setBusy(undefined)
    }
  }

  const look = async () => {
    setBusy('looking for renewal…')
    const found = await checkForUpdates(true)
    setBusy(undefined)
    const parts = [found.ytdlp ? `yt-dlp ${found.ytdlp.latest} is out (you have ${found.ytdlp.current})` : 'yt-dlp is current', found.axive ? `Axive Free ${found.axive.latest} is out` : 'Axive Free is current']
    setNews(parts.join(' · '))
  }

  const body = (() => {
    switch (tab) {
      case 'draw':
        return (
          <>
            <Box columnGap={2}>
              <Box flexDirection="column" width={half}>
                <Toggle label={META.askWhere.label} value={config.askWhere} onChange={askWhere => set({askWhere})} hint={META.askWhere.help} />
                <Box>
                  <Text color={theme.gray}>folder </Text>
                  <Text color={theme.primary}>{truncate(prettyPath(config.folder), half - 18)} </Text>
                  <Button compact label="change" onPress={() => void bridge.pickFolder('Default folder for draws', config.folder).then(folder => folder && set({folder}))} hint="open the Windows folder picker" />
                </Box>
                <Cycle label="sort into" value={config.organize} options={META.organize.options as readonly Config['organize'][]} display={v => (v === 'none' ? 'one folder' : v === 'channel' ? 'a folder per channel' : v === 'date' ? 'a folder per month' : 'channel / month')} onChange={organize => set({organize})} hint={META.organize.help} />
                <Cycle label="names" value={config.naming} options={META.naming.options as readonly Config['naming'][]} display={v => (v === 'title' ? 'title' : v === 'title-id' ? 'title [id]' : v === 'uploader-title' ? 'channel - title' : 'date title')} onChange={naming => set({naming})} hint={META.naming.help} />
              </Box>
              <Box flexDirection="column" width={half}>
                <Cycle label="tunnels" value={String(config.tunnels) as '1' | '2'} options={['1', '2']} onChange={v => (set({tunnels: Number(v)}), void applyFetchSettings())} hint={`${META.tunnels.help}. Axive runs up to 4`} />
                <Cycle label="speed limit" value={config.rateLimit} options={['', '500K', '1M', '2M', '5M', '10M']} display={v => (v ? `${v}B/s` : 'none')} onChange={rateLimit => (set({rateLimit}), void applyFetchSettings())} hint={META.rateLimit.help} />
                <Cycle label="retries" value={String(config.retries) as '0' | '3' | '5' | '10'} options={['0', '3', '5', '10']} onChange={v => set({retries: Number(v)})} hint={META.retries.help} />
              </Box>
            </Box>
            <Gap />
            <Box columnGap={3} flexWrap="wrap">
              <Toggle label={META.skipArchived.label} value={config.skipArchived} onChange={skipArchived => set({skipArchived})} hint={`${META.skipArchived.help} (${prettyPath(paths.archive)})`} />
              <Toggle label={META.warnDuplicates.label} value={config.warnDuplicates} onChange={warnDuplicates => set({warnDuplicates})} hint={META.warnDuplicates.help} />
              <Toggle label={META.embedMetadata.label} value={config.embedMetadata} onChange={embedMetadata => set({embedMetadata})} hint={META.embedMetadata.help} />
              <Toggle label={META.embedThumbnail.label} value={config.embedThumbnail} onChange={embedThumbnail => set({embedThumbnail})} hint={META.embedThumbnail.help} />
            </Box>
          </>
        )
      case 'files':
        return (
          <Box columnGap={2}>
            <Box flexDirection="column" width={half}>
              <Cycle label="connections" value={String(config.fetchConnections)} options={['1', '2', '4', '8', '12', '16']} onChange={v => (set({fetchConnections: Number(v)}), void applyFetchSettings())} hint={META.fetchConnections.help} />
              <Cycle label="same name" value={config.onDuplicate} options={META.onDuplicate.options as readonly Config['onDuplicate'][]} display={v => (v === 'number' ? 'keep both' : v === 'overwrite' ? 'replace' : v)} onChange={onDuplicate => set({onDuplicate})} hint={META.onDuplicate.help} />
            </Box>
            <Box flexDirection="column" width={half}>
              <Toggle label={META.fetchMediaFiles.label} value={config.fetchMediaFiles} onChange={fetchMediaFiles => set({fetchMediaFiles})} hint={META.fetchMediaFiles.help} />
              <Toggle label={META.categoryFolders.label} value={config.categoryFolders} onChange={categoryFolders => set({categoryFolders})} hint={META.categoryFolders.help} />
              <Toggle label={META.climbBack.label} value={config.climbBack} onChange={climbBack => (set({climbBack}), void applyFetchSettings())} hint={META.climbBack.help} />
            </Box>
          </Box>
        )
      case 'renewal':
        return (
          <>
            <Quiet>{`axive free ${__AXIVE_VERSION__} · yt-dlp ${versions.ytdlp || '…'} · ffmpeg ${(versions.ffmpeg || '…').slice(0, 24)}`}</Quiet>
            <Gap />
            {busy ? (
              <Text>
                <Sigil />
                <Quiet> {busy}</Quiet>
              </Text>
            ) : (
              <ButtonRow>
                <Button label="renew yt-dlp" primary onPress={() => void renew()} hint="sites change often; yt-dlp keeps up. checked against its published checksum" />
                <Button label="look for renewal" onPress={() => void look()} />
                <Button label="verify & repair" onPress={() => app.nav.push({name: 'setup', repair: true})} hint="check every tool against its recorded hash; restore anything damaged" />
              </ButtonRow>
            )}
            {news ? (
              <Box marginTop={1}>
                <Quiet>{news}</Quiet>
              </Box>
            ) : null}
            <Gap />
            <Toggle label={META.checkUpdates.label} value={config.checkUpdates} onChange={checkUpdates => set({checkUpdates})} hint={META.checkUpdates.help} />
            <Gap />
            <ButtonRow>
              <Button compact label="open data folder" onPress={() => reveal(paths.root)} hint={prettyPath(paths.root)} />
              <Button compact label="open logs & reports" onPress={() => reveal(paths.logs)} hint={`${prettyPath(paths.logs)} · scrubbed of your name and secrets`} />
            </ButtonRow>
          </>
        )
      case 'terminal':
        return (
          <>
            <Box columnGap={3} flexWrap="wrap">
              <Toggle label={META.openInTerminal.label} value={config.openInTerminal} disabled={!wtExe()} onChange={openInTerminal => set({openInTerminal})} hint={META.openInTerminal.help} />
              <Toggle label={META.vignette.label} value={config.vignette} onChange={vignette => (set({vignette}), installFragment())} hint={`${META.vignette.help}. takes effect in the next window`} />
            </Box>
            <Box columnGap={3} flexWrap="wrap" marginTop={1}>
              <Toggle label={META.animations.label} value={config.animations} onChange={animations => set({animations})} hint={META.animations.help} />
              <Toggle label={META.grandSigil.label} value={config.grandSigil} onChange={grandSigil => set({grandSigil})} hint={META.grandSigil.help} />
              <Toggle label={META.hoverHints.label} value={config.hoverHints} onChange={hoverHints => set({hoverHints})} hint={META.hoverHints.help} />
              <Cycle label="theme" value={config.theme} options={META.theme.options as readonly Config['theme'][]} onChange={theme => set({theme})} hint={META.theme.help} />
            </Box>
            <Box marginTop={1}>
              <Button compact label="remove the Windows Terminal profile" disabled={!wtExe()} onPress={() => (removeFragment(), set({openInTerminal: false}), say('profile removed; Axive Free opens in the console it was started from', 'ok'))} />
            </Box>
          </>
        )
    }
  })()

  return (
    <Box flexDirection="column" alignItems="center" width={width}>
      <Title>settings</Title>
      <Quiet italic>{'manners are the last thing a person loses. set yours'}</Quiet>
      {/* the switch that explains every other word: always in view, above the tabs */}
      <Box marginTop={1}>
        <Toggle label={META.plainWords.label} value={config.plainWords} onChange={plainWords => set({plainWords})} hint={META.plainWords.help} />
      </Box>
      <Gap />
      <ButtonRow>
        {TABS.map(([id, label]) => (
          <TabButton key={id} label={label} active={tab === id} onPress={() => setTab(id)} />
        ))}
      </ButtonRow>
      <Gap />
      <Box flexDirection="column" width={width} minHeight={10}>
        {body}
      </Box>
      <Gap />
      <Rule title={`${G.star} Axive's settings also hold`} width={width} />
      <Box flexDirection="column" width={width} paddingLeft={2}>
        {AXIVE_SETTINGS.map(line => (
          <Faint key={line}>{`${G.dot} ${line}`}</Faint>
        ))}
      </Box>
      <Box marginTop={1}>
        <ButtonRow>
          <Button compact label="home" onPress={() => app.nav.home()} />
          <Button compact quiet label="see Axive" onPress={() => app.nav.push({name: 'axive'})} hint={AXIVE_PITCH} />
          <Button compact quiet label="axive.xyz" onPress={() => openUrl(UPGRADE_URL)} hint={UPGRADE_URL} />
        </ButtonRow>
      </Box>
      <Box marginTop={1}>
        <Quiet>{`also from a terminal: axive-free config list · axive-free config set <key> <value>  (${G.dot} ${prettyPath(paths.config)})`}</Quiet>
      </Box>
    </Box>
  )
}
