import type { Library, Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  defaultShell: 'powershell',
  powershellEdition: 'pwsh',
  startDirectory: 'home',
  customStartDirectory: '',
  restoreSessions: true,
  closeOnExit: 'clean',
  confirmCloseRunning: true,
  appTheme: 'dark',
  terminalTheme: 'pro-midnight',
  windowMaterial: 'mica',
  fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, 'Courier New', monospace",
  fontSize: 14,
  lineHeight: 1.2,
  letterSpacing: 0,
  cursorStyle: 'bar',
  cursorBlink: true,
  scrollback: 5000,
  copyOnSelect: false,
  rightClick: 'menu',
  pasteWarning: true,
  bell: 'visual',
  gpuAcceleration: true,
  shellIntegration: true,
  useBundledConpty: true,
  archiveRetentionDays: 0,
  snippetGroupDefault: 'expanded',
  snippetGroupStates: {},
  lastCwd: ''
}

export const DEFAULT_LIBRARY: Library = {
  favorites: [],
  snippets: [],
  tags: [
    { name: 'important', color: '#f87171' },
    { name: 'deploy', color: '#a78bfa' },
    { name: 'debug', color: '#fbbf24' }
  ],
  recentFolders: [],
  snippetVars: {},
  snippetGroupOrder: [],
  snippetGroupsCollapsed: []
}

/** Colors offered for tags, favorites and other user-colored items. */
export const ACCENT_SWATCHES = [
  '#60a5fa',
  '#34d399',
  '#fbbf24',
  '#f87171',
  '#a78bfa',
  '#f472b6',
  '#22d3ee',
  '#fb923c',
  '#94a3b8'
]

export const LIMITS = {
  commandsPerSession: 300,
  recentFolders: 15,
  snippetCommandLength: 20000,
  nameLength: 120,
  groupNameLength: 60,
  snippetGroups: 500
}
