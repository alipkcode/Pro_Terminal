import { useRef } from 'react'
import { Pipette } from 'lucide-react'
import { LAUNCHER_MOODS } from '@shared/defaults'
import { LauncherIcon } from '../icons'

/** The color moods for a shortcut's icon, plus any custom color. Used by both wizards. */
export function MoodPicker({ color, onChange }: { color: string; onChange: (color: string) => void }) {
  const colorInput = useRef<HTMLInputElement>(null)
  const mood = LAUNCHER_MOODS.find((m) => m.color.toLowerCase() === color.toLowerCase())
  return (
    <div className="field">
      <span className="field__label">
        Color mood
        <span className="field__hint">{mood ? mood.name : 'Custom'}</span>
      </span>
      <div className="lw-moods">
        {LAUNCHER_MOODS.map((m) => (
          <button
            key={m.color}
            type="button"
            className={`lw-mood ${m.color.toLowerCase() === color.toLowerCase() ? 'lw-mood--on' : ''}`}
            onClick={() => onChange(m.color)}
            data-tip={m.name}
            aria-label={m.name}
          >
            <LauncherIcon color={m.color} size={26} />
          </button>
        ))}
        <button type="button" className={`lw-mood lw-mood--custom ${mood ? '' : 'lw-mood--on'}`} onClick={() => colorInput.current?.click()} data-tip="Pick any color">
          <Pipette size={14} />
          <input ref={colorInput} type="color" value={color} onChange={(e) => onChange(e.target.value)} tabIndex={-1} aria-label="Custom color" />
        </button>
      </div>
    </div>
  )
}
