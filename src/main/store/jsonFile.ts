import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * A JSON document persisted to disk with debounced, atomic writes
 * (write to a temp file, then rename over the original).
 */
export class JsonFile<T> {
  private timer: NodeJS.Timeout | null = null
  private dirty = false
  data: T

  constructor(
    private readonly file: string,
    fallback: T,
    normalize: (raw: unknown) => T,
    private readonly delay = 400
  ) {
    mkdirSync(dirname(file), { recursive: true })
    this.data = this.read(fallback, normalize)
  }

  private read(fallback: T, normalize: (raw: unknown) => T): T {
    if (!existsSync(this.file)) return normalize(structuredClone(fallback))
    try {
      return normalize(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch (err) {
      // Keep the unreadable file for manual recovery instead of silently overwriting it.
      try {
        copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`)
      } catch {
        /* ignore */
      }
      console.error(`[store] could not parse ${this.file}:`, err)
      return normalize(structuredClone(fallback))
    }
  }

  /** Schedule a save. */
  save(): void {
    this.dirty = true
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), this.delay)
  }

  /** Write immediately if there are pending changes. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty) return
    this.dirty = false
    const tmp = `${this.file}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      renameSync(tmp, this.file)
    } catch (err) {
      console.error(`[store] could not write ${this.file}:`, err)
    }
  }
}
