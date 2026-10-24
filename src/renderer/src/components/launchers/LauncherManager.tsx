import { AnimatePresence, Reorder } from 'motion/react'
import { Download, Ellipsis, FolderTree, GripVertical, Keyboard, LayoutGrid, Monitor, MonitorCheck, Pin, PinOff, Play, Plus, Wand2, Zap } from 'lucide-react'
import type { Launcher } from '@shared/types'
import { get, set, useApp } from '@/store/app'
import { focusActive } from '@/lib/actions'
import { addToDesktop, openActionEditor, openLauncherEditor, removeFromDesktop, reorderLaunchers, runLauncher, saveActionFile, togglePinned } from '@/lib/launchers'
import { relativeTime, shortPath } from '@/lib/format'
import { SHELL_META } from '@/lib/shell'
import { Modal } from '../ui/Modal'
import { LauncherIcon, ShellIcon } from '../icons'
import { showContextMenu } from '../ui/ContextMenu'
import { launcherMenu } from './menu'

function ScriptLine({ l }: { l: Launcher }) {
  const all = l.script.trim().split('\n')
  const first = all.find((x) => x.trim() && !/^\s*(#|rem\b|::)/i.test(x)) ?? all[0]
  const more = all.length - 1
  return (
    <div className="lm-row__script mono">
      {first ? (
        <>
          {l.mode === 'run' ? <Play size={10} /> : <Keyboard size={10} />}
          <span>{first.trim()}</span>
          {more > 0 && <span className="lm-row__more">+{more} line{more === 1 ? '' : 's'}</span>}
        </>
      ) : (
        <span className="muted">Opens the folder — no script</span>
      )}
    </div>
  )
}

function ManagerRow({ l, onDesktop, close }: { l: Launcher; onDesktop: boolean; close: () => void }) {
  const action = l.kind === 'action'
  return (
    <Reorder.Item
      value={l.id}
      as="div"
      className={`lm-row ${action ? 'lm-row--action' : ''}`}
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
        {action && <span className="lm-row__badge">EXE</span>}
      </span>
      <div className="lm-row__body">
        <div className="lm-row__name">{l.name}</div>
        <div className="lm-row__meta">
          <span className="lm-tag">
            <ShellIcon shell={l.shell} size={11} />
            {SHELL_META[l.shell].short}
          </span>
          {action ? (
            <>
              <span className={`lm-tag ${l.recursive ? 'lm-tag--accent' : ''}`}>
                {l.recursive && <FolderTree size={10} />}
                {l.recursive ? 'All subfolders' : 'Its folder'}
              </span>
              {l.description && (
                <span className="lm-row__path" data-tip={l.description}>
                  {l.description}
                </span>
              )}
            </>
          ) : (
            <span className="mono lm-row__path" data-tip={l.folder}>
              {shortPath(l.folder, 44)}
            </span>
          )}
        </div>
        <ScriptLine l={l} />
      </div>
      <div className="lm-row__stats">{l.uses > 0 ? `${l.uses}× · ${relativeTime(l.lastUsedAt ?? l.updatedAt)}` : action ? 'not run yet' : 'not used yet'}</div>
      <div className="lm-row__actions">
        {action ? (
          <button className="lm-toggle" onClick={() => void saveActionFile(l, 'desktop')} data-tip="Save the file to the desktop">
            <Download size={13} />
          </button>
        ) : (
          <>
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
          </>
        )}
        <button
          className="btn btn--sm lm-run"
          onClick={() => {
            // A folder action asks for a folder and a confirmation on top of the manager.
            if (!action) close()
            void runLauncher(l)
          }}
          data-tip={action ? 'Pick a folder to run it in' : undefined}
        >
          <Play size={12} />
          {action ? 'Run…' : 'Open'}
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
  // The wizard, confirmations and context menus open on top of the manager; Escape should close those first.
  const closeUnlessCovered = () => !get().launcherEditor && !get().contextMenu && !get().actionQueue.length && close()
  const shortcuts = launchers.filter((l) => l.kind !== 'action')
  const actions = launchers.filter((l) => l.kind === 'action')
  const pinnedCount = shortcuts.filter((l) => l.pinned).length
  const desktopCount = shortcuts.filter((l) => onDesktop.includes(l.id)).length
  const ids = (list: Launcher[]) => list.map((l) => l.id)

  const subtitle = launchers.length
    ? [
        `${shortcuts.length} shortcut${shortcuts.length === 1 ? '' : 's'}`,
        `${pinnedCount} in the top bar`,
        `${desktopCount} on the desktop`,
        ...(actions.length ? [`${actions.length} folder action${actions.length === 1 ? '' : 's'}`] : [])
      ].join(' · ')
    : 'One click opens a shell in a folder and runs your script'

  return (
    <Modal
      open={open}
      onClose={closeUnlessCovered}
      width={760}
      icon={<LayoutGrid size={18} />}
      title="Shortcuts"
      subtitle={subtitle}
      className="launcher-manager-modal"
      footer={
        <>
          <span className="lm-foot-hint">Drag to reorder · double-click to edit · right-click for more</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn--ghost" onClick={close}>
            Done
          </button>
          <button className="btn" onClick={() => openActionEditor()}>
            <Wand2 size={14} />
            New folder action
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
        <>
          {shortcuts.length > 0 && (
            <>
              <div className="lm-section">
                <Zap size={12} />
                Shortcuts
                <span>a folder and a script, one click away</span>
              </div>
              <Reorder.Group axis="y" values={ids(shortcuts)} onReorder={(next) => reorderLaunchers([...next, ...ids(actions)])} as="div" className="lm-list">
                <AnimatePresence initial={false}>
                  {shortcuts.map((l) => (
                    <ManagerRow key={l.id} l={l} onDesktop={onDesktop.includes(l.id)} close={close} />
                  ))}
                </AnimatePresence>
              </Reorder.Group>
            </>
          )}

          <div className="lm-section">
            <Wand2 size={12} />
            Folder actions
            <span>a script saved as a file that runs in the folder it's opened from</span>
          </div>
          {actions.length > 0 ? (
            <Reorder.Group axis="y" values={ids(actions)} onReorder={(next) => reorderLaunchers([...ids(shortcuts), ...next])} as="div" className="lm-list">
              <AnimatePresence initial={false}>
                {actions.map((l) => (
                  <ManagerRow key={l.id} l={l} onDesktop={false} close={close} />
                ))}
              </AnimatePresence>
            </Reorder.Group>
          ) : (
            <button className="lm-action-intro" onClick={() => openActionEditor()}>
              <span className="lm-action-intro__icon">
                <LauncherIcon color="#34d399" size={34} />
                <span className="lm-row__badge">EXE</span>
              </span>
              <span className="lm-action-intro__text">
                <span className="lm-action-intro__title">Make a folder action</span>
                <span className="lm-action-intro__sub">
                  For example “remove the dashes from every name”. Save it as a file, drop it into any folder and open it there — it asks, then runs.
                </span>
              </span>
              <span className="btn btn--sm">
                <Wand2 size={13} />
                Create
              </span>
            </button>
          )}
        </>
      )}
    </Modal>
  )
}
