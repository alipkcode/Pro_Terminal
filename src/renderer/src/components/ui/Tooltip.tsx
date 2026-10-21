import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'

interface TipState {
  text: string
  kbd?: string
  x: number
  y: number
  placement: 'top' | 'bottom'
}

/**
 * One tooltip for the whole app. Any element with `data-tip="…"` (and optional `data-tip-kbd`)
 * gets a tooltip after a short hover delay.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null)
  const timer = useRef<number>(0)
  const current = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current)
      current.current = null
      setTip(null)
    }
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null
      if (el === current.current) return
      window.clearTimeout(timer.current)
      current.current = el
      if (!el) {
        setTip(null)
        return
      }
      const wasShowing = !!tip
      timer.current = window.setTimeout(
        () => {
          if (current.current !== el || !el.isConnected) return
          const text = el.dataset.tip
          if (!text) return
          const r = el.getBoundingClientRect()
          const placement = r.top < 70 || el.dataset.tipPlacement === 'bottom' ? 'bottom' : 'top'
          setTip({
            text,
            kbd: el.dataset.tipKbd,
            x: r.left + r.width / 2,
            y: placement === 'bottom' ? r.bottom + 8 : r.top - 8,
            placement
          })
        },
        wasShowing ? 60 : 480
      )
    }
    document.addEventListener('mouseover', over)
    document.addEventListener('mousedown', hide, true)
    document.addEventListener('keydown', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('mouseover', over)
      document.removeEventListener('mousedown', hide, true)
      document.removeEventListener('keydown', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [tip])

  return (
    <AnimatePresence>
      {tip && (
        <motion.div
          key={tip.text + tip.x}
          className={`tooltip tooltip--${tip.placement}`}
          style={{ left: tip.x, top: tip.y }}
          initial={{ opacity: 0, y: tip.placement === 'bottom' ? -4 : 4, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
        >
          <span>{tip.text}</span>
          {tip.kbd && <kbd>{tip.kbd}</kbd>}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
