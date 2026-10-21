import { existsSync } from 'node:fs'
import { join, delimiter } from 'node:path'
import type { Settings, ShellFamily, ShellId, ShellInfo } from '@shared/types'

const env = process.env
const systemRoot = env.SystemRoot || env.windir || 'C:\\Windows'

function findOnPath(exe: string): string | null {
  for (const dir of (env.PATH || env.Path || '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, exe)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function detectPwsh(): string | null {
  const programFiles = [env.ProgramFiles, env['ProgramW6432'], 'C:\\Program Files'].filter(Boolean) as string[]
  const candidates = [
    ...programFiles.flatMap((pf) => [join(pf, 'PowerShell', '7', 'pwsh.exe'), join(pf, 'PowerShell', '7-preview', 'pwsh.exe')]),
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'pwsh.exe') : ''
  ].filter(Boolean)
  for (const c of candidates) if (existsSync(c)) return c
  return findOnPath('pwsh.exe')
}

let cached: ShellInfo[] | null = null

export function detectShells(): ShellInfo[] {
  if (cached) return cached
  const cmdPath = env.ComSpec && existsSync(env.ComSpec) ? env.ComSpec : join(systemRoot, 'System32', 'cmd.exe')
  const psPath = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const pwshPath = detectPwsh()
  cached = [
    { id: 'cmd', family: 'cmd', name: 'Command Prompt', shortName: 'CMD', path: cmdPath, available: existsSync(cmdPath) },
    { id: 'powershell', family: 'powershell', name: 'Windows PowerShell', shortName: 'PS', path: psPath, available: existsSync(psPath) },
    { id: 'pwsh', family: 'powershell', name: 'PowerShell 7', shortName: 'PS7', path: pwshPath ?? '', available: !!pwshPath }
  ]
  return cached
}

export function familyOf(id: ShellId): ShellFamily {
  return id === 'cmd' ? 'cmd' : 'powershell'
}

/** Resolve a requested shell (exact id or a family) to an installed shell. */
export function resolveShell(requested: ShellId | ShellFamily | undefined, settings: Settings): ShellInfo {
  const shells = detectShells()
  const byId = (id: ShellId) => shells.find((s) => s.id === id && s.available)
  const want = requested ?? settings.defaultShell
  if (want === 'pwsh') return byId('pwsh') ?? byId('powershell') ?? shells[0]
  if (want === 'powershell') {
    // The family name follows the preferred edition; the exact id 'powershell' is also the family name,
    // so a request for 'powershell' means "the user's PowerShell".
    if (settings.powershellEdition === 'pwsh') return byId('pwsh') ?? byId('powershell') ?? shells[0]
    return byId('powershell') ?? byId('pwsh') ?? shells[0]
  }
  return byId('cmd') ?? shells[0]
}

/** Resolve an exact shell id without applying the edition preference. */
export function exactShell(id: ShellId): ShellInfo | null {
  return detectShells().find((s) => s.id === id && s.available) ?? null
}

// ---------------------------------------------------------------------------------------------
// Shell integration
//
// Both shells are taught to emit invisible OSC escape sequences around their prompt:
//   OSC 133;D[;exit]  previous command finished      OSC 133;A  prompt starts
//   OSC 133;B         prompt ends (input starts)     OSC 9;9;<path>  current directory
//   OSC 633;E;<b64>   PowerShell: exact text of the command that just ran (from history)
// Nothing is written to the user's profile; the hooks only live inside the spawned process.
// ---------------------------------------------------------------------------------------------

const PS_INTEGRATION = String.raw`
if (-not $global:__PT) {
  $global:__PT = @{ Prompt = $function:prompt; Hist = -1; First = $true }
  function global:prompt {
    $ok = $?
    $code = $global:LASTEXITCODE
    $E = [char]27; $B = [char]7
    $s = ''
    $h = Get-History -Count 1
    if ($global:__PT.First) {
      # History so far is start-up (this script, profile); only commands after this prompt count.
      $global:__PT.First = $false
      if ($h) { $global:__PT.Hist = $h.Id }
      $s += "$E]133;D$B"
    } elseif ($h -and $h.Id -ne $global:__PT.Hist) {
      $global:__PT.Hist = $h.Id
      $ec = if ($ok) { 0 } elseif ($code -is [int] -and $code -ne 0) { $code } else { 1 }
      $cl = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($h.CommandLine))
      $s += "$E]633;E;$cl$B$E]133;D;$ec$B"
    } else { $s += "$E]133;D$B" }
    $loc = $executionContext.SessionState.Path.CurrentLocation
    if ($loc.Provider.Name -eq 'FileSystem') { $s += "$E]9;9;" + '"' + $loc.ProviderPath + '"' + "$B" }
    $p = if ($global:__PT.Prompt) { & $global:__PT.Prompt } else { "PS $loc$('>' * ($nestedPromptLevel + 1)) " }
    $global:LASTEXITCODE = $code
    "$s$E]133;A$B$p$E]133;B$B"
  }
}
`.trim()

const CMD_PROMPT_PREFIX = '$E]133;D$E\\$E]9;9;$P$E\\$E]133;A$E\\'
const CMD_PROMPT_SUFFIX = '$E]133;B$E\\'

export interface LaunchConfig {
  file: string
  args: string[]
  env: Record<string, string>
}

export function launchConfig(shell: ShellInfo, integration: boolean, appVersion: string): LaunchConfig {
  const childEnv: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (k.startsWith('ELECTRON_') || k === 'NODE_OPTIONS' || k === 'VITE_DEV_SERVER_URL') continue
    childEnv[k] = v
  }
  childEnv.TERM_PROGRAM = 'ProTerminal'
  childEnv.TERM_PROGRAM_VERSION = appVersion
  childEnv.COLORTERM = 'truecolor'

  if (shell.family === 'cmd') {
    if (integration) {
      const userPrompt = process.env.PROMPT && !process.env.PROMPT.includes(']133;') ? process.env.PROMPT : '$P$G'
      childEnv.PROMPT = CMD_PROMPT_PREFIX + userPrompt + CMD_PROMPT_SUFFIX
    }
    return { file: shell.path, args: [], env: childEnv }
  }

  const args = ['-NoLogo']
  if (integration) {
    const encoded = Buffer.from(PS_INTEGRATION, 'utf16le').toString('base64')
    args.push('-NoExit', '-EncodedCommand', encoded)
  }
  return { file: shell.path, args, env: childEnv }
}
