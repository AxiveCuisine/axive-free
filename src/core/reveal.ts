import {spawn} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {bridge} from './bridge.js'

const IS_WIN = process.platform === 'win32'

export type RevealPlan = {command: string; args: string[]; verbatim: boolean; opened: string}

const isFile = (p: string) => {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}
const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * What to hand Explorer so it shows the place a draw actually landed.
 *
 * Explorer parses its own command line: Node's default quoting wraps the
 * whole `/select,C:\a b\c.mp4` in quotes, which Explorer cannot read, so it
 * opens Documents instead. Only the path is quoted, and the arguments go
 * through verbatim. A file that is gone falls back to its folder, an empty
 * target to `fallback` (the default folder).
 */
export function revealPlan(target: string | undefined, fallback?: string): RevealPlan | undefined {
  const explorer = IS_WIN ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe') : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const candidates = [target, target ? path.dirname(target) : undefined, fallback].filter((p): p is string => Boolean(p && p.trim()))
  for (const raw of candidates) {
    const p = path.resolve(raw)
    if (isFile(p)) {
      if (!IS_WIN) return {command: explorer, args: [path.dirname(p)], verbatim: false, opened: path.dirname(p)}
      return {command: explorer, args: [`/select,"${p}"`], verbatim: true, opened: p}
    }
    // a drive's root ends in a backslash, which would escape the closing quote: "D:\." is the same place
    if (isDir(p)) return IS_WIN ? {command: explorer, args: [`"${p.endsWith('\\') ? `${p}.` : p}"`], verbatim: true, opened: p} : {command: explorer, args: [p], verbatim: false, opened: p}
  }
  return undefined
}

function spawnPlan(plan: RevealPlan): void {
  try {
    const child = spawn(plan.command, plan.args, {detached: true, stdio: 'ignore', windowsVerbatimArguments: plan.verbatim})
    child.on('error', () => {})
    child.unref()
  } catch {
    // no file manager: the path is on screen anyway
  }
}

/**
 * Open the folder (selecting the file when there is one). Returns what was
 * opened. The host asks the shell itself (SHOpenFolderAndSelectItems), which
 * takes any path as it is; Explorer's command line is the fallback.
 */
export function revealPath(target: string | undefined, fallback?: string): string | undefined {
  const plan = revealPlan(target, fallback)
  if (!plan) return undefined
  if (IS_WIN && bridge.available) void bridge.reveal(plan.opened).then(ok => ok || spawnPlan(plan))
  else spawnPlan(plan)
  return plan.opened
}

/**
 * Open the folder that holds `item`, with `item` selected: a folder shown as
 * something to drag (Chrome's Load unpacked takes the folder itself, dropped
 * on its extensions page), not opened.
 */
export function selectInFolder(item: string): string | undefined {
  const p = path.resolve(item)
  if (!isDir(p) && !isFile(p)) return undefined
  if (!IS_WIN) return revealPath(path.dirname(p))
  spawnPlan({command: path.join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe'), args: [`/select,"${p}"`], verbatim: true, opened: p})
  return p
}

/** Hand a file (or a folder) to Windows to open with its usual program: the shell's call first, Explorer after. */
export function openPath(file: string): void {
  if (process.env.NODE_TEST_CONTEXT) return
  const viaExplorer = () => {
    try {
      const child = IS_WIN
        ? spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe'), [file], {detached: true, stdio: 'ignore'})
        : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [file], {detached: true, stdio: 'ignore'})
      child.on('error', () => {})
      child.unref()
    } catch {
      // nothing to open it with
    }
  }
  if (IS_WIN && bridge.available) void bridge.open(file).then(ok => ok || viaExplorer())
  else viaExplorer()
}
