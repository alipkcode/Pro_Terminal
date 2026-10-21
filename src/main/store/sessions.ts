import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { LIMITS } from '@shared/defaults'
import type { ArchivePatch, ArchiveSearchHit, ArchiveStats, ArchivedSession, CommandRecord, EndReason, ShellId } from '@shared/types'
import { JsonFile } from './jsonFile'
import { normTagName } from './library'
import { arr, bool, isObject, num, oneOf, str, stripAnsi } from './util'

/** Persisted form of a session. Active records are revived on start-up, archived ones form the archive. */
export interface SessionRecord {
  id: string
  state: 'active' | 'archived'
  shell: ShellId
  customTitle?: string
  processTitle?: string
  cwd: string
  initialCwd: string
  createdAt: number
  endedAt?: number
  exitCode?: number
  endReason?: EndReason
  tags: string[]
  pinned: boolean
  note?: string
  commands: CommandRecord[]
  logBytes: number
  order: number
}

interface SessionsDoc {
  version: 1
  records: SessionRecord[]
}

const ID_RE = /^[0-9a-f-]{36}$/i

function normCommand(v: unknown): CommandRecord | null {
  if (!isObject(v)) return null
  return {
    id: Math.round(num(v.id, 0)),
    text: str(v.text, '', 4000),
    cwd: str(v.cwd, '', 1024),
    startedAt: num(v.startedAt, 0),
    endedAt: typeof v.endedAt === 'number' ? v.endedAt : undefined,
    exitCode: typeof v.exitCode === 'number' ? v.exitCode : undefined
  }
}

function normRecord(v: unknown): SessionRecord | null {
  if (!isObject(v)) return null
  const id = str(v.id)
  if (!ID_RE.test(id)) return null
  return {
    id,
    state: oneOf(v.state, ['active', 'archived'] as const, 'archived'),
    shell: oneOf(v.shell, ['cmd', 'powershell', 'pwsh'] as const, 'powershell'),
    customTitle: str(v.customTitle, '', LIMITS.nameLength) || undefined,
    processTitle: str(v.processTitle, '', 300) || undefined,
    cwd: str(v.cwd, '', 1024),
    initialCwd: str(v.initialCwd, '', 1024),
    createdAt: num(v.createdAt, Date.now()),
    endedAt: typeof v.endedAt === 'number' ? v.endedAt : undefined,
    exitCode: typeof v.exitCode === 'number' ? v.exitCode : undefined,
    endReason: v.endReason ? oneOf(v.endReason, ['exit', 'closed', 'app-quit'] as const, 'closed') : undefined,
    tags: arr(v.tags).map(normTagName).filter(Boolean).slice(0, 20),
    pinned: bool(v.pinned, false),
    note: str(v.note, '', 2000) || undefined,
    commands: arr(v.commands)
      .map(normCommand)
      .filter((c): c is CommandRecord => !!c)
      .slice(-LIMITS.commandsPerSession),
    logBytes: num(v.logBytes, 0, 0),
    order: num(v.order, 0)
  }
}

function normalize(raw: unknown): SessionsDoc {
  const r = isObject(raw) ? raw : {}
  return {
    version: 1,
    records: arr(r.records)
      .map(normRecord)
      .filter((x): x is SessionRecord => !!x)
  }
}

export function displayTitle(r: Pick<SessionRecord, 'customTitle' | 'cwd' | 'shell'>): string {
  if (r.customTitle) return r.customTitle
  const folder = r.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || r.cwd
  return folder || (r.shell === 'cmd' ? 'Command Prompt' : 'PowerShell')
}

export class SessionStore {
  private file: JsonFile<SessionsDoc>
  private logsDir: string
  private textCache = new Map<string, string>()
  private listeners = new Set<() => void>()

  constructor(dataDir: string) {
    this.file = new JsonFile(join(dataDir, 'sessions.json'), { version: 1, records: [] }, normalize, 800)
    this.logsDir = join(dataDir, 'logs')
    mkdirSync(this.logsDir, { recursive: true })
  }

  onArchiveChange(l: () => void): void {
    this.listeners.add(l)
  }

  private archiveChanged(): void {
    for (const l of this.listeners) l()
  }

  get records(): SessionRecord[] {
    return this.file.data.records
  }

  get(id: string): SessionRecord | undefined {
    return this.records.find((r) => r.id === id)
  }

  activeRecords(): SessionRecord[] {
    return this.records.filter((r) => r.state === 'active').sort((a, b) => a.order - b.order)
  }

  upsert(rec: SessionRecord): void {
    const idx = this.records.findIndex((r) => r.id === rec.id)
    if (idx >= 0) this.records[idx] = rec
    else this.records.push(rec)
    this.file.save()
  }

  touch(): void {
    this.file.save()
  }

  // ---- logs ----

  private logPath(id: string): string {
    return join(this.logsDir, `${id}.vt`)
  }

  writeLog(id: string, content: string): number {
    const p = this.logPath(id)
    const tmp = `${p}.tmp`
    try {
      writeFileSync(tmp, content, 'utf8')
      renameSync(tmp, p)
      this.textCache.delete(id)
      return Buffer.byteLength(content, 'utf8')
    } catch (err) {
      console.error('[sessions] could not write log', err)
      return 0
    }
  }

  readLog(id: string): string {
    if (!ID_RE.test(id)) return ''
    const p = this.logPath(id)
    try {
      return existsSync(p) ? readFileSync(p, 'utf8') : ''
    } catch {
      return ''
    }
  }

  // ---- archive ----

  archive(rec: SessionRecord, reason: EndReason, exitCode?: number): void {
    rec.state = 'archived'
    rec.endedAt = Date.now()
    rec.endReason = reason
    if (exitCode !== undefined) rec.exitCode = exitCode
    this.upsert(rec)
    this.archiveChanged()
  }

  listArchived(): ArchivedSession[] {
    return this.records
      .filter((r) => r.state === 'archived')
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
      .map((r) => ({
        id: r.id,
        shell: r.shell,
        title: displayTitle(r),
        customTitle: r.customTitle,
        cwd: r.cwd,
        initialCwd: r.initialCwd,
        createdAt: r.createdAt,
        endedAt: r.endedAt ?? r.createdAt,
        exitCode: r.exitCode,
        endReason: r.endReason ?? 'closed',
        tags: r.tags,
        pinned: r.pinned,
        note: r.note,
        commands: r.commands,
        logBytes: r.logBytes
      }))
  }

  update(id: string, patch: ArchivePatch): void {
    const r = this.get(id)
    if (!r || !isObject(patch)) return
    if (patch.customTitle !== undefined) r.customTitle = patch.customTitle ? str(patch.customTitle, '', LIMITS.nameLength).trim() || undefined : undefined
    if (Array.isArray(patch.tags)) r.tags = [...new Set(patch.tags.map(normTagName).filter(Boolean))].slice(0, 20)
    if (typeof patch.pinned === 'boolean') r.pinned = patch.pinned
    if (typeof patch.note === 'string') r.note = patch.note.slice(0, 2000) || undefined
    this.file.save()
    this.archiveChanged()
  }

  renameTag(from: string, to: string): void {
    let changed = false
    for (const r of this.records) {
      if (r.tags.includes(from)) {
        r.tags = [...new Set(r.tags.map((t) => (t === from ? to : t)))]
        changed = true
      }
    }
    if (changed) {
      this.file.save()
      this.archiveChanged()
    }
  }

  removeTag(name: string): void {
    let changed = false
    for (const r of this.records) {
      if (r.tags.includes(name)) {
        r.tags = r.tags.filter((t) => t !== name)
        changed = true
      }
    }
    if (changed) {
      this.file.save()
      this.archiveChanged()
    }
  }

  delete(ids: string[]): void {
    const set = new Set(ids.filter((id) => typeof id === 'string'))
    const removed = this.records.filter((r) => set.has(r.id) && r.state === 'archived')
    if (!removed.length) return
    this.file.data.records = this.records.filter((r) => !(set.has(r.id) && r.state === 'archived'))
    for (const r of removed) {
      this.textCache.delete(r.id)
      rmSync(this.logPath(r.id), { force: true })
    }
    this.file.save()
    this.archiveChanged()
  }

  /** Delete unpinned, untagged archived sessions older than the given number of days. */
  cleanup(olderThanDays: number): number {
    if (!(olderThanDays > 0)) return 0
    const cutoff = Date.now() - olderThanDays * 86_400_000
    const ids = this.records
      .filter((r) => r.state === 'archived' && !r.pinned && r.tags.length === 0 && (r.endedAt ?? 0) < cutoff)
      .map((r) => r.id)
    this.delete(ids)
    return ids.length
  }

  stats(): ArchiveStats {
    const archived = this.records.filter((r) => r.state === 'archived')
    let bytes = 0
    for (const r of archived) {
      try {
        bytes += statSync(this.logPath(r.id)).size
      } catch {
        /* missing log */
      }
    }
    return { count: archived.length, bytes }
  }

  /** Full-text search through archived output logs. */
  search(query: string): ArchiveSearchHit[] {
    const q = str(query, '', 200).trim().toLowerCase()
    if (q.length < 2) return []
    const hits: ArchiveSearchHit[] = []
    for (const r of this.records) {
      if (r.state !== 'archived') continue
      let text = this.textCache.get(r.id)
      if (text === undefined) {
        text = stripAnsi(this.readLog(r.id)).replace(/\r/g, '')
        this.textCache.set(r.id, text)
        this.trimCache()
      }
      const idx = text.toLowerCase().indexOf(q)
      if (idx >= 0) {
        const start = Math.max(0, idx - 40)
        const end = Math.min(text.length, idx + q.length + 60)
        const excerpt = (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '')
        hits.push({ id: r.id, excerpt })
      }
    }
    return hits
  }

  private trimCache(): void {
    let total = 0
    for (const v of this.textCache.values()) total += v.length
    if (total < 40_000_000) return
    for (const k of this.textCache.keys()) {
      this.textCache.delete(k)
      total = 0
      for (const v of this.textCache.values()) total += v.length
      if (total < 20_000_000) break
    }
  }

  exportText(id: string): string | null {
    const r = this.get(id)
    if (!r) return null
    const lines = [
      `# ${displayTitle(r)}`,
      `# Shell:   ${r.shell}`,
      `# Folder:  ${r.cwd}`,
      `# Started: ${new Date(r.createdAt).toLocaleString()}`,
      r.endedAt ? `# Ended:   ${new Date(r.endedAt).toLocaleString()}` : '',
      r.tags.length ? `# Tags:    ${r.tags.join(', ')}` : '',
      ''
    ].filter((l, i, a) => l !== '' || i === a.length - 1)
    const body = stripAnsi(this.readLog(id)).replace(/\r\n/g, '\n').replace(/\r/g, '')
    return lines.join('\n') + '\n' + body.replace(/\n+$/, '') + '\n'
  }

  flush(): void {
    this.file.flush()
  }
}

export function isSessionId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id)
}
