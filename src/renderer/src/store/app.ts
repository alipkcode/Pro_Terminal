import { create } from 'zustand'
import type { ReactNode } from 'react'
import { DEFAULT_LIBRARY, DEFAULT_SETTINGS } from '@shared/defaults'
import type { AppInfo, ArchivedSession, FavoriteFolder, Library, QuitRequest, SessionInfo, Settings, Snippet } from '@shared/types'
import type { SnippetVar } from '@/lib/snippets'

export type PanelId = 'sessions' | 'folders' | 'snippets'
export type Overlay = 'archive' | 'settings' | null
export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface ToastAction {
  label: string
  run: () => void
  primary?: boolean
}

export interface Toast {
  id: number
  kind: ToastKind
  title: string
  message?: string
  actions?: ToastAction[]
  duration: number
}

export interface ConfirmRequest {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

export interface VarsPrompt {
  snippet: Snippet
  vars: SnippetVar[]
  initial: Record<string, string>
  resolve: (values: Record<string, string> | null) => void
}

export interface ContextMenuItem {
  label?: string
  icon?: ReactNode
  hint?: string
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  run?: () => void
}

export interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

export type SettingsSection = 'general' | 'appearance' | 'terminal' | 'snippets' | 'archive' | 'shortcuts' | 'about'

interface State {
  ready: boolean
  info: AppInfo | null
  settings: Settings
  library: Library
  sessions: Record<string, SessionInfo>
  order: string[]
  activeId: string | null
  /** Archived session previewed in the main area instead of a live terminal. */
  viewerId: string | null
  archive: ArchivedSession[]
  panel: PanelId | null
  overlay: Overlay
  /** Section the settings dialog should switch to when it opens (consumed by the dialog). */
  settingsSection: SettingsSection | null
  archiveFocusId: string | null
  paletteOpen: boolean
  findOpen: boolean
  toasts: Toast[]
  confirm: ConfirmRequest | null
  snippetEditor: Partial<Snippet> | null
  favoriteEditor: FavoriteFolder | null
  varsPrompt: VarsPrompt | null
  quitRequest: QuitRequest | null
  contextMenu: ContextMenuState | null
  /** Snippet groups opened or closed by hand during this run, keyed by group name. Overrides the start state. */
  snippetGroupOpen: Record<string, boolean>
}

export const useApp = create<State>()(() => ({
  ready: false,
  info: null,
  settings: DEFAULT_SETTINGS,
  library: DEFAULT_LIBRARY,
  sessions: {},
  order: [],
  activeId: null,
  viewerId: null,
  archive: [],
  panel: readPanel(),
  overlay: null,
  settingsSection: null,
  archiveFocusId: null,
  paletteOpen: false,
  findOpen: false,
  toasts: [],
  confirm: null,
  snippetEditor: null,
  favoriteEditor: null,
  varsPrompt: null,
  quitRequest: null,
  contextMenu: null,
  snippetGroupOpen: {}
}))

function readPanel(): PanelId | null {
  try {
    const v = localStorage.getItem('pt.panel')
    return v === 'sessions' || v === 'folders' || v === 'snippets' ? v : v === 'none' ? null : 'sessions'
  } catch {
    return 'sessions'
  }
}

export const set = useApp.setState
export const get = useApp.getState

/** The live session currently shown, if any. */
export function useActiveSession(): SessionInfo | null {
  return useApp((s) => (s.activeId ? (s.sessions[s.activeId] ?? null) : null))
}
