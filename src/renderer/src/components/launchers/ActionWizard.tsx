import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Baseline,
  CaseLower,
  CaseSensitive,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  ClipboardCopy,
  Download,
  EyeOff,
  File,
  FileArchive,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  FolderTree,
  FolderX,
  GitBranch,
  Layers,
  ListOrdered,
  Minus,
  Monitor,
  Replace,
  ShieldCheck,
  Space,
  Sparkles,
  TextCursorInput,
  Trash2,
  Wand2
} from 'lucide-react'
import { ACTION_PRESET_GROUP, ACTION_PRESETS, type ActionPreset } from '@shared/actionPresets'
import { LAUNCHER_MOODS } from '@shared/defaults'
import type { Launcher, ShellId, ShellInfo } from '@shared/types'
import { set, useApp } from '@/store/app'
import { focusActive, toast } from '@/lib/actions'
import { deleteLauncher, saveActionFile, saveLauncher } from '@/lib/launchers'
import { familyOf } from '@/lib/shell'
import { Modal } from '../ui/Modal'
import { Segmented, Switch } from '../ui/Controls'
import { LauncherIcon, ShellIcon } from '../icons'
import { MoodPicker } from './MoodPicker'

const STEPS = [
  { title: 'What it does', sub: 'Script & shell' },
  { title: 'Where it runs', sub: 'This folder or all' },
  { title: 'Look', sub: 'Name, color & file' }
]

const PRESET_ICONS: Record<string, ReactNode> = {
  'remove-dashes': <Minus size={14} />,
  'remove-dots': <CircleDot size={14} />,
  'dots-to-spaces': <Space size={14} />,
  'underscores-to-spaces': <Baseline size={14} />,
  'tidy-spaces': <Sparkles size={14} />,
  'find-replace': <Replace size={14} />,
  'prefix-suffix': <TextCursorInput size={14} />,
  'title-case': <CaseSensitive size={14} />,
  'lowercase-extensions': <CaseLower size={14} />,
  'sort-by-type': <Layers size={14} />,
  'delete-empty-folders': <FolderX size={14} />,
  'delete-junk': <Trash2 size={14} />,
  'extract-zips': <FileArchive size={14} />,
  'git-pull-all': <Download size={14} />,
  'list-contents': <FileText size={14} />,
  'copy-names': <ClipboardCopy size={14} />,
  'git-status-all': <GitBranch size={14} />
}

const NO_SHELLS: ShellInfo[] = []

/** The folders of the scope picture, and the order they run in (deepest first). */
const TREE = [
  { name: 'This folder', depth: 0, order: 3 },
  { name: 'Season 1', depth: 1, order: 1 },
  { name: 'Season 2', depth: 1, order: 2 }
]

function ScopeOption({ on, recursive, title, sub, onPick }: { on: boolean; recursive: boolean; title: string; sub: string; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} className={`aw-scope ${on ? 'aw-scope--on' : ''}`} onClick={onPick}>
      <span className="aw-scope__head">
        <span className="aw-scope__radio">{on && <motion.span layoutId="aw-scope-dot" className="aw-scope__dot" />}</span>
        <span className="aw-scope__title">{title}</span>
      </span>
      <span className="aw-scope__sub">{sub}</span>
      <span className="aw-tree" aria-hidden>
        {TREE.map((f, i) => {
          const active = recursive || f.depth === 0
          return (
            <span key={f.name} className={`aw-tree__row ${active ? '' : 'aw-tree__row--off'}`} style={{ paddingLeft: 6 + f.depth * 16 }}>
              {f.depth === 0 ? <FolderOpen size={13} /> : <Folder size={13} />}
              <span>{f.name}</span>
              <AnimatePresence>
                {on && active && (
                  <motion.span
                    className="aw-tree__step"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 520, damping: 22, delay: 0.08 + (recursive ? f.order : 1) * 0.09 + i * 0.01 }}
                  >
                    {recursive ? f.order : 1}
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          )
        })}
      </span>
    </button>
  )
}

export function ActionWizard() {
  const req = useApp((s) => (s.launcherEditor?.draft.kind === 'action' ? s.launcherEditor : null))
  const shells = useApp((s) => s.info?.shells ?? NO_SHELLS)
  const allSnippets = useApp((s) => s.library.snippets)
  // Built-in tools (the power timer) have no script to use.
  const snippets = useMemo(() => allSnippets.filter((s) => !s.tool), [allSnippets])

  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [shell, setShell] = useState<ShellId>('powershell')
  const [script, setScript] = useState('')
  const [recursive, setRecursive] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(LAUNCHER_MOODS[3].color)
  const [toDesktop, setToDesktop] = useState(true)
  const [shake, setShake] = useState(0)
  const [saving, setSaving] = useState(false)
  // Name and description follow the picked preset until the user types their own.
  const filled = useRef({ name: '', description: '' })
  const pages = useRef<HTMLDivElement>(null)

  const draft = req?.draft
  const editing = !!draft?.id

  const available = shells.filter((s) => s.available)
  const shellFor = (want: ShellId): ShellId => (available.some((s) => s.id === want) ? want : (available.find((s) => s.family === familyOf(want))?.id ?? want))

  useEffect(() => {
    if (!req) return
    const d = req.draft
    setStep(req.step ?? 0)
    setDir(1)
    setShell(shellFor(d.shell ?? 'powershell'))
    setScript(d.script ?? '')
    setRecursive(!!d.recursive)
    setName(d.name ?? '')
    setDescription(d.description ?? '')
    setColor(d.color ?? LAUNCHER_MOODS[3].color)
    setToDesktop(!d.id)
    setSaving(false)
    filled.current = { name: d.name ?? '', description: d.description ?? '' }
  }, [req])

  useEffect(() => {
    if (!req) return
    const t = window.setTimeout(() => pages.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(), 260)
    return () => window.clearTimeout(t)
  }, [step, req])

  const shellOptions = available.map((s) => ({
    value: s.id,
    label: s.id === 'cmd' ? 'CMD' : s.id === 'pwsh' ? 'PowerShell 7' : available.some((x) => x.id === 'pwsh') ? 'Windows PS' : 'PowerShell',
    icon: <ShellIcon shell={s.id} size={13} colored={false} />
  }))
  const shellLabel = shellOptions.find((o) => o.value === shell)?.label ?? shell
  const isCmd = familyOf(shell) === 'cmd'
  const lines = useMemo(() => script.replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n'), [script])
  const hasScript = !!script.trim()
  const activePreset = ACTION_PRESETS.find((p) => p.script === script)
  const displayName = name.trim() || activePreset?.name || 'Folder action'
  const fileName = `${displayName.replace(/[<>:"/\\|?*]+/g, ' ').trim() || 'Folder action'}.exe`
  const groups = useMemo(() => {
    const map = new Map<string, typeof snippets>()
    for (const s of snippets) {
      const g = s.group || 'General'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(s)
    }
    return [...map.entries()]
  }, [snippets])

  const refocus = () => {
    if (useApp.getState().launcherManager) document.querySelector<HTMLElement>('.launcher-manager-modal')?.focus()
    else focusActive()
  }
  const close = () => {
    set({ launcherEditor: null })
    refocus()
  }

  /** Fill in a script from a preset or snippet; name and description follow unless the user wrote their own. */
  const applyScript = (text: string, family: 'cmd' | 'powershell' | 'any', meta: { name: string; description?: string; recursive?: boolean; color?: string }) => {
    setScript(text)
    if (family === 'cmd') setShell(shellFor('cmd'))
    else if (family === 'powershell' && isCmd) setShell(shellFor('powershell'))
    if (meta.recursive !== undefined) setRecursive(meta.recursive)
    if (!name.trim() || name === filled.current.name) {
      setName(meta.name)
      filled.current.name = meta.name
    }
    if (!description.trim() || description === filled.current.description) {
      setDescription(meta.description ?? '')
      filled.current.description = meta.description ?? ''
    }
    if (meta.color && !editing) setColor(meta.color)
  }
  const pickPreset = (p: ActionPreset) => applyScript(p.script, p.shell, p)

  const scriptOk = (): boolean => {
    if (hasScript) return true
    setShake((n) => n + 1)
    return false
  }

  const goTo = (next: number) => {
    if (next === step) return
    if (next > 0 && !scriptOk()) {
      if (step !== 0) {
        setDir(-1)
        setStep(0)
      }
      return
    }
    setDir(next > step ? 1 : -1)
    setStep(next)
  }

  const save = async () => {
    if (saving) return
    if (!scriptOk()) {
      setDir(-1)
      setStep(0)
      return
    }
    setSaving(true)
    const saved = await saveLauncher({
      id: draft?.id,
      kind: 'action',
      name: displayName,
      description: description.trim(),
      color,
      shell,
      script: script.replace(/\s+$/, ''),
      recursive
    })
    setSaving(false)
    if (!saved) return
    set({ launcherEditor: null })
    refocus()
    if (toDesktop) {
      await saveActionFile(saved, 'desktop')
      return
    }
    toast('success', editing ? 'Folder action updated' : 'Folder action created', {
      message: editing ? `${saved.name} · files you saved before keep the old version` : saved.name,
      actions: [{ label: 'Save file to desktop', primary: true, run: () => void saveActionFile(saved, 'desktop') }]
    })
  }

  const last = step === STEPS.length - 1

  return (
    <Modal
      open={!!req}
      onClose={close}
      width={820}
      icon={<Wand2 size={18} />}
      title={editing ? 'Edit folder action' : 'New folder action'}
      subtitle="A script saved as a little program — open it in any folder and it runs right there"
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
            <button className="btn btn--ghost" onClick={() => goTo(step - 1)}>
              <ChevronLeft size={14} />
              Back
            </button>
          ) : (
            <button className="btn btn--ghost" onClick={close}>
              Cancel
            </button>
          )}
          {!last && (
            <button className={`btn ${editing ? '' : 'btn--primary'}`} onClick={() => goTo(step + 1)}>
              Next
              <ChevronRight size={14} />
            </button>
          )}
          {(last || editing) && (
            <button className="btn btn--primary" onClick={() => void save()} disabled={saving}>
              {editing ? <Check size={14} /> : <Wand2 size={14} />}
              {editing ? 'Save changes' : toDesktop ? 'Create & save file' : 'Create folder action'}
            </button>
          )}
        </>
      }
    >
      <div className="lw" style={{ ['--lc' as string]: color }}>
        {/* ---------------------------------------------------------------- live preview */}
        <aside className="lw-preview">
          <div className="lw-preview__label">The file</div>
          <div className="aw-explorer">
            <div className="aw-explorer__bar">
              <FolderOpen size={11} />
              <span>Any folder</span>
            </div>
            <div className="aw-explorer__files">
              <span className="aw-file aw-file--ghost">
                <FileVideo size={22} strokeWidth={1.4} />
                <span>Episode-01.mkv</span>
              </span>
              <motion.span
                key={color}
                className="aw-file aw-file--me"
                initial={{ scale: 0.8, rotate: -8 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 16 }}
              >
                <LauncherIcon color={color} size={44} />
                <span>{fileName}</span>
              </motion.span>
              <span className="aw-file aw-file--ghost">
                <FileImage size={22} strokeWidth={1.4} />
                <span>cover.jpg</span>
              </span>
              <span className="aw-file aw-file--ghost">
                <File size={22} strokeWidth={1.4} />
                <span>notes.txt</span>
              </span>
            </div>
          </div>
          <div className="lw-preview__hint">Drop it into any folder and open it. It asks first, then runs right there.</div>

          <div className="lw-preview__label">When opened</div>
          <div className="aw-ask">
            <span className="aw-ask__head">
              <LauncherIcon color={color} size={18} />
              <span>Run “{displayName}”?</span>
            </span>
            <span className="aw-ask__chips">
              <span>{recursive ? 'Every subfolder' : 'This folder'}</span>
              <span>{shellLabel}</span>
            </span>
            <span className="aw-ask__btns">
              <i />
              <i className="aw-ask__run" />
            </span>
          </div>

          <div className="lw-summary">
            <div className="lw-summary__row">
              <ShellIcon shell={shell} size={13} />
              <span>{shellLabel}</span>
            </div>
            <div className="lw-summary__row">
              {recursive ? <FolderTree size={13} /> : <Folder size={13} />}
              <span>{recursive ? 'Folder + all subfolders' : 'Only its own folder'}</span>
            </div>
            <div className="lw-summary__row">
              <ListOrdered size={13} />
              <span>{hasScript ? `${lines.length} line${lines.length === 1 ? '' : 's'} of script` : 'No script yet'}</span>
            </div>
          </div>
        </aside>

        {/* ---------------------------------------------------------------- steps */}
        <section className="lw-main">
          <div className="lw-steps" role="tablist">
            {STEPS.map((s, i) => (
              <button key={s.title} role="tab" aria-selected={i === step} className={`lw-step ${i === step ? 'lw-step--on' : ''} ${i < step ? 'lw-step--done' : ''}`} onClick={() => goTo(i)}>
                <span className="lw-step__dot">{i < step ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
                <span className="lw-step__text">
                  <span className="lw-step__title">{s.title}</span>
                  <span className="lw-step__sub">{s.sub}</span>
                </span>
                {i === step && <motion.span layoutId="aw-step-hl" className="lw-step__hl" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
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
                  if (last) void save()
                  else goTo(step + 1)
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
                    <div className="field">
                      <span className="field__label">
                        Start from a preset
                        <span className="field__hint">also in Snippets › {ACTION_PRESET_GROUP}</span>
                      </span>
                      <div className="aw-presets">
                        {ACTION_PRESETS.map((p, i) => (
                          <motion.button
                            key={p.key}
                            type="button"
                            className={`aw-preset ${activePreset?.key === p.key ? 'aw-preset--on' : ''}`}
                            style={{ ['--pc' as string]: p.color }}
                            onClick={() => pickPreset(p)}
                            data-tip={p.description}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: Math.min(i, 12) * 0.018, duration: 0.2 }}
                          >
                            <span className="aw-preset__icon">{PRESET_ICONS[p.key] ?? <Wand2 size={14} />}</span>
                            <span className="aw-preset__name">{p.name}</span>
                            <span className="aw-preset__shell">{p.shell === 'cmd' ? 'CMD' : 'PS'}</span>
                          </motion.button>
                        ))}
                      </div>
                    </div>

                    <div className="field">
                      <span className="field__label">Shell</span>
                      <Segmented value={shell} onChange={setShell} stretch options={shellOptions} />
                    </div>

                    <div className="field">
                      <span className="field__label">
                        Script
                        <span className="field__hint">runs once in each folder, as if you typed it there</span>
                        {snippets.length > 0 && (
                          <select
                            className="select aw-snippet-pick"
                            value=""
                            onChange={(e) => {
                              const sn = snippets.find((s) => s.id === e.target.value)
                              if (sn) applyScript(sn.command, sn.shell, { name: sn.name, description: sn.description })
                            }}
                          >
                            <option value="">Use a snippet…</option>
                            {groups.map(([g, list]) => (
                              <optgroup key={g} label={g}>
                                {list.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        )}
                      </span>
                      <motion.div key={shake} animate={shake ? { x: [0, -7, 7, -4, 4, 0] } : undefined} transition={{ duration: 0.35 }}>
                        <textarea
                          className={`textarea mono lw-script aw-script ${shake && !hasScript ? 'input--error' : ''}`}
                          value={script}
                          onChange={(e) => setScript(e.target.value)}
                          placeholder={
                            isCmd
                              ? 'ren *.jpeg *.jpg\n\nrem Runs as a batch file: write %%F in for loops.'
                              : "Get-ChildItem -File | Rename-Item -NewName { $_.Name -replace '-', '' }\n\n# Pick a preset above to start from a ready-made script."
                          }
                          rows={7}
                          wrap="off"
                          spellCheck={false}
                          data-autofocus
                        />
                      </motion.div>
                      <span className="field__hint">
                        {isCmd
                          ? 'Runs as a batch file in each folder. %PT_ACTION_FOLDER% is the folder, %PT_ACTION_FILE% the action file itself.'
                          : '$env:PT_ACTION_FOLDER is the folder, $env:PT_ACTION_FILE the action file itself (the presets skip it). Use return to skip a folder.'}
                      </span>
                    </div>
                  </>
                )}

                {step === 1 && (
                  <>
                    <div className="field">
                      <span className="field__label">Apply the script to</span>
                      <div className="aw-scopes" role="radiogroup">
                        <ScopeOption on={!recursive} recursive={false} title="Only this folder" sub="The folder the file is in (or the one you pick)." onPick={() => setRecursive(false)} />
                        <ScopeOption
                          on={recursive}
                          recursive
                          title="This folder and every subfolder"
                          sub="Lists every folder first, then runs in each, one by one."
                          onPick={() => setRecursive(true)}
                        />
                      </div>
                    </div>

                    <div className="aw-notes">
                      <AnimatePresence initial={false}>
                        {recursive && (
                          <motion.div
                            className="aw-note-group"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                          >
                            <div className="aw-note">
                              <ListOrdered size={14} />
                              <span>
                                <b>Deepest folders first.</b> Renaming things inside a folder can never break the path of a folder still waiting in the list.
                              </span>
                            </div>
                            <div className="aw-note">
                              <EyeOff size={14} />
                              <span>
                                <b>Hidden and system folders are skipped</b> (like .git), and so are links to other folders.
                              </span>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <div className="aw-note">
                        <ShieldCheck size={14} />
                        <span>
                          <b>Always asks first.</b> Opening the file shows its name, description, folder and script, and runs nothing until you confirm.
                        </span>
                      </div>
                      <div className="aw-note">
                        <Monitor size={14} />
                        <span>
                          <b>Works on any PC.</b> With Pro Terminal installed it runs in a new tab here; without it, in {isCmd ? 'Command Prompt' : 'PowerShell'} (Windows Terminal on Windows
                          11).
                        </span>
                      </div>
                    </div>
                  </>
                )}

                {step === 2 && (
                  <>
                    <label className="field">
                      <span className="field__label">
                        Name
                        <span className="field__hint">also the file name</span>
                      </span>
                      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={displayName} maxLength={80} data-autofocus />
                    </label>
                    <label className="field">
                      <span className="field__label">
                        Description
                        <span className="field__hint">shown before it runs</span>
                      </span>
                      <textarea
                        className="textarea aw-desc"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="What it does, in a sentence — so you know what you're confirming later."
                        rows={2}
                        maxLength={500}
                      />
                    </label>

                    <MoodPicker color={color} onChange={setColor} />

                    <div className="lw-toggles">
                      <div className="lw-toggle">
                        <span className="lw-toggle__icon">
                          <Monitor size={15} />
                        </span>
                        <span className="lw-toggle__text">
                          <span className="lw-toggle__title">{editing ? 'Save an updated file to the desktop' : 'Save the file to the desktop'}</span>
                          <span className="lw-toggle__sub">
                            {editing ? 'Files you saved before keep the old version until you replace them.' : `${fileName} — then move it into any folder you like.`}
                          </span>
                        </span>
                        <Switch checked={toDesktop} onChange={setToDesktop} label="Save the file to the desktop" />
                      </div>
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
