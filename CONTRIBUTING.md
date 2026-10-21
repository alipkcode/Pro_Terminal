# Contributing to Pro Terminal

Thanks for helping make Pro Terminal better! This guide gets you from a fresh clone to a pull request.

## Getting started

You need **Windows 10 1809+ or Windows 11** and **Node.js 22+**.

```bash
git clone https://github.com/alipkcode/Pro_Terminal.git
cd Pro_Terminal
npm install
npm run dev
```

To keep your real data safe while testing, run a separate profile:

```powershell
$env:PRO_TERMINAL_USER_DATA = "$env:TEMP\pt-dev"; npm run dev
```

## Project layout

| Folder | What lives there |
| --- | --- |
| `src/main` | Electron main process: sessions (`pty/`), JSON stores (`store/`), start-up check (`health/`), IPC |
| `src/preload` | The typed bridge exposed to the UI as `window.pt` |
| `src/renderer` | React UI, xterm.js terminals, styles |
| `src/shared` | Types, defaults and the IPC contract shared by both sides |
| `resources` | Icons and installer art (`npm run icons` regenerates them from the SVGs) |

## Before you open a pull request

- `npm run typecheck` passes.
- `npm run build` succeeds, and you've tried the change in `npm run dev`.
- New settings or library fields are **normalized with defaults**, so older data files keep loading.
- UI changes follow the existing components, design tokens (`styles/tokens.css`) and motion.
- Keep each PR focused on one change, and describe *what* changed and *why*. Screenshots or GIFs help
  a lot for UI changes.

## Commit messages

Write a short summary line in the imperative mood ("Add …", "Fix …"), followed by a body that explains
the change and its effect on users.

## Releasing (maintainers)

1. Bump the version: `npm version <x.y.z> --no-git-tag-version`.
2. Add the release to `CHANGELOG.md`, and update the version badge and installer name in `README.md`.
3. Commit and push to `main`, then run the **Release** workflow from the *Actions* tab with the
   version. It builds the installer and publishes a draft release for you to review and publish.

## Reporting bugs and ideas

Use the [issue forms](https://github.com/alipkcode/Pro_Terminal/issues/new/choose). For bugs, the
start-up report (*Settings › About › Copy report*) is very useful. Security problems go through
[SECURITY.md](SECURITY.md), not public issues.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
