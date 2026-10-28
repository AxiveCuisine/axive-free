import React, {createContext, useContext, useEffect, useState, type ReactNode} from 'react'
import {Box, useStdout} from 'ink'
import {useTheme} from '../theme.js'

/** The terminal's own size, in cells. */
export function useTerminalSize(): {columns: number; rows: number} {
  const {stdout} = useStdout()
  const dimensions = () => ({
    columns: stdout?.columns && stdout.columns > 0 ? stdout.columns : 80,
    rows: stdout?.rows && stdout.rows > 1 ? stdout.rows : 24,
  })
  const [size, setSize] = useState(dimensions)
  useEffect(() => {
    if (!stdout) return
    const onResize = () => setSize(dimensions())
    stdout.on('resize', onResize)
    return () => {
      stdout.off('resize', onResize)
    }
  }, [stdout])
  return size
}

/** The room a screen has: the main panel inside the shell, or the whole terminal outside it. */
export const PanelSize = createContext<{columns: number; rows: number} | undefined>(undefined)

/**
 * The size a screen lays itself out in. Inside the shell that is the main
 * panel (the rail, the header and the foot already have their share); every
 * screen measures with this, so each fits its panel without knowing the shell.
 */
export function useSize(): {columns: number; rows: number} {
  const panel = useContext(PanelSize)
  const terminal = useTerminalSize()
  return panel ?? terminal
}

/**
 * The whole terminal, painted, for what comes before the shell (the boot
 * mark, first-run setup): the content centred, one row left unused at the
 * bottom (Windows consoles scroll when the last cell is written).
 */
export function FullScreen({children}: {children: ReactNode}) {
  const theme = useTheme()
  const size = useTerminalSize()
  return (
    <Box width={size.columns} height={size.rows - 1} flexDirection="column" backgroundColor={theme.ground} alignItems="center" justifyContent="center">
      <Box flexDirection="column" alignItems="center" flexShrink={0}>
        {children}
      </Box>
    </Box>
  )
}
