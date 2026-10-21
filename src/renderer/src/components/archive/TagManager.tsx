import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Tags, Trash2 } from 'lucide-react'
import { ACCENT_SWATCHES } from '@shared/defaults'
import { api } from '@/api'
import { useApp } from '@/store/app'
import { confirm } from '@/lib/actions'
import { normTag } from './TagEditor'

/** Popover for renaming, recoloring and deleting tags. */
export function TagManager() {
  const tags = useApp((s) => s.library.tags)
  const archive = useApp((s) => s.archive)
  const [open, setOpen] = useState(false)
  const [colorFor, setColorFor] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.modal-backdrop')) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const usage = (name: string) => archive.filter((a) => a.tags.includes(name)).length

  return (
    <div className="tag-manager" ref={ref}>
      <button className={`icon-btn ${open ? 'icon-btn--active' : ''}`} onClick={() => setOpen((o) => !o)} data-tip="Manage tags">
        <Tags size={15} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="popover tag-manager__pop"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
            transition={{ type: 'spring', stiffness: 480, damping: 34 }}
          >
            <div className="menu-popover__label">Tags</div>
            {tags.length === 0 && <div className="tag-manager__empty">No tags yet. Add one to a session.</div>}
            {tags.map((t) => (
              <div key={t.name} className="tag-manager__row">
                <button className="tag-manager__color" style={{ background: t.color }} onClick={() => setColorFor(colorFor === t.name ? null : t.name)} aria-label="Change color" />
                <input
                  className="tag-manager__name"
                  defaultValue={t.name}
                  key={t.name}
                  onBlur={(e) => {
                    const next = normTag(e.currentTarget.value)
                    if (next && next !== t.name) void api.library.upsertTag({ name: next, color: t.color }, t.name)
                    else e.currentTarget.value = t.name
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') e.currentTarget.blur()
                  }}
                />
                <span className="tag-manager__count">{usage(t.name)}</span>
                <button
                  className="icon-btn icon-btn--sm icon-btn--danger"
                  onClick={async () => {
                    const n = usage(t.name)
                    if (n) {
                      const ok = await confirm({ title: `Delete tag “${t.name}”?`, message: `It will be removed from ${n} session${n === 1 ? '' : 's'}. The sessions themselves are kept.`, confirmLabel: 'Delete tag', danger: true })
                      if (!ok) return
                    }
                    await api.library.removeTag(t.name)
                  }}
                  data-tip="Delete tag"
                >
                  <Trash2 size={12} />
                </button>
                {colorFor === t.name && (
                  <div className="tag-manager__swatches">
                    {ACCENT_SWATCHES.map((c) => (
                      <button
                        key={c}
                        className={`swatch swatch--sm ${c === t.color ? 'swatch--on' : ''}`}
                        style={{ ['--swatch' as string]: c }}
                        onClick={() => {
                          void api.library.upsertTag({ name: t.name, color: c })
                          setColorFor(null)
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
