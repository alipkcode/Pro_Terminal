import { useEffect } from 'react'
import { AnimatePresence, MotionConfig } from 'motion/react'
import { useApp } from '@/store/app'
import { boot } from '@/lib/actions'
import { handleGlobalKey } from '@/lib/keys'
import { TitleBar } from './components/TitleBar'
import { SidePanel } from './components/SidePanel'
import { TerminalArea } from './components/terminal/TerminalArea'
import { StatusBar } from './components/StatusBar'
import { ArchiveView } from './components/archive/ArchiveView'
import { CommandPalette } from './components/CommandPalette'
import { SettingsDialog } from './components/SettingsDialog'
import { SnippetEditor } from './components/dialogs/SnippetEditor'
import { ConfirmDialog, FavoriteEditor, QuitDialog, VarsDialog } from './components/dialogs/Dialogs'
import { LauncherManager } from './components/launchers/LauncherManager'
import { LauncherWizard } from './components/launchers/LauncherWizard'
import { Toasts } from './components/ui/Toasts'
import { ContextMenu } from './components/ui/ContextMenu'
import { TooltipLayer } from './components/ui/Tooltip'

let booted = false

export function App() {
  const overlay = useApp((s) => s.overlay)

  useEffect(() => {
    if (!booted) {
      booted = true
      void boot()
    }
    const onKey = (e: KeyboardEvent) => {
      if (handleGlobalKey(e)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    // Files dropped outside a drop zone must not navigate the window away.
    const prevent = (e: DragEvent) => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <TitleBar />
        <div className="app__body">
          <SidePanel />
          <div className="app__main">
            <TerminalArea />
            <AnimatePresence>{overlay === 'archive' && <ArchiveView key="archive" />}</AnimatePresence>
          </div>
        </div>
        <StatusBar />
      </div>
      <CommandPalette />
      <SettingsDialog />
      <SnippetEditor />
      <VarsDialog />
      <FavoriteEditor />
      <LauncherManager />
      <LauncherWizard />
      <ConfirmDialog />
      <QuitDialog />
      <ContextMenu />
      <Toasts />
      <TooltipLayer />
    </MotionConfig>
  )
}
