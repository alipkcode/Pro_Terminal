import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    // Sandboxed preloads cannot require node_modules (or shared chunks), so each entry is bundled into one
    // self-contained file. The two entries must not import a common module, or Rollup would split it out.
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          splash: resolve(__dirname, 'src/preload/splash.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': shared,
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          splash: resolve(__dirname, 'src/renderer/splash.html')
        }
      }
    }
  }
})
