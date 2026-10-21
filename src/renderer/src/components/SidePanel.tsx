import { useCallback, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useApp } from '@/store/app'
import { SessionsPanel } from './panels/SessionsPanel'
import { FoldersPanel } from './panels/FoldersPanel'
import { SnippetsPanel } from './panels/SnippetsPanel'

const MIN = 240
const MAX = 520

function readWidth(): number {
  try {
    const v = Number(localStorage.getItem('pt.panelWidth'))
    return v >= MIN && v <= MAX ? v : 300
  } catch {
    return 300
  }
}

export function SidePanel() {
  const panel = useApp((s) => s.panel)
  const [width, setWidth] = useState(readWidth)
  const dragging = useRef(false)

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      dragging.current = true
      const startX = e.clientX
      const startW = width
      const move = (ev: PointerEvent) => setWidth(Math.max(MIN, Math.min(MAX, startW + ev.clientX - startX)))
      const up = (ev: PointerEvent) => {
        dragging.current = false
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        const final = Math.max(MIN, Math.min(MAX, startW + ev.clientX - startX))
        try {
          localStorage.setItem('pt.panelWidth', String(final))
        } catch {
          /* ignore */
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [width]
  )

  return (
    <AnimatePresence initial={false}>
      {panel && (
        <motion.aside
          key="side-panel"
          className="side-panel"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={dragging.current ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 40 }}
        >
          <div className="side-panel__inner" style={{ width }}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={panel}
                className="side-panel__content"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              >
                {panel === 'sessions' && <SessionsPanel />}
                {panel === 'folders' && <FoldersPanel />}
                {panel === 'snippets' && <SnippetsPanel />}
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="side-panel__resizer" onPointerDown={onResizeStart} />
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

export function PanelHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="panel-header">
      <div className="panel-header__titles">
        <h2 className="panel-header__title">{title}</h2>
        {subtitle && <div className="panel-header__subtitle">{subtitle}</div>}
      </div>
      <div className="panel-header__actions">{children}</div>
    </div>
  )
}

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="section-label">
      <span>{children}</span>
      {action}
    </div>
  )
}
