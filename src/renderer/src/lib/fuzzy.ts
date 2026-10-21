/**
 * Small fuzzy matcher: every query character must appear in order. Consecutive matches,
 * word starts and early matches score higher. Returns matched indices for highlighting.
 */
export function fuzzyMatch(query: string, text: string): { score: number; indices: number[] } | null {
  const q = query.trim().toLowerCase()
  if (!q) return { score: 0, indices: [] }
  const t = text.toLowerCase()

  // Fast path: plain substring wins big.
  const sub = t.indexOf(q)
  if (sub >= 0) {
    const indices = Array.from({ length: q.length }, (_, i) => sub + i)
    const wordStart = sub === 0 || /[\s\\/._-]/.test(t[sub - 1])
    return { score: 1000 - sub + (wordStart ? 200 : 0) + q.length * 10, indices }
  }

  let score = 0
  let ti = 0
  let prev = -2
  const indices: number[] = []
  for (const ch of q) {
    if (ch === ' ') continue
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    indices.push(found)
    if (found === prev + 1) score += 15
    if (found === 0 || /[\s\\/._-]/.test(t[found - 1])) score += 10
    score -= Math.min(found - ti, 10)
    prev = found
    ti = found + 1
  }
  return { score, indices }
}
