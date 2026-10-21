import { app, BrowserWindow, nativeTheme } from 'electron'
import { IPC } from '@shared/ipc'
import { markCleanExit } from './health/checks'
import { registerIpc } from './ipc'
import { SessionManager } from './pty/manager'
import { LibraryStore } from './store/library'
import { SessionStore } from './store/sessions'
import { SettingsStore } from './store/settings'
import { createMainWindow } from './window'

/**
 * Starts the real app: stores, sessions, IPC and the main window. Runs after the start-up check passed
 * (see index.ts), so node-pty and the data files are known to be usable here.
 */
export function startApp(dataDir: string): BrowserWindow {
  const settings = new SettingsStore(dataDir)
  const library = new LibraryStore(dataDir)
  const store = new SessionStore(dataDir)

  let win: BrowserWindow | null = null
  let saveWindowState: () => void = () => {}
  const getWindow = (): BrowserWindow | null => (win && !win.isDestroyed() ? win : null)
  const send = (channel: string, ...args: unknown[]): void => {
    const w = getWindow()
    if (w && !w.webContents.isDestroyed()) w.webContents.send(channel, ...args)
  }

  const manager = new SessionManager({ settings, library, store, appVersion: app.getVersion(), send })

  settings.onChange((s) => send(IPC.evSettingsChanged, s))
  library.onChange((lib) => send(IPC.evLibraryChanged, lib))
  store.onArchiveChange(() => send(IPC.evArchiveChanged))

  // ---------------------------------------------------------------- quitting
  let quitting = false
  let readyToClose = false

  const shutdown = async (): Promise<void> => {
    if (quitting) return
    quitting = true
    saveWindowState()
    try {
      await manager.shutdown()
    } finally {
      settings.flush()
      library.flush()
      store.flush()
      markCleanExit(dataDir)
      readyToClose = true
      app.quit()
    }
  }

  registerIpc({ getWindow, manager, settings, library, store, dataDir, requestQuit: () => void shutdown() })

  // Revive sessions before the window exists so their shells start up in parallel with the UI.
  manager.restoreOnStartup()

  const s = settings.get()
  const dark = s.appTheme === 'dark' || (s.appTheme === 'system' && nativeTheme.shouldUseDarkColors)
  nativeTheme.themeSource = s.appTheme
  const created = createMainWindow(dataDir, s.windowMaterial, dark)
  win = created.win
  saveWindowState = created.saveState

  // A reload (or crash) of the renderer drops its terminals; it re-attaches when it comes back.
  win.webContents.on('did-start-loading', () => manager.detachAll())
  win.webContents.on('render-process-gone', () => manager.detachAll())

  win.on('close', (e) => {
    if (readyToClose) return
    e.preventDefault()
    if (quitting) return
    const req = manager.quitRequest()
    if (settings.get().confirmCloseRunning && req.busy.length) {
      send(IPC.evQuitRequested, req)
      return
    }
    void shutdown()
  })

  app.on('before-quit', (e) => {
    if (readyToClose) return
    e.preventDefault()
    void shutdown()
  })

  app.on('second-instance', () => {
    const w = getWindow()
    if (!w) return
    if (w.isMinimized()) w.restore()
    w.focus()
  })

  app.on('window-all-closed', () => app.quit())

  return win
}
