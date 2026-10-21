# Changelog

All notable changes to Pro Terminal are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

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
