# Android app (Capacitor)

The Android app is a thin shell around the web client. It loads the whole app
from a server address the user enters on first launch — there is no compiled-in
host.

## Build

Prerequisites: JDK 21, Android SDK (platform-tools, build-tools, platforms),
`ANDROID_HOME` exported.

```bash
cd spore-photos-client && npm run build     # web assets the shell will serve
cd ../spore-photos-mobile
npm install
npx cap sync android
cd android && ./gradlew assembleDebug
# build/outputs/apk/debug/app-debug.apk
```

`npx cap sync` must run after any change to the web build.

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