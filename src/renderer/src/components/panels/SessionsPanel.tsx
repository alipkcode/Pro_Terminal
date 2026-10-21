import { useEffect, useState } from 'react'
import { AnimatePresence, motion, Reorder } from 'motion/react'
import { Archive, GitBranch, History, Pencil, Play, Plus, RotateCcw, X } from 'lucide-react'
import type { ArchivedSession, SessionInfo } from '@shared/types'
import { useApp } from '@/store/app'
import {
  activate,
  closeSession,
  newSession,
  openArchive,
  reorderSessions,
  restartSession,
  resumeArchived,
  sessionLabel,
  viewArchived
} from '@/lib/actions'
import { elapsed, relativeTime, shortPath } from '@/lib/format'
import { familyOf } from '@/lib/shell'
import { ShellIcon } from '../icons'
import { PanelHeader, SectionLabel } from '../SidePanel'
import { showContextMenu } from '../ui/ContextMenu'
import { api } from '@/api'

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [active])
  return now
}

function StatusChip({ s, now }: { s: SessionInfo; now: number }) {
  if (s.status === 'busy') return <span className="status-chip status-chip--busy">{s.currentCommand ? elapsed(now - s.currentCommand.startedAt) : 'Running'}</span>
  if (s.status === 'exited') return <span className="status-chip status-chip--exited">Exited {s.exitCode ?? ''}</span>
  if (s.status === 'starting') return <span className="status-chip status-chip--starting">Starting</span>
  return <span className="status-chip status-chip--idle">Ready</span>
}

function SessionCard({ s, active }: { s: SessionInfo; active: boolean }) {
  const now = useNow(s.status === 'busy')
  const [renaming, setRenaming] = useState(false)
  const label = sessionLabel(s)
  return (
    <Reorder.Item
      value={s.id}
      as="div"
      className={`session-card session-card--${familyOf(s.shell)} ${active ? 'session-card--active' : ''}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20, transition: { duration: 0.16 } }}
      whileDrag={{ scale: 1.02, boxShadow: 'var(--shadow)' }}
      onClick={() => activate(s.id)}
      onContextMenu={(e) =>
        showContextMenu(e, [
          { label: 'Rename', run: () => setRenaming(true) },
          { label: 'Duplicate', run: () => void newSession({ shell: s.shell, exact: true, cwd: s.cwd }) },
          { label: 'Restart', run: () => void restartSession(s.id) },
          { label: 'Open folder in Explorer', run: () => void api.system.openPath(s.cwd) },
          { separator: true },
          { label: 'Close', danger: true, run: () => void closeSession(s.id) }
        ])
      }
    >
      <div className="session-card__icon">
        <ShellIcon shell={s.shell} size={17} />
        <span className={`status-dot status-dot--${s.status} session-card__dot`} />
      </div>
      <div className="session-card__body">
        <div className="session-card__row">
          {renaming ? (
            <input
              autoFocus
              className="inline-input"
              defaultValue={label}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                setRenaming(false)
                void api.sessions.rename(s.id, e.currentTarget.value)
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setRenaming(false)
              }}
            />
          ) : (
            <span className="session-card__title">{label}</span>
          )}
          <StatusChip s={s} now={now} />
        </div>
        <div className="session-card__meta">
          <span className="mono">{shortPath(s.cwd, 34)}</span>
          {s.gitBranch && (
            <span className="session-card__branch">
              <GitBranch size={11} />
              {s.gitBranch}
            </span>
          )}
        </div>
        {s.status === 'busy' && s.currentCommand && (
          <div className="session-card__running">
            <Play size={10} fill="currentColor" />
            <span className="mono">{s.currentCommand.text}</span>
          </div>
        )}
      </div>
      <div className="session-card__actions">
        <button
          className="icon-btn icon-btn--sm"
          onClick={(e) => {
            e.stopPropagation()
            setRenaming(true)
          }}
          data-tip="Rename"
        >
          <Pencil size={12} />
        </button>
        <button
          className="icon-btn icon-btn--sm icon-btn--danger"
          onClick={(e) => {
            e.stopPropagation()
            void closeSession(s.id)
          }}
          data-tip="Close and archive"
        >
          <X size={13} />
        </button>
      </div>
    </Reorder.Item>
  )
}

function RecentRow({ a, viewing }: { a: ArchivedSession; viewing: boolean }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`recent-row ${viewing ? 'recent-row--on' : ''}`}
      onClick={() => viewArchived(a.id)}
      onContextMenu={(e) =>
        showContextMenu(e, [
          { label: 'View output', run: () => viewArchived(a.id) },
          { label: 'Resume session', run: () => void resumeArchived(a.id) },
          { label: 'Show in archive', run: () => openArchive(a.id) }
        ])
      }
    >
      <ShellIcon shell={a.shell} size={14} colored={false} className="recent-row__icon" />
      <div className="recent-row__body">
        <span className="recent-row__title">{a.title}</span>
        <span className="recent-row__meta">
          {relativeTime(a.endedAt)} · {a.commands.length} cmd{a.commands.length === 1 ? '' : 's'}
        </span>
      </div>
      {a.tags.length > 0 && <span className="recent-row__tags">{a.tags.length}</span>}
      <button
        className="icon-btn icon-btn--sm recent-row__resume"
        onClick={(e) => {
          e.stopPropagation()
          void resumeArchived(a.id)
        }}
        data-tip="Resume in a new session"
      >
        <RotateCcw size={12} />
      </button>
    </motion.div>
  )
}

export function SessionsPanel() {
  const order = useApp((s) => s.order)
  const sessions = useApp((s) => s.sessions)
  const activeId = useApp((s) => s.activeId)
  const viewerId = useApp((s) => s.viewerId)
  const archive = useApp((s) => s.archive)
  const recent = archive.slice(0, 8)

  return (
    <div className="panel">
      <PanelHeader title="Sessions" subtitle={`${order.length} open`}>
        <button className="icon-btn" onClick={() => void newSession()} data-tip="New session" data-tip-kbd="Ctrl+Shift+T">
          <Plus size={16} />
        </button>
      </PanelHeader>

      <div className="panel__scroll">
        <SectionLabel>Open</SectionLabel>
        {order.length === 0 ? (
          <div className="empty">
            <div className="empty__icon">
              <ShellIcon shell="powershell" size={22} />
            </div>
            <div className="empty__title">No open sessions</div>
            <div className="empty__text">Start a CMD or PowerShell session from the + button.</div>
          </div>
        ) : (
          <Reorder.Group axis="y" values={order} onReorder={reorderSessions} as="div" className="session-list">
            <AnimatePresence initial={false}>
              {order.map((id) => (sessions[id] ? <SessionCard key={id} s={sessions[id]} active={id === activeId && !viewerId} /> : null))}
            </AnimatePresence>
          </Reorder.Group>
        )}

        <SectionLabel
          action={
            archive.length > 0 ? (
              <button className="link-btn" onClick={() => openArchive()}>
                View all {archive.length}
              </button>
            ) : undefined
          }
        >
          Recently closed
        </SectionLabel>
        {recent.length === 0 ? (
          <div className="panel__hint">
            <History size={14} />
            Closed sessions are archived here with their full output and commands.
          </div>
        ) : (
          <div className="recent-list">
            <AnimatePresence initial={false}>
              {recent.map((a) => (
                <RecentRow key={a.id} a={a} viewing={viewerId === a.id} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="panel__footer">
        <button className="btn btn--ghost btn--sm panel__footer-btn" onClick={() => openArchive()}>
          <Archive size={14} />
          Open archive
          <kbd>Ctrl+Shift+H</kbd>
        </button>
      </div>
    </div>
  )
}

