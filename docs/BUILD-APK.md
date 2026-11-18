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
| **Android SDK**: `platform-tools`, `build-tools;35.0.0`, `platforms;android-36` | compile SDK, `apksigner` | ~1.5 GB |
| **Node.js 20.9+** and npm | builds the web assets that go inside the APK | usually present |
| **~3 GB free disk, 4 GB free RAM** | Gradle plus its cache; the build is memory-hungry | — |

This one-time cost is the price of building locally. If you already run this
project in Docker, skip all of it — see *The fastest path* below. The container
path needs no host toolchain, but it does need the builder image, so budget about
2 GB on top (1.76 GB image, plus Gradle's cache inside it) — call it 5 GB free
before you start.

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
sdkmanager 'platform-tools' 'build-tools;35.0.0' 'platforms;android-36'
```

Those two version numbers are different on purpose, and matching them up breaks
the build. The **compile SDK** follows the project — `compileSdkVersion` in
`spore-photos-mobile/android/variables.gradle`, currently 36, and that is the
platform you need installed. **Build-tools** is whatever the Android Gradle Plugin
asks for (35.0.0 for AGP 8.13.0) and does not track it: install only a newer
build-tools and Gradle fails asking for `build-tools;35.0.0`, which reads as a
missing component rather than a version you got wrong. `./scripts/build-apk.sh
--check` reads the compile SDK from that file and requires exactly that platform;
`scripts/check-release.js` asserts the builder image against both values.

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
| `2` | a toolchain piece is missing — the report names it, including *which* Android platform, since the project compiles against one specific API level |
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
  "hints": {}
}
```

`hints` carries an entry only for what is actually missing, so a machine with a
JDK and an SDK reports `{}` rather than an install command it does not need.

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
> - **The passphrase is the artefact to preserve, not just the file.** A `.jks` is
>   useless without it and there is no recovery path, so put the passphrase
>   somewhere you will still have in five years — not only in the shell history of
>   a machine you may rebuild.
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

The APK lands in `spore-photos-client/public/apk/`, and the server serves that
directory at `/apk/<filename>` — so it is downloadable the moment it is built.
Open **Settings → Server → Download App** (or browse to
`/apk/spore-photos-v<version>.apk` directly) and scan the QR code with your phone.

The web app itself is served from `spore-photos-client/dist/`, and Vite copies
`public/` into `dist/` on the next client build — which is why
**Settings → Download App** names the directory it read: on a native install that
is `public/apk`, in a container image it is `dist/apk`. If you front the app with
your own web server rather than letting this one serve it, point `/apk/` at
`public/apk/`, or run a client build, which leaves a copy in `dist/apk/`.

On a container install the shipped `docker/compose.yaml` mounts
`spore-photos-client/public/apk` into the API, so an APK you build there is served
immediately and no image rebuild is involved. The directory is part of the
repository (kept present by a `.gitkeep`), because Docker creates a *missing*
bind-mount source as root — and then the builder, which runs as `PUID`, cannot
write into it.

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

It is five commands, and the last one is the easy one to miss:

```bash
cd docker    # the directory holding your compose file

# once: the builder image, with JDK 21 and Android SDK 35 (~1.8 GB)
docker compose --profile build build builder

# what does this machine still need? exit 0 ready · 2 toolchain · 3 key missing
docker compose --profile build run --rm builder --check --json

# once ever: your signing key (you are prompted for the passphrase)
docker compose --profile build run --rm builder --init-keystore

# the build; add a version to override VERSION:  … builder build 2.0.0
docker compose --profile build run --rm builder build

# only needed for code changes: compose.yaml mounts the host's APK directory
# into the API, so a newly built APK is served as soon as it exists.
docker compose up -d --build
```

Two things worth being blunt about, because both leave you with a correctly
built APK that nobody can download:

- **The APK is mounted into the API, not baked into the image.** The builder
  bind-mounts your checkout and writes the APK to the host's
  `spore-photos-client/public/apk/`; `compose.yaml` mounts that same directory
  into the API at its served path. A container that predates this mount answers
  `/apk/…` out of its own image instead, which was built before your APK existed —
  there, `docker compose up -d --build` is what publishes the file. **Settings →
  Download App** tells you which situation you are in and prints the step only when
  it applies.
- **A missing APK must not look like a working one.** On a container serving from
  its image, an unmounted APK path used to return the web app's HTML with HTTP 200,
  so a phone downloaded a 534-byte "APK" and Android reported a broken package. A
  missing file is now a 404, and a check of this path should compare bytes rather
  than trust the status code.
- **Run `git` as the same user the builder runs as.** The builder writes into your
  checkout, so the checkout has to be writable by that uid. See *Ownership*.

### Ownership: who owns the checkout

The builder runs as `PUID`/`PGID` (default `1000:1000`; set them in
`docker/.env`) and writes *into* your checkout: the signing key to
`spore-photos-server/data/`, the APK to `spore-photos-client/public/apk/`, and
`npx cap sync android` rewrites two tracked files under
`spore-photos-mobile/android/`. If you cloned as root — the natural thing to do
inside a container — the first write fails. The script checks this before it
prompts for a passphrase and names the fix:

```bash
chown -R 1000:1000 /opt/spore-photos        # the uid:gid the builder runs as
```

And if you also run `git` as root, git then refuses to touch the tree until you
say that is fine:

```bash
git config --global --add safe.directory /opt/spore-photos
```

**This returns after every update.** A `git reset --hard` run as root rewrites the
whole working tree as root, so every tracked file silently becomes root-owned
again — including the two files `cap sync` has to write. Pick one owner and stick
to it:

- **Better:** run the git steps as `PUID` too (`sudo -u '#1000' git pull`), so new
  files inherit the right owner and nothing needs re-`chown`ing.
- **Or:** re-run the `chown` after each update, before the next APK build.

Either way the keystore survives updates: `spore-photos-server/data/` holds no
tracked files and `*.jks` is ignored, so git never touches it once the directory
exists.

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
| `sh: 1: vite: not found` | the client's dependencies were never installed — `vite` is a devDependency, so a checkout alone is not enough | the script now installs them itself; if it still fails, `cd spore-photos-client && npm ci` |
| `cannot write the signing key at …` / `mkdir: Permission denied` | the checkout is not writable by the uid the build runs as | `chown -R <uid>:<gid> <repo>` — see *Ownership* |
| the build succeeded but `/apk/…` is a 404 (or downloads a ~534-byte "APK") | on Docker, this install is serving from its app image and the image was not rebuilt | `docker compose up -d --build` — an up-to-date `compose.yaml` mounts the APK directory and cannot hit this |
| `The SDK directory is not writable (/opt/android-sdk)` | Gradle is trying to install a platform or build-tools the SDK lacks | install them with the `sdkmanager` line above — and note it is *build-tools 35.0.0*, not a newer one |
| a hint naming `docker compose --profile build run …` while you are already inside the builder | the script prints the command for whoever is *driving* the build, and that is someone on the host | run it there, in the directory holding your compose file |
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
8. **Do not create the signing key unless you were asked to.** It is one-time and permanent, and the passphrase has to end up somewhere the owner still has in five years. Generating one into a file on the server completes the step while leaving them a key they cannot recover.
9. **On Docker, a build is not finished until the image is rebuilt** (`docker compose up -d --build`). Stopping one command early produces an APK that 404s.
