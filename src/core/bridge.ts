import {execFile, spawn, type ChildProcessWithoutNullStreams} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {IS_WIN, SYSTEM32} from './paths.js'
import {writeRaw} from '../ui/frames.js'

export type BridgeEvent = {event: 'clip'; url: string} | {event: 'hotkey'; name: string} | {event: 'toastClick'} | {event: 'card'; key: string; action: string}

/** The ghost card: a small notice in the corner of the screen that never takes focus. */
export type CardSpec = {key: string; title: string; text: string; actions: {id: string; label: string}[]; ttl?: number; unlessFront?: boolean}

type Pending = {resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout}

const POWERSHELL = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe')

/**
 * Talks to axive-host.exe (native/AxiveHost.cs) over stdin/stdout, one JSON
 * object per line. Every call has a fallback for when the host is missing
 * (another OS, or a damaged install): PowerShell for the clipboard and the
 * folder picker, an OSC 52 escape for copying, and no window buttons.
 */
class Bridge {
  private child: ChildProcessWithoutNullStreams | undefined
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private buffer = ''
  private listeners = new Set<(event: BridgeEvent) => void>()

  get available(): boolean {
    return Boolean(this.child && this.child.exitCode === null)
  }

  start(hostPath: string | undefined): boolean {
    if (!IS_WIN || !hostPath || !fs.existsSync(hostPath) || this.available) return this.available
    try {
      // no windowsHide: the host must share Axive's console to find the terminal window
      const child = spawn(hostPath, [], {stdio: ['pipe', 'pipe', 'ignore']}) as unknown as ChildProcessWithoutNullStreams
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => this.read(chunk))
      child.on('exit', () => {
        this.child = undefined
        for (const [, wait] of this.pending) {
          clearTimeout(wait.timer)
          wait.reject(new Error('host stopped'))
        }
        this.pending.clear()
      })
      child.on('error', () => {
        this.child = undefined
      })
      child.stdin.on('error', () => {})
      this.child = child
      process.once('exit', () => child.kill())
      return true
    } catch {
      return false
    }
  }

  onEvent(listener: (event: BridgeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private read(chunk: string): void {
    this.buffer += chunk
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      let message: {id?: number; ok?: boolean; result?: unknown; error?: string; event?: string}
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (message.event) {
        for (const listener of this.listeners) listener(message as BridgeEvent)
        continue
      }
      const wait = message.id !== undefined ? this.pending.get(message.id) : undefined
      if (!wait) continue
      this.pending.delete(message.id!)
      clearTimeout(wait.timer)
      if (message.ok) wait.resolve(message.result)
      else wait.reject(new Error(message.error ?? 'host error'))
    }
  }

  call<T = unknown>(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 5000): Promise<T> {
    const child = this.child
    if (!child || child.exitCode !== null) return Promise.reject(new Error('host unavailable'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${cmd} timed out`))
      }, timeoutMs)
      this.pending.set(id, {resolve: resolve as (value: unknown) => void, reject, timer})
      child.stdin.write(`${JSON.stringify({id, cmd, ...args})}\n`)
    })
  }

  // --- the terminal window -------------------------------------------

  /** true when the window buttons can work */
  async findWindow(): Promise<boolean> {
    try {
      await this.call('window', {op: 'find'}, 2000)
      return true
    } catch {
      return false
    }
  }

  window(op: 'minimize' | 'toggleMax' | 'isMax' | 'close' | 'drag' | 'focus' | 'fit', extra: Record<string, unknown> = {}): Promise<unknown> {
    return this.call('window', {op, ...extra}, 3000).catch(() => undefined)
  }

  // --- pickers ----------------------------------------------------------

  async pickFolder(title: string, initial?: string): Promise<string | undefined> {
    if (this.available) {
      try {
        const picked = await this.call<string | null>('pickFolder', {title, initial}, 10 * 60_000)
        return picked ?? undefined
      } catch {
        // fall through to PowerShell
      }
    }
    if (!IS_WIN) return undefined
    const script = `$s = New-Object -ComObject Shell.Application; $f = $s.BrowseForFolder(0, '${title.replace(/'/g, "''")}', 0x51, 0); if ($f) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $f.Self.Path }`
    return runPowerShell(script, 10 * 60_000).then(out => out.trim() || undefined)
  }

  async pickFile(title: string, filterName: string, filter: string, initial?: string): Promise<string | undefined> {
    if (this.available) {
      try {
        const picked = await this.call<string | null>('pickFile', {title, filterName, filter, initial}, 10 * 60_000)
        return picked ?? undefined
      } catch {
        // fall through
      }
    }
    if (!IS_WIN) return undefined
    const script = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = '${title.replace(/'/g, "''")}'; $d.Filter = '${filterName.replace(/'/g, "''")}|${filter}|All files|*.*'; if ($d.ShowDialog() -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $d.FileName }`
    return runPowerShell(script, 10 * 60_000).then(out => out.split(/\r?\n/).filter(Boolean).at(-1)?.trim() || undefined)
  }

  // --- clipboard ----------------------------------------------------------

  async readClipboard(): Promise<string> {
    if (this.available) {
      try {
        return (await this.call<string>('clipRead', {}, 3000)) ?? ''
      } catch {
        // fall through
      }
    }
    if (process.platform === 'darwin') return runCommand('pbpaste', [])
    if (!IS_WIN) {
      for (const [cmd, args] of [['wl-paste', ['--no-newline']], ['xclip', ['-selection', 'clipboard', '-o']], ['xsel', ['--clipboard', '--output']]] as const) {
        const out = await runCommand(cmd, [...args]).catch(() => undefined)
        if (out !== undefined) return out
      }
      return ''
    }
    return runPowerShell('[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw', 4000).catch(() => '')
  }

  async writeClipboard(text: string): Promise<void> {
    if (this.available) {
      try {
        await this.call('clipWrite', {text}, 3000)
        return
      } catch {
        // fall through
      }
    }
    // OSC 52: the terminal itself puts it on the clipboard (Windows Terminal, most modern terminals)
    writeRaw(`\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`)
  }

  watchClipboard(on: boolean, hosts: string[]): Promise<boolean> {
    return this.call<boolean>('watch', {on, hosts}, 3000).catch(() => false)
  }

  hotkey(on: boolean): Promise<boolean> {
    return this.call<boolean>('hotkey', {on}, 3000).catch(() => false)
  }

  /** true when shown; false when Axive is in front (or the host is too old to know cards) */
  card(spec: CardSpec): Promise<boolean> {
    if (!this.available) return Promise.resolve(false)
    const actions = spec.actions.map(a => `${a.id}=${a.label.replace(/[|=]/g, ' ')}`).join('|')
    return this.call<boolean>('card', {key: spec.key, title: spec.title, text: spec.text, actions, ttl: spec.ttl ?? 9000, unlessFront: spec.unlessFront ?? true}, 3000).then(Boolean)
  }

  closeCard(key: string): void {
    if (this.available) void this.call('cardClose', {key}).catch(() => {})
  }

  /** Explorer on a folder, or on a file's folder with it selected (the shell's own call); false when the host could not. */
  async reveal(target: string): Promise<boolean> {
    if (!this.available) return false
    return this.call<boolean>('reveal', {path: target}, 4000).then(Boolean, () => false)
  }

  /** A file opened with its usual program, through the shell; false when the host could not. */
  async open(target: string): Promise<boolean> {
    if (!this.available) return false
    return this.call<boolean>('open', {path: target}, 4000).then(Boolean, () => false)
  }

  notify(title: string, text: string): void {
    void this.call('notify', {title, text}).catch(() => {})
  }

  sound(kind: 'done' | 'error' | 'chime'): void {
    if (this.available) void this.call('sound', {kind}).catch(() => {})
    else writeRaw('\x07')
  }
}

export const bridge = new Bridge()

export function runPowerShell(script: string, timeout = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(POWERSHELL, ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], {encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024}, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    )
  })
}

function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {encoding: 'utf8', timeout: 4000}, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })
}
