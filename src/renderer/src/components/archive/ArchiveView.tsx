import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Archive,
  Brush,
  Check,
  CheckSquare,
  ChevronDown,
  Clipboard,
  Code2,
  Download,
  FolderOpen,
  Pin,
  RotateCcw,
  Search,
  Square,
  Tag,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import type { ArchiveSearchHit, ArchivedSession, CommandRecord } from '@shared/types'
import { api } from '@/api'
import { get, useApp } from '@/store/app'
import { closeOverlay, confirm, deleteArchived, newSession, openSnippetEditor, resumeArchived, toast } from '@/lib/actions'
import { bytes, dateTime, dayGroup, duration, relativeTime, shortPath } from '@/lib/format'
import { stripAnsi } from '@/lib/ansi'
import { ShellIcon } from '../icons'
import { LogViewer, type LogViewerHandle } from '../terminal/LogViewer'
import { FindBar } from '../terminal/FindBar'
import { TagEditor, TagPill, tagColor } from './TagEditor'
import { TagManager } from './TagManager'
import { showContextMenu } from '../ui/ContextMenu'

type ShellFilter = 'all' | 'cmd' | 'powershell'

export function ArchiveView() {
  const archive = useApp((s) => s.archive)
  const tags = useApp((s) => s.library.tags)
  const focusRequest = useApp((s) => s.archiveFocusId)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ArchiveSearchHit[]>([])
  const [shell, setShell] = useState<ShellFilter>('all')
  const [keptOnly, setKeptOnly] = useState(false)
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focusId, setFocusId] = useState<string | null>(focusRequest ?? archive[0]?.id ?? null)
  const [stats, setStats] = useState({ count: 0, bytes: 0 })
  const lastClicked = useRef<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focusRequest) setFocusId(focusRequest)
  }, [focusRequest])

  useEffect(() => {
    void api.archive.stats().then(setStats)
  }, [archive])

  // Full-text search inside archived output (debounced).
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    const t = window.setTimeout(() => void api.archive.search(q).then(setHits), 220)
    return () => window.clearTimeout(t)
  }, [query, archive])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hitIds = new Set(hits.map((h) => h.id))
    return archive.filter((a) => {
      if (shell !== 'all' && (shell === 'cmd') !== (a.shell === 'cmd')) return false
      if (keptOnly && !a.pinned) return false
      if (tagFilter.length && !tagFilter.every((t) => a.tags.includes(t))) return false
      if (!q) return true
      const meta = `${a.title} ${a.cwd} ${a.tags.join(' ')} ${a.note ?? ''} ${a.commands.map((c) => c.text).join(' ')}`.toLowerCase()
      return meta.includes(q) || hitIds.has(a.id)
    })
  }, [archive, query, hits, shell, keptOnly, tagFilter])

  const groups = useMemo(() => {
    const out: { label: string; items: ArchivedSession[] }[] = []
    for (const a of filtered) {
      const label = a.pinned && !query ? 'Kept' : dayGroup(a.endedAt)
      let g = out.find((x) => x.label === label)
      if (!g) out.push((g = { label, items: [] }))
      g.items.push(a)
    }
    // Kept sessions first
    return out.sort((a, b) => (a.label === 'Kept' ? -1 : b.label === 'Kept' ? 1 : 0))
  }, [filtered, query])
  const flat = groups.flatMap((g) => g.items)

  // Keep focus on something that exists.
  useEffect(() => {
    if (!focusId || !archive.some((a) => a.id === focusId)) setFocusId(flat[0]?.id ?? null)
    setSelected((cur) => {
      const next = new Set([...cur].filter((id) => archive.some((a) => a.id === id)))
      return next.size === cur.size ? cur : next
    })
  }, [archive]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    listRef.current?.querySelector('.arch-item--focus')?.scrollIntoView({ block: 'nearest' })
  }, [focusId])

  const focused = archive.find((a) => a.id === focusId) ?? null
  const usedTags = useMemo(() => tags.filter((t) => archive.some((a) => a.tags.includes(t.name))), [tags, archive])

  const toggleSelect = (id: string, range: boolean) => {
    setSelected((cur) => {
      const next = new Set(cur)
      if (range && lastClicked.current) {
        const a = flat.findIndex((x) => x.id === lastClicked.current)
        const b = flat.findIndex((x) => x.id === id)
        if (a >= 0 && b >= 0) {
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(flat[i].id)
          return next
        }
      }
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    lastClicked.current = id
  }

  const selection = [...selected]
  const bulkTag = async (name: string) => {
    for (const id of selection) {
      const a = archive.find((x) => x.id === id)
      if (a && !a.tags.includes(name)) await api.archive.update(id, { tags: [...a.tags, name] })
    }
    toast('success', `Tagged ${selection.length} session${selection.length === 1 ? '' : 's'}`, { message: name })
  }
  const bulkKeep = async () => {
    const keep = !selection.every((id) => archive.find((a) => a.id === id)?.pinned)
    for (const id of selection) await api.archive.update(id, { pinned: keep })
  }
  const bulkDelete = async () => {
    const kept = selection.filter((id) => archive.find((a) => a.id === id)?.pinned).length
    if (kept) {
      const ok = await confirm({
        title: `Delete ${selection.length} sessions?`,
        message: `${kept} of them ${kept === 1 ? 'is' : 'are'} marked “Keep”. Their output and command history will be deleted.`,
        confirmLabel: 'Delete',
        danger: true
      })
      if (!ok) return
    }
    deleteArchived(selection)
    setSelected(new Set())
  }

  const cleanup = async () => {
    const days = get().settings.archiveRetentionDays || 30
    const ok = await confirm({
      title: 'Clean up the archive?',
      message: `Delete sessions that ended more than ${days} days ago and are neither kept nor tagged. Kept and tagged sessions are never removed.`,
      confirmLabel: 'Clean up',
      danger: true
    })
    if (!ok) return
    const n = await api.archive.cleanup(days)
    toast(n ? 'success' : 'info', n ? `Removed ${n} old session${n === 1 ? '' : 's'}` : 'Nothing to clean up')
  }

  const onListKey = (e: React.KeyboardEvent) => {
    const idx = flat.findIndex((a) => a.id === focusId)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = flat[Math.max(0, Math.min(flat.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) setFocusId(next.id)
    } else if (e.key === 'Delete') {
      e.preventDefault()
      if (selection.length) void bulkDelete()
      else if (focused) deleteArchived([focused.id])
    } else if (e.key === 'a' && e.ctrlKey) {
      e.preventDefault()
      setSelected(new Set(flat.map((a) => a.id)))
    } else if (e.key === ' ' && focusId) {
      e.preventDefault()
      toggleSelect(focusId, e.shiftKey)
    } else if (e.key === 'Enter' && focused) {
      e.preventDefault()
      void resumeArchived(focused.id)
    }
  }

  return (
    <motion.div
      className="archive"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 18, transition: { duration: 0.16 } }}
      transition={{ type: 'spring', stiffness: 340, damping: 34 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) closeOverlay()
      }}
    >
      <div className="archive__sidebar">
        <div className="archive__head">
          <div className="archive__title">
            <Archive size={18} />
            <div>
              <h2>Archive</h2>
              <span>
                {stats.count} session{stats.count === 1 ? '' : 's'} · {bytes(stats.bytes)}
              </span>
            </div>
          </div>
          <div className="archive__head-actions">
            <button className="icon-btn" onClick={() => void cleanup()} data-tip="Clean up old sessions">
              <Brush size={15} />
            </button>
            <TagManager />
            <button className="icon-btn" onClick={closeOverlay} data-tip="Close" data-tip-kbd="Esc">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="archive__filters">
          <div className="search-input">
            <Search size={14} />
            <input className="input" placeholder="Search titles, folders, commands and output…" value={query} onChange={(e) => setQuery(e.target.value)} data-autofocus />
          </div>
          <div className="archive__filter-row">
            {(['all', 'cmd', 'powershell'] as ShellFilter[]).map((f) => (
              <button key={f} className={`chip ${shell === f ? 'chip--active' : ''}`} onClick={() => setShell(f)}>
                {f !== 'all' && <ShellIcon shell={f} size={11} colored={false} />}
                {f === 'all' ? 'All' : f === 'cmd' ? 'CMD' : 'PowerShell'}
              </button>
            ))}
            <button className={`chip ${keptOnly ? 'chip--active' : ''}`} onClick={() => setKeptOnly((v) => !v)}>
              <Pin size={11} />
              Kept
            </button>
          </div>
          {usedTags.length > 0 && (
            <div className="archive__filter-row archive__filter-row--tags">
              {usedTags.map((t) => (
                <TagPill
                  key={t.name}
                  name={t.name}
                  color={t.color}
                  active={tagFilter.includes(t.name)}
                  onClick={() => setTagFilter((cur) => (cur.includes(t.name) ? cur.filter((x) => x !== t.name) : [...cur, t.name]))}
                />
              ))}
            </div>
          )}
        </div>

        <AnimatePresence initial={false}>
          {selection.length > 0 && (
            <motion.div className="bulk-bar" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
              <div className="bulk-bar__inner">
                <span className="bulk-bar__count">{selection.length} selected</span>
                <button
                  className="btn btn--sm"
                  onClick={(e) =>
                    showContextMenu(
                      e,
                      tags.length
                        ? tags.map((t) => ({ label: t.name, icon: <span className="chip__dot" style={{ background: t.color }} />, run: () => void bulkTag(t.name) }))
                        : [{ label: 'No tags yet — add one to a session first', disabled: true }]
                    )
                  }
                >
                  <Tag size={12} /> Tag <ChevronDown size={11} />
                </button>
                <button className="btn btn--sm" onClick={() => void bulkKeep()}>
                  <Pin size={12} /> Keep
                </button>
                <button className="btn btn--sm btn--danger" onClick={() => void bulkDelete()}>
                  <Trash2 size={12} /> Delete
                </button>
                <button className="icon-btn icon-btn--sm" onClick={() => setSelected(new Set())} data-tip="Clear selection">
                  <X size={13} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="archive__list" ref={listRef} tabIndex={0} onKeyDown={onListKey}>
          {archive.length === 0 ? (
            <div className="empty">
              <div className="empty__icon">
                <Archive size={22} />
              </div>
              <div className="empty__title">Nothing archived yet</div>
              <div className="empty__text">When you close a session, its output and commands are saved here so you can look back, tag, export or resume it.</div>
            </div>
          ) : flat.length === 0 ? (
            <div className="empty">
              <div className="empty__title">No sessions match</div>
              <button
                className="btn btn--sm"
                onClick={() => {
                  setQuery('')
                  setShell('all')
                  setKeptOnly(false)
                  setTagFilter([])
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.label} className="arch-group">
                <div className="arch-group__label">{g.label}</div>
                <AnimatePresence initial={false}>
                  {g.items.map((a) => (
                    <ArchiveItem
                      key={a.id}
                      a={a}
                      focused={a.id === focusId}
                      selected={selected.has(a.id)}
                      selecting={selection.length > 0}
                      excerpt={hits.find((h) => h.id === a.id)?.excerpt}
                      onFocus={() => setFocusId(a.id)}
                      onToggle={(range) => toggleSelect(a.id, range)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="archive__detail">
        <AnimatePresence mode="wait">
          {focused ? (
            <ArchiveDetail key={focused.id} a={focused} />
          ) : (
            <motion.div key="none" className="archive__placeholder" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Archive size={36} />
              <span>Select a session to see its output</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

function ArchiveItem({
  a,
  focused,
  selected,
  selecting,
  excerpt,
  onFocus,
  onToggle
}: {
  a: ArchivedSession
  focused: boolean
  selected: boolean
  selecting: boolean
  excerpt?: string
  onFocus: () => void
  onToggle: (range: boolean) => void
}) {
  const tags = useApp((s) => s.library.tags)
  const failed = a.commands.filter((c) => c.exitCode !== undefined && c.exitCode !== 0).length
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0, transition: { duration: 0.2 } }}
      className={`arch-item ${focused ? 'arch-item--focus' : ''} ${selected ? 'arch-item--selected' : ''} ${selecting ? 'arch-item--selecting' : ''}`}
      onClick={(e) => {
        if (e.ctrlKey || e.shiftKey || selecting) onToggle(e.shiftKey)
        else onFocus()
      }}
      onDoubleClick={() => void resumeArchived(a.id)}
      onContextMenu={(e) =>
        showContextMenu(e, [
          { label: 'Resume in a new session', icon: <RotateCcw size={14} />, run: () => void resumeArchived(a.id) },
          { label: a.pinned ? 'Stop keeping' : 'Keep', icon: <Pin size={14} />, run: () => void api.archive.update(a.id, { pinned: !a.pinned }) },
          { label: 'Export output…', icon: <Download size={14} />, run: () => void api.archive.exportLog(a.id) },
          { label: selected ? 'Deselect' : 'Select', icon: <CheckSquare size={14} />, run: () => onToggle(false) },
          { separator: true },
          { label: 'Delete', icon: <Trash2 size={14} />, danger: true, run: () => deleteArchived([a.id]) }
        ])
      }
    >
      <button
        className="arch-item__check"
        onClick={(e) => {
          e.stopPropagation()
          onToggle(e.shiftKey)
        }}
        aria-label={selected ? 'Deselect' : 'Select'}
      >
        {selected ? <CheckSquare size={15} /> : <Square size={15} />}
      </button>
      <div className="arch-item__icon">
        <ShellIcon shell={a.shell} size={16} />
      </div>
      <div className="arch-item__body">
        <div className="arch-item__row">
          <span className="arch-item__title">{a.title}</span>
          {a.pinned && <Pin size={11} className="arch-item__pin" />}
          <span className="arch-item__time">{relativeTime(a.endedAt)}</span>
        </div>
        <div className="arch-item__meta">
          <span className="mono">{shortPath(a.cwd, 30)}</span>
          <span>
            · {a.commands.length} cmd{a.commands.length === 1 ? '' : 's'}
          </span>
          {failed > 0 && <span className="arch-item__failed">· {failed} failed</span>}
        </div>
        {excerpt && <div className="arch-item__excerpt mono">{excerpt}</div>}
        {a.tags.length > 0 && (
          <div className="arch-item__tags">
            {a.tags.map((t) => (
              <span key={t} className="mini-tag" style={{ ['--tag' as string]: tagColor(tags, t) }}>
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}

function ArchiveDetail({ a }: { a: ArchivedSession }) {
  const [tab, setTab] = useState<'output' | 'commands'>('output')
  const [findOpen, setFindOpen] = useState(false)
  const [note, setNote] = useState(a.note ?? '')
  const viewer = useRef<LogViewerHandle>(null)

  useEffect(() => setNote(a.note ?? ''), [a.note])

  const copyOutput = async () => {
    const log = await api.archive.log(a.id)
    await api.system.writeClipboard(stripAnsi(log).replace(/\r/g, '').replace(/\n+$/, ''))
    toast('success', 'Output copied')
  }

  const deleteOne = async () => {
    if (a.pinned) {
      const ok = await confirm({ title: 'Delete a kept session?', message: 'This session is marked “Keep”. Delete it anyway?', confirmLabel: 'Delete', danger: true })
      if (!ok) return
    }
    deleteArchived([a.id])
  }

  return (
    <motion.div
      className="arch-detail"
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8, transition: { duration: 0.1 } }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="arch-detail__head">
        <div className="arch-detail__icon">
          <ShellIcon shell={a.shell} size={22} />
        </div>
        <div className="arch-detail__titles">
          <input
            className="arch-detail__title"
            defaultValue={a.title}
            key={a.title}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim()
              if (v !== a.title) void api.archive.update(a.id, { customTitle: v || null })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            spellCheck={false}
          />
          <div className="arch-detail__sub">
            Ended {relativeTime(a.endedAt)} · {a.endReason === 'exit' ? `shell exited${a.exitCode ? ` (${a.exitCode})` : ''}` : a.endReason === 'app-quit' ? 'app closed' : 'closed'}
          </div>
        </div>
        <div className="arch-detail__actions">
          <button
            className={`btn btn--sm ${a.pinned ? 'btn--keep-on' : ''}`}
            onClick={() => void api.archive.update(a.id, { pinned: !a.pinned })}
            data-tip={a.pinned ? 'Kept: never removed by clean-up' : 'Keep: protect from clean-up'}
          >
            <Pin size={13} fill={a.pinned ? 'currentColor' : 'none'} />
            {a.pinned ? 'Kept' : 'Keep'}
          </button>
          <button className="icon-btn" onClick={() => void copyOutput()} data-tip="Copy output as text">
            <Clipboard size={15} />
          </button>
          <button className="icon-btn" onClick={() => void api.archive.exportLog(a.id)} data-tip="Export to a .txt file">
            <Download size={15} />
          </button>
          <button className="icon-btn icon-btn--danger" onClick={() => void deleteOne()} data-tip="Delete" data-tip-kbd="Del">
            <Trash2 size={15} />
          </button>
          <button className="btn btn--sm btn--primary" onClick={() => void resumeArchived(a.id)}>
            <RotateCcw size={13} />
            Resume
          </button>
        </div>
      </div>

      <div className="arch-detail__facts">
        <Fact label="Folder">
          <button className="fact-link mono" onClick={() => void newSession({ cwd: a.cwd, shell: a.shell, exact: true })} data-tip="Open a new session here">
            <FolderOpen size={12} />
            {shortPath(a.cwd, 44)}
          </button>
        </Fact>
        <Fact label="Started">{dateTime(a.createdAt)}</Fact>
        <Fact label="Duration">{duration(a.endedAt - a.createdAt)}</Fact>
        <Fact label="Output">{bytes(a.logBytes)}</Fact>
      </div>

      <div className="arch-detail__tags">
        <TagEditor value={a.tags} onChange={(tags) => void api.archive.update(a.id, { tags })} />
      </div>

      <textarea
        className="arch-detail__note"
        placeholder="Add a note about this session…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== (a.note ?? '') && void api.archive.update(a.id, { note })}
        rows={1}
      />

      <div className="arch-detail__tabs">
        {(['output', 'commands'] as const).map((t) => (
          <button key={t} className={`arch-tab ${tab === t ? 'arch-tab--on' : ''}`} onClick={() => setTab(t)}>
            {tab === t && <motion.span layoutId="arch-tab" className="arch-tab__line" />}
            {t === 'output' ? <Terminal size={13} /> : <Code2 size={13} />}
            {t === 'output' ? 'Output' : `Commands (${a.commands.length})`}
          </button>
        ))}
        {tab === 'output' && (
          <button className="icon-btn icon-btn--sm arch-detail__find" onClick={() => setFindOpen((v) => !v)} data-tip="Find in output">
            <Search size={13} />
          </button>
        )}
      </div>

      <div className="arch-detail__content">
        {tab === 'output' ? (
          <div className="arch-detail__output">
            <LogViewer ref={viewer} sessionId={a.id} />
            <AnimatePresence>{findOpen && <FindBar search={viewer.current?.search} onClose={() => setFindOpen(false)} />}</AnimatePresence>
          </div>
        ) : (
          <CommandList commands={a.commands} />
        )}
      </div>
    </motion.div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fact">
      <span className="fact__label">{label}</span>
      <span className="fact__value">{children}</span>
    </div>
  )
}

export function CommandList({ commands }: { commands: CommandRecord[] }) {
  const active = useApp((s) => (s.activeId ? s.sessions[s.activeId] : null))
  if (!commands.length) {
    return (
      <div className="empty">
        <div className="empty__title">No commands recorded</div>
        <div className="empty__text">Commands are recorded when the shell reports them (shell integration).</div>
      </div>
    )
  }
  return (
    <div className="cmd-list">
      {[...commands].reverse().map((c) => (
        <div key={`${c.id}-${c.startedAt}`} className="cmd-row">
          <span className={`cmd-row__status ${c.exitCode === undefined ? '' : c.exitCode === 0 ? 'cmd-row__status--ok' : 'cmd-row__status--err'}`}>
            {c.exitCode === undefined ? '•' : c.exitCode === 0 ? <Check size={11} /> : c.exitCode}
          </span>
          <div className="cmd-row__body">
            <span className="cmd-row__text mono">{c.text}</span>
            <span className="cmd-row__meta">
              {dateTime(c.startedAt)}
              {c.endedAt ? ` · ${duration(c.endedAt - c.startedAt)}` : ''} · <span className="mono">{shortPath(c.cwd, 40)}</span>
            </span>
          </div>
          <div className="cmd-row__actions">
            <button className="icon-btn icon-btn--sm" onClick={() => void api.system.writeClipboard(c.text).then(() => toast('success', 'Command copied'))} data-tip="Copy">
              <Clipboard size={12} />
            </button>
            <button className="icon-btn icon-btn--sm" onClick={() => openSnippetEditor({ command: c.text, name: c.text.slice(0, 40) })} data-tip="Save as snippet">
              <Code2 size={12} />
            </button>
            {active && active.status !== 'exited' && (
              <button
                className="icon-btn icon-btn--sm"
                onClick={() => {
                  closeOverlay()
                  void api.sessions.exec(active.id, c.text, { execute: false, clearLine: true })
                }}
                data-tip="Type into the active session"
              >
                <Terminal size={12} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
