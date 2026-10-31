import {spawn} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {createContext, useContext, useEffect, useRef} from 'react'
import {type Classified} from '../core/errors.js'
import {getConfig} from '../core/config.js'
import {IS_WIN} from '../core/paths.js'
import {openPath, revealPath} from '../core/reveal.js'
import {createStore} from '../core/store.js'
import {type TermInfo} from '../core/terminal.js'
import {type VideoInfo} from '../core/ytdlp.js'

export type VideoProbe = {url: string; info: VideoInfo; infoJsonPath: string}

export type Screen =
  | {name: 'home'; link?: string}
  | {name: 'probing'; url: string; status: string}
  | {name: 'picking'; probe: VideoProbe}
  | {name: 'destination'; title: string; count: number; onChosen: (choice: {folder: string}) => void}
  | {name: 'drawing'; jobId: string}
  | {name: 'tunnels'}
  | {name: 'error'; error: Classified; url?: string; title?: string; duration?: number; report?: string; retry?: () => void}
  | {name: 'settings'}
  | {name: 'setup'; repair?: boolean}
  | {name: 'fetch'; add?: string[]}
  /** what the full Axive adds, and where to get it */
  | {name: 'axive'; why?: string}
  /** the ? sheet, about the screen it was opened from */
  | {name: 'guide'; about: string}

export type Nav = {
  push: (screen: Screen) => void
  replace: (screen: Screen) => void
  back: () => void
  home: (link?: string) => void
}

export type App = {
  nav: Nav
  term: TermInfo
  hostReady: boolean
  /** start a link's journey: probe it, then the right screen */
  offerLink: (url: string) => void
  copy: (text: string) => void
  /** close Axive — asks once more while draws are running */
  leave: () => void
}

export const AppContext = createContext<App | null>(null)

export function useApp(): App {
  const app = useContext(AppContext)
  if (!app) throw new Error('outside the app')
  return app
}

/** What esc does on the current screen (the shell calls it). */
export const backHandler = createStore<(() => boolean) | undefined>(undefined)

/** Claim esc for this screen; return true from the handler when it was handled. */
export function useBack(handler: () => boolean): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const fn = () => ref.current()
    backHandler.set(() => fn)
    return () => {
      if (backHandler.get() === fn) backHandler.set(undefined)
    }
  }, [])
}

/** Open a folder (or reveal a file) in Explorer; an empty or vanished target falls back to its folder, then the default folder. */
export function reveal(target: string | undefined, _select = false): void {
  revealPath(target, getConfig().folder)
}

/** Open a file with whatever Windows plays it with. */
export function openFile(file: string): void {
  // a folder is shown, a file opened with its usual program: both through the shell's own calls
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) revealPath(file)
  else openPath(file)
}


/** Open a web page in the default browser (https only). */
export function openUrl(url: string): void {
  // the web, or a page Axive serves on this PC itself (the phone's large QR)
  if (!/^https:\/\//.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) return
  try {
    const child = IS_WIN
      ? spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'rundll32.exe'), ['url.dll,FileProtocolHandler', url], {detached: true, stdio: 'ignore'})
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], {detached: true, stdio: 'ignore'})
    child.on('error', () => {})
    child.unref()
  } catch {
    // no browser
  }
}
