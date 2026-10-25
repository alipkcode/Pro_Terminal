import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, GitBranch, Loader2, Minus, Plus, Star, TriangleAlert, X } from 'lucide-react'
import { api } from '@/api'
import { useActiveSession, useApp } from '@/store/app'
import { cdTo, toast, toggleFavorite, zoom } from '@/lib/actions'
import { elapsed, pathSegments, samePath } from '@/lib/format'
import { SHELL_META } from '@/lib/shell'
import { getController } from '@/terminal/registry'
import { ShellIcon } from './icons'
import { PowerPill } from './power/PowerPill'

function RunningClock({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  return <span className="mono">{elapsed(now - since)}</span>
}

export function StatusBar() {
  const s = useActiveSession()
  const viewerId = useApp((st) => st.viewerId)
  const favorites = useApp((st) => st.library.favorites)
  const fontSize = useApp((st) => st.settings.fontSize)
  const [dims, setDims] = useState('')

  useEffect(() => {
    const c = getController(s?.id)
    if (!c) return setDims('')
    const update = () => setDims(`${c.term.cols}×${c.term.rows}`)
    update()
    const d = c.term.onResize(update)
    return () => d.dispose()
  }, [s?.id])

  if (!s || viewerId) {
    return (
      <footer className="statusbar">
        <span className="statusbar__muted">{viewerId ? 'Viewing an archived session' : 'No active session'}</span>
        <PowerPill />
      </footer>
    )
  }

  const segs = pathSegments(s.cwd)
  const isFav = favorites.some((f) => samePath(f.path, s.cwd))
  const last = s.commands[s.commands.length - 1]

  return (
    <footer className="statusbar">
      <div className="statusbar__left">
        <span className={`statusbar__shell statusbar__shell--${s.shell === 'cmd' ? 'cmd' : 'ps'}`}>
          <ShellIcon shell={s.shell} size={13} colored={false} />
          {SHELL_META[s.shell].short}
        </span>
        <div className="crumbs" data-tip={s.cwd}>
          {segs.map((seg, i) => {
            const lastSeg = i === segs.length - 1
            return (
              <span key={seg.path} className="crumbs__seg">
                {i > 0 && <span className="crumbs__sep">›</span>}
                <button className={`crumbs__btn ${lastSeg ? 'crumbs__btn--last' : ''}`} onClick={() => !lastSeg && void cdTo(seg.path)} disabled={lastSeg}>
                  {seg.label}
                </button>
              </span>
            )
          })}
        </div>
        <button className={`statusbar__icon ${isFav ? 'statusbar__icon--fav' : ''}`} onClick={() => void toggleFavorite(s.cwd)} data-tip={isFav ? 'Remove from favorites' : 'Add folder to favorites'}>
          <Star size={12} fill={isFav ? 'currentColor' : 'none'} />
        </button>
        <button className="statusbar__icon" onClick={() => void api.system.writeClipboard(s.cwd).then(() => toast('success', 'Path copied'))} data-tip="Copy path">
          <Copy size={11} />
        </button>
        {s.gitBranch && (
          <span className="statusbar__branch" data-tip="Git branch">
            <GitBranch size={12} />
            {s.gitBranch}
          </span>
        )}
      </div>

      <div className="statusbar__right">
        <PowerPill />
        <AnimatePresence mode="wait" initial={false}>
          {s.status === 'busy' ? (
            <motion.span key="busy" className="statusbar__state statusbar__state--busy" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
              <Loader2 size={12} className="spin" />
              <span className="statusbar__cmd mono">{s.currentCommand?.text ?? 'Running'}</span>
              {s.currentCommand && <RunningClock since={s.currentCommand.startedAt} />}
            </motion.span>
          ) : s.status === 'exited' ? (
            <motion.span key="exited" className="statusbar__state statusbar__state--exited" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
              <X size={12} /> Exited ({s.exitCode ?? 0})
            </motion.span>
          ) : s.status === 'starting' ? (
            <motion.span key="starting" className="statusbar__state" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Loader2 size={12} className="spin" /> Starting…
            </motion.span>
          ) : (
            <motion.span key="idle" className="statusbar__state statusbar__state--idle" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
              <span className="status-dot status-dot--idle" /> Ready
            </motion.span>
          )}
        </AnimatePresence>

        {last?.exitCode !== undefined && s.status !== 'busy' && (
          <span className={`statusbar__exit ${last.exitCode === 0 ? 'statusbar__exit--ok' : 'statusbar__exit--err'}`} data-tip={`Last command: ${last.text}`}>
            {last.exitCode === 0 ? <Check size={11} /> : <TriangleAlert size={11} />}
            {last.exitCode === 0 ? 'OK' : `Exit ${last.exitCode}`}
          </span>
        )}
        {s.commands.length > 0 && <span className="statusbar__muted">{s.commands.length} cmds</span>}
        {!s.integration && s.status !== 'starting' && (
          <span className="statusbar__muted" data-tip="The shell isn't reporting its folder or command status (custom prompt or integration turned off).">
            basic mode
          </span>
        )}
        <span className="statusbar__muted mono">{dims}</span>
        <span className="statusbar__zoom">
          <button onClick={() => zoom(-1)} data-tip="Zoom out" data-tip-kbd="Ctrl+-">
            <Minus size={11} />
          </button>
          <button className="mono" onClick={() => zoom(0)} data-tip="Reset zoom" data-tip-kbd="Ctrl+0">
            {fontSize}px
          </button>
          <button onClick={() => zoom(1)} data-tip="Zoom in" data-tip-kbd="Ctrl+=">
            <Plus size={11} />
          </button>
        </span>
      </div>
    </footer>
  )
}
