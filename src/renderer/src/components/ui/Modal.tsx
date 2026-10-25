import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  width?: number
  children: ReactNode
  footer?: ReactNode
  className?: string
  /** Extra styles for the panel, such as CSS variables its contents use. */
  style?: CSSProperties
  /** Close when the backdrop is clicked (default true). */
  dismissable?: boolean
}

export function Modal({ open, onClose, title, subtitle, icon, width = 520, children, footer, className, style, dismissable = true }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null)
  // Callers pass a fresh onClose every render; keep the latest in a ref so the open-time
  // effect below runs once per opening and doesn't steal focus back on every keystroke.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    // Focus the first field (or the panel) so typing goes to the dialog, not the terminal.
    const t = window.setTimeout(() => {
      const el = panel.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select, button.btn--primary')
      ;(el ?? panel.current)?.focus()
    }, 30)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.clearTimeout(t)
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(e) => {
            if (dismissable && e.target === e.currentTarget) onClose()
          }}
        >
          <motion.div
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            className={`modal ${className ?? ''}`}
            style={{ ...style, width }}
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.14 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            {(title || icon) && (
              <div className="modal__header">
                {icon && <div className="modal__icon">{icon}</div>}
                <div className="modal__titles">
                  <div className="modal__title">{title}</div>
                  {subtitle && <div className="modal__subtitle">{subtitle}</div>}
                </div>
                <button className="icon-btn" onClick={onClose} aria-label="Close">
                  <X size={16} />
                </button>
              </div>
            )}
            <div className="modal__body">{children}</div>
            {footer && <div className="modal__footer">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
