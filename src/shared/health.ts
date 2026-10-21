// Start-up health check: shared between the main process, the splash window and the About page.

export type CheckStatus = 'pending' | 'running' | 'ok' | 'fixed' | 'warn' | 'fail'

export interface HealthCheck {
  id: string
  label: string
  status: CheckStatus
  /** One line shown under the label: what was found, repaired, or what to do. */
  detail?: string
  /** How long the check itself took. */
  ms?: number
}

export interface HealthReport {
  at: number
  version: string
  ok: boolean
  firstRun: boolean
  /** Version that last ran, when it differs from this one. */
  upgradedFrom?: string
  durationMs: number
  checks: HealthCheck[]
}

export type SplashMode = 'checking' | 'opening' | 'failed'

export interface SplashState {
  mode: SplashMode
  title: string
  subtitle: string
  version: string
  checks: HealthCheck[]
  /** 0..1 */
  progress: number
  /** Set just before the window closes, so the page can fade out. */
  closing?: boolean
}

export type SplashAction = 'retry' | 'open-data' | 'copy-report' | 'quit'

export const SPLASH_CHANNEL = {
  state: 'splash:state',
  action: 'splash:action'
} as const

/** Plain-text version of a report, for "Copy report" and bug reports. */
export function formatReport(r: HealthReport): string {
  const mark: Record<CheckStatus, string> = { pending: '-', running: '…', ok: 'OK', fixed: 'FIXED', warn: 'WARN', fail: 'FAIL' }
  return [
    `Pro Terminal ${r.version} start-up check, ${new Date(r.at).toLocaleString()} (${r.durationMs} ms)`,
    ...r.checks.map((c) => `[${mark[c.status]}] ${c.label}${c.detail ? `: ${c.detail}` : ''}`)
  ].join('\n')
}
