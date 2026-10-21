import type { HealthReport } from './health'
// Types shared by the main process, the preload bridge and the renderer.

export type ShellId = 'cmd' | 'powershell' | 'pwsh'
export type ShellFamily = 'cmd' | 'powershell'

export interface ShellInfo {
  id: ShellId
  family: ShellFamily
  name: string
  shortName: string
  path: string
  available: boolean
}

export type SessionStatus = 'starting' | 'idle' | 'busy' | 'exited'

export interface CommandRecord {
  id: number
  text: string
  cwd: string
  startedAt: number
  endedAt?: number
  exitCode?: number
}

/** A live session backed by a running (or just-exited) shell process. */
export interface SessionInfo {
  id: string
  shell: ShellId
  title: string
  customTitle?: string
  cwd: string
  status: SessionStatus
  exitCode?: number
  pid: number
  createdAt: number
  /** No command has been executed yet, so the shell can be swapped in place. */
  pristine: boolean
  /** Shell integration markers have been received from the shell. */
  integration: boolean
  commands: CommandRecord[]
  currentCommand?: { text: string; startedAt: number }
  lastExitCode?: number
  gitBranch?: string
  restoredAt?: number
}

export type EndReason = 'exit' | 'closed' | 'app-quit'

/** A session that has ended and lives in the archive together with its output log. */
export interface ArchivedSession {
  id: string
  shell: ShellId
  title: string
  customTitle?: string
  cwd: string
  initialCwd: string
  createdAt: number
  endedAt: number
  exitCode?: number
  endReason: EndReason
  tags: string[]
  pinned: boolean
  note?: string
  commands: CommandRecord[]
  logBytes: number
}

export interface ArchivePatch {
  customTitle?: string | null
  tags?: string[]
  pinned?: boolean
  note?: string
}

export interface ArchiveSearchHit {
  id: string
  excerpt: string
}

export interface ArchiveStats {
  count: number
  bytes: number
}

export interface FavoriteFolder {
  id: string
  path: string
  name: string
  color?: string
  createdAt: number
}

export interface RecentFolder {
  path: string
  lastUsedAt: number
  count: number
}

export type SnippetMode = 'run' | 'insert' | 'copy'
export type SnippetShell = 'any' | ShellFamily

export interface Snippet {
  id: string
  name: string
  command: string
  description?: string
  shell: SnippetShell
  mode: SnippetMode
  group?: string
  createdAt: number
  updatedAt: number
  uses: number
  lastUsedAt?: number
}

/** How a snippet group looks when the app starts. */
export type GroupStartState = 'expanded' | 'collapsed' | 'remember'

export interface TagDef {
  name: string
  color: string
}

export interface Library {
  favorites: FavoriteFolder[]
  snippets: Snippet[]
  tags: TagDef[]
  recentFolders: RecentFolder[]
  /** Last values typed for snippet variables, keyed by variable name. */
  snippetVars: Record<string, string>
  /** Snippet group names in the order the user arranged them. Groups not listed follow in first-appearance order. */
  snippetGroupOrder: string[]
  /** Groups that were collapsed when last toggled (used by the "remember" start state). */
  snippetGroupsCollapsed: string[]
}

export type AppTheme = 'dark' | 'light' | 'system'
export type WindowMaterial = 'none' | 'mica' | 'acrylic'
export type CloseOnExit = 'clean' | 'always' | 'never'
export type StartDirectory = 'home' | 'last' | 'custom'

export interface Settings {
  defaultShell: ShellFamily
  powershellEdition: 'powershell' | 'pwsh'
  startDirectory: StartDirectory
  customStartDirectory: string
  restoreSessions: boolean
  closeOnExit: CloseOnExit
  confirmCloseRunning: boolean
  appTheme: AppTheme
  terminalTheme: string
  windowMaterial: WindowMaterial
  fontFamily: string
  fontSize: number
  lineHeight: number
  letterSpacing: number
  cursorStyle: 'block' | 'bar' | 'underline'
  cursorBlink: boolean
  scrollback: number
  copyOnSelect: boolean
  rightClick: 'menu' | 'copyPaste'
  pasteWarning: boolean
  bell: 'none' | 'visual' | 'sound'
  gpuAcceleration: boolean
  shellIntegration: boolean
  useBundledConpty: boolean
  archiveRetentionDays: number
  /** Start state for snippet groups without their own choice, including new groups. */
  snippetGroupDefault: GroupStartState
  /** Start state chosen for individual snippet groups, keyed by group name. */
  snippetGroupStates: Record<string, GroupStartState>
  lastCwd: string
}

export interface CreateSessionOptions {
  shell?: ShellId | ShellFamily
  /** Treat `shell: 'powershell'` as Windows PowerShell instead of the preferred edition. */
  exact?: boolean
  cwd?: string
  title?: string
  /** Start a new session that continues from an archived one (same shell, cwd and previous output). */
  resumeFrom?: string
}

export interface ExecOptions {
  /** Press Enter after typing. */
  execute: boolean
  /** Clear whatever is currently typed on the prompt first. */
  clearLine: boolean
}

export type ExecResult = { ok: true } | { ok: false; reason: 'busy' | 'exited' | 'not-found' }

export interface AppInfo {
  version: string
  dataDir: string
  platform: string
  shells: ShellInfo[]
  /** This start-up's health check. */
  health: HealthReport | null
}

export interface QuitRequest {
  busy: { id: string; title: string; command?: string }[]
}
