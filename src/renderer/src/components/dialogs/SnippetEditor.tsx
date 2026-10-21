import { useEffect, useMemo, useState } from 'react'
import { Braces, Code2, Copy, Keyboard, Play, Trash2 } from 'lucide-react'
import type { Snippet, SnippetMode, SnippetShell } from '@shared/types'
import { api } from '@/api'
import { set, useApp } from '@/store/app'
import { deleteSnippet, focusActive, toast } from '@/lib/actions'
import { BUILTIN_VARS, snippetVariables } from '@/lib/snippets'
import { Modal } from '../ui/Modal'
import { Segmented } from '../ui/Controls'
import { CmdIcon, PsIcon } from '../icons'

const MODE_HELP: Record<SnippetMode, string> = {
  run: 'Clicking types the command into the active session and presses Enter.',
  insert: 'Clicking types the command into the prompt so you can review or edit it before pressing Enter.',
  copy: 'Clicking copies the command to the clipboard.'
}

export function SnippetEditor() {
  const draft = useApp((s) => s.snippetEditor)
  const snippets = useApp((s) => s.library.snippets)
  const groups = useMemo(() => [...new Set(snippets.map((x) => x.group).filter(Boolean))] as string[], [snippets])
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [description, setDescription] = useState('')
  const [group, setGroup] = useState('')
  const [shell, setShell] = useState<SnippetShell>('any')
  const [mode, setMode] = useState<SnippetMode>('run')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (!draft) return
    setName(draft.name ?? '')
    setCommand(draft.command ?? '')
    setDescription(draft.description ?? '')
    setGroup(draft.group ?? '')
    setShell(draft.shell ?? 'any')
    setMode(draft.mode ?? 'run')
    setTouched(false)
  }, [draft])

  const vars = useMemo(() => snippetVariables(command), [command])
  const close = () => {
    set({ snippetEditor: null })
    focusActive()
  }
  const editing = !!draft?.id
  const nameMissing = touched && !name.trim()
  const cmdMissing = touched && !command.trim()

  const save = async () => {
    setTouched(true)
    if (!name.trim() || !command.trim()) return
    const saved = await api.library.upsertSnippet({
      id: draft?.id,
      name: name.trim(),
      command: command.replace(/\s+$/, ''),
      description: description.trim() || undefined,
      group: group.trim() || undefined,
      shell,
      mode
    })
    toast('success', editing ? 'Snippet updated' : 'Snippet saved', { message: saved.name })
    close()
  }

  const multiline = command.trim().includes('\n')

  return (
    <Modal
      open={!!draft}
      onClose={close}
      width={600}
      icon={<Code2 size={18} />}
      title={editing ? 'Edit snippet' : 'New snippet'}
      subtitle="Save a command or script and run it with one click"
      footer={
        <>
          {editing && (
            <button
              className="btn btn--danger btn--sm"
              onClick={() => {
                void deleteSnippet(draft as Snippet)
                close()
              }}
            >
              <Trash2 size={13} />
              Delete
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn btn--ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={() => void save()}>
            {editing ? 'Save changes' : 'Save snippet'}
          </button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault()
            void save()
          }
        }}
      >
        <div className="form-row">
          <label className="field" style={{ flex: 2 }}>
            <span className="field__label">Name</span>
            <input className={`input ${nameMissing ? 'input--error' : ''}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Start dev server" data-autofocus={!draft?.command ? true : undefined} maxLength={120} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span className="field__label">Group</span>
            <input className="input" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="General" list="snippet-groups" maxLength={60} />
            <datalist id="snippet-groups">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </label>
        </div>

        <label className="field">
          <span className="field__label">
            Command
            <span className="field__hint">
              <Braces size={11} /> {'{{name}}'} or {'{{name:default}}'} asks for a value · built-ins: {BUILTIN_VARS.map((b) => `{{${b}}}`).join(' ')}
            </span>
          </span>
          <textarea
            className={`textarea mono ${cmdMissing ? 'input--error' : ''}`}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={'npm run dev\n\n# or a multi-line script — each line is entered in order'}
            rows={5}
            spellCheck={false}
            data-autofocus={draft?.command ? true : undefined}
          />
          {(vars.length > 0 || multiline) && (
            <div className="var-preview">
              {vars.map((v) => (
                <span key={v.name} className="var-chip">
                  {v.name}
                  {v.defaultValue && <span className="var-chip__def">= {v.defaultValue}</span>}
                </span>
              ))}
              {multiline && <span className="field__hint">Multi-line: lines are entered one after another.</span>}
            </div>
          )}
        </label>

        <label className="field">
          <span className="field__label">Description <span className="field__hint">optional</span></span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does it do?" maxLength={500} />
        </label>

        <div className="form-row form-row--top">
          <div className="field" style={{ flex: 1 }}>
            <span className="field__label">When clicked</span>
            <Segmented
              value={mode}
              onChange={setMode}
              stretch
              options={[
                { value: 'run', label: 'Run', icon: <Play size={13} /> },
                { value: 'insert', label: 'Type', icon: <Keyboard size={13} /> },
                { value: 'copy', label: 'Copy', icon: <Copy size={13} /> }
              ]}
            />
            <span className="field__hint">{MODE_HELP[mode]}</span>
          </div>
          <div className="field" style={{ width: 230 }}>
            <span className="field__label">Shell</span>
            <Segmented
              value={shell}
              onChange={setShell}
              stretch
              options={[
                { value: 'any', label: 'Any' },
                { value: 'cmd', label: 'CMD', icon: <CmdIcon size={13} /> },
                { value: 'powershell', label: 'PS', icon: <PsIcon size={13} /> }
              ]}
            />
            <span className="field__hint">{shell === 'any' ? 'Works in both shells.' : 'You’ll be warned in the other shell.'}</span>
          </div>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
