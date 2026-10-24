# Changelog

All notable changes to Pro Terminal are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Shortcuts.** Save a folder, a shell (CMD, Windows PowerShell or PowerShell 7) and an optional script as a
  one-click shortcut. Choose whether it runs the script or only types it, and give it a name and a color mood.
  - Pinned shortcuts sit in the title bar next to the panel buttons, and the ⚡ menu lists all of them.
  - A three-step wizard shows a live preview of the desktop icon and of what will be typed.
  - The shortcuts manager (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>) reorders, pins, edits and duplicates them.
- **Desktop shortcuts.** Any shortcut can be added to the Windows desktop with the app icon recolored in its own mood.
  It opens as a tab in Pro Terminal (starting the app, or reusing the open window), or as a classic console window
  that works without Pro Terminal.
- Shortcuts appear in the command palette and are included in library export and import.
- **Folder actions.** Save a script as a small program file (an `.exe` with its own colored icon) that runs in the
  folder it's opened from — for example "remove the dashes from every name". Drop it into any folder and open it there.
  - It always asks first, showing the name, the description, the folder, the scope, the shell and the full script.
    Extra warnings appear for the top of a drive, for files made in another Pro Terminal, and for outdated files.
  - Choose *this folder only* or *every subfolder*. Subfolders are listed first, then processed one by one, deepest
    first, so renaming a folder never breaks the paths still to come. Hidden and system folders are skipped, and the
    file never touches itself.
  - It opens in Pro Terminal when installed. Otherwise it confirms in a message box and runs in the default terminal
    (Windows Terminal or a console window), in CMD or PowerShell as chosen.
  - A three-step wizard with presets, scope previews and every color mood. Folder actions are listed in the shortcuts
    manager (not in the title bar), where *Run…* picks a folder and confirms before running.
- **17 ready-made folder scripts** under *Snippets › Folder actions*: remove dashes or dots from names (extensions
  are kept), dots or underscores to spaces, tidy spaces, find and replace, prefix or suffix, Title Case, lowercase
  extensions, sort files into folders by type, delete empty folders or junk files, extract every zip, `git pull`
  or `git status` in every repository, and save or copy a list of the contents.

### Changed
- The keyboard-shortcuts section in Settings is now called *Keyboard*, so it isn't confused with the new shortcuts.

## [1.2.0] - 2026-10-21

The first public release. It includes everything from the development versions below, which were never published separately.

### Added
- **Drag to reorder snippet groups.** Drag a group header by its grip, or press <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> on a focused header.
- **Start state for snippet groups.** In *Settings › Saved commands*, choose whether groups start
  *Expanded*, *Collapsed* or *Remember last*. Set it as a default, which also applies to new groups, or per group.
- Group header context menu: expand or collapse all, move to the top or bottom, set the start state, and open group settings.
- Settings button in the Snippets panel header.
- Library export and import now include the group order.

### Changed
- A group's open or closed state now survives switching panels.
- While filtering, groups with matches open automatically, and group dragging pauses.

## 1.1.1 - 2026-10-21

### Fixed
- Typing in a dialog field (for example *Group* or *Command* in the snippet editor, or a snippet
  variable prompt) no longer jumps focus back to the first field.

## 1.1.0 - 2026-10-21

### Added
- **Windows installer** (NSIS): per-user install with no admin rights, a choice of folder, Desktop and
  Start menu shortcuts, and an uninstaller that keeps your data.
- **New logo** and branded installer art.
- **Start-up health check** splash on every launch. It checks Windows/ConPTY support, the app files, the
  data folder, the settings, library and sessions files (with recovery and backup), node-pty, the
  installed shells, a real ConPTY test shell, disk space, and unclean exits. When a check fails, it
  offers *Try again*, *Open data folder* and *Copy report*.
- First-run setup screen, and version tracking for future migrations.

## 1.0.0 - 2026-10-21

### Added
- Real CMD, Windows PowerShell and PowerShell 7 sessions through ConPTY, in tabs and a Sessions panel
  with live status, folder and git branch.
- CMD ⇄ PowerShell switch, and session restore on restart.
- Archive of closed sessions with full colored output, search, tags, notes, keep, export and resume.
- Favorite folders, recent folders, and drag-and-drop from Explorer.
- Saved commands with Run, Insert and Copy modes and `{{placeholders}}`.
- Shell integration: exit-code marks, command history, and jumping between commands.
- Command palette, 10 terminal themes, light, dark and system app themes, and Mica or Acrylic backgrounds.

[1.2.0]: https://github.com/alipkcode/Pro_Terminal/releases/tag/v1.2.0
