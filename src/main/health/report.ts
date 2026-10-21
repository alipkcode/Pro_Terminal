import type { HealthReport } from '@shared/health'

// The report from this start-up, shown in Settings > About.
let last: HealthReport | null = null

export function setLastReport(r: HealthReport): void {
  last = r
}

export function getLastReport(): HealthReport | null {
  return last
}
