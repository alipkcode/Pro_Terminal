import { useState } from 'react'
import { AnimatePresence, motion, Reorder } from 'motion/react'
import { Clock, Copy, ExternalLink, Folder, FolderInput, FolderPlus, Pencil, Star, Trash2, X } from 'lucide-react'
import type { FavoriteFolder, RecentFolder } from '@shared/types'
import { api } from '@/api'
import { set, useActiveSession, useApp } from '@/store/app'
import { addFavorite, cdTo, pickAndAddFavorite, toast, toggleFavorite } from '@/lib/actions'
import { folderName, pathSegments, samePath, shortPath } from '@/lib/format'
import { CmdIcon, PsIcon } from '../icons'
import { PanelHeader, SectionLabel } from '../SidePanel'
import { showContextMenu } from '../ui/ContextMenu'

function folderMenu(path: string, fav?: FavoriteFolder) {
  return [
    { label: 'Go here in this session', run: () => void cdTo(path) },
    { label: 'Open in new CMD session', icon: <CmdIcon size={14} />, run: () => void cdTo(path, { newSession: true, shell: 'cmd' }) },
    { label: 'Open in new PowerShell session', icon: <PsIcon size={14} />, run: () => void cdTo(path, { newSession: true, shell: 'powershell' }) },
    { label: 'Open in Explorer', icon: <ExternalLink size={14} />, run: () => void api.system.openPath(path) },
    { label: 'Copy path', icon: <Copy size={14} />, run: () => void api.system.writeClipboard(path).then(() => toast('success', 'Path copied')) },
    { separator: true },
    ...(fav
      ? [
          { label: 'Edit…', icon: <Pencil size={14} />, run: () => set({ favoriteEditor: fav }) },
          { label: 'Remove from favorites', icon: <Trash2 size={14} />, danger: true, run: () => void toggleFavorite(fav.path) }
        ]
      : [{ label: 'Add to favorites', icon: <Star size={14} />, run: () => void addFavorite(path) }])
  ]
}

function FavoriteRow({ fav, current }: { fav: FavoriteFolder; current: boolean }) {
  return (
    <Reorder.Item
      value={fav.id}
      as="div"
      className={`folder-row ${current ? 'folder-row--current' : ''}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.15 } }}
      whileDrag={{ scale: 1.02, boxShadow: 'var(--shadow)' }}
      onClick={(e) => void cdTo(fav.path, { newSession: e.ctrlKey })}
      onContextMenu={(e) => showContextMenu(e, folderMenu(fav.path, fav))}
      data-tip={`${fav.path}\nClick to go here · Ctrl+click for a new session`}
    >
      <span className="folder-row__icon" style={{ ['--folder' as string]: fav.color ?? 'var(--accent)' }}>
        <Folder size={15} fill="currentColor" fillOpacity={0.18} />
      </span>
      <div className="folder-row__body">
        <span className="folder-row__name">{fav.name}</span>
        <span className="folder-row__path mono">{shortPath(fav.path, 38)}</span>
      </div>
      {current && <span className="folder-row__here">here</span>}
      <div className="folder-row__actions">
        <button
          className="icon-btn icon-btn--sm"
          onClick={(e) => {
            e.stopPropagation()
            void cdTo(fav.path, { newSession: true })
          }}
          data-tip="Open in a new session"
        >
          <FolderInput size={13} />
        </button>
        <button
          className="icon-btn icon-btn--sm"
          onClick={(e) => {
            e.stopPropagation()
            set({ favoriteEditor: fav })
          }}
          data-tip="Edit"
        >
          <Pencil size={12} />
        </button>
      </div>
    </Reorder.Item>
  )
}

function RecentFolderRow({ r, current }: { r: RecentFolder; current: boolean }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      className={`folder-row folder-row--recent ${current ? 'folder-row--current' : ''}`}
      onClick={(e) => void cdTo(r.path, { newSession: e.ctrlKey })}
      onContextMenu={(e) => showContextMenu(e, folderMenu(r.path))}
      data-tip={r.path}
    >
      <span className="folder-row__icon folder-row__icon--muted">
        <Clock size={14} />
      </span>
      <div className="folder-row__body">
        <span className="folder-row__name">{folderName(r.path)}</span>
        <span className="folder-row__path mono">{shortPath(r.path, 38)}</span>
      </div>
      <div className="folder-row__actions">
        <button
          className="icon-btn icon-btn--sm"
          onClick={(e) => {
            e.stopPropagation()
            void addFavorite(r.path)
          }}
          data-tip="Add to favorites"
        >
          <Star size={13} />
        </button>
        <button
          className="icon-btn icon-btn--sm"
          onClick={(e) => {
            e.stopPropagation()
            void api.library.removeRecent(r.path)
          }}
          data-tip="Remove from recents"
        >
          <X size={13} />
        </button>
      </div>
    </motion.div>
  )
}

export function FoldersPanel() {
  const favorites = useApp((s) => s.library.favorites)
  const recents = useApp((s) => s.library.recentFolders)
  const session = useActiveSession()
  const [dropping, setDropping] = useState(false)
  const cwd = session?.cwd ?? ''
  const isFav = !!cwd && favorites.some((f) => samePath(f.path, cwd))
  const recentList = recents.filter((r) => !favorites.some((f) => samePath(f.path, r.path))).slice(0, 10)
  const segs = pathSegments(cwd)

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDropping(false)
    let added = 0
    for (const file of Array.from(e.dataTransfer.files)) {
      const path = api.system.pathForFile(file)
      if (path && (await api.system.isDirectory(path))) {
        await api.library.addFavorite(path)
        added++
      }
    }
    if (added) toast('success', added === 1 ? 'Folder added to favorites' : `${added} folders added to favorites`)
    else toast('warning', 'Drop folders, not files', { message: 'Only folders can be added to favorites.' })
  }

  return (
    <div
      className={`panel ${dropping ? 'panel--dropping' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDropping(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false)
      }}
      onDrop={(e) => void onDrop(e)}
    >
      <PanelHeader title="Folders" subtitle="Jump without typing cd">
        <button className="icon-btn" onClick={() => void pickAndAddFavorite()} data-tip="Add a favorite folder">
          <FolderPlus size={16} />
        </button>
      </PanelHeader>

      <div className="panel__scroll">
        {session && (
          <div className="cwd-card">
            <div className="cwd-card__label">Current folder</div>
            <div className="cwd-card__crumbs">
              {segs.map((seg, i) => (
                <span key={seg.path} className="cwd-card__seg">
                  {i > 0 && <span className="cwd-card__slash">\</span>}
                  <button
                    className={`cwd-card__crumb ${i === segs.length - 1 ? 'cwd-card__crumb--last' : ''}`}
                    onClick={() => i < segs.length - 1 && void cdTo(seg.path)}
                    data-tip={i < segs.length - 1 ? `Go to ${seg.path}` : undefined}
                  >
                    {seg.label}
                  </button>
                </span>
              ))}
            </div>
            <div className="cwd-card__actions">
              <button className={`btn btn--sm ${isFav ? 'btn--fav-on' : ''}`} onClick={() => void toggleFavorite(cwd)}>
                <Star size={13} fill={isFav ? 'currentColor' : 'none'} />
                {isFav ? 'Favorite' : 'Add to favorites'}
              </button>
              <button className="icon-btn icon-btn--sm" onClick={() => void api.system.openPath(cwd)} data-tip="Open in Explorer">
                <ExternalLink size={13} />
              </button>
              <button
                className="icon-btn icon-btn--sm"
                onClick={() => void api.system.writeClipboard(cwd).then(() => toast('success', 'Path copied'))}
                data-tip="Copy path"
              >
                <Copy size={13} />
              </button>
            </div>
          </div>
        )}

        <SectionLabel>Favorites</SectionLabel>
        {favorites.length === 0 ? (
          <button className="drop-hint" onClick={() => void pickAndAddFavorite()}>
            <FolderPlus size={20} />
            <span className="drop-hint__title">Add your favorite folders</span>
            <span className="drop-hint__text">Click to browse, use ★ on the current folder, or drag folders here from Explorer.</span>
          </button>
        ) : (
          <Reorder.Group axis="y" values={favorites.map((f) => f.id)} onReorder={(ids) => void reorderFavorites(ids)} as="div" className="folder-list">
            <AnimatePresence initial={false}>
              {favorites.map((f) => (
                <FavoriteRow key={f.id} fav={f} current={samePath(f.path, cwd)} />
              ))}
            </AnimatePresence>
          </Reorder.Group>
        )}

        {recentList.length > 0 && (
          <>
            <SectionLabel
              action={
                <button className="link-btn" onClick={() => void api.library.clearRecent()}>
                  Clear
                </button>
              }
            >
              Recent
            </SectionLabel>
            <div className="folder-list">
              <AnimatePresence initial={false}>
                {recentList.map((r) => (
                  <RecentFolderRow key={r.path} r={r} current={samePath(r.path, cwd)} />
                ))}
              </AnimatePresence>
            </div>
          </>
        )}
      </div>

      <AnimatePresence>
        {dropping && (
          <motion.div className="drop-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <FolderPlus size={28} />
            <span>Drop to add to favorites</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function reorderFavorites(ids: string[]): Promise<void> {
  const lib = useApp.getState().library
  const byId = new Map(lib.favorites.map((f) => [f.id, f]))
  set({ library: { ...lib, favorites: ids.map((id) => byId.get(id)!).filter(Boolean) } })
  return api.library.reorderFavorites(ids)
}
