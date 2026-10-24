import { LAUNCHER_MOODS } from '@shared/defaults'
import type { Launcher, SessionInfo } from '@shared/types'
import { api } from '@/api'
import { get, set } from '@/store/app'
import { activate, activeSession, focusActive, newSession, resolveFamily, toast, waitForReady } from './actions'
import { renderIconImages } from './launcherIcon'
import { cdCommand, familyOf, FAMILY_LABEL, SHELL_META } from './shell'

// Shortcuts ("launchers"): a shell opened in a folder that types a saved script. They live in the
// title bar dock, the shortcuts manager and, optionally, on the Windows desktop.

// ===================================================================== editor & manager

/** Open the shortcut wizard: a new shortcut (prefilled from the active session) or an existing one. */
export function openLauncherEditor(draft?: Partial<Launcher>, step?: number): void {
  const { library, settings } = get()
  const s = activeSession()
  const base: Partial<Launcher> = draft ?? {
    folder: s?.cwd ?? '',
    shell: s?.shell ?? resolveFamily(settings.defaultShell),
    color: LAUNCHER_MOODS[(library.launchers.length + 1) % LAUNCHER_MOODS.length].color,
    script: '',
    mode: 'run',
    target: 'app',
    pinned: true
  }
  set({ launcherEditor: { draft: base, step }, contextMenu: null })
}

export function openLauncherManager(): void {
  set({ launcherManager: true, contextMenu: null, paletteOpen: false })
  void refreshDesktopStatus()
}

export async function refreshDesktopStatus(): Promise<void> {
  set({ launchersOnDesktop: await api.launchers.desktopStatus() })
}

/** Ids whose desktop shortcut file exists right now (the user may have deleted it in Explorer). */
async function onDesktopNow(l: Launcher | undefined): Promise<boolean> {
  if (!l?.desktopLink) return false
  const ids = await api.launchers.desktopStatus()
  set({ launchersOnDesktop: ids })
  return ids.includes(l.id)
}

/** Save from the wizard. Keeps an existing desktop shortcut in step with the new name, icon or script. */
export async function saveLauncher(input: Partial<Launcher>, opts: { addToDesktop?: boolean } = {}): Promise<Launcher | null> {
  const before = input.id ? get().library.launchers.find((l) => l.id === input.id) : undefined
  // Only refresh a desktop shortcut that still exists; one the user deleted stays deleted.
  const onDesktop = await onDesktopNow(before)
  const saved = await api.launchers.upsert(input)
  if (!saved) {
    toast('error', 'Could not save the shortcut', { message: 'Check the folder, or remove some shortcuts (200 at most).' })
    return null
  }
  if (opts.addToDesktop || onDesktop) await addToDesktop(saved, { quiet: onDesktop && !opts.addToDesktop })
  return saved
}

export function reorderLaunchers(ids: string[]): void {
  const lib = get().library
  const byId = new Map(lib.launchers.map((l) => [l.id, l]))
  set({ library: { ...lib, launchers: ids.map((id) => byId.get(id)!).filter(Boolean) } })
  void api.launchers.reorder(ids)
}

export function togglePinned(l: Launcher): void {
  void api.launchers.upsert({ id: l.id, pinned: !l.pinned })
}

export function duplicateLauncher(l: Launcher): void {
  const { id: _id, desktopLink: _link, uses: _uses, lastUsedAt: _last, createdAt: _created, updatedAt: _updated, ...rest } = l
  openLauncherEditor({ ...rest, name: `${l.name} copy` })
}

export async function deleteLauncher(l: Launcher): Promise<void> {
  const wasOnDesktop = await onDesktopNow(l)
  await api.launchers.remove(l.id)
  set((s) => ({ launchersOnDesktop: s.launchersOnDesktop.filter((x) => x !== l.id) }))
  toast('info', 'Shortcut deleted', {
    message: wasOnDesktop ? `${l.name} · removed from the desktop too` : l.name,
    actions: [
      {
        label: 'Undo',
        run: () =>
          void api.launchers.upsert({ ...l }).then((back) => {
            if (back && wasOnDesktop) void addToDesktop(back, { quiet: true })
          })
      }
    ]
  })
}

// ===================================================================== desktop

export async function addToDesktop(l: Launcher, opts: { quiet?: boolean } = {}): Promise<boolean> {
  let res: Awaited<ReturnType<typeof api.launchers.createDesktop>>
  try {
    res = await api.launchers.createDesktop(l.id, await renderIconImages(l.color))
  } catch (err) {
    res = { ok: false, error: String(err) }
  }
  if (!res.ok) {
    toast('error', 'Could not add to the desktop', { message: res.error })
    return false
  }
  set((s) => ({ launchersOnDesktop: s.launchersOnDesktop.includes(l.id) ? s.launchersOnDesktop : [...s.launchersOnDesktop, l.id] }))
  if (!opts.quiet) {
    toast('success', 'Added to your desktop', {
      message: `${l.name} — ${l.target === 'window' ? 'opens a classic console window' : 'opens a Pro Terminal tab'}`
    })
  }
  return true
}

export async function removeFromDesktop(l: Launcher): Promise<void> {
  await api.launchers.removeDesktop(l.id)
  set((s) => ({ launchersOnDesktop: s.launchersOnDesktop.filter((x) => x !== l.id) }))
  toast('info', 'Removed from the desktop', {
    message: l.name,
    actions: [{ label: 'Undo', run: () => void addToDesktop(l, { quiet: true }) }]
  })
}

// ===================================================================== running

/** Type the script (after an optional cd line) into a session; Enter is pressed in "run" mode. */
async function typeScript(target: SessionInfo, l: Launcher, cd = ''): Promise<void> {
  if (l.script.trim()) {
    await api.sessions.exec(target.id, cd ? `${cd}\n${l.script}` : l.script, { execute: l.mode === 'run', clearLine: true })
  } else if (cd) {
    await api.sessions.exec(target.id, cd, { execute: true, clearLine: true })
  }
  activate(target.id)
}

/** Open the shortcut: a new tab in its folder and shell, then type (and run) its script. */
export async function runLauncher(l: Launcher, opts: { here?: boolean } = {}): Promise<boolean> {
  set({ contextMenu: null })
  if (!(await api.system.isDirectory(l.folder))) {
    toast('error', 'The shortcut’s folder was not found', {
      message: l.folder,
      actions: [{ label: 'Edit shortcut', primary: true, run: () => openLauncherEditor(l, 0) }]
    })
    return false
  }
  void api.launchers.used(l.id)
  set((s) => ({ viewerId: null, overlay: s.overlay === 'archive' ? null : s.overlay }))

  const inNewTab = async (): Promise<boolean> => {
    const info = await newSession({ shell: l.shell, exact: true, cwd: l.folder, title: l.name })
    if (!info) return false
    if (!l.script.trim()) return true
    const ready = await waitForReady(info.id)
    if (ready && ready.status !== 'exited') await typeScript(ready, l)
    return true
  }

  const s = activeSession()
  if (!opts.here || !s || s.status === 'exited') return inNewTab()

  // "Run in this tab": change folder first (its own line), then the script.
  const cd = cdCommand(s.shell, l.folder)
  if (familyOf(s.shell) !== familyOf(l.shell)) {
    toast('warning', `This shortcut is for ${FAMILY_LABEL[familyOf(l.shell)]}`, {
      message: `The active tab is ${SHELL_META[s.shell].name}.`,
      actions: [
        { label: 'Open as a new tab', primary: true, run: () => void inNewTab() },
        { label: 'Use this tab', run: () => void typeScript(s, l, cd) }
      ]
    })
    return true
  }
  if (s.status === 'busy') {
    toast('warning', 'A command is still running', {
      message: s.currentCommand ? `“${s.currentCommand.text}” hasn't finished yet.` : undefined,
      actions: [
        { label: 'Open as a new tab', primary: true, run: () => void inNewTab() },
        { label: 'Send anyway', run: () => void typeScript(s, l, cd) }
      ]
    })
    return true
  }
  await typeScript(s, l, cd)
  focusActive()
  return true
}

/** Run shortcuts requested from desktop shortcuts. Returns how many were opened. */
export async function runPendingLaunchers(): Promise<number> {
  const ids = await api.launchers.takePending()
  let opened = 0
  for (const id of ids) {
    const l = get().library.launchers.find((x) => x.id === id)
    if (!l) {
      toast('warning', 'This desktop shortcut no longer exists', {
        message: 'It was deleted in Pro Terminal. You can remove it from the desktop.'
      })
      continue
    }
    if (await runLauncher(l)) opened++
  }
  return opened
}
