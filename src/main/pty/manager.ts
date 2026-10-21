import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import type { CreateSessionOptions, ExecOptions, ExecResult, QuitRequest, SessionInfo, Settings, ShellId } from '@shared/types'
import { IPC } from '@shared/ipc'
import { LIMITS } from '@shared/defaults'
import { gitBranch } from '../git'
import type { LibraryStore } from '../store/library'
import type { SettingsStore } from '../store/settings'
import { isSessionId, type SessionRecord, type SessionStore } from '../store/sessions'
import { newId } from '../store/util'
import { PtySession, type SessionHost } from './session'
import { exactShell, resolveShell } from './shells'

const LOG_SAVE_INTERVAL = 15_000

export function isDirectory(p: string): boolean {
  try {
    return !!p && statSync(p).isDirectory()
  } catch {
    return false
  }
}

interface Deps {
  settings: SettingsStore
  library: LibraryStore
  store: SessionStore
  appVersion: string
  send: (channel: string, ...args: unknown[]) => void
}

export class SessionManager implements SessionHost {
  private sessions = new Map<string, PtySession>()
  private order: string[] = []
  private saveTimer: NodeJS.Timeout
  private updateTimers = new Map<string, NodeJS.Timeout>()
  readonly appVersion: string

  constructor(private readonly deps: Deps) {
    this.appVersion = deps.appVersion
    this.saveTimer = setInterval(() => void this.saveDirtyLogs(), LOG_SAVE_INTERVAL)
  }

  readonly settings = (): Settings => this.deps.settings.get()

  // ------------------------------------------------------------------ SessionHost

  sendData(id: string, data: string): void {
    this.deps.send(IPC.evData, id, data)
  }

  sendReset(id: string): void {
    this.deps.send(IPC.evSessionReset, id)
  }

  changed(session: PtySession, persist: boolean): void {
    if (persist) this.deps.store.touch()
    // Coalesce bursts of state changes into one update per frame.
    if (this.updateTimers.has(session.id)) return
    this.updateTimers.set(
      session.id,
      setTimeout(() => {
        this.updateTimers.delete(session.id)
        if (this.sessions.has(session.id)) this.deps.send(IPC.evSessionUpdated, session.info())
      }, 16)
    )
  }

  cwdChanged(session: PtySession, cwd: string): void {
    this.deps.store.touch()
    this.deps.library.touchRecent(cwd)
    this.deps.settings.setQuiet({ lastCwd: cwd })
    void this.refreshBranch(session)
    this.changed(session, false)
  }

  commandFinished(session: PtySession): void {
    void this.refreshBranch(session)
  }

  exited(session: PtySession, exitCode: number): void {
    const policy = this.settings().closeOnExit
    if (policy === 'always' || (policy === 'clean' && exitCode === 0)) {
      void this.close(session.id, 'exit')
    } else {
      this.changed(session, true)
    }
  }

  private async refreshBranch(session: PtySession): Promise<void> {
    const branch = await gitBranch(session.record.cwd)
    if (branch !== session.gitBranch && this.sessions.has(session.id)) {
      session.gitBranch = branch
      this.changed(session, false)
    }
  }

  // ------------------------------------------------------------------ queries

  list(): SessionInfo[] {
    return this.order.map((id) => this.sessions.get(id)!.info())
  }

  get(id: unknown): PtySession | undefined {
    return isSessionId(id) ? this.sessions.get(id) : undefined
  }

  quitRequest(): QuitRequest {
    return {
      busy: this.list()
        .filter((s) => s.status === 'busy')
        .map((s) => ({ id: s.id, title: s.title, command: s.currentCommand?.text }))
    }
  }

  // ------------------------------------------------------------------ lifecycle

  private startDirectory(requested?: string): string {
    if (requested && isDirectory(requested)) return requested
    const s = this.settings()
    if (s.startDirectory === 'custom' && isDirectory(s.customStartDirectory)) return s.customStartDirectory
    if (s.startDirectory === 'last' && isDirectory(s.lastCwd)) return s.lastCwd
    return homedir()
  }

  private register(session: PtySession): void {
    this.sessions.set(session.id, session)
    this.order.push(session.id)
    this.persistOrder()
  }

  create(opts: CreateSessionOptions = {}): SessionInfo {
    const settings = this.settings()
    let prefillLog = ''
    let prefillLabel = ''
    let shellReq = opts.shell
    let exact = !!opts.exact
    let cwd = opts.cwd
    let title = typeof opts.title === 'string' ? opts.title.trim().slice(0, LIMITS.nameLength) : undefined

    if (isSessionId(opts.resumeFrom)) {
      const prev = this.deps.store.get(opts.resumeFrom)
      if (prev) {
        if (!shellReq) {
          shellReq = prev.shell
          exact = true
        }
        cwd = cwd ?? prev.cwd
        title = title ?? prev.customTitle
        prefillLog = this.deps.store.readLog(prev.id)
        prefillLabel = `Resumed · session from ${new Date(prev.createdAt).toLocaleString()}`
      }
    }

    // 'cmd' and 'pwsh' are unambiguous; 'powershell' means "the preferred PowerShell" unless exact.
    const wantsExact = shellReq === 'cmd' || shellReq === 'pwsh' || (exact && shellReq === 'powershell')
    const shell = (wantsExact && exactShell(shellReq as ShellId)) || resolveShell(shellReq, settings)
    const dir = this.startDirectory(cwd)
    const record: SessionRecord = {
      id: newId(),
      state: 'active',
      shell: shell.id,
      customTitle: title || undefined,
      cwd: dir,
      initialCwd: dir,
      createdAt: Date.now(),
      tags: [],
      pinned: false,
      commands: [],
      logBytes: 0,
      order: this.order.length
    }
    const session = new PtySession(record, shell, this)
    if (prefillLog) session.prefill(prefillLog, prefillLabel)
    session.start(dir)
    this.deps.store.upsert(record)
    this.register(session)
    void this.refreshBranch(session)
    return session.info()
  }

  /** Revive the sessions that were open when the app last closed (or archive them). */
  restoreOnStartup(): void {
    const settings = this.settings()
    const active = this.deps.store.activeRecords()
    for (const record of active) {
      if (!settings.restoreSessions) {
        this.deps.store.archive(record, 'app-quit')
        continue
      }
      const shell = exactShell(record.shell) ?? resolveShell(record.shell === 'cmd' ? 'cmd' : 'powershell', settings)
      record.shell = shell.id
      const dir = this.startDirectory(record.cwd)
      record.cwd = dir
      const session = new PtySession(record, shell, this)
      session.restoredAt = Date.now()
      session.prefill(this.deps.store.readLog(record.id), `Restored ${new Date().toLocaleString()}`)
      session.start(dir)
      this.register(session)
      void this.refreshBranch(session)
    }
    if (settings.archiveRetentionDays > 0) this.deps.store.cleanup(settings.archiveRetentionDays)
  }

  async attach(id: string): Promise<string> {
    const s = this.get(id)
    return s ? s.attach() : ''
  }

  /** Called when the renderer reloads: stop streaming until it re-attaches. */
  detachAll(): void {
    for (const s of this.sessions.values()) s.detach()
  }

  write(id: string, data: string): void {
    this.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    if (typeof cols !== 'number' || typeof rows !== 'number') return
    this.get(id)?.resize(cols, rows)
  }

  ack(id: string, chars: number): void {
    if (typeof chars === 'number') this.get(id)?.ack(chars)
  }

  exec(id: string, text: string, opts: ExecOptions): ExecResult {
    const s = this.get(id)
    if (!s) return { ok: false, reason: 'not-found' }
    if (typeof text !== 'string' || !text) return { ok: true }
    return s.exec(text.slice(0, LIMITS.snippetCommandLength), {
      execute: !!opts?.execute,
      clearLine: opts?.clearLine !== false
    })
  }

  clearBuffer(id: string): void {
    this.get(id)?.clearBuffer()
  }

  rename(id: string, title: string): void {
    const s = this.get(id)
    if (!s) return
    s.record.customTitle = typeof title === 'string' && title.trim() ? title.trim().slice(0, LIMITS.nameLength) : undefined
    this.changed(s, true)
  }

  reorder(ids: string[]): void {
    if (!Array.isArray(ids)) return
    const next = ids.filter((id) => this.sessions.has(id))
    for (const id of this.order) if (!next.includes(id)) next.push(id)
    this.order = next
    this.persistOrder()
  }

  private persistOrder(): void {
    this.order.forEach((id, i) => {
      const s = this.sessions.get(id)
      if (s) s.record.order = i
    })
    this.deps.store.touch()
  }

  restart(id: string): SessionInfo | null {
    const s = this.get(id)
    if (!s) return null
    s.restart()
    return s.info()
  }

  switchShell(id: string, shellId: ShellId): SessionInfo | null {
    const s = this.get(id)
    const shell = exactShell(shellId)
    if (!s || !shell) return null
    return s.switchShell(shell) ? s.info() : null
  }

  private async saveLog(s: PtySession): Promise<void> {
    s.dirty = false
    const content = await s.snapshotForArchive()
    s.record.logBytes = this.deps.store.writeLog(s.id, content)
    this.deps.store.touch()
  }

  private async saveDirtyLogs(): Promise<void> {
    for (const s of this.sessions.values()) {
      if (s.dirty) await this.saveLog(s)
    }
  }

  /** Close a session: save its output and move it to the archive. */
  async close(id: string, reason: 'closed' | 'exit' = 'closed'): Promise<void> {
    const s = this.get(id)
    if (!s) return
    this.sessions.delete(id)
    this.order = this.order.filter((x) => x !== id)
    this.persistOrder()
    const t = this.updateTimers.get(id)
    if (t) clearTimeout(t)
    this.updateTimers.delete(id)
    this.deps.send(IPC.evSessionRemoved, id)
    await this.saveLog(s)
    s.dispose()
    this.deps.store.archive(s.record, s.status === 'exited' ? 'exit' : reason, s.exitCode)
  }

  /** App is quitting: save every session; keep them active for restore or archive them. */
  async shutdown(): Promise<void> {
    clearInterval(this.saveTimer)
    const restore = this.settings().restoreSessions
    const all = [...this.sessions.values()]
    for (const s of all) {
      try {
        await this.saveLog(s)
      } catch (err) {
        console.error('[sessions] save on quit failed', err)
      }
      s.dispose()
      if (!restore || s.status === 'exited') this.deps.store.archive(s.record, s.status === 'exited' ? 'exit' : 'app-quit', s.exitCode)
    }
    this.sessions.clear()
    this.order = []
  }
}
