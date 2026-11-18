# Changelog

All notable changes to Spore-Photos are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The release script puts the newest section into `release.json`, which is what
other installs read when they check for updates.

## [2.0.1] — 2026-11-18

### Fixed

- **The generated manual-install steps now work.** They say
  `git fetch --tags && git checkout vX.Y.Z`, and the public repository had no
  tags, so that path failed with `pathspec did not match` for anyone following the
  panel. The export now publishes the release tag, and it is published for 2.0.0
  retroactively.
- **`upgrade.minFrom` is compared, not just printed.** Every install was shown the
  same "upgrade from at least …" sentence whatever it was running; now the warning
  appears only for an install that is actually below the floor, names both
  versions, and stays advisory when the running version is unknown.
- **An applied migration may live in `db/archive/`.** Previously the release gate
  rejected any migration file belonging to another release while the runner
  reported a moved file as missing, so the first release to ship a migration had
  no clean place to keep the previous one.
- **The config file's path is sent only to an admin.** It is server-side
  filesystem detail and a non-admin cannot edit that file; the panel falls back to
  generic wording.
- `release.json` now carries the `url` its documentation promises, so the panel's
  "Release notes" link renders.
- `docker/entrypoint.sh`'s comment describes the migration model 2.0.0 introduced,
  rather than the one it replaced.
- The headers of `check-release.js` and `build-release-json.js` no longer imply
  that `release.sh` and `check-version-sync.sh` ship in this repository — they are
  maintainer-side and live outside it.

## [2.0.0] — 2026-11-18

### Added

- **Release-versioned migrations.** `spore-photos-server/db/migrations/<version>-<slug>.sql`
  belongs to the release that ships it and runs **once**, recorded in
  `schema_migrations` with a checksum. `npm run db:status` reports what an install
  has run and what is outstanding; `npm run db:init` applies. Ordering is SemVer,
  one file per release is enforced, and a name that cannot be ordered or a
  prerelease version is refused rather than guessed at. The three migrations that
  predate this scheme are archived (`db/archive/`) and their effects folded into
  `schema.sql`, which remains the schema a new install gets.
- **Release notes as files.** `releases/<version>.md` carries the machine-readable
  upgrade flags and the text an operator reads; `scripts/build-release-json.js`
  generates `release.json` from it, and `scripts/check-release.js` refuses a
  release with no notes, a migration that does not declare itself, a breaking
  release with no way in, or a `release.json` that has drifted from its source.
  Wired into `scripts/release.sh` and `scripts/check-version-sync.sh`.
- **A top-bar server badge**: the name this server goes by (`server.siteName` /
  `SITE_NAME`, defaulting to the hostname), the release it runs, and *Update:
  vX.Y.Z* when a newer one exists — which opens Version & Updates.
- **`./setup`** — a single installer that detects the machine, proposes an install
  shape, asks for the values it needs, creates the database, installs
  dependencies, writes the one configuration file that shape uses, and offers to
  install the services. Re-running it offers the existing values as defaults and
  will not rotate your database password unless asked.
- **Docker stack** (`docker/compose.yaml`, `docs/DOCKER.md`): API, public share and
  PostgreSQL, with a `builder` profile for building an APK inside a container.
- **Version & Updates panel** (Settings → Server). Read-only: it compares this
  install against a `release.json` whose address is set on the server
  (`update.sourceUrl` in the config file, or `UPDATE_SOURCE_URL` in the
  environment), reports whether a newer version exists, and, when one does,
  shows the upgrade steps *for your install shape* ready to copy — and shows the
  same steps before an update exists. It is notify-only: it never installs
  anything, and nothing polls.
- **`release.json`** at the repository root, describing each release: notes, a
  link, an `upgrade` block (breaking / minFrom / migrations / backupFirst) and an
  `android` block. Only `version` is required.
- **`spore-photos-mobile/scripts/build-apk.sh`** — build and sign your own APK,
  with your own key, in three modes: `--check` (is this machine ready? with
  `--json` for scripts), `--init-keystore` (create the key once), and `build`
  (build, sign, verify, place). Exit codes distinguish "toolchain missing" from
  "key missing", and every failure prints the exact command that fixes it.
- **`docs/BUILD-APK.md`** — the full procedure, prerequisites per distribution,
  the Docker alternative, and a troubleshooting table keyed by real error
  strings.
- `UPDATE_SOURCE_URL` / `update.sourceUrl` to set the release source at install
  time; `SITE_NAME` / `server.siteName` to name the server; `spore-photos-mobile`
  version metadata is now derived, not hardcoded.
- `scripts/check-version-sync.sh` (operator-side): asserts `VERSION`,
  `release.json`, all four `package.json` files and the Android build agree.
- Server-side unit tests (`npm test` in `spore-photos-server`): semver
  comparison, release-source parsing and guardrails, the checker's behaviour
  against fixtures, source precedence, install-method detection, migration naming
  and ordering — plus `test/migrations.sh`, which exercises apply-once, the
  replay hazard, failure handling and status against a throwaway database.

### Changed

- **The Android app's `versionName` and `versionCode` are derived from
  `VERSION`.** The app, the APK filename and the release can no longer disagree.
- **APK filenames always carry the version** (`spore-photos-v2.0.0.apk`). A
  fixed filename is a fixed URL, and a CDN in front of the server will serve the
  previous build from cache after a release — which is exactly what happened
  with Cloudflare before this convention. The build script refuses to overwrite
  an APK that already exists for a version.
- The server detects whether it is running in a container or manually, and gives
  install-specific upgrade instructions accordingly.
- **Migrations are no longer replayed on every start.** Replay meant a release
  that dropped or replaced something could be undone — or destroy data written
  since — by an older file running again on a database that had moved on. Each
  migration now runs once, and `spore-photos-server/test/migrations.sh`
  demonstrates both the hazard and its absence.
- **Upgrade instructions are generated for the install shape.** The Docker steps
  include `--build` — the image is built from your checkout, so `pull` + `up -d`
  alone would silently keep the old version — and the manual steps run `db:init`
  with `db:status` first, because the service does not migrate at boot.
- `release.json` is generated from the release notes by
  `scripts/build-release-json.js`, so the panel text, the upgrade flags and the
  docs cannot drift apart.

### Breaking

- **The project no longer publishes an Android APK.** Each server owner builds
  and signs their own, because an Android app can only be updated by a build
  signed with the same key — publishing one would have locked every fork to a
  key its owner does not control.
- **Existing Android installs need one reinstall.** A build signed with a
  different key cannot be installed over another (Android reports *App not
  installed*). Uninstall the old app once, then install your own build; from then
  on your key is the one that updates it. This includes every install of the
  previously published debug-signed build.
- Anyone currently downloading `/apk/spore-photos-v1.9.apk` from a server that
  hosted it should build their own instead — see `docs/BUILD-APK.md`.
- **No database migration is required** for this release; `release.json` says so
  explicitly. Back up anyway if you have data you care about.

### Fixed

- The albums page could not be scrolled when the album list grew past one
  screen: the collection and default views now own their scroll container.
- Docker's default library path is `/data/photos` (was `/data/library`).
- The site favicon is a real icon rather than an emoji, with a matching
  32×32 PNG and app logo.
- `./setup` aborts when its input runs out instead of falling through to each
  question's default — for "which user runs the service?" that default created a
  system user and took ownership of the checkout.
- Re-running `./setup` no longer rotates the database password: it reads the
  existing configuration and offers those values, including keeping the password,
  as the defaults.

## [1.9.0] — 2026-11-17

The first public release.

- Self-hosted photo library: uploads (photos and video), albums, public share
  links, camera-roll backup, and an Android app that loads the whole UI from
  your own server.
- Authentication by password plus a server-issued client token; sessions and
  per-device trust are server-side. An IP address is never an authorisation
  factor.
- A single config file (`config/spore-photos.config.json`) with environment
  overrides; a Jellyfin-style one-time setup token for the first admin account.
- Docker Compose stack including PostgreSQL, or a manual install (Node,
  PostgreSQL, ffmpeg).
- 200 MB upload limit.
- Released into the public domain under the Unlicense.
