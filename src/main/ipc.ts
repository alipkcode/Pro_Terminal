import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { IPC } from '@shared/ipc'
import type { AppInfo, AppTheme, ArchivePatch, CreateSessionOptions, ExecOptions, IconImages, Launcher, Settings, ShellId, Snippet, TagDef, WindowMaterial } from '@shared/types'
import type { LibraryStore } from './store/library'
import type { SettingsStore } from './store/settings'
import { displayTitle, isSessionId, type SessionStore } from './store/sessions'
import { isObject } from './store/util'
import { isDirectory, type SessionManager } from './pty/manager'
import { detectShells } from './pty/shells'
import { getLastReport } from './health/report'
import { LauncherFiles, takePendingLaunchers } from './launchers'
import { TITLEBAR_HEIGHT } from './window'

interface Ctx {
  getWindow: () => BrowserWindow | null
  manager: SessionManager
  settings: SettingsStore
  library: LibraryStore
  store: SessionStore
  dataDir: string
  requestQuit: () => void
}

const SHELL_IDS: ShellId[] = ['cmd', 'powershell', 'pwsh']
const MATERIALS: WindowMaterial[] = ['none', 'mica', 'acrylic']
const THEMES: AppTheme[] = ['dark', 'light', 'system']
const COLOR_RE = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i

const safeFileName = (s: string): string => s.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').slice(0, 80) || 'session'

export function registerIpc(ctx: Ctx): void {
  const { manager, settings, library, store } = ctx
  const launcherFiles = new LauncherFiles(ctx.dataDir, settings)
  const handle = (channel: string, fn: (...args: any[]) => unknown): void => {
    ipcMain.handle(channel, (_e, ...args) => fn(...args))
  }
  const on = (channel: string, fn: (...args: any[]) => void): void => {
    ipcMain.on(channel, (_e, ...args) => fn(...args))
  }

  // ---------------------------------------------------------------- sessions
  handle(IPC.sessionsList, () => manager.list())
  handle(IPC.sessionsCreate, (opts: CreateSessionOptions) => manager.create(isObject(opts) ? opts : {}))
  handle(IPC.sessionsAttach, (id: string) => manager.attach(id))
  handle(IPC.sessionsKill, (id: string) => manager.close(id, 'closed'))
  handle(IPC.sessionsRestart, (id: string) => manager.restart(id))
  handle(IPC.sessionsSwitchShell, (id: string, shell: ShellId) => (SHELL_IDS.includes(shell) ? manager.switchShell(id, shell) : null))
  handle(IPC.sessionsRename, (id: string, title: string) => manager.rename(id, title))
  handle(IPC.sessionsReorder, (ids: string[]) => manager.reorder(ids))
  handle(IPC.sessionsExec, (id: string, text: string, opts: ExecOptions) => manager.exec(id, text, opts))
  handle(IPC.sessionsClearBuffer, (id: string) => manager.clearBuffer(id))
  on(IPC.sessionsWrite, (id: string, data: string) => manager.write(id, data))
  on(IPC.sessionsResize, (id: string, cols: number, rows: number) => manager.resize(id, cols, rows))
  on(IPC.sessionsAck, (id: string, chars: number) => manager.ack(id, chars))

  // ---------------------------------------------------------------- archive
  handle(IPC.archiveList, () => store.listArchived())
  handle(IPC.archiveLog, (id: string) => (isSessionId(id) ? store.readLog(id) : ''))
  handle(IPC.archiveUpdate, (id: string, patch: ArchivePatch) => {
    if (!isSessionId(id)) return
    store.update(id, patch)
    if (Array.isArray(patch?.tags)) library.ensureTags(store.get(id)?.tags ?? [])
  })
  handle(IPC.archiveDelete, (ids: string[]) => store.delete(Array.isArray(ids) ? ids.filter(isSessionId) : []))
  handle(IPC.archiveSearch, (q: string) => store.search(q))
  handle(IPC.archiveStats, () => store.stats())
  handle(IPC.archiveCleanup, (days: number) => store.cleanup(Number(days)))
  handle(IPC.archiveExport, async (id: string) => {
    if (!isSessionId(id)) return false
    const rec = store.get(id)
    const text = store.exportText(id)
    if (!rec || text === null) return false
    const date = new Date(rec.createdAt).toISOString().slice(0, 10)
    const win = ctx.getWindow()
    const opts = {
      title: 'Export session log',
      defaultPath: `${safeFileName(displayTitle(rec))}-${date}.txt`,
      filters: [{ name: 'Text', extensions: ['txt', 'log'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return false
    await writeFile(res.filePath, text, 'utf8')
    return true
  })

  // ---------------------------------------------------------------- library
  handle(IPC.libraryGet, () => library.data)
  handle(IPC.favoritesAdd, (path: string, name?: string, color?: string) =>
    typeof path === 'string' && isDirectory(path) ? library.addFavorite(path, name, color) : null
  )
  handle(IPC.favoritesUpdate, (id: string, patch: object) => library.updateFavorite(id, isObject(patch) ? patch : {}))
  handle(IPC.favoritesRemove, (id: string) => library.removeFavorite(id))
  handle(IPC.favoritesReorder, (ids: string[]) => library.reorderFavorites(ids))
  handle(IPC.snippetsUpsert, (s: Partial<Snippet>) => library.upsertSnippet(isObject(s) ? s : {}))
  handle(IPC.snippetsRemove, (id: string) => library.removeSnippet(id))
  handle(IPC.snippetsReorder, (ids: string[]) => library.reorderSnippets(ids))
  handle(IPC.snippetGroupsReorder, (names: string[]) => library.reorderSnippetGroups(Array.isArray(names) ? names : []))
  handle(IPC.snippetGroupsSetCollapsed, (name: string, collapsed: boolean) => library.setSnippetGroupCollapsed(name, collapsed === true))
  handle(IPC.snippetsUsed, (id: string, vars: Record<string, string>) => library.snippetUsed(id, isObject(vars) ? (vars as Record<string, string>) : {}))
  // ---------------------------------------------------------------- launchers (title bar shortcuts)
  handle(IPC.launchersUpsert, (l: Partial<Launcher>) => library.upsertLauncher(isObject(l) ? l : {}))
  handle(IPC.launchersRemove, (id: string) => {
    const l = typeof id === 'string' ? library.getLauncher(id) : undefined
    if (!l) return
    try {
      launcherFiles.removeDesktop(l)
    } catch (err) {
      console.warn('[launchers] could not remove desktop shortcut', err)
    }
    library.removeLauncher(l.id)
  })
  handle(IPC.launchersReorder, (ids: string[]) => library.reorderLaunchers(Array.isArray(ids) ? ids : []))
  handle(IPC.launchersUsed, (id: string) => typeof id === 'string' && library.launcherUsed(id))
  handle(IPC.launchersDesktopCreate, (id: string, icons: IconImages) => {
    const l = typeof id === 'string' ? library.getLauncher(id) : undefined
    if (!l) return { ok: false, error: 'This shortcut no longer exists.' }
    if (!isDirectory(l.folder)) return { ok: false, error: `The folder ${l.folder} was not found.` }
    try {
      const path = launcherFiles.writeDesktop(l, icons)
      library.setLauncherDesktopLink(l.id, path)
      return { ok: true, path }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  handle(IPC.launchersDesktopRemove, (id: string) => {
    const l = typeof id === 'string' ? library.getLauncher(id) : undefined
    if (!l) return
    try {
      launcherFiles.removeDesktop(l)
    } catch (err) {
      console.warn('[launchers] could not remove desktop shortcut', err)
    }
    library.setLauncherDesktopLink(l.id, undefined)
  })
  handle(IPC.launchersDesktopStatus, () => library.data.launchers.filter((l) => l.desktopLink && existsSync(l.desktopLink)).map((l) => l.id))
  handle(IPC.launchersTakePending, () => takePendingLaunchers())

  handle(IPC.tagsUpsert, (tag: TagDef, previous?: string) => {
    const res = library.upsertTag(tag, previous)
    if (res?.renamedFrom) store.renameTag(res.renamedFrom, res.name)
  })
  handle(IPC.tagsRemove, (name: string) => {
    library.removeTag(name)
    store.removeTag(name)
  })
  handle(IPC.recentRemove, (path: string) => library.removeRecent(String(path)))
  handle(IPC.recentClear, () => library.clearRecent())
  handle(IPC.libraryExport, async () => {
    const win = ctx.getWindow()
    const opts = {
      title: 'Export favorites & snippets',
      defaultPath: `pro-terminal-library-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return false
    await writeFile(res.filePath, JSON.stringify(library.exportData(), null, 2), 'utf8')
    return true
  })
  handle(IPC.libraryImport, async () => {
    const win = ctx.getWindow()
    const opts = { title: 'Import favorites & snippets', properties: ['openFile' as const], filters: [{ name: 'JSON', extensions: ['json'] }] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    try {
      return library.importData(JSON.parse(await readFile(res.filePaths[0], 'utf8')))
    } catch {
      return null
    }
  })

  // ---------------------------------------------------------------- settings
  handle(IPC.settingsGet, () => settings.get())
  handle(IPC.settingsSet, (patch: Partial<Settings>) => settings.set(isObject(patch) ? patch : {}))

  // ---------------------------------------------------------------- system
  handle(
    IPC.appInfo,
    (): AppInfo => ({ version: app.getVersion(), dataDir: ctx.dataDir, platform: process.platform, shells: detectShells(), health: getLastReport() })
  )
  handle(IPC.appQuit, () => ctx.requestQuit())
  handle(IPC.appOpenDataDir, () => shell.openPath(ctx.dataDir))
  handle(IPC.dialogPickFolder, async (defaultPath?: string) => {
    const win = ctx.getWindow()
    const opts = {
      title: 'Choose a folder',
      properties: ['openDirectory' as const],
      defaultPath: typeof defaultPath === 'string' && isDirectory(defaultPath) ? defaultPath : undefined
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  handle(IPC.fsIsDirectory, (p: string) => typeof p === 'string' && isDirectory(p))
  handle(IPC.shellOpenPath, async (p: string) => {
    if (typeof p === 'string' && isDirectory(p)) await shell.openPath(p)
  })
  handle(IPC.shellOpenExternal, async (url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) await shell.openExternal(url)
  })
  handle(IPC.clipboardRead, () => clipboard.readText())
  handle(IPC.clipboardWrite, (text: string) => clipboard.writeText(String(text ?? '')))
  handle(IPC.windowSetChrome, (opts: { theme: AppTheme; symbols: string; material: WindowMaterial; background: string }) => {
    const win = ctx.getWindow()
    if (!win || !isObject(opts)) return
    nativeTheme.themeSource = THEMES.includes(opts.theme) ? opts.theme : 'dark'
    const material = MATERIALS.includes(opts.material) ? opts.material : 'none'
    try {
      win.setBackgroundMaterial(material)
      win.setBackgroundColor(material === 'none' ? (COLOR_RE.test(opts.background) ? opts.background.slice(0, 7) : '#0b0e14') : '#00000000')
      win.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: COLOR_RE.test(opts.symbols) ? opts.symbols : '#c7cede',
        height: TITLEBAR_HEIGHT
      })
    } catch (err) {
      console.warn('[window] chrome update failed', err)
    }
  })
  handle(IPC.windowToggleDevtools, () => ctx.getWindow()?.webContents.toggleDevTools())
}
