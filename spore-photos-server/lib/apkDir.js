/**
 * Where an APK the server can actually deliver lives.
 *
 * The server's web root is `spore-photos-client/dist` (see index.js), so an APK
 * the server can hand to a phone lives in `dist/apk` — that is what a container
 * image has, because the image carries only the built client.
 *
 * A native build writes to `public/apk` instead: Vite copies `public/` into
 * `dist/` on the next client build, and `build-apk.sh` deletes the `dist/apk`
 * copy mid-build precisely so the app never packages its own previous APK. So
 * both locations are real, and which one exists is a fact about the install.
 *
 * Reading only `public/apk` is why every container install reported "no APK has
 * been built" while the file downloaded fine: a built image has no `public/`
 * directory at all. Both the listing and the static mount come from here, so
 * what the panel lists and what the server serves cannot disagree.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PUBLIC_APK_DIR = path.join(REPO_ROOT, 'spore-photos-client', 'public', 'apk');
const SERVED_APK_DIR = path.join(REPO_ROOT, 'spore-photos-client', 'dist', 'apk');

/**
 * The directory to read APKs from and serve them out of.
 *
 * `public/apk` wins when it actually holds a build, because that is where a build
 * on this host lands and — on a container install — the only directory that can
 * receive one (compose.yaml mounts it into the API). But an *empty* `public/apk`
 * must not hide a file: an install whose image baked an APK in before that mount
 * existed still serves it from `dist/apk`, and reporting "no APK" while the
 * download works is the failure this module exists to prevent.
 *
 * So: the first directory holding a versioned APK; failing both, `public/apk`,
 * which is where a build would put one.
 */
function resolve({ existsSync = fs.existsSync, readdirSync = fs.readdirSync } = {}) {
  const holdsApk = (dir) => {
    try {
      if (!existsSync(dir)) return false;
      return readdirSync(dir).some((name) => /^spore-photos-v.+\.apk$/.test(name));
    } catch {
      // Unreadable is not a reason to stop looking.
      return false;
    }
  };

  if (holdsApk(PUBLIC_APK_DIR)) return PUBLIC_APK_DIR;
  if (holdsApk(SERVED_APK_DIR)) return SERVED_APK_DIR;
  return PUBLIC_APK_DIR;
}

/** The directory's path as the repository describes it, for display. */
function describe(dir) {
  return path.relative(REPO_ROOT, dir) || dir;
}

module.exports = { resolve, describe, REPO_ROOT, PUBLIC_APK_DIR, SERVED_APK_DIR };
