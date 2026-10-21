import type { GroupStartState, Settings, Snippet } from '@shared/types'
// Snippet placeholders: {{name}} or {{name:default value}}.
// Built-ins filled automatically: {{cwd}}, {{clipboard}}, {{date}}, {{time}}, {{selection}}.

export interface SnippetVar {
  name: string
  defaultValue: string
}

const VAR_RE = /\{\{\s*([A-Za-z_][\w.-]{0,40})\s*(?::([^}]*))?\}\}/g

export const BUILTIN_VARS = ['cwd', 'clipboard', 'date', 'time', 'selection'] as const
type Builtin = (typeof BUILTIN_VARS)[number]

const isBuiltin = (n: string): n is Builtin => (BUILTIN_VARS as readonly string[]).includes(n.toLowerCase())

/** Variables the user must fill in (built-ins excluded), in order of first appearance. */
export function snippetVariables(command: string): SnippetVar[] {
  const seen = new Map<string, SnippetVar>()
  for (const m of command.matchAll(VAR_RE)) {
    const name = m[1]
    if (isBuiltin(name) || seen.has(name)) continue
    seen.set(name, { name, defaultValue: (m[2] ?? '').trim() })
  }
  return [...seen.values()]
}

export function usesBuiltin(command: string, name: Builtin): boolean {
  for (const m of command.matchAll(VAR_RE)) if (m[1].toLowerCase() === name) return true
  return false
}

export function expandSnippet(command: string, values: Record<string, string>, builtins: Partial<Record<Builtin, string>>): string {
  return command.replace(VAR_RE, (_all, rawName: string, def?: string) => {
    const lower = rawName.toLowerCase()
    if (isBuiltin(lower)) {
      const now = new Date()
      if (lower === 'date') return now.toISOString().slice(0, 10)
      if (lower === 'time') return now.toTimeString().slice(0, 8)
      return builtins[lower] ?? ''
    }
    return values[rawName] ?? (def ?? '').trim()
  })
}

/** Split a command for display, marking placeholders so they can be highlighted. */
export function tokenizeSnippet(command: string): { text: string; variable?: boolean }[] {
  const out: { text: string; variable?: boolean }[] = []
  let last = 0
  for (const m of command.matchAll(VAR_RE)) {
    if (m.index! > last) out.push({ text: command.slice(last, m.index) })
    out.push({ text: m[0], variable: true })
    last = m.index! + m[0].length
  }
  if (last < command.length) out.push({ text: command.slice(last) })
  return out
}

// ---- groups ----

/** The group a snippet is shown under. */
export const snippetGroupOf = (s: Pick<Snippet, 'group'>): string => s.group || 'General'

/**
 * Snippets grouped by name. Groups the user arranged come first, in that order;
 * the rest follow in order of first appearance. Snippet order inside a group is kept.
 */
export function groupSnippets(snippets: Snippet[], order: string[]): [string, Snippet[]][] {
  const map = new Map<string, Snippet[]>()
  for (const s of snippets) {
    const g = snippetGroupOf(s)
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(s)
  }
  const rank = new Map(order.map((g, i) => [g, i]))
  const seen = [...map.keys()]
  return seen
    .map((g, i) => ({ g, key: rank.get(g) ?? order.length + i }))
    .sort((a, b) => a.key - b.key)
    .map(({ g }) => [g, map.get(g)!])
}

/** The start state that applies to a group: its own choice, or the default. */
export function groupStartState(name: string, settings: Pick<Settings, 'snippetGroupDefault' | 'snippetGroupStates'>): GroupStartState {
  return settings.snippetGroupStates[name] ?? settings.snippetGroupDefault
}

/** Whether a group starts open, given its start state and what was remembered. */
export function groupStartsOpen(name: string, settings: Pick<Settings, 'snippetGroupDefault' | 'snippetGroupStates'>, collapsed: string[]): boolean {
  const state = groupStartState(name, settings)
  return state === 'remember' ? !collapsed.includes(name) : state === 'expanded'
}

export const EXAMPLE_SNIPPETS = [
  { name: 'Network configuration', command: 'ipconfig /all', shell: 'any', mode: 'run', group: 'System', description: 'Show adapters, IPs and DNS servers' },
  { name: 'Flush DNS cache', command: 'ipconfig /flushdns', shell: 'any', mode: 'run', group: 'System' },
  { name: 'Who is using a port', command: 'netstat -ano | findstr :{{port:3000}}', shell: 'any', mode: 'run', group: 'System', description: 'Find the process listening on a port' },
  { name: 'Largest files here', command: 'Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue | Sort-Object Length -Descending | Select-Object -First 15 FullName, @{n="MB";e={[math]::Round($_.Length/1MB,1)}}', shell: 'powershell', mode: 'run', group: 'Files' },
  { name: 'Open this folder in Explorer', command: 'explorer .', shell: 'any', mode: 'run', group: 'Files' },
  { name: 'Git: new branch', command: 'git checkout -b {{branch}}', shell: 'any', mode: 'run', group: 'Git', description: 'Create and switch to a new branch' },
  { name: 'Git: pretty log', command: 'git log --oneline --graph --decorate -20', shell: 'any', mode: 'run', group: 'Git' },
  { name: 'Git: commit all', command: 'git add -A && git commit -m "{{message}}"', shell: 'cmd', mode: 'insert', group: 'Git', description: 'Typed into the prompt so you can review before pressing Enter' }
] as const
