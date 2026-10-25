import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  AlarmClock,
  AlarmClockOff,
  Archive,
  Clock,
  Code2,
  Copy,
  Eraser,
  ExternalLink,
  FolderPlus,
  Keyboard,
  Moon,
  Palette,
  PanelLeft,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Star,
  Sun,
  X,
  Wand2,
  Zap,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { api } from '@/api'
import { get, set, useApp } from '@/store/app'
import {
  activate,
  cdTo,
  clearTerminal,
  closeSession,
  focusActive,
  newSession,
  openArchive,
  openSettings,
  openSnippetEditor,
  pickAndAddFavorite,
  resolveFamily,
  restartSession,
  resolvedDark,
  runSnippet,
  saveSelectionAsSnippet,
  sessionLabel,
  togglePanel,
  toggleFavorite,
  updateSettings,
  zoom
} from '@/lib/actions'
import { fuzzyMatch } from '@/lib/fuzzy'
import { folderName, samePath, shortPath } from '@/lib/format'
import { familyOf } from '@/lib/shell'
import { TERMINAL_THEMES } from '@/terminal/themes'
import { openActionEditor, openLauncherEditor, openLauncherManager, runLauncher } from '@/lib/launchers'
import { cancelPowerTimer, openPowerTimer, whenPhrase } from '@/lib/power'
import { POWER_META } from '@shared/power'
import { LauncherIcon, ShellIcon } from './icons'
import { Highlight } from './ui/Controls'

interface Item {
  id: string
  group: string
  title: string
  subtitle?: string
  icon: ReactNode
  hint?: string
  keywords?: string
  run: (e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => void
}

const GROUP_ORDER = ['Sessions', 'Shortcuts', 'Snippets', 'Folders', 'Actions', 'Themes']
const POWER_KEYWORDS = 'shutdown shut down restart reboot sleep hibernate schedule timer power off turn off'

function useItems(): Item[] {
  const sessions = useApp((s) => s.sessions)
  const order = useApp((s) => s.order)
  const activeId = useApp((s) => s.activeId)
  const library = useApp((s) => s.library)
  const settings = useApp((s) => s.settings)
  const powerTimer = useApp((s) => s.powerTimer)

  return useMemo(() => {
    const items: Item[] = []
    const active = activeId ? sessions[activeId] : null

    for (const id of order) {
      const s = sessions[id]
      if (!s) continue
      items.push({
        id: `session:${id}`,
        group: 'Sessions',
        title: sessionLabel(s),
        subtitle: shortPath(s.cwd, 50),
        icon: <ShellIcon shell={s.shell} size={15} />,
        hint: id === activeId ? 'current' : s.status === 'busy' ? 'running' : undefined,
        keywords: `${s.cwd} ${familyOf(s.shell)}`,
        run: () => activate(id)
      })
    }

    for (const l of library.launchers) {
      if (l.kind === 'action') {
        // Asks for a folder (Shift: the current one), then for confirmation.
        items.push({
          id: `launcher:${l.id}`,
          group: 'Shortcuts',
          title: l.name,
          subtitle: l.description || `Folder action · ${l.recursive ? 'every subfolder' : 'one folder'}`,
          icon: <LauncherIcon color={l.color} size={16} />,
          hint: 'Run…',
          keywords: `folder action file ${l.description} ${l.script}`,
          run: (e) => void runLauncher(l, { here: e.shiftKey })
        })
        continue
      }
      items.push({
        id: `launcher:${l.id}`,
        group: 'Shortcuts',
        title: l.name,
        subtitle: l.script.trim() ? `${shortPath(l.folder, 30)} · ${l.script.trim().split('\n')[0]}` : shortPath(l.folder, 50),
        icon: <LauncherIcon color={l.color} size={16} />,
        hint: 'Open',
        keywords: `shortcut launcher ${l.folder} ${l.script}`,
        run: (e) => void runLauncher(l, { here: e.shiftKey })
      })
    }

    for (const sn of library.snippets) {
      if (sn.tool) {
        // A built-in tool: its command is only a placeholder.
        items.push({
          id: `snippet:${sn.id}`,
          group: 'Snippets',
          title: sn.name,
          subtitle: sn.description,
          icon: <AlarmClock size={14} />,
          hint: 'Open',
          keywords: `${sn.group ?? ''} ${sn.description ?? ''} ${POWER_KEYWORDS}`,
          run: () => void runSnippet(sn)
        })
        continue
      }
      items.push({
        id: `snippet:${sn.id}`,
        group: 'Snippets',
        title: sn.name,
        subtitle: sn.command.split('\n')[0],
        icon: sn.mode === 'run' ? <Play size={14} /> : sn.mode === 'insert' ? <Keyboard size={14} /> : <Copy size={14} />,
        hint: sn.mode === 'run' ? 'Run' : sn.mode === 'insert' ? 'Type' : 'Copy',
        keywords: `${sn.group ?? ''} ${sn.command} ${sn.description ?? ''}`,
        run: (e) => void runSnippet(sn, e.altKey ? 'copy' : e.shiftKey ? 'insert' : undefined)
      })
    }

    const seen: string[] = []
    const folderItem = (path: string, name: string, fav: boolean): Item => ({
      id: `folder:${path}`,
      group: 'Folders',
      title: name,
      subtitle: shortPath(path, 56),
      icon: fav ? <Star size={14} /> : <Clock size={14} />,
      hint: 'cd',
      keywords: path,
      run: (e) => void cdTo(path, { newSession: e.ctrlKey })
    })
    for (const f of library.favorites) {
      seen.push(f.path)
      items.push(folderItem(f.path, f.name, true))
    }
    for (const r of library.recentFolders) {
      if (seen.some((p) => samePath(p, r.path))) continue
      items.push(folderItem(r.path, folderName(r.path), false))
    }

    const act = (id: string, title: string, icon: ReactNode, run: () => void, hint?: string, keywords?: string): Item => ({
      id: `action:${id}`,
      group: 'Actions',
      title,
      icon,
      run,
      hint,
      keywords
    })
    items.push(
      act('new-cmd', 'New CMD session', <ShellIcon shell="cmd" size={15} />, () => void newSession({ shell: 'cmd' }), 'Ctrl+Shift+1'),
      act('new-ps', 'New PowerShell session', <ShellIcon shell="powershell" size={15} />, () => void newSession({ shell: resolveFamily('powershell'), exact: true }), 'Ctrl+Shift+2'),
      act('new-folder', 'New session in folder…', <FolderPlus size={14} />, async () => {
        const dir = await api.system.pickFolder(active?.cwd)
        if (dir) void newSession({ cwd: dir })
      }),
      act('new-snippet', 'New snippet…', <Code2 size={14} />, () => openSnippetEditor(), undefined, 'save command'),
      act('new-launcher', 'New shortcut…', <Zap size={14} />, () => openLauncherEditor(), undefined, 'launcher desktop folder script'),
      act('new-launcher-action', 'New folder action…', <Wand2 size={14} />, () => openActionEditor(), undefined, 'script file program exe rename'),
      act('launchers', 'Manage shortcuts', <Zap size={14} />, openLauncherManager, 'Ctrl+Shift+L', 'launcher desktop'),
      act('power-timer', powerTimer ? 'Power timer: change or cancel…' : 'Power timer…', <AlarmClock size={14} />, openPowerTimer, undefined, POWER_KEYWORDS),
      act('archive', 'Open archive', <Archive size={14} />, () => openArchive(), 'Ctrl+Shift+H', 'history closed sessions'),
      act('settings', 'Open settings', <Settings2 size={14} />, openSettings, 'Ctrl+,', 'preferences'),
      act('panel', 'Toggle side panel', <PanelLeft size={14} />, () => togglePanel(get().panel ?? 'sessions'), 'Ctrl+Shift+B'),
      act('add-fav-pick', 'Add a favorite folder…', <FolderPlus size={14} />, () => void pickAndAddFavorite()),
      act('zoom-in', 'Zoom in', <ZoomIn size={14} />, () => zoom(1), 'Ctrl+='),
      act('zoom-out', 'Zoom out', <ZoomOut size={14} />, () => zoom(-1), 'Ctrl+-'),
      act(
        'theme',
        resolvedDark(settings) ? 'Switch to light theme' : 'Switch to dark theme',
        resolvedDark(settings) ? <Sun size={14} /> : <Moon size={14} />,
        () => {
          const dark = resolvedDark(get().settings)
          void updateSettings({ appTheme: dark ? 'light' : 'dark', terminalTheme: dark ? 'pro-daylight' : 'pro-midnight' })
        },
        undefined,
        'appearance'
      )
    )
    if (powerTimer) {
      items.push(
        act(
          'power-cancel',
          `Cancel power timer (${POWER_META[powerTimer.action].label.toLowerCase()} ${whenPhrase(powerTimer.next)})`,
          <AlarmClockOff size={14} />,
          () => void cancelPowerTimer(),
          undefined,
          POWER_KEYWORDS
        )
      )
    }
    if (active) {
      items.push(
        act('find', 'Find in terminal', <Search size={14} />, () => set({ findOpen: true }), 'Ctrl+Shift+F'),
        act('clear', 'Clear terminal', <Eraser size={14} />, () => void clearTerminal(active.id), undefined, 'cls'),
        act('rename', 'Rename session…', <Pencil size={14} />, () => {
          const el = document.querySelector('.tab--active') as HTMLElement | null
          el?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
        }),
        act('restart', 'Restart session', <RotateCcw size={14} />, () => void restartSession(active.id)),
        act('close', 'Close session', <X size={14} />, () => void closeSession(active.id), 'Ctrl+Shift+W'),
        act('fav-cwd', 'Toggle current folder as favorite', <Star size={14} />, () => void toggleFavorite(active.cwd)),
        act('explorer', 'Open current folder in Explorer', <ExternalLink size={14} />, () => void api.system.openPath(active.cwd)),
        act('dup', 'Duplicate session', <Plus size={14} />, () => void newSession({ shell: active.shell, exact: true, cwd: active.cwd })),
        act('save-sel', 'Save selection as snippet', <Code2 size={14} />, saveSelectionAsSnippet)
      )
    }
    for (const t of TERMINAL_THEMES) {
      items.push({
        id: `theme:${t.id}`,
        group: 'Themes',
        title: `Terminal theme: ${t.name}`,
        icon: <Palette size={14} />,
        hint: settings.terminalTheme === t.id ? 'current' : undefined,
        keywords: 'color scheme',
        run: () => void updateSettings({ terminalTheme: t.id })
      })
    }
    return items
  }, [sessions, order, activeId, library, settings, powerTimer])
}

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen)
  const close = () => {
    set({ paletteOpen: false })
    focusActive()
  }
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="palette-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <PaletteBody onClose={close} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const items = useItems()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const q = query.trim()
    if (!q) {
      // Without a query: open sessions, then snippets and folders, then common actions.
      const pick = (g: string, n: number) => items.filter((i) => i.group === g).slice(0, n)
      return [...pick('Sessions', 6), ...pick('Shortcuts', 5), ...pick('Snippets', 5), ...pick('Folders', 5), ...pick('Actions', 8)].map((item) => ({ item, indices: [] as number[] }))
    }
    return items
      .map((item) => {
        const m = fuzzyMatch(q, item.title)
        const k = m ? null : fuzzyMatch(q, `${item.subtitle ?? ''} ${item.keywords ?? ''}`)
        if (!m && !k) return null
        return { item, indices: m?.indices ?? [], score: (m?.score ?? (k!.score - 400)) + (item.group === 'Themes' ? -200 : 0) }
      })
      .filter((x): x is { item: Item; indices: number[]; score: number } => !!x)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
  }, [items, query])

  const grouped = useMemo(() => {
    if (query.trim()) return [{ group: 'Results', rows: results }]
    return GROUP_ORDER.map((g) => ({ group: g, rows: results.filter((r) => r.item.group === g) })).filter((g) => g.rows.length)
  }, [results, query])
  const flat = grouped.flatMap((g) => g.rows)

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    list.current?.querySelector('.palette-row--on')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const execute = (i: number, e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => {
    const row = flat[i]
    if (!row) return
    set({ paletteOpen: false })
    row.item.run(e)
    if (row.item.group !== 'Actions' || !/archive|settings|find|rename|launcher/.test(row.item.id)) focusActive()
  }

  let n = -1
  return (
    <motion.div
      className="palette"
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 480, damping: 36 }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onClose()
        else if (e.key === 'ArrowDown') {
          e.preventDefault()
          setIndex((i) => Math.min(flat.length - 1, i + 1))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setIndex((i) => Math.max(0, i - 1))
        } else if (e.key === 'Enter') {
          e.preventDefault()
          execute(index, e)
        }
      }}
    >
      <div className="palette__input">
        <Search size={16} />
        <input autoFocus placeholder="Search sessions, snippets, folders and actions…" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
        <kbd>Esc</kbd>
      </div>
      <div className="palette__list" ref={list}>
        {flat.length === 0 && <div className="palette__empty">Nothing found for “{query}”</div>}
        {grouped.map((g) => (
          <div key={g.group} className="palette__group">
            <div className="palette__group-label">{g.group}</div>
            {g.rows.map(({ item, indices }) => {
              n++
              const i = n
              return (
                <button
                  key={item.id}
                  className={`palette-row ${i === index ? 'palette-row--on' : ''}`}
                  onMouseMove={() => i !== index && setIndex(i)}
                  onClick={(e) => execute(i, e)}
                >
                  {i === index && <motion.span layoutId="palette-hl" className="palette-row__hl" transition={{ type: 'spring', stiffness: 700, damping: 45 }} />}
                  <span className="palette-row__icon">{item.icon}</span>
                  <span className="palette-row__text">
                    <span className="palette-row__title">
                      <Highlight text={item.title} indices={indices} />
                    </span>
                    {item.subtitle && <span className="palette-row__sub mono">{item.subtitle}</span>}
                  </span>
                  {query.trim() && <span className="palette-row__group">{item.group}</span>}
                  {item.hint && <span className="palette-row__hint">{item.hint}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <div className="palette__footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> navigate
        </span>
        <span>
          <kbd>Enter</kbd> run
        </span>
        <span>
          <kbd>Ctrl</kbd>+<kbd>Enter</kbd> folder in new session
        </span>
        <span>
          <kbd>Shift</kbd>+<kbd>Enter</kbd> type snippet
        </span>
        <span>
          <kbd>Alt</kbd>+<kbd>Enter</kbd> copy snippet
        </span>
      </div>
    </motion.div>
  )
}

