import {spawn} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {getConfig} from './config.js'
import {IS_WIN, ensureDir, isSea, paths, writeFileAtomic} from './paths.js'

export type TermKind = 'wt' | 'vscode' | 'conhost' | 'other'

export type TermInfo = {
  kind: TermKind
  /** Axive draws its own title bar and window buttons (Windows Terminal, focus mode) */
  chrome: boolean
  /** the terminal falls back to other fonts for symbols the main font lacks */
  rich: boolean
}

export function detectTerminal(inTerminalFlag: boolean): TermInfo {
  const env = process.env
  let kind: TermKind = 'other'
  if (env.WT_SESSION) kind = 'wt'
  else if (env.TERM_PROGRAM === 'vscode') kind = 'vscode'
  else if (IS_WIN && !env.TERM_PROGRAM && !env.ConEmuPID && !env.TERM && !env.ALACRITTY_WINDOW_ID && !env.WEZTERM_PANE) kind = 'conhost'
  return {kind, chrome: kind === 'wt' && inTerminalFlag, rich: kind !== 'conhost'}
}

export function wtExe(): string | undefined {
  if (!IS_WIN) return undefined
  const candidate = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps', 'wt.exe')
  return fs.existsSync(candidate) ? candidate : undefined
}

/**
 * How to start Axive again: through the loader when it started us (so
 * shortcuts and relaunches always pick up a newer build), else this very
 * Axive.exe, or node + the bundle while developing.
 */
export function selfCommand(): string[] {
  const loader = process.env.AXIVE_LOADER
  if (isSea() && loader && /.exe$/i.test(loader) && fs.existsSync(loader)) return [loader]
  if (isSea()) return [process.execPath]
  return [process.execPath, path.resolve(process.argv[1] ?? 'dist/axive.mjs')]
}

// ---------------------------------------------------------------------------
// the Windows Terminal profile (a JSON fragment: no edits to the user's settings.json)

export const PROFILE_GUID = '{8d4e1f62-2b9a-5c37-8e0f-6a1b3c5d7e94}'
const fragmentDir = () => path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Windows Terminal', 'Fragments', 'Axive Free')
const fragmentFile = () => path.join(fragmentDir(), 'axive-free.json')

const SCHEME = {
  name: 'Axive Free Abyss',
  background: '#060609',
  foreground: '#D8D0BF',
  cursorColor: '#A3141E',
  selectionBackground: '#7D0F17',
  black: '#060609',
  red: '#A3141E',
  green: '#5E7A5A',
  yellow: '#B8955A',
  blue: '#4E5A78',
  purple: '#6E4A6E',
  cyan: '#4F7270',
  white: '#D8D0BF',
  brightBlack: '#3D3842',
  brightRed: '#C8323C',
  brightGreen: '#7E9A78',
  brightYellow: '#D8B578',
  brightBlue: '#6E7A98',
  brightPurple: '#8E6A8E',
  brightCyan: '#6F9290',
  brightWhite: '#EFE7D6',
}

const SHADER = `// Axive — a cinematic vignette, and a little bloom where the red is.
// Written by Axive Free for its Windows Terminal profile; turn it off in settings.
Texture2D shaderTexture;
SamplerState samplerState;

cbuffer PixelShaderSettings {
  float  Time;
  float  Scale;
  float2 Resolution;
  float4 Background;
};

float4 main(float4 pos : SV_POSITION, float2 tex : TEXCOORD) : SV_TARGET
{
  float4 color = shaderTexture.Sample(samplerState, tex);

  // bloom: gather a small cross around the pixel, keep only red that dominates
  float2 px = Scale / Resolution;
  float3 glow = float3(0, 0, 0);
  [unroll] for (int i = 1; i <= 3; i++) {
    float2 o = px * i * 1.5;
    float3 s = shaderTexture.Sample(samplerState, tex + float2(o.x, 0)).rgb
             + shaderTexture.Sample(samplerState, tex - float2(o.x, 0)).rgb
             + shaderTexture.Sample(samplerState, tex + float2(0, o.y)).rgb
             + shaderTexture.Sample(samplerState, tex - float2(0, o.y)).rgb;
    glow += s / i;
  }
  glow /= 7.33;
  float red = saturate(glow.r - max(glow.g, glow.b) * 1.35);
  color.rgb += float3(red * 0.32, red * 0.02, red * 0.03);

  // vignette: the corners sink a little, the centre stays bright
  float2 d = tex - 0.5;
  float v = smoothstep(0.9, 0.32, length(d * float2(1.08, 1.0)));
  color.rgb *= lerp(0.7, 1.0, v);
  return color;
}
`

/** The icon a door wears: the window's mark, or the terminal's prompt on the same plate. */
export function iconPath(kind: 'window' | 'terminal' = 'window'): string {
  const own = path.join(paths.root, `axive-${kind}.ico`)
  return fs.existsSync(own) ? own : path.join(paths.root, 'axive.ico')
}

/** Write (or refresh) Axive's profile and colour scheme for Windows Terminal. */
export function installFragment(): boolean {
  if (!IS_WIN || !wtExe()) return false
  try {
    const config = getConfig()
    const shader = path.join(ensureDir(path.join(paths.root, 'terminal')), 'vignette.hlsl')
    if (config.vignette) fs.writeFileSync(shader, SHADER)
    const command = [...selfCommand(), '--in-terminal'].map(arg => (/[\s"]/.test(arg) ? `"${arg}"` : arg)).join(' ')
    const profile: Record<string, unknown> = {
      guid: PROFILE_GUID,
      name: 'Axive Free',
      commandline: command,
      colorScheme: SCHEME.name,
      font: {face: 'Cascadia Mono', size: 12},
      padding: '4',
      cursorShape: 'bar',
      scrollbarState: 'hidden',
      closeOnExit: 'always',
      tabTitle: 'Axive Free',
      suppressApplicationTitle: true,
      bellStyle: 'none',
      antialiasingMode: 'grayscale',
      startingDirectory: '%USERPROFILE%',
      hidden: false,
    }
    if (fs.existsSync(iconPath('terminal'))) profile.icon = iconPath('terminal')
    if (config.vignette) profile['experimental.pixelShaderPath'] = shader
    const fragment = {
      $help: 'Written by Axive Free (https://github.com/AxiveCuisine/axive-free). Remove it: axive-free terminal remove',
      profiles: [profile],
      schemes: [SCHEME],
    }
    const text = `${JSON.stringify(fragment, null, 2)}\n`
    const file = fragmentFile()
    let current = ''
    try {
      current = fs.readFileSync(file, 'utf8')
    } catch {
      // first time
    }
    if (current !== text) writeFileAtomic(file, text)
    return true
  } catch {
    return false
  }
}

export function removeFragment(): void {
  fs.rmSync(fragmentDir(), {recursive: true, force: true})
}

export const fragmentInstalled = () => fs.existsSync(fragmentFile())

/** wt.exe arguments that open Axive in its own focus-mode window. */
export function terminalArgs(extra: string[] = []): string[] {
  return [
    '-w',
    'new',
    '--focus',
    '--size',
    '112,34',
    'new-tab',
    '--profile',
    PROFILE_GUID,
    '--title',
    'Axive Free',
    '--suppressApplicationTitle',
    '--',
    ...selfCommand(),
    '--in-terminal',
    ...extra,
  ]
}

/** Open Axive in Windows Terminal; false when there is no Windows Terminal to open. */
export function relaunchInTerminal(extra: string[] = []): boolean {
  const wt = wtExe()
  if (!wt) return false
  installFragment()
  try {
    const child = spawn(wt, terminalArgs(extra), {detached: true, stdio: 'ignore'})
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// escape sequences Windows Terminal understands

/** OSC 9;4 — progress in the tab and on the taskbar button. state 0 clears it. */
export function taskbarProgress(state: 0 | 1 | 2 | 3 | 4, percent = 0): string {
  return `\x1b]9;4;${state};${Math.max(0, Math.min(100, Math.round(percent)))}\x07`
}

export const MOUSE_ON = '\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h'
export const MOUSE_OFF = '\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?1006l'
export const FOCUS_ON = '\x1b[?1004h'
export const FOCUS_OFF = '\x1b[?1004l'
