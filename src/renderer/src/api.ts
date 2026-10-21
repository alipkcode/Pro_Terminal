import type { PtApi } from '@shared/api'

declare global {
  interface Window {
    pt: PtApi
  }
}

export const api: PtApi = window.pt
