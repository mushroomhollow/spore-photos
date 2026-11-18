# Android app (Capacitor)

The Android app is a thin shell around the web client. It loads the whole app
from a server address the user enters on first launch — there is no compiled-in
host.

## Build

Build a signed release APK with `scripts/build-apk.sh` — it builds the web
assets, syncs them in, signs with your key, verifies the signature, and places
the result under a versioned name:

```bash
./scripts/build-apk.sh --check            # is this machine ready? (exit 0 / 2 / 3)
./scripts/build-apk.sh --init-keystore    # once: create your signing key
./scripts/build-apk.sh build              # → client/public/apk/spore-photos-v<version>.apk
```

Full prerequisites, the Docker alternative and a troubleshooting table keyed by
real error strings: [`docs/BUILD-APK.md`](../docs/BUILD-APK.md).

Do not hand-build with `./gradlew assembleDebug`: a debug-signed APK cannot
update an install, and the script refuses to publish one. `npx cap sync` must run
after any change to the web build — the script does that for you.

### On a Docker install

The builder image carries the JDK and the Android SDK, so the host needs neither.
There the entry point is the compose service, not a path — inside the image
`WORKDIR` is `/repo`, so `./scripts/` resolves to the repository's own `scripts/`
directory, which holds no build script at all:

```bash
cd docker
docker compose --profile build build builder
docker compose --profile build run --rm builder --check --json
docker compose --profile build run --rm builder --init-keystore
docker compose --profile build run --rm builder build
docker compose up -d --build        # only for code changes: compose mounts the APK dir
```

Two things bite on that path:

- **Ownership.** The builder runs as `PUID`/`PGID` (default `1000:1000`) and writes
  into the checkout: the key, the APK, and — through `cap sync` —
  `capacitor.settings.gradle` and `android/app/capacitor.build.gradle`, both
  tracked. A checkout cloned as root fails at the first write, and a root-run
  `git reset --hard` re-roots the whole tree on every update, so either run the
  git steps as that uid or re-`chown` before each build.
- **The platform the image installs must match the project**: API 36, from
  `variables.gradle`'s `compileSdkVersion`. Build-tools stays at the Gradle
  plugin's own default (35.0.0 for AGP 8.13.0) — installing a newer build-tools to
  "match" the platform removes the component Gradle asks for. Getting this wrong
  fails inside Gradle with `The SDK directory is not writable`, which is about the
  platform it is fetching, not about your files.
- **Publishing an APK needs no image rebuild**: `compose.yaml` mounts
  `spore-photos-client/public/apk` into the API. On an install whose compose file
  predates that mount, `docker compose up -d --build` is what publishes it — and
  skipping it returns HTTP 200 with the web page, which is worse than a 404. The
  server's `buildSteps()` decides which of those to tell the operator by checking
  whether it can write the APK directory.

## Icons

The launcher icon is an **adaptive icon**: `res/mipmap-anydpi-v26/ic_launcher.xml`
(+ `ic_launcher_round.xml`) compose two layers, and `res/values/ic_launcher_background.xml`
is the flat background colour. Those files are **source**. The mark itself is the
lucide camera from `spore-photos-client/public/logo.svg`, and the legacy bitmaps in
`res/mipmap-*/` are generated from it:

```bash
./scripts/generate-icons.sh     # 10 PNGs, five densities, square + round
```

Rules that keep it from regressing:

- **The mark is stroke art, never fill art.** `logo.svg` is `fill="none"
  stroke="currentColor" stroke-width="2"`. The foreground vector must set
  `strokeColor`/`strokeWidth`/`strokeLineCap`/`strokeLineJoin`; filling the same
  path data renders a solid blob, which is what it used to do (with an older
  revision of the icon, too).
- **An adaptive foreground is cropped.** Only the centre ~72dp of the 108dp canvas
  is guaranteed visible, so the mark spans 48% of the canvas. A legacy bitmap is
  shown whole, so there the mark spans 62%. Different fractions, on purpose.
- **The mark is not centred in its own viewBox.** Its measured visual box is
  x 0.9-22.9, y 2.8-21.0 (centre 11.9, 11.9), so centring it means offsetting by
  `half - 12 * scale` on both axes — centring the viewBox leaves it visibly high.
- **An absent `mipmap-anydpi-v26/` is invisible in every build and broken on every
  phone.** Without it a launcher falls back to the square bitmap and crops that to
  its own shape — the icon looks like a square inside a circle, and nothing in this
  project fails or warns.
- Colours live in two places by necessity (`values/ic_launcher_background.xml` and
  the constants at the top of `generate-icons.sh`); the script refuses to run if
  they disagree.

## Version

`versionName` and `versionCode` are derived from the repo's `VERSION` file
(`android/app/build.gradle`), so the app, the APK filename and the release always
agree. `versionCode` is `major*10000 + minor*100 + patch` (2.0.0 → 20000). A
one-off build can override both with `-Pspore.versionName` / `-Pspore.versionCode`;
`scripts/build-apk.sh` passes them.

The APK filename must always carry the version. A stable name is a stable URL,
and a CDN in front of the server will serve the previous build from cache after a
release — which is exactly the bug this convention exists to prevent.

## Identity

- `applicationId` / `namespace`: `dev.mushroomhollow.photos`
- Capacitor `appId` in `capacitor.config.json` must match, and the Java package
  lives at `android/app/src/main/java/dev/mushroomhollow/photos/`.
- **Changing `applicationId` creates a new app** on a device: it installs
  alongside the old one and starts with no saved settings.

## Server address

- `MainActivity` reads the saved address (`SharedPreferences`, `spore_prefs` /
  `server_url`) before the Capacitor bridge is built and sets it as
  `server.url` in the config. Empty → the bundled setup page is shown
  (`server.appStartPath = /error.html`).
- `ServerBridge` is a plain `addJavascriptInterface` bridge exposed as
  `window.SporeNative`. It is present on **every** page, including the fallback,
  so a bad address can always be repaired. `SporeFilesPlugin` is the Capacitor
  plugin used for filesystem work.
- Registration order matters: `registerPlugin(...)` must run **before**
  `super.onCreate()`.

## Notes

- `server.errorPath = error.html` makes an unreachable server show the setup
  page instead of a dead WebView.
- `usesCleartextTraffic` is enabled so a LAN/Tailscale `http://` address works.
- Write `spore_prefs` values with `commit()`, never `apply()`, if the app
  restarts immediately afterwards — an async write can be lost.
- Do not package the APK inside its own web assets (`dist/apk`); remove it
  before `cap sync` or each release grows by the previous APK's size.