// Regenerates the app icons and installer artwork from resources/icon.svg and resources/icon-small.svg.
// Run with: npm run icons   (uses Electron's Chromium to rasterize, so no extra tools are needed)
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const RES = join(__dirname, '..', 'resources')
// Sizes up to 24 px use the simplified artwork; it stays legible in the taskbar and Explorer lists.
const SMALL = [16, 20, 24]
const FULL = [32, 40, 48, 64, 128, 256]

const b64 = (file) => readFileSync(join(RES, file)).toString('base64')

function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const entries = []
  let offset = 6 + 16 * pngs.length
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

/** 24-bit bottom-up BMP, the format NSIS expects for installer images. */
function bmp(width, height, rgba) {
  const stride = Math.ceil((width * 3) / 4) * 4
  const size = 54 + stride * height
  const b = Buffer.alloc(size)
  b.write('BM', 0)
  b.writeUInt32LE(size, 2)
  b.writeUInt32LE(54, 10)
  b.writeUInt32LE(40, 14)
  b.writeInt32LE(width, 18)
  b.writeInt32LE(height, 22)
  b.writeUInt16LE(1, 26)
  b.writeUInt16LE(24, 28)
  b.writeUInt32LE(stride * height, 34)
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * stride
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      b[row + x * 3] = rgba[i + 2]
      b[row + x * 3 + 1] = rgba[i + 1]
      b[row + x * 3 + 2] = rgba[i]
    }
  }
  return b
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('data:text/html,<html></html>')
  const out = await win.webContents.executeJavaScript(`(async () => {
    const load = async (b64) => { const i = new Image(); i.src = 'data:image/svg+xml;base64,' + b64; await i.decode(); return i }
    const full = await load(${JSON.stringify(b64('icon.svg'))})
    const small = await load(${JSON.stringify(b64('icon-small.svg'))})
    const png = (img, s) => {
      const c = document.createElement('canvas'); c.width = c.height = s
      c.getContext('2d').drawImage(img, 0, 0, s, s)
      return c.toDataURL('image/png').split(',')[1]
    }
    const r = { small: {}, full: {} }
    for (const s of ${JSON.stringify(SMALL)}) r.small[s] = png(small, s)
    for (const s of ${JSON.stringify([...FULL, 512])}) r.full[s] = png(full, s)

    // Installer sidebar (welcome and finish pages): 164 x 314.
    const W = 164, H = 314
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const g = c.getContext('2d')
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#1b1f3e'); bg.addColorStop(1, '#0a0c16')
    g.fillStyle = bg; g.fillRect(0, 0, W, H)
    const glow = g.createRadialGradient(W / 2, 92, 4, W / 2, 92, 120)
    glow.addColorStop(0, 'rgba(155,123,255,0.42)'); glow.addColorStop(1, 'rgba(155,123,255,0)')
    g.fillStyle = glow; g.fillRect(0, 0, W, H)
    g.fillStyle = 'rgba(255,255,255,0.05)'
    for (let y = 10; y < H; y += 14) for (let x = 10; x < W; x += 14) g.fillRect(x, y, 1, 1)
    g.drawImage(full, (W - 84) / 2, 50, 84, 84)
    g.textAlign = 'center'
    g.fillStyle = '#ffffff'; g.font = '600 19px "Segoe UI Variable Display", "Segoe UI", sans-serif'
    g.fillText('Pro Terminal', W / 2, 168)
    g.fillStyle = '#a9b0d6'; g.font = '12px "Segoe UI", sans-serif'
    g.fillText('A workspace for', W / 2, 192)
    g.fillText('CMD and PowerShell', W / 2, 208)
    const line = g.createLinearGradient(40, 0, W - 40, 0)
    line.addColorStop(0, 'rgba(170,176,255,0)'); line.addColorStop(0.5, 'rgba(180,139,255,0.9)'); line.addColorStop(1, 'rgba(90,162,255,0)')
    g.fillStyle = line; g.fillRect(40, 226, W - 80, 1)
    r.sidebar = Array.from(g.getImageData(0, 0, W, H).data)
    return r
  })()`)

  const buf = (s) => Buffer.from(s, 'base64')
  writeFileSync(join(RES, 'icon.png'), buf(out.full[512]))
  writeFileSync(
    join(RES, 'icon.ico'),
    ico([...SMALL.map((size) => ({ size, data: buf(out.small[size]) })), ...FULL.map((size) => ({ size, data: buf(out.full[size]) }))])
  )
  writeFileSync(join(RES, 'installerSidebar.bmp'), bmp(164, 314, out.sidebar))
  console.log('icons: wrote icon.png, icon.ico (' + [...SMALL, ...FULL].join(', ') + ') and installerSidebar.bmp')
  app.quit()
})
