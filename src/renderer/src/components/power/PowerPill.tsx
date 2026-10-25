import { useEffect, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { POWER_META } from '@shared/power'
import { useApp } from '@/store/app'
import { countdownClock, openPowerTimer, repeatLabel, whenPhrase } from '@/lib/power'
import { POWER_ICON } from './powerIcons'

/** The power timer's countdown in the status bar; opens the timer when clicked. */
export function PowerPill() {
  const timer = useApp((s) => s.powerTimer)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!timer) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [timer])

  const at = timer ? Math.max(timer.next, timer.warningUntil ?? 0) : 0
  const left = at - now
  const Icon = timer ? POWER_ICON[timer.action] : null

  return (
    <AnimatePresence initial={false}>
      {timer && Icon && (
        <motion.button
          key="power"
          className={`pw-pill ${left < 5 * 60_000 ? 'pw-pill--soon' : ''}`}
          style={{ ['--pw-c' as string]: POWER_META[timer.action].color } as CSSProperties}
          onClick={openPowerTimer}
          initial={{ opacity: 0, scale: 0.7, width: 0 }}
          animate={{ opacity: 1, scale: 1, width: 'auto' }}
          exit={{ opacity: 0, scale: 0.7, width: 0 }}
          transition={{ type: 'spring', stiffness: 480, damping: 34 }}
          data-tip={`${POWER_META[timer.action].label} ${whenPhrase(at, now)}${timer.days.length ? ` · ${repeatLabel(timer.days)}` : ''}`}
        >
          <Icon size={11} />
          <span className="mono">{left > 0 ? countdownClock(left) : 'now'}</span>
        </motion.button>
      )}
    </AnimatePresence>
  )
}
