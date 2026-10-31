import React, {useEffect, useState} from 'react'
import {attempt, call, queuesOf, say, t, useAxive, type Queue} from '../state.js'
import {Button, Choice, Field, Select, Title, Toggle} from '../ui.js'

/**
 * Tunnels (C1 to C3): named queues, each with how many run at once, its own
 * speed limit, days and hours, and what happens when it empties. The main
 * tunnel always exists.
 */

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const ORDER = [1, 2, 3, 4, 5, 6, 0]
const AFTER = ['none', 'notify', 'quit', 'sleep', 'hibernate', 'shutdown'] as const
const AFTER_SHOW: Record<string, string> = {none: 'nothing', notify: 'tell me', quit: 'close Axive', sleep: 'sleep', hibernate: 'hibernate', shutdown: 'shut down'}
const LIMITS = ['', '512K', '1M', '2M', '5M', '10M'] as const

const at = (ms?: number) => (ms ? new Date(ms).toLocaleString([], {weekday: 'short', hour: '2-digit', minute: '2-digit'}) : '')

function QueueCard({q, index, count}: {q: Queue; index: number; count: number}) {
  const [name, setName] = useState(q.name)
  const [start, setStart] = useState(q.schedule.start ?? '')
  const [stop, setStop] = useState(q.schedule.stop ?? '')
  useEffect(() => (setName(q.name), setStart(q.schedule.start ?? ''), setStop(q.schedule.stop ?? '')), [q.name, q.schedule.start, q.schedule.stop])
  const update = (patch: Partial<Queue>) => void attempt(() => call('queue-update', {id: q.id, patch}))
  const sched = (patch: Partial<Queue['schedule']>) => update({schedule: {...q.schedule, ...patch}})
  const hhmm = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim())
  const main = q.id === 'main'
  return (
    <article className={`queue-card ${q.open === false ? 'closed' : 'open'}`} aria-labelledby={`q-${q.id}`}>
      <header className="queue-head">
        <span className={`q-dot ${q.open === false ? '' : 'on'}`} aria-hidden />
        <h2 className="section-title" id={`q-${q.id}`}>
          {q.name}
        </h2>
        <span className="data meta">{t(`${q.running ?? 0} running · ${q.pending ?? 0} to do`)}</span>
        <span className="grow" />
        {q.open === false ? (
          <Button kind="quiet" icon="play" hint="open it now, whatever the schedule says" onClick={() => void attempt(() => call('queue-start', {id: q.id}))}>
            start now
          </Button>
        ) : (
          <Button kind="quiet" icon="pause" hint="close it now: what runs is held, nothing new starts" onClick={() => void attempt(() => call('queue-stop', {id: q.id}))}>
            stop now
          </Button>
        )}
        <Button kind="quiet" icon="up" label="move up" disabled={index === 0} onClick={() => void attempt(() => call('queue-order', {id: q.id, step: -1}))} />
        <Button kind="quiet" icon="down" label="move down" disabled={index === count - 1} onClick={() => void attempt(() => call('queue-order', {id: q.id, step: 1}))} />
        {main ? null : <Button kind="quiet" icon="trash" label={`remove ${q.name} (its items move to main)`} onClick={() => void attempt(() => call('queue-remove', {id: q.id}))} />}
      </header>
      <div className="queue-body">
        {main ? null : (
          <div className="setting-row">
            <div className="name">{t('name')}</div>
            <Field label="name" value={name} onChange={setName} width={220} onEnter={() => name.trim() && update({name: name.trim()})} />
            {name !== q.name && name.trim() ? (
              <Button kind="quiet" onClick={() => update({name: name.trim()})}>
                keep
              </Button>
            ) : null}
          </div>
        )}
        <div className="setting-row">
          <div className="name">{t('side by side')}</div>
          <Choice label="side by side" value={String(q.maxConcurrent)} options={['1', '2', '3', '4', '6', '8']} onChange={v => update({maxConcurrent: Number(v)})} />
        </div>
        <div className="setting-row">
          <div className="name">{t('speed limit')}</div>
          <Choice label="speed limit" value={(LIMITS as readonly string[]).includes(q.speedLimit) ? q.speedLimit : ''} options={LIMITS as readonly string[]} onChange={v => update({speedLimit: v})} show={v => (v ? `${v}B/s` : 'none')} />
        </div>
        <div className="setting-row">
          <div className="name">{t('schedule')}</div>
          <Toggle label={q.schedule.on ? 'on' : 'off'} value={q.schedule.on} onChange={on => sched({on})} hint="open and close this tunnel by the clock" />
        </div>
        {q.schedule.on ? (
          <div className="schedule">
            <div className="days" role="group" aria-label={t('days')}>
              {ORDER.map(d => (
                <button key={d} type="button" className="day" aria-pressed={q.schedule.days.includes(d)} onClick={() => sched({days: q.schedule.days.includes(d) ? q.schedule.days.filter(x => x !== d) : [...q.schedule.days, d].sort()})}>
                  {t(DAYS[d]!)}
                </button>
              ))}
            </div>
            <div className="times">
              <Field label="start at, HH:MM" value={start} onChange={setStart} placeholder="02:00" width={96} onEnter={() => (start === '' || hhmm(start) ? sched({start: start || undefined}) : say('a time like 02:00', 'warn'))} />
              <span className="meta" aria-hidden>
                →
              </span>
              <Field label="stop at, HH:MM" value={stop} onChange={setStop} placeholder="07:30" width={96} onEnter={() => (stop === '' || hhmm(stop) ? sched({stop: stop || undefined}) : say('a time like 07:30', 'warn'))} />
              {(start !== (q.schedule.start ?? '') || stop !== (q.schedule.stop ?? '')) && (start === '' || hhmm(start)) && (stop === '' || hhmm(stop)) ? (
                <Button kind="quiet" onClick={() => sched({start: start || undefined, stop: stop || undefined})}>
                  keep
                </Button>
              ) : null}
            </div>
            <p className="meta">{[q.nextStart ? t(`opens ${at(q.nextStart)}`) : '', q.nextStop ? t(`closes ${at(q.nextStop)}`) : ''].filter(Boolean).join(' · ') || t('no stop time: it opens and stays open')}</p>
          </div>
        ) : null}
        <div className="setting-row">
          <div>
            <div className="name">{t('when it empties')}</div>
            <div className="help">{t('sleep, hibernate and shut down wait 10 seconds first, with a way to stop them')}</div>
          </div>
          <Select label="when it empties" value={q.after} options={AFTER} show={v => AFTER_SHOW[v] ?? v} onChange={after => update({after})} />
        </div>
      </div>
    </article>
  )
}

export function QueuesView() {
  const queues = useAxive(queuesOf)
  const real = useAxive(s => Boolean(s.queues?.length))
  const [name, setName] = useState('')
  return (
    <div className="view">
      <Title sub="named queues: how many run at once, a speed limit, days and hours, and what happens when one empties">tunnels</Title>
      {!real ? <p className="meta">{t('one tunnel for now: more arrive with the scheduler')}</p> : null}
      <form className="new-queue" onSubmit={e => (e.preventDefault(), name.trim() && void attempt(async () => (await call('queue-add', {name: name.trim()}), setName(''), say(`a tunnel named ${name.trim()}`, 'ok'))))}>
        <Field label="a new tunnel" value={name} onChange={setName} placeholder="a new tunnel: night, work, big files…" width={340}>
          <Button type="submit" icon="plus" disabled={!name.trim()}>
            add
          </Button>
        </Field>
      </form>
      <div className="queue-list">
        {queues.map((q, i) => (
          <QueueCard key={q.id} q={q} index={i} count={queues.length} />
        ))}
      </div>
    </div>
  )
}
