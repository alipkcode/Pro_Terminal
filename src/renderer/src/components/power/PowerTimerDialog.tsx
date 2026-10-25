import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  AlarmClock,
  AlarmClockOff,
  BellRing,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Eye,
  Info,
  Pencil,
  Repeat,
  ShieldAlert,
  Sunrise,
  TriangleAlert
} from 'lucide-react'
import type { PowerAction, PowerCaps, PowerTimer, PowerTimerSpec } from '@shared/types'
import {
  POWER_ACTIONS,
  POWER_META,
  POWER_WARN_OPTIONS,
  WEEKDAYS_ALL,
  WEEKDAYS_WORK,
  canForce,
  canWake,
  dateString,
  effectiveWarn,
  nextOccurrence,
  parseDate,
  parseTime,
  timeString
} from '@shared/power'
import { api } from '@/api'
import { get, useApp } from '@/store/app'
import { toast } from '@/lib/actions'
import {
  ACTION_HINT,
  WARN_LABEL,
  WEEKDAY_SHORT,
  cancelPowerTimer,
  clockTime,
  closePowerTimer,
  countdownClock,
  dayLabel,
  daysFromToday,
  inkOn,
  readPowerPrefs,
  repeatLabel,
  savePowerPrefs,
  schedulePowerTimer,
  untilLabel,
  uses12h,
  whenPhrase
} from '@/lib/power'
import { Modal } from '../ui/Modal'
import { Segmented, Switch } from '../ui/Controls'
import { POWER_ICON } from './powerIcons'

type RepeatMode = 'once' | 'daily' | 'weekdays' | 'custom'

interface Draft {
  action: PowerAction
  repeat: RepeatMode
  /** The chosen weekdays when the repeat is custom. */
  days: number[]
  /** The day of a one-off timer, 'YYYY-MM-DD'. */
  date: string
  time: string
  warn: number
  force: boolean
  wake: boolean
}

const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0]
const QUICK_PICKS: [number, string][] = [
  [15, '+15 min'],
  [30, '+30 min'],
  [60, '+1 hour'],
  [120, '+2 hours']
]
const SCHEDULE_LABEL: Record<PowerAction, string> = {
  shutdown: 'Schedule shutdown',
  restart: 'Schedule restart',
  sleep: 'Schedule sleep',
  hibernate: 'Schedule hibernation'
}
const SPRING = { type: 'spring', stiffness: 520, damping: 38 } as const

const sameDays = (a: number[], b: number[]): boolean => a.length === b.length && a.every((d, i) => d === b[i])
const sortDays = (days: number[]): number[] => [...new Set(days)].sort((a, b) => a - b)
const wrap = (n: number, size: number): number => ((n % size) + size) % size
const nearestWarn = (w: number): number => POWER_WARN_OPTIONS.reduce((best, o) => (Math.abs(o - w) < Math.abs(best - w) ? o : best), 60)

function daysOf(d: Pick<Draft, 'repeat' | 'days'>): number[] {
  if (d.repeat === 'daily') return WEEKDAYS_ALL
  if (d.repeat === 'weekdays') return WEEKDAYS_WORK
  return d.repeat === 'custom' ? d.days : []
}

/** Rounded to the next `step` minutes. */
function roundedFromNow(minutes: number, step: number): number {
  const s = step * 60_000
  return Math.ceil((Date.now() + minutes * 60_000) / s) * s
}

function draftFor(t: PowerTimer | null): Draft {
  if (t) {
    const repeat: RepeatMode = !t.days.length ? 'once' : sameDays(t.days, WEEKDAYS_ALL) ? 'daily' : sameDays(t.days, WEEKDAYS_WORK) ? 'weekdays' : 'custom'
    return {
      action: t.action,
      repeat,
      days: t.days.length ? t.days : [new Date(t.next).getDay()],
      date: t.date || dateString(t.next),
      time: t.time,
      warn: nearestWarn(t.warn),
      force: t.force,
      wake: t.wake
    }
  }
  const p = readPowerPrefs()
  const at = roundedFromNow(60, 5)
  const d = new Date(at)
  return {
    action: p.action,
    repeat: 'once',
    days: [d.getDay()],
    date: dateString(at),
    time: timeString(d.getHours(), d.getMinutes()),
    warn: nearestWarn(p.warn),
    force: p.force,
    wake: p.wake
  }
}

/** The moment the draft points at, even when it is in the past (for showing it). */
function draftMoment(d: Draft, now: number): number {
  const t = parseTime(d.time) ?? { h: 0, m: 0 }
  const day = d.repeat === 'once' ? parseDate(d.date) : null
  const base = day ? new Date(day.y, day.mo - 1, day.d) : new Date(now)
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), t.h, t.m).getTime()
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

export function PowerTimerDialog() {
  const open = useApp((s) => s.powerOpen)
  const timer = useApp((s) => s.powerTimer)
  const [draft, setDraft] = useState<Draft>(() => draftFor(null))
  const [editing, setEditing] = useState(true)
  const [caps, setCaps] = useState<PowerCaps | null>(null)
  const [busy, setBusy] = useState(false)
  const now = useNow(open)

  useEffect(() => {
    if (!open) return
    const t = get().powerTimer
    setDraft(draftFor(t))
    setEditing(!t)
    setBusy(false)
    void api.power.caps().then((c) => setCaps(c))
  }, [open])

  // Canceled or finished elsewhere while this shows it: back to setting one.
  useEffect(() => {
    if (!timer) setEditing(true)
  }, [timer])

  const update = (patch: Partial<Draft>): void => setDraft((d) => ({ ...d, ...patch }))

  const days = daysOf(draft)
  const spec: PowerTimerSpec = {
    action: draft.action,
    time: draft.time,
    date: draft.repeat === 'once' ? draft.date : '',
    days,
    warn: draft.warn,
    force: canForce(draft.action) && draft.force,
    wake: canWake(draft.action) && draft.wake
  }
  const noDays = draft.repeat !== 'once' && !days.length
  const next = noDays ? null : nextOccurrence(spec, now)
  const unavailable = (draft.action === 'hibernate' && caps?.hibernate === false) || (draft.action === 'sleep' && caps?.sleep === 'none')
  const error = unavailable
    ? `${POWER_META[draft.action].label} is turned off on this PC.`
    : noDays
      ? 'Pick at least one day.'
      : !next
        ? 'That time has passed. Pick a later one.'
        : ''
  const shortWarn = next && spec.warn > 0 ? effectiveWarn(spec, next, now) : spec.warn

  const showing = editing || !timer
  const action = showing ? draft.action : timer.action
  const color = POWER_META[action].color
  const Icon = POWER_ICON[action]

  const go = async (): Promise<void> => {
    if (error || busy) return
    setBusy(true)
    const t = await schedulePowerTimer(spec)
    setBusy(false)
    if (!t) return
    savePowerPrefs({ action: draft.action, warn: draft.warn, force: draft.force, wake: draft.wake })
    closePowerTimer()
  }

  const preview = async (): Promise<void> => {
    const res = await api.power.preview({ ...spec, date: draft.date })
    if (!res.ok) toast('error', 'Couldn’t show the warning', { message: res.error })
  }

  const cancelTimer = async (): Promise<void> => {
    closePowerTimer()
    await cancelPowerTimer()
  }

  const footer = showing ? (
    <>
      <button className="btn btn--ghost" onClick={() => void preview()} data-tip="Shows the warning window for a few seconds. Nothing happens to the PC.">
        <Eye size={14} />
        Preview warning
      </button>
      <span style={{ flex: 1 }} />
      {timer ? (
        <button className="btn btn--ghost" onClick={() => setEditing(false)}>
          Back
        </button>
      ) : (
        <button className="btn btn--ghost" onClick={closePowerTimer}>
          Cancel
        </button>
      )}
      <button className="btn pw-go" disabled={!!error || busy} onClick={() => void go()} data-tip-kbd="Ctrl+Enter">
        <Icon size={14} />
        {timer ? 'Update timer' : SCHEDULE_LABEL[draft.action]}
      </button>
    </>
  ) : (
    <>
      <button className="btn btn--danger" onClick={() => void cancelTimer()}>
        <AlarmClockOff size={14} />
        Cancel timer
      </button>
      <span style={{ flex: 1 }} />
      <button className="btn btn--ghost" onClick={closePowerTimer}>
        Close
      </button>
      <button className="btn pw-go" onClick={() => setEditing(true)} data-autofocus>
        <Pencil size={13} />
        Change
      </button>
    </>
  )

  const at = showing ? (next ?? draftMoment(draft, now)) : Math.max(timer.next, timer.warningUntil ?? 0)

  return (
    <Modal
      open={open}
      onClose={closePowerTimer}
      width={812}
      className="pw-modal"
      style={{ ['--pw-c' as string]: color, ['--pw-ink' as string]: inkOn(color) } as CSSProperties}
      icon={<AlarmClock size={18} />}
      title="Power timer"
      subtitle={showing ? 'Shut down, restart, sleep or hibernate this PC at a time you pick' : 'A timer is set'}
      footer={footer}
    >
      <div
        className="pw"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.ctrlKey && showing) {
            e.preventDefault()
            void go()
          }
        }}
      >
        <SidePanel
          label={showing ? 'It will happen' : 'Scheduled for'}
          at={at}
          now={now}
          action={action}
          repeat={repeatLabel(showing ? days : timer.days)}
          error={showing ? error : ''}
        />
        <AnimatePresence mode="wait" initial={false}>
          {showing ? (
            <motion.div key="edit" className="pw-main" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ duration: 0.18 }}>
              <Section label="Action">
                <ActionCards value={draft.action} caps={caps} onChange={(a) => update({ action: a })} />
              </Section>

              <Section
                label={draft.repeat === 'once' ? 'Day' : 'Days'}
                aside={
                  <Segmented<RepeatMode>
                    size="sm"
                    value={draft.repeat}
                    onChange={(r) =>
                      update({
                        repeat: r,
                        // Custom starts from what was showing: the day picked, or the repeating days.
                        days: r === 'custom' ? (draft.repeat === 'once' ? [new Date(draftMoment(draft, now)).getDay()] : days) : draft.days
                      })
                    }
                    options={[
                      { value: 'once', label: 'Once' },
                      { value: 'daily', label: 'Every day' },
                      { value: 'weekdays', label: 'Weekdays' },
                      { value: 'custom', label: 'Custom', icon: <Repeat size={11} /> }
                    ]}
                  />
                }
              >
                <AnimatePresence mode="wait" initial={false}>
                  {draft.repeat === 'once' ? (
                    <motion.div key="once" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
                      <DayStrip value={draft.date} now={now} onChange={(date) => update({ date })} />
                    </motion.div>
                  ) : (
                    <motion.div key="weekly" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
                      <div className="pw-weekdays" role="group" aria-label="Days">
                        {MONDAY_FIRST.map((d) => {
                          const on = days.includes(d)
                          return (
                            <button
                              key={d}
                              type="button"
                              aria-pressed={on}
                              className={`pw-wd ${on ? 'pw-wd--on' : ''}`}
                              onClick={() => update({ repeat: 'custom', days: sortDays(on ? days.filter((x) => x !== d) : [...days, d]) })}
                            >
                              {WEEKDAY_SHORT[d]}
                            </button>
                          )
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Section>

              <Section label="Time">
                <div className="pw-timerow">
                  <TimeSpinner value={draft.time} onChange={(time) => update({ time })} />
                  <div className="pw-quick">
                    {QUICK_PICKS.map(([min, label]) => (
                      <button
                        key={min}
                        type="button"
                        className="pw-quick__btn"
                        onClick={() => {
                          const ms = roundedFromNow(min, 1)
                          const d = new Date(ms)
                          update({ repeat: 'once', date: dateString(ms), time: timeString(d.getHours(), d.getMinutes()) })
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </Section>

              <div className="lw-toggles pw-options">
                <div className="lw-toggle">
                  <span className="lw-toggle__icon">
                    <BellRing size={15} />
                  </span>
                  <span className="lw-toggle__text">
                    <span className="lw-toggle__title">Warn me first</span>
                    <span className="lw-toggle__sub">{draft.warn ? 'A countdown with Cancel and +10 min shows first.' : 'It happens without asking.'}</span>
                  </span>
                  <select className="select pw-select" value={draft.warn} onChange={(e) => update({ warn: Number(e.target.value) })} aria-label="Warning">
                    {POWER_WARN_OPTIONS.map((w) => (
                      <option key={w} value={w}>
                        {w ? WARN_LABEL(w) : 'Off'}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Waking and closing apps only apply to shutting down and restarting. */}
                <AnimatePresence initial={false}>
                  {canWake(draft.action) && (
                    <motion.div key="pair" className="pw-option" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
                      <div className="pw-pair">
                        <div className="lw-toggle" data-tip="Wakes the PC from sleep to do it on time. It can't start a PC that is off.">
                          <span className="lw-toggle__icon">
                            <Sunrise size={15} />
                          </span>
                          <span className="lw-toggle__text">
                            <span className="lw-toggle__title">Wake the PC</span>
                            <span className="lw-toggle__sub">If it’s asleep then.</span>
                          </span>
                          <Switch checked={draft.wake} onChange={(wake) => update({ wake })} label="Wake the PC" />
                        </div>
                        {canForce(draft.action) && (
                          <div className="lw-toggle" data-tip="Without this, an app with unsaved work can stop it by asking to save.">
                            <span className="lw-toggle__icon">
                              <ShieldAlert size={15} />
                            </span>
                            <span className="lw-toggle__text">
                              <span className="lw-toggle__title">Close blocking apps</span>
                              <span className="lw-toggle__sub">{draft.force ? 'Unsaved work is lost.' : 'Apps can stop it.'}</span>
                            </span>
                            <Switch checked={draft.force} onChange={(force) => update({ force })} label="Close blocking apps" />
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <AnimatePresence initial={false}>
                {!error && shortWarn < spec.warn && (
                  <motion.div key="short" className="pw-note" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                    <Info size={13} />
                    {shortWarn ? `It’s close, so the warning is shortened to ${shortWarn} seconds.` : 'It’s too close for a warning: it happens right on time.'}
                  </motion.div>
                )}
                {timer && (
                  <motion.div key="replace" className="pw-note" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                    <CalendarClock size={13} />
                    Replaces the current timer ({POWER_META[timer.action].label.toLowerCase()} {whenPhrase(timer.next, now)}).
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div key="status" className="pw-main" initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 14 }} transition={{ duration: 0.18 }}>
              <TimerStatus timer={timer} now={now} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  )
}

function Section({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="pw-section">
      <div className="pw-section__head">
        <span className="pw-label">{label}</span>
        {aside}
      </div>
      {children}
    </section>
  )
}

// ===================================================================== the summary on the left

function SidePanel({ label, at, now, action, repeat, error }: { label: string; at: number; now: number; action: PowerAction; repeat: string; error: string }) {
  const Icon = POWER_ICON[action]
  const n = daysFromToday(at, now)
  const date = new Date(at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const time = clockTime(at)
  return (
    <aside className="pw-side">
      <span className="pw-label">{label}</span>
      <ClockFace at={at} now={now} />
      <div className="pw-side__time">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={time} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={SPRING}>
            {time}
          </motion.span>
        </AnimatePresence>
      </div>
      <div className="pw-side__day">{n === 0 || n === 1 ? `${dayLabel(at, now)} · ${date}` : date}</div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={error ? 'error' : 'until'}
          className={`pw-side__until ${error ? 'pw-side__until--bad' : ''}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          {error ? (
            <>
              <TriangleAlert size={12} />
              {error}
            </>
          ) : (
            `in ${untilLabel(at - now)}`
          )}
        </motion.div>
      </AnimatePresence>
      <div className="pw-side__chips">
        <span className="pw-chip pw-chip--action">
          <Icon size={12} />
          {POWER_META[action].label}
        </span>
        {repeat && (
          <span className="pw-chip">
            <Repeat size={11} />
            {repeat}
          </span>
        )}
      </div>
    </aside>
  )
}

/** Keeps a hand turning the short way round when its angle wraps past 12. */
function useTurning(angle: number): number {
  const last = useRef<number | null>(null)
  if (last.current === null) last.current = angle
  else last.current += wrap(angle - last.current + 180, 360) - 180
  return last.current
}

/** A clock with hands at the chosen time, and an arc from now to then (when it's within 12 hours). */
function ClockFace({ at, now }: { at: number; now: number }) {
  const t = new Date(at)
  const n = new Date(now)
  const hour = useTurning((t.getHours() % 12) * 30 + t.getMinutes() * 0.5)
  const minute = useTurning(t.getMinutes() * 6)
  const nowAngle = (n.getHours() % 12) * 30 + n.getMinutes() * 0.5 + n.getSeconds() / 120
  const frac = Math.max(0, Math.min(1, (at - now) / 43_200_000))
  return (
    <svg className="pw-clock" viewBox="0 0 120 120" aria-hidden>
      <circle className="pw-clock__glow" cx="60" cy="60" r="44" />
      <circle className="pw-clock__face" cx="60" cy="60" r="49" />
      <circle className="pw-clock__track" cx="60" cy="60" r="56" />
      <circle
        className="pw-clock__arc"
        cx="60"
        cy="60"
        r="56"
        pathLength={100}
        strokeDasharray={`${(frac * 100).toFixed(2)} 100`}
        transform={`rotate(${nowAngle - 90} 60 60)`}
        style={{ opacity: frac > 0.002 ? 1 : 0 }}
      />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} className={`pw-clock__tick ${i % 3 === 0 ? 'pw-clock__tick--major' : ''}`} x1="60" y1={i % 3 === 0 ? 15 : 16.5} x2="60" y2="20" transform={`rotate(${i * 30} 60 60)`} />
      ))}
      <g className="pw-clock__hand pw-clock__hand--hour" style={{ transform: `rotate(${hour}deg)` }}>
        <line x1="60" y1="64" x2="60" y2="37" />
      </g>
      <g className="pw-clock__hand pw-clock__hand--minute" style={{ transform: `rotate(${minute}deg)` }}>
        <line x1="60" y1="66" x2="60" y2="25" />
      </g>
      <circle className="pw-clock__pin" cx="60" cy="60" r="3.2" />
    </svg>
  )
}

// ===================================================================== action, day and time pickers

function ActionCards({ value, caps, onChange }: { value: PowerAction; caps: PowerCaps | null; onChange: (a: PowerAction) => void }) {
  return (
    <div className="pw-actions" role="radiogroup" aria-label="Action">
      {POWER_ACTIONS.map((a) => {
        const Icon = POWER_ICON[a]
        const off = (a === 'hibernate' && caps?.hibernate === false) || (a === 'sleep' && caps?.sleep === 'none')
        const on = value === a
        const hint = off ? 'Turned off on this PC' : a === 'sleep' && caps?.sleep === 'modern' ? 'Screen off, apps stay open' : ACTION_HINT[a]
        return (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={off}
            className={`pw-act ${on ? 'pw-act--on' : ''}`}
            style={{ ['--pw-a' as string]: POWER_META[a].color, ['--pw-a-ink' as string]: inkOn(POWER_META[a].color) }}
            onClick={() => onChange(a)}
            data-autofocus={on ? true : undefined}
            data-tip={a === 'sleep' && caps?.sleep === 'modern' ? 'This PC uses Modern Standby: turning the screen off puts it to sleep.' : undefined}
          >
            {on && <motion.span layoutId="pw-act-hl" className="pw-act__hl" transition={SPRING} />}
            <motion.span className="pw-act__icon" animate={on ? { scale: [1, 1.18, 1], rotate: a === 'restart' ? [0, 200, 360] : 0 } : { scale: 1 }} transition={{ duration: 0.45 }}>
              <Icon size={16} />
            </motion.span>
            <span className="pw-act__label">{POWER_META[a].label}</span>
            <span className="pw-act__hint">{hint}</span>
          </button>
        )
      })}
    </div>
  )
}

function DayStrip({ value, now, onChange }: { value: string; now: number; onChange: (date: string) => void }) {
  const picker = useRef<HTMLInputElement>(null)
  const today = new Date(now)
  const days = Array.from({ length: 7 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i))
  const keys = days.map((d) => dateString(d.getTime()))
  const inStrip = keys.includes(value)
  const picked = parseDate(value)
  const pickedDate = picked ? new Date(picked.y, picked.mo - 1, picked.d) : null
  return (
    <div className="pw-days">
      {days.map((d, i) => {
        const on = keys[i] === value
        return (
          <button key={keys[i]} type="button" className={`pw-day ${on ? 'pw-day--on' : ''}`} onClick={() => onChange(keys[i])} aria-pressed={on} data-tip={i === 1 ? 'Tomorrow' : undefined}>
            {on && <motion.span layoutId="pw-day-hl" className="pw-day__hl" transition={SPRING} />}
            <span className="pw-day__wd">{i === 0 ? 'Today' : WEEKDAY_SHORT[d.getDay()]}</span>
            <span className="pw-day__num">{d.getDate()}</span>
          </button>
        )
      })}
      <button
        type="button"
        className={`pw-day pw-day--pick ${!inStrip ? 'pw-day--on' : ''}`}
        onClick={() => {
          try {
            picker.current?.showPicker()
          } catch {
            picker.current?.focus()
          }
        }}
        data-tip="Pick another date"
      >
        {!inStrip && <motion.span layoutId="pw-day-hl" className="pw-day__hl" transition={SPRING} />}
        {!inStrip && pickedDate ? (
          <>
            <span className="pw-day__wd">{pickedDate.toLocaleDateString(undefined, { month: 'short' })}</span>
            <span className="pw-day__num">{pickedDate.getDate()}</span>
          </>
        ) : (
          <>
            <CalendarDays size={15} />
            <span className="pw-day__wd">More</span>
          </>
        )}
        <input
          ref={picker}
          type="date"
          className="pw-day__input"
          min={keys[0]}
          value={value}
          tabIndex={-1}
          aria-label="Date"
          onChange={(e) => {
            if (parseDate(e.target.value)) onChange(e.target.value)
          }}
        />
      </button>
    </div>
  )
}

type Typed = 'keep' | 'done' | 'reject'

/** A big HH:MM picker: arrows, the mouse wheel, the buttons, or typing digits. */
function TimeSpinner({ value, onChange }: { value: string; onChange: (time: string) => void }) {
  const t = parseTime(value) ?? { h: 0, m: 0 }
  const minutes = useRef<HTMLDivElement>(null)
  const pm = t.h >= 12
  const setTime = (h: number, m: number): void => onChange(timeString(wrap(h, 24), wrap(m, 60)))

  const typeHour = (digits: string): Typed => {
    const n = Number(digits)
    if (uses12h) {
      if (digits.length === 1) {
        if (n === 0) return 'keep'
        setTime((n % 12) + (pm ? 12 : 0), t.m)
        return n === 1 ? 'keep' : 'done'
      }
      if (n < 1 || n > 12) return 'reject'
      setTime((n % 12) + (pm ? 12 : 0), t.m)
      return 'done'
    }
    if (digits.length === 1) {
      setTime(n, t.m)
      return n <= 2 ? 'keep' : 'done'
    }
    if (n > 23) return 'reject'
    setTime(n, t.m)
    return 'done'
  }

  const typeMinute = (digits: string): Typed => {
    const n = Number(digits)
    if (digits.length === 1) {
      setTime(t.h, n)
      return n <= 5 ? 'keep' : 'done'
    }
    if (n > 59) return 'reject'
    setTime(t.h, n)
    return 'done'
  }

  return (
    <div className="pw-time">
      <Spin
        label="Hours"
        display={uses12h ? String(t.h % 12 || 12) : String(t.h).padStart(2, '0')}
        onStep={(d) => setTime(t.h + d, t.m)}
        onType={typeHour}
        onDone={() => minutes.current?.focus()}
      />
      <span className="pw-time__colon">:</span>
      <Spin label="Minutes" ref={minutes} display={String(t.m).padStart(2, '0')} onStep={(d, big) => setTime(t.h, t.m + d * (big ? 5 : 1))} onType={typeMinute} />
      {uses12h && (
        <div className="pw-ampm" role="radiogroup" aria-label="AM or PM">
          {(['AM', 'PM'] as const).map((p) => {
            const on = (p === 'PM') === pm
            return (
              <button key={p} type="button" role="radio" aria-checked={on} className={`pw-ampm__opt ${on ? 'pw-ampm__opt--on' : ''}`} onClick={() => !on && setTime(t.h + 12, t.m)}>
                {on && <motion.span layoutId="pw-ampm-hl" className="pw-ampm__hl" transition={SPRING} />}
                <span>{p}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Spin({
  label,
  display,
  onStep,
  onType,
  onDone,
  ref
}: {
  label: string
  display: string
  onStep: (dir: 1 | -1, big: boolean) => void
  onType: (digits: string) => Typed
  onDone?: () => void
  ref?: Ref<HTMLDivElement>
}) {
  const box = useRef<HTMLDivElement | null>(null)
  const dir = useRef<1 | -1>(1)
  const typed = useRef({ digits: '', at: 0 })
  const step = (d: 1 | -1, big = false): void => {
    dir.current = d
    onStep(d, big)
  }
  const stepRef = useRef(step)
  stepRef.current = step

  // The wheel turns the digits without scrolling the dialog (React's wheel listener can't prevent that).
  useEffect(() => {
    const el = box.current
    if (!el) return
    let acc = 0
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      acc += e.deltaY
      if (Math.abs(acc) < 40) return
      stepRef.current(acc < 0 ? 1 : -1)
      acc = 0
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div
      ref={(el) => {
        box.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) ref.current = el
      }}
      className="pw-spin"
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuetext={display}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          step(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey)
        } else if (e.key === 'PageUp' || e.key === 'PageDown') {
          e.preventDefault()
          step(e.key === 'PageUp' ? 1 : -1, true)
        } else if (/^\d$/.test(e.key) && !e.ctrlKey && !e.altKey) {
          e.preventDefault()
          const now = Date.now()
          const prev = now - typed.current.at < 1500 ? typed.current.digits : ''
          dir.current = 1
          let res = onType(prev + e.key)
          let digits = prev + e.key
          // A digit that doesn't continue the number starts a new one.
          if (res === 'reject') {
            digits = e.key
            res = onType(digits)
          }
          typed.current = { digits: res === 'keep' ? digits : '', at: now }
          if (res === 'done') onDone?.()
        }
      }}
      onBlur={() => (typed.current = { digits: '', at: 0 })}
    >
      <button type="button" tabIndex={-1} className="pw-spin__btn" onClick={() => step(1)} aria-label={`${label} up`}>
        <ChevronUp size={15} />
      </button>
      <div className="pw-spin__value">
        <AnimatePresence mode="popLayout" initial={false} custom={dir.current}>
          <motion.span
            key={display}
            className="pw-spin__num"
            custom={dir.current}
            variants={{
              enter: (d: number) => ({ y: d > 0 ? '60%' : '-60%', opacity: 0 }),
              center: { y: '0%', opacity: 1 },
              exit: (d: number) => ({ y: d > 0 ? '-60%' : '60%', opacity: 0 })
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={SPRING}
          >
            {display}
          </motion.span>
        </AnimatePresence>
      </div>
      <button type="button" tabIndex={-1} className="pw-spin__btn" onClick={() => step(-1)} aria-label={`${label} down`}>
        <ChevronDown size={15} />
      </button>
    </div>
  )
}

// ===================================================================== a timer that is set

function TimerStatus({ timer, now }: { timer: PowerTimer; now: number }) {
  const meta = POWER_META[timer.action]
  const Icon = POWER_ICON[timer.action]
  const postponed = !!timer.warningUntil && timer.warningUntil > timer.next + 1000
  const at = postponed ? timer.warningUntil! : timer.next
  const warning = !!timer.warningUntil && now >= timer.next - timer.warn * 1000
  const repeat = repeatLabel(timer.days)
  return (
    <div className="pw-status">
      <div className="pw-status__head">
        <span className="pw-status__icon">
          <Icon size={20} />
        </span>
        <div>
          <div className="pw-status__title">
            {meta.label} {whenPhrase(at, now)}
          </div>
          <div className="pw-status__sub">{repeat || 'Once'}</div>
        </div>
      </div>

      <div className="pw-status__count">
        <span className="pw-status__clock">{countdownClock(at - now)}</span>
        <span className="pw-status__until">until it {meta.done}</span>
      </div>

      <AnimatePresence initial={false}>
        {(postponed || warning) && (
          <motion.div key="live" className="pw-note pw-note--live" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <span className="pw-live-dot" />
            {postponed ? `Postponed to ${clockTime(at)} from the warning window.` : 'The warning is on screen now.'}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="lw-toggles">
        {timer.engine === 'task' ? (
          <StatusRow icon={<CalendarClock size={15} />} title="Set in Windows" sub="Happens even when Pro Terminal is closed." />
        ) : (
          <StatusRow
            icon={<TriangleAlert size={15} />}
            title="Keep Pro Terminal open"
            sub={`Windows didn’t accept the scheduled task${timer.engineNote ? ` (${timer.engineNote})` : ''}, so Pro Terminal does it itself.`}
            warn
          />
        )}
        <StatusRow
          icon={<BellRing size={15} />}
          title={timer.warn ? `${WARN_LABEL(timer.warn)} warning` : 'No warning'}
          sub={timer.warn ? (timer.days.length ? 'With Skip this time and +10 min.' : 'With Cancel and +10 min.') : 'It happens without asking.'}
        />
        {canWake(timer.action) && (
          <StatusRow icon={<Sunrise size={15} />} title={timer.wake ? 'Wakes the PC' : 'Doesn’t wake the PC'} sub={timer.wake ? 'If it’s asleep at that time.' : 'If it’s asleep then, it doesn’t happen.'} />
        )}
        {canForce(timer.action) && (
          <StatusRow
            icon={<ShieldAlert size={15} />}
            title={timer.force ? 'Closes apps that block it' : 'Lets apps stop it'}
            sub={timer.force ? 'Unsaved work in open apps is lost.' : 'An app with unsaved work can stop it.'}
          />
        )}
      </div>
    </div>
  )
}

function StatusRow({ icon, title, sub, warn }: { icon: ReactNode; title: string; sub: string; warn?: boolean }) {
  return (
    <div className={`lw-toggle ${warn ? 'pw-row--warn' : ''}`}>
      <span className="lw-toggle__icon">{icon}</span>
      <span className="lw-toggle__text">
        <span className="lw-toggle__title">{title}</span>
        <span className="lw-toggle__sub">{sub}</span>
      </span>
    </div>
  )
}
