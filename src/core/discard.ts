import {execFile} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {getConfig} from './config.js'
import {logEvent} from './log.js'
import {IS_WIN, paths} from './paths.js'

/**
 * "Also delete it from the drive": a received file (or a torrent's folder)
 * goes to the Recycle Bin, so a slip can still be undone. Only paths Axive
 * itself recorded are ever handed here (the ledger, a finished draw, a
 * finished fetch), never one a page names, and even those are refused when
 * they are a drive, a home folder, the downloads folder itself, or Axive's own
 * data. A file another program holds open stays where it is and is reported.
 */

export type DiscardResult = {removed: string[]; kept: Array<{path: string; why: 'in use' | 'refused' | 'gone' | 'failed'}>}

function same(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}

function inside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent).toLowerCase(), path.resolve(child).toLowerCase())
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Places a delete must never touch, whatever a record says. */
export function refusedPlace(target: string): boolean {
  const p = path.resolve(target)
  if (!path.isAbsolute(target)) return true
  if (same(p, path.parse(p).root)) return true
  const home = os.homedir()
  const guarded = [home, ...['Desktop', 'Downloads', 'Documents', 'Videos', 'Music', 'Pictures'].map(d => path.join(home, d)), getConfig().folder, process.env.SystemRoot ?? 'C:\\Windows', process.env.ProgramFiles ?? '', process.env['ProgramFiles(x86)'] ?? ''].filter(Boolean)
  if (guarded.some(g => same(p, g) || inside(g, p))) return true
  // Axive's own data (its tools, its ledger) is never a download
  return inside(p, paths.root)
}

const RECYCLE = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class AxiveBin {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct Op { public IntPtr hwnd; public uint func; public string from; public string to; public ushort flags; public bool aborted; public IntPtr names; public string title; }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHFileOperation(ref Op op);
  // FO_DELETE, to the Recycle Bin, no questions, no error boxes, no progress
  public static int Recycle(string p) { var op = new Op { func = 3, from = p + "\\0\\0", flags = 0x40 | 0x10 | 0x400 | 0x4 | 0x200 }; return SHFileOperation(ref op); }
}
'@
$out = foreach ($p in (ConvertFrom-Json $env:AXIVE_DISCARD)) {
  if (-not (Test-Path -LiteralPath $p)) { 'gone'; continue }
  if (Test-Path -LiteralPath $p -PathType Leaf) {
    try { $f = [IO.File]::Open($p, 'Open', 'ReadWrite', 'None'); $f.Close() } catch { 'in use'; continue }
  }
  if ([AxiveBin]::Recycle($p) -eq 0 -and -not (Test-Path -LiteralPath $p)) { 'ok' } else { 'failed' }
}
@($out) -join '|'
`

function recycleOnWindows(targets: string[]): Promise<string[]> {
  const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return new Promise(resolve => {
    execFile(
      ps,
      ['-NoProfile', '-NonInteractive', '-Command', RECYCLE],
      {encoding: 'utf8', timeout: 60_000, windowsHide: true, env: {...process.env, AXIVE_DISCARD: JSON.stringify(targets)}},
      (error, stdout) => resolve(error ? targets.map(() => 'failed') : stdout.trim().split('|')),
    )
  })
}

/** Send what Axive received to the Recycle Bin (elsewhere: delete it). */
export async function discard(targets: string[]): Promise<DiscardResult> {
  const result: DiscardResult = {removed: [], kept: []}
  const wanted: string[] = []
  for (const t of [...new Set(targets.filter(Boolean))]) {
    if (refusedPlace(t)) result.kept.push({path: t, why: 'refused'})
    else if (!fs.existsSync(t)) result.kept.push({path: t, why: 'gone'})
    else wanted.push(path.resolve(t))
  }
  if (!wanted.length) return result
  if (IS_WIN) {
    const answers = await recycleOnWindows(wanted)
    wanted.forEach((p, i) => {
      const a = answers[i]
      if (a === 'ok') result.removed.push(p)
      else result.kept.push({path: p, why: a === 'in use' ? 'in use' : a === 'gone' ? 'gone' : 'failed'})
    })
  } else {
    for (const p of wanted) {
      try {
        fs.rmSync(p, {recursive: true})
        result.removed.push(p)
      } catch {
        result.kept.push({path: p, why: 'failed'})
      }
    }
  }
  if (result.removed.length) logEvent('info', `deleted ${result.removed.length} received file(s) from the drive (to the Recycle Bin)`)
  return result
}

/** One sentence for what happened. */
export function discardSentence(r: DiscardResult): string {
  const busy = r.kept.filter(k => k.why === 'in use').length
  const other = r.kept.filter(k => k.why === 'failed' || k.why === 'refused').length
  const parts = [r.removed.length ? `${r.removed.length} ${r.removed.length === 1 ? 'file' : 'files'} moved to the Recycle Bin` : '']
  if (busy) parts.push(`${busy} in use by another program, left where ${busy === 1 ? 'it is' : 'they are'}`)
  if (other) parts.push(`${other} could not be deleted`)
  return parts.filter(Boolean).join(' · ') || 'nothing was on the drive to delete'
}
