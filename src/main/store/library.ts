import { join, basename } from 'node:path'
import { ACTION_PRESET_GROUP, ACTION_PRESET_PACK, ACTION_PRESETS } from '@shared/actionPresets'
import { DEFAULT_LIBRARY, LAUNCHER_MOODS, LIMITS } from '@shared/defaults'
import type { FavoriteFolder, Launcher, Library, RecentFolder, Snippet, TagDef } from '@shared/types'
import { JsonFile } from './jsonFile'
import { arr, groupNames, isObject, newId, num, oneOf, pathKey, str } from './util'

const COLOR_RE = /^#[0-9a-f]{6}$/i
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const color = (v: unknown): string | undefined => (typeof v === 'string' && COLOR_RE.test(v) ? v : undefined)

function normFavorite(v: unknown): FavoriteFolder | null {
  if (!isObject(v)) return null
  const path = str(v.path, '', 1024)
  if (!path) return null
  return {
    id: str(v.id) || newId(),
    path,
    name: str(v.name, '', LIMITS.nameLength) || folderName(path),
    color: color(v.color),
    createdAt: num(v.createdAt, Date.now())
  }
}

function normSnippet(v: unknown): Snippet | null {
  if (!isObject(v)) return null
  const command = str(v.command, '', LIMITS.snippetCommandLength)
  const name = str(v.name, '', LIMITS.nameLength).trim()
  if (!command.trim() || !name) return null
  const now = Date.now()
  return {
    id: str(v.id) || newId(),
    name,
    command,
    description: str(v.description, '', 500) || undefined,
    shell: oneOf(v.shell, ['any', 'cmd', 'powershell'] as const, 'any'),
    mode: oneOf(v.mode, ['run', 'insert', 'copy'] as const, 'run'),
    group: str(v.group, '', LIMITS.groupNameLength).trim() || undefined,
    createdAt: num(v.createdAt, now),
    updatedAt: num(v.updatedAt, now),
    uses: Math.max(0, Math.round(num(v.uses, 0))),
    lastUsedAt: typeof v.lastUsedAt === 'number' ? v.lastUsedAt : undefined
  }
}

function normLauncher(v: unknown): Launcher | null {
  if (!isObject(v)) return null
  // Saved before folder actions existed: a shortcut.
  const kind = oneOf(v.kind, ['shortcut', 'action'] as const, 'shortcut')
  const action = kind === 'action'
  const folder = action ? '' : str(v.folder, '', 1024).trim()
  const script = str(v.script, '', LIMITS.snippetCommandLength).replace(/\s+$/, '')
  // A shortcut needs a folder to open; a folder action brings no folder, but needs something to run.
  if (action ? !script.trim() : !folder) return null
  const now = Date.now()
  const id = str(v.id)
  return {
    // Desktop shortcuts pass the id on the command line, and its files are named after it: keep it a UUID.
    id: UUID_RE.test(id) ? id : newId(),
    kind,
    name: str(v.name, '', LIMITS.nameLength).trim() || (action ? 'Folder action' : folderName(folder)),
    description: str(v.description, '', LIMITS.descriptionLength).trim(),
    color: color(v.color) ?? LAUNCHER_MOODS[0].color,
    folder,
    shell: oneOf(v.shell, ['cmd', 'powershell', 'pwsh'] as const, 'powershell'),
    script,
    // Folder actions always run their script, in whatever folder they are opened from.
    mode: action ? 'run' : oneOf(v.mode, ['run', 'insert'] as const, 'run'),
    target: action ? 'app' : oneOf(v.target, ['app', 'window'] as const, 'app'),
    recursive: action && v.recursive === true,
    pinned: action ? false : typeof v.pinned === 'boolean' ? v.pinned : true,
    desktopLink: str(v.desktopLink, '', 1024) || undefined,
    createdAt: num(v.createdAt, now),
    updatedAt: num(v.updatedAt, now),
    uses: Math.max(0, Math.round(num(v.uses, 0))),
    lastUsedAt: typeof v.lastUsedAt === 'number' ? v.lastUsedAt : undefined
  }
}

function normTag(v: unknown): TagDef | null {
  if (!isObject(v)) return null
  const name = normTagName(v.name)
  if (!name) return null
  return { name, color: color(v.color) ?? '#94a3b8' }
}

export const normTagName = (v: unknown): string =>
  str(v, '', 40)
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()

function normRecent(v: unknown): RecentFolder | null {
  if (!isObject(v)) return null
  const path = str(v.path, '', 1024)
  if (!path) return null
  return { path, lastUsedAt: num(v.lastUsedAt, 0), count: Math.max(1, Math.round(num(v.count, 1))) }
}

function dedupeBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((t) => {
    const k = key(t)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function normalize(raw: unknown): Library {
  const r = isObject(raw) ? raw : {}
  const vars: Record<string, string> = {}
  if (isObject(r.snippetVars)) {
    for (const [k, v] of Object.entries(r.snippetVars).slice(0, 500)) {
      if (typeof v === 'string') vars[k.slice(0, 60)] = v.slice(0, 1000)
    }
  }
  return {
    favorites: dedupeBy(
      arr(r.favorites).map(normFavorite).filter((f): f is FavoriteFolder => !!f),
      (f) => f.id
    ),
    snippets: dedupeBy(
      arr(r.snippets).map(normSnippet).filter((s): s is Snippet => !!s),
      (s) => s.id
    ),
    launchers: dedupeBy(
      arr(r.launchers).map(normLauncher).filter((l): l is Launcher => !!l),
      (l) => l.id
    ).slice(0, LIMITS.launchers),
    tags: dedupeBy(
      arr(r.tags).map(normTag).filter((t): t is TagDef => !!t),
      (t) => t.name
    ),
    recentFolders: dedupeBy(
      arr(r.recentFolders).map(normRecent).filter((x): x is RecentFolder => !!x),
      (x) => pathKey(x.path)
    ).slice(0, LIMITS.recentFolders),
    snippetVars: vars,
    snippetGroupOrder: groupNames(r.snippetGroupOrder, LIMITS.groupNameLength, LIMITS.snippetGroups),
    snippetGroupsCollapsed: groupNames(r.snippetGroupsCollapsed, LIMITS.groupNameLength, LIMITS.snippetGroups),
    seededPacks: groupNames(r.seededPacks, 60, 50)
  }
}

export function folderName(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  return basename(trimmed) || trimmed || p
}

export class LibraryStore {
  private file: JsonFile<Library>
  private listeners = new Set<(lib: Library) => void>()

  constructor(dataDir: string) {
    this.file = new JsonFile(join(dataDir, 'library.json'), DEFAULT_LIBRARY, normalize)
    this.seedActionPresets()
  }

  /** Adds the folder-action scripts to the snippets once; presets the user deletes stay deleted. */
  private seedActionPresets(): void {
    if (this.data.seededPacks.includes(ACTION_PRESET_PACK)) return
    const now = Date.now()
    for (const p of ACTION_PRESETS) {
      if (this.data.snippets.some((s) => s.name === p.name)) continue
      this.data.snippets.push({
        id: newId(),
        name: p.name,
        command: p.script,
        description: p.description,
        shell: p.shell,
        mode: 'run',
        group: ACTION_PRESET_GROUP,
        createdAt: now,
        updatedAt: now,
        uses: 0
      })
    }
    this.data.seededPacks.push(ACTION_PRESET_PACK)
    this.file.save()
  }

  get data(): Library {
    return this.file.data
  }

  onChange(l: (lib: Library) => void): void {
    this.listeners.add(l)
  }

  private commit(): void {
    this.file.save()
    for (const l of this.listeners) l(this.file.data)
  }

  // ---- favorites ----

  addFavorite(path: string, name?: string, col?: string): FavoriteFolder {
    const key = pathKey(path)
    const existing = this.data.favorites.find((f) => pathKey(f.path) === key)
    if (existing) return existing
    const fav: FavoriteFolder = {
      id: newId(),
      path,
      name: (name ?? '').trim().slice(0, LIMITS.nameLength) || folderName(path),
      color: color(col),
      createdAt: Date.now()
    }
    this.data.favorites.push(fav)
    this.commit()
    return fav
  }

  updateFavorite(id: string, patch: Partial<Pick<FavoriteFolder, 'name' | 'color' | 'path'>>): void {
    const fav = this.data.favorites.find((f) => f.id === id)
    if (!fav) return
    if (typeof patch.name === 'string') fav.name = patch.name.trim().slice(0, LIMITS.nameLength) || folderName(fav.path)
    if ('color' in patch) fav.color = color(patch.color)
    if (typeof patch.path === 'string' && patch.path) fav.path = patch.path.slice(0, 1024)
    this.commit()
  }

  removeFavorite(id: string): void {
    this.data.favorites = this.data.favorites.filter((f) => f.id !== id)
    this.commit()
  }

  reorderFavorites(ids: string[]): void {
    this.data.favorites = reorder(this.data.favorites, ids)
    this.commit()
  }

  // ---- snippets ----

  upsertSnippet(input: Partial<Snippet>): Snippet | null {
    const existing = input.id ? this.data.snippets.find((s) => s.id === input.id) : undefined
    const merged = normSnippet({ ...(existing ?? {}), ...input, updatedAt: Date.now() })
    if (!merged) return null
    if (existing) Object.assign(existing, merged)
    else this.data.snippets.push(merged)
    this.commit()
    return existing ?? merged
  }

  removeSnippet(id: string): void {
    this.data.snippets = this.data.snippets.filter((s) => s.id !== id)
    this.commit()
  }

  reorderSnippets(ids: string[]): void {
    this.data.snippets = reorder(this.data.snippets, ids)
    this.commit()
  }

  /** Put the given groups first, in this order; groups not mentioned keep their relative order after them. */
  reorderSnippetGroups(names: string[]): void {
    const given = groupNames(names, LIMITS.groupNameLength, LIMITS.snippetGroups)
    const rest = this.data.snippetGroupOrder.filter((g) => !given.includes(g))
    this.data.snippetGroupOrder = [...given, ...rest].slice(0, LIMITS.snippetGroups)
    this.commit()
  }

  setSnippetGroupCollapsed(name: string, collapsed: boolean): void {
    const g = str(name, '', LIMITS.groupNameLength).trim()
    if (!g) return
    const has = this.data.snippetGroupsCollapsed.includes(g)
    if (has === !!collapsed) return
    this.data.snippetGroupsCollapsed = collapsed
      ? [...this.data.snippetGroupsCollapsed, g].slice(-LIMITS.snippetGroups)
      : this.data.snippetGroupsCollapsed.filter((x) => x !== g)
    this.commit()
  }

  snippetUsed(id: string, vars: Record<string, string>): void {
    const s = this.data.snippets.find((x) => x.id === id)
    if (s) {
      s.uses += 1
      s.lastUsedAt = Date.now()
    }
    if (isObject(vars)) {
      for (const [k, v] of Object.entries(vars)) {
        if (typeof v === 'string') this.data.snippetVars[k.slice(0, 60)] = v.slice(0, 1000)
      }
    }
    this.commit()
  }

  // ---- launchers (title bar shortcuts) ----

  getLauncher(id: string): Launcher | undefined {
    return this.data.launchers.find((l) => l.id === id)
  }

  upsertLauncher(input: Partial<Launcher>): Launcher | null {
    const existing = input.id ? this.getLauncher(input.id) : undefined
    if (!existing && this.data.launchers.length >= LIMITS.launchers) return null
    // The desktop link is only ever set by the main process (see setLauncherDesktopLink).
    const { desktopLink: _ignored, ...patch } = input
    const merged = normLauncher({ ...(existing ?? {}), ...patch, desktopLink: existing?.desktopLink, updatedAt: Date.now() })
    if (!merged) return null
    if (existing) Object.assign(existing, merged)
    else this.data.launchers.push(merged)
    this.commit()
    return existing ?? merged
  }

  removeLauncher(id: string): void {
    this.data.launchers = this.data.launchers.filter((l) => l.id !== id)
    this.commit()
  }

  reorderLaunchers(ids: string[]): void {
    this.data.launchers = reorder(this.data.launchers, ids)
    this.commit()
  }

  launcherUsed(id: string): void {
    const l = this.getLauncher(id)
    if (!l) return
    l.uses += 1
    l.lastUsedAt = Date.now()
    this.commit()
  }

  setLauncherDesktopLink(id: string, path: string | undefined): void {
    const l = this.getLauncher(id)
    if (!l || l.desktopLink === path) return
    l.desktopLink = path
    this.commit()
  }

  // ---- tags ----

  upsertTag(tag: TagDef, previousName?: string): { renamedFrom?: string; name: string } | null {
    const t = normTag(tag)
    if (!t) return null
    const prev = previousName ? normTagName(previousName) : undefined
    const idx = this.data.tags.findIndex((x) => x.name === (prev ?? t.name))
    if (idx >= 0) {
      // Renaming onto an existing tag merges the two.
      const clash = prev && prev !== t.name ? this.data.tags.findIndex((x) => x.name === t.name) : -1
      if (clash >= 0) this.data.tags.splice(clash, 1)
      const target = this.data.tags.findIndex((x) => x.name === (prev ?? t.name))
      this.data.tags[target] = t
    } else {
      this.data.tags.push(t)
    }
    this.commit()
    return { renamedFrom: prev && prev !== t.name ? prev : undefined, name: t.name }
  }

  ensureTags(names: string[]): void {
    let changed = false
    for (const name of names) {
      if (!this.data.tags.some((t) => t.name === name)) {
        this.data.tags.push({ name, color: '#94a3b8' })
        changed = true
      }
    }
    if (changed) this.commit()
  }

  removeTag(name: string): void {
    this.data.tags = this.data.tags.filter((t) => t.name !== normTagName(name))
    this.commit()
  }

  // ---- recent folders ----

  touchRecent(path: string): void {
    if (!path) return
    const key = pathKey(path)
    const list = this.data.recentFolders
    const idx = list.findIndex((r) => pathKey(r.path) === key)
    const now = Date.now()
    if (idx === 0) {
      list[0].lastUsedAt = now
      list[0].count += 1
      this.file.save() // ordering unchanged; skip broadcasting
      return
    }
    const entry: RecentFolder = idx >= 0 ? { ...list[idx], path, lastUsedAt: now, count: list[idx].count + 1 } : { path, lastUsedAt: now, count: 1 }
    if (idx >= 0) list.splice(idx, 1)
    list.unshift(entry)
    this.data.recentFolders = list.slice(0, LIMITS.recentFolders)
    this.commit()
  }

  removeRecent(path: string): void {
    const key = pathKey(path)
    this.data.recentFolders = this.data.recentFolders.filter((r) => pathKey(r.path) !== key)
    this.commit()
  }

  clearRecent(): void {
    this.data.recentFolders = []
    this.commit()
  }

  // ---- import / export ----

  exportData(): object {
    const { favorites, snippets, tags, snippetGroupOrder } = this.data
    // Desktop shortcut files belong to this PC, so they are not exported.
    const launchers = this.data.launchers.map(({ desktopLink: _local, ...l }) => l)
    return { app: 'pro-terminal', version: 1, exportedAt: new Date().toISOString(), favorites, snippets, launchers, tags, snippetGroupOrder }
  }

  importData(raw: unknown): { favorites: number; snippets: number; launchers: number } {
    const incoming = normalize(raw)
    let favs = 0
    let snips = 0
    let launchers = 0
    for (const f of incoming.favorites) {
      if (!this.data.favorites.some((x) => pathKey(x.path) === pathKey(f.path))) {
        this.data.favorites.push({ ...f, id: newId() })
        favs++
      }
    }
    for (const s of incoming.snippets) {
      if (!this.data.snippets.some((x) => x.name === s.name && x.command === s.command)) {
        this.data.snippets.push({ ...s, id: newId(), uses: 0, lastUsedAt: undefined })
        snips++
      }
    }
    for (const l of incoming.launchers) {
      if (this.data.launchers.length >= LIMITS.launchers) break
      if (!this.data.launchers.some((x) => x.name === l.name && pathKey(x.folder) === pathKey(l.folder) && x.script === l.script)) {
        this.data.launchers.push({ ...l, id: newId(), desktopLink: undefined, uses: 0, lastUsedAt: undefined })
        launchers++
      }
    }
    for (const t of incoming.tags) {
      if (!this.data.tags.some((x) => x.name === t.name)) this.data.tags.push(t)
    }
    // Imported groups we have not arranged yet go after ours, in the exported order.
    for (const g of incoming.snippetGroupOrder) {
      if (!this.data.snippetGroupOrder.includes(g) && this.data.snippetGroupOrder.length < LIMITS.snippetGroups) this.data.snippetGroupOrder.push(g)
    }
    this.commit()
    return { favorites: favs, snippets: snips, launchers }
  }

  flush(): void {
    this.file.flush()
  }
}

function reorder<T extends { id: string }>(items: T[], ids: string[]): T[] {
  if (!Array.isArray(ids)) return items
  const byId = new Map(items.map((i) => [i.id, i]))
  const out: T[] = []
  for (const id of ids) {
    const it = byId.get(id)
    if (it) {
      out.push(it)
      byId.delete(id)
    }
  }
  return [...out, ...byId.values()]
}
