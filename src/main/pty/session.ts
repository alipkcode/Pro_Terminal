import * as pty from 'node-pty'
import { Terminal as HeadlessTerminal, type IMarker, type IDisposable } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { LIMITS } from '@shared/defaults'
import type { ExecOptions, ExecResult, SessionInfo, SessionStatus, Settings, ShellInfo } from '@shared/types'
import { trimTrailingBlank } from '@shared/vt'
import { displayTitle, type SessionRecord } from '../store/sessions'
import { launchConfig } from './shells'

/** Escape key press + release in win32-input-mode; ConPTY parses it unambiguously in a single write. */
const CLEAR_LINE = '\x1b[27;1;27;1;0;1_\x1b[27;1;27;0;0;1_'

const FLOW_HIGH_WATER = 100_000
const FLOW_LOW_WATER = 5_000
const BATCH_MS = 5
const INTEGRATION_GRACE_MS = 6000

/** Responses the terminal emulator sends on its own (focus, device attributes, cursor reports). */
const AUTO_RESPONSE = /^(?:\x1b\[[IO]|\x1b\[\?[\d;]*c|\x1b\[>[\d;]*c|\x1b\[\d+;\d+R|\x1b\[\?\d+;\d+\$y|\x1b\][\s\S]*(?:\x07|\x1b\\))+$/

export interface SessionHost {
  readonly settings: () => Settings
  readonly appVersion: string
  sendData(id: string, data: string): void
  sendReset(id: string): void
  changed(session: PtySession, persist: boolean): void
  cwdChanged(session: PtySession, cwd: string): void
  exited(session: PtySession, exitCode: number): void
  commandFinished(session: PtySession): void
}

export class PtySession {
  readonly id: string
  record: SessionRecord
  shell: ShellInfo

  status: SessionStatus = 'starting'
  pid = 0
  pristine = true
  integration = false
  exitCode?: number
  lastExitCode?: number
  gitBranch?: string
  restoredAt?: number
  currentCommand?: { id: number; text: string; startedAt: number }
  attached = false
  dirty = false

  private proc: pty.IPty | null = null
  private procListeners: IDisposable[] = []
  private term: HeadlessTerminal
  private serializer = new SerializeAddon()
  private cols = 120
  private rows = 30

  private outBuf = ''
  private flushTimer: NodeJS.Timeout | null = null
  private attachQueue: string[] | null = null
  private unacked = 0
  private paused = false

  private promptMarker?: IMarker
  private promptCol = 0
  private pendingLines: string[] = []
  private seq = 0
  private graceTimer: NodeJS.Timeout | null = null
  private disposed = false

  constructor(
    record: SessionRecord,
    shell: ShellInfo,
    private readonly host: SessionHost
  ) {
    this.id = record.id
    this.record = record
    this.shell = shell
    this.seq = record.commands.reduce((m, c) => Math.max(m, c.id), 0)
    this.term = new HeadlessTerminal({
      cols: this.cols,
      rows: this.rows,
      scrollback: host.settings().scrollback,
      allowProposedApi: true,
      scrollOnEraseInDisplay: true
    })
    this.term.loadAddon(this.serializer)
    this.registerParsers()
    // Answer terminal queries (e.g. device attributes) while no renderer is attached.
    this.term.onData((data) => {
      if (!this.attached && this.proc) this.proc.write(data)
    })
  }

  // ------------------------------------------------------------------ lifecycle

  start(cwd: string): void {
    const settings = this.host.settings()
    const cfg = launchConfig(this.shell, settings.shellIntegration, this.host.appVersion)
    const opts: pty.IWindowsPtyForkOptions = {
      cols: this.cols,
      rows: this.rows,
      cwd,
      env: cfg.env,
      useConptyDll: settings.useBundledConpty
    }
    let proc: pty.IPty
    try {
      proc = pty.spawn(cfg.file, cfg.args, opts)
    } catch (err) {
      if (!opts.useConptyDll) throw err
      console.warn('[pty] bundled ConPTY failed, falling back to the system ConPTY', err)
      proc = pty.spawn(cfg.file, cfg.args, { ...opts, useConptyDll: false })
    }
    this.proc = proc
    this.pid = proc.pid
    this.status = 'starting'
    this.exitCode = undefined
    this.integration = false
    this.procListeners = [proc.onData((d) => this.onPtyData(d)), proc.onExit(({ exitCode }) => this.onPtyExit(exitCode))]
    this.clearGrace()
    this.graceTimer = setTimeout(() => {
      // No prompt markers (integration off, custom prompt, slow profile): treat the shell as ready.
      if (this.status === 'starting') {
        this.status = 'idle'
        this.host.changed(this, false)
      }
    }, settings.shellIntegration ? INTEGRATION_GRACE_MS : 300)
  }

  /** Stop the process without reporting an exit (used for shell swaps, restarts and shutdown). */
  private stopProcess(): void {
    this.clearGrace()
    for (const d of this.procListeners) d.dispose()
    this.procListeners = []
    const proc = this.proc
    this.proc = null
    if (proc) {
      try {
        proc.kill()
      } catch {
        /* already gone */
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopProcess()
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.term.dispose()
  }

  get isAlive(): boolean {
    return !!this.proc && this.status !== 'exited'
  }

  /** Swap the shell in place. Only allowed while nothing has been executed. */
  switchShell(shell: ShellInfo): boolean {
    if (!this.pristine || this.status === 'busy') return false
    this.stopProcess()
    this.outBuf = ''
    this.term.reset()
    this.host.sendReset(this.id)
    this.shell = shell
    this.record.shell = shell.id
    this.record.commands = []
    this.currentCommand = undefined
    this.lastExitCode = undefined
    this.start(this.record.cwd || this.record.initialCwd)
    this.host.changed(this, true)
    return true
  }

  restart(): void {
    this.stopProcess()
    this.inject(`\r\n${divider('Restarted', this.cols)}\r\n`)
    this.pristine = true
    this.currentCommand = undefined
    this.start(this.record.cwd || this.record.initialCwd)
    this.host.changed(this, true)
  }

  /** Put previous output (from an archive or the last run) above the new prompt. */
  prefill(log: string, label: string): void {
    const body = trimTrailingBlank(log)
    if (!body) return
    const rows = this.rows
    this.term.write(`${body}\x1b[0m\r\n${divider(label, this.cols)}${'\r\n'.repeat(rows)}\x1b[H`)
  }

  // ------------------------------------------------------------------ output

  private onPtyData(data: string): void {
    this.term.write(data)
    this.dirty = true
    if (this.attachQueue) {
      this.attachQueue.push(data)
      return
    }
    if (!this.attached) return
    this.outBuf += data
    this.unacked += data.length
    if (!this.paused && this.unacked > FLOW_HIGH_WATER && this.proc) {
      this.paused = true
      this.proc.pause()
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null
        this.flush()
      }, BATCH_MS)
    }
  }

  private flush(): void {
    if (!this.outBuf) return
    const data = this.outBuf
    this.outBuf = ''
    this.host.sendData(this.id, data)
  }

  /** Write text locally (to both the mirror and the renderer) without sending it to the shell. */
  private inject(text: string): void {
    this.term.write(text)
    if (this.attachQueue) this.attachQueue.push(text)
    else if (this.attached) {
      this.outBuf += text
      this.flush()
    }
  }

  private onPtyExit(exitCode: number): void {
    this.clearGrace()
    this.flush()
    for (const d of this.procListeners) d.dispose()
    this.procListeners = []
    this.proc = null
    if (this.currentCommand) this.finishCommand(undefined)
    this.status = 'exited'
    this.exitCode = exitCode
    this.dirty = true
    this.host.exited(this, exitCode)
  }

  // ------------------------------------------------------------------ renderer attachment & flow control

  /** Snapshot the terminal so a (re)loaded renderer can pick up exactly where the stream continues. */
  attach(): Promise<string> {
    this.attached = false
    this.resumeFlow()
    const queue: string[] = []
    this.attachQueue = queue
    return new Promise((resolve) => {
      this.term.write('', () => {
        let snapshot = ''
        try {
          snapshot = this.serializer.serialize({ scrollback: this.host.settings().scrollback })
        } catch (err) {
          console.error('[pty] serialize failed', err)
        }
        if (this.attachQueue === queue) this.attachQueue = null
        this.attached = true
        resolve(snapshot + queue.join(''))
      })
    })
  }

  detach(): void {
    this.attached = false
    this.attachQueue = null
    this.outBuf = ''
    this.resumeFlow()
  }

  ack(chars: number): void {
    if (!(chars > 0)) return
    this.unacked = Math.max(0, this.unacked - chars)
    if (this.paused && this.unacked < FLOW_LOW_WATER) this.resumeFlow()
  }

  private resumeFlow(): void {
    this.unacked = 0
    if (this.paused) {
      this.paused = false
      this.proc?.resume()
    }
  }

  /** Serialized output for the archive: normal buffer only, no terminal modes. */
  snapshotForArchive(): Promise<string> {
    return new Promise((resolve) => {
      this.term.write('', () => {
        try {
          resolve(
            this.serializer.serialize({
              scrollback: this.host.settings().scrollback,
              excludeAltBuffer: true,
              excludeModes: true
            })
          )
        } catch {
          resolve('')
        }
      })
    })
  }

  // ------------------------------------------------------------------ input

  write(data: string): void {
    if (!this.proc || typeof data !== 'string') return
    if (!AUTO_RESPONSE.test(data) && data.includes('\r')) this.onEnter()
    this.proc.write(data)
  }

  resize(cols: number, rows: number): void {
    cols = Math.max(2, Math.min(1000, Math.floor(cols)))
    rows = Math.max(1, Math.min(500, Math.floor(rows)))
    if (cols === this.cols && rows === this.rows) return
    this.cols = cols
    this.rows = rows
    this.term.resize(cols, rows)
    try {
      this.proc?.resize(cols, rows)
    } catch {
      /* process may be exiting */
    }
  }

  clearBuffer(): void {
    this.term.clear()
    try {
      this.proc?.clear()
    } catch {
      /* not supported */
    }
  }

  /** Type text into the shell on the user's behalf (favorites, snippets, command palette). */
  exec(text: string, opts: ExecOptions): ExecResult {
    if (!this.proc || this.status === 'exited') return { ok: false, reason: 'exited' }
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop()
    const body = lines.join('\r')
    const payload = (opts.clearLine ? CLEAR_LINE : '') + body + (opts.execute ? '\r' : '')
    const executed = opts.execute ? lines : lines.slice(0, -1)
    if (executed.length) {
      this.markUsed()
      if (this.integration && this.status === 'idle') {
        this.beginCommand(executed[0].trim())
        this.pendingLines = executed.slice(1).map((l) => l.trim()).filter(Boolean)
      }
    }
    this.proc.write(payload)
    return { ok: true }
  }

  private markUsed(): void {
    if (this.pristine) {
      this.pristine = false
      this.host.changed(this, false)
    }
  }

  private onEnter(): void {
    this.markUsed()
    if (!this.integration || this.status !== 'idle') return
    const text = this.readPromptInput()
    if (text.trim()) this.beginCommand(text.trim())
  }

  /** Read what the user typed after the prompt, skipping dim+italic "prediction" ghost text. */
  private readPromptInput(): string {
    const marker = this.promptMarker
    const buf = this.term.buffer.active
    if (!marker || marker.isDisposed || marker.line < 0 || buf.type !== 'normal') return ''
    const end = buf.baseY + buf.cursorY
    if (end < marker.line || end - marker.line > 50) return ''
    let out = ''
    const cell = buf.getNullCell()
    for (let y = marker.line; y <= end; y++) {
      const line = buf.getLine(y)
      if (!line) break
      if (y > marker.line && !line.isWrapped) out += '\n'
      let row = ''
      for (let x = y === marker.line ? this.promptCol : 0; x < line.length; x++) {
        const c = line.getCell(x, cell)
        if (!c || c.getWidth() === 0) continue
        if (c.isDim() && c.isItalic()) continue
        row += c.getChars() || ' '
      }
      out += row.replace(/\s+$/, '')
    }
    return out
  }

  // ------------------------------------------------------------------ shell integration

  private registerParsers(): void {
    this.term.parser.registerOscHandler(133, (data) => {
      const [kind, arg] = data.split(';')
      switch (kind) {
        case 'A':
          this.onPromptStart()
          break
        case 'B':
          this.promptMarker?.dispose()
          this.promptMarker = this.term.registerMarker(0)
          this.promptCol = this.term.buffer.active.cursorX
          break
        case 'D': {
          const code = arg !== undefined && arg !== '' ? Number(arg) : undefined
          this.finishCommand(Number.isFinite(code) ? code : undefined)
          break
        }
      }
      return true
    })
    this.term.parser.registerOscHandler(633, (data) => {
      if (data.startsWith('E;')) {
        let text = ''
        try {
          text = Buffer.from(data.slice(2).split(';')[0], 'base64').toString('utf8')
        } catch {
          /* ignore malformed */
        }
        if (text) this.onExactCommandText(text)
      }
      return true
    })
    this.term.parser.registerOscHandler(9, (data) => {
      if (data.startsWith('9;')) {
        let path = data.slice(2).trim()
        if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1)
        if (path) this.onCwd(path)
      }
      return true
    })
  }

  private onPromptStart(): void {
    this.clearGrace()
    const first = !this.integration
    this.integration = true
    if (this.currentCommand) this.finishCommand(undefined)
    if (this.pendingLines.length) {
      // Multi-line snippets: the next queued line is already being executed by the shell.
      this.beginCommand(this.pendingLines.shift()!)
      return
    }
    if (this.status !== 'idle' || first) {
      this.status = 'idle'
      this.host.changed(this, false)
    }
  }

  private onCwd(path: string): void {
    if (path === this.record.cwd) return
    this.record.cwd = path
    this.host.cwdChanged(this, path)
  }

  private beginCommand(text: string): void {
    const rec = { id: ++this.seq, text: text.slice(0, 4000), cwd: this.record.cwd, startedAt: Date.now() }
    this.record.commands.push(rec)
    if (this.record.commands.length > LIMITS.commandsPerSession) this.record.commands.splice(0, this.record.commands.length - LIMITS.commandsPerSession)
    this.currentCommand = { id: rec.id, text: rec.text, startedAt: rec.startedAt }
    this.status = 'busy'
    this.host.changed(this, true)
  }

  /** PowerShell reports the exact command line from its history; prefer it over what we read. */
  private onExactCommandText(text: string): void {
    const target = this.currentCommand
      ? this.record.commands.find((c) => c.id === this.currentCommand!.id)
      : undefined
    if (target) {
      target.text = text.slice(0, 4000)
      this.currentCommand!.text = target.text
    } else {
      // A command we did not see start (e.g. typed during a previous command).
      const rec = { id: ++this.seq, text: text.slice(0, 4000), cwd: this.record.cwd, startedAt: Date.now() }
      this.record.commands.push(rec)
      this.currentCommand = { id: rec.id, text: rec.text, startedAt: rec.startedAt }
    }
  }

  private finishCommand(exitCode: number | undefined): void {
    const cur = this.currentCommand
    if (!cur) return
    const rec = this.record.commands.find((c) => c.id === cur.id)
    if (rec) {
      rec.endedAt = Date.now()
      rec.exitCode = exitCode
    }
    this.currentCommand = undefined
    this.lastExitCode = exitCode
    if (this.status === 'busy') this.status = 'idle'
    this.host.changed(this, true)
    this.host.commandFinished(this)
  }

  private clearGrace(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer)
      this.graceTimer = null
    }
  }

  // ------------------------------------------------------------------ info

  info(): SessionInfo {
    const r = this.record
    return {
      id: this.id,
      shell: this.shell.id,
      title: displayTitle(r),
      customTitle: r.customTitle,
      cwd: r.cwd,
      status: this.status,
      exitCode: this.exitCode,
      pid: this.pid,
      createdAt: r.createdAt,
      pristine: this.pristine,
      integration: this.integration,
      commands: r.commands,
      currentCommand: this.currentCommand ? { text: this.currentCommand.text, startedAt: this.currentCommand.startedAt } : undefined,
      lastExitCode: this.lastExitCode,
      gitBranch: this.gitBranch,
      restoredAt: this.restoredAt
    }
  }
}

function divider(label: string, cols: number): string {
  const text = ` ${label} `
  const width = Math.max(text.length + 4, Math.min(cols, 100))
  const side = Math.max(2, Math.floor((width - text.length) / 2))
  return `\x1b[0m\x1b[2m${'─'.repeat(side)}${text}${'─'.repeat(side)}\x1b[0m`
}
