import type { PowerAction, PowerTimer, PowerTimerSpec } from '@shared/types'
import { POWER_META, WEEKDAYS_ALL, WEEKDAYS_WEEKEND, WEEKDAYS_WORK } from '@shared/power'
import { api } from '@/api'
import { get, set } from '@/store/app'
import { focusActive, toast } from './actions'

// ===================================================================== opening and changing the timer

export function openPowerTimer(): void {
  set({ powerOpen: true })
}

export function closePowerTimer(): void {
  set({ powerOpen: false })
  focusActive()
}

/** Schedules the timer (replacing the current one) and says when it will happen. */
export async function schedulePowerTimer(spec: PowerTimerSpec): Promise<PowerTimer | null> {
  const res = await api.power.schedule(spec)
  if (!res.ok) {
    toast('error', 'Couldn’t set the power timer', { message: res.error })
    return null
  }
  const t = res.timer
  const repeat = repeatLabel(t.days)
  if (t.engine === 'app') {
    toast('warning', `${POWER_META[t.action].label} ${whenPhrase(t.next)}`, {
      message: `Windows didn’t accept the scheduled task, so Pro Terminal does it instead: keep it open until then.${t.engineNote ? `\n${t.engineNote}` : ''}`,
      duration: 9000
    })
  } else {
    toast('success', `${POWER_META[t.action].label} ${whenPhrase(t.next)}`, {
      message: repeat ? `${repeat}, even when Pro Terminal is closed.` : 'Happens even when Pro Terminal is closed.'
    })
  }
  return t
}

export async function cancelPowerTimer(): Promise<void> {
  const t = get().powerTimer
  if (!t) return
  await api.power.cancel()
  toast('info', 'Power timer canceled', {
    message: `${POWER_META[t.action].label} ${whenPhrase(t.next)} won’t happen.`,
    actions: [{ label: 'Undo', run: () => void schedulePowerTimer(specOf(t)) }]
  })
}

export const specOf = (t: PowerTimerSpec): PowerTimerSpec => ({
  action: t.action,
  time: t.time,
  date: t.date,
  days: t.days,
  warn: t.warn,
  force: t.force,
  wake: t.wake
})

// ===================================================================== remembered choices

const LAST_KEY = 'pt.powerTimer'

export type PowerPrefs = Pick<PowerTimerSpec, 'action' | 'warn' | 'force' | 'wake'>

/** What the user picked last time (a per-machine convenience; falls back to defaults). */
export function readPowerPrefs(): PowerPrefs {
  const fallback: PowerPrefs = { action: 'shutdown', warn: 60, force: false, wake: true }
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as Partial<PowerPrefs> | null
    if (!v) return fallback
    return {
      action: v.action && v.action in POWER_META ? v.action : fallback.action,
      warn: typeof v.warn === 'number' ? v.warn : fallback.warn,
      force: v.force === true,
      wake: v.wake !== false
    }
  } catch {
    return fallback
  }
}

export function savePowerPrefs(p: PowerPrefs): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(p))
  } catch {
    /* private storage unavailable */
  }
}

// ===================================================================== wording

const DAY_MS = 86_400_000

const startOfDay = (ms: number): number => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Whole calendar days from today to `ms` (0 = today). */
export const daysFromToday = (ms: number, now = Date.now()): number => Math.round((startOfDay(ms) - startOfDay(now)) / DAY_MS)

/** Whether this locale writes times with AM/PM. */
export const uses12h = (() => {
  try {
    const hc = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle
    return hc === 'h11' || hc === 'h12'
  } catch {
    return false
  }
})()

export const clockTime = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** "Today", "Tomorrow", or "Fri, Oct 31". */
export function dayLabel(ms: number, now = Date.now()): string {
  const n = daysFromToday(ms, now)
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

/** "today at 11:00 PM", "tomorrow at 7:30 AM", "on Fri, Oct 31 at 11:00 PM". */
export function whenPhrase(ms: number, now = Date.now()): string {
  const n = daysFromToday(ms, now)
  const day = n === 0 ? 'today' : n === 1 ? 'tomorrow' : `on ${dayLabel(ms, now)}`
  return `${day} at ${clockTime(ms)}`
}

/** Short weekday names, Sunday first (indexes match Date.getDay()). */
export const WEEKDAY_SHORT = WEEKDAYS_ALL.map((d) => new Date(2024, 0, 7 + d).toLocaleDateString(undefined, { weekday: 'short' }))
export const WEEKDAY_NARROW = WEEKDAYS_ALL.map((d) => new Date(2024, 0, 7 + d).toLocaleDateString(undefined, { weekday: 'narrow' }))

const sameDays = (a: number[], b: number[]): boolean => a.length === b.length && a.every((d, i) => d === b[i])

/** "Every day", "Weekdays", "Weekends", "Mon, Wed, Fri", or '' for a one-off timer. */
export function repeatLabel(days: number[]): string {
  if (!days.length) return ''
  if (sameDays(days, WEEKDAYS_ALL)) return 'Every day'
  if (sameDays(days, WEEKDAYS_WORK)) return 'Every weekday'
  if (sameDays(days, WEEKDAYS_WEEKEND)) return 'Every weekend'
  // Monday first reads more naturally in a list.
  return `Every ${[...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAY_SHORT[d]).join(', ')}`
}

/** "2 h 14 min", "5 min 03 s", "42 s". */
export function untilLabel(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d) return `${d} d ${h} h`
  if (h) return `${h} h ${m} min`
  if (m) return `${m} min ${String(sec).padStart(2, '0')} s`
  return `${sec} s`
}

/** A ticking clock for the status bar: "1:02:33", "4:05", or "2 d 3 h" when it's days away. */
export function countdownClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  if (s >= 86400) return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export const WARN_LABEL = (s: number): string => (s === 0 ? 'No warning' : s < 60 ? `${s} seconds` : s === 60 ? '1 minute' : `${s / 60} minutes`)

/** Text color that stays readable on a solid fill of `hex` (light fills such as cyan get dark text). */
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const lum = ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114
  return lum > 160 ? '#0b0e14' : '#ffffff'
}

export const ACTION_HINT: Record<PowerAction, string> = {
  shutdown: 'Turn the PC off',
  restart: 'Turn off and on again',
  sleep: 'Low power, apps stay open',
  hibernate: 'Save to disk, power off'
}
