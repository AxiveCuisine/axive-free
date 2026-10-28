import {PassThrough} from 'node:stream'
import {createStore} from './store.js'

/** whether the terminal window has focus (terminals that report it) */
export const focusStore = createStore<boolean>(true)

export type MouseButton = 'left' | 'middle' | 'right' | 'none'

export type MouseEvt = {
  type: 'down' | 'up' | 'drag' | 'move' | 'wheel'
  button: MouseButton
  /** wheel direction */
  dir?: 'up' | 'down'
  /** 1-based terminal cell */
  x: number
  y: number
  shift: boolean
  alt: boolean
  ctrl: boolean
}

const SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/
// a lone ESC, CSI, or the opening of a mouse report: hold it a moment for the rest
const PARTIAL = /^\x1b(?:\[(?:<[\d;]*)?)?$/

export function decodeMouse(code: number, x: number, y: number, release: boolean): MouseEvt {
  const mods = {shift: Boolean(code & 4), alt: Boolean(code & 8), ctrl: Boolean(code & 16)}
  if (code & 64) return {type: 'wheel', button: 'none', dir: code & 1 ? 'down' : 'up', x, y, ...mods}
  const low = code & 3
  const button: MouseButton = low === 0 ? 'left' : low === 1 ? 'middle' : low === 2 ? 'right' : 'none'
  const motion = Boolean(code & 32)
  const type = release ? 'up' : motion ? (button === 'none' ? 'move' : 'drag') : 'down'
  return {type, button, x, y, ...mods}
}

/**
 * Sits between the terminal and Ink. Mouse reports and focus changes are
 * taken out and routed to their own handlers; everything else — keys,
 * bracketed pastes — flows on to Ink untouched. Without this, Ink parses a
 * click as keystrokes and `[<0;34;12M` lands in the link box.
 */
export class InputRouter {
  readonly stream: NodeJS.ReadStream
  onMouse?: (event: MouseEvt) => void
  onFocus?: (focused: boolean) => void
  private readonly pass = new PassThrough()
  private pending = ''
  private flushTimer: NodeJS.Timeout | undefined

  constructor(private readonly source: NodeJS.ReadStream = process.stdin) {
    const pass = this.pass as unknown as NodeJS.ReadStream & {isTTY: boolean}
    pass.isTTY = Boolean(source.isTTY)
    pass.setRawMode = (mode: boolean) => {
      source.setRawMode?.(mode)
      return pass
    }
    pass.ref = () => {
      source.ref()
      return pass
    }
    pass.unref = () => {
      source.unref()
      return pass
    }
    this.stream = pass
    source.setEncoding('utf8')
    source.on('data', (chunk: string | Buffer) => this.feed(String(chunk)))
  }

  feed(chunk: string): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    const text = this.pending + chunk
    this.pending = ''
    let out = ''
    let index = 0
    while (index < text.length) {
      const esc = text.indexOf('\x1b', index)
      if (esc === -1) {
        out += text.slice(index)
        break
      }
      out += text.slice(index, esc)
      const rest = text.slice(esc)
      const mouse = SGR_MOUSE.exec(rest)
      if (mouse) {
        this.onMouse?.(decodeMouse(Number(mouse[1]), Number(mouse[2]), Number(mouse[3]), mouse[4] === 'm'))
        index = esc + mouse[0].length
        continue
      }
      if (rest.startsWith('\x1b[I') || rest.startsWith('\x1b[O')) {
        focusStore.set(rest[2] === 'I')
        this.onFocus?.(rest[2] === 'I')
        index = esc + 3
        continue
      }
      if (PARTIAL.test(rest)) {
        this.pending = rest
        break
      }
      out += '\x1b'
      index = esc + 1
    }
    if (out) this.pass.write(out)
    if (this.pending) {
      // a real ESC keypress has nothing after it — hand it on shortly
      this.flushTimer = setTimeout(() => {
        const held = this.pending
        this.pending = ''
        if (held) this.pass.write(held)
      }, 25)
    }
  }
}
