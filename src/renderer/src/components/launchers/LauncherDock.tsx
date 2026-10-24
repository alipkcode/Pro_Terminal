import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Keyboard, LayoutGrid, Monitor, Pencil, Pin, PinOff, Play, Plus, Zap } from 'lucide-react'
import type { Launcher } from '@shared/types'
import { useApp } from '@/store/app'
import { openLauncherEditor, openLauncherManager, refreshDesktopStatus, runLauncher, togglePinned } from '@/lib/launchers'
import { shortPath } from '@/lib/format'
import { LauncherIcon, ShellIcon } from '../icons'
import { showContextMenu } from '../ui/ContextMenu'
import { launcherMenu, launcherSummary } from './menu'

/** Pinned shortcuts shown directly in the title bar; the rest are one click away in the menu. */
const DOCK_MAX = 6

function DockChip({ l, index }: { l: Launcher; index: number }) {
  const [launches, setLaunches] = useState(0)
  return (
    <motion.button
      layout
      className="launcher-chip"
      style={{ ['--lc' as string]: l.color }}
      initial={{ opacity: 0, scale: 0.6, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.14 } }}
      transition={{ type: 'spring', stiffness: 520, damping: 30, delay: index * 0.025 }}
      whileHover={{ y: -1.5 }}
      whileTap={{ scale: 0.86 }}
      onClick={() => {
        setLaunches((n) => n + 1)
        void runLauncher(l)
      }}
      onContextMenu={(e) => showContextMenu(e, launcherMenu(l))}
      data-tip={`${l.name}\n${launcherSummary(l)}`}
      data-tip-placement="bottom"
      aria-label={`Open shortcut ${l.name}`}
    >
      <LauncherIcon color={l.color} size={20} />
      <AnimatePresence>
        {launches > 0 && (
          <motion.span
            key={launches}
            className="launcher-chip__ring"
            initial={{ opacity: 0.85, scale: 0.7 }}
            animate={{ opacity: 0, scale: 1.7 }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
    </motion.button>
  )
}

export function LauncherDock() {
  const all = useApp((s) => s.library.launchers)
  // Folder actions live in the manager only: they need a folder picked each time.
  const launchers = useMemo(() => all.filter((l) => l.kind !== 'action'), [all])
  const onDesktop = useApp((s) => s.launchersOnDesktop)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const pinned = launchers.filter((l) => l.pinned).slice(0, DOCK_MAX)

  useEffect(() => {
    if (!open) return
    void refreshDesktopStatus()
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const go = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  return (
    <div className="launcher-dock no-drag" ref={ref}>
      <button
        className={`launcher-dock__trigger ${open ? 'launcher-dock__trigger--open' : ''} ${launchers.length ? '' : 'launcher-dock__trigger--empty'}`}
        onClick={() => setOpen((o) => !o)}
        data-tip={open ? undefined : launchers.length ? 'Shortcuts' : 'Create a shortcut'}
        data-tip-placement="bottom"
        aria-expanded={open}
        aria-label="Shortcuts"
      >
        <Zap size={15} strokeWidth={2} />
      </button>

      <div className="launcher-dock__chips">
        <AnimatePresence initial={false} mode="popLayout">
          {pinned.map((l, i) => (
            <DockChip key={l.id} l={l} index={i} />
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="popover launcher-popover"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
            transition={{ type: 'spring', stiffness: 480, damping: 34 }}
          >
            <div className="launcher-popover__head">
              <div>
                <div className="launcher-popover__title">Shortcuts</div>
                <div className="launcher-popover__sub">A folder, a shell and a script — one click away</div>
              </div>
              <button className="btn btn--sm btn--primary" onClick={() => go(() => openLauncherEditor())}>
                <Plus size={13} />
                New
              </button>
            </div>

            {launchers.length === 0 ? (
              <button className="launcher-empty" onClick={() => go(() => openLauncherEditor())}>
                <span className="launcher-empty__icons">
                  <LauncherIcon color="#34d399" size={30} />
                  <LauncherIcon color="#8b7bff" size={38} />
                  <LauncherIcon color="#fb923c" size={30} />
                </span>
                <span className="launcher-empty__title">Create your first shortcut</span>
                <span className="launcher-empty__text">Pick a folder, a shell and a script. It shows up right here in the top bar — and on your desktop if you like.</span>
              </button>
            ) : (
              <div className="launcher-popover__list">
                {launchers.map((l, i) => (
                  <motion.div
                    key={l.id}
                    className="launcher-item"
                    style={{ ['--lc' as string]: l.color }}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i, 10) * 0.02, duration: 0.18 }}
                    onClick={() => go(() => void runLauncher(l))}
                    onContextMenu={(e) => showContextMenu(e, launcherMenu(l, { onAction: () => setOpen(false) }))}
                  >
                    <LauncherIcon color={l.color} size={30} />
                    <div className="launcher-item__body">
                      <span className="launcher-item__name">
                        {l.name}
                        {onDesktop.includes(l.id) && (
                          <span className="launcher-item__flag" data-tip="On your desktop">
                            <Monitor size={11} />
                          </span>
                        )}
                      </span>
                      <span className="launcher-item__meta">
                        <ShellIcon shell={l.shell} size={12} />
                        <span className="mono">{shortPath(l.folder, 34)}</span>
                      </span>
                    </div>
                    <span className={`launcher-item__mode launcher-item__mode--${l.mode}`}>
                      {l.mode === 'run' ? <Play size={10} /> : <Keyboard size={10} />}
                      {l.script.trim() ? (l.mode === 'run' ? 'Run' : 'Type') : 'Open'}
                    </span>
                    <div className="launcher-item__actions">
                      <button
                        className="icon-btn icon-btn--sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          togglePinned(l)
                        }}
                        data-tip={l.pinned ? 'Hide from the top bar' : 'Show in the top bar'}
                      >
                        {l.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                      </button>
                      <button
                        className="icon-btn icon-btn--sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          go(() => openLauncherEditor(l))
                        }}
                        data-tip="Edit"
                      >
                        <Pencil size={12} />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {launchers.length > 0 && (
              <div className="launcher-popover__foot">
                <button className="menu-row" onClick={() => go(openLauncherManager)}>
                  <LayoutGrid size={14} />
                  <span>Manage shortcuts…</span>
                  <kbd>Ctrl+Shift+L</kbd>
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
