import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AppWindow, Check, ChevronLeft, ChevronRight, CircleAlert, CornerDownLeft, FolderOpen, Keyboard, Monitor, Play, Star, Trash2, Zap } from 'lucide-react'
import { LAUNCHER_MOODS } from '@shared/defaults'
import type { Launcher, LauncherMode, LauncherTarget, ShellId, ShellInfo } from '@shared/types'
import { api } from '@/api'
import { set, useActiveSession, useApp } from '@/store/app'
import { focusActive, toast } from '@/lib/actions'
import { deleteLauncher, removeFromDesktop, runLauncher, saveLauncher } from '@/lib/launchers'
import { familyOf } from '@/lib/shell'
import { folderName, samePath, shortPath } from '@/lib/format'
import { Modal } from '../ui/Modal'
import { Segmented, Switch } from '../ui/Controls'
import { LauncherIcon, ShellIcon } from '../icons'
import { MoodPicker } from './MoodPicker'

const STEPS = [
  { title: 'Where', sub: 'Folder & shell' },
  { title: 'What runs', sub: 'Your script' },
  { title: 'Look', sub: 'Name, color & place' }
]

const MODE_HELP: Record<LauncherMode, string> = {
  run: 'Types the script and presses Enter, exactly as if you ran it yourself.',
  insert: 'Types the script into the prompt and waits — review it, then press Enter yourself.'
}

const TARGET_HELP: Record<LauncherTarget, string> = {
  app: 'Opens Pro Terminal (or the window already open) with this shortcut in a new tab.',
  window: 'Opens a standalone console window — no Pro Terminal needed. CMD scripts run as a batch file.'
}

const NO_SHELLS: ShellInfo[] = []

/** What the shell prints before input, for the preview. */
function promptFor(shell: ShellId, folder: string): string {
  const dir = folder || 'C:\\'
  return familyOf(shell) === 'cmd' ? `${dir}>` : `PS ${dir}> `
}

export function LauncherWizard() {
  // Folder actions have their own wizard (ActionWizard).
  const req = useApp((s) => (s.launcherEditor?.draft.kind === 'action' ? null : s.launcherEditor))
  const shells = useApp((s) => s.info?.shells ?? NO_SHELLS)
  const favorites = useApp((s) => s.library.favorites)
  const onDesktopIds = useApp((s) => s.launchersOnDesktop)
  const session = useActiveSession()

  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [folder, setFolder] = useState('')
  const [folderOk, setFolderOk] = useState<boolean | null>(null)
  const [shell, setShell] = useState<ShellId>('powershell')
  const [script, setScript] = useState('')
  const [mode, setMode] = useState<LauncherMode>('run')
  const [name, setName] = useState('')
  const [color, setColor] = useState(LAUNCHER_MOODS[1].color)
  const [pinned, setPinned] = useState(true)
  const [target, setTarget] = useState<LauncherTarget>('app')
  const [desktop, setDesktop] = useState(false)
  const [touched, setTouched] = useState(false)
  const [shake, setShake] = useState(0)
  const [saving, setSaving] = useState(false)
  const pages = useRef<HTMLDivElement>(null)

  const draft = req?.draft
  const editing = !!draft?.id
  const wasOnDesktop = editing && onDesktopIds.includes(draft!.id!)

  useEffect(() => {
    if (!req) return
    const d = req.draft
    setStep(req.step ?? 0)
    setDir(1)
    setFolder(d.folder ?? '')
    setFolderOk(null)
    const avail = useApp.getState().info?.shells.filter((s) => s.available) ?? []
    const want = d.shell ?? 'powershell'
    setShell(avail.some((s) => s.id === want) ? want : (avail.find((s) => s.family === familyOf(want))?.id ?? want))
    setScript(d.script ?? '')
    setMode(d.mode ?? 'run')
    setName(d.name ?? '')
    setColor(d.color ?? LAUNCHER_MOODS[1].color)
    setPinned(d.pinned ?? true)
    setTarget(d.target ?? 'app')
    setDesktop(!!d.id && useApp.getState().launchersOnDesktop.includes(d.id))
    setTouched(false)
    setSaving(false)
  }, [req])

  // Each step puts the cursor in its main field once the slide-in settles.
  useEffect(() => {
    if (!req) return
    const t = window.setTimeout(() => pages.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(), 260)
    return () => window.clearTimeout(t)
  }, [step, req])

  // Check the folder as it is typed (debounced).
  useEffect(() => {
    if (!req) return
    const p = folder.trim()
    if (!p) {
      setFolderOk(null)
      return
    }
    let live = true
    const t = window.setTimeout(() => void api.system.isDirectory(p).then((ok) => live && setFolderOk(ok)), 180)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [folder, req])

  const available = shells.filter((s) => s.available)
  const shellOptions = available.map((s) => ({
    value: s.id,
    label: s.id === 'cmd' ? 'CMD' : s.id === 'pwsh' ? 'PowerShell 7' : available.some((x) => x.id === 'pwsh') ? 'Windows PS' : 'PowerShell',
    icon: <ShellIcon shell={s.id} size={13} colored={false} />
  }))

  const displayName = name.trim() || (folder.trim() ? folderName(folder.trim()) : 'My shortcut')
  const lines = useMemo(() => script.replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n'), [script])
  const hasScript = !!script.trim()
  const effectiveTarget: LauncherTarget = mode === 'insert' ? 'app' : target


  // Opened from the manager, focus stays in the manager instead of going back to the terminal.
  const refocus = () => {
    if (useApp.getState().launcherManager) document.querySelector<HTMLElement>('.launcher-manager-modal')?.focus()
    else focusActive()
  }
  const close = () => {
    set({ launcherEditor: null })
    refocus()
  }

  const folderValid = async (): Promise<boolean> => {
    const p = folder.trim()
    const ok = !!p && (await api.system.isDirectory(p))
    setFolderOk(p ? ok : null)
    if (!ok) {
      setTouched(true)
      setShake((n) => n + 1)
    }
    return ok
  }

  const goTo = async (next: number) => {
    if (next === step) return
    if (next > step && step === 0 && !(await folderValid())) return
    setDir(next > step ? 1 : -1)
    setStep(next)
  }

  const save = async () => {
    if (saving) return
    if (!(await folderValid())) {
      setDir(-1)
      setStep(0)
      return
    }
    setSaving(true)
    if (wasOnDesktop && !desktop) await removeFromDesktop(draft as Launcher)
    const saved = await saveLauncher(
      {
        id: draft?.id,
        name: displayName,
        color,
        folder: folder.trim(),
        shell,
        script: script.replace(/\s+$/, ''),
        mode,
        target: effectiveTarget,
        pinned
      },
      { addToDesktop: desktop && !wasOnDesktop }
    )
    setSaving(false)
    if (!saved) return
    set({ launcherEditor: null })
    toast('success', editing ? 'Shortcut updated' : 'Shortcut created', {
      message: `${saved.name}${pinned ? ' · in the top bar' : ''}`,
      actions: editing ? undefined : [{ label: 'Open it now', primary: true, run: () => void runLauncher(saved) }]
    })
    refocus()
  }

  const last = step === STEPS.length - 1

  return (
    <Modal
      open={!!req}
      onClose={close}
      width={800}
      icon={<Zap size={18} />}
      title={editing ? 'Edit shortcut' : 'New shortcut'}
      subtitle="Open a shell in a folder and run your script — from the top bar or your desktop"
      className="launcher-wizard-modal"
      footer={
        <>
          {editing && (
            <button
              className="btn btn--danger btn--sm"
              onClick={() => {
                void deleteLauncher(draft as Launcher)
                close()
              }}
            >
              <Trash2 size={13} />
              Delete
            </button>
          )}
          <span style={{ flex: 1 }} />
          {step > 0 ? (
            <button className="btn btn--ghost" onClick={() => void goTo(step - 1)}>
              <ChevronLeft size={14} />
              Back
            </button>
          ) : (
            <button className="btn btn--ghost" onClick={close}>
              Cancel
            </button>
          )}
          {!last && (
            <button className={`btn ${editing ? '' : 'btn--primary'}`} onClick={() => void goTo(step + 1)}>
              Next
              <ChevronRight size={14} />
            </button>
          )}
          {(last || editing) && (
            <button className="btn btn--primary" onClick={() => void save()} disabled={saving}>
              {editing ? <Check size={14} /> : <Zap size={14} />}
              {editing ? 'Save changes' : 'Create shortcut'}
            </button>
          )}
        </>
      }
    >
      <div className="lw" style={{ ['--lc' as string]: color }}>
        {/* ---------------------------------------------------------------- live preview */}
        <aside className="lw-preview">
          <div className="lw-preview__label">Desktop</div>
          <div className="lw-desk">
            <motion.div
              key={color}
              className="lw-desk__icon"
              initial={{ scale: 0.82, rotate: -6 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 16 }}
            >
              <LauncherIcon color={color} size={64} />
              <span className="lw-desk__arrow" aria-hidden>
                <svg viewBox="0 0 12 12" width="12" height="12">
                  <rect x="0.5" y="0.5" width="11" height="11" rx="2" fill="#fff" stroke="#0003" />
                  <path d="M4 8.5 8 4.5M5 4.5h3v3" fill="none" stroke="#1f6fe5" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </span>
            </motion.div>
            <span className="lw-desk__name">{displayName}</span>
          </div>

          <div className="lw-preview__label">Top bar</div>
          <div className="lw-bar">
            <span className="lw-bar__zap">
              <Zap size={12} />
            </span>
            <span className={`lw-bar__chip ${pinned ? '' : 'lw-bar__chip--off'}`}>
              <LauncherIcon color={color} size={18} />
            </span>
            <span className="lw-bar__tab" />
            <span className="lw-bar__tab lw-bar__tab--dim" />
          </div>
          <div className="lw-preview__hint">{pinned ? 'One click opens it in a new tab.' : 'Hidden from the top bar — still in the ⚡ menu.'}</div>

          <div className="lw-summary">
            <div className="lw-summary__row">
              <FolderOpen size={13} />
              <span className="mono">{folder.trim() ? shortPath(folder.trim(), 26) : '—'}</span>
            </div>
            <div className="lw-summary__row">
              <ShellIcon shell={shell} size={13} />
              <span>{shellOptions.find((o) => o.value === shell)?.label ?? shell}</span>
            </div>
            <div className="lw-summary__row">
              {mode === 'run' ? <Play size={13} /> : <Keyboard size={13} />}
              <span>{hasScript ? (mode === 'run' ? `Runs ${lines.length > 1 ? `${lines.length} lines` : 'a command'}` : 'Types, you press Enter') : 'Just opens the folder'}</span>
            </div>
          </div>
        </aside>

        {/* ---------------------------------------------------------------- steps */}
        <section className="lw-main">
          <div className="lw-steps" role="tablist">
            {STEPS.map((s, i) => (
              <button key={s.title} role="tab" aria-selected={i === step} className={`lw-step ${i === step ? 'lw-step--on' : ''} ${i < step ? 'lw-step--done' : ''}`} onClick={() => void goTo(i)}>
                <span className="lw-step__dot">{i < step ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
                <span className="lw-step__text">
                  <span className="lw-step__title">{s.title}</span>
                  <span className="lw-step__sub">{s.sub}</span>
                </span>
                {i === step && <motion.span layoutId="lw-step-hl" className="lw-step__hl" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
              </button>
            ))}
            <div className="lw-steps__track">
              <motion.div className="lw-steps__fill" animate={{ width: `${(step / (STEPS.length - 1)) * 100}%` }} transition={{ type: 'spring', stiffness: 260, damping: 30 }} />
            </div>
          </div>

          <div className="lw-pages" ref={pages}>
            <AnimatePresence mode="wait" initial={false} custom={dir}>
              <motion.form
                key={step}
                className="form-grid lw-page"
                custom={dir}
                initial={{ opacity: 0, x: 24 * dir }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 * dir, transition: { duration: 0.12 } }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                onSubmit={(e) => {
                  e.preventDefault()
                  void (last ? save() : goTo(step + 1))
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey) {
                    e.preventDefault()
                    void save()
                  }
                }}
              >
                {step === 0 && (
                  <>
                    <label className="field">
                      <span className="field__label">
                        Folder
                        <span className="field__hint">The shell starts here</span>
                      </span>
                      <motion.div className="input-row" key={shake} animate={shake ? { x: [0, -7, 7, -4, 4, 0] } : undefined} transition={{ duration: 0.35 }}>
                        <div className="lw-folder">
                          <input
                            className={`input mono ${touched && folderOk === false ? 'input--error' : ''}`}
                            value={folder}
                            onChange={(e) => setFolder(e.target.value)}
                            placeholder="C:\Projects\my-app"
                            spellCheck={false}
                            data-autofocus
                          />
                          <AnimatePresence>
                            {folderOk !== null && (
                              <motion.span
                                key={String(folderOk)}
                                className={`lw-folder__state ${folderOk ? 'lw-folder__state--ok' : 'lw-folder__state--bad'}`}
                                initial={{ scale: 0.4, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.4, opacity: 0 }}
                                data-tip={folderOk ? 'Folder found' : 'Folder not found'}
                              >
                                {folderOk ? <Check size={12} strokeWidth={3} /> : <CircleAlert size={13} />}
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </div>
                        <button
                          type="button"
                          className="btn"
                          onClick={async () => {
                            const p = await api.system.pickFolder(folder.trim() || undefined)
                            if (p) setFolder(p)
                          }}
                        >
                          <FolderOpen size={14} />
                          Browse…
                        </button>
                      </motion.div>
                      {touched && folderOk === false && <span className="field__hint lw-error">That folder doesn’t exist. Pick one with Browse… or fix the path.</span>}
                    </label>

                    {(session || favorites.length > 0) && (
                      <div className="field">
                        <span className="field__label">Quick pick</span>
                        <div className="lw-picks">
                          {session && (
                            <button type="button" className={`lw-pick ${samePath(session.cwd, folder) ? 'lw-pick--on' : ''}`} onClick={() => setFolder(session.cwd)} data-tip={session.cwd}>
                              <FolderOpen size={12} />
                              Current folder · {folderName(session.cwd)}
                            </button>
                          )}
                          {favorites.slice(0, 6).map((f) => (
                            <button key={f.id} type="button" className={`lw-pick ${samePath(f.path, folder) ? 'lw-pick--on' : ''}`} onClick={() => setFolder(f.path)} data-tip={f.path}>
                              <Star size={11} fill={f.color ?? 'var(--warn)'} style={{ color: f.color ?? 'var(--warn)' }} />
                              {f.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="field">
                      <span className="field__label">Shell</span>
                      <Segmented value={shell} onChange={setShell} stretch options={shellOptions} />
                      <span className="field__hint">{familyOf(shell) === 'cmd' ? 'Command Prompt (cmd.exe).' : shell === 'pwsh' ? 'PowerShell 7 (pwsh.exe).' : 'Windows PowerShell 5.1 (powershell.exe).'}</span>
                    </div>
                  </>
                )}

                {step === 1 && (
                  <>
                    <label className="field">
                      <span className="field__label">
                        Script
                        <span className="field__hint">optional · typed exactly as written · Ctrl+Enter saves</span>
                      </span>
                      <textarea
                        className="textarea mono lw-script"
                        value={script}
                        onChange={(e) => setScript(e.target.value)}
                        placeholder={familyOf(shell) === 'cmd' ? 'npm run dev\n\nrem Several lines? Each one is entered in order.' : 'npm run dev\n\n# Several lines? Each one is entered in order.'}
                        rows={6}
                        spellCheck={false}
                        data-autofocus
                      />
                    </label>

                    <div className="field">
                      <span className="field__label">After opening</span>
                      <Segmented
                        value={mode}
                        onChange={setMode}
                        stretch
                        options={[
                          { value: 'run', label: 'Run it (press Enter)', icon: <Play size={13} /> },
                          { value: 'insert', label: 'Only type it', icon: <Keyboard size={13} /> }
                        ]}
                      />
                      <span className="field__hint">{hasScript ? MODE_HELP[mode] : 'No script: the shortcut just opens the shell in the folder.'}</span>
                    </div>

                    <div className="lw-term" aria-label="Preview">
                      <div className="lw-term__bar">
                        <span className="lw-term__dots">
                          <i />
                          <i />
                          <i />
                        </span>
                        <ShellIcon shell={shell} size={12} />
                        <span>{displayName}</span>
                      </div>
                      <div className="lw-term__body mono">
                        {(hasScript ? lines : ['']).map((line, i, all) => {
                          const lastLine = i === all.length - 1
                          return (
                            <div key={i} className="lw-term__line">
                              <span className="lw-term__prompt">{promptFor(shell, shortPath(folder.trim(), 34))}</span>
                              <span>{line}</span>
                              {lastLine && (mode === 'insert' || !hasScript) && <span className="lw-term__caret" />}
                              {lastLine && mode === 'run' && hasScript && (
                                <span className="lw-term__enter">
                                  <CornerDownLeft size={10} />
                                </span>
                              )}
                            </div>
                          )
                        })}
                        {mode === 'run' && hasScript && (
                          <div className="lw-term__line lw-term__line--dim">
                            <span className="lw-term__prompt">…</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {step === 2 && (
                  <>
                    <label className="field">
                      <span className="field__label">
                        Name
                        <span className="field__hint">shown in the top bar and under the desktop icon</span>
                      </span>
                      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={displayName} maxLength={80} data-autofocus />
                    </label>

                    <MoodPicker color={color} onChange={setColor} />

                    <div className="lw-toggles">
                      <div className="lw-toggle">
                        <span className="lw-toggle__icon">
                          <Zap size={15} />
                        </span>
                        <span className="lw-toggle__text">
                          <span className="lw-toggle__title">Show in the top bar</span>
                          <span className="lw-toggle__sub">Pinned next to the panel buttons for one-click access.</span>
                        </span>
                        <Switch checked={pinned} onChange={setPinned} label="Show in the top bar" />
                      </div>
                      <div className="lw-toggle">
                        <span className="lw-toggle__icon">
                          <Monitor size={15} />
                        </span>
                        <span className="lw-toggle__text">
                          <span className="lw-toggle__title">{wasOnDesktop ? 'On your desktop' : 'Add to desktop'}</span>
                          <span className="lw-toggle__sub">A Windows shortcut with this icon and name.</span>
                        </span>
                        <Switch checked={desktop} onChange={setDesktop} label="Add to desktop" />
                      </div>
                      <AnimatePresence initial={false}>
                        {desktop && (
                          <motion.div
                            className="lw-toggle lw-toggle--sub"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                          >
                            <div className="field" style={{ flex: 1 }}>
                              <span className="field__label">Desktop shortcut opens in</span>
                              {mode === 'insert' && hasScript ? (
                                <span className="field__hint">A Pro Terminal tab — only typing a script (without running it) needs Pro Terminal.</span>
                              ) : (
                                <>
                                  <Segmented
                                    value={target}
                                    onChange={setTarget}
                                    stretch
                                    size="sm"
                                    options={[
                                      { value: 'app', label: 'Pro Terminal tab', icon: <Zap size={12} /> },
                                      { value: 'window', label: 'Classic window', icon: <AppWindow size={12} /> }
                                    ]}
                                  />
                                  <span className="field__hint">{TARGET_HELP[target]}</span>
                                </>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </>
                )}
                <button type="submit" hidden />
              </motion.form>
            </AnimatePresence>
          </div>
        </section>
      </div>
    </Modal>
  )
}
