import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FolderOpen, Sparkles } from 'lucide-react'
import type { ShellFamily } from '@shared/types'
import { useActiveSession, useApp } from '@/store/app'
import { newSession, resolveFamily, switchActiveShell } from '@/lib/actions'
import { familyOf, FAMILY_LABEL } from '@/lib/shell'
import { folderName } from '@/lib/format'
import { CmdIcon, PsIcon } from './icons'

/**
 * CMD ⇄ PowerShell switch. On a blank session it swaps the shell in place;
 * once commands have run it offers to open the other shell in the same folder instead.
 */
export function ShellToggle() {
  const session = useActiveSession()
  const defaultShell = useApp((s) => s.settings.defaultShell)
  const current: ShellFamily = session ? familyOf(session.shell) : defaultShell
  const [blocked, setBlocked] = useState<ShellFamily | null>(null)
  const [pulse, setPulse] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => setBlocked(null), [session?.id])

  useEffect(() => {
    if (!blocked) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setBlocked(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setBlocked(null)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [blocked])

  const choose = async (family: ShellFamily) => {
    if (family === current && session) return
    const res = await switchActiveShell(family)
    if (res === 'blocked') setBlocked(family)
    else if (res === 'switched') setPulse((p) => p + 1)
  }

  const blank = !session || (session.pristine && session.status !== 'busy' && session.status !== 'exited')
  const tip = (family: ShellFamily) =>
    !session
      ? `Default shell: ${FAMILY_LABEL[family]}`
      : family === current
        ? `This session runs ${FAMILY_LABEL[family]}`
        : blank
          ? `Switch this blank session to ${FAMILY_LABEL[family]}`
          : `Open ${FAMILY_LABEL[family]} in this folder`

  return (
    <div className="shell-toggle-wrap no-drag" ref={ref}>
      <div className={`shell-toggle shell-toggle--${current} ${blank ? 'shell-toggle--blank' : ''}`} role="radiogroup" aria-label="Shell">
        {(['cmd', 'powershell'] as ShellFamily[]).map((family) => {
          const on = family === current
          return (
            <button
              key={family}
              role="radio"
              aria-checked={on}
              className={`shell-toggle__opt ${on ? 'shell-toggle__opt--on' : ''}`}
              onClick={() => void choose(family)}
              data-tip={tip(family)}
              data-tip-placement="bottom"
            >
              {on && (
                <motion.span
                  layoutId="shell-toggle-thumb"
                  className={`shell-toggle__thumb shell-toggle__thumb--${family}`}
                  transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                />
              )}
              <span className="shell-toggle__label">
                {family === 'cmd' ? <CmdIcon size={14} /> : <PsIcon size={14} />}
                {family === 'cmd' ? 'CMD' : 'PS'}
              </span>
            </button>
          )
        })}
        <AnimatePresence>
          {pulse > 0 && (
            <motion.span
              key={pulse}
              className="shell-toggle__pulse"
              initial={{ opacity: 0.7, scale: 1 }}
              animate={{ opacity: 0, scale: 1.25 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {blocked && session && (
          <motion.div
            className="popover shell-popover"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 460, damping: 32 }}
          >
            <div className="shell-popover__head">
              <Sparkles size={15} />
              <span>This session is already in use</span>
            </div>
            <p className="shell-popover__text">
              Switching shells only works in a blank session, so your work here stays safe. Open{' '}
              <b>{FAMILY_LABEL[blocked]}</b> as a new session in the same folder instead?
            </p>
            <div className="shell-popover__folder">
              <FolderOpen size={13} />
              <span className="mono">{folderName(session.cwd) || session.cwd}</span>
            </div>
            <div className="shell-popover__actions">
              <button className="btn btn--sm btn--ghost" onClick={() => setBlocked(null)}>
                Cancel
              </button>
              <button
                className="btn btn--sm btn--primary"
                data-autofocus
                onClick={() => {
                  const fam = blocked
                  setBlocked(null)
                  void newSession({ shell: resolveFamily(fam), exact: true, cwd: session.cwd })
                }}
              >
                Open new {FAMILY_LABEL[blocked]} session
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
