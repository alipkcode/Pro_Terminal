import { get, set } from '@/store/app'
import { getController } from '@/terminal/registry'
import {
  activateIndex,
  closeSession,
  cycleSession,
  newSession,
  openArchive,
  openPalette,
  openSettings,
  resolveFamily,
  togglePanel,
  zoom
} from './actions'
import { openLauncherManager } from './launchers'

export interface Shortcut {
  keys: string
  label: string
}

/** Shown in the settings dialog and the command palette. */
export const SHORTCUTS: Shortcut[] = [
  { keys: 'Ctrl+Shift+P', label: 'Command palette' },
  { keys: 'Ctrl+Shift+T', label: 'New session (default shell)' },
  { keys: 'Ctrl+Shift+1', label: 'New CMD session' },
  { keys: 'Ctrl+Shift+2', label: 'New PowerShell session' },
  { keys: 'Ctrl+Shift+W', label: 'Close session' },
  { keys: 'Ctrl+Tab / Ctrl+Shift+Tab', label: 'Next / previous session' },
  { keys: 'Ctrl+1 … Ctrl+9', label: 'Go to session 1 … last' },
  { keys: 'Ctrl+Shift+F', label: 'Find in terminal' },
  { keys: 'Ctrl+↑ / Ctrl+↓', label: 'Jump to previous / next command' },
  { keys: 'Ctrl+Shift+B', label: 'Toggle side panel' },
  { keys: 'Ctrl+Shift+E', label: 'Folders panel' },
  { keys: 'Ctrl+Shift+S', label: 'Snippets panel' },
  { keys: 'Ctrl+Shift+H', label: 'Archive' },
  { keys: 'Ctrl+Shift+L', label: 'Shortcuts (folder + script launchers)' },
  { keys: 'Ctrl+,', label: 'Settings' },
  { keys: 'Ctrl+= / Ctrl+- / Ctrl+0', label: 'Zoom in / out / reset' },
  { keys: 'Ctrl+C / Ctrl+V', label: 'Copy selection / paste' }
]

/** Global shortcuts, handled in the capture phase so the shell never receives them. */
export function handleGlobalKey(e: KeyboardEvent): boolean {
  if (e.type !== 'keydown' || e.altKey || e.metaKey) return false
  const ctrl = e.ctrlKey
  const shift = e.shiftKey
  const code = e.code
  const state = get()
  const modalOpen = !!(
    state.confirm ||
    state.varsPrompt ||
    state.snippetEditor ||
    state.favoriteEditor ||
    state.quitRequest ||
    state.launcherEditor ||
    state.launcherManager ||
    state.powerOpen ||
    state.actionQueue.length > 0
  )

  if (e.key === 'F1' || (ctrl && shift && code === 'KeyP')) {
    if (!modalOpen) openPalette()
    return true
  }
  if (!ctrl) return false
  if (modalOpen) return false

  if (shift) {
    switch (code) {
      case 'KeyT':
        void newSession()
        return true
      case 'Digit1':
        void newSession({ shell: 'cmd' })
        return true
      case 'Digit2':
        void newSession({ shell: resolveFamily('powershell'), exact: true })
        return true
      case 'KeyW':
        if (state.activeId) void closeSession(state.activeId)
        return true
      case 'KeyF':
        if (state.activeId && !state.overlay) set({ findOpen: true })
        return true
      case 'KeyB':
        togglePanel(state.panel ?? 'sessions')
        return true
      case 'KeyE':
        togglePanel('folders')
        return true
      case 'KeyS':
        togglePanel('snippets')
        return true
      case 'KeyH':
        if (state.overlay === 'archive') set({ overlay: null })
        else openArchive()
        return true
      case 'KeyL':
        openLauncherManager()
        return true
      case 'Tab':
        cycleSession(-1)
        return true
    }
    return false
  }

  switch (code) {
    case 'Tab':
      cycleSession(1)
      return true
    case 'Comma':
      openSettings()
      return true
    case 'Equal':
    case 'NumpadAdd':
      zoom(1)
      return true
    case 'Minus':
    case 'NumpadSubtract':
      zoom(-1)
      return true
    case 'Digit0':
    case 'Numpad0':
      zoom(0)
      return true
    case 'ArrowUp':
    case 'ArrowDown': {
      if (state.overlay || state.viewerId) return false
      const c = getController(state.activeId)
      if (!c) return false
      c.scrollToPrompt(code === 'ArrowUp' ? -1 : 1)
      return true
    }
  }
  if (/^Digit[1-9]$/.test(code)) {
    activateIndex(Number(code.slice(5)) - 1)
    return true
  }
  return false
}
