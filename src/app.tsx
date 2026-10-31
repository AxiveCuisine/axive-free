import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Box, useApp as useInkApp, useInput, usePaste} from 'ink'
import {Text} from './ui/text.js'
import {bridge} from './core/bridge.js'
import {useConfig} from './core/config.js'
import {AXIVE_PITCH, ONLY_IN_AXIVE} from './core/brand.js'
import {fetchKind, fetchStore, isMagnet, isTorrent, resumeLeftovers} from './core/fetcher.js'
import {formatSpeed} from './core/format.js'
import {totalSpeed} from './core/pieces.js'
import {classify} from './core/errors.js'
import {G} from './core/glyphs.js'
import {type InputRouter} from './core/input.js'
import {activeCount, addJobs, jobsStore} from './core/jobs.js'
import {rememberLink} from './core/ledger.js'
import {writeReport} from './core/log.js'
import {offeredStore} from './core/instance.js'
import {detectPlatform, isProbablyUrl} from './core/platforms.js'
import {useStore} from './core/store.js'
import {taskbarProgress, type TermInfo} from './core/terminal.js'
import {tools, whenToolsReady} from './core/tools.js'
import {checkForUpdates} from './core/update.js'
import {capChoice, probe, ToolError} from './core/ytdlp.js'
import {Boot} from './ui/components/boot.js'
import {useTerminalSize} from './ui/components/fullscreen.js'
import {LogsDrawer} from './ui/components/logs.js'
import {NoticeLine, noticeStore, say} from './ui/components/notice.js'
import {CaptionButton, Chip, DragArea, KeyLine, Rail, Shell, shellLayout, type RailEntry} from './ui/components/shell.js'
import {fieldFocused, pasteIntoFocused, setHelpKey} from './ui/components/text-field.js'
import {Sparkline} from './ui/components/viz.js'
import {Whisper} from './ui/components/whisper.js'
import {AppContext, backHandler, type App as AppApi, type Nav, type Screen} from './ui/context.js'
import {writeRaw} from './ui/frames.js'
import {Button} from './ui/kit.js'
import {MouseLayer, copiedStore, hintStore} from './ui/mouse.js'
import {AxiveScreen} from './ui/screens/axive.js'
import {DestinationScreen} from './ui/screens/destination.js'
import {DrawingScreen} from './ui/screens/drawing.js'
import {FetchScreen} from './ui/screens/fetch.js'
import {GuideScreen} from './ui/screens/guide.js'
import {fetchesUnderway, HomeScreen, linksIn} from './ui/screens/home.js'
import {ErrorScreen, ProbingScreen, SetupScreen} from './ui/screens/misc.js'
import {PickingScreen, useQueueDraw} from './ui/screens/picking.js'
import {SettingsScreen} from './ui/screens/settings.js'
import {TunnelsScreen} from './ui/screens/tunnels.js'
import {speedHistory, startSpeedHistory} from './ui/speed.js'
import {ThemeProvider, themeFor, useTheme} from './ui/theme.js'
import {VIEWS} from './ui/views.js'

export type AppProps = {
  term: TermInfo
  router: InputRouter
  initialUrl?: string
  /** a lone Axive.exe whose tools are not unpacked yet */
  setupNeeded: boolean
  restored: number
}

export function App(props: AppProps) {
  const config = useConfig()
  const [booted, setBooted] = useState(!process.stdout.isTTY || !config.animations || Boolean(props.initialUrl))
  const finishBoot = useCallback(() => setBooted(true), [])
  const copy = useCallback((text: string) => {
    void bridge.writeClipboard(text)
  }, [])
  return (
    <ThemeProvider mode={config.theme}>
      <MouseLayer router={props.router} copy={copy} onRight={() => void pasteIntoFocused()} selectionColors={themeFor(config.theme).selection} hoverHints={config.hoverHints}>
        {booted ? <Main {...props} copy={copy} /> : <Boot onDone={finishBoot} />}
      </MouseLayer>
    </ThemeProvider>
  )
}

function Main({term, initialUrl, setupNeeded, restored, copy}: AppProps & {copy: (text: string) => void}) {
  const config = useConfig()
  const theme = useTheme()
  const {exit} = useInkApp()
  const {columns, rows} = useTerminalSize()
  const [stack, setStack] = useState<Screen[]>(() => (setupNeeded ? [{name: 'setup'}] : [{name: 'home'}]))
  const [logsOpen, setLogsOpen] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [renewal, setRenewal] = useState<string>()
  const jobs = useStore(jobsStore)
  const hint = useStore(hintStore)
  const copied = useStore(copiedStore)
  const history = useStore(speedHistory)
  const probeAbort = useRef<AbortController | undefined>(undefined)
  const screen = stack.at(-1)!
  const nav = useMemo<Nav>(
    () => ({
      push: s => setStack(st => (st.at(-1)?.name === s.name && s.name !== 'drawing' ? [...st.slice(0, -1), s] : [...st, s])),
      replace: s => setStack(st => [...st.slice(0, -1), s]),
      back: () => setStack(st => (st.length > 1 ? st.slice(0, -1) : st)),
      home: link => {
        probeAbort.current?.abort()
        setStack([{name: 'home', link}])
      },
    }),
    [],
  )

  const offerLink = useCallback((url: string) => {
    probeAbort.current?.abort()
    const controller = new AbortController()
    probeAbort.current = controller
    rememberLink(url)
    // torrents and magnets, Spotify: the full Axive's
    if (isMagnet(url) || isTorrent(url)) {
      setStack(st => [...st.filter(s => s.name !== 'probing'), {name: 'axive', why: ONLY_IN_AXIVE.torrents}])
      return
    }
    if (detectPlatform(url).key === 'spotify') {
      setStack(st => [...st.filter(s => s.name !== 'probing'), {name: 'axive', why: ONLY_IN_AXIVE.spotify}])
      return
    }
    // files are the download manager's, not yt-dlp's
    if (fetchKind(url)) {
      setStack(st => [...st.filter(s => s.name !== 'probing'), {name: 'fetch', add: [url]}])
      return
    }
    setStack(st => [...st.filter(s => s.name !== 'probing'), {name: 'probing', url, status: 'reading…'}])
    void (async () => {
      try {
        await whenToolsReady()
        const result = await probe(tools(), url, controller.signal)
        if (controller.signal.aborted) return
        setStack(st => [...st.filter(s => s.name !== 'probing'), result.kind === 'video' ? {name: 'picking', probe: {url, info: result.info, infoJsonPath: result.infoJsonPath}} : {name: 'axive', why: ONLY_IN_AXIVE.playlist}])
      } catch (error) {
        if (controller.signal.aborted) return
        const classified = classify(error)
        const report = writeReport({
          title: 'could not read a link',
          kind: classified.kind,
          url,
          command: error instanceof ToolError ? error.command : undefined,
          stderr: error instanceof ToolError ? error.stderr : String((error as Error)?.stack ?? error),
        })
        setStack(st => [...st.filter(s => s.name !== 'probing'), {name: 'error', error: classified, url, report, retry: () => offerLink(url)}])
      }
    })()
  }, [])

  const leaveArmed = useRef(0)
  const leave = useCallback(() => {
    const busy = jobsStore.get().filter(j => j.state === 'running').length
    if (busy && Date.now() - leaveArmed.current > 4000) {
      leaveArmed.current = Date.now()
      say(`${busy} draw${busy === 1 ? ' is' : 's are'} still descending: leave again to go (they come back paused)`, 'warn', 4000)
      return
    }
    exit()
  }, [exit])

  const app = useMemo<AppApi>(() => ({nav, term, hostReady: bridge.available, offerLink, copy, leave}), [nav, term, offerLink, copy, leave])

  // queueDraw needs the app context; keep a ref so offerLink (above) can reach it
  const queueRef = useRef<ReturnType<typeof useQueueDraw>>(() => {})

  // ---- startup -------------------------------------------------------
  // what runs the tools waits while a first launch (or a new build) unpacks them:
  // an aria2 or yt-dlp started from the old folder would hold it, and the unpack would fail
  const [toolsReady, setToolsReady] = useState(!setupNeeded)
  useEffect(() => {
    if (!toolsReady) return
    if (initialUrl) offerLink(initialUrl)
    // fetches an earlier session left unfinished pick up where they were
    resumeLeftovers()
    const timer = setTimeout(() => {
      void checkForUpdates().then(news => {
        if (news.ytdlp) setRenewal(`yt-dlp ${news.ytdlp.latest} is out`)
        else if (news.axive) setRenewal(`Axive Free ${news.axive.latest} is out`)
      })
    }, 4000)
    return () => clearTimeout(timer)
  }, [toolsReady])

  useEffect(() => {
    if (restored) say(`${restored} unfinished draw${restored === 1 ? '' : 's'} came back paused. resume them in tunnels`, 'info', 8000)
    void bridge.window('isMax').then(value => setMaximized(Boolean(value)))
    const stopHistory = startSpeedHistory()
    // a second launch with a link hands it here
    const stopOffered = offeredStore.subscribe(() => {
      const url = offeredStore.get()
      if (url) offerLink(url)
    })
    return () => (stopHistory(), stopOffered())
  }, [])

  // a copy made by dragging across the screen
  useEffect(() => {
    if (copied) say('copied', 'ok', 1400)
  }, [copied])

  // progress on the taskbar button and the tab (Windows Terminal reads OSC 9;4)
  useEffect(() => {
    if (term.kind !== 'wt') return
    const running = jobs.filter(j => j.state === 'running')
    if (!running.length) {
      writeRaw(taskbarProgress(0))
      return
    }
    const known = running.filter(j => j.progress?.totalBytes)
    if (!known.length) {
      writeRaw(taskbarProgress(3))
      return
    }
    const total = known.reduce((sum, j) => sum + j.progress!.downloadedBytes / j.progress!.totalBytes!, 0)
    writeRaw(taskbarProgress(1, (total / known.length) * 100))
  }, [jobs, term.kind])
  useEffect(() => () => writeRaw(taskbarProgress(0)), [])

  // ---- doors -----------------------------------------------------------
  const go = useCallback(
    (id: string) => {
      const to: Record<string, Screen> = {
        home: {name: 'home'},
        fetch: {name: 'fetch'},
        tunnels: {name: 'tunnels'},
        axive: {name: 'axive'},
        settings: {name: 'settings'},
      }
      if (id === 'guide') return openGuide()
      // a link still being read is let go: its answer must not pull this door back to it
      probeAbort.current?.abort()
      if (id === 'home') return nav.home()
      const target = to[id]
      // the rail is a menu of places: a door opens over home, never piles up
      if (target) setStack(st => [st[0]!.name === 'home' ? st[0]! : {name: 'home'}, target])
    },
    [nav],
  )

  // ---- keys -----------------------------------------------------------
  // the ? sheet: from anywhere, about the screen it was opened from
  const openGuide = useCallback(() => setStack(st => (st.at(-1)?.name === 'guide' ? st.slice(0, -1) : [...st, {name: 'guide', about: st.at(-1)?.name ?? 'home'}])), [])
  useEffect(() => {
    setHelpKey(openGuide)
    return () => setHelpKey(undefined)
  }, [openGuide])
  useInput(
    (input, key) => {
      if (key.escape) {
        const handler = backHandler.get()
        if (handler?.()) return
        if (screen.name === 'probing') {
          probeAbort.current?.abort()
          nav.home(screen.url)
          return
        }
        nav.back()
      }
      if (input === '?' && !key.ctrl && !key.meta && !fieldFocused()) openGuide()
      if (key.ctrl && input === 'l') setLogsOpen(open => !open)
      if (key.ctrl && input === 'd') go('fetch')
      if (key.ctrl && input === 'n') nav.home()
      if (key.ctrl && (input === ',' || input === 's')) go('settings')
    },
    {isActive: Boolean(process.stdin.isTTY)},
  )
  // ctrl+v (or a paste) with no field to take it: the links go where they belong
  usePaste(
    text => {
      if (fieldFocused()) return
      const links = linksIn(text)
      if (!links.length) return
      const files = links.filter(l => fetchKind(l))
      if (files.length === links.length) setStack(st => [st[0]!, {name: 'fetch', add: files}])
      else {
        // one link at a time in Free: many at once is Axive's batch
        const first = links.find(l => isProbablyUrl(l) || isMagnet(l)) ?? links[0]!
        if (links.length > 1) say(`${ONLY_IN_AXIVE.batch}. drawing the first`, 'info', 6000)
        offerLink(first)
      }
    },
    {isActive: Boolean(process.stdin.isTTY)},
  )

  // ---- window ---------------------------------------------------------
  const toggleMax = () => void bridge.window('toggleMax').then(value => setMaximized(Boolean(value)))

  const active = activeCount(jobs)
  const running = jobs.filter(j => j.state === 'running').length
  const animated = config.animations
  const fetchItems = useStore(fetchStore).items
  const fetching = fetchesUnderway(fetchItems)
  const fetchLive = fetchItems.filter(i => i.state === 'active').length
  // every draw and fetch together
  const speed = totalSpeed(jobs, fetchItems)
  const notice = useStore(noticeStore)

  const drawerHeight = logsOpen ? Math.max(5, Math.min(10, Math.floor(rows / 4))) : 0
  const layout = shellLayout(columns, rows, {grandAllowed: term.kind === 'wt' && config.grandSigil, drawerH: drawerHeight})

  const header = (
    <Box width={columns} height={1}>
      <Box paddingLeft={2} flexShrink={0}>
        <Chip lit={speed > 0} onPress={() => go(fetchLive && !running ? 'fetch' : 'tunnels')} hint="all downloads together" label="speed">
          {speed > 0 ? `${G.down} ${formatSpeed(speed)}` : `${G.down} at rest`}
        </Chip>
      </Box>
      {columns >= 100 ? (
        <Box marginRight={3} flexShrink={0}>
          <Sparkline values={history.total} width={columns >= 130 ? 30 : 18} live={speed > 0} />
        </Box>
      ) : null}
      {active ? (
        <Chip lit={running > 0} onPress={() => go('tunnels')} hint="see every draw">
          {running ? `${running} descending` : `${active} waiting`}
        </Chip>
      ) : null}
      {fetching ? (
        <Chip lit={fetchLive > 0} onPress={() => go('fetch')} hint="the download manager (ctrl+d)">
          {`${fetching} fetching`}
        </Chip>
      ) : null}
      {renewal ? (
        <Chip lit onPress={() => (setRenewal(undefined), go('settings'))} hint="renew in settings › renewal & tools">
          {`${G.star} ${renewal}`}
        </Chip>
      ) : null}
      <Chip lit={false} onPress={() => go('axive')} hint={AXIVE_PITCH}>
        {`${G.star} Axive`}
      </Chip>
      <DragArea onDrag={term.chrome ? () => void bridge.window('drag') : undefined} onDouble={term.chrome ? toggleMax : undefined} />
      <Chip lit={logsOpen} onPress={() => setLogsOpen(open => !open)} hint="the raw output of yt-dlp and ffmpeg (ctrl+l)">
        logs
      </Chip>
      {term.chrome ? (
        <>
          <CaptionButton glyph={G.minimize} onPress={() => void bridge.window('minimize')} hint="minimize" />
          <CaptionButton glyph={maximized ? G.restore : G.maximize} onPress={toggleMax} hint={maximized ? 'restore' : 'maximize'} />
          <CaptionButton glyph={G.close} onPress={leave} hint="leave Axive Free" danger />
        </>
      ) : null}
    </Box>
  )

  const waitingJobs = jobs.filter(j => j.state === 'queued' || j.state === 'held').length
  const fetchWaiting = fetchItems.filter(i => i.state === 'waiting' || i.state === 'paused').length
  const railEntries: RailEntry[] = [
    {id: 'home', label: 'draw', hint: 'draw a link: video or music from 1,800+ sites (ctrl+n)'},
    {id: 'fetch', label: 'download manager', hint: 'fetch: any file over up to 16 connections (ctrl+d)', count: fetchLive ? String(fetchLive) : fetchWaiting ? String(fetchWaiting) : '', tone: fetchLive ? 'live' : 'quiet'},
    {id: 'tunnels', label: 'tunnels', hint: 'see every draw, pause, reorder', count: running ? String(running) : waitingJobs ? String(waitingJobs) : '', tone: running ? 'live' : 'quiet'},
    {gap: true},
    {id: 'settings', label: 'settings', hint: 'settings: where, how, and how fast'},
    {id: 'guide', label: 'keys', hint: 'every key, and every door (?)'},
    {gap: true},
    {group: 'the full table'},
    {id: 'axive', label: 'Axive', hint: AXIVE_PITCH},
  ]
  // a short window keeps the doors and drops the group names
  const fitted = layout.bodyH < railEntries.length + 3 ? railEntries.filter(e => !('group' in e) && !('gap' in e)) : railEntries
  const view = VIEWS[screen.name]

  const body = (() => {
    switch (screen.name) {
      case 'home':
        return <HomeScreen key={screen.link ?? 'home'} link={screen.link} animated={animated} />
      case 'probing':
        return (
          <ProbingScreen
            url={screen.url}
            status={screen.status}
            animated={animated}
            onCancel={() => {
              probeAbort.current?.abort()
              nav.home(screen.url)
            }}
          />
        )
      case 'picking':
        return <PickingScreen probe={screen.probe} animated={animated} />
      case 'destination':
        return <DestinationScreen title={screen.title} count={screen.count} onChosen={screen.onChosen} />
      case 'drawing':
        return <DrawingScreen jobId={screen.jobId} animated={animated} />
      case 'tunnels':
        return <TunnelsScreen />
      case 'error':
        return <ErrorScreen error={screen.error} url={screen.url} title={screen.title} duration={screen.duration} report={screen.report} retry={screen.retry} />
      case 'settings':
        return <SettingsScreen />
      case 'fetch':
        return <FetchScreen key={screen.add?.join(' ') ?? 'fetch'} add={screen.add} />
      case 'axive':
        return <AxiveScreen why={screen.why} />
      case 'guide':
        return <GuideScreen about={screen.about} />
      case 'setup':
        return <SetupScreen repair={stack.length > 1} onReady={stack.length === 1 ? () => (bridge.start(tools().host), setToolsReady(true), setStack([{name: 'home'}])) : undefined} />
    }
  })()

  const footStatus = notice ? (
    <Box paddingLeft={2}>
      <NoticeLine width={columns - 50} animated={animated} />
    </Box>
  ) : (
    <Box paddingLeft={2}>
      <Whisper width={Math.max(20, columns - 60)} hint={hint} animated={animated} />
    </Box>
  )

  return (
    <AppContext.Provider value={app}>
      <QueueBridge queueRef={queueRef} />
      <Shell
        layout={layout}
        header={header}
        title={view.title}
        sub={view.sub}
        center={view.center}
        onHome={() => nav.home()}
        rail={<Rail entries={fitted} active={view.door} width={layout.railW} onChoose={go} />}
        drawer={logsOpen ? <LogsDrawer width={columns} height={drawerHeight} onCopy={text => (copy(text), say('the whole log is on your clipboard', 'ok', 2000))} onClose={() => setLogsOpen(false)} /> : undefined}
        footer={
          <Box width={columns}>
            <Box flexGrow={1} flexShrink={1} overflow="hidden">
              {footStatus}
            </Box>
            <KeyLine keys={columns >= 120 ? view.keys ?? [] : (view.keys ?? []).slice(0, 2)} onGuide={openGuide} />
          </Box>
        }
      >
        {body}
      </Shell>
    </AppContext.Provider>
  )
}

/** Gives the shell's offerLink a queueDraw (which needs the app context). */
function QueueBridge({queueRef}: {queueRef: React.MutableRefObject<ReturnType<typeof useQueueDraw>>}) {
  queueRef.current = useQueueDraw()
  return null
}
