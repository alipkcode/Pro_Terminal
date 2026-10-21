import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Power, RotateCcw, X } from 'lucide-react'
import type { SessionInfo } from '@shared/types'
import { api } from '@/api'
import { closeSession, restartSession, typePath } from '@/lib/actions'
import { ensureController } from '@/terminal/registry'

export function TerminalPane({ session, visible }: { session: SessionInfo; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    const ctrl = ensureController(session.id)
    if (host.current) ctrl.mount(host.current)
  }, [session.id])

  useEffect(() => {
    const ctrl = ensureController(session.id)
    ctrl.setVisible(visible)
    if (visible) requestAnimationFrame(() => ctrl.focus())
  }, [visible, session.id])

  const exited = session.status === 'exited'

  return (
    <div
      className={`term-pane ${visible ? 'term-pane--visible' : ''} ${exited ? 'term-pane--exited' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => api.system.pathForFile(f))
          .filter(Boolean)
        if (paths.length) typePath(paths.join(' '))
      }}
    >
      <div className="term-pane__host" ref={host} />

      <AnimatePresence>
        {dragOver && (
          <motion.div className="term-drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            Drop to type the path
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {exited && visible && (
          <motion.div
            className="exit-banner"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <span className={`exit-banner__icon ${session.exitCode ? 'exit-banner__icon--err' : ''}`}>
              <Power size={15} />
            </span>
            <div className="exit-banner__text">
              <b>The shell has exited</b>
              <span>Exit code {session.exitCode ?? 0}. The output stays here until you close the session.</span>
            </div>
            <button className="btn btn--sm btn--primary" onClick={() => void restartSession(session.id)} data-autofocus>
              <RotateCcw size={13} />
              Restart
            </button>
            <button className="btn btn--sm" onClick={() => void closeSession(session.id)}>
              <X size={13} />
              Close
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
