import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react'
import {
  AlarmClock,
  AlarmClockOff,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Code2,
  Copy,
  CopyPlus,
  GripVertical,
  Keyboard,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Repeat,
  Search,
  Settings2,
  Sparkles,
  Trash2
} from 'lucide-react'
import type { GroupStartState, Snippet, SnippetMode } from '@shared/types'
import { api } from '@/api'
import { set, useApp, type ContextMenuItem } from '@/store/app'
import {
  addExampleSnippets,
  deleteSnippet,
  moveSnippetGroup,
  openSettingsAt,
  openSnippetEditor,
  reorderSnippetGroups,
  runSnippet,
  setAllSnippetGroupsOpen,
  setSnippetGroupOpen,
  setSnippetGroupStart
} from '@/lib/actions'
import { fuzzyMatch } from '@/lib/fuzzy'
import { groupSnippets, groupStartsOpen, tokenizeSnippet } from '@/lib/snippets'
import { cancelPowerTimer, whenPhrase } from '@/lib/power'
import { POWER_META } from '@shared/power'
import { PanelHeader } from '../SidePanel'
import { showContextMenu } from '../ui/ContextMenu'
import { POWER_ICON } from '../power/powerIcons'

export const MODE_META: Record<SnippetMode, { label: string; verb: string; icon: typeof Play; tip: string }> = {
  run: { label: 'Run', verb: 'Run', icon: Play, tip: 'Types the command and presses Enter' },
  insert: { label: 'Type', verb: 'Type', icon: Keyboard, tip: 'Types the command so you can review it, without pressing Enter' },
  copy: { label: 'Copy', verb: 'Copy', icon: Copy, tip: 'Copies the command to the clipboard' }
}

function CommandPreview({ command }: { command: string }) {
  const first = command.split(/\r?\n/)
  return (
    <div className="snippet-card__cmd mono">
      {tokenizeSnippet(first[0]).map((t, i) =>
        t.variable ? (
          <span key={i} className="var-token">
            {t.text}
          </span>
        ) : (
          <span key={i}>{t.text}</span>
        )
      )}
      {first.length > 1 && <span className="snippet-card__more"> +{first.length - 1} lines</span>}
    </div>
  )
}

/** A built-in tool (the power timer): clicking opens it, and it shows the timer that is set. */
function ToolCard({ snippet }: { snippet: Snippet }) {
  const timer = useApp((s) => s.powerTimer)
  const menu = (e: React.MouseEvent) =>
    showContextMenu(e, [
      { label: 'Open', icon: <AlarmClock size={14} />, hint: 'default', run: () => void runSnippet(snippet) },
      ...(timer ? [{ label: 'Cancel power timer', icon: <AlarmClockOff size={14} />, run: () => void cancelPowerTimer() }] : []),
      { separator: true },
      { label: 'Rename…', icon: <Pencil size={14} />, run: () => openSnippetEditor(snippet) },
      { label: 'Delete', icon: <Trash2 size={14} />, danger: true, run: () => void deleteSnippet(snippet) }
    ])
  const TimerIcon = timer ? POWER_ICON[timer.action] : null

  return (
    <Reorder.Item
      value={snippet.id}
      as="div"
      className="snippet-card snippet-card--tool"
      style={timer ? ({ ['--pw-c' as string]: POWER_META[timer.action].color } as React.CSSProperties) : undefined}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.15 } }}
      whileDrag={{ scale: 1.02, boxShadow: 'var(--shadow)' }}
      onClick={() => void runSnippet(snippet)}
      onContextMenu={menu}
    >
      <div className="snippet-card__head">
        <span className="snippet-card__mode snippet-card__mode--tool" data-tip="Built-in tool: opens when clicked">
          <AlarmClock size={11} />
        </span>
        <span className="snippet-card__name">{snippet.name}</span>
        <div className="snippet-card__actions">
          <button
            className="icon-btn icon-btn--sm"
            onClick={(e) => {
              e.stopPropagation()
              menu(e)
            }}
            data-tip="More"
          >
            <MoreHorizontal size={13} />
          </button>
        </div>
      </div>
      {timer && TimerIcon ? (
        <div className="snippet-card__tool snippet-card__tool--set">
          <TimerIcon size={12} />
          <span className="snippet-card__tool-text">
            {POWER_META[timer.action].label} {whenPhrase(Math.max(timer.next, timer.warningUntil ?? 0))}
          </span>
          {timer.days.length > 0 && <Repeat size={11} className="snippet-card__tool-repeat" />}
        </div>
      ) : (
        <div className="snippet-card__tool">{snippet.description || 'Shut down, restart, sleep or hibernate at a time you pick.'}</div>
      )}
    </Reorder.Item>
  )
}

function SnippetCard({ snippet }: { snippet: Snippet }) {
  if (snippet.tool) return <ToolCard snippet={snippet} />
  return <CommandCard snippet={snippet} />
}

function CommandCard({ snippet }: { snippet: Snippet }) {
  const Mode = MODE_META[snippet.mode]
  const menu = (e: React.MouseEvent) =>
    showContextMenu(e, [
      { label: 'Run', icon: <Play size={14} />, hint: snippet.mode === 'run' ? 'default' : undefined, run: () => void runSnippet(snippet, 'run') },
      { label: 'Type into prompt', icon: <Keyboard size={14} />, hint: snippet.mode === 'insert' ? 'default' : undefined, run: () => void runSnippet(snippet, 'insert') },
      { label: 'Copy', icon: <Copy size={14} />, hint: snippet.mode === 'copy' ? 'default' : undefined, run: () => void runSnippet(snippet, 'copy') },
      { separator: true },
      { label: 'Edit…', icon: <Pencil size={14} />, run: () => openSnippetEditor(snippet) },
      {
        label: 'Duplicate',
        icon: <CopyPlus size={14} />,
        run: () => void api.library.upsertSnippet({ ...snippet, id: undefined, name: `${snippet.name} copy`, uses: 0 })
      },
      { label: 'Delete', icon: <Trash2 size={14} />, danger: true, run: () => void deleteSnippet(snippet) }
    ])

  return (
    <Reorder.Item
      value={snippet.id}
      as="div"
      className={`snippet-card snippet-card--${snippet.mode}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.15 } }}
      whileDrag={{ scale: 1.02, boxShadow: 'var(--shadow)' }}
      onClick={() => void runSnippet(snippet)}
      onContextMenu={menu}
      data-tip={snippet.description || undefined}
    >
      <div className="snippet-card__head">
        <span className={`snippet-card__mode snippet-card__mode--${snippet.mode}`} data-tip={Mode.tip}>
          <Mode.icon size={11} fill={snippet.mode === 'run' ? 'currentColor' : 'none'} />
        </span>
        <span className="snippet-card__name">{snippet.name}</span>
        {snippet.shell !== 'any' && (
          <span className={`shell-badge shell-badge--${snippet.shell}`}>{snippet.shell === 'cmd' ? 'CMD' : 'PS'}</span>
        )}
        <div className="snippet-card__actions">
          {(['run', 'insert', 'copy'] as SnippetMode[])
            .filter((m) => m !== snippet.mode)
            .map((m) => {
              const M = MODE_META[m]
              return (
                <button
                  key={m}
                  className="icon-btn icon-btn--sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    void runSnippet(snippet, m)
                  }}
                  data-tip={M.label}
                >
                  <M.icon size={12} />
                </button>
              )
            })}
          <button
            className="icon-btn icon-btn--sm"
            onClick={(e) => {
              e.stopPropagation()
              menu(e)
            }}
            data-tip="More"
          >
            <MoreHorizontal size={13} />
          </button>
        </div>
      </div>
      <CommandPreview command={snippet.command} />
    </Reorder.Item>
  )
}

export const GROUP_START_META: Record<GroupStartState, { label: string; menu: string; tip: string }> = {
  expanded: { label: 'Expanded', menu: 'Start expanded', tip: 'Open every time the app starts' },
  collapsed: { label: 'Collapsed', menu: 'Start collapsed', tip: 'Closed every time the app starts' },
  remember: { label: 'Remember', menu: 'Remember last state', tip: 'Open or closed, the way you last left it' }
}

interface GroupProps {
  name: string
  snippets: Snippet[]
  open: boolean
  /** Groups can be rearranged (not while filtering, where they are sorted by relevance). */
  movable: boolean
  first: boolean
  last: boolean
  onToggle: (open: boolean) => void
  onReorder: (ids: string[]) => void
}

function Group({ name, snippets, open, movable, first, last, onToggle, onReorder }: GroupProps) {
  const controls = useDragControls()
  const dragged = useRef(false)
  const [dragging, setDragging] = useState(false)
  const ownStart = useApp((s) => s.settings.snippetGroupStates[name])
  const defaultStart = useApp((s) => s.settings.snippetGroupDefault)

  const startItem = (state: GroupStartState | null): ContextMenuItem => ({
    label: state ? GROUP_START_META[state].menu : `Use default (${GROUP_START_META[defaultStart].label.toLowerCase()})`,
    hint: (ownStart ?? null) === state ? 'current' : undefined,
    run: () => setSnippetGroupStart(name, state)
  })

  const menu = (e: React.MouseEvent) =>
    showContextMenu(e, [
      { label: open ? 'Collapse' : 'Expand', icon: <ChevronRight size={14} />, run: () => onToggle(!open) },
      { label: 'Expand all groups', icon: <ChevronsUpDown size={14} />, run: () => setAllSnippetGroupsOpen(true) },
      { label: 'Collapse all groups', icon: <ChevronsDownUp size={14} />, run: () => setAllSnippetGroupsOpen(false) },
      { separator: true },
      { label: 'Move to top', icon: <ArrowUpToLine size={14} />, disabled: !movable || first, run: () => moveSnippetGroup(name, -Infinity) },
      { label: 'Move to bottom', icon: <ArrowDownToLine size={14} />, disabled: !movable || last, run: () => moveSnippetGroup(name, Infinity) },
      { separator: true },
      startItem('expanded'),
      startItem('collapsed'),
      startItem('remember'),
      startItem(null),
      { separator: true },
      { label: 'Group settings…', icon: <Settings2 size={14} />, run: () => openSettingsAt('snippets') }
    ])

  return (
    <Reorder.Item
      value={name}
      as="div"
      className={`snippet-group ${dragging ? 'snippet-group--dragging' : ''}`}
      dragListener={false}
      dragControls={controls}
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      onDragStart={() => {
        dragged.current = true
        setDragging(true)
      }}
      onDragEnd={() => setDragging(false)}
    >
      <button
        className={`snippet-group__head ${movable ? 'snippet-group__head--movable' : ''}`}
        aria-expanded={open}
        onPointerDown={(e) => {
          dragged.current = false
          if (movable && e.button === 0) controls.start(e)
        }}
        onClick={() => {
          // A drag that ends over the header still produces a click; it should not toggle the group.
          if (dragged.current) {
            dragged.current = false
            return
          }
          onToggle(!open)
        }}
        onKeyDown={(e) => {
          if (!movable || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
          e.preventDefault()
          moveSnippetGroup(name, e.key === 'ArrowUp' ? -1 : 1)
        }}
        onContextMenu={menu}
      >
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }} className="snippet-group__chev">
          <ChevronRight size={13} />
        </motion.span>
        <span className="snippet-group__name">{name}</span>
        <span className="snippet-group__count">{snippets.length}</span>
        {movable && (
          <span className="snippet-group__grip" aria-hidden data-tip="Drag to reorder groups">
            <GripVertical size={13} />
          </span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <Reorder.Group axis="y" values={snippets.map((s) => s.id)} onReorder={onReorder} as="div" className="snippet-list">
              <AnimatePresence initial={false}>
                {snippets.map((s) => (
                  <SnippetCard key={s.id} snippet={s} />
                ))}
              </AnimatePresence>
            </Reorder.Group>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  )
}

export function SnippetsPanel() {
  const snippets = useApp((s) => s.library.snippets)
  const groupOrder = useApp((s) => s.library.snippetGroupOrder)
  const remembered = useApp((s) => s.library.snippetGroupsCollapsed)
  const groupDefault = useApp((s) => s.settings.snippetGroupDefault)
  const groupStates = useApp((s) => s.settings.snippetGroupStates)
  const openNow = useApp((s) => s.snippetGroupOpen)
  const [query, setQuery] = useState('')
  const filtering = !!query.trim()
  // While filtering, groups with a match start open so a collapsed group never hides results.
  const [filterOpen, setFilterOpen] = useState<Record<string, boolean>>({})
  useEffect(() => setFilterOpen({}), [query])

  const filtered = useMemo(() => {
    if (!query.trim()) return snippets
    return snippets
      .map((s) => {
        // A built-in tool has no real command: it is found by what it does.
        const m = fuzzyMatch(query, `${s.name} ${s.group ?? ''}`) ?? fuzzyMatch(query, s.tool ? `${s.description ?? ''} shutdown restart sleep hibernate` : s.command)
        return m ? { s, score: m.score } : null
      })
      .filter((x): x is { s: Snippet; score: number } => !!x)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.s)
  }, [snippets, query])

  // Filtered results keep relevance order; otherwise groups follow the user's arrangement.
  const groups = useMemo(() => groupSnippets(filtered, filtering ? [] : groupOrder), [filtered, filtering, groupOrder])

  const isOpen = (name: string): boolean =>
    filtering
      ? (filterOpen[name] ?? true)
      : (openNow[name] ?? groupStartsOpen(name, { snippetGroupDefault: groupDefault, snippetGroupStates: groupStates }, remembered))
  const toggle = (name: string, open: boolean) => {
    if (filtering) setFilterOpen((f) => ({ ...f, [name]: open }))
    else setSnippetGroupOpen(name, open)
  }

  const reorderGroup = (groupIds: string[]) => {
    const groupSet = new Set(groupIds)
    const queue = [...groupIds]
    const next = snippets.map((s) => (groupSet.has(s.id) ? queue.shift()! : s.id))
    const byId = new Map(snippets.map((s) => [s.id, s]))
    const lib = useApp.getState().library
    set({ library: { ...lib, snippets: next.map((id) => byId.get(id)!) } })
    void api.library.reorderSnippets(next)
  }

  return (
    <div className="panel">
      <PanelHeader title="Saved commands" subtitle="Click to run, type or copy">
        {snippets.length > 0 && (
          <button className="icon-btn" onClick={() => openSettingsAt('snippets')} data-tip="Group order & start-up state">
            <Settings2 size={15} />
          </button>
        )}
        <button className="icon-btn" onClick={() => openSnippetEditor()} data-tip="New snippet">
          <Plus size={16} />
        </button>
      </PanelHeader>

      {snippets.length > 0 && (
        <div className="panel__toolbar">
          <div className="search-input">
            <Search size={14} />
            <input className="input" placeholder="Filter snippets…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
      )}

      <div className="panel__scroll">
        {snippets.length === 0 ? (
          <div className="empty">
            <div className="empty__icon">
              <Code2 size={22} />
            </div>
            <div className="empty__title">Save commands you use often</div>
            <div className="empty__text">
              One click runs them, types them for review, or copies them. Use <span className="var-token">{'{{name}}'}</span> for values you fill in each time.
            </div>
            <div className="empty__actions">
              <button className="btn btn--primary btn--sm" onClick={() => openSnippetEditor()}>
                <Plus size={14} />
                New snippet
              </button>
              <button className="btn btn--sm" onClick={() => void addExampleSnippets()}>
                <Sparkles size={14} />
                Add examples
              </button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <div className="empty__title">No matches</div>
            <div className="empty__text">Nothing matches “{query}”.</div>
          </div>
        ) : (
          <Reorder.Group axis="y" values={groups.map(([g]) => g)} onReorder={reorderSnippetGroups} as="div" className="snippet-groups">
            <AnimatePresence initial={false}>
              {groups.map(([name, list], i) => (
                <Group
                  key={name}
                  name={name}
                  snippets={list}
                  open={isOpen(name)}
                  movable={!filtering && groups.length > 1}
                  first={i === 0}
                  last={i === groups.length - 1}
                  onToggle={(open) => toggle(name, open)}
                  onReorder={reorderGroup}
                />
              ))}
            </AnimatePresence>
          </Reorder.Group>
        )}
      </div>
    </div>
  )
}
