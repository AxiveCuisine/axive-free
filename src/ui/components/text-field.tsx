import React, {useEffect, useRef, useState} from 'react'
import {Text, useInput, usePaste} from 'ink'
import {bridge} from '../../core/bridge.js'
import {plain} from '../../core/words.js'
import {useTheme} from '../theme.js'

// the field that has the cursor: right-click and ctrl+v paste into it
let pasteTarget: ((text: string) => void) | undefined
// the ? sheet, set by the shell: ? typed into an empty field opens it
let helpKey: (() => void) | undefined
export const setHelpKey = (fn: (() => void) | undefined) => {
  helpKey = fn
}
/** whether some field has the cursor (then ? is typed, unless the field is empty) */
export const fieldFocused = () => Boolean(pasteTarget)

/** Paste the clipboard into whichever field has focus (right-click, ctrl+v). */
export async function pasteIntoFocused(): Promise<boolean> {
  const target = pasteTarget
  if (!target) return false
  const text = await bridge.readClipboard()
  if (text) target(text)
  return Boolean(text)
}

type Props = {
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  placeholder?: string
  /** visible columns — text scrolls sideways to keep the cursor in view */
  width?: number
  /** newest-first entries recalled with ↑/↓ */
  history?: string[]
  /** when a paste into an empty field satisfies this, submit at once */
  submitOnPaste?: (value: string) => boolean
  /** tab pressed — accept a suggestion, etc. */
  onTab?: () => void
  focus?: boolean
  /** hide what is typed (tokens) */
  mask?: boolean
}

const wordLeft = (text: string, from: number) => {
  let i = from
  while (i > 0 && !/\w/.test(text[i - 1]!)) i--
  while (i > 0 && /\w/.test(text[i - 1]!)) i--
  return i
}

const wordRight = (text: string, from: number) => {
  let i = from
  while (i < text.length && !/\w/.test(text[i]!)) i++
  while (i < text.length && /\w/.test(text[i]!)) i++
  return i
}

// control characters never belong in a one-line field; line breaks become spaces
// eslint-disable-next-line no-control-regex
const tidy = (text: string) => text.replace(/\r\n|\r|\n|\t/g, ' ').replace(/[\x00-\x1f\x7f\u2028\u2029]/g, '')

/**
 * Single-line editor: readline keys (word jumps, ^w, ^u/^k, ^a/^e), shift
 * selection, ↑/↓ history, sideways scrolling — and paste that works
 * everywhere: the terminal's own paste (bracketed, arrives whole), ctrl+v,
 * and right-click, which the mouse would otherwise swallow.
 */
export function TextField({value, onChange, onSubmit, placeholder = '', width = 40, history = [], submitOnPaste, onTab, focus = true, mask = false}: Props) {
  const theme = useTheme()
  const [cursorState, setCursorState] = useState(value.length)
  const [anchorState, setAnchorState] = useState<number | null>(null)
  const [historyPos, setHistoryPos] = useState<number | null>(null)
  const draftRef = useRef('')
  const offsetRef = useRef(0)
  const live = useRef({value, cursor: cursorState, anchor: anchorState})

  // the parent can reset value (e.g. after submit) — clamp stale positions
  const cursor = Math.min(cursorState, value.length)
  const anchor = anchorState === null ? null : Math.min(anchorState, value.length)
  const selection: [number, number] | null = anchor !== null && anchor !== cursor ? [Math.min(anchor, cursor), Math.max(anchor, cursor)] : null
  live.current = {value, cursor, anchor}

  const place = (position: number, selecting = false) => {
    if (selecting) {
      if (anchor === null) setAnchorState(cursor)
    } else {
      setAnchorState(null)
    }
    setCursorState(Math.max(0, Math.min(value.length, position)))
  }

  const edit = (next: string, position: number) => {
    setAnchorState(null)
    setCursorState(Math.max(0, Math.min(next.length, position)))
    setHistoryPos(null) // editing a recalled entry turns it into a fresh draft
    onChange(next)
  }

  const recall = (text: string) => {
    setAnchorState(null)
    setCursorState(text.length)
    onChange(text)
  }

  const removeRange = (start: number, end: number) => edit(value.slice(0, start) + value.slice(end), start)

  const insert = (raw: string) => {
    const text = tidy(raw)
    if (!text) return
    const {value: current, cursor: at, anchor: from} = live.current
    const sel = from !== null && from !== at ? [Math.min(from, at), Math.max(from, at)] : [at, at]
    const next = current.slice(0, sel[0]) + text + current.slice(sel[1])
    edit(next, sel[0]! + text.length)
    // a whole link pasted into an empty field: draw it at once
    if (current === '' && submitOnPaste?.(next.trim())) onSubmit?.(next)
  }

  const insertRef = useRef(insert)
  insertRef.current = insert
  useEffect(() => {
    if (!focus) return
    const target = (text: string) => insertRef.current(text)
    pasteTarget = target
    return () => {
      if (pasteTarget === target) pasteTarget = undefined
    }
  }, [focus])

  usePaste(text => insert(text), {isActive: focus && Boolean(process.stdin.isTTY)})

  useInput(
    (input, key) => {
      if (key.return) {
        onSubmit?.(value)
        return
      }
      if (key.tab) {
        onTab?.()
        return
      }
      if (key.pageUp || key.pageDown) return
      if (key.escape) {
        setAnchorState(null)
        return
      }

      if (key.upArrow || key.downArrow) {
        if (history.length === 0) return
        if (key.upArrow) {
          if (historyPos === null) draftRef.current = value
          const next = historyPos === null ? 0 : Math.min(historyPos + 1, history.length - 1)
          if (next === historyPos) return
          setHistoryPos(next)
          recall(history[next]!)
        } else if (historyPos !== null) {
          const next = historyPos - 1
          setHistoryPos(next < 0 ? null : next)
          recall(next < 0 ? draftRef.current : history[next]!)
        }
        return
      }

      if (key.home) return place(0)
      if (key.end) return place(value.length)

      if (key.leftArrow || key.rightArrow) {
        const dir = key.leftArrow ? -1 : 1
        // plain arrow with a selection collapses to its edge
        if (selection && !key.shift) return place(dir < 0 ? selection[0] : selection[1])
        const byWord = key.meta || key.ctrl
        const target = byWord ? (dir < 0 ? wordLeft(value, cursor) : wordRight(value, cursor)) : cursor + dir
        return place(target, key.shift)
      }

      if (key.backspace) {
        if (selection) return removeRange(selection[0], selection[1])
        return removeRange(key.meta || key.ctrl ? wordLeft(value, cursor) : Math.max(0, cursor - 1), cursor)
      }
      if (key.delete) {
        if (selection) return removeRange(selection[0], selection[1])
        return removeRange(cursor, key.meta ? wordRight(value, cursor) : Math.min(value.length, cursor + 1))
      }

      if (key.ctrl) {
        if (input === 'v') {
          void pasteIntoFocused()
          return
        }
        if (input === 'a') return place(0)
        if (input === 'e') return place(value.length)
        if (input === 'u') return removeRange(0, selection ? selection[1] : cursor)
        if (input === 'k') return removeRange(selection ? selection[0] : cursor, value.length)
        if (input === 'w') {
          const end = selection ? selection[1] : cursor
          return removeRange(wordLeft(value, selection ? selection[0] : cursor), end)
        }
        return
      }
      if (key.meta) {
        if (input === 'b') return place(wordLeft(value, cursor))
        if (input === 'f') return place(wordRight(value, cursor))
        return
      }

      // a raw ^V (some consoles send the control character instead of pasting)
      if (input === '\x16') {
        void pasteIntoFocused()
        return
      }
      if (!input) return
      if (input === '?' && value === '' && helpKey) {
        helpKey()
        return
      }
      insert(input)
    },
    {isActive: focus && Boolean(process.stdin.isTTY)},
  )

  // scroll the window so the cursor stays visible (it can sit one past the end)
  const span = Math.max(8, width)
  let offset = Math.min(offsetRef.current, Math.max(0, value.length + 1 - span))
  if (cursor < offset) offset = cursor
  if (cursor > offset + span - 1) offset = cursor - span + 1
  offsetRef.current = offset

  if (!value) {
    return (
      <Text>
        {focus ? <Text inverse> </Text> : <Text> </Text>}
        <Text color={theme.gray} dimColor={theme.dimSecondary}>
          {plain(placeholder).slice(0, span - 1)}
        </Text>
      </Text>
    )
  }

  const shown = mask ? '•'.repeat(value.length) : value
  const cells = Array.from({length: Math.min(span, value.length - offset + 1)}, (_, column) => {
    const index = offset + column
    const selected = selection !== null && index >= selection[0] && index < selection[1]
    const atCursor = focus && selection === null && index === cursor
    return (
      <Text key={index} color={theme.primary} inverse={selected || atCursor}>
        {shown[index] ?? ' '}
      </Text>
    )
  })
  return <Text>{cells}</Text>
}
