# Changelog

All notable changes to Spore-Photos are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The release script puts the newest section into `release.json`, which is what
other installs read when they check for updates.

## [2.0.2] — 2026-11-18

### Changed

- **The Android launcher icon is a proper adaptive icon.** It was a full-bleed
  square bitmap that the launcher cropped to its own shape, so on a circular
  launcher it looked like a square image inside a circle. The layers the platform
  actually wants were half-present: the background and foreground existed, but the
  two `mipmap-anydpi-v26/` files that compose them never did, so Android 8+ ignored
  all of it and fell back to the bitmaps. Those files now exist, the foreground is
  the brand mark drawn as the stroke art it is (it was filling the paths, which
  renders a blob), the legacy bitmaps are regenerated with a real circle for the
  round variant, Android 13+ themed icons work via a monochrome layer, and
  `spore-photos-mobile/scripts/generate-icons.sh` regenerates the whole set from
  `logo.svg` so the next change is a command rather than an art project.

### Fixed

- **`/apk` resolves its directory per request, not once at startup.** Pinned at boot
  it could disagree with the panel: an install whose image had baked an APK into
  `dist/apk` resolved there on startup, and a later build landing in the mounted
  `public/apk` was offered by the panel and 404'd by the server until a restart.
  Reproduced, then fixed.
- **The Download App panel no longer creates a directory to test one.** The
  writability probe ran `mkdir -p` on a path the panel requests every time it opens,
  which leaves a root-owned directory behind if the server runs as root. It tests the
  nearest existing ancestor instead.
- **The builder image's comment no longer contradicts the compose file.** It said a
  build is not downloadable until the image is rebuilt — true of an install whose
  compose file predates the APK mount, false of the shipped one.
- **A container build now produces a downloadable APK.** The documented container
  path was one command, but the builder writes the APK into the host checkout
  while the running API answers `/apk/…` out of its own image — so the build
  succeeded, the signature verified, and the download 404'd. The Download App
  panel shows a container operator the full recipe — and asks for the image
  rebuild only when the install genuinely serves from its image.
- **A container build is published without rebuilding the app image.** The shipped
  `compose.yaml` mounts `spore-photos-client/public/apk` into the API, so an APK is
  served the moment it is built. The mount's directory ships with the repository,
  since Docker creates a missing bind-mount source as root and the builder (PUID)
  then cannot write into it.
- **The builder image ships the Android platform the project compiles against.**
  It carried API 35 while `variables.gradle` compiles against 36, so Gradle tried
  to install the missing platform at build time and failed with `The SDK directory
  is not writable`. Platform and build-tools are not the same number and must not
  be matched up — AGP wants `build-tools;35.0.0` regardless — so the docs and the
  panel's install commands say so, the script now requires exactly the platform
  `variables.gradle` names, and `scripts/check-release.js` asserts the Dockerfile
  against both values instead of leaving them to drift.
- **An absent APK is a 404, not the web page.** A container serving from its image
  answered `/apk/…` with `index.html` and HTTP 200, so a phone downloaded a
  half-kilobyte "APK" and Android called it a broken package.
- **The Download App panel lists APKs on a container install.** It read
  `spore-photos-client/public/apk`, a directory a built image does not have, so it
  reported no APK while the file downloaded fine. The listing and the `/apk` route
  now resolve the same directory — the build output on a host, the served
  directory in a container — and a missing APK returns 404 rather than the web app.
- **The first APK build on a fresh checkout works.** `build` never installed the
  client's dependencies and `vite` is a devDependency, so it failed with
  `sh: 1: vite: not found`. The build's output is no longer discarded, and a real
  failure reports itself instead of vanishing behind `set -e`.
- **`--init-keystore` explains an unwritable checkout** instead of dying with
  `mkdir: Permission denied` after the passphrase has been typed; `--check` warns
  about it without changing its 0/2/3 exit contract.
- **The build hints name a command that exists.** Every self-referential hint
  hardcoded `./scripts/build-apk.sh`, which inside the builder resolves to
  `/repo/scripts` — a real directory holding no such script. Hints are now
  generated for whoever is driving the build.
- **The Gradle cache is on by default**, as a named volume, so rebuilds stop
  re-downloading the Android Gradle Plugin and nobody has to edit `compose.yaml`
  to enable it.
- `--check --json` no longer prints install hints for tools it just found.

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
