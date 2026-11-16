# spore-photos-client

The Spore-Photos web app: React 19 + Vite + TailwindCSS v4.

```bash
npm install
npm run dev      # http://localhost:3050, proxying /api and /share
npm run build    # production bundle → dist/ (no DEV badge)
npm run build:dev  # development bundle (orange DEV badge)
```

The build reads `../VERSION` and injects it as `__APP_VERSION__`. Deployment
settings come from `../config/spore-photos.config.json` (ports for the dev
proxy; env vars win).

The same `dist/` build is packaged into the Android app by
`../spore-photos-mobile`. See the repository [README](../README.md) and
[AGENTS.md](../AGENTS.md) for architecture, and
[docs/INSTALL.md](../docs/INSTALL.md) for server installation.