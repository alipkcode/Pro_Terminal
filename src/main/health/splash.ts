import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'
import { join } from 'node:path'
import { SPLASH_CHANNEL, type SplashAction, type SplashState } from '@shared/health'
import icon from '../../../resources/icon.ico?asset&asarUnpack'

const WIDTH = 420
const HEIGHT = 520
/** Matches the fade-out in splash.css. */
const EXIT_MS = 260

/** Small frameless window that shows the start-up check while the app gets ready. */
export class Splash {
  readonly win: BrowserWindow
  private state: SplashState | null = null
  private loaded = false
  private failedToLoad = false
  private onAction: ((a: SplashAction) => void) | null = null
  private readonly actionListener = (e: IpcMainEvent, action: unknown): void => {
    if (e.sender !== this.win.webContents) return
    if (action === 'retry' || action === 'open-data' || action === 'copy-report' || action === 'quit') this.onAction?.(action)
  }

  constructor(dark: boolean) {
    this.win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: true,
      fullscreenable: false,
      hasShadow: false,
      center: true,
      title: 'Pro Terminal',
      backgroundColor: '#00000000',
      icon,
      webPreferences: {
        preload: join(__dirname, '../preload/splash.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false
      }
    })
    this.win.setMenu(null)
    this.win.webContents.on('will-navigate', (e) => e.preventDefault())
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.win.once('ready-to-show', () => this.win.show())
    this.win.webContents.on('did-finish-load', () => {
      this.loaded = true
      this.push()
    })
    this.win.webContents.on('did-fail-load', () => {
      this.failedToLoad = true
    })
    ipcMain.on(SPLASH_CHANNEL.action, this.actionListener)

    const query = { theme: dark ? 'dark' : 'light' }
    const dev = process.env.ELECTRON_RENDERER_URL
    if (dev) void this.win.loadURL(`${dev}/splash.html?theme=${query.theme}`)
    else void this.win.loadFile(join(__dirname, '../renderer/splash.html'), { query })
  }

  /** False when the splash page itself could not be shown (e.g. damaged install); callers fall back to a dialog. */
  get usable(): boolean {
    return !this.failedToLoad && !this.win.isDestroyed()
  }

  /** Resolves once the page is ready to receive actions, or after a timeout if it never loads. */
  whenLoaded(timeoutMs = 4000): Promise<boolean> {
    if (this.loaded) return Promise.resolve(true)
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.loaded), timeoutMs)
      this.win.webContents.once('did-finish-load', () => {
        clearTimeout(timer)
        resolve(true)
      })
    })
  }

  setActionHandler(fn: (a: SplashAction) => void): void {
    this.onAction = fn
  }

  update(state: SplashState): void {
    this.state = state
    this.push()
  }

  private push(): void {
    if (!this.loaded || !this.state || this.win.isDestroyed()) return
    this.win.webContents.send(SPLASH_CHANNEL.state, this.state)
  }

  focus(): void {
    if (this.win.isDestroyed()) return
    if (this.win.isMinimized()) this.win.restore()
    this.win.focus()
  }

  /** Fade out (the page animates on mode 'opening' + closing class), then close. */
  async close(): Promise<void> {
    ipcMain.removeListener(SPLASH_CHANNEL.action, this.actionListener)
    if (this.win.isDestroyed()) return
    if (this.loaded) {
      this.win.webContents.send(SPLASH_CHANNEL.state, { ...this.state, closing: true })
      await new Promise((r) => setTimeout(r, EXIT_MS))
    }
    if (!this.win.isDestroyed()) this.win.destroy()
  }
}
