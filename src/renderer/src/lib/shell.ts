import type { ShellFamily, ShellId, SnippetShell } from '@shared/types'

export const familyOf = (id: ShellId): ShellFamily => (id === 'cmd' ? 'cmd' : 'powershell')

export const SHELL_META: Record<ShellId, { name: string; short: string; color: string }> = {
  cmd: { name: 'Command Prompt', short: 'CMD', color: 'var(--cmd)' },
  powershell: { name: 'Windows PowerShell', short: 'PS', color: 'var(--ps)' },
  pwsh: { name: 'PowerShell 7', short: 'PS7', color: 'var(--ps)' }
}

export const FAMILY_LABEL: Record<ShellFamily, string> = { cmd: 'CMD', powershell: 'PowerShell' }

/** The command that changes directory in the given shell, quoted safely. */
export function cdCommand(shell: ShellId, path: string): string {
  if (familyOf(shell) === 'cmd') return `cd /d "${path.replace(/"/g, '')}"`
  return `Set-Location -LiteralPath '${path.replace(/'/g, "''")}'`
}

/** Quote a path so it can be typed into the shell as one argument. */
export function quotePath(shell: ShellId, path: string): string {
  if (!/[\s&()[\]{}^=;!'+,`~]/.test(path)) return path
  if (familyOf(shell) === 'cmd') return `"${path.replace(/"/g, '')}"`
  return `'${path.replace(/'/g, "''")}'`
}

export function snippetFits(snippetShell: SnippetShell, shell: ShellId): boolean {
  return snippetShell === 'any' || snippetShell === familyOf(shell)
}
