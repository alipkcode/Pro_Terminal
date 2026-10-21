import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { PtApi, Unsubscribe } from '@shared/api'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: PtApi = {
  sessions: {
    list: () => invoke(IPC.sessionsList),
    create: (opts) => invoke(IPC.sessionsCreate, opts),
    attach: (id) => invoke(IPC.sessionsAttach, id),
    kill: (id) => invoke(IPC.sessionsKill, id),
    restart: (id) => invoke(IPC.sessionsRestart, id),
    switchShell: (id, shell) => invoke(IPC.sessionsSwitchShell, id, shell),
    rename: (id, title) => invoke(IPC.sessionsRename, id, title),
    reorder: (ids) => invoke(IPC.sessionsReorder, ids),
    exec: (id, text, opts) => invoke(IPC.sessionsExec, id, text, opts),
    clearBuffer: (id) => invoke(IPC.sessionsClearBuffer, id),
    write: (id, data) => ipcRenderer.send(IPC.sessionsWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.sessionsResize, id, cols, rows),
    ack: (id, chars) => ipcRenderer.send(IPC.sessionsAck, id, chars),
    onData: (cb) => subscribe(IPC.evData, cb),
    onUpdated: (cb) => subscribe(IPC.evSessionUpdated, cb),
    onRemoved: (cb) => subscribe(IPC.evSessionRemoved, cb),
    onReset: (cb) => subscribe(IPC.evSessionReset, cb)
  },
  archive: {
    list: () => invoke(IPC.archiveList),
    log: (id) => invoke(IPC.archiveLog, id),
    update: (id, patch) => invoke(IPC.archiveUpdate, id, patch),
    remove: (ids) => invoke(IPC.archiveDelete, ids),
    exportLog: (id) => invoke(IPC.archiveExport, id),
    search: (q) => invoke(IPC.archiveSearch, q),
    stats: () => invoke(IPC.archiveStats),
    cleanup: (days) => invoke(IPC.archiveCleanup, days),
    onChanged: (cb) => subscribe(IPC.evArchiveChanged, cb)
  },
  library: {
    get: () => invoke(IPC.libraryGet),
    addFavorite: (path, name, color) => invoke(IPC.favoritesAdd, path, name, color),
    updateFavorite: (id, patch) => invoke(IPC.favoritesUpdate, id, patch),
    removeFavorite: (id) => invoke(IPC.favoritesRemove, id),
    reorderFavorites: (ids) => invoke(IPC.favoritesReorder, ids),
    upsertSnippet: (s) => invoke(IPC.snippetsUpsert, s),
    removeSnippet: (id) => invoke(IPC.snippetsRemove, id),
    reorderSnippets: (ids) => invoke(IPC.snippetsReorder, ids),
    snippetUsed: (id, vars) => invoke(IPC.snippetsUsed, id, vars),
    reorderSnippetGroups: (names) => invoke(IPC.snippetGroupsReorder, names),
    setSnippetGroupCollapsed: (name, collapsed) => invoke(IPC.snippetGroupsSetCollapsed, name, collapsed),
    upsertTag: (tag, prev) => invoke(IPC.tagsUpsert, tag, prev),
    removeTag: (name) => invoke(IPC.tagsRemove, name),
    removeRecent: (path) => invoke(IPC.recentRemove, path),
    clearRecent: () => invoke(IPC.recentClear),
    exportLibrary: () => invoke(IPC.libraryExport),
    importLibrary: () => invoke(IPC.libraryImport),
    onChanged: (cb) => subscribe(IPC.evLibraryChanged, cb)
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    set: (patch) => invoke(IPC.settingsSet, patch),
    onChanged: (cb) => subscribe(IPC.evSettingsChanged, cb)
  },
  system: {
    info: () => invoke(IPC.appInfo),
    quit: (force) => invoke(IPC.appQuit, force),
    openDataDir: () => invoke(IPC.appOpenDataDir),
    onQuitRequested: (cb) => subscribe(IPC.evQuitRequested, cb),
    pickFolder: (defaultPath) => invoke(IPC.dialogPickFolder, defaultPath),
    isDirectory: (p) => invoke(IPC.fsIsDirectory, p),
    openPath: (p) => invoke(IPC.shellOpenPath, p),
    openExternal: (url) => invoke(IPC.shellOpenExternal, url),
    readClipboard: () => invoke(IPC.clipboardRead),
    writeClipboard: (text) => invoke(IPC.clipboardWrite, text),
    setChrome: (opts) => invoke(IPC.windowSetChrome, opts),
    toggleDevtools: () => invoke(IPC.windowToggleDevtools),
    pathForFile: (file) => webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('pt', api)
