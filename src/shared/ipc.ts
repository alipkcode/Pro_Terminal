// IPC channel names. Invoke channels return a value, event channels are pushed from main.

export const IPC = {
  // sessions (invoke)
  sessionsList: 'sessions:list',
  sessionsCreate: 'sessions:create',
  sessionsAttach: 'sessions:attach',
  sessionsKill: 'sessions:kill',
  sessionsRestart: 'sessions:restart',
  sessionsSwitchShell: 'sessions:switch-shell',
  sessionsRename: 'sessions:rename',
  sessionsReorder: 'sessions:reorder',
  sessionsExec: 'sessions:exec',
  sessionsClearBuffer: 'sessions:clear-buffer',
  // sessions (send)
  sessionsWrite: 'sessions:write',
  sessionsResize: 'sessions:resize',
  sessionsAck: 'sessions:ack',
  // sessions (events)
  evData: 'ev:data',
  evSessionUpdated: 'ev:session-updated',
  evSessionRemoved: 'ev:session-removed',
  evSessionReset: 'ev:session-reset',

  // archive
  archiveList: 'archive:list',
  archiveLog: 'archive:log',
  archiveUpdate: 'archive:update',
  archiveDelete: 'archive:delete',
  archiveExport: 'archive:export',
  archiveSearch: 'archive:search',
  archiveStats: 'archive:stats',
  archiveCleanup: 'archive:cleanup',
  evArchiveChanged: 'ev:archive-changed',

  // library
  libraryGet: 'library:get',
  favoritesAdd: 'favorites:add',
  favoritesUpdate: 'favorites:update',
  favoritesRemove: 'favorites:remove',
  favoritesReorder: 'favorites:reorder',
  snippetsUpsert: 'snippets:upsert',
  snippetsRemove: 'snippets:remove',
  snippetsReorder: 'snippets:reorder',
  snippetsUsed: 'snippets:used',
  snippetGroupsReorder: 'snippet-groups:reorder',
  snippetGroupsSetCollapsed: 'snippet-groups:set-collapsed',
  tagsUpsert: 'tags:upsert',
  tagsRemove: 'tags:remove',
  recentRemove: 'recent:remove',
  recentClear: 'recent:clear',
  libraryExport: 'library:export',
  libraryImport: 'library:import',
  evLibraryChanged: 'ev:library-changed',

  // settings
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  evSettingsChanged: 'ev:settings-changed',

  // system
  appInfo: 'app:info',
  appQuit: 'app:quit',
  appOpenDataDir: 'app:open-data-dir',
  evQuitRequested: 'ev:quit-requested',
  dialogPickFolder: 'dialog:pick-folder',
  fsIsDirectory: 'fs:is-directory',
  shellOpenPath: 'shell:open-path',
  shellOpenExternal: 'shell:open-external',
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',
  windowSetChrome: 'window:set-chrome',
  windowToggleDevtools: 'window:toggle-devtools'
} as const
