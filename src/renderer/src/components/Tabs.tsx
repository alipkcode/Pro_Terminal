import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, Reorder } from 'motion/react'
import { ChevronDown, FolderPlus, Plus, Star, X } from 'lucide-react'
import type { SessionInfo, ShellInfo } from '@shared/types'
import { useApp } from '@/store/app'
import {
  activate,
  closeSession,
  newSession,
  renameSession,
  reorderSessions,
  resolveFamily,
  restartSession,
  sessionLabel
} from '@/lib/actions'
import { api } from '@/api'
import { familyOf, SHELL_META } from '@/lib/shell'
import { shortPath } from '@/lib/format'
import { ShellIcon } from './icons'
import { showContextMenu } from './ui/ContextMenu'

function Tab({ session, active, index }: { session: SessionInfo; active: boolean; index: number }) {
  const [editing, setEditing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const label = sessionLabel(session)

  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  const commit = (value: string) => {
    setEditing(false)
    if (value.trim() !== label) void renameSession(session.id, value)
  }

  const tip = `${SHELL_META[session.shell].name} · ${shortPath(session.cwd, 60)}${session.status === 'busy' && session.currentCommand ? `\nRunning: ${session.currentCommand.text}` : ''}`

  return (
    <Reorder.Item
      value={session.id}
      as="div"
      className={`tab tab--${familyOf(session.shell)} ${active ? 'tab--active' : ''} ${session.status === 'exited' ? 'tab--exited' : ''}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.14 } }}
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
      whileDrag={{ scale: 1.03, zIndex: 5 }}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault()
      }}
      onMouseUp={(e) => {
        if (e.button === 1) void closeSession(session.id)
      }}
      onClick={() => activate(session.id)}
      onDoubleClick={() => setEditing(true)}
      onContextMenu={(e) =>
        showContextMenu(e, [
          { label: 'Rename', run: () => setEditing(true) },
          { label: 'Duplicate', hint: 'Same shell & folder', run: () => void newSession({ shell: session.shell, exact: true, cwd: session.cwd }) },
          { label: 'Restart', run: () => void restartSession(session.id) },
          { label: 'Open folder in Explorer', run: () => void api.system.openPath(session.cwd) },
          { separator: true },
          { label: 'Close', hint: 'Ctrl+Shift+W', danger: true, run: () => void closeSession(session.id) }
        ])
      }
      data-tip={editing ? undefined : tip}
      data-tip-placement="bottom"
      data-tip-kbd={index < 9 ? `Ctrl+${index + 1}` : undefined}
    >
      {active && <motion.div layoutId="tab-active-bg" className="tab__active-bg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
      <span className="tab__icon">
        <ShellIcon shell={session.shell} size={14} />
        {session.status === 'busy' && <span className="tab__busy" />}
      </span>
      {editing ? (
        <input
          ref={input}
          className="tab__input"
          defaultValue={label}
          maxLength={80}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commit(e.currentTarget.value)
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span className="tab__title">{label}</span>
      )}
      <button
        className="tab__close"
        onClick={(e) => {
          e.stopPropagation()
          void closeSession(session.id)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Close session"
      >
        <X size={12} />
      </button>
    </Reorder.Item>
  )
}

export function Tabs() {
  const order = useApp((s) => s.order)
  const sessions = useApp((s) => s.sessions)
  const activeId = useApp((s) => s.activeId)
  const viewerId = useApp((s) => s.viewerId)
  const scroller = useRef<HTMLDivElement>(null)

  // Keep the active tab in view.
  useEffect(() => {
    const el = scroller.current?.querySelector('.tab--active') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [activeId, order.length])

  return (
    <div className="tabs">
      <div
        className="tabs__scroll no-drag"
        ref={scroller}
        onWheel={(e) => {
          if (scroller.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) scroller.current.scrollLeft += e.deltaY
        }}
      >
        <Reorder.Group axis="x" values={order} onReorder={reorderSessions} as="div" className="tabs__list">
          <AnimatePresence initial={false}>
            {order.map((id, i) =>
              sessions[id] ? <Tab key={id} session={sessions[id]} active={id === activeId && !viewerId} index={i} /> : null
            )}
          </AnimatePresence>
        </Reorder.Group>
      </div>
      <NewSessionButton />
    </div>
  )
}

const NO_SHELLS: ShellInfo[] = []

function NewSessionButton() {
  const [open, setOpen] = useState(false)
  const shells = useApp((s) => s.info?.shells ?? NO_SHELLS)
  const favorites = useApp((s) => s.library.favorites)
  const defaultShell = useApp((s) => s.settings.defaultShell)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
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
    <div className="new-tab no-drag" ref={ref}>
      <button
        className="icon-btn new-tab__main"
        onClick={() => void newSession({ shell: resolveFamily(defaultShell), exact: true })}
        data-tip={`New ${defaultShell === 'cmd' ? 'CMD' : 'PowerShell'} session`}
        data-tip-kbd="Ctrl+Shift+T"
        data-tip-placement="bottom"
      >
        <Plus size={16} />
      </button>
      <button className={`icon-btn new-tab__more ${open ? 'icon-btn--active' : ''}`} onClick={() => setOpen((o) => !o)} aria-label="More session options">
        <ChevronDown size={13} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="popover menu-popover"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
            transition={{ type: 'spring', stiffness: 480, damping: 34 }}
          >
            <div className="menu-popover__label">New session</div>
            {shells
              .filter((s) => s.available)
              .map((s, i) => (
                <button key={s.id} className="menu-row" onClick={() => go(() => void newSession({ shell: s.id, exact: true }))}>
                  <ShellIcon shell={s.id} size={15} />
                  <span>{s.name}</span>
                  <kbd>{i < 2 ? `Ctrl+Shift+${i + 1}` : ''}</kbd>
                </button>
              ))}
            <button
              className="menu-row"
              onClick={() =>
                go(async () => {
                  const dir = await api.system.pickFolder()
                  if (dir) void newSession({ cwd: dir })
                })
              }
            >
              <FolderPlus size={15} />
              <span>In folder…</span>
            </button>
            {favorites.length > 0 && (
              <>
                <div className="menu-popover__label">Open in favorite</div>
                {favorites.slice(0, 8).map((f) => (
                  <button key={f.id} className="menu-row" onClick={() => go(() => void newSession({ cwd: f.path }))}>
                    <Star size={14} style={{ color: f.color ?? 'var(--warn)' }} fill={f.color ?? 'var(--warn)'} />
                    <span>{f.name}</span>
                    <span className="menu-row__meta">{shortPath(f.path, 26)}</span>
                  </button>
                ))}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

