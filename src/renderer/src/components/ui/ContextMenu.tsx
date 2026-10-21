import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { set, useApp, type ContextMenuItem } from '@/store/app'

/** Opens the shared context menu at the mouse position. */
export function showContextMenu(e: { clientX: number; clientY: number; preventDefault?: () => void }, items: ContextMenuItem[]): void {
  e.preventDefault?.()
  set({ contextMenu: { x: e.clientX, y: e.clientY, items } })
}

export function ContextMenu() {
  const menu = useApp((s) => s.contextMenu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [index, setIndex] = useState(-1)

  const close = () => set({ contextMenu: null })

  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const x = Math.min(menu.x, window.innerWidth - r.width - 8)
    const y = menu.y + r.height > window.innerHeight - 8 ? Math.max(8, menu.y - r.height) : menu.y
    setPos({ x: Math.max(8, x), y })
    setIndex(-1)
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const enabled = menu.items.map((it, i) => (!it.separator && !it.disabled ? i : -1)).filter((i) => i >= 0)
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setIndex((cur) => {
          const pos = enabled.indexOf(cur)
          const next = e.key === 'ArrowDown' ? (pos + 1) % enabled.length : (pos - 1 + enabled.length) % enabled.length
          return enabled[next] ?? -1
        })
      } else if (e.key === 'Enter') {
        e.preventDefault()
        setIndex((cur) => {
          const item = menu.items[cur]
          if (item?.run && !item.disabled) {
            close()
            item.run()
          }
          return cur
        })
      }
    }
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  return (
    <AnimatePresence>
      {menu && (
        <motion.div
          ref={ref}
          className="ctx-menu"
          role="menu"
          style={{ left: pos.x || menu.x, top: pos.y || menu.y }}
          initial={{ opacity: 0, scale: 0.96, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.08 } }}
          transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.items.map((it, i) =>
            it.separator ? (
              <div key={i} className="ctx-menu__sep" />
            ) : (
              <button
                key={i}
                role="menuitem"
                className={`ctx-menu__item ${it.danger ? 'ctx-menu__item--danger' : ''} ${index === i ? 'ctx-menu__item--focus' : ''}`}
                disabled={it.disabled}
                onMouseEnter={() => setIndex(i)}
                onClick={() => {
                  close()
                  it.run?.()
                }}
              >
                <span className="ctx-menu__icon">{it.icon}</span>
                <span className="ctx-menu__label">{it.label}</span>
                {it.hint && <span className="ctx-menu__hint">{it.hint}</span>}
              </button>
            )
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
