import { contextBridge, ipcRenderer } from 'electron'
import { SPLASH_CHANNEL, type SplashAction, type SplashState } from '@shared/health'

// The splash page only receives check progress and sends back a button press.
contextBridge.exposeInMainWorld('splash', {
  onState: (cb: (s: SplashState) => void): void => {
    ipcRenderer.on(SPLASH_CHANNEL.state, (_e, s: SplashState) => cb(s))
  },
  action: (a: SplashAction): void => ipcRenderer.send(SPLASH_CHANNEL.action, a)
})
