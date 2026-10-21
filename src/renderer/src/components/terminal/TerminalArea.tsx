import { useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Archive, Clock, FolderOpen, RotateCcw, Search, Star, X } from 'lucide-react'
import type { ShellInfo } from '@shared/types'
import { set, useApp } from '@/store/app'
import { focusActive, newSession, openArchive, resolveFamily, resumeArchived } from '@/lib/actions'
import { getController } from '@/terminal/registry'
import { dateTime, duration, relativeTime, shortPath } from '@/lib/format'
import { SHELL_META } from '@/lib/shell'
import { Logo, ShellIcon } from '../icons'
import { TerminalPane } from './TerminalPane'
import { FindBar } from './FindBar'
import { LogViewer, type LogViewerHandle } from './LogViewer'

function ArchivedViewer({ id }: { id: string }) {
  const a = useApp((s) => s.archive.find((x) => x.id === id))
  const findOpen = useApp((s) => s.findOpen)
  const viewer = useRef<LogViewerHandle>(null)
  if (!a) return null
  return (
    <motion.div
      className="viewer"
      initial={{ opacity: 0, scale: 0.99 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <div className="viewer__bar">
        <ShellIcon shell={a.shell} size={16} />
        <div className="viewer__titles">
          <div className="viewer__title">
            {a.title}
            <span className="viewer__badge">Archived · read-only</span>
          </div>
          <div className="viewer__meta">
            <span className="mono">{shortPath(a.cwd, 60)}</span>
            <span>·</span>
            <span>{dateTime(a.createdAt)}</span>
            <span>·</span>
            <span>{duration(a.endedAt - a.createdAt)}</span>
            <span>·</span>
            <span>
              {a.commands.length} command{a.commands.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <div className="viewer__actions">
          <button className="icon-btn" onClick={() => set({ findOpen: !findOpen })} data-tip="Find" data-tip-kbd="Ctrl+Shift+F">
            <Search size={15} />
          </button>
          <button className="btn btn--sm" onClick={() => openArchive(a.id)}>
            <Archive size={13} />
            Show in archive
          </button>
          <button className="btn btn--sm btn--primary" onClick={() => void resumeArchived(a.id)}>
            <RotateCcw size={13} />
            Resume
          </button>
          <button
            className="icon-btn"
            onClick={() => {
              set({ viewerId: null })
              focusActive()
            }}
            data-tip="Close viewer"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="viewer__body">
        <LogViewer ref={viewer} sessionId={a.id} />
        <AnimatePresence>
          {findOpen && <FindBar search={viewer.current?.search} onClose={() => set({ findOpen: false })} focusKey={a.id} />}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

const NO_SHELLS: ShellInfo[] = []

function EmptyState() {
  const favorites = useApp((s) => s.library.favorites)
  const archive = useApp((s) => s.archive)
  const shells = useApp((s) => s.info?.shells ?? NO_SHELLS)
  const cards = [
    { family: 'cmd' as const, title: 'Command Prompt', desc: 'Classic cmd.exe', kbd: 'Ctrl+Shift+1' },
    { family: 'powershell' as const, title: SHELL_META[resolveFamily('powershell')].name, desc: 'Objects, pipelines & scripts', kbd: 'Ctrl+Shift+2' }
  ]
  return (
    <motion.div className="empty-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <motion.div
        className="empty-state__hero"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 26, delay: 0.05 }}
      >
        <div className="empty-state__logo">
          <Logo size={56} />
        </div>
        <h1>Start a session</h1>
        <p>Pick a shell. Your sessions, folders and saved commands are one click away.</p>
      </motion.div>

      <div className="empty-state__cards">
        {cards.map((c, i) => (
          <motion.button
            key={c.family}
            className={`shell-card shell-card--${c.family}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24, delay: 0.1 + i * 0.06 }}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => void newSession({ shell: resolveFamily(c.family), exact: true })}
            disabled={!shells.some((s) => s.available && (c.family === 'cmd' ? s.id === 'cmd' : s.id !== 'cmd'))}
          >
            <span className="shell-card__glow" />
            <ShellIcon shell={c.family} size={30} />
            <span className="shell-card__title">{c.title}</span>
            <span className="shell-card__desc">{c.desc}</span>
            <kbd>{c.kbd}</kbd>
          </motion.button>
        ))}
      </div>

      {(favorites.length > 0 || archive.length > 0) && (
        <motion.div className="empty-state__quick" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
          {favorites.length > 0 && (
            <div className="quick-col">
              <div className="quick-col__label">
                <Star size={12} /> Open in a favorite folder
              </div>
              {favorites.slice(0, 5).map((f) => (
                <button key={f.id} className="quick-row" onClick={() => void newSession({ cwd: f.path })}>
                  <FolderOpen size={14} style={{ color: f.color ?? 'var(--accent)' }} />
                  <span>{f.name}</span>
                  <span className="quick-row__meta mono">{shortPath(f.path, 28)}</span>
                </button>
              ))}
            </div>
          )}
          {archive.length > 0 && (
            <div className="quick-col">
              <div className="quick-col__label">
                <Clock size={12} /> Resume a recent session
              </div>
              {archive.slice(0, 5).map((a) => (
                <button key={a.id} className="quick-row" onClick={() => void resumeArchived(a.id)}>
                  <ShellIcon shell={a.shell} size={14} />
                  <span>{a.title}</span>
                  <span className="quick-row__meta">{relativeTime(a.endedAt)}</span>
                </button>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  )
}

export function TerminalArea() {
  const order = useApp((s) => s.order)
  const sessions = useApp((s) => s.sessions)
  const activeId = useApp((s) => s.activeId)
  const viewerId = useApp((s) => s.viewerId)
  const findOpen = useApp((s) => s.findOpen)
  const ready = useApp((s) => s.ready)

  const showTerminal = !viewerId && !!activeId
  return (
    <main className="terminal-area">
      <div className="terminal-area__stack">
        {order.map((id) => (sessions[id] ? <TerminalPane key={id} session={sessions[id]} visible={showTerminal && id === activeId} /> : null))}
        <AnimatePresence>
          {showTerminal && findOpen && (
            <FindBar
              key="find"
              search={getController(activeId)?.search}
              focusKey={activeId}
              onClose={() => {
                set({ findOpen: false })
                focusActive()
              }}
            />
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>{viewerId && <ArchivedViewer key={viewerId} id={viewerId} />}</AnimatePresence>
      <AnimatePresence>{ready && order.length === 0 && !viewerId && <EmptyState key="empty" />}</AnimatePresence>
    </main>
  )
}
