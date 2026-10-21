import type { ITheme } from '@xterm/xterm'

export interface TerminalTheme {
  id: string
  name: string
  kind: 'dark' | 'light'
  colors: ITheme
}

type Palette = [string, string, string, string, string, string, string, string]

function theme(
  id: string,
  name: string,
  kind: 'dark' | 'light',
  base: { background: string; foreground: string; cursor: string; selection: string },
  normal: Palette,
  bright: Palette
): TerminalTheme {
  const [black, red, green, yellow, blue, magenta, cyan, white] = normal
  const [brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite] = bright
  return {
    id,
    name,
    kind,
    colors: {
      background: base.background,
      foreground: base.foreground,
      cursor: base.cursor,
      cursorAccent: base.background,
      selectionBackground: base.selection,
      selectionInactiveBackground: base.selection,
      scrollbarSliderBackground: kind === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)',
      scrollbarSliderHoverBackground: kind === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.2)',
      scrollbarSliderActiveBackground: kind === 'dark' ? 'rgba(255,255,255,0.26)' : 'rgba(0,0,0,0.28)',
      // xterm can't parse the keyword `transparent` and would fall back to a white border.
      overviewRulerBorder: '#00000000',
      black,
      red,
      green,
      yellow,
      blue,
      magenta,
      cyan,
      white,
      brightBlack,
      brightRed,
      brightGreen,
      brightYellow,
      brightBlue,
      brightMagenta,
      brightCyan,
      brightWhite
    }
  }
}

const campbell: [Palette, Palette] = [
  ['#0C0C0C', '#C50F1F', '#13A10E', '#C19C00', '#0037DA', '#881798', '#3A96DD', '#CCCCCC'],
  ['#767676', '#E74856', '#16C60C', '#F9F1A5', '#3B78FF', '#B4009E', '#61D6D6', '#F2F2F2']
]

export const TERMINAL_THEMES: TerminalTheme[] = [
  theme(
    'pro-midnight',
    'Pro Midnight',
    'dark',
    { background: '#0d1017', foreground: '#d7dcea', cursor: '#8b9bff', selection: 'rgba(124,140,255,0.32)' },
    ['#1b1f2b', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c3cadf'],
    ['#4b5370', '#ff8fa3', '#b6ec84', '#ffd08a', '#9ab8ff', '#d2b6ff', '#a6e4ff', '#eef1ff']
  ),
  theme('campbell', 'Campbell', 'dark', { background: '#0C0C0C', foreground: '#CCCCCC', cursor: '#FFFFFF', selection: 'rgba(255,255,255,0.25)' }, ...campbell),
  theme(
    'campbell-powershell',
    'Campbell PowerShell',
    'dark',
    { background: '#012456', foreground: '#CCCCCC', cursor: '#FFFFFF', selection: 'rgba(255,255,255,0.25)' },
    ...campbell
  ),
  theme(
    'tokyo-night',
    'Tokyo Night',
    'dark',
    { background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', selection: 'rgba(122,162,247,0.3)' },
    ['#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6'],
    ['#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5']
  ),
  theme(
    'one-half-dark',
    'One Half Dark',
    'dark',
    { background: '#282c34', foreground: '#dcdfe4', cursor: '#a3b3cc', selection: 'rgba(171,178,191,0.28)' },
    ['#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#dcdfe4'],
    ['#5a6374', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#dcdfe4']
  ),
  theme(
    'dracula',
    'Dracula',
    'dark',
    { background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selection: 'rgba(98,114,164,0.5)' },
    ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2'],
    ['#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff']
  ),
  theme(
    'catppuccin-mocha',
    'Catppuccin Mocha',
    'dark',
    { background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', selection: 'rgba(147,153,178,0.3)' },
    ['#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de'],
    ['#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8']
  ),
  theme(
    'solarized-dark',
    'Solarized Dark',
    'dark',
    { background: '#002b36', foreground: '#93a1a1', cursor: '#93a1a1', selection: 'rgba(147,161,161,0.25)' },
    ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5'],
    ['#586e75', '#cb4b16', '#93a33a', '#c99a2e', '#4ca2e0', '#6c71c4', '#3fbdb2', '#fdf6e3']
  ),
  theme(
    'pro-daylight',
    'Pro Daylight',
    'light',
    { background: '#fbfcfe', foreground: '#2a3140', cursor: '#4f5bd5', selection: 'rgba(79,91,213,0.2)' },
    ['#2a3140', '#c8334a', '#2f8a3a', '#9a6400', '#2f5fd0', '#8a3fc7', '#087f91', '#c9cfdb'],
    ['#6b7385', '#e5485f', '#3aa047', '#b97800', '#4672e0', '#9d55d6', '#0f97ab', '#8b93a6']
  ),
  theme(
    'one-half-light',
    'One Half Light',
    'light',
    { background: '#fafafa', foreground: '#383a42', cursor: '#4f525d', selection: 'rgba(56,58,66,0.15)' },
    ['#383a42', '#e45649', '#50a14f', '#c18301', '#0184bc', '#a626a4', '#0997b3', '#a0a1a7'],
    ['#4f525d', '#df6c75', '#4ea24c', '#d19a10', '#61afef', '#c577dd', '#56b5c1', '#696c77']
  )
]

export function getTerminalTheme(id: string): TerminalTheme {
  return TERMINAL_THEMES.find((t) => t.id === id) ?? TERMINAL_THEMES[0]
}
