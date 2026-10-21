import { randomUUID } from 'node:crypto'

export const newId = (): string => randomUUID()

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export const str = (v: unknown, fallback = '', max = 4096): string =>
  typeof v === 'string' ? v.slice(0, max) : fallback

export const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

export const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)

export function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback
}

export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** A list of distinct, trimmed snippet group names. */
export function groupNames(v: unknown, maxLength: number, maxCount: number): string[] {
  const out = new Set<string>()
  for (const x of arr(v)) {
    const name = str(x, '', maxLength).trim()
    if (name) out.add(name)
    if (out.size >= maxCount) break
  }
  return [...out]
}

/** Strip ANSI/VT escape sequences, leaving printable text. */
export function stripAnsi(input: string): string {
  return (
    input
      // OSC ... BEL / ST
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      // DCS / SOS / PM / APC ... ST
      .replace(/\x1b[P^_X][\s\S]*?\x1b\\/g, '')
      // CSI
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      // two-char escapes
      .replace(/\x1b[@-Z\\-_]/g, '')
      .replace(/\x1b[()][0-9A-Za-z]/g, '')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
  )
}

/** Case-insensitive path key on Windows. */
export const pathKey = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()
