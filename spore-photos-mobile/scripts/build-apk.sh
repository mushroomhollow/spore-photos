#!/usr/bin/env bash
# ─── Spore-Photos: build your own Android APK ────────────────────────────────
#
# The project does not publish an app binary. Every server owner builds and
# signs their own APK, with their own key — if upstream shipped one, its
# signature would lock every fork to a key its owner does not control.
#
# Three modes, all of them safe to run twice:
#
#   build-apk.sh --check [--json]      is this machine ready to build?
#   build-apk.sh --init-keystore       create the signing key (once)
#   build-apk.sh build [version]       build, sign, verify, place
#
# Exit codes for --check:  0 ready · 2 missing toolchain · 3 missing keystore
# Exit codes for build:    0 ok    · 1 failed · 4 signing key problem
#
# The APK is always written as spore-photos-v<version>.apk. That is not
# cosmetic: a stable filename means a URL that a CDN (Cloudflare in our case)
# will happily serve from cache after a release, handing people the previous
# build. A filename that changes with the version makes every release a new URL
# by construction, so the cache cannot lie.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$MOBILE_DIR/.." && pwd)"
CLIENT_DIR="$REPO_ROOT/spore-photos-client"
ANDROID_DIR="$MOBILE_DIR/android"
ASSETS_PUBLIC="$ANDROID_DIR/app/src/main/assets/public"

VERSION_FILE="$REPO_ROOT/VERSION"
DEFAULT_KEYSTORE="$REPO_ROOT/spore-photos-server/data/android-keystore.jks"
DEFAULT_OUT="$CLIENT_DIR/public/apk"
DEFAULT_ALIAS="spore-photos"

# The versions the project actually builds against, read from the two files that
# decide them rather than pinned here. variables.gradle holds the compile SDK;
# build-tools is the Android Gradle Plugin's own default and does not track it
# (AGP 8.13.0 wants 35.0.0 while compiling against API 36 — installing 36.0.0 to
# "match" removes the component Gradle asks for). scripts/check-release.js asserts
# the builder image against both.
VARIABLES_GRADLE="$ANDROID_DIR/variables.gradle"
COMPILE_SDK="$(sed -n 's/.*compileSdkVersion[[:space:]]*=[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$VARIABLES_GRADLE" 2>/dev/null | head -n1)"
COMPILE_SDK="${COMPILE_SDK:-36}"
AGP_BUILD_TOOLS="35.0.0"

# ─── Output helpers ──────────────────────────────────────────────────────────
say()  { printf '%s\n' "$*"; }
step() { printf '\n=== %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
die()  { printf '  ERROR: %s\n' "$*" >&2; exit "${2:-1}"; }

# ─── Context helpers ─────────────────────────────────────────────────────────
# Inside the builder image this script is reached as a compose service, not as a
# path: WORKDIR is /repo, and ./scripts/ resolves to the repository's own scripts/
# directory — which exists and holds no such script, so a native hint there fails
# in a more confusing way than "not found". The hints below are read by whoever is
# driving the build, who is outside the container even when the script is not.
in_container() { [ -f /.dockerenv ] || [ -f /run/.containerenv ]; }

# The next command a human should type, with a version interpolated.
next_command() { # next_command <args…>
  if in_container; then
    printf 'docker compose --profile build run --rm builder %s   # in the directory holding your compose file' "$*"
  else
    printf 'cd %s && ./scripts/build-apk.sh %s' "$MOBILE_DIR" "$*"
  fi
}

dir_writable() { # 0 when this script could create and write in <dir>
  local d="$1"
  while [ ! -d "$d" ] && [ "$d" != "/" ]; do d="$(dirname "$d")"; done
  [ -w "$d" ]
}

# This script writes into the checkout (the key, the APK), so it has to be able
# to. Checked before a passphrase is typed and before anything is built: failing
# here used to be a bare "mkdir: Permission denied" naming neither the directory,
# the uid, nor the fix — the one place the script broke its own rule that every
# failure prints the command that resolves it.
require_writable() { # require_writable <dir> <what>
  local dir="$1" what="$2" owner
  dir_writable "$dir" && return 0
  owner="$(stat -c '%u:%g' "$dir" 2>/dev/null || stat -c '%u:%g' "$(dirname "$dir")" 2>/dev/null || echo unknown)"
  die "cannot write $what at $dir
  that path is owned by ${owner}, and this script is running as uid $(id -u).
  Run the build as the checkout's owner, or give that owner the tree:
      chown -R <uid>:<gid> $REPO_ROOT
  with the Docker builder the uid that matters is PUID/PGID from docker/.env
  (default 1000:1000). If you also run git as another user, allow the tree:
      git config --global --add safe.directory $REPO_ROOT" 4
}

usage() {
  sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'USAGE'

Options:
  --keystore <path>   signing key (default: spore-photos-server/data/android-keystore.jks)
  --alias <name>      key alias inside the keystore (default: spore-photos)
  --out <dir>         where to place the APK (default: spore-photos-client/public/apk)
  --force             overwrite an APK that already exists for this version
  --skip-client-build skip rebuilding the web assets (faster, if you just built)
  --json              with --check: machine-readable output
  -h, --help          this text

Environment:
  SPORE_KEYSTORE_PASS  keystore passphrase (otherwise you are prompted)
  JAVA_HOME            JDK 17+ (a JDK 21 is detected automatically if present)
  ANDROID_HOME         Android SDK (probed at the usual locations if unset)

Examples (native):
  cd spore-photos-mobile
  ./scripts/build-apk.sh --check
  ./scripts/build-apk.sh --init-keystore
  SPORE_KEYSTORE_PASS=… ./scripts/build-apk.sh build

Examples (inside the builder image — the entry point is the compose service):
  cd docker
  docker compose --profile build build builder
  docker compose --profile build run --rm builder --check
  docker compose --profile build run --rm builder --init-keystore
  SPORE_KEYSTORE_PASS=… docker compose --profile build run --rm builder build
USAGE
}

# ─── Args ────────────────────────────────────────────────────────────────────
MODE=""
VERSION_ARG=""
KEYSTORE="$DEFAULT_KEYSTORE"
ALIAS="$DEFAULT_ALIAS"
OUT_DIR="$DEFAULT_OUT"
FORCE=0
SKIP_CLIENT_BUILD=0
JSON=0

while [ $# -gt 0 ]; do
  case "$1" in
    --check)             MODE="check" ;;
    --init-keystore)     MODE="init-keystore" ;;
    build)               MODE="build" ;;
    --keystore)          KEYSTORE="${2:?--keystore needs a path}"; shift ;;
    --alias)             ALIAS="${2:?--alias needs a name}"; shift ;;
    --out)               OUT_DIR="${2:?--out needs a directory}"; shift ;;
    --force)             FORCE=1 ;;
    --skip-client-build) SKIP_CLIENT_BUILD=1 ;;
    --json)              JSON=1 ;;
    -h|--help)           usage; exit 0 ;;
    -*)                  die "unknown option: $1" ;;
    *)                   VERSION_ARG="$1" ;;
  esac
  shift
done

[ -n "$MODE" ] || { usage; exit 1; }

# ─── Version ─────────────────────────────────────────────────────────────────
# The version of a build is the repo's VERSION, so the APK, the app's own
# reported version and the release all agree by construction.
read_version() {
  [ -f "$VERSION_FILE" ] || return 1
  tr -d '[:space:]' < "$VERSION_FILE"
}

version_code_for() {
  # major*10000 + minor*100 + patch — 2.0.0 -> 20000, 1.9.0 -> 10900
  local v="${1#v}" major minor patch
  IFS=. read -r major minor patch _ <<< "$v"
  case "$major$minor$patch" in
    *[!0-9]*|'') echo 1; return ;;
  esac
  echo $(( major * 10000 + minor * 100 + patch ))
}

TARGET_VERSION="$(read_version || true)"
[ -n "$TARGET_VERSION" ] || die "cannot read $VERSION_FILE"
if [ -n "$VERSION_ARG" ]; then
  TARGET_VERSION="${VERSION_ARG#v}"
fi
VERSION_CODE="$(version_code_for "$TARGET_VERSION")"
APK_NAME="spore-photos-v${TARGET_VERSION}.apk"

# ─── Toolchain discovery ─────────────────────────────────────────────────────
# Failures here are the ones people hit first, so every miss records an exact
# command for the detected package manager — an agent can run what we print.
PKG_HINT_JAVA=""
PKG_HINT_SDK=""

detect_pkg_manager() {
  for pm in pacman apt-get dnf zypper apk brew; do
    command -v "$pm" >/dev/null 2>&1 && { echo "$pm"; return; }
  done
  echo ""
}

hint_java() {
  case "$(detect_pkg_manager)" in
    pacman) PKG_HINT_JAVA="sudo pacman -S jdk21-openjdk" ;;
    apt-get) PKG_HINT_JAVA="sudo apt update && sudo apt install -y openjdk-21-jdk" ;;
    dnf) PKG_HINT_JAVA="sudo dnf install -y java-21-openjdk-devel" ;;
    zypper) PKG_HINT_JAVA="sudo zypper install -y java-21-openjdk-devel" ;;
    apk) PKG_HINT_JAVA="sudo apk add openjdk21" ;;
    brew) PKG_HINT_JAVA="brew install openjdk@21" ;;
    *) PKG_HINT_JAVA="install a JDK 17 or newer (21 recommended)" ;;
  esac
}

hint_sdk() {
  PKG_HINT_SDK="install the Android SDK command-line tools, then:
    sdkmanager --licenses
    sdkmanager 'platform-tools' 'build-tools;$AGP_BUILD_TOOLS' 'platforms;android-$COMPILE_SDK'
  (the compile SDK — $COMPILE_SDK, from variables.gradle — and build-tools are not
  the same number: build-tools is whatever the Gradle plugin wants)
  and export ANDROID_HOME to the SDK root"
}

JAVA_BIN=""
JAVA_VERSION_STR=""
find_java() {
  local candidates=()
  [ -n "${JAVA_HOME:-}" ] && candidates+=("$JAVA_HOME/bin/java")
  for dir in /usr/lib/jvm/*/bin/java; do [ -x "$dir" ] && candidates+=("$dir"); done
  candidates+=("/usr/lib/jvm/java-21-openjdk/bin/java")
  command -v java >/dev/null 2>&1 && candidates+=("$(command -v java)")

  for bin in "${candidates[@]}"; do
    if [ -x "$bin" ] && "$bin" -version >/dev/null 2>&1; then
      JAVA_BIN="$bin"
      if [ -z "${JAVA_HOME:-}" ]; then
        JAVA_HOME="$(cd "$(dirname "$bin")/.." && pwd)"
        export JAVA_HOME
      fi
      JAVA_VERSION_STR="$("$bin" -version 2>&1 | head -n1)"
      return 0
    fi
  done
  return 1
}

ANDROID_SDK=""
find_sdk() {
  local candidates=(
    "${ANDROID_HOME:-}"
    "${ANDROID_SDK_ROOT:-}"
    /opt/android-sdk
    "$HOME/Android/Sdk"
    "$HOME/Android/sdk"
    "$HOME/Library/Android/sdk"
  )
  for dir in "${candidates[@]}"; do
    if [ -n "$dir" ] && [ -d "$dir" ]; then
      ANDROID_SDK="$dir"
      export ANDROID_HOME="$dir"
      return 0
    fi
  done
  return 1
}

BUILD_TOOLS=""
find_build_tools() {
  [ -n "$ANDROID_SDK" ] || return 1
  local latest
  latest="$(ls -1 "$ANDROID_SDK/build-tools" 2>/dev/null | sort -V | tail -n1)"
  [ -n "$latest" ] || return 1
  BUILD_TOOLS="$ANDROID_SDK/build-tools/$latest"
}

APKSIGNER=""
find_apksigner() {
  if [ -n "$BUILD_TOOLS" ] && [ -x "$BUILD_TOOLS/apksigner" ]; then
    APKSIGNER="$BUILD_TOOLS/apksigner"
    return 0
  fi
  command -v apksigner >/dev/null 2>&1 && { APKSIGNER="$(command -v apksigner)"; return 0; }
  return 1
}

PLATFORM_DIR=""
find_platform() {
  [ -n "$ANDROID_SDK" ] || return 1
  # Exactly the compile SDK, not merely the newest platform installed. A machine
  # with only an older platform "passes" a check that looks for any of them and
  # then fails inside Gradle, after Gradle has tried to download the right one.
  local dir="$ANDROID_SDK/platforms/android-$COMPILE_SDK"
  [ -d "$dir" ] || return 1
  PLATFORM_DIR="$dir"
}

KEYTOOL=""
find_keytool() {
  local candidates=()
  [ -n "${JAVA_HOME:-}" ] && candidates+=("$JAVA_HOME/bin/keytool")
  command -v keytool >/dev/null 2>&1 && candidates+=("$(command -v keytool)")
  for bin in "${candidates[@]}"; do
    [ -x "$bin" ] && { KEYTOOL="$bin"; return 0; }
  done
  return 1
}

fingerprint_of() {
  # SHA-256 of the signing certificate, so two builds can be compared without
  # reading the key. Returns non-zero (no output) when keytool is unavailable
  # or the key does not open — callers must not read that as "no fingerprint".
  [ -n "$KEYTOOL" ] || return 1
  local ks="$1" pass="$2" alias="$3"
  "$KEYTOOL" -list -v -keystore "$ks" -alias "$alias" -storepass "$pass" 2>/dev/null \
    | awk '/SHA256:/ {print $2; exit}'
}

keystore_present() { [ -f "$KEYSTORE" ]; }

# ─── Mode: --check ───────────────────────────────────────────────────────────
run_check() {
  local ready=1 exit_code=0
  find_java || true
  find_sdk || true
  find_build_tools || true
  find_apksigner || true
  find_platform || true
  find_keytool || true
  hint_java
  hint_sdk

  local ks_present="no" ks_fp=""
  if keystore_present; then
    ks_present="yes"
    if [ -n "$KEYTOOL" ] && [ -n "${SPORE_KEYSTORE_PASS:-}" ]; then
      ks_fp="$(fingerprint_of "$KEYSTORE" "$SPORE_KEYSTORE_PASS" "$ALIAS" || true)"
    fi
  fi

  [ -n "$JAVA_BIN" ] && [ -n "$ANDROID_SDK" ] && [ -n "$BUILD_TOOLS" ] && [ -n "$APKSIGNER" ] && [ -n "$PLATFORM_DIR" ] || ready=0
  if [ "$ready" = 0 ]; then exit_code=2
  elif ! keystore_present; then ready=0; exit_code=3; fi

  if [ "$JSON" = 1 ]; then
    printf '{\n'
    printf '  "ready": %s,\n' "$([ "$exit_code" = 0 ] && echo true || echo false)"
    printf '  "exitCode": %s,\n' "$exit_code"
    printf '  "version": "%s",\n' "$TARGET_VERSION"
    printf '  "versionCode": %s,\n' "$VERSION_CODE"
    printf '  "apkName": "%s",\n' "$APK_NAME"
    printf '  "java": %s,\n' "$([ -n "$JAVA_BIN" ] && printf '"%s"' "$JAVA_BIN" || echo null)"
    printf '  "javaHome": %s,\n' "$([ -n "${JAVA_HOME:-}" ] && printf '"%s"' "$JAVA_HOME" || echo null)"
    printf '  "sdk": %s,\n' "$([ -n "$ANDROID_SDK" ] && printf '"%s"' "$ANDROID_SDK" || echo null)"
    printf '  "buildTools": %s,\n' "$([ -n "$BUILD_TOOLS" ] && printf '"%s"' "$BUILD_TOOLS" || echo null)"
    printf '  "platform": %s,\n' "$([ -n "$PLATFORM_DIR" ] && printf '"%s"' "$PLATFORM_DIR" || echo null)"
    printf '  "apksigner": %s,\n' "$([ -n "$APKSIGNER" ] && printf '"%s"' "$APKSIGNER" || echo null)"
    printf '  "keytool": %s,\n' "$([ -n "$KEYTOOL" ] && printf '"%s"' "$KEYTOOL" || echo null)"
    printf '  "keystore": {"path": "%s", "present": %s, "alias": "%s", "sha256": %s},\n' \
      "$KEYSTORE" "$([ "$ks_present" = yes ] && echo true || echo false)" "$ALIAS" \
      "$([ -n "$ks_fp" ] && printf '"%s"' "$ks_fp" || echo null)"
    printf '  "outDir": "%s",\n' "$OUT_DIR"
    # Only what is actually missing: an install hint for a tool that was just
    # found reads as a contradiction.
    local hints=""
    [ -n "$JAVA_BIN" ]   || hints="${hints}${hints:+, }\"java\": \"$(printf '%s' "$PKG_HINT_JAVA" | tr '\n' ' ')\""
    [ -n "$ANDROID_SDK" ] || hints="${hints}${hints:+, }\"sdk\": \"$(printf '%s' "$PKG_HINT_SDK" | tr '\n' ' ')\""
    printf '  "hints": {%s}\n' "$hints"
    printf '}\n'
    exit "$exit_code"
  fi

  step "Readiness check"
  say "  version            ${TARGET_VERSION} (versionCode ${VERSION_CODE})"
  say "  apk name           ${APK_NAME}"
  say "  java               ${JAVA_BIN:-MISSING}  ${JAVA_VERSION_STR}"
  say "  java home          ${JAVA_HOME:-unset}"
  say "  android sdk        ${ANDROID_SDK:-MISSING}"
  say "  build-tools        ${BUILD_TOOLS:-MISSING}"
  say "  platform           ${PLATFORM_DIR:-MISSING (android-$COMPILE_SDK is what variables.gradle requires)}"
  say "  apksigner          ${APKSIGNER:-MISSING}"
  say "  keystore           ${KEYSTORE}"
  say "  keystore present   ${ks_present}${ks_fp:+  (sha256 ${ks_fp})}"
  say "  output directory   ${OUT_DIR}"
  dir_writable "$(dirname "$KEYSTORE")" || {
    warn "the signing-key directory is not writable by uid $(id -u): $(dirname "$KEYSTORE")"
    warn "  fix: chown -R <uid>:<gid> $REPO_ROOT   (Docker: PUID/PGID from docker/.env)"
  }
  dir_writable "$OUT_DIR" || warn "the APK output directory is not writable by uid $(id -u): $OUT_DIR"

  if [ "$exit_code" = 2 ]; then
    say ""
    say "  Missing toolchain. Install it with:"
    [ -n "$JAVA_BIN" ] || say "    ${PKG_HINT_JAVA}"
    [ -n "$ANDROID_SDK" ] || say "    ${PKG_HINT_SDK}"
    say ""
    say "  On a machine with Docker you can skip all of this:"
    say "    docker compose --profile build run --rm builder build ${TARGET_VERSION}"
  elif [ "$exit_code" = 3 ]; then
    say ""
    say "  No signing key yet. Create one — this is the key that will identify"
    say "  you to every phone you install the app on, and it is the only thing"
    say "  that can update an install you have already made:"
    say ""
    say "    $(next_command --init-keystore)"
  else
    say ""
    say "  Ready to build:"
    say "    $(next_command "build ${TARGET_VERSION}")"
  fi
  exit "$exit_code"
}

# ─── Mode: --init-keystore ───────────────────────────────────────────────────
run_init_keystore() {
  if keystore_present; then
    die "a keystore already exists at $KEYSTORE — keeping it.

  Replacing it would make every app you have already installed unable to
  update (Android refuses a build signed by a different key). Delete it
  deliberately if that is really what you want." 4
  fi

  find_java || die "no JDK found. Install one first:
    $PKG_HINT_JAVA" 2
  hint_java
  find_keytool || die "keytool not found (it ships with the JDK)" 2
  require_writable "$(dirname "$KEYSTORE")" "the signing key"

  local pass="${SPORE_KEYSTORE_PASS:-}"
  if [ -z "$pass" ]; then
    if [ ! -t 0 ]; then
      die "no passphrase. Set SPORE_KEYSTORE_PASS, or run this in a terminal." 4
    fi
    printf 'Choose a passphrase for the keystore (min 6 chars): '
    read -r -s pass; printf '\n'
    printf 'Repeat it: '
    local again; read -r -s again; printf '\n'
    [ "$pass" = "$again" ] || die "the passphrases did not match" 4
    [ ${#pass} -ge 6 ] || die "use at least 6 characters" 4
  fi

  mkdir -p "$(dirname "$KEYSTORE")"
  step "Creating the signing key"
  "$KEYTOOL" -genkeypair -v \
    -keystore "$KEYSTORE" \
    -alias "$ALIAS" \
    -keyalg RSA -keysize 4096 -validity 10000 \
    -storepass "$pass" -keypass "$pass" \
    -dname "CN=Spore-Photos self-hosted, OU=Android, O=self-hosted, L=, ST=, C=" >/dev/null
  chmod 600 "$KEYSTORE"

  local fp; fp="$(fingerprint_of "$KEYSTORE" "$pass" "$ALIAS" || true)"
  say "  created   $KEYSTORE  (chmod 600)"
  say "  alias     $ALIAS"
  [ -n "$fp" ] && say "  sha256    $fp"
  say ""
  say "  Back this file up somewhere safe, and never commit it. Anyone who has"
  say "  it can sign a build that your phones will accept as an update."
  say ""
  say "  Next: $(next_command "build ${TARGET_VERSION}")"
}

# ─── Mode: build ─────────────────────────────────────────────────────────────
run_build() {
  step "Building Spore-Photos APK v${TARGET_VERSION}"
  say "  versionCode ${VERSION_CODE} · ${APK_NAME}"

  find_java || { hint_java; die "no JDK found. Install one:
    $PKG_HINT_JAVA" 2; }
  find_sdk || { hint_sdk; die "no Android SDK found (ANDROID_HOME unset and no SDK at the usual paths):
    $PKG_HINT_SDK" 2; }
  find_build_tools || { hint_sdk; die "no build-tools in $ANDROID_SDK:
    $PKG_HINT_SDK" 2; }
  find_platform || { hint_sdk; die "no Android platform android-$COMPILE_SDK in $ANDROID_SDK/platforms:
    the project compiles against API $COMPILE_SDK (spore-photos-mobile/android/variables.gradle),
    and Gradle cannot install it into an SDK directory it does not own.
    $PKG_HINT_SDK" 2; }
  find_apksigner || die "apksigner not found (expected in $BUILD_TOOLS)" 2
  find_keytool || die "keytool not found — it ships with the JDK, so check \$JAVA_HOME" 2
  require_writable "$(dirname "$KEYSTORE")" "the signing key"
  require_writable "$OUT_DIR" "the APK"

  local pass="${SPORE_KEYSTORE_PASS:-}"
  if ! keystore_present; then
    die "no signing key at $KEYSTORE. Create one first:
    $(next_command --init-keystore)" 4
  fi
  if [ -z "$pass" ]; then
    if [ -t 0 ]; then
      printf 'Keystore passphrase: '
      read -r -s pass; printf '\n'
    else
      die "no passphrase. Set SPORE_KEYSTORE_PASS, or run this in a terminal." 4
    fi
  fi
  passphrase_ok() { fingerprint_of "$KEYSTORE" "$pass" "$ALIAS" >/dev/null 2>&1; }
  passphrase_ok || die "the keystore at $KEYSTORE did not open with that passphrase (or has no alias '$ALIAS')" 4

  # Refuse to clobber an existing build of the same version — see the header.
  mkdir -p "$OUT_DIR"
  local dest="$OUT_DIR/$APK_NAME"
  if [ -f "$dest" ] && [ "$FORCE" != 1 ]; then
    die "$dest already exists.

  A file that keeps its name across builds is exactly what makes a CDN serve a
  stale download: the URL is unchanged, so the cache has no reason to refetch.
  Either bump the version, or pass --force if you genuinely want to replace it." 1
  fi

  if ! command -v npm >/dev/null 2>&1; then
    case "$(detect_pkg_manager)" in
      pacman) NODE_HINT="sudo pacman -S nodejs npm" ;;
      apt-get) NODE_HINT="sudo apt update && sudo apt install -y nodejs npm" ;;
      dnf) NODE_HINT="sudo dnf install -y nodejs npm" ;;
      zypper) NODE_HINT="sudo zypper install -y nodejs npm" ;;
      apk) NODE_HINT="sudo apk add nodejs npm" ;;
      brew) NODE_HINT="brew install node" ;;
      *) NODE_HINT="install Node.js 20.9 or newer (https://nodejs.org)" ;;
    esac
    die "npm not found — the web assets have to be built first.

  Install Node.js (20.9 or newer):
    $NODE_HINT

  If npm is installed but this ran from a service with a minimal PATH, run the
  build from a login shell instead." 2
  fi

  # 1. Web assets, then copy them into the shell. The APK serves the whole UI
  #    from the server, so a stale bundled copy would only ever be seen by a
  #    phone that cannot reach its server — but it must still be current, and
  #    the app must never package its own previous APK (that is how a release
  #    grows by the size of the last one).
  if [ "$SKIP_CLIENT_BUILD" = 1 ]; then
    say "  web assets: reusing the existing build (--skip-client-build)"
  else
    say "  web assets: building the client…"
    # A checkout does not imply installed dependencies, and vite is a
    # devDependency: nothing on the container path ran `npm ci` for the client
    # (the Dockerfile and INSTALL.md §6 both do, this script did not), so a fresh
    # checkout failed at the first command with a bare `vite: not found`. Same
    # guard as the mobile project below.
    ( cd "$CLIENT_DIR" && [ -d node_modules ] || npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null 2>&1 ) \
      || die "could not install the client's dependencies in $CLIENT_DIR:
    cd $CLIENT_DIR && npm ci"
    # Output left visible, and the failure caught here: under `set -e` a failing
    # npm build exited the script before the message below could be reached, and
    # the redirect discarded npm's explanation with it.
    ( cd "$CLIENT_DIR" && npm run build ) \
      || die "the client build failed (output above). On its own:
    cd $CLIENT_DIR && npm run build"
  fi
  [ -f "$CLIENT_DIR/dist/index.html" ] || die "no client build at $CLIENT_DIR/dist"

  say "  web assets: syncing into the Android project…"
  ( cd "$MOBILE_DIR" && [ -d node_modules ] || npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null 2>&1 )
  ( cd "$MOBILE_DIR" && npx cap sync android >/dev/null )
  rm -rf "$CLIENT_DIR/dist/apk" "$ASSETS_PUBLIC/apk"

  # 2. Build, signed with the operator's own key. The passphrase goes through
  #    the environment, not argv, so it does not appear in `ps`.
  say "  gradle: assembleRelease (signed)…"
  ( cd "$ANDROID_DIR" \
    && SPORE_KEYSTORE_PASS="$pass" ./gradlew --no-daemon -q assembleRelease \
         -Pspore.storeFile="$KEYSTORE" \
         -Pspore.keyAlias="$ALIAS" \
         -Pspore.versionName="$TARGET_VERSION" \
         -Pspore.versionCode="$VERSION_CODE" )

  local built="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
  [ -f "$built" ] || die "no APK at $built — see the gradle output above"

  # 3. Verify the signer. A debug-signed or unsigned build must never be
  #    published: it cannot update an existing install, and it hands anyone the
  #    ability to replace the app.
  say "  verifying the signature…"
  local certs
  certs="$("$APKSIGNER" verify --print-certs "$built" 2>&1 || true)"
  if printf '%s' "$certs" | grep -qi "CN=Android Debug"; then
    rm -f "$built"
    die "the build came out signed with the Android *debug* key — refusing to publish it.
  Check that signingConfigs.release is being applied (keystore at $KEYSTORE)." 4
  fi
  if ! printf '%s' "$certs" | grep -qi "Signer #1 certificate DN"; then
    rm -f "$built"
    die "the build has no valid signature — refusing to publish it.
  $certs" 4
  fi
  local signer
  signer="$(printf '%s' "$certs" | awk -F': ' '/Signer #1 certificate DN/ {print $2; exit}')"

  # 4. Place it under the versioned name.
  cp -f "$built" "$dest"
  local size sha
  size="$(du -h "$dest" | cut -f1)"
  sha="$(sha256sum "$dest" | cut -d' ' -f1)"

  step "Built"
  say "  file       $dest"
  say "  size       $size"
  say "  sha256     $sha"
  say "  signed by  ${signer:-unknown}"
  say ""
  say "  Your phones can install this over any earlier build signed with the"
  say "  same key. The server serves it at:"
  say "    /apk/${APK_NAME}"

  if [ -n "${SPORE_JSON_OUT:-}" ]; then
    printf '%s\n' "{\"version\":\"$TARGET_VERSION\",\"versionCode\":$VERSION_CODE,\"file\":\"$dest\",\"apk\":\"$APK_NAME\",\"sha256\":\"$sha\",\"signer\":\"$signer\"}" > "$SPORE_JSON_OUT"
    say "  wrote      $SPORE_JSON_OUT"
  fi
}

case "$MODE" in
  check)         run_check ;;
  init-keystore) run_init_keystore ;;
  build)         run_build ;;
esac
