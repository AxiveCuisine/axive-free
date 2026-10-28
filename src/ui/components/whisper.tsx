import React, {useEffect, useMemo, useState} from 'react'
import {Text} from '../text.js'
import {truncate} from '../../core/format.js'
import {scramble} from '../../core/scramble.js'
import {TIPS, WHISPERS} from '../../core/whispers.js'
import {plain} from '../../core/words.js'
import {useTheme} from '../theme.js'
import {Scrambled} from './scrambled.js'

const REVEAL_MS = 1600
const HOLD_MS = 7500
const FADE_MS = 1200
const REST_MS = 1800
const HINT_MS = 220
// a button's description gives the line back to the quotes after this long
const HINT_LINGER_MS = 3200

type Stage = 'reveal' | 'hold' | 'fade' | 'rest'

/** Two whispers, then a tip, over and over: each list shuffled once. */
export function interleave(whispers: readonly string[], tips: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0, t = 0; i < whispers.length; i++) {
    out.push(whispers[i]!)
    if (i % 2 === 1 && tips.length) out.push(tips[t++ % tips.length]!)
  }
  return out
}

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/**
 * A line that surfaces out of Hebrew letters at the foot of the screen,
 * lingers, and sinks again — always, whether or not the mouse is near. When
 * the mouse comes to a button, the line says what that button does for a few
 * seconds, then the quotes return; their turning never pauses underneath.
 */
export function Whisper({width, hint, animated: allowed = true}: {width: number; hint?: string; animated?: boolean}) {
  const theme = useTheme()
  const animated = allowed && Boolean(process.stdout.isTTY)
  const order = useMemo(() => interleave(shuffled(WHISPERS), shuffled(TIPS)), [])
  const [index, setIndex] = useState(0)
  const [stage, setStage] = useState<Stage>(animated ? 'rest' : 'hold')
  const [t, setT] = useState(0)
  const [hintT, setHintT] = useState(HINT_MS)
  const [hintShown, setHintShown] = useState(false)

  useEffect(() => {
    if (!animated) return
    if (stage === 'hold' || stage === 'rest') {
      const id = setTimeout(
        () => {
          if (stage === 'rest') setIndex(i => i + 1)
          setT(0)
          setStage(stage === 'hold' ? 'fade' : 'reveal')
        },
        stage === 'hold' ? HOLD_MS : REST_MS,
      )
      return () => clearTimeout(id)
    }
    const duration = stage === 'reveal' ? REVEAL_MS : FADE_MS
    const start = Date.now()
    const id = setInterval(() => {
      const elapsed = Date.now() - start
      if (elapsed >= duration) {
        setT(0)
        setStage(stage === 'reveal' ? 'hold' : 'rest')
      } else {
        setT(elapsed)
      }
    }, 50)
    return () => clearInterval(id)
  }, [stage, animated])

  // a hint flickers in quickly, and gives way again
  useEffect(() => {
    setHintShown(Boolean(hint))
    if (!hint) return
    const linger = setTimeout(() => setHintShown(false), HINT_LINGER_MS)
    if (!animated) return () => clearTimeout(linger)
    setHintT(0)
    const start = Date.now()
    const id = setInterval(() => {
      const elapsed = Date.now() - start
      setHintT(Math.min(HINT_MS, elapsed))
      if (elapsed >= HINT_MS) clearInterval(id)
    }, 30)
    return () => {
      clearInterval(id)
      clearTimeout(linger)
    }
  }, [hint, animated])

  if (hint && hintShown) {
    const text = truncate(plain(hint), Math.max(10, width - 6))
    const cells = hintT >= HINT_MS ? [...text].map(ch => ({ch, glyph: false})) : scramble(text, hintT / HINT_MS, 'in')
    return <Scrambled cells={cells} color={theme.gray} glyphColor={theme.accent} dim={theme.dimSecondary} />
  }

  const text = truncate(plain(order[index % order.length]!), Math.max(10, width - 6))
  if (stage === 'rest') return <Text> </Text>

  const cells =
    stage === 'hold'
      ? [...text].map(ch => ({ch, glyph: false}))
      : scramble(text, t / (stage === 'reveal' ? REVEAL_MS : FADE_MS), stage === 'reveal' ? 'in' : 'out')
  return <Scrambled cells={cells} color={theme.whisper ?? theme.gray} glyphColor={theme.accent} dim={theme.dimSecondary} italic />
}
