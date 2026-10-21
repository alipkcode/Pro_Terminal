import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { useApp } from '@/store/app'
import { api } from '@/api'
import { trimTrailingBlank } from '@shared/vt'
import { terminalOptions } from '@/terminal/controller'
import { Loader2 } from 'lucide-react'

export interface LogViewerHandle {
  search: SearchAddon | undefined
  term: Terminal | undefined
}

/** Read-only terminal that replays an archived session's output with its original colors. */
export const LogViewer = forwardRef<LogViewerHandle, { sessionId: string }>(function LogViewer({ sessionId }, ref) {
  const host = useRef<HTMLDivElement>(null)
  const settings = useApp((s) => s.settings)
  const [parts, setParts] = useState<{ term: Terminal; search: SearchAddon } | null>(null)
  const [loading, setLoading] = useState(true)
  const [empty, setEmpty] = useState(false)

  useImperativeHandle(ref, () => ({ search: parts?.search, term: parts?.term }), [parts])

  useEffect(() => {
    if (!host.current) return
    const s = useApp.getState().settings
    const term = new Terminal({
      ...terminalOptions(s),
      scrollback: 100000,
      disableStdin: true,
      cursorBlink: false,
      cursorInactiveStyle: 'none',
      allowProposedApi: true,
      overviewRuler: { width: 8 }
    })
    const fit = new FitAddon()
    const search = new SearchAddon({ highlightLimit: 2000 })
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.open(host.current)
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* not visible */
      }
    })
    ro.observe(host.current)
    try {
      fit.fit()
    } catch {
      /* not visible */
    }
    setParts({ term, search })
    setLoading(true)
    setEmpty(false)
    let cancelled = false
    void api.archive.log(sessionId).then((log) => {
      if (cancelled) return
      setLoading(false)
      const body = trimTrailingBlank(log)
      if (!body) {
        setEmpty(true)
        return
      }
      // Hide the cursor: this is a read-only view.
      term.write(body + '\x1b[0m\x1b[?25l', () => term.scrollToBottom())
    })
    return () => {
      cancelled = true
      ro.disconnect()
      term.dispose()
      setParts(null)
    }
  }, [sessionId])

  useEffect(() => {
    if (!parts) return
    const o = terminalOptions(settings)
    parts.term.options.theme = o.theme
    parts.term.options.fontFamily = o.fontFamily
    parts.term.options.fontSize = o.fontSize
    parts.term.options.lineHeight = o.lineHeight
  }, [settings, parts])

  return (
    <div className="log-viewer">
      <div className="log-viewer__host" ref={host} />
      {loading && (
        <div className="log-viewer__state">
          <Loader2 size={18} className="spin" />
        </div>
      )}
      {empty && <div className="log-viewer__state">No output was recorded for this session.</div>}
    </div>
  )
})
