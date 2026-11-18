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