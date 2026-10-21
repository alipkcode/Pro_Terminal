import { useId, type ReactNode } from 'react'
import { motion } from 'motion/react'

interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  tip?: string
}

/** Segmented control with a sliding thumb. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  stretch
}: {
  value: T
  options: SegmentedOption<T>[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  stretch?: boolean
}) {
  const id = useId()
  return (
    <div className={`segmented segmented--${size} ${stretch ? 'segmented--stretch' : ''}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`segmented__opt ${o.value === value ? 'segmented__opt--on' : ''}`}
          onClick={() => onChange(o.value)}
          data-tip={o.tip}
        >
          {o.value === value && (
            <motion.span layoutId={`seg-${id}`} className="segmented__thumb" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />
          )}
          <span className="segmented__content">
            {o.icon}
            {o.label}
          </span>
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'switch--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <motion.span className="switch__thumb" layout transition={{ type: 'spring', stiffness: 600, damping: 34 }} />
    </button>
  )
}

export function Swatches({ value, onChange, colors }: { value?: string; onChange: (c?: string) => void; colors: string[] }) {
  return (
    <div className="swatches">
      <button type="button" className={`swatch swatch--none ${!value ? 'swatch--on' : ''}`} onClick={() => onChange(undefined)} data-tip="No color" />
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          className={`swatch ${value === c ? 'swatch--on' : ''}`}
          style={{ ['--swatch' as string]: c }}
          onClick={() => onChange(c)}
          aria-label={c}
        />
      ))}
    </div>
  )
}

/** Renders text with fuzzy-match indices highlighted. */
export function Highlight({ text, indices }: { text: string; indices?: number[] }) {
  if (!indices?.length) return <>{text}</>
  const set = new Set(indices)
  const out: ReactNode[] = []
  let buf = ''
  let on = false
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i)
    if (hit !== on && buf) {
      out.push(on ? <mark className="hl" key={i}>{buf}</mark> : buf)
      buf = ''
    }
    on = hit
    buf += text[i]
  }
  if (buf) out.push(on ? <mark className="hl" key="end">{buf}</mark> : buf)
  return <>{out}</>
}
