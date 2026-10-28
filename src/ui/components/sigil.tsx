import React, {useEffect, useState} from 'react'
import {Text} from 'ink'
import {LETTERS} from '../../core/scramble.js'
import {useTheme} from '../theme.js'

/** The spinner: the twenty-two letters, turning over one by one. */
export function Sigil() {
  const theme = useTheme()
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % LETTERS.length), 110)
    return () => clearInterval(id)
  }, [])
  return <Text color={theme.accent}>{LETTERS[frame]}</Text>
}
