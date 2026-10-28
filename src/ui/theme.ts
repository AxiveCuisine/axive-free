import React, {createContext, type ReactNode, useContext} from 'react'
import {THEME_MODES, type ThemeMode} from '../core/config.js'

export {THEME_MODES, type ThemeMode}

/**
 * Colour roles, the same as the window's (gui/DESIGN.md): bone is the only
 * bright thing, red appears for what is alive or wrong, never for selection.
 * The older names (primary, gray, accent…) stay as aliases of the roles so
 * every screen speaks one palette.
 */
export type Theme = {
  mode: ThemeMode
  /** the window: black water */
  ground?: string
  /** the rail, the header, popovers */
  raised?: string
  /** input wells, progress tracks */
  sunk?: string
  /** a secondary control's face, and under the mouse */
  control?: string
  controlHover?: string
  /** primary text (bone) */
  ink?: string
  /** labels, metadata */
  ink2?: string
  /** decoration and disabled only */
  ink3?: string
  /** hairlines, and control borders */
  rule?: string
  ruleStrong?: string
  /** the seal: the one thing alive (as a fill or a heavy line) */
  signal?: string
  /** the signal as text: live counts, errors */
  signalInk?: string

  // aliases (older screens)
  /** Undefined means “use the terminal's own foreground/background”. */
  primary?: string
  gray?: string
  /** the one warm colour in the deep */
  accent?: string
  /** background text that should barely register */
  whisper?: string
  dark?: string
  background?: string
  /** filled button face and its label */
  button?: string
  buttonText?: string
  /** a button under the mouse */
  hover?: string
  /** text selected with the mouse */
  selection: {fg: string; bg: string}
  dimSecondary: boolean
  inverseButton: boolean
}

type Roles = Required<Pick<Theme, 'ground' | 'raised' | 'sunk' | 'control' | 'controlHover' | 'ink' | 'ink2' | 'ink3' | 'rule' | 'ruleStrong' | 'signal' | 'signalInk'>>

function fromRoles(mode: ThemeMode, r: Roles, hover: string, selection: {fg: string; bg: string}): Theme {
  return {
    mode,
    ...r,
    primary: r.ink,
    gray: r.ink2,
    accent: r.signalInk,
    whisper: r.ink3,
    dark: r.ground,
    background: r.ground,
    button: r.ink,
    buttonText: r.ground,
    hover,
    selection,
    dimSecondary: false,
    inverseButton: false,
  }
}

const themes: Record<ThemeMode, Theme> = {
  // bone on black water, with a little dried blood
  abyss: fromRoles(
    'abyss',
    {
      ground: '#060609',
      raised: '#0d0c11',
      sunk: '#030305',
      control: '#18161d',
      controlHover: '#2b2831',
      ink: '#d8d0bf',
      ink2: '#9a94a0',
      ink3: '#6c6672',
      rule: '#25222b',
      ruleStrong: '#4a4550',
      signal: '#7d0f17',
      signalInk: '#d0434b',
    },
    '#f3ecdc',
    {fg: '#efe7d6', bg: '#5a0b11'},
  ),
  ash: fromRoles(
    'ash',
    {
      ground: '#0b0b0d',
      raised: '#121215',
      sunk: '#060607',
      control: '#1c1c20',
      controlHover: '#2e2e33',
      ink: '#e4e4e7',
      ink2: '#a1a1aa',
      ink3: '#71717a',
      rule: '#27272a',
      ruleStrong: '#52525b',
      signal: '#71717a',
      signalInk: '#d4d4d8',
    },
    '#fafafa',
    {fg: '#0b0b0d', bg: '#a1a1aa'},
  ),
  auto: {
    mode: 'auto',
    // Leaving colours unset is more reliable than trying to detect whether a
    // terminal is light or dark. ANSI defaults already follow its theme.
    signal: 'red',
    signalInk: 'red',
    accent: 'red',
    hover: 'redBright',
    selection: {fg: '#ffffff', bg: '#a3141e'},
    dimSecondary: true,
    inverseButton: true,
  },
}

const ThemeContext = createContext<Theme>(themes.abyss)

export function themeFor(mode: ThemeMode): Theme {
  return themes[mode]
}

export function ThemeProvider({mode, children}: {mode: ThemeMode; children: ReactNode}) {
  return React.createElement(ThemeContext.Provider, {value: themeFor(mode)}, children)
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}
