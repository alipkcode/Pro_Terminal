import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowDown, ArrowUp, CaseSensitive, Regex, WholeWord, X } from 'lucide-react'
import type { SearchAddon } from '@xterm/addon-search'

const DECORATIONS = {
  matchBackground: '#3b4366',
  matchBorder: '#3b4366',
  matchOverviewRuler: '#8b96ff',
  activeMatchBackground: '#8b5cf6',
  activeMatchBorder: '#c4b5fd',
  activeMatchColorOverviewRuler: '#c4b5fd'
}

/** Search box over a terminal. Works with any SearchAddon (live sessions and archived logs). */
export function FindBar({ search, onClose, focusKey }: { search: SearchAddon | undefined; onClose: () => void; focusKey?: unknown }) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCase] = useState(false)
  const [regex, setRegex] = useState(false)
  const [wholeWord, setWhole] = useState(false)
  const [result, setResult] = useState<{ index: number; count: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusKey])

  useEffect(() => {
    if (!search) return
    const d = search.onDidChangeResults((r) => setResult(r ? { index: r.resultIndex, count: r.resultCount } : null))
    return () => {
      d.dispose()
      search.clearDecorations()
    }
  }, [search])

  const opts = { caseSensitive, regex, wholeWord, decorations: DECORATIONS }

  useEffect(() => {
    if (!search) return
    if (!query) {
      search.clearDecorations()
      setResult(null)
      return
    }
    try {
      search.findNext(query, { ...opts, incremental: true })
    } catch {
      setResult({ index: -1, count: 0 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive, regex, wholeWord, search])

  const next = () => query && search?.findNext(query, opts)
  const prev = () => query && search?.findPrevious(query, opts)

  return (
    <motion.div
      className="find-bar"
      initial={{ opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 460, damping: 34 }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onClose()
        if (e.key === 'Enter') (e.shiftKey ? prev : next)()
      }}
    >
      <input ref={input} className="find-bar__input" placeholder="Find in output" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
      <span className={`find-bar__count ${query && result?.count === 0 ? 'find-bar__count--none' : ''}`}>
        {query ? (result ? (result.count ? `${result.index + 1} of ${result.count}` : 'No results') : '…') : ''}
      </span>
      <button className={`icon-btn icon-btn--sm ${caseSensitive ? 'icon-btn--active' : ''}`} onClick={() => setCase((v) => !v)} data-tip="Match case">
        <CaseSensitive size={15} />
      </button>
      <button className={`icon-btn icon-btn--sm ${wholeWord ? 'icon-btn--active' : ''}`} onClick={() => setWhole((v) => !v)} data-tip="Whole word">
        <WholeWord size={15} />
      </button>
      <button className={`icon-btn icon-btn--sm ${regex ? 'icon-btn--active' : ''}`} onClick={() => setRegex((v) => !v)} data-tip="Regular expression">
        <Regex size={14} />
      </button>
      <span className="find-bar__sep" />
      <button className="icon-btn icon-btn--sm" onClick={prev} data-tip="Previous" data-tip-kbd="Shift+Enter">
        <ArrowUp size={14} />
      </button>
      <button className="icon-btn icon-btn--sm" onClick={next} data-tip="Next" data-tip-kbd="Enter">
        <ArrowDown size={14} />
      </button>
      <button className="icon-btn icon-btn--sm" onClick={onClose} data-tip="Close" data-tip-kbd="Esc">
        <X size={14} />
      </button>
    </motion.div>
  )
}
