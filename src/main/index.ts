import { app, clipboard, dialog, nativeTheme, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatReport, type HealthCheck, type HealthReport, type SplashAction, type SplashState } from '@shared/health'
import { CHECK_COUNT, isFirstRun, markRunning, pruneCorruptBackups, runChecks } from './health/checks'
import { setLastReport } from './health/report'
import { Splash } from './health/splash'
import { queueLaunchersFromArgv } from './launchers'
import { isObject } from './store/util'

app.setAppUserModelId('com.alipkcode.proterminal')

// Lets a second, isolated profile run (tests, trying settings) without touching your real data.
if (process.env.PRO_TERMINAL_USER_DATA) app.setPath('userData', process.env.PRO_TERMINAL_USER_DATA)

/** Keeps each check on screen long enough to read without slowing start-up noticeably. */
const MIN_STEP_MS = 55
/** Extra time on the splash when something was repaired or needs attention. */
const NOTICE_HOLD_MS = 1400

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void main()
}

function prefersDark(dataDir: string): boolean {
  let theme: unknown
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'))
    theme = isObject(raw) ? raw.appTheme : undefined
  } catch {
    /* first run or damaged file: the check repairs it */
  }
  if (theme === 'light') return false
  if (theme === 'system') return nativeTheme.shouldUseDarkColors
  return true
}

function splashState(report: { checks: HealthCheck[]; done: number }, firstRun: boolean, mode: SplashState['mode']): SplashState {
  const failed = report.checks.find((c) => c.status === 'fail')
  const title = mode === 'failed' ? "Pro Terminal can't start" : firstRun ? 'Setting up Pro Terminal' : 'Pro Terminal'
  const subtitle =
    mode === 'failed'
      ? (failed?.label ?? 'A check failed')
      : mode === 'opening'
        ? 'Opening your workspace…'
        : firstRun
          ? 'Getting everything ready for the first time'
          : 'Checking that everything is healthy'
  return {
    mode,
    title,
    subtitle,
    version: app.getVersion(),
    checks: report.checks,
    progress: mode === 'opening' ? 1 : Math.min(1, report.done / CHECK_COUNT)
  }
}

async function main(): Promise<void> {
  await app.whenReady()
  const dataDir = join(app.getPath('userData'), 'data')
  const firstRun = isFirstRun(dataDir)
  const splash = new Splash(prefersDark(dataDir))
  // Desktop shortcuts pass --launcher=<id>; ids are queued until the renderer takes them (see app.ts).
  queueLaunchersFromArgv(process.argv)
  app.on('second-instance', (_e, argv) => {
    queueLaunchersFromArgv(argv)
    splash.focus()
  })
  // Closing the splash before the app opens means the user changed their mind.
  let launched = false
  splash.win.once('closed', () => {
    if (!launched) app.exit(0)
  })

  // While checks run, the only button is the close button.
  const idleActions = (a: SplashAction): void => {
    if (a === 'quit') splash.win.close()
  }
  splash.setActionHandler(idleActions)

  const check = (): Promise<HealthReport> =>
    runChecks(dataDir, app.getVersion(), (checks, done) => splash.update(splashState({ checks, done }, firstRun, 'checking')), MIN_STEP_MS)

  let report = await check()
  while (!report.ok) {
    const next = await handleFailure(splash, report, dataDir)
    if (next === 'quit') {
      launched = true
      await splash.close()
      app.exit(1)
      return
    }
    splash.setActionHandler(idleActions)
    report = await check()
  }

  setLastReport(report)
  pruneCorruptBackups(dataDir)
  splash.update(splashState({ checks: report.checks, done: CHECK_COUNT }, firstRun, 'opening'))
  const notable = report.checks.some((c) => c.status === 'warn' || c.status === 'fixed')
  const hold = notable ? new Promise((r) => setTimeout(r, NOTICE_HOLD_MS)) : Promise.resolve()

  // From here on, closing the splash just closes it; the main window still opens.
  launched = true
  markRunning(dataDir)
  // Loaded only now: the check has proven node-pty and the data files are usable.
  const { startApp } = await import('./app')
  const win = startApp(dataDir)
  const shown = new Promise<void>((resolve) => win.once('show', () => resolve()))
  await Promise.all([shown, hold])
  win.focus()
  await splash.close()
}

/** Shows the failure and waits for the user to retry or quit. */
async function handleFailure(splash: Splash, report: HealthReport, dataDir: string): Promise<'retry' | 'quit'> {
  const failed = report.checks.find((c) => c.status === 'fail')
  const done = report.checks.filter((c) => c.status !== 'pending' && c.status !== 'running').length
  const pageReady = splash.usable && (await splash.whenLoaded())

  if (!pageReady) {
    // The splash page itself could not load (damaged install): fall back to a native dialog.
    for (;;) {
      const { response } = await dialog.showMessageBox({
        type: 'error',
        title: 'Pro Terminal',
        message: "Pro Terminal can't start",
        detail: `${failed?.label}: ${failed?.detail ?? ''}\n\n${formatReport(report)}`,
        buttons: ['Try again', 'Open data folder', 'Quit'],
        defaultId: 0,
        cancelId: 2,
        noLink: true
      })
      if (response === 0) return 'retry'
      if (response === 1) await shell.openPath(dataDir)
      else return 'quit'
    }
  }

  splash.update(splashState({ checks: report.checks, done }, false, 'failed'))
  return new Promise((resolve) => {
    splash.setActionHandler((action) => {
      if (action === 'retry') resolve('retry')
      else if (action === 'quit') resolve('quit')
      else if (action === 'open-data') void shell.openPath(dataDir)
      else if (action === 'copy-report') clipboard.writeText(formatReport(report))
    })
    splash.win.once('closed', () => resolve('quit'))
  })
}
