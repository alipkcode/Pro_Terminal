import type { IconImages } from '@shared/types'
// The app icon (resources/icon.svg and icon-small.svg) redrawn in another color mood: every color of the
// original is kept relative to the chosen hue, so a shortcut reads as "Pro Terminal, but teal".

interface Hsl {
  h: number
  s: number
  l: number
}

function hexToHsl(hex: string): Hsl {
  const m = /^#?([0-9a-f]{6})/i.exec(hex)
  const n = m ? parseInt(m[1], 16) : 0x8b7bff
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (!d) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + 360) % 360
  return { h, s, l }
}

export interface IconPalette {
  bgTop: string
  bgBottom: string
  rim: [string, string, string]
  sheen: string
  glow: string
  chevronEnd: string
  dash: string
  dashGlow: string
}

/** Colors for the icon, derived from one accent. '#8b7bff' reproduces the app icon. */
export function iconPalette(color: string): IconPalette {
  const { h, s } = hexToHsl(color)
  // Greys keep a hint of their hue; saturated picks get the full treatment.
  const k = Math.min(1, s / 0.6)
  const hsl = (dh: number, sat: number, light: number): string =>
    `hsl(${Math.round((h + dh + 360) % 360)}, ${Math.round(sat * k)}%, ${light}%)`
  return {
    bgTop: hsl(-14, 40, 23),
    bgBottom: hsl(-18, 42, 8),
    rim: [hsl(-11, 100, 83), hsl(14, 100, 77), hsl(-33, 100, 68)],
    sheen: hsl(-14, 100, 77),
    glow: hsl(8, 100, 74),
    chevronEnd: hsl(0, 100, 88),
    dash: hsl(150, 92, 63),
    dashGlow: hsl(149, 91, 55)
  }
}

/** The icon as SVG markup. `uid` keeps gradient ids unique when several icons share a page. */
export function iconSvg(color: string, opts: { small?: boolean; uid?: string; size?: number } = {}): string {
  const p = iconPalette(color)
  const u = (opts.uid ?? 'li').replace(/[^a-zA-Z0-9_-]/g, '')
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : ''
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"${size}>`
  if (opts.small) {
    return (
      head +
      `<defs><linearGradient id="${u}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.bgTop}"/><stop offset="1" stop-color="${p.bgBottom}"/></linearGradient>` +
      `<linearGradient id="${u}rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.rim[0]}"/><stop offset="0.5" stop-color="${p.rim[1]}"/><stop offset="1" stop-color="${p.rim[2]}"/></linearGradient></defs>` +
      `<rect x="2" y="2" width="60" height="60" rx="14" fill="url(#${u}bg)"/>` +
      `<rect x="4" y="4" width="56" height="56" rx="12" fill="none" stroke="url(#${u}rim)" stroke-width="4"/>` +
      `<path d="M16 19l13 13-13 13" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="M34 45h14" stroke="${p.dash}" stroke-width="8" stroke-linecap="round"/></svg>`
    )
  }
  return (
    head +
    `<defs><linearGradient id="${u}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.bgTop}"/><stop offset="1" stop-color="${p.bgBottom}"/></linearGradient>` +
    `<linearGradient id="${u}rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.rim[0]}"/><stop offset="0.5" stop-color="${p.rim[1]}"/><stop offset="1" stop-color="${p.rim[2]}"/></linearGradient>` +
    `<linearGradient id="${u}chev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${p.chevronEnd}"/></linearGradient>` +
    `<radialGradient id="${u}sheen" cx="0.5" cy="0" r="0.75"><stop offset="0" stop-color="${p.sheen}" stop-opacity="0.35"/><stop offset="1" stop-color="${p.sheen}" stop-opacity="0"/></radialGradient>` +
    `<filter id="${u}glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter></defs>` +
    `<rect x="3" y="3" width="58" height="58" rx="16" fill="url(#${u}bg)"/>` +
    `<rect x="3" y="3" width="58" height="58" rx="16" fill="url(#${u}sheen)"/>` +
    `<rect x="4.25" y="4.25" width="55.5" height="55.5" rx="14.75" fill="none" stroke="url(#${u}rim)" stroke-width="2.5"/>` +
    `<g filter="url(#${u}glow)"><path d="M18 21.5l11.5 10.5L18 42.5" fill="none" stroke="${p.glow}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M34 43h12" stroke="${p.dashGlow}" stroke-width="6" stroke-linecap="round"/></g>` +
    `<path d="M18 21.5l11.5 10.5L18 42.5" fill="none" stroke="url(#${u}chev)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M34 43h12" stroke="${p.dash}" stroke-width="5.5" stroke-linecap="round"/></svg>`
  )
}

// Same split as scripts/icons.cjs: the simplified artwork stays legible at 24 px and below.
const SMALL_SIZES = [16, 20, 24]
const FULL_SIZES = [32, 40, 48, 64, 128, 256]

async function loadSvg(svg: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await img.decode()
  return img
}

/** Renders the recolored icon at every size a Windows .ico needs (PNG, base64). */
export async function renderIconImages(color: string): Promise<IconImages> {
  const [small, full] = await Promise.all([loadSvg(iconSvg(color, { small: true, size: 256 })), loadSvg(iconSvg(color, { size: 256 }))])
  const png = (img: HTMLImageElement, size: number): string => {
    const c = document.createElement('canvas')
    c.width = c.height = size
    const g = c.getContext('2d')!
    g.imageSmoothingQuality = 'high'
    g.drawImage(img, 0, 0, size, size)
    return c.toDataURL('image/png').split(',')[1]
  }
  return [...SMALL_SIZES.map((size) => ({ size, png: png(small, size) })), ...FULL_SIZES.map((size) => ({ size, png: png(full, size) }))]
}
