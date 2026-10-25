import type { PowerAction, PowerTimerSpec } from './types'

// The power timer: shut down, restart, sleep or hibernate the PC at a time the user picks, once or on
// chosen weekdays. Shared by the main process (which schedules it) and the dialog (which previews it),
// so both always agree on when it happens.

export const POWER_ACTIONS: PowerAction[] = ['shutdown', 'restart', 'sleep', 'hibernate']

export const POWER_META: Record<PowerAction, { label: string; doing: string; done: string; color: string }> = {
  shutdown: { label: 'Shut down', doing: 'Shutting down', done: 'shuts down', color: '#f43f5e' },
  restart: { label: 'Restart', doing: 'Restarting', done: 'restarts', color: '#fb923c' },
  sleep: { label: 'Sleep', doing: 'Going to sleep', done: 'goes to sleep', color: '#8b7bff' },
  hibernate: { label: 'Hibernate', doing: 'Hibernating', done: 'hibernates', color: '#22d3ee' }
}

/** Warning window lengths offered, in seconds (0 = no warning). */
export const POWER_WARN_OPTIONS = [0, 30, 60, 120, 300]

/** The earliest a timer may start its warning, so there is time to register it with Windows. */
export const POWER_MIN_LEAD_MS = 15_000

/** The built-in snippet that opens the power timer, added once to every library. */
export const POWER_TIMER_SNIPPET = {
  pack: 'system-tools-1',
  name: 'Power timer',
  description: 'Shut down, restart, sleep or hibernate this PC at a date and time you pick, once or every week.',
  group: 'System',
  // Only typed by versions that don't know the tool: a harmless PowerShell comment.
  command: '# Power timer: open it from the Snippets panel of a newer Pro Terminal.'
} as const

export const WEEKDAYS_ALL = [0, 1, 2, 3, 4, 5, 6]
export const WEEKDAYS_WORK = [1, 2, 3, 4, 5]
export const WEEKDAYS_WEEKEND = [0, 6]

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseTime(t: string): { h: number; m: number } | null {
  const m = TIME_RE.exec(t)
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null
}

export function parseDate(d: string): { y: number; mo: number; d: number } | null {
  const m = DATE_RE.exec(d)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const day = Number(m[3])
  const check = new Date(y, mo - 1, day)
  return check.getFullYear() === y && check.getMonth() === mo - 1 && check.getDate() === day ? { y, mo, d: day } : null
}

const pad = (n: number): string => String(n).padStart(2, '0')

export const timeString = (h: number, m: number): string => `${pad(h)}:${pad(m)}`

/** 'YYYY-MM-DD' of a moment, in local time. */
export const dateString = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 'YYYY-MM-DDTHH:MM:SS' in local time, the way Task Scheduler reads a trigger without a time zone. */
export const localIso = (ms: number): string => {
  const d = new Date(ms)
  return `${dateString(ms)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Distinct, sorted weekdays (0–6). */
export const normDays = (v: unknown): number[] =>
  Array.isArray(v) ? [...new Set(v.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b) : []

/**
 * When the timer happens next, after `now`. A repeating timer skips an occurrence whose warning would
 * have to start in the past (or too soon to register), so the warning always gets its full length.
 * Returns null for a one-off time that is not far enough ahead.
 */
export function nextOccurrence(spec: Pick<PowerTimerSpec, 'time' | 'date' | 'days' | 'warn'>, now: number): number | null {
  const t = parseTime(spec.time)
  if (!t) return null
  if (!spec.days.length) {
    const d = parseDate(spec.date)
    if (!d) return null
    const at = new Date(d.y, d.mo - 1, d.d, t.h, t.m, 0, 0).getTime()
    return at > now + POWER_MIN_LEAD_MS ? at : null
  }
  const base = new Date(now)
  const earliest = now + POWER_MIN_LEAD_MS + spec.warn * 1000
  for (let i = 0; i < 15; i++) {
    const c = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, t.h, t.m, 0, 0)
    if (c.getTime() > earliest && spec.days.includes(c.getDay())) return c.getTime()
  }
  return null
}

/**
 * The warning a one-off timer can still give: shortened when it happens sooner than the warning lasts.
 * Below 10 seconds it is dropped. Repeating timers always get their full warning (see nextOccurrence).
 */
export function effectiveWarn(spec: Pick<PowerTimerSpec, 'warn' | 'days'>, next: number, now: number): number {
  if (spec.days.length) return spec.warn
  const room = Math.floor((next - now - POWER_MIN_LEAD_MS) / 1000)
  const warn = Math.max(0, Math.min(spec.warn, room))
  return warn < 10 ? 0 : warn
}

/** Whether waking the PC applies: only shutting down and restarting are worth waking it for. */
export const canWake = (action: PowerAction): boolean => action === 'shutdown' || action === 'restart'
/** Whether closing blocking apps applies (sleep and hibernate keep every app as it is). */
export const canForce = canWake
