import { useRef } from 'react'
import { motion } from 'motion/react'
import { CircleAlert, ExternalLink, FileCode2, Folder, FolderTree, Info, Library, Play, TriangleAlert } from 'lucide-react'
import { api } from '@/api'
import { useApp } from '@/store/app'
import { confirmAction, dismissAction } from '@/lib/launchers'
import { SHELL_META } from '@/lib/shell'
import { Modal } from '../ui/Modal'
import { LauncherIcon, ShellIcon } from '../icons'

/** A drive's top folder, like C:\ — running "in every subfolder" there touches the whole drive. */
const isDriveRoot = (p: string): boolean => /^[a-z]:\\?$/i.test(p.trim())

/**
 * Shown before any folder action runs — from a file opened in Explorer, or from the app. Nothing runs
 * until the user confirms here; Cancel is the default button.
 */
export function ActionConfirm() {
  const queue = useApp((s) => s.actionQueue)
  // Keep showing the last request while the dialog animates out.
  const lastReq = useRef(queue[0])
  if (queue[0]) lastReq.current = queue[0]
  const open = queue.length > 0
  const req = queue[0] ?? lastReq.current
  const a = req?.action
  const lines = a ? a.script.replace(/\r\n?/g, '\n').split('\n') : []
  const wide = !!req && a!.recursive && isDriveRoot(req.folder)

  return (
    <Modal
      open={open}
      onClose={dismissAction}
      width={600}
      icon={a ? <LauncherIcon color={a.color} size={22} /> : undefined}
      title={a ? `Run “${a.name}”?` : ''}
      subtitle={queue.length > 1 ? `Folder action · 1 of ${queue.length} waiting` : 'Folder action · check it before it runs'}
      className="action-confirm-modal"
      footer={
        <>
          <span className="ac-foot-hint">Nothing runs until you click Run.</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn--ghost" onClick={dismissAction} data-autofocus>
            Cancel
          </button>
          <button className={`btn btn--primary ${wide ? 'btn--danger' : ''}`} onClick={() => void confirmAction()}>
            <Play size={13} />
            {a?.recursive ? 'Run in every folder' : 'Run here'}
          </button>
        </>
      }
    >
      {req && a && (
        <motion.div key={`${req.file ?? ''}|${req.folder}|${a.id}`} className="ac" style={{ ['--lc' as string]: a.color }} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          {a.description && <p className="ac-desc">{a.description}</p>}

          <div className="ac-facts">
            <div className="ac-fact">
              <span className="ac-fact__label">
                <Folder size={13} />
                Folder
              </span>
              <span className="ac-fact__value mono" data-tip={req.folder}>
                {req.folder}
              </span>
              <button className="icon-btn icon-btn--sm" onClick={() => void api.system.openPath(req.folder)} data-tip="Open in Explorer" aria-label="Open in Explorer">
                <ExternalLink size={12} />
              </button>
            </div>
            <div className="ac-fact">
              <span className="ac-fact__label">
                <FolderTree size={13} />
                Applies to
              </span>
              <span className="ac-fact__value">
                {a.recursive ? 'This folder and every subfolder — deepest first, hidden and system folders skipped' : 'Only this folder'}
              </span>
            </div>
            <div className="ac-fact">
              <span className="ac-fact__label">
                <ShellIcon shell={a.shell} size={13} />
                Shell
              </span>
              <span className="ac-fact__value">{SHELL_META[a.shell].name}</span>
            </div>
            <div className="ac-fact">
              <span className="ac-fact__label">
                {req.file ? <FileCode2 size={13} /> : <Library size={13} />}
                From
              </span>
              <span className={`ac-fact__value ${req.file ? 'mono' : ''}`} data-tip={req.file}>
                {req.file ?? 'Your folder actions in Pro Terminal'}
              </span>
            </div>
          </div>

          {wide && (
            <div className="ac-callout ac-callout--danger">
              <TriangleAlert size={15} />
              <span>
                <b>This is the top of drive {req.folder.slice(0, 2).toUpperCase()}</b> — the script will run in every folder on it.
              </span>
            </div>
          )}
          {req.foreign && (
            <div className="ac-callout ac-callout--warn">
              <CircleAlert size={15} />
              <span>
                <b>This file wasn't made from one of your folder actions</b> (it may come from another PC, or was deleted here). Only run it if you trust where it came from.
              </span>
            </div>
          )}
          {req.outdated && (
            <div className="ac-callout">
              <Info size={15} />
              <span>
                <b>This file has an older version of “{a.name}”.</b> It runs the script below — the one saved in the file. Save the file again from Pro Terminal to update it.
              </span>
            </div>
          )}

          <div className="ac-script">
            <div className="ac-script__bar">
              <ShellIcon shell={a.shell} size={12} />
              <span>Script</span>
              <span className="ac-script__count">
                {lines.length} line{lines.length === 1 ? '' : 's'}
              </span>
            </div>
            <pre className="ac-script__body mono">
              {lines.map((l, i) => (
                <span key={i} className="ac-script__line">
                  <span className="ac-script__no">{i + 1}</span>
                  <span>{l || ' '}</span>
                </span>
              ))}
            </pre>
          </div>
        </motion.div>
      )}
    </Modal>
  )
}
