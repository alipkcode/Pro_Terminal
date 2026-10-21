import { join } from 'node:path'
import { DEFAULT_SETTINGS, LIMITS } from '@shared/defaults'
import type { GroupStartState, Settings } from '@shared/types'
import { JsonFile } from './jsonFile'
import { bool, isObject, num, oneOf, str } from './util'

const GROUP_STATES = ['expanded', 'collapsed', 'remember'] as const

function groupStates(v: unknown): Record<string, GroupStartState> {
  const out: Record<string, GroupStartState> = {}
  if (!isObject(v)) return out
  for (const [k, state] of Object.entries(v).slice(0, LIMITS.snippetGroups)) {
    const name = k.slice(0, LIMITS.groupNameLength).trim()
    if (name && (GROUP_STATES as readonly unknown[]).includes(state)) out[name] = state as GroupStartState
  }
  return out
}

function normalize(raw: unknown): Settings {
  const r = isObject(raw) ? raw : {}
  const d = DEFAULT_SETTINGS
  return {
    defaultShell: oneOf(r.defaultShell, ['cmd', 'powershell'] as const, d.defaultShell),
    powershellEdition: oneOf(r.powershellEdition, ['powershell', 'pwsh'] as const, d.powershellEdition),
    startDirectory: oneOf(r.startDirectory, ['home', 'last', 'custom'] as const, d.startDirectory),
    customStartDirectory: str(r.customStartDirectory, d.customStartDirectory, 1024),
    restoreSessions: bool(r.restoreSessions, d.restoreSessions),
    closeOnExit: oneOf(r.closeOnExit, ['clean', 'always', 'never'] as const, d.closeOnExit),
    confirmCloseRunning: bool(r.confirmCloseRunning, d.confirmCloseRunning),
    appTheme: oneOf(r.appTheme, ['dark', 'light', 'system'] as const, d.appTheme),
    terminalTheme: str(r.terminalTheme, d.terminalTheme, 64),
    windowMaterial: oneOf(r.windowMaterial, ['none', 'mica', 'acrylic'] as const, d.windowMaterial),
    fontFamily: str(r.fontFamily, d.fontFamily, 256) || d.fontFamily,
    fontSize: num(r.fontSize, d.fontSize, 8, 32),
    lineHeight: num(r.lineHeight, d.lineHeight, 1, 2),
    letterSpacing: num(r.letterSpacing, d.letterSpacing, -2, 6),
    cursorStyle: oneOf(r.cursorStyle, ['block', 'bar', 'underline'] as const, d.cursorStyle),
    cursorBlink: bool(r.cursorBlink, d.cursorBlink),
    scrollback: Math.round(num(r.scrollback, d.scrollback, 500, 100000)),
    copyOnSelect: bool(r.copyOnSelect, d.copyOnSelect),
    rightClick: oneOf(r.rightClick, ['menu', 'copyPaste'] as const, d.rightClick),
    pasteWarning: bool(r.pasteWarning, d.pasteWarning),
    bell: oneOf(r.bell, ['none', 'visual', 'sound'] as const, d.bell),
    gpuAcceleration: bool(r.gpuAcceleration, d.gpuAcceleration),
    shellIntegration: bool(r.shellIntegration, d.shellIntegration),
    useBundledConpty: bool(r.useBundledConpty, d.useBundledConpty),
    archiveRetentionDays: Math.round(num(r.archiveRetentionDays, d.archiveRetentionDays, 0, 3650)),
    snippetGroupDefault: oneOf(r.snippetGroupDefault, GROUP_STATES, d.snippetGroupDefault),
    snippetGroupStates: groupStates(r.snippetGroupStates),
    lastCwd: str(r.lastCwd, d.lastCwd, 1024)
  }
}

export class SettingsStore {
  private file: JsonFile<Settings>
  private listeners = new Set<(s: Settings) => void>()

  constructor(dataDir: string) {
    this.file = new JsonFile(join(dataDir, 'settings.json'), DEFAULT_SETTINGS, normalize)
  }

  get(): Settings {
    return this.file.data
  }

  set(patch: Partial<Settings>): Settings {
    this.file.data = normalize({ ...this.file.data, ...(isObject(patch) ? patch : {}) })
    this.file.save()
    for (const l of this.listeners) l(this.file.data)
    return this.file.data
  }

  /** Update without notifying listeners (for bookkeeping values like lastCwd). */
  setQuiet(patch: Partial<Settings>): void {
    this.file.data = normalize({ ...this.file.data, ...patch })
    this.file.save()
  }

  onChange(l: (s: Settings) => void): void {
    this.listeners.add(l)
  }

  flush(): void {
    this.file.flush()
  }
}
