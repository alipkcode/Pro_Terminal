import { motion } from 'motion/react'
import { Archive, Code2, Command, FolderHeart, Layers, Settings2 } from 'lucide-react'
import { useApp, type PanelId } from '@/store/app'
import { openArchive, openPalette, openSettings, togglePanel } from '@/lib/actions'
import { Logo } from './icons'
import { LauncherDock } from './launchers/LauncherDock'
import { ShellToggle } from './ShellToggle'
import { Tabs } from './Tabs'

const PANELS: { id: PanelId; icon: typeof Layers; label: string; kbd: string }[] = [
  { id: 'sessions', icon: Layers, label: 'Sessions', kbd: 'Ctrl+Shift+B' },
  { id: 'folders', icon: FolderHeart, label: 'Folders', kbd: 'Ctrl+Shift+E' },
  { id: 'snippets', icon: Code2, label: 'Saved commands', kbd: 'Ctrl+Shift+S' }
]

export function TitleBar() {
  const panel = useApp((s) => s.panel)
  const overlay = useApp((s) => s.overlay)
  const archiveCount = useApp((s) => s.archive.length)

  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <Logo size={20} />
      </div>

      <nav className="titlebar__nav no-drag" aria-label="Panels">
        {PANELS.map(({ id, icon: Icon, label, kbd }) => {
          const on = panel === id && !overlay
          return (
            <button
              key={id}
              className={`nav-btn ${on ? 'nav-btn--on' : ''}`}
              onClick={() => {
                if (overlay) useApp.setState({ overlay: null })
                togglePanel(id)
              }}
              data-tip={label}
              data-tip-kbd={kbd}
              data-tip-placement="bottom"
              aria-pressed={on}
            >
              {on && <motion.span layoutId="nav-indicator" className="nav-btn__indicator" transition={{ type: 'spring', stiffness: 520, damping: 36 }} />}
              <Icon size={16} strokeWidth={1.9} />
            </button>
          )
        })}
        <button
          className={`nav-btn ${overlay === 'archive' ? 'nav-btn--on' : ''}`}
          onClick={() => (overlay === 'archive' ? useApp.setState({ overlay: null }) : openArchive())}
          data-tip="Archive"
          data-tip-kbd="Ctrl+Shift+H"
          data-tip-placement="bottom"
        >
          {overlay === 'archive' && (
            <motion.span layoutId="nav-indicator" className="nav-btn__indicator" transition={{ type: 'spring', stiffness: 520, damping: 36 }} />
          )}
          <Archive size={16} strokeWidth={1.9} />
          {archiveCount > 0 && <span className="nav-btn__count">{archiveCount > 99 ? '99+' : archiveCount}</span>}
        </button>
      </nav>

      <div className="titlebar__sep" />

      <LauncherDock />

      <div className="titlebar__sep" />

      <Tabs />

      <div className="titlebar__right">
        <ShellToggle />
        <button className="icon-btn no-drag" onClick={openPalette} data-tip="Command palette" data-tip-kbd="Ctrl+Shift+P" data-tip-placement="bottom">
          <Command size={15} />
        </button>
        <button
          className={`icon-btn no-drag ${overlay === 'settings' ? 'icon-btn--active' : ''}`}
          onClick={openSettings}
          data-tip="Settings"
          data-tip-kbd="Ctrl+,"
          data-tip-placement="bottom"
        >
          <Settings2 size={15} />
        </button>
      </div>
      <div className="titlebar__controls-space" />
    </header>
  )
}
