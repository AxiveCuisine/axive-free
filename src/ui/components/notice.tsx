import React, {useEffect, useState} from 'react'
import {Box} from 'ink'
import {Text} from '../text.js'
import {G} from '../../core/glyphs.js'
import {scramble} from '../../core/scramble.js'
import {createStore, useStore} from '../../core/store.js'
import {truncate} from '../../core/format.js'
import {plain} from '../../core/words.js'
import {useRegion} from '../mouse.js'
import {useTheme} from '../theme.js'
import {Scrambled} from './scrambled.js'

export type Tone = 'info' | 'ok' | 'warn' | 'error'
export type Notice = {id: number; text: string; tone: Tone; ttl: number}

export const noticeStore = createStore<Notice | undefined>(undefined)
let nextNotice = 1

/** A line that surfaces out of the Hebrew letters, lingers, and sinks again on its own. */
export function say(text: string, tone: Tone = 'info', ttl = 4200): void {
  noticeStore.set({id: nextNotice++, text, tone, ttl})
}

const REVEAL_MS = 450
const FADE_MS = 650

type Stage = 'reveal' | 'hold' | 'fade'

export function NoticeLine({width, animated = true}: {width: number; animated?: boolean}) {
  const theme = useTheme()
  const notice = useStore(noticeStore)
  const [stage, setStage] = useState<Stage>('reveal')
  const [t, setT] = useState(0)
  const {ref, hovered} = useRegion({onPress: () => setStage('fade'), hint: 'dismiss', disabled: !notice})

  useEffect(() => {
    if (!notice) return
    setStage(animated ? 'reveal' : 'hold')
    setT(0)
  }, [notice?.id])

  useEffect(() => {
    if (!notice) return
    if (stage === 'hold') {
      const id = setTimeout(() => (animated ? setStage('fade') : noticeStore.set(current => (current?.id === notice.id ? undefined : current))), notice.ttl)
      return () => clearTimeout(id)
    }
    const duration = stage === 'reveal' ? REVEAL_MS : FADE_MS
    const start = Date.now()
    const id = setInterval(() => {
      const elapsed = Date.now() - start
      if (elapsed >= duration) {
        clearInterval(id)
        if (stage === 'reveal') setStage('hold')
        else noticeStore.set(current => (current?.id === notice.id ? undefined : current))
      } else setT(elapsed)
    }, 40)
    return () => clearInterval(id)
  }, [stage, notice?.id, animated])

  if (!notice) return <Text> </Text>
  const mark = notice.tone === 'ok' ? G.therefore : notice.tone === 'error' ? G.cross : notice.tone === 'warn' ? '!' : G.dot
  const text = truncate(`${mark} ${plain(notice.text)}`, Math.max(10, width - 6))
  const color = notice.tone === 'error' || notice.tone === 'warn' ? theme.accent : notice.tone === 'ok' ? theme.primary : theme.gray
  const cells = stage === 'hold' ? [...text].map(ch => ({ch, glyph: false})) : scramble(text, t / (stage === 'reveal' ? REVEAL_MS : FADE_MS), stage === 'reveal' ? 'in' : 'out')
  return (
    <Box ref={ref}>
      <Scrambled cells={cells} color={hovered ? theme.hover : color} glyphColor={theme.accent} />
    </Box>
  )
}
