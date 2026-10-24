import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react'
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Circle,
  Code2,
  Copy,
  GripVertical,
  Info,
  Keyboard,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  TerminalSquare,
  Wrench,
  X,
  XCircle
} from 'lucide-react'
import type { GroupStartState, Settings } from '@shared/types'
import { formatReport, type HealthReport } from '@shared/health'
import { api } from '@/api'
import { set, useApp, type SettingsSection } from '@/store/app'
import { closeOverlay, moveSnippetGroup, reorderSnippetGroups, setSnippetGroupDefaults, setSnippetGroupStart, toast, updateSettings } from '@/lib/actions'
import { groupSnippets } from '@/lib/snippets'
import { GROUP_START_META } from './panels/SnippetsPanel'
import { SHORTCUTS } from '@/lib/keys'
import { bytes } from '@/lib/format'
import { TERMINAL_THEMES } from '@/terminal/themes'
import { Modal } from './ui/Modal'
import { Segmented, Switch } from './ui/Controls'
import { CmdIcon, Logo, PsIcon } from './icons'

type Section = SettingsSection

const SECTIONS: { id: Section; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'General', icon: <SlidersHorizontal size={15} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={15} /> },
  { id: 'terminal', label: 'Terminal', icon: <TerminalSquare size={15} /> },
  { id: 'snippets', label: 'Saved commands', icon: <Code2 size={15} /> },
  { id: 'archive', label: 'Archive & data', icon: <Archive size={15} /> },
  { id: 'shortcuts', label: 'Keyboard', icon: <Keyboard size={15} /> },
  { id: 'about', label: 'About', icon: <Info size={15} /> }
]

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row__text">
        <div className="set-row__label">{label}</div>
        {hint && <div className="set-row__hint">{hint}</div>}
      </div>
      <div className="set-row__control">{children}</div>
    </div>
  )
}

export function SettingsDialog() {
  const open = useApp((s) => s.overlay === 'settings')
  const [section, setSection] = useState<Section>('general')
  const requested = useApp((s) => s.settingsSection)
  useEffect(() => {
    if (!requested) return
    setSection(requested)
    set({ settingsSection: null })
  }, [requested])
  return (
    <Modal open={open} onClose={closeOverlay} width={820} className="settings-modal">
      <div className="settings">
        <nav className="settings__nav">
          <div className="settings__nav-title">Settings</div>
          {SECTIONS.map((s) => (
            <button key={s.id} className={`settings__nav-item ${section === s.id ? 'settings__nav-item--on' : ''}`} onClick={() => setSection(s.id)}>
              {section === s.id && <motion.span layoutId="settings-nav" className="settings__nav-hl" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
              {s.icon}
              <span>{s.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings__content">
          <button className="icon-btn settings__close" onClick={closeOverlay} aria-label="Close settings" data-tip="Close" data-tip-kbd="Esc">
            <X size={16} />
          </button>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={section} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}>
              <SectionBody section={section} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </Modal>
  )
}

function SectionBody({ section }: { section: Section }) {
  const s = useApp((st) => st.settings)
  const info = useApp((st) => st.info)
  const set = (patch: Partial<Settings>) => void updateSettings(patch)
  const hasPwsh = !!info?.shells.find((x) => x.id === 'pwsh' && x.available)

  switch (section) {
    case 'general':
      return (
        <div className="set-section">
          <h3>General</h3>
          <Row label="Default shell" hint="Used for new sessions and the + button. The top-bar switch changes it too.">
            <Segmented
              value={s.defaultShell}
              onChange={(v) => set({ defaultShell: v })}
              options={[
                { value: 'cmd', label: 'CMD', icon: <CmdIcon size={13} /> },
                { value: 'powershell', label: 'PowerShell', icon: <PsIcon size={13} /> }
              ]}
            />
          </Row>
          <Row label="PowerShell edition" hint={hasPwsh ? 'Which PowerShell the switch and shortcuts open.' : 'PowerShell 7 is not installed, so Windows PowerShell is used.'}>
            <Segmented
              value={hasPwsh ? s.powershellEdition : 'powershell'}
              onChange={(v) => set({ powershellEdition: v })}
              options={[
                { value: 'powershell', label: 'Windows PowerShell' },
                { value: 'pwsh', label: 'PowerShell 7', tip: hasPwsh ? undefined : 'Not installed' }
              ]}
            />
          </Row>
          <Row label="Start new sessions in">
            <select className="select" style={{ width: 200 }} value={s.startDirectory} onChange={(e) => set({ startDirectory: e.target.value as Settings['startDirectory'] })}>
              <option value="home">Home folder</option>
              <option value="last">Last used folder</option>
              <option value="custom">A specific folder…</option>
            </select>
          </Row>
          {s.startDirectory === 'custom' && (
            <Row label="Start folder">
              <div className="input-row" style={{ width: 340 }}>
                <input className="input mono" value={s.customStartDirectory} onChange={(e) => set({ customStartDirectory: e.target.value })} placeholder="C:\\Projects" />
                <button
                  className="btn"
                  onClick={async () => {
                    const p = await api.system.pickFolder(s.customStartDirectory)
                    if (p) set({ customStartDirectory: p })
                  }}
                >
                  Browse…
                </button>
              </div>
            </Row>
          )}
          <Row label="Restore sessions on start" hint="Reopen the sessions you had open, in the same folders, with their previous output.">
            <Switch checked={s.restoreSessions} onChange={(v) => set({ restoreSessions: v })} />
          </Row>
          <Row label="When the shell exits" hint="What happens after typing exit (or the process ends).">
            <select className="select" style={{ width: 220 }} value={s.closeOnExit} onChange={(e) => set({ closeOnExit: e.target.value as Settings['closeOnExit'] })}>
              <option value="clean">Close if it exited cleanly</option>
              <option value="always">Always close</option>
              <option value="never">Keep it open</option>
            </select>
          </Row>
          <Row label="Confirm before closing running commands">
            <Switch checked={s.confirmCloseRunning} onChange={(v) => set({ confirmCloseRunning: v })} />
          </Row>
        </div>
      )
    case 'appearance':
      return (
        <div className="set-section">
          <h3>Appearance</h3>
          <Row label="App theme">
            <Segmented
              value={s.appTheme}
              onChange={(v) => set({ appTheme: v })}
              options={[
                { value: 'dark', label: 'Dark', icon: <Moon size={13} /> },
                { value: 'light', label: 'Light', icon: <Sun size={13} /> },
                { value: 'system', label: 'System', icon: <Monitor size={13} /> }
              ]}
            />
          </Row>
          <Row label="Window background" hint="Mica and Acrylic let your desktop tint the window (Windows 11).">
            <Segmented
              value={s.windowMaterial}
              onChange={(v) => set({ windowMaterial: v })}
              options={[
                { value: 'none', label: 'Solid' },
                { value: 'mica', label: 'Mica' },
                { value: 'acrylic', label: 'Acrylic' }
              ]}
            />
          </Row>
          <div className="set-row set-row--block">
            <div className="set-row__label">Terminal colors</div>
            <div className="theme-grid">
              {TERMINAL_THEMES.map((t) => {
                const c = t.colors
                return (
                  <button key={t.id} className={`theme-card ${s.terminalTheme === t.id ? 'theme-card--on' : ''}`} onClick={() => set({ terminalTheme: t.id })}>
                    <div className="theme-card__preview" style={{ background: c.background, color: c.foreground }}>
                      <span style={{ color: c.green }}>PS</span> <span style={{ color: c.blue }}>C:\&gt;</span> <span style={{ color: c.yellow }}>git</span> status
                      <div className="theme-card__swatches">
                        {[c.red, c.green, c.yellow, c.blue, c.magenta, c.cyan].map((col, i) => (
                          <span key={i} style={{ background: col }} />
                        ))}
                      </div>
                    </div>
                    <span className="theme-card__name">{t.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <Row label="Font">
            <select className="select" style={{ width: 240 }} value={s.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
              <option value="'Cascadia Mono', 'Cascadia Code', Consolas, 'Courier New', monospace">Cascadia Mono</option>
              <option value="'Cascadia Code', 'Cascadia Mono', Consolas, monospace">Cascadia Code</option>
              <option value="Consolas, 'Courier New', monospace">Consolas</option>
              <option value="'Lucida Console', Consolas, monospace">Lucida Console</option>
              <option value="'Courier New', monospace">Courier New</option>
              <option value="'JetBrains Mono', 'Cascadia Mono', Consolas, monospace">JetBrains Mono (if installed)</option>
              <option value="'Fira Code', 'Cascadia Mono', Consolas, monospace">Fira Code (if installed)</option>
            </select>
          </Row>
          <Row label="Font size" hint="Ctrl+= / Ctrl+- also zoom.">
            <div className="range">
              <input type="range" min={9} max={24} value={s.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
              <span className="mono">{s.fontSize}px</span>
            </div>
          </Row>
          <Row label="Line height">
            <div className="range">
              <input type="range" min={1} max={1.6} step={0.05} value={s.lineHeight} onChange={(e) => set({ lineHeight: Number(e.target.value) })} />
              <span className="mono">{s.lineHeight.toFixed(2)}</span>
            </div>
          </Row>
          <Row label="Cursor">
            <Segmented
              value={s.cursorStyle}
              onChange={(v) => set({ cursorStyle: v })}
              options={[
                { value: 'bar', label: '│ Bar' },
                { value: 'block', label: '█ Block' },
                { value: 'underline', label: '_ Line' }
              ]}
            />
          </Row>
          <Row label="Blinking cursor">
            <Switch checked={s.cursorBlink} onChange={(v) => set({ cursorBlink: v })} />
          </Row>
        </div>
      )
    case 'terminal':
      return (
        <div className="set-section">
          <h3>Terminal</h3>
          <Row label="Scrollback lines" hint="How much output each session keeps (also what gets archived).">
            <select className="select" style={{ width: 140 }} value={s.scrollback} onChange={(e) => set({ scrollback: Number(e.target.value) })}>
              {[1000, 2500, 5000, 10000, 25000, 50000].map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString()}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Right-click" hint="Classic console behavior copies the selection, or pastes when nothing is selected.">
            <Segmented
              value={s.rightClick}
              onChange={(v) => set({ rightClick: v })}
              options={[
                { value: 'menu', label: 'Menu' },
                { value: 'copyPaste', label: 'Copy / paste' }
              ]}
            />
          </Row>
          <Row label="Copy on select">
            <Switch checked={s.copyOnSelect} onChange={(v) => set({ copyOnSelect: v })} />
          </Row>
          <Row label="Warn before pasting multiple lines" hint="Each line would run as a separate command.">
            <Switch checked={s.pasteWarning} onChange={(v) => set({ pasteWarning: v })} />
          </Row>
          <Row label="Bell">
            <Segmented
              value={s.bell}
              onChange={(v) => set({ bell: v })}
              options={[
                { value: 'none', label: 'Off' },
                { value: 'visual', label: 'Flash' },
                { value: 'sound', label: 'Sound' }
              ]}
            />
          </Row>
          <Row label="GPU acceleration" hint="Faster rendering with WebGL. Turn off if text looks wrong.">
            <Switch checked={s.gpuAcceleration} onChange={(v) => set({ gpuAcceleration: v })} />
          </Row>
          <Row
            label="Shell integration"
            hint="Lets the app see the current folder, running commands and exit codes (powers busy warnings, history and folder tracking). Applies to new sessions."
          >
            <Switch checked={s.shellIntegration} onChange={(v) => set({ shellIntegration: v })} />
          </Row>
          <Row label="Use bundled ConPTY" hint="Newer console host with better rendering. Applies to new sessions.">
            <Switch checked={s.useBundledConpty} onChange={(v) => set({ useBundledConpty: v })} />
          </Row>
        </div>
      )
    case 'snippets':
      return <SnippetSettings />
    case 'archive':
      return <ArchiveSettings />
    case 'shortcuts':
      return (
        <div className="set-section">
          <h3>Keyboard shortcuts</h3>
          <div className="shortcut-list">
            {SHORTCUTS.map((k) => (
              <div key={k.keys} className="shortcut-row">
                <span>{k.label}</span>
                <span className="shortcut-row__keys">
                  {k.keys.split(' / ').map((combo, i) => (
                    <span key={i}>
                      {i > 0 && <span className="muted"> / </span>}
                      <kbd>{combo}</kbd>
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )
    case 'about':
      return (
        <div className="set-section about">
          <Logo size={54} />
          <h3>Pro Terminal</h3>
          <p className="muted">Version {info?.version}</p>
          <p>A workspace for the real CMD and PowerShell: sessions, archive, favorite folders and saved commands.</p>
          <div className="about__shells">
            {info?.shells.map((sh) => (
              <div key={sh.id} className="about__shell">
                <span className={`status-dot ${sh.available ? 'status-dot--idle' : ''}`} />
                <b>{sh.name}</b>
                <span className="mono muted">{sh.available ? sh.path : 'not installed'}</span>
              </div>
            ))}
          </div>
          {info?.health && <HealthCard report={info.health} />}
          <button className="btn btn--sm" onClick={() => void api.system.toggleDevtools()}>
            Developer tools
          </button>
        </div>
      )
  }
}

const CHECK_ICON = { ok: CheckCircle2, fixed: Wrench, warn: AlertTriangle, fail: XCircle, pending: Circle, running: Circle } as const

function HealthCard({ report }: { report: HealthReport }) {
  const issues = report.checks.filter((c) => c.status === 'warn' || c.status === 'fixed').length
  const summary = issues ? `${issues} item${issues === 1 ? '' : 's'} needed attention` : `All ${report.checks.length} checks passed`
  const copy = async (): Promise<void> => {
    await api.system.writeClipboard(formatReport(report))
    toast('success', 'Report copied')
  }
  return (
    <div className="health">
      <div className="health__head">
        <ShieldCheck size={16} className={issues ? 'health__shield health__shield--warn' : 'health__shield'} />
        <div className="health__title">
          <b>Start-up check</b>
          <span>
            {summary} · {(report.durationMs / 1000).toFixed(1)} s · {new Date(report.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
        <button className="btn btn--sm btn--ghost" onClick={() => void copy()}>
          <Copy size={13} /> Copy report
        </button>
      </div>
      <ul className="health__list">
        {report.checks.map((c) => {
          const Icon = CHECK_ICON[c.status]
          return (
            <li key={c.id} className={`health__row health__row--${c.status}`}>
              <Icon size={14} />
              <span className="health__label">{c.label}</span>
              <span className="health__detail" title={c.detail}>
                {c.detail}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const START_STATES: GroupStartState[] = ['expanded', 'collapsed', 'remember']

function SnippetSettings() {
  const def = useApp((st) => st.settings.snippetGroupDefault)
  const own = useApp((st) => st.settings.snippetGroupStates)
  const snippets = useApp((st) => st.library.snippets)
  const order = useApp((st) => st.library.snippetGroupOrder)
  const groups = useMemo(() => groupSnippets(snippets, order), [snippets, order])
  const customized = groups.some(([g]) => own[g])

  return (
    <div className="set-section">
      <h3>Saved commands</h3>
      <Row label="Groups start" hint="For every group without its own choice below, including groups you create later.">
        <Segmented
          value={def}
          onChange={(v) => setSnippetGroupDefaults({ def: v })}
          options={START_STATES.map((st) => ({ value: st, label: GROUP_START_META[st].label, tip: GROUP_START_META[st].tip }))}
        />
      </Row>
      <div className="set-row set-row--block">
        <div className="group-settings__head">
          <div className="set-row__text">
            <div className="set-row__label">Groups</div>
            <div className="set-row__hint">Drag to change their order in the panel, and choose how each one starts.</div>
          </div>
          <AnimatePresence>
            {customized && (
              <motion.button
                className="btn btn--sm btn--ghost"
                onClick={() => setSnippetGroupDefaults({ resetGroups: true })}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ duration: 0.14 }}
              >
                <RotateCcw size={13} /> Reset all to default
              </motion.button>
            )}
          </AnimatePresence>
        </div>
        {groups.length === 0 ? (
          <div className="group-settings__empty">
            <Code2 size={16} />
            <span>No saved commands yet. Groups you add appear here.</span>
          </div>
        ) : (
          <Reorder.Group axis="y" values={groups.map(([g]) => g)} onReorder={reorderSnippetGroups} as="div" className="group-settings">
            {groups.map(([name, list], i) => (
              <GroupSettingsRow key={name} name={name} count={list.length} own={own[name]} def={def} movable={groups.length > 1} first={i === 0} last={i === groups.length - 1} />
            ))}
          </Reorder.Group>
        )}
      </div>
    </div>
  )
}

function GroupSettingsRow({
  name,
  count,
  own,
  def,
  movable,
  first,
  last
}: {
  name: string
  count: number
  own?: GroupStartState
  def: GroupStartState
  movable: boolean
  first: boolean
  last: boolean
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={name}
      as="div"
      className={`group-row ${own ? 'group-row--custom' : ''}`}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.015, boxShadow: 'var(--shadow)', zIndex: 2 }}
    >
      <button
        type="button"
        className="group-row__grip"
        disabled={!movable}
        aria-label={`Move ${name}`}
        data-tip={movable ? 'Drag, or use ↑ ↓' : undefined}
        onPointerDown={(e) => movable && e.button === 0 && controls.start(e)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' && !first) moveSnippetGroup(name, -1)
          else if (e.key === 'ArrowDown' && !last) moveSnippetGroup(name, 1)
          else return
          e.preventDefault()
        }}
      >
        <GripVertical size={14} />
      </button>
      <div className="group-row__text">
        <span className="group-row__name">{name}</span>
        <span className="group-row__count">
          {count} {count === 1 ? 'command' : 'commands'}
        </span>
      </div>
      <Segmented<GroupStartState | 'default'>
        size="sm"
        value={own ?? 'default'}
        onChange={(v) => setSnippetGroupStart(name, v === 'default' ? null : v)}
        options={[
          { value: 'default', label: 'Default', tip: `Follows the default (${GROUP_START_META[def].label.toLowerCase()})` },
          ...START_STATES.map((st) => ({ value: st, label: GROUP_START_META[st].label, tip: GROUP_START_META[st].tip }))
        ]}
      />
    </Reorder.Item>
  )
}

function ArchiveSettings() {
  const s = useApp((st) => st.settings)
  const info = useApp((st) => st.info)
  const [stats, setStats] = useState({ count: 0, bytes: 0 })
  useEffect(() => {
    void api.archive.stats().then(setStats)
  }, [])
  return (
    <div className="set-section">
      <h3>Archive & data</h3>
      <Row label="Archive size">
        <span className="mono">
          {stats.count} sessions · {bytes(stats.bytes)}
        </span>
      </Row>
      <Row label="Automatic clean-up" hint="Delete old sessions on start-up. Sessions you keep or tag are never deleted.">
        <select className="select" style={{ width: 180 }} value={s.archiveRetentionDays} onChange={(e) => void updateSettings({ archiveRetentionDays: Number(e.target.value) })}>
          <option value={0}>Never</option>
          <option value={7}>After 7 days</option>
          <option value={30}>After 30 days</option>
          <option value={90}>After 90 days</option>
          <option value={365}>After a year</option>
        </select>
      </Row>
      <Row label="Favorites, snippets & shortcuts" hint="Back up or move your library to another PC.">
        <div className="btn-row">
          <button className="btn btn--sm" onClick={() => void api.library.exportLibrary().then((ok) => ok && toast('success', 'Library exported'))}>
            Export…
          </button>
          <button
            className="btn btn--sm"
            onClick={() =>
              void api.library.importLibrary().then((r) => {
                if (r) toast('success', 'Library imported', { message: `${r.favorites} folders, ${r.snippets} snippets, ${r.launchers} shortcuts added` })
              })
            }
          >
            Import…
          </button>
        </div>
      </Row>
      <Row label="Data folder" hint={<span className="mono">{info?.dataDir}</span>}>
        <button className="btn btn--sm" onClick={() => void api.system.openDataDir()}>
          Open
        </button>
      </Row>
    </div>
  )
}
