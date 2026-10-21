import { useId } from 'react'
import type { ShellFamily, ShellId } from '@shared/types'

/** Command Prompt glyph: a console window with a prompt. */
export function CmdIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <rect x="2.5" y="4" width="19" height="16" rx="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 10l2.6 2.2L7 14.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 15h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

/** PowerShell glyph: the slanted panel with a chevron. */
export function PsIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M6.2 4.5h14.3c.9 0 1.5.9 1.2 1.7l-3.9 11.7c-.3.9-1.1 1.6-2.1 1.6H1.4c-.9 0-1.5-.9-1.2-1.7L4.1 6.1c.3-.9 1.1-1.6 2.1-1.6z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" transform="translate(1 0)" />
      <path d="M7.5 9l3.6 3-4.6 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.5 15.2h3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function ShellIcon({ shell, size = 16, colored = true, className }: { shell: ShellId | ShellFamily; size?: number; colored?: boolean; className?: string }) {
  const isCmd = shell === 'cmd'
  const style = colored ? { color: isCmd ? 'var(--cmd)' : 'var(--ps)' } : undefined
  return <span className={`shell-icon ${className ?? ''}`} style={style}>{isCmd ? <CmdIcon size={size} /> : <PsIcon size={size} />}</span>
}

/** The app logo; matches resources/icon.svg (and icon-small.svg at 24 px and below). */
export function Logo({ size = 22 }: { size?: number }) {
  // useId output can contain characters that are not valid in url(#...) references.
  const uid = 'pt' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const ref = (name: string): string => uid + name
  const url = (name: string): string => 'url(#' + uid + name + ')'
  if (size <= 24) {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo">
        <defs>
          <linearGradient id={ref('bg')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#262b56" />
            <stop offset="1" stopColor="#11142a" />
          </linearGradient>
          <linearGradient id={ref('rim')} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#aab0ff" />
            <stop offset="0.5" stopColor="#b48bff" />
            <stop offset="1" stopColor="#5aa2ff" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="60" height="60" rx="14" fill={url('bg')} />
        <rect x="4" y="4" width="56" height="56" rx="12" fill="none" stroke={url('rim')} strokeWidth="4" />
        <path d="M16 19l13 13-13 13" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M34 45h14" stroke="#f7b84b" strokeWidth="8" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo">
      <defs>
        <linearGradient id={ref('bg')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#232850" />
          <stop offset="1" stopColor="#0c0f1d" />
        </linearGradient>
        <linearGradient id={ref('rim')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#aab0ff" />
          <stop offset="0.5" stopColor="#b48bff" />
          <stop offset="1" stopColor="#5aa2ff" />
        </linearGradient>
        <linearGradient id={ref('chev')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c9c3ff" />
        </linearGradient>
        <radialGradient id={ref('sheen')} cx="0.5" cy="0" r="0.75">
          <stop offset="0" stopColor="#8b96ff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#8b96ff" stopOpacity="0" />
        </radialGradient>
        <filter id={ref('glow')} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      <rect x="3" y="3" width="58" height="58" rx="16" fill={url('bg')} />
      <rect x="3" y="3" width="58" height="58" rx="16" fill={url('sheen')} />
      <rect x="4.25" y="4.25" width="55.5" height="55.5" rx="14.75" fill="none" stroke={url('rim')} strokeWidth="2.5" />
      <g filter={url('glow')}>
        <path d="M18 21.5l11.5 10.5L18 42.5" fill="none" stroke="#9b7bff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M34 43h12" stroke="#f5a623" strokeWidth="6" strokeLinecap="round" />
      </g>
      <path d="M18 21.5l11.5 10.5L18 42.5" fill="none" stroke={url('chev')} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M34 43h12" stroke="#f7b84b" strokeWidth="5.5" strokeLinecap="round" />
    </svg>
  )
}
