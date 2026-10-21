import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statfsSync, writeFileSync } from 'node:fs'
import { app } from 'electron'
import { release } from 'node:os'
import { join } from 'node:path'
import type { HealthCheck, HealthReport } from '@shared/health'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import { detectShells } from '../pty/shells'
import { isObject } from '../store/util'

// Start-up health checks. They run before any store is opened, so repairs here never race the app's own writes.

const MIN_WINDOWS_BUILD = 17763 // Windows 10 1809: first build with ConPTY.
const LOW_DISK_BYTES = 200 * 1024 * 1024
const CONSOLE_TEST_TIMEOUT = 8000
/** Data files the app keeps; each is written atomically via a .tmp file (see store/jsonFile.ts). */
const DATA_FILES = ['settings.json', 'library.json', 'sessions.json', 'window-state.json']
const SETUP_FILE = 'setup.json'
const MAX_PATH = 259
/** Longest path inside node-pty's folder, e.g. \prebuilds\win32-x64\conpty\OpenConsole.exe, with some margin. */
const PTY_DEEPEST_FILE = 64
const REPORT_FILE = 'health.json'
const LOCK_FILE = 'run.lock'

interface Ctx {
  dataDir: string
  firstRun: boolean
}

interface Outcome {
  status: 'ok' | 'fixed' | 'warn' | 'fail'
  detail?: string
}

interface CheckDef {
  id: string
  label: (ctx: Ctx) => string
  /** A failed critical check stops start-up; a failed optional one is reported as a warning. */
  critical: boolean
  run: (ctx: Ctx) => Promise<Outcome> | Outcome
}

/** Loaded with require (not import()) so it resolves exactly like the app's own static import, including from app.asar. */
const loadPty = (): typeof import('node-pty') => require('node-pty') as typeof import('node-pty')

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 300)

function parses(file: string): boolean {
  try {
    JSON.parse(readFileSync(file, 'utf8'))
    return true
  } catch {
    return false
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

type RepairResult = 'ok' | 'missing' | 'restored' | 'reset'

/** Make sure a data file is valid JSON: recover an interrupted write, or set a damaged file aside. */
function repairJson(file: string): RepairResult {
  const tmp = `${file}.tmp`
  if (!existsSync(file)) {
    if (existsSync(tmp) && parses(tmp)) {
      renameSync(tmp, file)
      return 'restored'
    }
    return 'missing'
  }
  if (parses(file)) {
    rmSync(tmp, { force: true })
    return 'ok'
  }
  renameSync(file, `${file}.corrupt-${Date.now()}`)
  if (existsSync(tmp) && parses(tmp)) {
    renameSync(tmp, file)
    return 'restored'
  }
  return 'reset'
}

/**
 * Start a real shell through ConPTY and wait for a marker it echoes back. Seeing the marker proves the whole
 * path works (spawn, console host, output pipe). Waiting for exit instead would add ConPTY's slow teardown.
 */
function consoleTest(pty: typeof import('node-pty'), file: string, cwd: string, useConptyDll: boolean): Promise<void> {
  const marker = 'pt-health-' + process.pid
  return new Promise((resolve, reject) => {
    let proc: import('node-pty').IPty | undefined
    let output = ''
    const finish = (err?: Error): void => {
      clearTimeout(timer)
      try {
        proc?.kill()
      } catch {
        /* already gone */
      }
      if (err) reject(err)
      else resolve()
    }
    const timer = setTimeout(() => finish(new Error('the test shell did not respond')), CONSOLE_TEST_TIMEOUT)
    try {
      proc = pty.spawn(file, ['/d', '/c', 'echo ' + marker], { cols: 120, rows: 10, cwd, env: process.env as Record<string, string>, useConptyDll })
    } catch (err) {
      finish(err instanceof Error ? err : new Error(String(err)))
      return
    }
    proc.onData((d) => {
      // Newer ConPTY asks the terminal to identify itself (DA1) and waits up to 3 s for the answer.
      if (/\x1b\[0?c/.test(d)) proc?.write('\x1b[?1;2c')
      output = (output + d).slice(-4000)
      if (output.includes(marker)) finish()
    })
    proc.onExit(({ exitCode }) => {
      if (!output.includes(marker)) finish(new Error('the test shell exited (code ' + exitCode + ') without output'))
    })
  })
}

function windowsName(build: number): string {
  return build >= 22000 ? 'Windows 11' : 'Windows 10'
}

const CHECKS: CheckDef[] = [
  {
    id: 'system',
    label: () => 'Windows version',
    critical: true,
    run: () => {
      const build = Number(release().split('.')[2] ?? 0)
      if (process.platform !== 'win32') return { status: 'fail', detail: 'Pro Terminal runs on Windows only.' }
      if (build && build < MIN_WINDOWS_BUILD) {
        return { status: 'fail', detail: `Build ${build} is too old. Pro Terminal needs Windows 10 version 1809 or later.` }
      }
      return { status: 'ok', detail: `${windowsName(build)} (build ${build})` }
    }
  },
  {
    id: 'files',
    label: () => 'App files',
    critical: true,
    run: () => {
      const required = [join(__dirname, '../renderer/index.html'), join(__dirname, '../preload/index.js')]
      const missing = required.filter((f) => !existsSync(f))
      if (missing.length) return { status: 'fail', detail: 'Some app files are missing. Reinstall Pro Terminal to fix this.' }
      // node-pty's console host files sit deep inside the install folder. Past Windows' 260-character path
      // limit, starting a shell blocks inside node-pty instead of failing, so catch it here.
      if (app.isPackaged) {
        const ptyDir = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-pty')
        const deepest = ptyDir.length + PTY_DEEPEST_FILE
        if (deepest > MAX_PATH) {
          return {
            status: 'fail',
            detail: `The install folder's path is too long for Windows (${deepest} of ${MAX_PATH} characters). Reinstall Pro Terminal into a shorter folder, such as the default one.`
          }
        }
      }
      return { status: 'ok', detail: 'Complete' }
    }
  },
  {
    id: 'data',
    label: (ctx) => (ctx.firstRun ? 'Create your workspace' : 'Data folder'),
    critical: true,
    run: (ctx) => {
      try {
        mkdirSync(join(ctx.dataDir, 'logs'), { recursive: true })
        const probe = join(ctx.dataDir, `.write-test-${process.pid}`)
        writeFileSync(probe, 'ok', 'utf8')
        const back = readFileSync(probe, 'utf8')
        rmSync(probe, { force: true })
        if (back !== 'ok') throw new Error('read back different data')
      } catch (err) {
        // Node error messages repeat the path; the code (e.g. EACCES, ENOTDIR) is enough next to it.
        const code = (err as NodeJS.ErrnoException).code
        return { status: 'fail', detail: `Can't write to ${ctx.dataDir} (${code ?? errText(err)}). Check the folder's permissions or free some disk space.` }
      }
      return { status: 'ok', detail: ctx.firstRun ? 'Created' : 'Writable' }
    }
  },
  {
    id: 'stores',
    label: () => 'Settings and library',
    critical: false,
    run: (ctx) => {
      if (ctx.firstRun) return { status: 'ok', detail: 'Defaults ready' }
      const repaired: string[] = []
      const reset: string[] = []
      for (const name of DATA_FILES) {
        const r = repairJson(join(ctx.dataDir, name))
        if (r === 'restored') repaired.push(name)
        if (r === 'reset') reset.push(name)
      }
      const doc = readJson(join(ctx.dataDir, 'sessions.json'))
      const records = isObject(doc) && Array.isArray(doc.records) ? doc.records : []
      const archived = records.filter((r) => isObject(r) && r.state === 'archived').length
      if (reset.length) {
        return { status: 'fixed', detail: `${reset.join(', ')} was damaged and has been reset (a backup copy was kept).` }
      }
      if (repaired.length) return { status: 'fixed', detail: `Recovered ${repaired.join(', ')} from an interrupted save.` }
      return { status: 'ok', detail: archived ? `OK · ${archived} archived session${archived === 1 ? '' : 's'}` : 'OK' }
    }
  },
  {
    id: 'engine',
    label: () => 'Terminal engine',
    critical: true,
    run: () => {
      try {
        loadPty()
      } catch (err) {
        return { status: 'fail', detail: `node-pty could not load (${errText(err)}). Reinstall Pro Terminal to fix this.` }
      }
      return { status: 'ok', detail: 'Loaded' }
    }
  },
  {
    id: 'shells',
    label: () => 'Shells',
    critical: true,
    run: () => {
      const shells = detectShells()
      const found = shells.filter((s) => s.available)
      if (!found.some((s) => s.id === 'cmd' || s.id === 'powershell')) {
        return { status: 'fail', detail: 'Neither cmd.exe nor Windows PowerShell was found in the Windows folder.' }
      }
      return { status: 'ok', detail: found.map((s) => s.name).join(' · ') }
    }
  },
  {
    id: 'console',
    label: () => 'Console host',
    critical: true,
    run: async (ctx) => {
      const pty = loadPty()
      const cmd = detectShells().find((s) => s.id === 'cmd' && s.available) ?? detectShells().find((s) => s.available)!
      const raw = readJson(join(ctx.dataDir, 'settings.json'))
      const bundled = isObject(raw) && typeof raw.useBundledConpty === 'boolean' ? raw.useBundledConpty : DEFAULT_SETTINGS.useBundledConpty
      const cwd = process.env.SystemRoot || 'C:\\Windows'
      try {
        await consoleTest(pty, cmd.path, cwd, bundled)
        return { status: 'ok', detail: bundled ? 'Bundled ConPTY works' : 'Windows ConPTY works' }
      } catch (first) {
        if (!bundled) return { status: 'fail', detail: `A test shell could not start: ${errText(first)}` }
        try {
          await consoleTest(pty, cmd.path, cwd, false)
          // Sessions fall back to the system ConPTY on their own (see pty/session.ts).
          return { status: 'warn', detail: "The bundled ConPTY failed, so Windows' built-in one will be used." }
        } catch (second) {
          return { status: 'fail', detail: `A test shell could not start: ${errText(second)}` }
        }
      }
    }
  },
  {
    id: 'disk',
    label: () => 'Disk space',
    critical: false,
    run: (ctx) => {
      try {
        const s = statfsSync(ctx.dataDir)
        const free = s.bavail * s.bsize
        const gb = free / 1024 ** 3
        const text = gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB free` : `${Math.round(free / 1024 ** 2)} MB free`
        if (free < LOW_DISK_BYTES) return { status: 'warn', detail: `Only ${text}. Session logs may not be saved.` }
        return { status: 'ok', detail: text }
      } catch {
        return { status: 'ok', detail: 'Unknown' }
      }
    }
  },
  {
    id: 'last-run',
    label: () => 'Last session',
    critical: false,
    run: (ctx) => {
      if (ctx.firstRun) return { status: 'ok', detail: 'First start' }
      if (!existsSync(join(ctx.dataDir, LOCK_FILE))) return { status: 'ok', detail: 'Closed cleanly' }
      const restore = readJson(join(ctx.dataDir, 'settings.json'))
      const restores = !(isObject(restore) && restore.restoreSessions === false)
      return {
        status: 'fixed',
        detail: restores ? "Pro Terminal didn't close properly last time. Your sessions will be restored." : "Pro Terminal didn't close properly last time."
      }
    }
  }
]

interface SetupState {
  firstRunAt: number
  lastVersion: string
}

function readSetup(dataDir: string): SetupState | null {
  const raw = readJson(join(dataDir, SETUP_FILE))
  if (!isObject(raw)) return null
  return {
    firstRunAt: typeof raw.firstRunAt === 'number' ? raw.firstRunAt : Date.now(),
    lastVersion: typeof raw.lastVersion === 'string' ? raw.lastVersion : ''
  }
}

/** True before the very first start (no setup record and no settings from an older version). */
export function isFirstRun(dataDir: string): boolean {
  return !existsSync(join(dataDir, SETUP_FILE)) && !existsSync(join(dataDir, 'settings.json'))
}

export const CHECK_COUNT = CHECKS.length

/**
 * Run every check in order, reporting progress after each step.
 * Stops at the first failed critical check; the remaining ones stay 'pending'.
 */
export async function runChecks(
  dataDir: string,
  version: string,
  onProgress: (checks: HealthCheck[], done: number) => void,
  minStepMs = 0
): Promise<HealthReport> {
  const started = Date.now()
  const firstRun = isFirstRun(dataDir)
  const setup = firstRun ? null : readSetup(dataDir)
  const upgradedFrom = setup && setup.lastVersion && setup.lastVersion !== version ? setup.lastVersion : undefined
  const ctx: Ctx = { dataDir, firstRun }
  const checks: HealthCheck[] = CHECKS.map((c) => ({ id: c.id, label: c.label(ctx), status: 'pending' }))
  let ok = true

  for (let i = 0; i < CHECKS.length; i++) {
    const def = CHECKS[i]
    checks[i] = { ...checks[i], status: 'running' }
    onProgress(checks.map((c) => ({ ...c })), i)
    const t0 = Date.now()
    let outcome: Outcome
    try {
      outcome = await def.run(ctx)
    } catch (err) {
      outcome = { status: 'fail', detail: errText(err) }
    }
    if (outcome.status === 'fail' && !def.critical) outcome = { status: 'warn', detail: outcome.detail }
    const ms = Date.now() - t0
    // A short minimum per step keeps the list readable instead of flashing past.
    const wait = minStepMs - (Date.now() - t0)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    checks[i] = { ...checks[i], ...outcome, ms }
    onProgress(checks.map((c) => ({ ...c })), i + 1)
    if (outcome.status === 'fail') {
      ok = false
      break
    }
  }

  if (ok && upgradedFrom) checks.push({ id: 'upgrade', label: 'Update', status: 'ok', detail: `Updated from ${upgradedFrom} to ${version}` })

  const report: HealthReport = { at: Date.now(), version, ok, firstRun, upgradedFrom, durationMs: Date.now() - started, checks }
  if (ok) {
    try {
      writeFileSync(join(dataDir, SETUP_FILE), JSON.stringify({ firstRunAt: setup?.firstRunAt ?? Date.now(), lastVersion: version }, null, 2), 'utf8')
    } catch {
      /* the data check passed, so this is unexpected; the next start simply repeats first-run */
    }
  }
  try {
    writeFileSync(join(dataDir, REPORT_FILE), JSON.stringify(report, null, 2), 'utf8')
  } catch {
    /* data folder not writable: already reported by the data check */
  }
  return report
}

/** Marks the app as running; the marker is removed on a clean exit, so a leftover one means a crash. */
export function markRunning(dataDir: string): void {
  try {
    writeFileSync(join(dataDir, LOCK_FILE), JSON.stringify({ pid: process.pid, startedAt: Date.now() }), 'utf8')
  } catch {
    /* not critical */
  }
}

export function markCleanExit(dataDir: string): void {
  rmSync(join(dataDir, LOCK_FILE), { force: true })
}

/** Old damaged-file backups are only useful for a while; keep the newest few of each. */
export function pruneCorruptBackups(dataDir: string, keep = 3): void {
  try {
    const files = readdirSync(dataDir).filter((f) => f.includes('.corrupt-'))
    for (const base of DATA_FILES) {
      const mine = files.filter((f) => f.startsWith(`${base}.corrupt-`)).sort().reverse()
      for (const f of mine.slice(keep)) rmSync(join(dataDir, f), { force: true })
    }
  } catch {
    /* not critical */
  }
}
