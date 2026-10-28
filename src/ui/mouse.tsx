import React, {createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject} from 'react'
import {Box, type DOMElement} from 'ink'
import {focusStore, type InputRouter, type MouseEvt} from '../core/input.js'
import {createStore} from '../core/store.js'
import {doubledRows, frameDumping, highlightSequence, repaintRows, selectedText, setOverlay, setRegionDump, writeRaw, type Cell, ordered} from './frames.js'

export type RegionSpec = {
  /** a full click: pressed and released on this region */
  onPress?: (event: MouseEvt) => void
  /** the instant the button goes down (title-bar dragging starts here) */
  onDown?: (event: MouseEvt) => void
  onDouble?: () => void
  onWheel?: (dir: 'up' | 'down') => void
  /** the mouse moves over it: the cell, relative to the region's corner */
  onMove?: (at: {x: number; y: number}) => void
  /** the mouse left it */
  onLeave?: () => void
  /** shown in the status line while the mouse rests here */
  hint?: string
  /** what the region says on its face (tests click by it) */
  label?: string
  disabled?: boolean
}

type Entry = RegionSpec & {ref: RefObject<DOMElement | null>}
type Registry = {register: (id: number, entry: () => Entry) => () => void}

const RegistryContext = createContext<Registry | null>(null)
const HoverContext = createContext<number | undefined>(undefined)

/** what the mouse rests on, for the status line */
export const hintStore = createStore<string | undefined>(undefined)
/** set briefly after a drag-selection lands on the clipboard */
export const copiedStore = createStore<number>(0)

let nextId = 1

export type Rect = {x: number; y: number; w: number; h: number}

/** Absolute cell rectangle of an Ink element: yoga only knows offsets from the parent. */
export function rectOf(node: DOMElement | null | undefined): Rect | undefined {
  const yoga = node?.yogaNode
  if (!node || !yoga) return undefined
  let x = 0
  let y = 0
  for (let n: DOMElement | undefined = node; n; n = n.parentNode) {
    if (n.yogaNode) {
      x += n.yogaNode.getComputedLeft()
      y += n.yogaNode.getComputedTop()
    }
  }
  return {x: Math.round(x), y: Math.round(y), w: Math.round(yoga.getComputedWidth()), h: Math.round(yoga.getComputedHeight())}
}

/** Make an element clickable/hoverable: put the returned ref on a <Box>. */
export function useRegion(spec: RegionSpec): {ref: RefObject<DOMElement | null>; hovered: boolean} {
  const ref = useRef<DOMElement | null>(null)
  const specRef = useRef(spec)
  specRef.current = spec
  const [id] = useState(() => nextId++)
  const registry = useContext(RegistryContext)
  useEffect(() => registry?.register(id, () => ({...specRef.current, ref})), [registry, id])
  const hovered = useContext(HoverContext) === id && !spec.disabled
  return {ref, hovered}
}

/** A Box that is also a click target. */
export function Clickable({children, ...spec}: RegionSpec & {children: ReactNode}) {
  const {ref} = useRegion(spec)
  return <Box ref={ref}>{children}</Box>
}

type Props = {
  router: InputRouter
  /** copy text to the clipboard (bridge, or OSC 52) */
  copy: (text: string) => void
  /** right-click: paste into whatever field has focus */
  onRight?: (event: MouseEvt) => void
  /** wheel over nothing in particular */
  onWheel?: (dir: 'up' | 'down') => void
  selectionColors: {fg: string; bg: string}
  hoverHints: boolean
  children: ReactNode
}

type Selection = {anchor: Cell; head: Cell}

export function MouseLayer({router, copy, onRight, onWheel, selectionColors, hoverHints, children}: Props) {
  const entries = useRef(new Map<number, () => Entry>())
  const [hoverId, setHoverId] = useState<number>()
  const hoverRef = useRef<number | undefined>(undefined)
  const pressed = useRef<number | undefined>(undefined)
  const lastDown = useRef<{id: number; at: number}>({id: 0, at: 0})
  const selection = useRef<Selection | undefined>(undefined)
  const props = useRef({copy, onRight, onWheel, selectionColors, hoverHints})
  props.current = {copy, onRight, onWheel, selectionColors, hoverHints}

  const [registry] = useState<Registry>(() => ({
    register(id, entry) {
      entries.current.set(id, entry)
      return () => {
        entries.current.delete(id)
      }
    },
  }))

  useEffect(() => {
    const hit = (x: number, y: number): [number, Entry] | undefined => {
      let best: [number, Entry, number] | undefined
      for (const [id, get] of entries.current) {
        const entry = get()
        if (entry.disabled) continue
        const rect = rectOf(entry.ref.current)
        if (!rect || rect.w === 0 || rect.h === 0) continue
        if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) {
          const area = rect.w * rect.h
          if (!best || area < best[2]) best = [id, entry, area]
        }
      }
      return best ? [best[0], best[1]] : undefined
    }

    const setHover = (id: number | undefined, entry?: Entry) => {
      if (hoverRef.current === id) return
      const before = hoverRef.current === undefined ? undefined : entries.current.get(hoverRef.current)?.()
      before?.onLeave?.()
      hoverRef.current = id
      setHoverId(id)
      hintStore.set(props.current.hoverHints ? entry?.hint : undefined)
    }

    const paintSelection = (previous?: Selection) => {
      const sel = selection.current
      // repaint what the old highlight covered, then lay the new one
      let out = ''
      if (previous) {
        const [a, b] = ordered(previous.anchor, previous.head)
        out += repaintRows(a.y, b.y)
      }
      if (sel) out += highlightSequence(sel.anchor, sel.head, props.current.selectionColors)
      if (out) writeRaw(out)
    }

    const endSelection = () => {
      const sel = selection.current
      if (!sel) return
      const text = selectedText(sel.anchor, sel.head)
      if (text && (sel.anchor.x !== sel.head.x || sel.anchor.y !== sel.head.y)) {
        props.current.copy(text)
        copiedStore.set(Date.now())
      }
      // let the highlight linger a breath so the copy is felt, then lift it
      setTimeout(() => {
        if (selection.current !== sel) return
        selection.current = undefined
        setOverlay(undefined)
        const [a, b] = ordered(sel.anchor, sel.head)
        writeRaw(repaintRows(a.y, b.y))
      }, 350)
    }

    router.onMouse = event => {
      const y = event.y - 1
      // a double-size row (the masthead) holds half as many cells
      const x = doubledRows().includes(y) ? Math.floor((event.x - 1) / 2) : event.x - 1
      if (event.type === 'move') {
        const found = hit(x, y)
        setHover(found?.[0], found?.[1])
        if (found?.[1].onMove) {
          const rect = rectOf(found[1].ref.current)
          if (rect) found[1].onMove({x: x - rect.x, y: y - rect.y})
        }
        return
      }
      if (event.type === 'wheel') {
        const found = hit(x, y)
        if (found?.[1].onWheel) found[1].onWheel(event.dir!)
        else props.current.onWheel?.(event.dir!)
        return
      }
      if (event.button === 'right' && event.type === 'down') {
        props.current.onRight?.(event)
        return
      }
      if (event.button !== 'left' && event.type !== 'up') return

      if (event.type === 'down') {
        const found = hit(x, y)
        if (found) {
          const [id, entry] = found
          pressed.current = id
          const now = Date.now()
          if (lastDown.current.id === id && now - lastDown.current.at < 420 && entry.onDouble) {
            lastDown.current = {id: 0, at: 0}
            entry.onDouble()
            pressed.current = undefined
            return
          }
          lastDown.current = {id, at: now}
          entry.onDown?.(event)
          return
        }
        // nothing clickable here: start a selection
        const previous = selection.current
        selection.current = {anchor: {x, y}, head: {x, y}}
        setOverlay(() => (selection.current ? highlightSequence(selection.current.anchor, selection.current.head, props.current.selectionColors) : ''))
        if (previous) paintSelection(previous)
        return
      }
      if (event.type === 'drag') {
        const sel = selection.current
        if (!sel || pressed.current !== undefined) return
        const previous = {anchor: sel.anchor, head: sel.head}
        sel.head = {x, y}
        paintSelection(previous)
        return
      }
      if (event.type === 'up') {
        if (pressed.current !== undefined) {
          const id = pressed.current
          pressed.current = undefined
          const found = hit(x, y)
          if (found && found[0] === id) found[1].onPress?.(event)
          return
        }
        if (selection.current) endSelection()
      }
    }
    if (frameDumping)
      setRegionDump(() =>
        [...entries.current.values()]
          .map(get => get())
          .filter(e => !e.disabled && (e.onPress || e.onDown))
          .map(e => ({label: e.label, hint: e.hint, ...rectOf(e.ref.current)}))
          .filter(r => r.w && r.h),
      )
    const unfocus = focusStore.subscribe(() => {
      if (!focusStore.get()) setHover(undefined)
    })
    return () => {
      router.onMouse = undefined
      setRegionDump(undefined)
      unfocus()
    }
  }, [router])

  return (
    <RegistryContext.Provider value={registry}>
      <HoverContext.Provider value={hoverId}>{children}</HoverContext.Provider>
    </RegistryContext.Provider>
  )
}
