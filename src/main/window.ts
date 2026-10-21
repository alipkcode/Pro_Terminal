import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import type { WindowMaterial } from '@shared/types'
import { JsonFile } from './store/jsonFile'
import icon from '../../resources/icon.ico?asset&asarUnpack'
import { bool, isObject, num } from './store/util'

export const TITLEBAR_HEIGHT = 40

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

function normalizeState(raw: unknown): WindowState {
  const r = isObject(raw) ? raw : {}
  return {
    x: typeof r.x === 'number' ? r.x : undefined,
    y: typeof r.y === 'number' ? r.y : undefined,
    width: num(r.width, 1240, 640, 10000),
    height: num(r.height, 780, 400, 10000),
    maximized: bool(r.maximized, false)
  }
}

/** Only reuse the saved position if it is still on a connected display. */
function visibleBounds(s: WindowState): Partial<WindowState> {
  if (s.x === undefined || s.y === undefined) return { width: s.width, height: s.height }
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return s.x! + 80 < a.x + a.width && s.x! + s.width - 80 > a.x && s.y! >= a.y - 10 && s.y! + 40 < a.y + a.height
  })
  return onScreen ? s : { width: s.width, height: s.height }
}

export function createMainWindow(dataDir: string, material: WindowMaterial, dark: boolean): { win: BrowserWindow; saveState: () => void } {
  const stateFile = new JsonFile<WindowState>(join(dataDir, 'window-state.json'), { width: 1240, height: 780, maximized: false }, normalizeState)
  const state = stateFile.data
  const bounds = visibleBounds(state)
  const translucent = material !== 'none'

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 640,
    minHeight: 400,
    show: false,
    title: 'Pro Terminal',
    backgroundColor: translucent ? '#00000000' : dark ? '#0b0e14' : '#f6f7fb',
    backgroundMaterial: translucent ? material : 'none',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: dark ? '#c7cede' : '#2b3040',
      height: TITLEBAR_HEIGHT
    },
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })

  if (state.maximized) win.maximize()

  win.once('ready-to-show', () => win.show())

  // Never open other pages inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const dev = process.env.ELECTRON_RENDERER_URL
    if (!dev || !url.startsWith(dev)) e.preventDefault()
  })

  const saveState = (): void => {
    if (win.isDestroyed()) return
    const maximized = win.isMaximized()
    const b = maximized ? win.getNormalBounds() : win.getBounds()
    stateFile.data = { x: b.x, y: b.y, width: b.width, height: b.height, maximized }
    stateFile.save()
    stateFile.flush()
  }

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  return { win, saveState }
}
