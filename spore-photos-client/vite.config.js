import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

// Release version — one source of truth, shared with the server services.
const version = fs.readFileSync(path.join(root, '..', 'VERSION'), 'utf8').trim()

// Optional shared deployment config, so the dev proxy ports come from the same
// file the servers read (config/spore-photos.config.json).
function deploymentConfig() {
  const file =
    process.env.SPORE_PHOTOS_CONFIG ||
    path.join(root, '..', 'config', 'spore-photos.config.json')
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const env = process.env.NODE_ENV || 'development'
    return { ...(raw.default || {}), ...(raw[env] || {}) }
  } catch {
    return {}
  }
}

const cfg = deploymentConfig()
const apiPort = (cfg.server && cfg.server.port) || 3051
const sharePort = (cfg.publicShare && cfg.publicShare.port) || 3052

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 3050,
    host: '0.0.0.0',
    // Dev server only. Accept any hostname so the deployment's domain isn't
    // baked into the repo (Vite's dev server is never public-facing).
    allowedHosts: true,
    proxy: {
      '/share': {
        target: `http://localhost:${sharePort}`,
        changeOrigin: true,
        secure: false,
      },
      '/api/': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
