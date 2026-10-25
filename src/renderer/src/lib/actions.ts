import type { AppInfo, CreateSessionOptions, FavoriteFolder, GroupStartState, SessionInfo, Settings, ShellFamily, ShellId, Snippet, SnippetMode } from '@shared/types'
import { api } from '@/api'
import { get, set, useApp, type ConfirmRequest, type PanelId, type SettingsSection, type ToastAction, type ToastKind } from '@/store/app'
import { allControllers, disposeController, ensureController, getController, setControllerHooks } from '@/terminal/registry'
import type { TerminalController } from '@/terminal/controller'
import { getTerminalTheme } from '@/terminal/themes'
import { cdCommand, familyOf, FAMILY_LABEL, quotePath, SHELL_META } from './shell'
import { expandSnippet, groupSnippets, snippetVariables, usesBuiltin, EXAMPLE_SNIPPETS } from './snippets'
import { folderName, samePath } from './format'
import { refreshDesktopStatus, runPendingActions, runPendingLaunchers } from './launchers'

// ===================================================================== feedback

let toastSeq = 0

export function toast(kind: ToastKind, title: string, opts: { message?: string; actions?: ToastAction[]; duration?: number } = {}): number {
  const id = ++toastSeq
  const duration = opts.duration ?? (opts.actions?.length ? 7000 : kind === 'error' ? 6000 : 3200)
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, title, message: opts.message, actions: opts.actions, duration }] }))
  return id
}

export function dismissToast(id: number): void {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

export function confirm(req: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    set({
      confirm: {
        ...req,
        resolve: (ok) => {
          set({ confirm: null })
          resolve(ok)
        }
      }
    })
  })
}

// ===================================================================== sessions (local state)

const attachStarted = new Set<string>()

function upsertSessionLocal(info: SessionInfo): void {
  set((s) => ({
    sessions: { ...s.sessions, [info.id]: info },
    order: s.order.includes(info.id) ? s.order : [...s.order, info.id]
  }))
  const ctrl = ensureController(info.id)
  if (!attachStarted.has(info.id)) {
    attachStarted.add(info.id)
    void ctrl.attach()
  }
}

function removeSessionLocal(id: string): void {
  const { order, activeId } = get()
  const idx = order.indexOf(id)
  const nextOrder = order.filter((x) => x !== id)
  const sessions = { ...get().sessions }
  delete sessions[id]
  let nextActive = activeId
  if (activeId === id) nextActive = nextOrder[Math.min(idx, nextOrder.length - 1)] ?? null
  set({ sessions, order: nextOrder, activeId: nextActive })
  attachStarted.delete(id)
  disposeController(id)
  if (nextActive !== activeId) rememberActive(nextActive)
  focusActive()
}

function rememberActive(id: string | null): void {
  try {
    if (id) localStorage.setItem('pt.active', id)
  } catch {
    /* storage unavailable */
  }
}

/** Resolve once the shell has printed its first prompt (or give up after a while). */
export function waitForReady(id: string, timeout = 10000): Promise<SessionInfo | null> {
  return new Promise((resolve) => {
    const check = (): SessionInfo | null | undefined => {
      const s = get().sessions[id]
      if (!s) return null
      return s.status === 'starting' ? undefined : s
    }
    const now = check()
    if (now !== undefined) return resolve(now)
    let unsub: () => void = () => {}
    const timer = window.setTimeout(() => {
      unsub()
      resolve(get().sessions[id] ?? null)
    }, timeout)
    unsub = useAppSubscribe(() => {
      const r = check()
      if (r !== undefined) {
        window.clearTimeout(timer)
        unsub()
        resolve(r)
      }
    })
  })
}

const useAppSubscribe = (fn: () => void): (() => void) => useApp.subscribe(fn)

// ===================================================================== boot

export async function boot(): Promise<void> {
  setControllerHooks({
    onContextMenu: openTerminalMenu,
    onPaste: (c) => void pasteInto(c),
    onCopy: copySelection,
    onBell: ringBell,
    onOpenLink: (url) => void api.system.openExternal(url)
  })

  api.sessions.onData((id, data) => getController(id)?.write(data))
  api.sessions.onUpdated((info) => upsertSessionLocal(info))
  api.sessions.onRemoved((id) => removeSessionLocal(id))
  api.sessions.onReset((id) => getController(id)?.reset())
  api.archive.onChanged(() => void refreshArchive())
  api.library.onChanged((library) => set({ library }))
  api.settings.onChanged((s) => applySettings(s))
  api.system.onQuitRequested((req) => set({ quitRequest: req }))
  api.power.onChanged((powerTimer) => set({ powerTimer }))
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyChrome(get().settings))

  const [info, settings, library, sessions] = await Promise.all([
    api.system.info(),
    api.settings.get(),
    api.library.get(),
    api.sessions.list()
  ])
  set({ info, settings, library })
  applyChrome(settings)
  void api.power.get().then((powerTimer) => set({ powerTimer }))
  void refreshDesktopStatus()
  await refreshArchive()

  api.launchers.onPending(() => {
    // Before boot finishes, the queue is taken below instead.
    if (!get().ready) return
    void runPendingLaunchers()
    void runPendingActions()
  })
  for (const s of sessions) upsertSessionLocal(s)
  let saved: string | null = null
  try {
    saved = localStorage.getItem('pt.active')
  } catch {
    /* ignore */
  }
  const active = sessions.find((s) => s.id === saved)?.id ?? sessions[sessions.length - 1]?.id ?? null
  set({ ready: true, activeId: active })
  // Started from a desktop shortcut: its tab is the one to show, so no extra blank session.
  const launched = await runPendingLaunchers()
  // Started from a folder action file: its confirmation comes first, and opens the tab (or a blank one).
  const confirming = await runPendingActions()
  if (!sessions.length && !launched && !confirming) await newSession()
  else if (!launched && !confirming) focusActive()
  reportStartupCheck(info)
}

/** The splash already showed the check; repairs and warnings get a reminder here so they are not missed. */
function reportStartupCheck(info: AppInfo): void {
  const notable = info.health?.checks.filter((c) => c.status === 'warn' || c.status === 'fixed') ?? []
  if (!notable.length) return
  const warn = notable.some((c) => c.status === 'warn')
  toast(warn ? 'warning' : 'info', warn ? 'Start-up check found a problem' : 'Start-up check repaired something', {
    message: notable.map((c) => c.detail ?? c.label).join('\n'),
    actions: [{ label: 'Details', run: () => openSettingsAt('about') }],
    duration: 9000
  })
}

// ===================================================================== settings & theme

export function applySettings(s: Settings): void {
  const prev = get().settings
  set({ settings: s })
  for (const c of allControllers()) c.applySettings(s)
  if (prev.appTheme !== s.appTheme || prev.windowMaterial !== s.windowMaterial || prev.terminalTheme !== s.terminalTheme) applyChrome(s)
}

export function resolvedDark(s: Settings): boolean {
  return s.appTheme === 'dark' || (s.appTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

export function applyChrome(s: Settings): void {
  const dark = resolvedDark(s)
  const root = document.documentElement
  root.dataset.theme = dark ? 'dark' : 'light'
  root.dataset.material = s.windowMaterial
  const termBg = getTerminalTheme(s.terminalTheme).colors.background ?? '#0d1017'
  root.style.setProperty('--term-bg', termBg)
  void api.system.setChrome({
    theme: s.appTheme,
    material: s.windowMaterial,
    symbols: dark ? '#c7cede' : '#2b3040',
    background: dark ? '#0b0e14' : '#f3f5fa'
  })
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  applySettings({ ...get().settings, ...patch })
  await api.settings.set(patch)
}

export function zoom(delta: number | 0): void {
  const size = delta === 0 ? 14 : Math.max(8, Math.min(32, get().settings.fontSize + delta))
  void updateSettings({ fontSize: size })
}

// ===================================================================== session actions

export async function newSession(opts: CreateSessionOptions = {}): Promise<SessionInfo | null> {
  try {
    const info = await api.sessions.create(opts)
    upsertSessionLocal(info)
    activate(info.id)
    return info
  } catch (err) {
    toast('error', 'Could not start the shell', { message: String(err) })
    return null
  }
}

export function activate(id: string): void {
  if (!get().sessions[id]) return
  set({ activeId: id, viewerId: null })
  rememberActive(id)
  focusActive()
}

export function focusActive(): void {
  requestAnimationFrame(() => {
    const { activeId, viewerId, overlay, paletteOpen, powerOpen } = get()
    if (viewerId || overlay || paletteOpen || powerOpen) return
    getController(activeId)?.focus()
  })
}

export function activeSession(): SessionInfo | null {
  const { activeId, sessions } = get()
  return activeId ? (sessions[activeId] ?? null) : null
}

export async function closeSession(id: string): Promise<void> {
  const s = get().sessions[id]
  if (!s) return
  if (s.status === 'busy' && get().settings.confirmCloseRunning) {
    const ok = await confirm({
      title: 'Close a running session?',
      message: s.currentCommand ? `“${s.currentCommand.text}” is still running. Closing the session stops it.` : 'A command is still running in this session.',
      confirmLabel: 'Close session',
      danger: true
    })
    if (!ok) return
  }
  await api.sessions.kill(id)
}

export function cycleSession(dir: 1 | -1): void {
  const { order, activeId } = get()
  if (!order.length) return
  const idx = activeId ? order.indexOf(activeId) : -1
  activate(order[(idx + dir + order.length) % order.length])
}

export function activateIndex(i: number): void {
  const { order } = get()
  const id = i >= 8 ? order[order.length - 1] : order[i]
  if (id) activate(id)
}

export async function renameSession(id: string, title: string): Promise<void> {
  await api.sessions.rename(id, title)
}

export function reorderSessions(ids: string[]): void {
  set({ order: ids })
  void api.sessions.reorder(ids)
}

export async function restartSession(id: string): Promise<void> {
  const info = await api.sessions.restart(id)
  if (info) upsertSessionLocal(info)
  activate(id)
}

/** The shell toggle: swap a blank session in place, otherwise offer a new session. */
export async function switchActiveShell(family: ShellFamily): Promise<'switched' | 'blocked' | 'created' | 'same'> {
  const s = activeSession()
  const target = resolveFamily(family)
  if (!s) {
    await updateSettings({ defaultShell: family })
    await newSession({ shell: target, exact: true })
    return 'created'
  }
  if (familyOf(s.shell) === family) return 'same'
  if (!s.pristine || s.status === 'busy' || s.status === 'exited') return 'blocked'
  const info = await api.sessions.switchShell(s.id, target)
  if (!info) return 'blocked'
  upsertSessionLocal(info)
  void updateSettings({ defaultShell: family })
  focusActive()
  return 'switched'
}

/** Pick the concrete shell for a family (PowerShell edition preference + availability). */
export function resolveFamily(family: ShellFamily): ShellId {
  if (family === 'cmd') return 'cmd'
  const shells = get().info?.shells ?? []
  const pwsh = shells.find((x) => x.id === 'pwsh' && x.available)
  return get().settings.powershellEdition === 'pwsh' && pwsh ? 'pwsh' : 'powershell'
}

export async function clearTerminal(id = get().activeId): Promise<void> {
  if (!id) return
  getController(id)?.clear()
  await api.sessions.clearBuffer(id)
  focusActive()
}

// ===================================================================== clipboard

export function copySelection(ctrl?: TerminalController): void {
  const c = ctrl ?? getController(get().activeId)
  const text = c?.term.getSelection()
  if (!c || !text) return
  void api.system.writeClipboard(text)
  c.term.clearSelection()
}

export async function pasteInto(ctrl?: TerminalController): Promise<void> {
  const c = ctrl ?? getController(get().activeId)
  if (!c) return
  const text = await api.system.readClipboard()
  if (!text) return
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
  if (lines.length > 1 && get().settings.pasteWarning) {
    const preview = lines.slice(0, 6).join('\n') + (lines.length > 6 ? `\n… ${lines.length - 6} more` : '')
    const ok = await confirm({
      title: `Paste ${lines.length} lines?`,
      message: preview,
      confirmLabel: 'Paste'
    })
    if (!ok) {
      c.focus()
      return
    }
  }
  c.term.paste(text)
  c.focus()
}

function ringBell(c: TerminalController): void {
  const mode = get().settings.bell
  if (mode === 'none') return
  if (mode === 'sound') {
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.06, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15)
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.16)
      osc.onended = () => void ctx.close()
    } catch {
      /* audio unavailable */
    }
    return
  }
  const pane = c.el.closest('.term-pane')
  pane?.classList.remove('bell')
  void (pane as HTMLElement | null)?.offsetWidth
  pane?.classList.add('bell')
}

function openTerminalMenu(c: TerminalController, e: MouseEvent): void {
  if (get().settings.rightClick === 'copyPaste') {
    if (c.term.hasSelection()) copySelection(c)
    else void pasteInto(c)
    return
  }
  const s = get().sessions[c.id]
  const hasSel = c.term.hasSelection()
  const selection = c.term.getSelection()
  set({
    contextMenu: {
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Copy', hint: 'Ctrl+C', disabled: !hasSel, run: () => copySelection(c) },
        { label: 'Paste', hint: 'Ctrl+V', run: () => void pasteInto(c) },
        { label: 'Select all', run: () => c.term.selectAll() },
        { separator: true },
        { label: 'Find…', hint: 'Ctrl+Shift+F', run: () => set({ findOpen: true }) },
        { label: 'Clear terminal', run: () => void clearTerminal(c.id) },
        { separator: true },
        { label: 'Save selection as snippet', disabled: !hasSel, run: () => openSnippetEditor({ command: selection.trim() }) },
        { label: 'Add this folder to favorites', disabled: !s?.cwd, run: () => s && void addFavorite(s.cwd) },
        { label: 'Open folder in Explorer', disabled: !s?.cwd, run: () => s && void api.system.openPath(s.cwd) },
        { separator: true },
        { label: 'Restart session', run: () => void restartSession(c.id) },
        { label: 'Close session', hint: 'Ctrl+Shift+W', danger: true, run: () => void closeSession(c.id) }
      ]
    }
  })
}

// ===================================================================== folders

export async function cdTo(path: string, opts: { newSession?: boolean; shell?: ShellFamily } = {}): Promise<void> {
  if (!(await api.system.isDirectory(path))) {
    const fav = get().library.favorites.find((f) => samePath(f.path, path))
    toast('error', 'Folder not found', {
      message: path,
      actions: fav ? [{ label: 'Remove from favorites', run: () => void api.library.removeFavorite(fav.id) }] : undefined
    })
    return
  }
  const s = activeSession()
  if (opts.newSession || !s || s.status === 'exited') {
    await newSession({ cwd: path, shell: opts.shell ? resolveFamily(opts.shell) : s?.shell, exact: true })
    return
  }
  set({ viewerId: null })
  if (samePath(s.cwd, path)) {
    focusActive()
    return
  }
  const send = (): void => {
    void api.sessions.exec(s.id, cdCommand(s.shell, path), { execute: true, clearLine: true })
    focusActive()
  }
  if (s.status === 'busy') {
    toast('warning', 'A command is still running', {
      message: s.currentCommand ? `“${s.currentCommand.text}” hasn't finished in this session.` : undefined,
      actions: [
        { label: 'Open new session there', primary: true, run: () => void newSession({ cwd: path, shell: s.shell, exact: true }) },
        { label: 'Send anyway', run: send }
      ]
    })
    return
  }
  send()
}

export async function addFavorite(path: string, name?: string): Promise<FavoriteFolder | null> {
  const fav = await api.library.addFavorite(path, name)
  if (fav) toast('success', 'Added to favorites', { message: fav.name })
  else toast('error', 'Not a folder', { message: path })
  return fav
}

export async function toggleFavorite(path: string): Promise<void> {
  const fav = get().library.favorites.find((f) => samePath(f.path, path))
  if (fav) {
    await api.library.removeFavorite(fav.id)
    toast('info', 'Removed from favorites', {
      message: fav.name,
      actions: [{ label: 'Undo', run: () => void api.library.addFavorite(fav.path, fav.name, fav.color) }]
    })
  } else await addFavorite(path)
}

export async function pickAndAddFavorite(): Promise<void> {
  const path = await api.system.pickFolder(activeSession()?.cwd)
  if (path) await addFavorite(path)
}

export function typePath(path: string): void {
  const s = activeSession()
  if (!s) return
  api.sessions.write(s.id, quotePath(s.shell, path))
  focusActive()
}

// ===================================================================== snippets

export function openSnippetEditor(draft: Partial<Snippet> = {}): void {
  set({ snippetEditor: draft })
}

function promptVars(snippet: Snippet): Promise<Record<string, string> | null> {
  const vars = snippetVariables(snippet.command)
  if (!vars.length) return Promise.resolve({})
  const remembered = get().library.snippetVars
  const initial: Record<string, string> = {}
  for (const v of vars) initial[v.name] = remembered[v.name] ?? v.defaultValue
  return new Promise((resolve) => {
    set({
      varsPrompt: {
        snippet,
        vars,
        initial,
        resolve: (values) => {
          set({ varsPrompt: null })
          resolve(values)
        }
      }
    })
  })
}

export async function runSnippet(snippet: Snippet, modeOverride?: SnippetMode): Promise<void> {
  // A built-in tool opens instead of typing anything.
  if (snippet.tool) {
    void api.library.snippetUsed(snippet.id, {})
    if (snippet.tool === 'power-timer') set({ powerOpen: true })
    return
  }
  const mode = modeOverride ?? snippet.mode
  const values = await promptVars(snippet)
  if (!values) {
    focusActive()
    return
  }
  const s = activeSession()
  const ctrl = getController(s?.id)
  const builtins = {
    cwd: s?.cwd ?? '',
    selection: ctrl?.term.getSelection() ?? '',
    clipboard: usesBuiltin(snippet.command, 'clipboard') ? await api.system.readClipboard() : ''
  }
  const text = expandSnippet(snippet.command, values, builtins)
  void api.library.snippetUsed(snippet.id, values)

  if (mode === 'copy') {
    await api.system.writeClipboard(text)
    toast('success', 'Copied to clipboard', { message: snippet.name })
    focusActive()
    return
  }

  const execute = mode === 'run'
  const runIn = async (target: SessionInfo | null): Promise<void> => {
    if (!target) return
    await api.sessions.exec(target.id, text, { execute, clearLine: true })
    activate(target.id)
  }
  const runInNew = async (): Promise<void> => {
    const shell = snippet.shell === 'any' ? s?.shell : resolveFamily(snippet.shell)
    const info = await newSession({ shell, exact: true, cwd: s?.cwd })
    if (info) await runIn(await waitForReady(info.id))
  }

  if (!s || s.status === 'exited') return runInNew()
  set({ viewerId: null })

  if (snippet.shell !== 'any' && snippet.shell !== familyOf(s.shell)) {
    toast('warning', `This command is for ${FAMILY_LABEL[snippet.shell]}`, {
      message: `The active session is ${SHELL_META[s.shell].name}.`,
      actions: [
        { label: `Open in ${FAMILY_LABEL[snippet.shell]}`, primary: true, run: () => void runInNew() },
        { label: 'Use this session', run: () => void runIn(s) }
      ]
    })
    return
  }
  if (s.status === 'busy') {
    toast('warning', 'A command is still running', {
      message: s.currentCommand ? `“${s.currentCommand.text}” hasn't finished yet.` : undefined,
      actions: [
        { label: 'Run in new session', primary: true, run: () => void runInNew() },
        { label: execute ? 'Send anyway' : 'Type anyway', run: () => void runIn(s) }
      ]
    })
    return
  }
  await runIn(s)
}

export async function deleteSnippet(snippet: Snippet): Promise<void> {
  await api.library.removeSnippet(snippet.id)
  toast('info', 'Snippet deleted', {
    message: snippet.name,
    actions: [{ label: 'Undo', run: () => void api.library.upsertSnippet({ ...snippet }) }]
  })
}

export async function addExampleSnippets(): Promise<void> {
  for (const ex of EXAMPLE_SNIPPETS) await api.library.upsertSnippet({ ...ex })
  toast('success', 'Example snippets added', { message: 'Edit or delete them any time.' })
}

// ===================================================================== snippet groups

/** Open or close a group for this run, and remember it for the "remember" start state. */
export function setSnippetGroupOpen(name: string, open: boolean): void {
  set((s) => ({ snippetGroupOpen: { ...s.snippetGroupOpen, [name]: open } }))
  void api.library.setSnippetGroupCollapsed(name, !open)
}

export function setAllSnippetGroupsOpen(open: boolean): void {
  const { library } = get()
  const names = groupSnippets(library.snippets, library.snippetGroupOrder).map(([g]) => g)
  set({ snippetGroupOpen: Object.fromEntries(names.map((g) => [g, open])) })
  for (const g of names) void api.library.setSnippetGroupCollapsed(g, !open)
}

/** Save a new group order (the full list of groups currently shown). */
export function reorderSnippetGroups(names: string[]): void {
  const lib = get().library
  const rest = lib.snippetGroupOrder.filter((g) => !names.includes(g))
  set({ library: { ...lib, snippetGroupOrder: [...names, ...rest] } })
  void api.library.reorderSnippetGroups(names)
}

/** Move a group by `delta` places, or to the top / bottom with -Infinity / Infinity. */
export function moveSnippetGroup(name: string, delta: number): void {
  const lib = get().library
  const names = groupSnippets(lib.snippets, lib.snippetGroupOrder).map(([g]) => g)
  const from = names.indexOf(name)
  if (from < 0) return
  const to = Math.max(0, Math.min(names.length - 1, from + delta))
  if (to === from) return
  names.splice(from, 1)
  names.splice(to, 0, name)
  reorderSnippetGroups(names)
}

/** Choose how one group starts (null = follow the default). Applies to the panel right away. */
export function setSnippetGroupStart(name: string, state: GroupStartState | null): void {
  const { settings } = get()
  const states = { ...settings.snippetGroupStates }
  if (state) states[name] = state
  else delete states[name]
  set((s) => {
    const open = { ...s.snippetGroupOpen }
    delete open[name]
    return { snippetGroupOpen: open }
  })
  void updateSettings({ snippetGroupStates: states })
}

/** Change the default start state, or clear every group's own choice. */
export function setSnippetGroupDefaults(patch: { def?: GroupStartState; resetGroups?: boolean }): void {
  const s = get().settings
  set({ snippetGroupOpen: {} })
  void updateSettings({
    snippetGroupDefault: patch.def ?? s.snippetGroupDefault,
    snippetGroupStates: patch.resetGroups ? {} : s.snippetGroupStates
  })
}

export function saveSelectionAsSnippet(): void {
  const text = getController(get().activeId)?.term.getSelection().trim()
  openSnippetEditor(text ? { command: text } : {})
}

// ===================================================================== archive

const pendingDelete = new Set<string>()
const pendingTimers = new Map<number, string[]>()

export async function refreshArchive(): Promise<void> {
  const list = await api.archive.list()
  set({ archive: list.filter((a) => !pendingDelete.has(a.id)) })
}

export function openArchive(focusId?: string): void {
  set({ overlay: 'archive', archiveFocusId: focusId ?? null, paletteOpen: false })
}

export function closeOverlay(): void {
  set({ overlay: null })
  focusActive()
}

export function viewArchived(id: string): void {
  set({ viewerId: id, overlay: null })
}

export async function resumeArchived(id: string): Promise<void> {
  set({ overlay: null, viewerId: null })
  await newSession({ resumeFrom: id })
}

export function deleteArchived(ids: string[]): void {
  if (!ids.length) return
  for (const id of ids) pendingDelete.add(id)
  set((s) => ({ archive: s.archive.filter((a) => !pendingDelete.has(a.id)), viewerId: s.viewerId && ids.includes(s.viewerId) ? null : s.viewerId }))
  const timer = window.setTimeout(() => {
    void api.archive.remove(ids).finally(() => ids.forEach((id) => pendingDelete.delete(id)))
  }, 6000)
  pendingTimers.set(timer, ids)
  toast('info', ids.length === 1 ? 'Session deleted' : `${ids.length} sessions deleted`, {
    duration: 6000,
    actions: [
      {
        label: 'Undo',
        run: () => {
          window.clearTimeout(timer)
          pendingTimers.delete(timer)
          ids.forEach((id) => pendingDelete.delete(id))
          void refreshArchive()
        }
      }
    ]
  })
}

/** Commit deletions that are still waiting for their undo window (e.g. when quitting). */
export function flushPendingDeletes(): void {
  for (const [timer, ids] of pendingTimers) {
    window.clearTimeout(timer)
    void api.archive.remove(ids)
  }
  pendingTimers.clear()
}

// ===================================================================== panels & overlays

export function togglePanel(p: PanelId): void {
  const next = get().panel === p ? null : p
  set({ panel: next })
  try {
    localStorage.setItem('pt.panel', next ?? 'none')
  } catch {
    /* ignore */
  }
}

export function openSettings(): void {
  set({ overlay: 'settings', paletteOpen: false })
}

export function openSettingsAt(section: SettingsSection): void {
  set({ overlay: 'settings', settingsSection: section, paletteOpen: false })
}

export function openPalette(): void {
  set({ paletteOpen: true, contextMenu: null })
}

export function sessionLabel(s: SessionInfo): string {
  return s.customTitle || folderName(s.cwd) || SHELL_META[s.shell].name
}

export async function quitApp(force: boolean): Promise<void> {
  flushPendingDeletes()
  set({ quitRequest: null })
  await api.system.quit(force)
}
