import { Terminal, type IDecoration, type IDisposable, type IMarker } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import type { Settings } from '@shared/types'
import { api } from '@/api'
import { getTerminalTheme } from './themes'

export interface ControllerHooks {
  onContextMenu(ctrl: TerminalController, e: MouseEvent): void
  onPaste(ctrl: TerminalController): void
  onCopy(ctrl: TerminalController): void
  onBell(ctrl: TerminalController): void
  onOpenLink(url: string): void
}

const ACK_CHUNK = 5000
const MAX_MARKERS = 1000
const PTY_RESIZE_DELAY = 60

export function terminalOptions(s: Settings) {
  return {
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    letterSpacing: s.letterSpacing,
    cursorStyle: s.cursorStyle,
    cursorBlink: s.cursorBlink,
    scrollback: s.scrollback,
    theme: getTerminalTheme(s.terminalTheme).colors
  }
}

/** One xterm.js instance bound to a live session. Lives outside React so switching tabs is instant. */
export class TerminalController {
  readonly id: string
  readonly term: Terminal
  readonly el: HTMLDivElement
  readonly search = new SearchAddon({ highlightLimit: 2000 })
  private fit = new FitAddon()
  private webgl: WebglAddon | null = null
  private gpu: boolean
  private opened = false
  private visible = false
  private unacked = 0
  private disposables: IDisposable[] = []
  private resizeObserver: ResizeObserver | null = null
  private fitFrame = 0
  private prompts: IMarker[] = []
  private decorations: IDecoration[] = []
  private selectionTimer = 0
  private ptyResizeTimer = 0
  private copyOnSelect: boolean
  attached = false

  constructor(
    id: string,
    settings: Settings,
    private readonly hooks: ControllerHooks
  ) {
    this.id = id
    this.gpu = settings.gpuAcceleration
    this.copyOnSelect = settings.copyOnSelect
    this.el = document.createElement('div')
    this.el.className = 'term-host'
    this.term = new Terminal({
      ...terminalOptions(settings),
      allowProposedApi: true,
      allowTransparency: false,
      cursorInactiveStyle: 'outline',
      drawBoldTextInBrightColors: true,
      fastScrollSensitivity: 5,
      minimumContrastRatio: 1,
      rescaleOverlappingGlyphs: true,
      scrollOnEraseInDisplay: true,
      smoothScrollDuration: 90,
      windowsPty: { backend: 'conpty', buildNumber: 22621 },
      overviewRuler: { width: 8 }
    })
    this.term.loadAddon(this.fit)
    this.term.loadAddon(this.search)
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
    this.term.loadAddon(
      new WebLinksAddon((e, uri) => {
        if (e.ctrlKey || e.metaKey) hooks.onOpenLink(uri)
      })
    )

    this.disposables.push(
      this.term.onData((data) => api.sessions.write(this.id, data)),
      this.term.onBinary((data) => api.sessions.write(this.id, data)),
      this.term.onResize(() => this.schedulePtyResize()),
      this.term.onBell(() => hooks.onBell(this)),
      this.term.onSelectionChange(() => this.onSelectionChange())
    )
    this.registerShellIntegration()

    this.term.attachCustomKeyEventHandler((e) => this.handleKey(e))
    this.el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      hooks.onContextMenu(this, e)
    })
  }

  // ------------------------------------------------------------------ DOM

  /** Move the terminal element into a container (first call opens xterm). */
  mount(container: HTMLElement): void {
    if (this.el.parentElement !== container) container.appendChild(this.el)
    if (!this.opened) {
      this.term.open(this.el)
      this.opened = true
    }
    this.resizeObserver?.disconnect()
    this.resizeObserver = new ResizeObserver(() => this.scheduleFit())
    this.resizeObserver.observe(container)
    this.scheduleFit()
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    if (visible) {
      this.enableGpu()
      this.scheduleFit()
      requestAnimationFrame(() => this.term.refresh(0, this.term.rows - 1))
    } else {
      this.disableGpu()
    }
  }

  private enableGpu(): void {
    if (!this.gpu || this.webgl || !this.opened) return
    try {
      const addon = new WebglAddon()
      addon.onContextLoss(() => this.disableGpu())
      this.term.loadAddon(addon)
      this.webgl = addon
    } catch (err) {
      console.warn('WebGL renderer unavailable, using DOM renderer', err)
      this.webgl = null
    }
  }

  private disableGpu(): void {
    if (!this.webgl) return
    try {
      this.webgl.dispose()
    } catch {
      /* already disposed */
    }
    this.webgl = null
  }

  /**
   * xterm re-fits every frame while the side panel animates; the shell only needs the final size.
   * Resizing ConPTY on every frame makes it repaint the screen over and over.
   */
  private schedulePtyResize(): void {
    window.clearTimeout(this.ptyResizeTimer)
    this.ptyResizeTimer = window.setTimeout(() => api.sessions.resize(this.id, this.term.cols, this.term.rows), PTY_RESIZE_DELAY)
  }

  private scheduleFit(): void {
    if (this.fitFrame) return
    this.fitFrame = requestAnimationFrame(() => {
      this.fitFrame = 0
      this.fitNow()
    })
  }

  fitNow(): void {
    if (!this.opened || !this.visible) return
    const parent = this.el.parentElement
    if (!parent || parent.clientWidth < 20 || parent.clientHeight < 20) return
    try {
      const dims = this.fit.proposeDimensions()
      if (dims && dims.cols > 1 && dims.rows > 0 && (dims.cols !== this.term.cols || dims.rows !== this.term.rows)) {
        this.term.resize(dims.cols, dims.rows)
      }
    } catch {
      /* renderer not ready yet */
    }
  }

  focus(): void {
    if (this.opened) this.term.focus()
  }

  // ------------------------------------------------------------------ data

  async attach(): Promise<void> {
    const snapshot = await api.sessions.attach(this.id)
    if (snapshot) this.term.write(snapshot)
    this.attached = true
    // Tell the shell our real size once we know it.
    api.sessions.resize(this.id, this.term.cols, this.term.rows)
  }

  write(data: string): void {
    this.term.write(data, () => {
      this.unacked += data.length
      if (this.unacked >= ACK_CHUNK) {
        api.sessions.ack(this.id, this.unacked)
        this.unacked = 0
      }
    })
  }

  /** The shell was swapped in place: start from a blank screen. */
  reset(): void {
    this.clearMarks()
    this.term.reset()
  }

  clear(): void {
    this.clearMarks()
    this.term.clear()
  }

  // ------------------------------------------------------------------ settings

  applySettings(s: Settings): void {
    const o = terminalOptions(s)
    const t = this.term.options
    for (const [k, v] of Object.entries(o)) {
      if (k === 'theme' || (t as Record<string, unknown>)[k] !== v) (t as Record<string, unknown>)[k] = v
    }
    this.copyOnSelect = s.copyOnSelect
    if (s.gpuAcceleration !== this.gpu) {
      this.gpu = s.gpuAcceleration
      if (this.gpu && this.visible) this.enableGpu()
      else this.disableGpu()
    }
    this.scheduleFit()
  }

  // ------------------------------------------------------------------ keyboard & selection

  private handleKey(e: KeyboardEvent): boolean {
    if (e.type !== 'keydown') return true
    const ctrl = e.ctrlKey && !e.altKey && !e.metaKey
    const key = e.key.toLowerCase()
    // Ctrl+C copies when there is a selection, otherwise it is an interrupt for the shell.
    if ((ctrl && key === 'c' && this.term.hasSelection() && !e.shiftKey) || (ctrl && e.shiftKey && key === 'c') || (ctrl && key === 'insert')) {
      e.preventDefault()
      this.hooks.onCopy(this)
      return false
    }
    if ((ctrl && key === 'v') || (e.shiftKey && !e.ctrlKey && key === 'insert')) {
      e.preventDefault()
      this.hooks.onPaste(this)
      return false
    }
    return true
  }

  private onSelectionChange(): void {
    if (!this.copyOnSelect) return
    window.clearTimeout(this.selectionTimer)
    this.selectionTimer = window.setTimeout(() => {
      const text = this.term.getSelection()
      if (text) void api.system.writeClipboard(text)
    }, 150)
  }

  // ------------------------------------------------------------------ shell integration marks

  private registerShellIntegration(): void {
    this.disposables.push(
      this.term.parser.registerOscHandler(133, (data) => {
        const [kind, arg] = data.split(';')
        if (kind === 'A') {
          const m = this.term.registerMarker(0)
          if (m) {
            this.prompts.push(m)
            if (this.prompts.length > MAX_MARKERS) this.prompts.shift()?.dispose()
          }
        } else if (kind === 'D' && arg !== undefined && arg !== '') {
          this.markResult(Number(arg))
        }
        return false
      })
    )
  }

  /** Color the gutter/overview ruler next to the prompt of the command that just finished. */
  private markResult(code: number): void {
    const marker = this.prompts[this.prompts.length - 1]
    if (!marker || marker.isDisposed) return
    const ok = code === 0
    const deco = this.term.registerDecoration({
      marker,
      width: 1,
      overviewRulerOptions: { color: ok ? '#34d39988' : '#f87171', position: 'left' }
    })
    if (!deco) return
    deco.onRender((el) => {
      el.classList.add('cmd-mark', ok ? 'cmd-mark--ok' : 'cmd-mark--err')
      el.title = ok ? 'Succeeded' : `Failed with exit code ${code}`
    })
    this.decorations.push(deco)
    if (this.decorations.length > MAX_MARKERS) this.decorations.shift()?.dispose()
  }

  private clearMarks(): void {
    for (const d of this.decorations) d.dispose()
    for (const m of this.prompts) m.dispose()
    this.decorations = []
    this.prompts = []
  }

  /** Jump to the previous (-1) or next (+1) prompt in the scrollback. */
  scrollToPrompt(dir: -1 | 1): boolean {
    const buf = this.term.buffer.active
    const top = buf.viewportY
    const lines = this.prompts.filter((m) => !m.isDisposed && m.line >= 0).map((m) => m.line)
    const target = dir < 0 ? [...lines].reverse().find((l) => l < top) : lines.find((l) => l > top)
    if (target === undefined) {
      if (dir > 0) this.term.scrollToBottom()
      return false
    }
    this.term.scrollToLine(target)
    return true
  }

  dispose(): void {
    if (this.fitFrame) cancelAnimationFrame(this.fitFrame)
    window.clearTimeout(this.selectionTimer)
    window.clearTimeout(this.ptyResizeTimer)
    this.resizeObserver?.disconnect()
    this.clearMarks()
    for (const d of this.disposables) d.dispose()
    this.disableGpu()
    this.term.dispose()
    this.el.remove()
  }
}
