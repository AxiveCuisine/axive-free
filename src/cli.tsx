import {execFileSync, spawn} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import {render} from 'ink'
import {App} from './app.js'
import {UPGRADE_URL} from './core/brand.js'
import {bridge} from './core/bridge.js'
import {DEFAULTS, META, configStore, displayValue, getConfig, loadConfig, parseConfigValue, saveConfig, updateConfig, type Config} from './core/config.js'
import {NOTICES} from './core/notices.js'
import {G, applySafeGlyphs} from './core/glyphs.js'
import {InputRouter} from './core/input.js'
import {claimWithControl, focusWindow, offeredStore, offerTo, openHolder, release, takeOver} from './core/instance.js'
import {carryOver, restoreQueue} from './core/jobs.js'
import {stopEngineAndWait} from './core/fetcher.js'
import {runGui} from './gui/main.js'
import {loadLedger} from './core/ledger.js'
import {logEvent, setVersion} from './core/log.js'
import {IS_WIN, ensureDir, isSea, paths} from './core/paths.js'
import {FOCUS_OFF, FOCUS_ON, MOUSE_OFF, MOUSE_ON, detectTerminal, installFragment, relaunchInTerminal, removeFragment, taskbarProgress, wtExe} from './core/terminal.js'
import {checkTools, hostIntact, installTools, needsSetup, payload, resolveTools, tools, verifyTools} from './core/tools.js'
import {renewYtdlp} from './core/update.js'
import {captureFrames} from './ui/frames.js'

const HELP = `
  axive free · the fastest free video and file downloader for Windows, in a window or the terminal.

  Usage
    axive-free                       open Axive Free in the terminal (a double-click opens the window)
    axive-free --gui [link]          open Axive Free in its window
    axive-free --tui                 open Axive Free in the terminal, also from Explorer
    axive-free <link>                straight to the vessels for that link
    axive-free --renew               renew yt-dlp, then exit
    axive-free --repair              check every tool and restore what is damaged

    axive-free config list           every setting and its value
    axive-free config set <k> <v>    change one (e.g. config set tunnels 1)
    axive-free config get <k> | reset [k] | path

    axive-free terminal install | remove     the Windows Terminal profile

  Options
    --here          stay in this console instead of opening Windows Terminal
    --theme <mode>  abyss, ash or auto, for this run
    -v, --version   show the version
    --notices       the licences of the programs Axive Free carries
    -h, --help      show this help

  Playlists, Spotify, torrents, a browser extension, your phone and more: ${UPGRADE_URL}
`

type Args = {
  help: boolean
  version: boolean
  notices?: boolean
  here: boolean
  inTerminal: boolean
  renew: boolean
  repair: boolean
  gui: boolean
  tui: boolean
  theme?: string
  url?: string
  command?: string[]
  error?: string
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {help: false, version: false, here: false, inTerminal: false, renew: false, repair: false, gui: false, tui: false}
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined]
    switch (flag) {
      case '-h':
      case '--help':
        args.help = true
        break
      case '-v':
      case '--version':
        args.version = true
        break
      case '--here':
        args.here = true
        break
      case '--notices':
        args.notices = true
        break
      case '--in-terminal':
        args.inTerminal = true
        break
      case '--renew':
        args.renew = true
        break
      case '--repair':
        args.repair = true
        break
      case '--gui':
        args.gui = true
        break
      case '--tui':
        args.tui = true
        break
      case '--theme': {
        const v = inline ?? argv[++i]
        if (v === undefined || v.startsWith('--')) args.error = '--theme needs a value'
        else args.theme = v
        break
      }
      default:
        if (arg.startsWith('-')) args.error = `unknown option “${arg}”`
        else positional.push(arg)
    }
    if (args.error) break
  }
  if (args.gui && args.tui) args.error = 'choose --gui or --tui, not both'
  else if (positional[0] === 'config' || positional[0] === 'terminal') args.command = positional
  else if (positional.length > 1) args.error = 'expected a single link'
  else if (positional[0]) args.url = positional[0]
  return args
}

function configCommand(words: string[]): number {
  const [, sub = 'list', key, ...rest] = words
  const config = getConfig()
  switch (sub) {
    case 'list':
      for (const k of Object.keys(DEFAULTS) as Array<keyof Config>) {
        console.log(`  ${k.padEnd(18)} ${displayValue(k, config).padEnd(28)} ${META[k].help}`)
      }
      console.log(`\n  ${paths.config}`)
      return 0
    case 'get':
      if (!key || !(key in META)) return fail(`unknown setting “${key ?? ''}”`)
      console.log(displayValue(key as keyof Config, config))
      return 0
    case 'set': {
      if (!key) return fail('usage: axive-free config set <key> <value>')
      const parsed = parseConfigValue(key, rest.join(' '))
      if (!parsed.ok) return fail(parsed.error)
      updateConfig({[parsed.key]: parsed.value} as Partial<Config>)
      console.log(`${parsed.key} = ${displayValue(parsed.key)}`)
      return 0
    }
    case 'reset':
      if (key) {
        if (!(key in META)) return fail(`unknown setting “${key}”`)
        updateConfig({[key]: DEFAULTS[key as keyof Config]} as Partial<Config>)
      } else {
        configStore.set({...DEFAULTS, folder: config.folder})
        saveConfig()
      }
      console.log('reset.')
      return 0
    case 'path':
      console.log(paths.config)
      return 0
    default:
      return fail(`unknown: config ${sub}: try list, get, set, reset, path`)
  }
}

function fail(message: string): number {
  console.error(`axive-free: ${message}`)
  return 1
}

const out = (line: string) => process.stdout.write(`${line}\n`)

async function ensureTools(): Promise<void> {
  if (needsSetup()) {
    out('preparing the tools Axive Free carries…')
    await installTools()
  }
  await checkTools()
  resolveTools()
}

async function runRenew(): Promise<number> {
  try {
    await ensureTools()
    out(await renewYtdlp(stage => out(`${stage}…`)))
    return 0
  } catch (error) {
    out(`axive-free: ${(error as Error).message}`)
    return 1
  }
}

async function runRepair(): Promise<number> {
  if (!payload()) {
    out('this build runs from a folder and carries no tools to restore')
    return 1
  }
  const health = await verifyTools()
  for (const h of health) out(`${h.ok ? G.check : G.cross} ${h.name}${h.reason ? `: ${h.reason}` : ''}`)
  const broken = health.filter(h => !h.ok).map(h => h.name)
  if (!broken.length) return 0
  out(`restoring ${broken.join(', ')} from Axive Free itself…`)
  await installTools(broken)
  out(`${G.therefore} repaired. tools live in ${paths.bin}`)
  return 0
}

/** A double-click in Explorer: the window, not a console. */
function startedByExplorer(): boolean {
  if (!IS_WIN || !isSea()) return false
  try {
    const out = execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tasklist.exe'), ['/fi', `pid eq ${process.ppid}`, '/fo', 'csv', '/nh'], {encoding: 'utf8', windowsHide: true, timeout: 3000})
    return /^"explorer\.exe"/i.test(out.trim())
  } catch {
    return false
  }
}

/** The window was asked for from a console of its own (a double-click): start again without one and let this one go. */
function detachFromConsole(): boolean {
  if (!IS_WIN || !isSea() || !process.stdout.isTTY) return false
  if (process.env.AXIVE_GUI_NO_WINDOW === '1' || process.env.AXIVE_DETACHED === '1') return false
  try {
    const child = spawn(process.execPath, process.argv.slice(2), {detached: true, windowsHide: true, stdio: 'ignore', env: {...process.env, AXIVE_DETACHED: '1'}})
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

/** The icon beside the data, for the Terminal profile. */
function placeIcon(): void {
  const dest = path.join(paths.root, 'axive.ico')
  if (fs.existsSync(dest)) return
  try {
    if (isSea()) {
      const sea = process.getBuiltinModule?.('node:sea') as unknown as {getRawAsset(key: string): ArrayBuffer} | undefined
      const raw = sea?.getRawAsset('axive.ico')
      if (raw) {
        ensureDir(paths.root)
        fs.writeFileSync(dest, Buffer.from(raw))
      }
    } else {
      const dev = path.join(path.dirname(path.resolve(process.argv[1] ?? '.')), '..', 'build', 'axive.ico')
      if (fs.existsSync(dev)) {
        ensureDir(paths.root)
        fs.copyFileSync(dev, dest)
      }
    }
  } catch {
    // an icon is a nicety
  }
}

// one async entry rather than top-level await: the same code is also bundled
// as the CommonJS script inside the exe
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.error) {
    console.error(`axive-free: ${args.error}\nTry “axive-free --help”.`)
    process.exit(1)
  }
  if (args.help) {
    console.log(HELP)
    process.exit(0)
  }
  if (args.version) {
    console.log(__AXIVE_VERSION__)
    process.exit(0)
  }
  if (args.notices) {
    console.log(NOTICES)
    process.exit(0)
  }

  setVersion('axive-free', __AXIVE_VERSION__)
  setVersion('node', process.version)
  loadConfig()
  if (args.theme) {
    const parsed = parseConfigValue('theme', args.theme)
    if (!parsed.ok) {
      console.error(`axive-free: ${parsed.error}`)
      process.exit(1)
    }
    configStore.set({...getConfig(), theme: parsed.value as Config['theme']})
  }

  if (args.command?.[0] === 'config') process.exit(configCommand(args.command))
  if (args.command?.[0] === 'terminal') {
    if (args.command[1] === 'remove') {
      removeFragment()
      console.log('the Axive Free profile is gone from Windows Terminal')
    } else {
      placeIcon()
      console.log(installFragment() ? 'the Axive Free profile is in Windows Terminal' : 'Windows Terminal was not found')
    }
    process.exit(0)
  }

  loadLedger()
  if (args.renew) process.exit(await runRenew())
  if (args.repair) process.exit(await runRepair())
  // the window: no terminal needed. A plain double-click on Axive-Free.exe in Explorer opens it too
  if (args.gui || (!args.tui && process.argv.length <= 2 && startedByExplorer())) {
    if (detachFromConsole()) process.exit(0)
    process.exit(await runGui(args.url))
  }

  const isTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY)
  if (!isTTY) {
    console.error('axive-free: the interface needs a terminal. For scripts, use --renew or --repair.')
    process.exit(1)
  }

  const term = detectTerminal(args.inTerminal)
  placeIcon()

  // double-clicked in the old console: open in its own Windows Terminal window instead
  if (term.kind !== 'wt' && !args.here && !args.inTerminal && getConfig().openInTerminal && wtExe()) {
    if (relaunchInTerminal(args.url ? [args.url] : [])) process.exit(0)
  }
  if (term.kind === 'wt') installFragment()
  if (!term.rich) applySafeGlyphs()

  // one Axive Free per data folder: two would resume the same downloads into the same files.
  // The window open: Axive Free moves here, draws and all. Another terminal open: that one comes forward.
  const held = await openHolder()
  const pause = () => new Promise(resolve => setTimeout(resolve, 2500))
  if (held?.kind === 'gui') {
    process.stdout.write('\n  Axive Free is open in its window: moving it here…\n')
    if (!(await takeOver(held, 'tui'))) {
      const focused = await focusWindow(held)
      console.log(focused ? '  Axive Free is open in its window and could not move: it has come to the front.' : '  Axive Free is already open in another window. Use that one, or close it first.')
      await pause()
      process.exit(0)
    }
  } else if (held) {
    if (args.url) await offerTo(held, args.url)
    const focused = await focusWindow(held)
    console.log(focused ? '  Axive Free is already open in another window: it has come to the front.' : '  Axive Free is already open in another window. Use that one, or close it first.')
    await pause()
    process.exit(0)
  }
  await claimWithControl('tui', {
    focus: () => void bridge.window('focus').catch(() => {}),
    offer: url => offeredStore.set(url),
    // the window opened: save what moves, let go, close (it carries on there)
    async handover() {
      carryOver()
      await stopEngineAndWait().catch(() => {})
      release()
      leave()
      process.exit(0)
    },
  })

  const setupNeeded = needsSetup()
  if (!setupNeeded) {
    try {
      resolveTools()
      // every tool is hashed in the background from here; nothing runs one until it passes
      const checked = checkTools()
      checked.catch(error => logEvent('error', (error as Error).message))
      // the host starts at once when its own hash is right, else once the check has restored it
      if (hostIntact(tools().host)) bridge.start(tools().host)
      else void checked.then(() => bridge.start(tools().host), () => undefined)
    } catch {
      // no tools at all (a dev checkout without build/bin): the setup screen explains
    }
  }
  const restored = restoreQueue()

  const router = new InputRouter(process.stdin)
  const title = '\x1b]0;Axive Free\x07'
  // also switch mouse tracking off: a crash can skip React effect cleanup
  const leave = () => process.stdout.write(`${taskbarProgress(0)}${FOCUS_OFF}${MOUSE_OFF}\x1b[?2004l\x1b[?1049l\x1b[?25h`)
  process.stdout.write(`${title}\x1b[?1049h\x1b[H${MOUSE_ON}${term.kind === 'wt' ? FOCUS_ON : ''}`)
  process.on('exit', leave)
  // restore the terminal BEFORE a crash prints, or the stack trace is wiped
  // along with the alternate screen and the app looks like it silently quit
  for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
    process.on(event, (error: unknown) => {
      leave()
      logEvent('error', `crash: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
      console.error(error)
      process.exit(1)
    })
  }

  const {waitUntilExit} = render(<App term={term} router={router} initialUrl={args.url} setupNeeded={setupNeeded} restored={restored} />, {
    stdout: captureFrames(process.stdout),
    stdin: router.stream,
    exitOnCtrlC: true,
    patchConsole: true,
    maxFps: 30,
  })
  await waitUntilExit()
  leave()
  process.stdin.pause()
  // anything still running comes back paused next time (jobs persist on change)
  process.exit(0)
}

// a missing payload is a broken build, not a crash
if (isSea() && !payload()) logEvent('warn', 'this build carries no payload')

void main()
