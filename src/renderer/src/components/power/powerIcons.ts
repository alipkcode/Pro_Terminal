import { Moon, Power, RotateCw, Snowflake, type LucideIcon } from 'lucide-react'
import type { PowerAction } from '@shared/types'

export const POWER_ICON: Record<PowerAction, LucideIcon> = {
  shutdown: Power,
  restart: RotateCw,
  sleep: Moon,
  hibernate: Snowflake
}
