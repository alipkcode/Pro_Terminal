export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d > 300 ? 'numeric' : undefined })
}

export function duration(ms: number): string {
  if (!(ms >= 0)) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** Clock-style elapsed time for running commands (0:07, 1:02:33). */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function dateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Split a Windows path into clickable breadcrumb segments with their full paths. */
export function pathSegments(p: string): { label: string; path: string }[] {
  if (!p) return []
  const norm = p.replace(/\//g, '\\').replace(/\\+$/, '')
  const parts = norm.split('\\').filter(Boolean)
  const out: { label: string; path: string }[] = []
  let acc = norm.startsWith('\\\\') ? '\\\\' : ''
  parts.forEach((part, i) => {
    acc = i === 0 ? acc + part : `${acc}\\${part}`
    out.push({ label: part, path: i === 0 && /^[a-z]:$/i.test(part) ? `${part}\\` : acc })
  })
  return out
}

export function folderName(p: string): string {
  const segs = pathSegments(p)
  return segs.length ? segs[segs.length - 1].label : p
}

/** Shorten a path for display: C:\Users\me\…\project\src */
export function shortPath(p: string, max = 42): string {
  if (!p || p.length <= max) return p
  const home = /^[a-z]:\\users\\[^\\]+/i.exec(p)
  let s = home ? '~' + p.slice(home[0].length) : p
  if (s.length <= max) return s
  const segs = s.split('\\')
  while (segs.length > 3 && segs.join('\\').length > max - 2) segs.splice(1, 1)
  s = segs.length > 2 ? [segs[0], '…', ...segs.slice(1)].join('\\') : s
  return s.length > max ? '…' + s.slice(s.length - max + 1) : s
}

export const samePath = (a: string, b: string): boolean =>
  !!a && !!b && a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()

export function dayGroup(ts: number, now = new Date()): string {
  const d = new Date(ts)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= startOfToday) return 'Today'
  if (ts >= startOfToday - 86_400_000) return 'Yesterday'
  if (ts >= startOfToday - 6 * 86_400_000) return 'This week'
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { month: 'long' })
  return String(d.getFullYear())
}
