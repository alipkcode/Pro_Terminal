import type {
  ActionFileError,
  ActionRequest,
  ActionSpec,
  AppInfo,
  AppTheme,
  ArchivePatch,
  ArchiveSearchHit,
  ArchiveStats,
  ArchivedSession,
  BuildActionResult,
  CreateSessionOptions,
  ExecOptions,
  ExecResult,
  FavoriteFolder,
  IconImages,
  Launcher,
  Library,
  QuitRequest,
  SessionInfo,
  Settings,
  ShellId,
  Snippet,
  TagDef,
  WindowMaterial
} from './types'

export type Unsubscribe = () => void

/** The API the preload script exposes to the renderer as `window.pt`. */
export interface PtApi {
  sessions: {
    list(): Promise<SessionInfo[]>
    create(opts: CreateSessionOptions): Promise<SessionInfo>
    /** Returns the terminal content so far; live data is streamed afterwards via onData. */
    attach(id: string): Promise<string>
    kill(id: string): Promise<void>
    restart(id: string): Promise<SessionInfo | null>
    switchShell(id: string, shell: ShellId): Promise<SessionInfo | null>
    rename(id: string, title: string): Promise<void>
    reorder(ids: string[]): Promise<void>
    exec(id: string, text: string, opts: ExecOptions): Promise<ExecResult>
    clearBuffer(id: string): Promise<void>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    ack(id: string, chars: number): void
    onData(cb: (id: string, data: string) => void): Unsubscribe
    onUpdated(cb: (info: SessionInfo) => void): Unsubscribe
    onRemoved(cb: (id: string) => void): Unsubscribe
    onReset(cb: (id: string) => void): Unsubscribe
  }
  archive: {
    list(): Promise<ArchivedSession[]>
    log(id: string): Promise<string>
    update(id: string, patch: ArchivePatch): Promise<void>
    remove(ids: string[]): Promise<void>
    exportLog(id: string): Promise<boolean>
    search(query: string): Promise<ArchiveSearchHit[]>
    stats(): Promise<ArchiveStats>
    cleanup(olderThanDays: number): Promise<number>
    onChanged(cb: () => void): Unsubscribe
  }
  library: {
    get(): Promise<Library>
    addFavorite(path: string, name?: string, color?: string): Promise<FavoriteFolder | null>
    updateFavorite(id: string, patch: Partial<Pick<FavoriteFolder, 'name' | 'color' | 'path'>>): Promise<void>
    removeFavorite(id: string): Promise<void>
    reorderFavorites(ids: string[]): Promise<void>
    upsertSnippet(snippet: Partial<Snippet> & Pick<Snippet, 'name' | 'command'>): Promise<Snippet>
    removeSnippet(id: string): Promise<void>
    reorderSnippets(ids: string[]): Promise<void>
    snippetUsed(id: string, vars: Record<string, string>): Promise<void>
    reorderSnippetGroups(names: string[]): Promise<void>
    setSnippetGroupCollapsed(name: string, collapsed: boolean): Promise<void>
    upsertTag(tag: TagDef, previousName?: string): Promise<void>
    removeTag(name: string): Promise<void>
    removeRecent(path: string): Promise<void>
    clearRecent(): Promise<void>
    exportLibrary(): Promise<boolean>
    importLibrary(): Promise<{ favorites: number; snippets: number; launchers: number } | null>
    onChanged(cb: (lib: Library) => void): Unsubscribe
  }
  launchers: {
    /** Create (no id) or update a shortcut; fields left out keep their value. */
    upsert(launcher: Partial<Launcher>): Promise<Launcher | null>
    remove(id: string): Promise<void>
    reorder(ids: string[]): Promise<void>
    used(id: string): Promise<void>
    /** Create (or refresh) the desktop shortcut, using icon images rendered by the renderer. */
    createDesktop(id: string, icons: IconImages): Promise<{ ok: true; path: string } | { ok: false; error: string }>
    removeDesktop(id: string): Promise<void>
    /** Ids of shortcuts whose desktop shortcut file still exists. */
    desktopStatus(): Promise<string[]>
    /** Shortcut ids requested from the command line (desktop shortcuts) and not handled yet. */
    takePending(): Promise<string[]>
    /** Fires for both shortcuts and folder action files opened while the app runs. */
    onPending(cb: () => void): Unsubscribe
  }
  actions: {
    /** Save a folder action as a program: on the desktop, or wherever the user picks in a save dialog. */
    build(id: string, icons: IconImages, dest: 'desktop' | 'choose'): Promise<BuildActionResult>
    /** Show a saved action file in Explorer. */
    reveal(path: string): Promise<void>
    /** Prepare a run in `folder`; returns the line to type into a session of the action's shell. */
    prepareRun(action: ActionSpec, folder: string, file?: string): Promise<{ ok: true; command: string } | { ok: false; error: string }>
    /** Folder action files opened (from Explorer) and not handled yet. */
    takePending(): Promise<{ requests: ActionRequest[]; errors: ActionFileError[] }>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
    onChanged(cb: (s: Settings) => void): Unsubscribe
  }
  system: {
    info(): Promise<AppInfo>
    quit(force: boolean): Promise<void>
    openDataDir(): Promise<void>
    onQuitRequested(cb: (req: QuitRequest) => void): Unsubscribe
    pickFolder(defaultPath?: string): Promise<string | null>
    isDirectory(path: string): Promise<boolean>
    openPath(path: string): Promise<void>
    openExternal(url: string): Promise<void>
    readClipboard(): Promise<string>
    writeClipboard(text: string): Promise<void>
    setChrome(opts: { theme: AppTheme; symbols: string; material: WindowMaterial; background: string }): Promise<void>
    toggleDevtools(): Promise<void>
    pathForFile(file: File): string
  }
}
