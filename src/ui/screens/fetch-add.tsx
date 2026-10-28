import React, {useEffect, useRef, useState} from 'react'
import {Box, useInput} from 'ink'
import {Text} from '../text.js'
import {bridge} from '../../core/bridge.js'
import {getCategories} from '../../core/categories.js'
import {useConfig} from '../../core/config.js'
import {addLink} from '../../core/fetcher.js'
import {formatBytes, truncate} from '../../core/format.js'
import {G} from '../../core/glyphs.js'
import {prettyPath} from '../../core/paths.js'
import {DuplicateError, probeLink, type ProbeResult} from '../../core/probe.js'
import {say} from '../components/notice.js'
import {Sigil} from '../components/sigil.js'
import {useRegion} from '../mouse.js'
import {Button, ButtonRow, Cycle, Faint, Field, Ink, Quiet, Rule, Toggle} from '../kit.js'
import {useTheme} from '../theme.js'

/**
 * The add funnel: every link that is a file (pasted, dropped on home, sent
 * by the phone or the browser) is looked at before it is added: its size,
 * whether the server resumes, its kind, where it will rest, now or later.
 * Several links pasted together are reviewed in one table.
 */

export type AddChoice = {folder: string; start: boolean; connections: number; category?: string}

function useAddChoice(folder: string): [AddChoice, (patch: Partial<AddChoice>) => void] {
  const config = useConfig()
  const [choice, setChoice] = useState<AddChoice>({folder, start: true, connections: config.fetchConnections})
  return [choice, patch => setChoice(c => ({...c, ...patch}))]
}

/** Folder, connections, now or later: shared by the card and the review. */
function AddOptions({choice, set, width, labelW = 16}: {choice: AddChoice; set: (patch: Partial<AddChoice>) => void; width: number; labelW?: number}) {
  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Field label="rests in" width={labelW}>
        <Ink verbatim>{truncate(prettyPath(choice.folder), Math.max(12, width - labelW - 14))}</Ink>
        <Button compact quiet label="change" onPress={() => void bridge.pickFolder('Where fetched files rest', choice.folder).then(f => f && set({folder: f}))} hint="open the Windows folder picker" />
      </Field>
      <Cycle label="connections" labelWidth={labelW} value={String(choice.connections)} options={['1', '2', '4', '8', '12', '16']} onChange={v => set({connections: Number(v)})} hint="parallel streams for this file" />
      <Field label="begin" width={labelW}>
        <Toggle label={choice.start ? 'now (when a tunnel is free)' : 'later: added paused'} value={choice.start} onChange={start => set({start})} hint="later keeps it on the list, paused, until you resume it" />
      </Field>
    </Box>
  )
}

/** add one link, answering a duplicate when the setting says ask */
async function addOne(url: string, choice: AddChoice, filename?: string, onDuplicate?: 'number' | 'overwrite'): Promise<string> {
  return addLink(url, choice.folder, {start: choice.start, connections: choice.connections, category: choice.category, filename, onDuplicate})
}

/** The card for one file link: probe, then the choices, then add. */
export function AddCard({url, folder, width, onDone, onCancel}: {url: string; folder: string; width: number; onDone: (gid?: string) => void; onCancel: () => void}) {
  const theme = useTheme()
  const [probe, setProbe] = useState<ProbeResult>()
  const [error, setError] = useState<string>()
  const [choice, set] = useAddChoice(folder)
  const [duplicate, setDuplicate] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    probeLink(url)
      .then(p => live && (setProbe(p), set({category: p.category})))
      .catch(e => live && setError((e as Error).message))
    return () => {
      live = false
    }
  }, [url])

  const add = async (dup?: 'number' | 'overwrite') => {
    setBusy(true)
    try {
      const gid = await addOne(probe?.finalUrl ?? url, choice, undefined, dup)
      say(choice.start ? 'fetching: it appears below' : 'added, paused: resume it when you like', 'ok', 2600)
      onDone(gid)
    } catch (e) {
      if (e instanceof DuplicateError) {
        if (e.choice === 'skip') (say(`${e.message}: skipped`, 'info', 4000), onDone())
        else setDuplicate(e.file)
      } else say(`could not fetch that: ${(e as Error).message}`, 'error', 6000)
    } finally {
      setBusy(false)
    }
  }

  useInput(
    (_input, key) => {
      if (key.return && !busy && !duplicate && (probe || error)) void add()
    },
    {isActive: Boolean(process.stdin.isTTY)},
  )

  const category = getCategories().find(c => c.id === (choice.category ?? probe?.category))
  const labelW = 16
  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Rule title="before it is added" width={width} right="↵ add · esc never mind" />
      <Field label="link" width={labelW}>
        <Text color={theme.ink2} verbatim wrap="truncate-end">
          {truncate(url, width - labelW - 2)}
        </Text>
      </Field>
      {probe ? (
        <>
          <Field label="file" width={labelW}>
            <Ink verbatim bold>
              {truncate(probe.filename, width - labelW - 2)}
            </Ink>
          </Field>
          <Field label="size" width={labelW}>
            <Ink>{probe.size ? formatBytes(probe.size) : 'not told'}</Ink>
            <Text color={probe.resumable ? theme.ink2 : theme.signalInk}>{probe.resumable ? ` ${G.dot} resumes and splits` : ` ${G.dot} no resume: one connection, all at once`}</Text>
          </Field>
          <Field label="kind" width={labelW}>
            <Ink>{category?.name ?? 'Other'}</Ink>
            <Faint>{`  ${probe.mime || 'unknown type'}`}</Faint>
          </Field>
        </>
      ) : error ? (
        <Field label="the server" width={labelW}>
          <Text color={theme.signalInk}>{`${error}. it can still be added; aria2 will try`}</Text>
        </Field>
      ) : (
        <Field label="the server" width={labelW}>
          <Sigil />
          <Quiet> asking for the size…</Quiet>
        </Field>
      )}
      <AddOptions choice={choice} set={set} width={width} labelW={labelW} />
      {duplicate ? (
        <Box marginTop={1} columnGap={1}>
          <Text color={theme.signalInk}>{`a file named ${duplicate} already rests there.`}</Text>
          <Button compact primary label="keep both" onPress={() => (setDuplicate(undefined), void add('number'))} hint="the new one gets a number: name (2).ext" />
          <Button compact danger label="replace it" onPress={() => (setDuplicate(undefined), void add('overwrite'))} />
          <Button compact quiet label="skip" onPress={() => (setDuplicate(undefined), onDone())} />
        </Box>
      ) : null}
      <Box marginTop={1}>
        <ButtonRow>
          <Button primary label={busy ? 'adding…' : 'add'} disabled={busy} keyHint="↵" onPress={() => void add()} />
          <Button quiet label="never mind" onPress={onCancel} />
        </ButtonRow>
      </Box>
    </Box>
  )
}

type Row = {url: string; on: boolean; probe?: ProbeResult; error?: string}

function ReviewRow({row, width, onToggle}: {row: Row; width: number; onToggle: () => void}) {
  const theme = useTheme()
  const {ref, hovered} = useRegion({onPress: onToggle, hint: row.url, label: row.probe?.filename ?? row.url})
  const name = row.probe?.filename ?? row.url.replace(/^\w+:\/\/(www\.)?/, '')
  const category = row.probe ? getCategories().find(c => c.id === row.probe!.category)?.name : undefined
  return (
    <Box ref={ref} width={width} flexShrink={0}>
      <Text color={row.on ? theme.ink : theme.ink3}>{row.on ? '■ ' : '□ '}</Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text color={hovered ? theme.hover : row.on ? theme.ink : theme.ink2} verbatim wrap="truncate-end">
          {name}
        </Text>
      </Box>
      <Box width={14} flexShrink={0}>
        <Text color={theme.ink3}>{category ?? ''}</Text>
      </Box>
      <Box width={12} flexShrink={0} justifyContent="flex-end">
        <Text color={row.error ? theme.signalInk : theme.ink2}>{row.error ? 'unreachable' : row.probe ? (row.probe.size ? formatBytes(row.probe.size) : '?') : '…'}</Text>
      </Box>
    </Box>
  )
}

/** Many links at once: a table with checkboxes, sizes as they arrive, a total, one add. */
export function BatchReview({urls, folder, width, rows, onDone, onCancel}: {urls: string[]; folder: string; width: number; rows: number; onDone: () => void; onCancel: () => void}) {
  const theme = useTheme()
  const [list, setList] = useState<Row[]>(() => urls.map(url => ({url, on: true})))
  const [choice, set] = useAddChoice(folder)
  const [offset, setOffset] = useState(0)
  const [adding, setAdding] = useState<number>()
  const alive = useRef(true)

  // sizes arrive four at a time
  useEffect(() => {
    alive.current = true
    let next = 0
    const work = async () => {
      while (alive.current && next < urls.length) {
        const i = next++
        const url = urls[i]!
        try {
          const p = await probeLink(url)
          if (alive.current) setList(l => l.map((r, j) => (j === i ? {...r, probe: p} : r)))
        } catch (e) {
          if (alive.current) setList(l => l.map((r, j) => (j === i ? {...r, error: (e as Error).message} : r)))
        }
      }
    }
    void Promise.all([work(), work(), work(), work()])
    return () => {
      alive.current = false
    }
  }, [urls])

  const chosen = list.filter(r => r.on)
  const total = chosen.reduce((a, r) => a + (r.probe?.size ?? 0), 0)
  const unknown = chosen.filter(r => !r.probe?.size).length
  const room = Math.max(3, rows - 14)
  const shown = list.slice(offset, offset + room)
  const add = async () => {
    setAdding(0)
    let ok = 0
    for (const r of chosen) {
      try {
        await addOne(r.probe?.finalUrl ?? r.url, choice, undefined, 'number')
        ok++
      } catch (e) {
        if (!(e instanceof DuplicateError)) say(`could not fetch ${truncate(r.url, 40)}: ${(e as Error).message}`, 'error', 5000)
      }
      setAdding(a => (a ?? 0) + 1)
    }
    say(`fetching ${ok}: they appear below`, 'ok', 3000)
    onDone()
  }
  useInput(
    (_input, key) => {
      if (key.return && adding === undefined && chosen.length) void add()
    },
    {isActive: Boolean(process.stdin.isTTY)},
  )
  const wheel = (dir: 'up' | 'down') => setOffset(o => Math.max(0, Math.min(Math.max(0, list.length - room), o + (dir === 'up' ? -3 : 3))))
  const body = useRegion({onWheel: wheel})
  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Rule title="review the batch" width={width} right={`${chosen.length} of ${list.length} · ${formatBytes(total)}${unknown ? ` + ${unknown} untold` : ''}`} />
      <Box ref={body.ref} flexDirection="column">
        {shown.map((r, i) => (
          <ReviewRow key={r.url} row={r} width={width} onToggle={() => setList(l => l.map((x, j) => (j === offset + i ? {...x, on: !x.on} : x)))} />
        ))}
      </Box>
      {list.length > room ? <Faint>{`rows ${offset + 1} to ${Math.min(list.length, offset + room)} of ${list.length} · the wheel scrolls`}</Faint> : null}
      <Box marginTop={1}>
        <ButtonRow>
          <Button compact quiet label="check all" onPress={() => setList(l => l.map(r => ({...r, on: true})))} />
          <Button compact quiet label="check none" onPress={() => setList(l => l.map(r => ({...r, on: false})))} />
        </ButtonRow>
      </Box>
      <Box marginTop={1}>
        <AddOptions choice={choice} set={set} width={width} />
      </Box>
      <Box marginTop={1}>
        <ButtonRow>
          <Button primary label={adding !== undefined ? `adding ${adding} of ${chosen.length}…` : `add ${chosen.length}`} disabled={!chosen.length || adding !== undefined} keyHint="↵" onPress={() => void add()} />
          <Button quiet label="never mind" onPress={onCancel} />
        </ButtonRow>
      </Box>
      {theme ? null : null}
    </Box>
  )
}
