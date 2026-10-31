import React, {useEffect, useState} from 'react'
import {attempt, call, say, t} from '../state.js'
import {Button, Sheet, Toggle} from '../ui.js'

/**
 * Delete, asked every time: what leaves the list (or the ledger), and a box to
 * also delete it from the drive. Live and paused downloads stop, and keep what
 * arrived unless the box says otherwise. Files go to the Recycle Bin, so a slip
 * can be undone; a file another program holds stays where it is.
 */

export type DeleteAsk =
  | {from: 'list'; items: Array<{kind: string; id: string}>; names: string[]; live?: number; files?: number}
  | {from: 'ledger'; ids: string[]; names: string[]}

export function askDelete(ask: DeleteAsk): void {
  window.dispatchEvent(new CustomEvent('axive-delete', {detail: ask}))
}

export function DeleteSheet() {
  const [ask, setAsk] = useState<DeleteAsk>()
  const [drive, setDrive] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const open = (e: Event) => (setAsk((e as CustomEvent<DeleteAsk>).detail), setDrive(false))
    window.addEventListener('axive-delete', open)
    return () => window.removeEventListener('axive-delete', open)
  }, [])
  if (!ask) return null
  const n = ask.names.length
  const live = ask.from === 'list' ? (ask.live ?? 0) : 0
  const close = () => (setAsk(undefined), setBusy(false))
  const go = () =>
    void attempt(async () => {
      setBusy(true)
      try {
        const r = ask.from === 'ledger' ? await call<{sentence: string}>('ledger-delete', {ids: ask.ids, drive}) : await call<{sentence: string}>('rows-delete', {items: ask.items, drive})
        say(r.sentence, r.sentence.includes('could not') || r.sentence.includes('in use') ? 'warn' : 'ok')
      } finally {
        close()
      }
    })
  const where = ask.from === 'ledger' ? 'the ledger' : 'the list'
  const sub = live === n ? (n === 1 ? 'it stops and leaves the list' : 'they stop and leave the list') : `${n === 1 ? 'it leaves' : 'they leave'} ${where}`
  const hint = live
    ? live === n
      ? 'on: the partial files go to the Recycle Bin. off: what arrived stays where it was going'
      : 'on: received files and partial ones go to the Recycle Bin. off: every file stays on the drive'
    : 'the files go to the Recycle Bin, so you can still bring them back. a file another program has open stays'
  return (
    <Sheet title={n === 1 ? 'delete it?' : `delete ${n}?`} sub={sub} onClose={close} labelId="delete-title">
      <div className="stack">
        <ul className="arrivals delete-names">
          {ask.names.slice(0, 6).map((name, i) => (
            <li key={i}>
              <span className="t selectable" title={name}>
                {name}
              </span>
            </li>
          ))}
          {n > 6 ? <li className="meta">{t(`and ${n - 6} more`)}</li> : null}
        </ul>
        <Toggle label={live === n ? 'also delete the partial files' : 'also delete from the drive'} value={drive} onChange={setDrive} hint={hint} />
        <p className="meta" aria-live="polite">
          {t(drive ? (live === n ? 'the partial files go to the Recycle Bin' : 'the files go to the Recycle Bin: you can bring them back from there') : live === n ? 'what arrived stays on the drive' : 'the files stay on the drive: only the line goes')}
        </p>
        <div className="row-gap">
          <Button kind={drive ? 'danger' : 'primary'} icon="trash" disabled={busy} onClick={go}>
            {busy ? '…' : drive ? (n === 1 ? 'delete, with the file' : 'delete, with the files') : live === n ? (n === 1 ? 'stop it, keep the file' : 'stop them, keep the files') : `remove from ${where}`}
          </Button>
          <Button kind="quiet" onClick={close}>
            keep
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
