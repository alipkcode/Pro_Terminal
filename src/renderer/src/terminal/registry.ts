import { get } from '@/store/app'
import { TerminalController, type ControllerHooks } from './controller'

const controllers = new Map<string, TerminalController>()
let hooks: ControllerHooks | null = null

export function setControllerHooks(h: ControllerHooks): void {
  hooks = h
}

export function getController(id: string | null | undefined): TerminalController | undefined {
  return id ? controllers.get(id) : undefined
}

export function ensureController(id: string): TerminalController {
  let c = controllers.get(id)
  if (!c) {
    if (!hooks) throw new Error('controller hooks not set')
    c = new TerminalController(id, get().settings, hooks)
    controllers.set(id, c)
  }
  return c
}

export function disposeController(id: string): void {
  const c = controllers.get(id)
  if (!c) return
  controllers.delete(id)
  c.dispose()
}

export function allControllers(): TerminalController[] {
  return [...controllers.values()]
}
