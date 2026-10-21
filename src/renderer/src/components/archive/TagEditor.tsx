import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Plus, Tag, X } from 'lucide-react'
import { ACCENT_SWATCHES } from '@shared/defaults'
import type { TagDef } from '@shared/types'
import { api } from '@/api'
import { useApp } from '@/store/app'

export const normTag = (v: string): string => v.trim().replace(/\s+/g, '-').toLowerCase().slice(0, 40)

export function tagColor(tags: TagDef[], name: string): string {
  return tags.find((t) => t.name === name)?.color ?? '#94a3b8'
}

export function TagPill({ name, color, onRemove, onClick, active }: { name: string; color: string; onRemove?: () => void; onClick?: () => void; active?: boolean }) {
  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={`tag-pill ${onClick ? 'tag-pill--clickable' : ''} ${active ? 'tag-pill--active' : ''}`}
      style={{ ['--tag' as string]: color }}
      onClick={onClick}
    >
      <span className="tag-pill__dot" />
      {name}
      {onRemove && (
        <button
          className="tag-pill__x"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Remove tag ${name}`}
        >
          <X size={10} />
        </button>
      )}
    </motion.span>
  )
}

/** Tag chips with an inline "add tag" field that autocompletes existing tags and creates new ones. */
export function TagEditor({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const tags = useApp((s) => s.library.tags)
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const suggestions = useMemo(() => {
    const q = normTag(text)
    const list = tags.filter((t) => !value.includes(t.name) && (!q || t.name.includes(q)))
    const exact = tags.some((t) => t.name === q)
    return { list: list.slice(0, 6), create: q && !exact && !value.includes(q) ? q : null }
  }, [tags, text, value])

  const options = [...suggestions.list.map((t) => t.name), ...(suggestions.create ? [suggestions.create] : [])]

  const add = async (name: string) => {
    const n = normTag(name)
    if (!n || value.includes(n)) return
    if (!tags.some((t) => t.name === n)) {
      const color = ACCENT_SWATCHES[tags.length % ACCENT_SWATCHES.length]
      await api.library.upsertTag({ name: n, color })
    }
    onChange([...value, n])
    setText('')
    setIndex(0)
  }

  return (
    <div className="tag-editor">
      <AnimatePresence initial={false}>
        {value.map((t) => (
          <TagPill key={t} name={t} color={tagColor(tags, t)} onRemove={() => onChange(value.filter((x) => x !== t))} />
        ))}
      </AnimatePresence>
      {adding ? (
        <div className="tag-editor__field">
          <Tag size={12} />
          <input
            ref={input}
            autoFocus
            value={text}
            placeholder="tag name"
            onChange={(e) => {
              setText(e.target.value)
              setIndex(0)
            }}
            onBlur={() => window.setTimeout(() => setAdding(false), 120)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                const pick = options[index] ?? text
                if (pick) void add(pick)
              } else if (e.key === 'Escape') {
                setAdding(false)
                setText('')
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => Math.min(options.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => Math.max(0, i - 1))
              } else if (e.key === 'Backspace' && !text && value.length) {
                onChange(value.slice(0, -1))
              }
            }}
          />
          {options.length > 0 && (
            <div className="tag-suggest">
              {suggestions.list.map((t, i) => (
                <button key={t.name} className={`tag-suggest__row ${i === index ? 'tag-suggest__row--on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => void add(t.name)}>
                  <span className="chip__dot" style={{ background: t.color }} />
                  {t.name}
                </button>
              ))}
              {suggestions.create && (
                <button
                  className={`tag-suggest__row ${index === suggestions.list.length ? 'tag-suggest__row--on' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void add(suggestions.create!)}
                >
                  <Plus size={12} />
                  Create “{suggestions.create}”
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <button className="tag-editor__add" onClick={() => setAdding(true)}>
          <Plus size={12} />
          Add tag
        </button>
      )}
    </div>
  )
}
