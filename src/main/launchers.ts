import { app, shell } from 'electron'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IconImages, Launcher } from '@shared/types'
import { detectShells, resolveShell } from './pty/shells'
import type { SettingsStore } from './store/settings'
import { pathKey } from './store/util'

// ---------------------------------------------------------------------------------------------
// Command line: desktop shortcuts start Pro Terminal with --launcher=<id>. A second start while the
// app runs hands its arguments to this instance (second-instance), so both paths end up queued here
// and the renderer takes them once it is ready.
// ---------------------------------------------------------------------------------------------

const ARG = '--launcher='
const ID_RE = /^[0-9a-f-]{36}$/i
let queue: string[] = []

export function queueLaunchersFromArgv(argv: readonly string[]): boolean {
  let added = false
  for (const a of argv) {
    if (!a.startsWith(ARG)) continue
    const id = a.slice(ARG.length).replace(/"/g, '')
    if (ID_RE.test(id)) {
      queue.push(id)
      added = true
    }
  }
  return added
}

export function takePendingLaunchers(): string[] {
  const out = [...new Set(queue)]
  queue = []
  return out
}

// ---------------------------------------------------------------------------------------------
// Desktop shortcuts
// ---------------------------------------------------------------------------------------------

const safeFileName = (s: string): string =>
  s
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 80) || 'Shortcut'

/** Builds an .ico file out of PNG images (PNG-compressed entries, supported since Windows Vista). */
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries: Buffer[] = []
  let offset = 6 + 16 * images.length
  for (const { size, data } of images) {
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
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47])

function iconImages(raw: unknown): { size: number; data: Buffer }[] {
  if (!Array.isArray(raw)) return []
  const out: { size: number; data: Buffer }[] = []
  for (const it of raw.slice(0, 12)) {
    const size = typeof it?.size === 'number' ? Math.round(it.size) : 0
    if (size < 16 || size > 256 || typeof it?.png !== 'string' || it.png.length > 2_000_000) continue
    const data = Buffer.from(it.png, 'base64')
    if (data.subarray(0, 4).equals(PNG_SIGNATURE)) out.push({ size, data })
  }
  return out.sort((a, b) => a.size - b.size)
}

export class LauncherFiles {
  private readonly dir: string

  constructor(
    dataDir: string,
    private readonly settings: SettingsStore
  ) {
    this.dir = join(dataDir, 'launchers')
  }

  private ensureDir(): void {
    mkdirSync(this.dir, { recursive: true })
  }

  /** Removes the icon and script files kept for a shortcut. */
  removeFiles(id: string): void {
    if (!existsSync(this.dir)) return
    for (const f of readdirSync(this.dir)) {
      if (f.startsWith(id)) rmSync(join(this.dir, f), { force: true })
    }
  }

  private removeScripts(id: string): void {
    for (const f of readdirSync(this.dir)) {
      if (f.startsWith(id) && (f.endsWith('.cmd') || f.endsWith('.ps1'))) rmSync(join(this.dir, f), { force: true })
    }
  }

  /** Writes the icon under a new name each time: Explorer caches icons by path. */
  private writeIcon(l: Launcher, images: { size: number; data: Buffer }[]): string {
    for (const f of readdirSync(this.dir)) {
      if (f.startsWith(l.id) && f.endsWith('.ico')) rmSync(join(this.dir, f), { force: true })
    }
    const file = join(this.dir, `${l.id}-${Date.now().toString(36)}.ico`)
    writeFileSync(file, ico(images))
    return file
  }

  /** The shell, arguments and working folder for a shortcut that opens a classic console window. */
  private classicTarget(l: Launcher): { target: string; args: string } {
    const shells = detectShells()
    const exact = shells.find((s) => s.id === l.shell && s.available)
    const sh = exact ?? resolveShell(l.shell === 'cmd' ? 'cmd' : 'powershell', this.settings.get())
    if (sh.family === 'cmd') {
      const file = join(this.dir, `${l.id}.cmd`)
      const body = [
        '@echo off',
        'chcp 65001 >nul',
        `title ${l.name.replace(/[&|<>^%\r\n]/g, '')}`,
        `cd /d "${l.folder.replace(/"/g, '')}"`,
        ...(l.script.trim() ? ['@echo on', ...l.script.replace(/\r\n?/g, '\n').split('\n')] : [])
      ]
      writeFileSync(file, body.join('\r\n') + '\r\n', 'utf8')
      return { target: sh.path, args: `/K "${file}"` }
    }
    const file = join(this.dir, `${l.id}.ps1`)
    const q = (s: string): string => `'${s.replace(/'/g, "''")}'`
    const body = [`$Host.UI.RawUI.WindowTitle = ${q(l.name)}`, `Set-Location -LiteralPath ${q(l.folder)}`, ...(l.script.trim() ? [l.script] : [])]
    // UTF-8 with a BOM, so Windows PowerShell 5.1 does not read it as ANSI.
    writeFileSync(file, '﻿' + body.join('\r\n') + '\r\n', 'utf8')
    return { target: sh.path, args: `-NoLogo -NoExit -ExecutionPolicy Bypass -File "${file}"` }
  }

  /** The executable and arguments that start this app with a shortcut id. */
  private appTarget(l: Launcher): { target: string; args: string } {
    // Unpackaged (development) runs need the app folder as Electron's first argument.
    const prefix = app.isPackaged ? '' : `"${app.getAppPath()}" `
    return { target: process.execPath, args: `${prefix}${ARG}${l.id}` }
  }

  /** A desktop path for the shortcut that does not overwrite somebody else's file. */
  private linkPath(l: Launcher): string {
    const desktop = app.getPath('desktop')
    const base = safeFileName(l.name)
    for (let i = 1; i < 100; i++) {
      const candidate = join(desktop, `${base}${i > 1 ? ` (${i})` : ''}.lnk`)
      if (!existsSync(candidate) || (l.desktopLink && pathKey(candidate) === pathKey(l.desktopLink))) return candidate
    }
    return join(desktop, `${base} ${Date.now().toString(36)}.lnk`)
  }

  /** Creates or refreshes the desktop shortcut. Returns the .lnk path. */
  writeDesktop(l: Launcher, rawImages: IconImages): string {
    const images = iconImages(rawImages)
    if (!images.length) throw new Error('The shortcut icon could not be prepared.')
    this.ensureDir()
    const icon = this.writeIcon(l, images)
    this.removeScripts(l.id)
    const { target, args } = l.target === 'window' ? this.classicTarget(l) : this.appTarget(l)
    const path = this.linkPath(l)
    // Renamed shortcut: the old file goes, the new one takes its place.
    if (l.desktopLink && pathKey(l.desktopLink) !== pathKey(path)) rmSync(l.desktopLink, { force: true })
    const ok = shell.writeShortcutLink(path, existsSync(path) ? 'replace' : 'create', {
      target,
      args,
      cwd: l.folder,
      icon,
      iconIndex: 0,
      description: `${l.name} · Pro Terminal shortcut`
    })
    if (!ok) throw new Error('Windows refused to create the shortcut file.')
    return path
  }

  removeDesktop(l: Launcher): void {
    if (l.desktopLink && l.desktopLink.toLowerCase().endsWith('.lnk')) rmSync(l.desktopLink, { force: true })
    this.removeFiles(l.id)
  }
}
