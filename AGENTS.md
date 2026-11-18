# AGENTS.md — working on Spore-Photos

Architecture and conventions for anyone (human or agent) changing this codebase.
For installing it on a server see [`docs/INSTALL.md`](docs/INSTALL.md).

## Layout

```
spore-photos-server/        Express API — auth, photos, albums, settings
spore-photos-public-share/  Express service — public /share/<token> pages
spore-photos-client/        React 19 + Vite SPA (also the UI inside the Android app)
spore-photos-mobile/        Capacitor Android shell around the client build
config/                     shared deployment config loader + example
docker/                     Dockerfile, compose stack, entrypoint, env example
VERSION                     single release version for every component
```

Four independent npm projects, no workspace/monorepo tooling. Install each
separately (or use `docker/compose.yaml`, which builds them into one image).

## How the pieces fit

- The SPA talks to the API with **relative URLs** (`/api/...`). It must never
  hardcode a host: on Android the whole app is loaded *from* the server, and in
  development Vite proxies `/api` to the API port.
- `Dashboard` mounts every page inside `<main className="flex-1 overflow-hidden">`,
  so any page that can grow past the viewport **must bring its own scroll
  container** — outer `flex flex-col h-full min-h-0`, inner `flex-1 overflow-y-auto
  min-h-0` (see `AlbumsPage` and the gallery in `PhotosPage`). Without it the content
  is silently clipped rather than scrolled: the grid grows past the viewport,
  `scrollHeight` exceeds `clientHeight`, nothing moves, and no scrollbar appears to
  hint that anything is missing.
- The API can serve the built SPA itself (`spore-photos-server/index.js` serves
  `../spore-photos-client/dist` when present). A reverse proxy may serve it
  instead; both work.
- Photo and image URLs returned by the API are relative for the same reason.
- Photos live in one flat shared library — `<picturesRoot>/<YYYYMM>/<name>` —
  with the path stored relative to the root. `services/ingest.js` is the only
  writer; `services/library.js` rescans recursively and also understands the
  older `<username>/<YYYYMM>/` tree.
- `spore-photos-public-share` renders standalone HTML for share links. The main
  app's `/share/` and `/api/share/` requests are proxied to it (nginx in
  production, the API's dev proxy locally).

## Configuration

`config/load.js` resolves every setting as **env var → `config/spore-photos.config.json`
→ fallback**, and throws a readable error for required values. `default` in the
config file is merged with the section matching `NODE_ENV`.

Rules:

- **No credentials, hosts, or paths are baked into code.** Database credentials
  are required; if absent the process exits with instructions.
- Add new settings to `config/spore-photos.config.example.json`,
  `.env.example`, and the table in `README.md`.
- `trustProxy` defaults to `false`. Never trust `X-Forwarded-*` implicitly — a
  forged header forges the recorded IP, and a forged IP can dodge the
  blacklist.

## Version

`VERSION` is the only version. `config/version.js` reads it for the Node
services; `vite.config.js` injects it as `__APP_VERSION__`; `/api/health`
returns it; the client warns when they differ. When releasing, update
`VERSION`, the Android `versionName`/`versionCode`, and each `package.json`.

## Auth model

1. **First run** — no users exist. `GET /api/setup/status` reports
   `needsSetup`, and `POST /api/setup` creates the first admin using a one-time
   token (`SETUP_TOKEN`, `setup.token`, or one generated and logged at boot).
   Setup also authorises the browser that ran it and signs it in. There is no
   seeded user and no default password.
2. **Client tokens** — a client is authorised by a token the *server* issues
   (`services/clientToken.js`), stored as a SHA-256 in
   `devices.client_token_hash` and sent as `X-Client-Token`. `X-Device-ID` is
   only a label and proves nothing. Tokens rotate on every login.
3. **Tiers** (`POST /api/auth/check`):
   - valid session cookie → `auto_login`
   - authorised client, matching token, an earlier session → `auto_login`
     (new session; there is exactly one live session per device)
   - authorised client without a matching token → `login_required` (password
     form) — this is how a device earns its token
   - anything else → `code_required` (invite-only)

   **The IP address is never an authorisation factor.** It is recorded in
   `ip_addresses` for the admin view, and it can be blacklisted. That is all.
4. **Login** — `POST /api/auth/login` returns `403 device_not_authorised` for a
   device that was never authorised, and sets an httpOnly session cookie
   (`device_token`) on success.
5. **Access codes** — invite codes (`/api/access-codes`) register new users or
   set a password for existing ones, and authorise the device that redeemed
   the code. Three bad attempts blacklist the IP.
6. **Sign out** ends the session only; the device stays authorised, so the user
   gets the password form rather than a new access code. Revoke a device by
   clearing `devices.client_token_hash`.

Anything touching these tables lives in `routes/auth.js`,
`middleware/whitelistCheck.js`, `services/clientToken.js`, and
`services/setup.js`. `spore-photos-server/test/client-auth.sh` exercises the
whole matrix against a scratch database.

## Transport hardening

- `X-Requested-With: XMLHttpRequest` is **required on every mutating `/api`
  request** (POST/PUT/PATCH/DELETE). A cross-site form cannot set custom
  headers, so this is the CSRF defence. Any script calling the API must send
  it, or it gets `403 csrf_header_required`.
- `helmet` sets security headers; CSP is off because the UI uses inline styles
  and the Android WebView loads photos cross-origin.
- Credential endpoints are rate limited (10 per 15 minutes per client IP).

## Containers

`docker/Dockerfile` builds **one image** that contains both Node projects and the
built SPA; `docker/compose.yaml` runs it twice (`api`, `share`) beside Postgres.

- The entrypoint's first argument selects the role: `api` (runs `db/init.js`,
  then serves 4051) or `share` (4052). Only the API migrates, so two containers
  starting together cannot race.
- Cross-container calls must not hardcode `localhost`. The API proxies
  `/share/*` to `SHARE_SERVER_HOST` (default `localhost`, `share` in compose).
  Any new service-to-service call needs the same treatment.
- Both services handle SIGTERM (drain, close the pool) and the image runs under
  `tini`, so `docker stop` does not kill in-flight uploads.
- The app runs as `PUID:PGID` (default 1000:1000) after the entrypoint fixes
  ownership of the photo volume; it drops from root with `gosu`.
- `db/init.js` must stay idempotent — it runs on every container start.
- APKs are not in the repo and the project publishes no binary: each server
  owner builds and signs their own, with their own key, via
  `spore-photos-mobile/scripts/build-apk.sh` (see `docs/BUILD-APK.md`). The
  Download App panel explains this when no APK is present. Never commit an APK
  or a keystore, and always keep the version number in the APK filename — a
  stable filename is a URL a CDN will serve from cache after a release.

### Versions and updates

- `VERSION` at the repo root is the only version source. `release.json` describes
  a release to *other* installs; neither may invent a number. The Android shell
  derives `versionName`/`versionCode` from `VERSION`.
- `./setup` is the user-facing installer and the only path a user is asked to
  follow. It writes one configuration file per install shape — `docker/.env` for
  containers, `config/spore-photos.config.json` for a direct install — and tells
  the user which. Keep `docs/INSTALL.md` and `docs/DOCKER.md` in step with it,
  and never leave the docs pointing at the other shape's file.
- The update check is **on demand only** — it runs when Settings → Server is
  opened, plus an explicit "Check again". Never add a boot check, a timer or a
  background poll: an install must not talk to the internet because it started.
- The checker never throws and never guesses. Unusable input is reported as
  unusable (`not_published`, `unreadable`, `network`, …), and a version that is
  equal or older than the installed one is *silence*, so a fork running ahead of
  upstream is never nagged.
- The cache belongs to one source URL; changing the source must not serve the
  previous source's answer.
- `lib/updateSource.js` is the only place that may attach an `Authorization`
  header, and only to GitHub hosts — a token must never follow an
  operator-supplied URL.
- Any new fetch path needs a test in `spore-photos-server/test/`. `npm test`
  runs the suite; there is no build step for the server.

See [`docs/DOCKER.md`](docs/DOCKER.md) for the user-facing guide.

## Development

```bash
# API (3051) and share (3052)
NODE_ENV=development PG_PASSWORD=... node spore-photos-server/index.js
NODE_ENV=development PG_PASSWORD=... PORT=3052 node spore-photos-public-share/index.js

# UI with hot reload (3050), proxying /api and /share
cd spore-photos-client && npm run dev
```

Schema changes go in `spore-photos-server/db/`: add a `migrate-YYYYMMDD-*.sql`
file; `npm run db:init` applies `schema.sql` plus every migration in order, so
keep them idempotent (`IF NOT EXISTS`, `ON CONFLICT`).

## Verification checklist

```bash
(cd spore-photos-client && npm run build)          # JSX/import errors
node --check spore-photos-server/index.js          # server syntax
node --check spore-photos-public-share/index.js
curl -s localhost:4051/api/health                  # { status, version }
curl -s localhost:4051/api/setup/status            # { needsSetup }
```

Anything touching auth also needs the flow test, against a throwaway database
(it creates users and devices, so never point it at real data):

```bash
createdb spore_auth_test
PG_DATABASE=spore_auth_test npm --prefix spore-photos-server run db:init
PORT=3057 PG_DATABASE=spore_auth_test SETUP_TOKEN=TEST-TOKEN-1234 \
  PICTURES_ROOT=/tmp/spore-auth-test npm --prefix spore-photos-server start
BASE_URL=http://localhost:3057 SETUP_TOKEN=TEST-TOKEN-1234 \
  PGDATABASE=spore_auth_test spore-photos-server/test/client-auth.sh
```

Build the Android app with `npx cap sync android` then
`./gradlew assembleDebug` (JDK 21). See `spore-photos-mobile/AGENTS.md`.

## Conventions

- No hardcoded domains, ports from `config`, no secrets in the tree.
- Server responses stay relative; the client must work under any origin.
- Keep the design palette in `spore-photos-client/src/index.css` (retro 70s
  tokens: `retro-navy`, `retro-teal`, `retro-mint`, `retro-cream`, `retro-white`,
  `retro-orange`, `retro-red`).
- Prefer small, single-purpose route/service modules; `index.js` only wires
  middleware and routers.

## Database migrations are versioned per release

`db/schema.sql` is the schema a **new** install gets, and runs on every start
(guarded throughout). Everything else lives in `db/migrations/` as
`<version>-<slug>.sql`, one file per release, applied **once** and recorded in
`schema_migrations`.

- Never re-introduce a "run every migrate-*.sql on every start" loop. Replaying a
  release that dropped or replaced something corrupts data that arrived later —
  `spore-photos-server/test/migrations.sh` demonstrates the loss.
- Add the table/column to `schema.sql` **and** the migration in the same commit:
  the two paths must land on the same shape.
- A migration does not have to be re-runnable. It must be a single forward step.
- `npm run db:status` shows applied vs pending. `npm run db:init` applies.
- Nothing applies migrations at server boot — `./setup`, the container entrypoint
  and `npm run db:init` do. Do not tell users to restart a service to migrate.

## Release notes are files, and release.json is generated

- `releases/<version>.md` is written **as part of preparing a release**: front
  matter carries `version`, `released`, `upgrade:{breaking,minFrom,migrations,backupFirst}`
  and `android:{version,rebuild}`; the sections are "What changed", "What this
  means for your install" (this text becomes `notes` in release.json, and is what
  the Version & Updates panel shows) and "Action required".
- `node scripts/build-release-json.js` generates `release.json` from it. Never
  hand-edit `release.json`.
- `node scripts/check-release.js` is the gate: it refuses a release with no notes,
  a migration that does not declare `upgrade.migrations`, a declared migration
  with no file, a breaking release with no `minFrom` or an empty "Action
  required", more than one migration for one release, or a `release.json` that has
  drifted from its notes.
- `scripts/release.sh` (in the parent directory, not the repo) runs both.
