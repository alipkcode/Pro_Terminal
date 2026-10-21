import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useApp, type Toast } from '@/store/app'
import { dismissToast } from '@/lib/actions'

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle
}

function ToastItem({ toast }: { toast: Toast }) {
  const [paused, setPaused] = useState(false)
  const remaining = useRef(toast.duration)
  const started = useRef(Date.now())
  const Icon = ICONS[toast.kind]

  useEffect(() => {
    if (paused) return
    started.current = Date.now()
    const t = window.setTimeout(() => dismissToast(toast.id), remaining.current)
    return () => {
      window.clearTimeout(t)
      remaining.current -= Date.now() - started.current
    }
  }, [paused, toast.id])

  return (
    <motion.div
      layout
      className={`toast toast--${toast.kind}`}
      initial={{ opacity: 0, x: 40, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <Icon size={17} className="toast__icon" />
      <div className="toast__body">
        <div className="toast__title">{toast.title}</div>
        {toast.message && <div className="toast__message">{toast.message}</div>}
        {toast.actions && (
          <div className="toast__actions">
            {toast.actions.map((a) => (
              <button
                key={a.label}
                className={`btn btn--sm ${a.primary ? 'btn--primary' : ''}`}
                onClick={() => {
                  dismissToast(toast.id)
                  a.run()
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="icon-btn icon-btn--sm toast__close" onClick={() => dismissToast(toast.id)} aria-label="Dismiss">
        <X size={13} />
      </button>
      <div className="toast__progress" style={{ animationDuration: `${toast.duration}ms`, animationPlayState: paused ? 'paused' : 'running' }} />
    </motion.div>
  )
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className="toasts">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </div>
  )
}
