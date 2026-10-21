import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Find the current git branch for a folder by reading .git/HEAD (no git process is spawned). */
export async function gitBranch(cwd: string): Promise<string | undefined> {
  if (!cwd) return undefined
  let dir = resolve(cwd)
  for (let i = 0; i < 40; i++) {
    const dotGit = join(dir, '.git')
    try {
      const s = await stat(dotGit)
      let gitDir = dotGit
      if (s.isFile()) {
        // Worktrees and submodules: ".git" is a file pointing at the real git dir.
        const content = await readFile(dotGit, 'utf8')
        const m = /^gitdir:\s*(.+)$/m.exec(content)
        if (!m) return undefined
        gitDir = resolve(dir, m[1].trim())
      }
      const head = (await readFile(join(gitDir, 'HEAD'), 'utf8')).trim()
      const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head)
      if (ref) return ref[1]
      return /^[0-9a-f]{7,}/i.test(head) ? head.slice(0, 7) : undefined
    } catch {
      /* not here, keep walking up */
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  return undefined
}
