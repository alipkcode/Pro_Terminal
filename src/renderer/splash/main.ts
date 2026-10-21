/// <reference types="vite/client" />
import './splash.css'
import logo from '../../../resources/icon.svg?raw'
import type { CheckStatus, HealthCheck, SplashAction, SplashState } from '@shared/health'

declare global {
  interface Window {
    splash: {
      onState(cb: (s: SplashState) => void): void
      action(a: SplashAction): void
    }
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark'
document.documentElement.dataset.theme = theme
$('logo').innerHTML = logo

const STATUS_TEXT: Record<CheckStatus, string> = {
  pending: 'Waiting',
  running: 'Checking',
  ok: 'OK',
  fixed: 'Repaired',
  warn: 'Needs attention',
  fail: 'Failed'
}

const ICONS: Partial<Record<CheckStatus, string>> = {
  ok: '<svg viewBox="0 0 16 16"><path class="draw" d="M4.5 8.3l2.3 2.3 4.7-4.9"/></svg>',
  fixed: '<svg viewBox="0 0 16 16"><path class="draw" d="M4.5 8.3l2.3 2.3 4.7-4.9"/></svg>',
  warn: '<svg viewBox="0 0 16 16"><path class="draw" d="M8 4.5v4.2"/><circle cx="8" cy="11.4" r="0.9" class="dot"/></svg>',
  fail: '<svg viewBox="0 0 16 16"><path class="draw" d="M5.4 5.4l5.2 5.2M10.6 5.4l-5.2 5.2"/></svg>'
}

const rows = new Map<string, { el: HTMLLIElement; status: CheckStatus; detail: string }>()
let lastMode: SplashState['mode'] | null = null

function row(check: HealthCheck, index: number): HTMLLIElement {
  const el = document.createElement('li')
  el.className = 'check'
  el.style.setProperty('--i', String(index))
  el.innerHTML = '<span class="check__icon"></span><span class="check__label"></span><span class="check__detail"></span>'
  el.querySelector('.check__label')!.textContent = check.label
  return el
}

function renderChecks(checks: HealthCheck[], mode: SplashState['mode']): void {
  const list = $('checks')
  checks.forEach((c, i) => {
    let r = rows.get(c.id)
    if (!r) {
      r = { el: row(c, i), status: 'pending', detail: '' }
      r.el.dataset.status = 'pending'
      rows.set(c.id, r)
      list.appendChild(r.el)
    }
    // After a failure the remaining checks never ran: hide them to make room for the explanation.
    r.el.hidden = mode === 'failed' && c.status === 'pending'
    const detail = c.detail ?? ''
    if (r.status !== c.status) {
      r.status = c.status
      r.el.dataset.status = c.status
      r.el.querySelector('.check__icon')!.innerHTML = ICONS[c.status] ?? ''
      r.el.setAttribute('aria-label', `${c.label}: ${STATUS_TEXT[c.status]}${detail ? `. ${detail}` : ''}`)
    }
    if (r.detail !== detail) {
      r.detail = detail
      const d = r.el.querySelector<HTMLElement>('.check__detail')!
      d.textContent = detail
      d.title = detail
    }
  })
  // Keep the step being worked on (or the one that failed) in view if the list overflows.
  const focus = checks.find((c) => c.status === 'fail') ?? checks.find((c) => c.status === 'running')
  if (focus) rows.get(focus.id)?.el.scrollIntoView({ block: 'nearest' })
  // Retrying rebuilds the same ids; a check that no longer appears (e.g. "Update") is removed.
  for (const [id, r] of rows) {
    if (!checks.some((c) => c.id === id)) {
      r.el.remove()
      rows.delete(id)
    }
  }
}

function setText(id: string, text: string): void {
  const el = $(id)
  if (el.textContent === text) return
  el.classList.remove('swap')
  void el.offsetWidth
  el.textContent = text
  el.classList.add('swap')
}

function render(s: SplashState): void {
  const card = $('card')
  card.dataset.mode = s.mode
  card.classList.toggle('closing', !!s.closing)
  setText('title', s.title)
  setText('subtitle', s.subtitle)
  $('version').textContent = `Version ${s.version}`
  const finished = s.checks.filter((c) => c.status !== 'pending' && c.status !== 'running').length
  $('count').textContent = s.mode === 'failed' ? 'Stopped' : s.mode === 'opening' ? 'All checks done' : `${finished} of ${s.checks.length}`
  $('bar').style.transform = `scaleX(${Math.max(0.04, s.progress)})`
  renderChecks(s.checks, s.mode)

  const actions = $('actions')
  actions.hidden = s.mode !== 'failed'
  if (s.mode === 'failed' && lastMode !== 'failed') actions.querySelector<HTMLButtonElement>('[data-action="retry"]')?.focus()
  if (s.mode !== 'failed' && lastMode === 'failed') {
    // A retry starts the list over.
    for (const r of rows.values()) r.el.remove()
    rows.clear()
    renderChecks(s.checks, s.mode)
  }
  lastMode = s.mode
}

document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]')
  if (!btn) return
  const action = btn.dataset.action as SplashAction
  window.splash.action(action)
  if (action === 'copy-report') {
    const label = btn.textContent
    btn.textContent = 'Copied'
    btn.disabled = true
    setTimeout(() => {
      btn.textContent = label
      btn.disabled = false
    }, 1400)
  }
})

$('close').addEventListener('click', () => window.splash.action('quit'))

document.addEventListener('keydown', (e) => {
  if (lastMode !== 'failed') return
  if (e.key === 'Escape') window.splash.action('quit')
})

window.splash.onState(render)
