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
/** Built-in tools a snippet can open instead of typing its command. */
export type SnippetTool = 'power-timer'

export interface Snippet {
  id: string
  name: string
  command: string
  description?: string
  shell: SnippetShell
  mode: SnippetMode
  group?: string
  /** Opens this built-in tool when clicked; the command is then only a note for older versions. */
  tool?: SnippetTool
  createdAt: number
  updatedAt: number
  uses: number
  lastUsedAt?: number
}

/** What a shortcut does with its script once the shell is ready: press Enter, or only type it. */
export type LauncherMode = 'run' | 'insert'
/** Where the desktop shortcut opens: a tab in Pro Terminal, or a standalone console window. */
export type LauncherTarget = 'app' | 'window'

/**
 * 'shortcut': a fixed folder and a script, in the title bar and optionally on the desktop.
 * 'action': a script with no folder of its own, saved as a small program (.exe) that runs it in whatever
 * folder the file is opened from. Actions never appear in the title bar.
 */
export type LauncherKind = 'shortcut' | 'action'

/** A one-click shortcut: a shell opened in a folder, optionally running a script. Shown in the title bar. */
export interface Launcher {
  id: string
  kind: LauncherKind
  name: string
  /** What it does, in the user's words. Shown before a folder action runs. */
  description: string
  /** Accent the shortcut's icon is tinted with. */
  color: string
  /** Empty for folder actions: they run where they are opened. */
  folder: string
  shell: ShellId
  /** Typed exactly as saved; may be empty (just open the folder). Folder actions always have one. */
  script: string
  mode: LauncherMode
  target: LauncherTarget
  /** Folder actions: also run in every subfolder (deepest first), not only the folder itself. */
  recursive: boolean
  /** Shown in the title bar dock (otherwise only in the shortcuts menu). Always false for folder actions. */
  pinned: boolean
  /** The .lnk file created on the desktop for this shortcut, if any. */
  desktopLink?: string
  createdAt: number
  updatedAt: number
  uses: number
  lastUsedAt?: number
}

/** Icon images (PNG, base64) by pixel size, rendered by the renderer for a desktop shortcut. */
export type IconImages = { size: number; png: string }[]

/** What a folder action file carries: everything needed to show it and run it, on any PC. */
export interface ActionSpec {
  /** The library action the file was made from. */
  id: string
  name: string
  description: string
  color: string
  shell: ShellId
  script: string
  recursive: boolean
}

/** A request to run a folder action somewhere, waiting for the user's confirmation. */
export interface ActionRequest {
  action: ActionSpec
  /** The folder it runs in. */
  folder: string
  /** The action file that was opened, when it came from one. */
  file?: string
  /** The library action it was made from still exists, but has been edited since the file was made. */
  outdated?: boolean
  /** The file was not made from an action in this library (another PC, or deleted since). */
  foreign?: boolean
}

/** An action file that was opened but could not be read. */
export interface ActionFileError {
  file: string
  error: string
}

export type BuildActionResult = { ok: true; path: string } | { ok: false; error: string } | { ok: false; canceled: true }

export type PowerAction = 'shutdown' | 'restart' | 'sleep' | 'hibernate'

/** What the power timer does, and when. Times are the PC's local time. */
export interface PowerTimerSpec {
  action: PowerAction
  /** Time of day, 'HH:MM' (24-hour). */
  time: string
  /** Day of a one-off timer, 'YYYY-MM-DD'. Not used when it repeats. */
  date: string
  /** Weekdays it repeats on (0 = Sunday … 6 = Saturday); empty for a one-off timer. */
  days: number[]
  /** Seconds the warning window counts down before it happens; 0 shows no warning. */
  warn: number
  /** Shut down or restart even when apps with unsaved work object (they close without saving). */
  force: boolean
  /** Wake the PC from sleep to shut down or restart on time. */
  wake: boolean
}

/**
 * 'task': a Windows scheduled task, so it happens even with Pro Terminal closed.
 * 'app': Windows didn't allow a scheduled task, so Pro Terminal itself waits (it must stay open).
 */
export type PowerEngine = 'task' | 'app'

export interface PowerTimer extends PowerTimerSpec {
  id: string
  /** When it next happens (ms). */
  next: number
  engine: PowerEngine
  /** Why Windows refused the scheduled task, when the engine is 'app'. */
  engineNote?: string
  createdAt: number
  /** The warning window is counting down (or was postponed) and it happens at this moment. */
  warningUntil?: number
}

/** What this PC supports. 'modern': Modern Standby, where sleep starts by turning the screen off. */
export interface PowerCaps {
  sleep: 'standby' | 'modern' | 'none'
  hibernate: boolean
}

export type PowerScheduleResult = { ok: true; timer: PowerTimer } | { ok: false; error: string }

/** How a snippet group looks when the app starts. */
export type GroupStartState = 'expanded' | 'collapsed' | 'remember'

export interface TagDef {
  name: string
  color: string
}

export interface Library {
  favorites: FavoriteFolder[]
  snippets: Snippet[]
  launchers: Launcher[]
  tags: TagDef[]
  recentFolders: RecentFolder[]
  /** Last values typed for snippet variables, keyed by variable name. */
  snippetVars: Record<string, string>
  /** Snippet group names in the order the user arranged them. Groups not listed follow in first-appearance order. */
  snippetGroupOrder: string[]
  /** Groups that were collapsed when last toggled (used by the "remember" start state). */
  snippetGroupsCollapsed: string[]
  /** Built-in snippet packs already added once, so deleting them sticks. */
  seededPacks: string[]
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
