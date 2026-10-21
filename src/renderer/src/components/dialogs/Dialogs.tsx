import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Braces, Folder, LogOut, Play } from 'lucide-react'
import { ACCENT_SWATCHES } from '@shared/defaults'
import { api } from '@/api'
import { set, useApp } from '@/store/app'
import { focusActive, quitApp, toast } from '@/lib/actions'
import { expandSnippet } from '@/lib/snippets'
import { Modal } from '../ui/Modal'
import { Swatches } from '../ui/Controls'

export function ConfirmDialog() {
  const req = useApp((s) => s.confirm)
  const close = (ok: boolean) => {
    req?.resolve(ok)
    if (!ok) focusActive()
  }
  return (
    <Modal
      open={!!req}
      onClose={() => close(false)}
      width={440}
      icon={req?.danger ? <AlertTriangle size={18} /> : undefined}
      title={req?.title}
      className={req?.danger ? 'modal--danger' : ''}
      footer={
        <>
          <button className="btn btn--ghost" onClick={() => close(false)}>
            {req?.cancelLabel ?? 'Cancel'}
          </button>
          <button className={`btn ${req?.danger ? 'btn--danger-solid' : 'btn--primary'}`} onClick={() => close(true)} data-autofocus>
            {req?.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      {typeof req?.message === 'string' ? (
        req.message.includes('\n') ? (
          <pre className="confirm-preview mono">{req.message}</pre>
        ) : (
          <p className="confirm-text">{req.message}</p>
        )
      ) : (
        req?.message
      )}
    </Modal>
  )
}

export function VarsDialog() {
  const req = useApp((s) => s.varsPrompt)
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    if (req) setValues(req.initial)
  }, [req])
  const preview = useMemo(() => (req ? expandSnippet(req.snippet.command, values, { cwd: '…', clipboard: '…', selection: '…' }) : ''), [req, values])
  if (!req) return <Modal open={false} onClose={() => {}} children={null} />
  const submit = () => req.resolve(values)
  const label = req.snippet.mode === 'run' ? 'Run' : req.snippet.mode === 'insert' ? 'Type it' : 'Copy'
  return (
    <Modal
      open
      onClose={() => req.resolve(null)}
      width={500}
      icon={<Braces size={18} />}
      title={req.snippet.name}
      subtitle="Fill in the values for this command"
      footer={
        <>
          <button className="btn btn--ghost" onClick={() => req.resolve(null)}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={submit}>
            <Play size={13} />
            {label}
          </button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {req.vars.map((v, i) => (
          <label key={v.name} className="field">
            <span className="field__label">{v.name}</span>
            <input
              className="input mono"
              value={values[v.name] ?? ''}
              placeholder={v.defaultValue || v.name}
              onChange={(e) => setValues((cur) => ({ ...cur, [v.name]: e.target.value }))}
              data-autofocus={i === 0 ? true : undefined}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
        ))}
        <div className="field">
          <span className="field__label">Preview</span>
          <pre className="confirm-preview mono">{preview}</pre>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

export function FavoriteEditor() {
  const fav = useApp((s) => s.favoriteEditor)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [color, setColor] = useState<string | undefined>()
  useEffect(() => {
    if (!fav) return
    setName(fav.name)
    setPath(fav.path)
    setColor(fav.color)
  }, [fav])
  const close = () => set({ favoriteEditor: null })
  const save = async () => {
    if (!fav) return
    if (path !== fav.path && !(await api.system.isDirectory(path))) {
      toast('error', 'Folder not found', { message: path })
      return
    }
    await api.library.updateFavorite(fav.id, { name, path, color: color ?? '' })
    close()
  }
  return (
    <Modal
      open={!!fav}
      onClose={close}
      width={480}
      icon={<Folder size={18} />}
      title="Edit favorite"
      footer={
        <>
          <button className="btn btn--ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={() => void save()}>
            Save
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
      >
        <label className="field">
          <span className="field__label">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} data-autofocus maxLength={120} />
        </label>
        <label className="field">
          <span className="field__label">Folder</span>
          <div className="input-row">
            <input className="input mono" value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} />
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const p = await api.system.pickFolder(path)
                if (p) setPath(p)
              }}
            >
              Browse…
            </button>
          </div>
        </label>
        <div className="field">
          <span className="field__label">Color</span>
          <Swatches value={color} onChange={setColor} colors={ACCENT_SWATCHES} />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

export function QuitDialog() {
  const req = useApp((s) => s.quitRequest)
  return (
    <Modal
      open={!!req}
      onClose={() => set({ quitRequest: null })}
      width={460}
      icon={<LogOut size={18} />}
      title="Quit while commands are running?"
      className="modal--danger"
      footer={
        <>
          <button className="btn btn--ghost" onClick={() => set({ quitRequest: null })}>
            Keep working
          </button>
          <button className="btn btn--danger-solid" onClick={() => void quitApp(true)} data-autofocus>
            Quit anyway
          </button>
        </>
      }
    >
      <p className="confirm-text">These commands will be stopped. Every session's output is saved first.</p>
      <div className="quit-list">
        {req?.busy.map((b) => (
          <div key={b.id} className="quit-list__row">
            <span className="status-dot status-dot--busy" />
            <b>{b.title}</b>
            <span className="mono muted">{b.command}</span>
          </div>
        ))}
      </div>
    </Modal>
  )
}
