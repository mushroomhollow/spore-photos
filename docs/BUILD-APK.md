# Building the Android app

Spore-Photos is a self-hosted photo library. **The project does not publish an
app binary.** You build and sign your own APK, on your own machine, with your
own key.

That is deliberate. An Android app can only be updated by a build signed with
the *same* key as the one already installed. If the project shipped an APK, its
key would be the only key that could ever update it — you could not fork the
code, change it, and install your own version over what you already had. So the
key belongs to whoever runs the server.

Everything below is one script, `spore-photos-mobile/scripts/build-apk.sh`,
which has three modes and never leaves the machine in a half-built state.

**The point of this page:** whether you are a person at a keyboard or an AI
agent working on someone's behalf, every step here is a command with a known
result. If something fails, the script prints the exact command that fixes it.

---

## What you need

| Component | Why | Rough size |
|---|---|---|
| **JDK 17+** (21 recommended) | Gradle needs a JDK; the Android build targets Java 17 bytecode | ~500 MB |
| **Android SDK**: `platform-tools`, `build-tools;35.0.0`, `platforms;android-35` | compile SDK, `apksigner` | ~1.5 GB |
| **Node.js 20.9+** and npm | builds the web assets that go inside the APK | usually present |
| **~3 GB free disk, 4 GB free RAM** | Gradle plus its cache; the build is memory-hungry | — |

This one-time cost is the price of building locally. If you already run this
project in Docker, skip all of it — see *The fastest path* below.

### Install the JDK

```bash
# Arch / CachyOS
sudo pacman -S jdk21-openjdk
# Debian / Ubuntu
sudo apt update && sudo apt install -y openjdk-21-jdk
# Fedora / RHEL
sudo dnf install -y java-21-openjdk-devel
```

### Install the Android SDK

Download the "command-line tools only" package from
<https://developer.android.com/studio#command-tools>, unpack it somewhere
sensible (e.g. `/opt/android-sdk`), then:

```bash
export ANDROID_HOME=/opt/android-sdk
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

sdkmanager --licenses            # accept the licences (interactive, once)
sdkmanager 'platform-tools' 'build-tools;35.0.0' 'platforms;android-35'
```

Put the two `export` lines in your shell profile — the build script reads
`ANDROID_HOME` (and also probes `/opt/android-sdk`, `~/Android/Sdk` and
`~/Library/Android/sdk`, so it may find it anyway).

---

## Step 1 — check that this machine is ready

```bash
cd spore-photos-mobile
./scripts/build-apk.sh --check
```

You get a report and one of three exit codes:

| Exit | Meaning |
|---|---|
| `0` | ready to build |
| `2` | a toolchain piece is missing (the report names it, and prints the install command for your distribution) |
| `3` | no signing key yet — do step 2 |

For a script or an agent, add `--json`:

```bash
./scripts/build-apk.sh --check --json
```

```json
{
  "ready": false,
  "exitCode": 3,
  "version": "2.0.0",
  "versionCode": 20000,
  "apkName": "spore-photos-v2.0.0.apk",
  "java": "/usr/lib/jvm/default/bin/java",
  "sdk": "/opt/android-sdk",
  "buildTools": "/opt/android-sdk/build-tools/35.0.0",
  "apksigner": "/opt/android-sdk/build-tools/35.0.0/apksigner",
  "keystore": { "path": "…/android-keystore.jks", "present": false, "alias": "spore-photos", "sha256": null },
  "outDir": "…/spore-photos-client/public/apk",
  "hints": { "java": "sudo pacman -S jdk21-openjdk", "sdk": "install the Android SDK …" }
}
```

---

## Step 2 — create your signing key (once, ever)

```bash
./scripts/build-apk.sh --init-keystore
```

You will be asked for a passphrase (or set `SPORE_KEYSTORE_PASS` to run it
unattended). The key is written to
`spore-photos-server/data/android-keystore.jks`, mode `600`, and is ignored by
git. The script prints its SHA-256 fingerprint.

> ### ⚠️ This key is the identity of your app installs
>
> - **Back it up somewhere you will still have in five years** — a password
>   manager entry, an encrypted USB stick, wherever you keep things you cannot
>   lose.
> - **Losing it means your existing installs can never be updated.** Android
>   refuses to install a build signed with a different key over an existing
>   one. The only recovery is to uninstall the app (losing its saved server
>   address) and install fresh.
> - **Never commit it, never paste it into an issue, never share it.** Anyone
>   holding it can sign a build your phones will accept as an update.
> - **Changing the application id creates a second app**, not an update: the
>   new one installs alongside the old and starts with no settings.
>
> The script refuses to overwrite an existing key. That is intentional.

To keep the key elsewhere, pass `--keystore /path/to/key.jks`. To keep the
passphrase in a file rather than your shell history, put it in
`spore-photos-mobile/android/keystore.properties` (also gitignored):

```properties
storeFile=/path/to/key.jks
storePassword=…
keyAlias=spore-photos
keyPassword=…
```

---

## Step 3 — build

```bash
./scripts/build-apk.sh build
```

The version is taken from the repository's `VERSION` file, so the APK filename,
the version the app reports about itself, and the release all agree. You can
pin one explicitly — `./scripts/build-apk.sh build 2.0.0` — but a mismatch with
`VERSION` is a mistake worth avoiding.

What the script does, in order:

1. rebuilds the web assets (`spore-photos-client`) and copies them into the
   Android project, so the shell never ships a stale copy of the UI;
2. runs `assembleRelease` **signed with your key**;
3. verifies the signature with `apksigner` and **refuses to publish a build
   signed with the Android debug key** or with no signature at all;
4. writes `spore-photos-client/public/apk/spore-photos-v<version>.apk` — and
   prints the path, size, signer and SHA-256.

Unattended:

```bash
SPORE_KEYSTORE_PASS="$(cat ~/.secret/spore-keystore-pass)" \
  ./scripts/build-apk.sh build
```

---

## Step 4 — get it onto your server and your phone

The APK lands in `spore-photos-client/public/apk/`, which the server serves at
`/apk/<filename>`. Rebuild the client bundle so Vite copies it into the served
directory, then open **Settings → Server → Download App** on the server (or
browse to `/apk/spore-photos-v<version>.apk` directly) and scan the QR code with
your phone.

**Keep the version in the filename.** `spore-photos-v2.0.0.apk`, not
`spore-photos.apk`. A filename that does not change is a URL that does not
change, and a CDN sitting in front of your server (Cloudflare, in our case) will
happily keep serving the previous build from cache. The script enforces this: it
refuses to overwrite an APK that already exists for a version unless you pass
`--force`, and tells you why.

Old APKs are left in place. They are your rollback path — just delete the ones
you no longer care about.

---

## The fastest path: build inside a container

If you already run Spore-Photos with Docker, you do not need any of the
toolchain above on your host:

```bash
cd docker
docker compose --profile build run --rm builder build 2.0.0
```

The builder image carries the JDK and the Android SDK. Point your keystore and
output paths at volumes you control (see `docker/compose.yaml`), and the APK
appears in the same place the server serves it from. The app image itself stays
Node-only — it never carries a 2 GB SDK.

---

## Installing over an existing app

- Signed with **the same key** as the installed app → installs as an update and
  keeps its settings.
- Signed with a **different key** → Android refuses with `App not installed`.
  Uninstall the app first, then install. This is why the key matters.
- Coming from an older **debug-signed** build (how the app was distributed
  before each owner built their own): uninstall it once, then install yours.
  From then on, your key is the one that updates it.

The app's Settings → Server panel shows which version it is running, and tells
you when a release changed the shell and a rebuild is worth doing.

---

## Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| `no JDK found. Install one first: …` | no `java` on `PATH` and no JDK at the usual locations | run the printed command, or set `JAVA_HOME` |
| `Unsupported class file major version 61` (or similar) | Gradle ran on a JDK older than the one the build needs | `./scripts/build-apk.sh --check` and make sure it reports JDK 21 |
| `SDK location not found. Define location with ANDROID_HOME` | the SDK is there but not exported | `export ANDROID_HOME=/opt/android-sdk` (Step 1) |
| `Failed to install the following Android SDK packages … licenses have not been accepted` | SDK licences | `sdkmanager --licenses` |
| `no apksigner found` | `build-tools` missing from the SDK | `sdkmanager 'build-tools;35.0.0'` |
| `no signing key at …` | step 2 not done | `./scripts/build-apk.sh --init-keystore` |
| `the keystore … did not open with that passphrase` | wrong passphrase, or `--alias` is not the alias in that key | check `keytool -list -keystore <file>` |
| `the build came out signed with the Android *debug* key` | the signing config was not applied | check that `spore-photos-mobile/android/keystore.properties` exists or `--keystore` is passed |
| `App not installed` on the phone | a build signed with a different key is already installed | uninstall the old app, install again |
| `… already exists. … pass --force` | you are rebuilding a version that already has an APK | bump the version, or `--force` if you mean it |
| Gradle fails with `OutOfMemoryError` | not enough RAM for the build | close other builds, or add `org.gradle.jvmargs=-Xmx3g` to `spore-photos-mobile/android/gradle.properties` |
| The first build is very slow | Gradle is downloading the Android Gradle Plugin and dependencies | wait; later builds are much faster |

---

## The rules, if you are an AI agent working in this repository

1. **Never commit an APK.** Binaries do not belong in git; `spore-photos-client/public/apk/` is ignored, and each owner builds their own anyway.
2. **Never commit a keystore.** `*.jks`, `*.keystore` and `keystore.properties` are ignored. Do not "helpfully" add one.
3. **Never overwrite a versioned APK without `--force`** — a URL that does not change is how a cached download goes stale.
4. **Always verify the signer** before publishing (`apksigner verify --print-certs`) and refuse a debug-signed or unsigned build.
5. **Keep the version in the APK filename**, and keep it equal to `VERSION`.
6. **Do not change `applicationId`.** It is the app's identity on every device that installed it.
7. If a build fails, run `./scripts/build-apk.sh --check --json` first and report what it says — it distinguishes "toolchain missing" from "key missing" for you.
