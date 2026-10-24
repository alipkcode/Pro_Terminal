import { AnimatePresence, Reorder } from 'motion/react'
import { Ellipsis, GripVertical, Keyboard, LayoutGrid, Monitor, MonitorCheck, Pin, PinOff, Play, Plus } from 'lucide-react'
import type { Launcher } from '@shared/types'
import { get, set, useApp } from '@/store/app'
import { focusActive } from '@/lib/actions'
import { addToDesktop, openLauncherEditor, removeFromDesktop, reorderLaunchers, runLauncher, togglePinned } from '@/lib/launchers'
import { relativeTime, shortPath } from '@/lib/format'
import { SHELL_META } from '@/lib/shell'
import { Modal } from '../ui/Modal'
import { LauncherIcon, ShellIcon } from '../icons'
import { showContextMenu } from '../ui/ContextMenu'
import { launcherMenu } from './menu'

function ManagerRow({ l, onDesktop, close }: { l: Launcher; onDesktop: boolean; close: () => void }) {
  const firstLine = l.script.trim().split('\n')[0]
  const more = l.script.trim().split('\n').length - 1
  return (
    <Reorder.Item
      value={l.id}
      as="div"
      className="lm-row"
      style={{ ['--lc' as string]: l.color }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20, transition: { duration: 0.15 } }}
      whileDrag={{ scale: 1.015, boxShadow: 'var(--shadow)', zIndex: 3 }}
      onDoubleClick={() => openLauncherEditor(l)}
      onContextMenu={(e) => showContextMenu(e, launcherMenu(l, { onAction: close }))}
    >
      <span className="lm-row__grip" data-tip="Drag to reorder">
        <GripVertical size={14} />
      </span>
      <span className="lm-row__icon">
        <LauncherIcon color={l.color} size={40} />
      </span>
      <div className="lm-row__body">
        <div className="lm-row__name">{l.name}</div>
        <div className="lm-row__meta">
          <span className="lm-tag">
            <ShellIcon shell={l.shell} size={11} />
            {SHELL_META[l.shell].short}
          </span>
          <span className="mono lm-row__path" data-tip={l.folder}>
            {shortPath(l.folder, 44)}
          </span>
        </div>
        <div className="lm-row__script mono">
          {firstLine ? (
            <>
              {l.mode === 'run' ? <Play size={10} /> : <Keyboard size={10} />}
              <span>{firstLine}</span>
              {more > 0 && <span className="lm-row__more">+{more} line{more === 1 ? '' : 's'}</span>}
            </>
          ) : (
            <span className="muted">Opens the folder — no script</span>
          )}
        </div>
      </div>
      <div className="lm-row__stats">{l.uses > 0 ? `${l.uses}× · ${relativeTime(l.lastUsedAt ?? l.updatedAt)}` : 'not used yet'}</div>
      <div className="lm-row__actions">
        <button className={`lm-toggle ${l.pinned ? 'lm-toggle--on' : ''}`} onClick={() => togglePinned(l)} data-tip={l.pinned ? 'In the top bar — click to hide' : 'Show in the top bar'}>
          {l.pinned ? <Pin size={13} /> : <PinOff size={13} />}
        </button>
        <button
          className={`lm-toggle ${onDesktop ? 'lm-toggle--on' : ''}`}
          onClick={() => void (onDesktop ? removeFromDesktop(l) : addToDesktop(l))}
          data-tip={onDesktop ? `On the desktop (${l.target === 'window' ? 'classic window' : 'Pro Terminal tab'}) — click to remove` : 'Add to desktop'}
        >
          {onDesktop ? <MonitorCheck size={13} /> : <Monitor size={13} />}
        </button>
        <button
          className="btn btn--sm lm-run"
          onClick={() => {
            close()
            void runLauncher(l)
          }}
        >
          <Play size={12} />
          Open
        </button>
        <button className="icon-btn icon-btn--sm" onClick={(e) => showContextMenu(e, launcherMenu(l, { onAction: close }))} aria-label="More">
          <Ellipsis size={14} />
        </button>
      </div>
    </Reorder.Item>
  )
}

export function LauncherManager() {
  const open = useApp((s) => s.launcherManager)
  const launchers = useApp((s) => s.library.launchers)
  const onDesktop = useApp((s) => s.launchersOnDesktop)
  const close = () => {
    set({ launcherManager: false })
    focusActive()
  }
  // The wizard and context menus open on top of the manager; Escape should close those first.
  const closeUnlessCovered = () => !get().launcherEditor && !get().contextMenu && close()
  const pinnedCount = launchers.filter((l) => l.pinned).length
  const desktopCount = launchers.filter((l) => onDesktop.includes(l.id)).length

  return (
    <Modal
      open={open}
      onClose={closeUnlessCovered}
      width={760}
      icon={<LayoutGrid size={18} />}
      title="Shortcuts"
      subtitle={
        launchers.length
          ? `${launchers.length} shortcut${launchers.length === 1 ? '' : 's'} · ${pinnedCount} in the top bar · ${desktopCount} on the desktop`
          : 'One click opens a shell in a folder and runs your script'
      }
      className="launcher-manager-modal"
      footer={
        <>
          <span className="lm-foot-hint">Drag to reorder · double-click to edit · right-click for more</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn--ghost" onClick={close}>
            Done
          </button>
          <button className="btn btn--primary" onClick={() => openLauncherEditor()}>
            <Plus size={14} />
            New shortcut
          </button>
        </>
      }
    >
      {launchers.length === 0 ? (
        <button className="launcher-empty launcher-empty--large" onClick={() => openLauncherEditor()}>
          <span className="launcher-empty__icons">
            <LauncherIcon color="#22d3ee" size={40} />
            <LauncherIcon color="#8b7bff" size={52} />
            <LauncherIcon color="#f472b6" size={40} />
          </span>
          <span className="launcher-empty__title">No shortcuts yet</span>
          <span className="launcher-empty__text">
            Save “open this folder in PowerShell and run npm run dev” as one click — in the top bar, and on your desktop with its own colored icon.
          </span>
          <span className="btn btn--primary btn--sm">
            <Plus size={13} />
            Create a shortcut
          </span>
        </button>
      ) : (
        <Reorder.Group axis="y" values={launchers.map((l) => l.id)} onReorder={reorderLaunchers} as="div" className="lm-list">
          <AnimatePresence initial={false}>
            {launchers.map((l) => (
              <ManagerRow key={l.id} l={l} onDesktop={onDesktop.includes(l.id)} close={close} />
            ))}
          </AnimatePresence>
        </Reorder.Group>
      )}
    </Modal>
  )
}
