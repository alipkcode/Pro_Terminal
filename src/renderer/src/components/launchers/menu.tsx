import { Copy, CornerDownLeft, Download, FolderInput, FolderOpen, Monitor, MonitorX, Pencil, Pin, PinOff, Play, Save, Trash2 } from 'lucide-react'
import type { Launcher } from '@shared/types'
import { api } from '@/api'
import { get, type ContextMenuItem } from '@/store/app'
import { activeSession } from '@/lib/actions'
import { addToDesktop, deleteLauncher, duplicateLauncher, openLauncherEditor, removeFromDesktop, runLauncher, saveActionFile, togglePinned } from '@/lib/launchers'
import { folderName } from '@/lib/format'
import { FAMILY_LABEL, familyOf, SHELL_META } from '@/lib/shell'

export const MODE_LABEL = { run: 'Runs', insert: 'Types' } as const

/** One line describing what a shortcut does, for tooltips. */
export function launcherSummary(l: Launcher): string {
  const what = l.script.trim() ? `${MODE_LABEL[l.mode]} ${l.script.trim().split('\n').length > 1 ? 'a script' : `“${l.script.trim()}”`}` : 'Opens the folder'
  return `${l.folder}\n${SHELL_META[l.shell].name} · ${what}`
}

export function launcherMenu(l: Launcher, extra: { onAction?: () => void } = {}): ContextMenuItem[] {
  const done = (fn: () => void) => () => {
    extra.onAction?.()
    fn()
  }
  if (l.kind === 'action') return actionMenu(l, done)
  const onDesktop = get().launchersOnDesktop.includes(l.id)
  return [
    { label: 'Open in a new tab', icon: <Play size={14} />, run: done(() => void runLauncher(l)) },
    { label: 'Run in this tab', icon: <CornerDownLeft size={14} />, hint: FAMILY_LABEL[familyOf(l.shell)], run: done(() => void runLauncher(l, { here: true })) },
    { label: 'Open folder in Explorer', icon: <FolderOpen size={14} />, run: () => void api.system.openPath(l.folder) },
    { separator: true },
    { label: 'Edit…', icon: <Pencil size={14} />, run: done(() => openLauncherEditor(l)) },
    { label: 'Duplicate…', icon: <Copy size={14} />, run: done(() => duplicateLauncher(l)) },
    { label: l.pinned ? 'Hide from the top bar' : 'Show in the top bar', icon: l.pinned ? <PinOff size={14} /> : <Pin size={14} />, run: () => togglePinned(l) },
    onDesktop
      ? { label: 'Remove from desktop', icon: <MonitorX size={14} />, run: () => void removeFromDesktop(l) }
      : { label: 'Add to desktop', icon: <Monitor size={14} />, run: () => void addToDesktop(l) },
    { separator: true },
    { label: 'Delete', icon: <Trash2 size={14} />, danger: true, run: () => void deleteLauncher(l) }
  ]
}

/** Folder actions: run somewhere (always confirmed), save the program file, edit. */
function actionMenu(l: Launcher, done: (fn: () => void) => () => void): ContextMenuItem[] {
  const s = activeSession()
  // Running opens a confirmation over the manager, so these keep it open.
  return [
    { label: 'Run in a folder…', icon: <FolderInput size={14} />, run: () => void runLauncher(l) },
    ...(s ? [{ label: 'Run in the current folder', icon: <CornerDownLeft size={14} />, hint: folderName(s.cwd), run: () => void runLauncher(l, { here: true }) }] : []),
    { separator: true },
    { label: 'Save file to desktop', icon: <Download size={14} />, run: () => void saveActionFile(l, 'desktop') },
    { label: 'Save file as…', icon: <Save size={14} />, run: () => void saveActionFile(l, 'choose') },
    { separator: true },
    { label: 'Edit…', icon: <Pencil size={14} />, run: done(() => openLauncherEditor(l)) },
    { label: 'Duplicate…', icon: <Copy size={14} />, run: done(() => duplicateLauncher(l)) },
    { separator: true },
    { label: 'Delete', icon: <Trash2 size={14} />, danger: true, run: () => void deleteLauncher(l) }
  ]
}
