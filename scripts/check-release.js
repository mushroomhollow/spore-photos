#!/usr/bin/env node
/**
 * The gate on a release: the things that must be true before it is tagged.
 *
 *   node scripts/check-release.js
 *
 * It exists because every one of these mistakes is silent otherwise, and surfaces
 * as a confusing message on somebody else's server:
 *
 *   - a release with no notes          → the panel shows a version and no explanation
 *   - a migration with `migrations:false` → nobody is warned to back up
 *   - `migrations:true` with no migration file → a warning about nothing
 *   - a breaking release with no way in (minFrom) or nothing to do (Action required)
 *   - release.json edited by hand      → the panel and the notes disagree
 *   - two migrations for one release   → an arbitrary order on a real database
 *
 * Wired into the release process (maintainer-side `release.sh`, which is not part
 * of this repository) and into `check-version-sync.sh`, which lives beside it.
 */

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const notes = require('./lib/release-notes');
const semver = require('../spore-photos-server/lib/semver');

const problems = [];
const oks = [];
const problem = (message) => problems.push(message);
const ok = (message) => oks.push(message);

const version = fs.readFileSync(path.join(notes.REPO_ROOT, 'VERSION'), 'utf8').trim().replace(/^v/, '');

// ── every notes file is readable, whatever version it describes ──────────────
for (const v of notes.listVersions()) {
  if (!semver.isVersion(v)) problem(`releases/${v}.md: ${v} is not a MAJOR.MINOR.PATCH version`);
  try {
    const parsed = notes.read(v);
    if (!parsed.summary) problem(`releases/${v}.md: needs a "${notes.SUMMARY_SECTION}" section — it is what the operator reads`);
    if (String(parsed.data.version).replace(/^v/, '') !== v) {
      problem(`releases/${v}.md: front matter says version ${parsed.data.version}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(parsed.data.released))) {
      problem(`releases/${v}.md: released: must be YYYY-MM-DD`);
    }
  } catch (error) {
    problem(error.message);
  }
}

// ── the version in VERSION has notes ────────────────────────────────────────
let current = null;
try {
  current = notes.read(version);
  ok(`releases/${version}.md exists and parses`);
} catch (error) {
  problem(error.message);
}

if (current) {
  const upgrade = current.data.upgrade || {};

  // migrations: the flag and the file must agree, in both directions
  const migrationsDir = path.join(notes.REPO_ROOT, 'spore-photos-server', 'db', 'migrations');
  const files = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
    : [];
  const mine = files.filter((f) => f.startsWith(`${version}-`));
  const otherVersioned = files.filter((f) => !f.startsWith(`${version}-`) && /^\d+\.\d+\.\d+-/.test(f));

  if (mine.length > 1) {
    problem(`db/migrations has ${mine.length} files for ${version} (${mine.join(', ')}) — one script per release, fold them into one`);
  }
  if (mine.length && upgrade.migrations !== true) {
    problem(`db/migrations/${mine[0]} exists for ${version} but the notes do not set upgrade.migrations: true — nothing warns the operator to back up`);
  }
  if (!mine.length && upgrade.migrations === true) {
    problem(`releases/${version}.md declares upgrade.migrations: true but there is no db/migrations/${version}-*.sql`);
  }
  for (const file of otherVersioned) {
    // Older migrations may stay in place: an applied migration is the record of
    // what ran, and relocating it must not fail every later release. Only a
    // migration from a *newer* release is a mistake — that file belongs to a tree
    // that has not shipped yet.
    const fileVersion = file.split('-')[0];
    if (semver.compare(fileVersion, version) === 1) {
      problem(`db/migrations/${file} belongs to a release newer than this tree (${version})`);
    }
  }
  if (mine.length) ok(`migration for ${version}: ${mine[0]}`);

  // a breaking release has to say how to get in, and what to do
  if (upgrade.breaking === true) {
    if (!upgrade.minFrom) {
      problem(`releases/${version}.md is breaking but sets no upgrade.minFrom — an install older than that has no path`);
    } else if (!semver.isVersion(String(upgrade.minFrom))) {
      problem(`releases/${version}.md: upgrade.minFrom "${upgrade.minFrom}" is not a version`);
    } else if (semver.compare(String(upgrade.minFrom), version) !== -1) {
      problem(`releases/${version}.md: upgrade.minFrom ${upgrade.minFrom} must be older than ${version}`);
    }
    const action = current.action.replace(/\s+/g, ' ').trim();
    if (!action || /^none\.?$/i.test(action)) {
      problem(`releases/${version}.md is breaking but its "${notes.ACTION_SECTION}" section is empty — say what the operator must do`);
    }
  }

  // the app and the shell are versioned separately, and only rebuilt on purpose
  const android = current.data.android || {};
  if (android.rebuild === true && String(android.version).replace(/^v/, '') !== version) {
    problem(`releases/${version}.md rebuilds the Android shell but says android.version ${android.version}`);
  }

  // release.json is generated, so it must match what the notes produce
  const releasePath = path.join(notes.REPO_ROOT, 'release.json');
  if (fs.existsSync(releasePath)) {
    const committed = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
    try {
      assert.deepStrictEqual(committed, notes.toReleaseJson(version));
      ok('release.json matches the notes for this release');
    } catch {
      problem('release.json does not match releases/' + version + '.md — ran it by hand? Run: node scripts/build-release-json.js');
    }
    if (committed.version !== version) {
      problem(`release.json says version ${committed.version} but VERSION is ${version}`);
    }
  }

  // the developer-facing log still has to mention it
  const changelog = fs.readFileSync(path.join(notes.REPO_ROOT, 'CHANGELOG.md'), 'utf8');
  if (!new RegExp(`^##\\s*\\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(changelog)) {
    problem(`CHANGELOG.md has no "## [${version}]" section`);
  } else {
    ok(`CHANGELOG.md has a section for ${version}`);
  }
}

// ── the Android build agrees with the Android project ───────────────────────
// Whether an APK can be built at all is decided by two hand-maintained values in
// two files, and nothing used to connect them: the compile SDK the project wants
// (variables.gradle) and the platform the builder image installs
// (docker/Dockerfile.builder). Disagree, and Gradle downloads the missing platform
// at build time and fails with "The SDK directory is not writable" — a message
// about permissions, for a problem that is a version mismatch.
//
// Build-tools is deliberately not tied to the compile SDK: it is the Android
// Gradle Plugin's own default (35.0.0 for AGP 8.13.0), so it is asserted at a
// recorded value instead of being inferred from the platform. Bump this only when
// the plugin in android/build.gradle moves.
const AGP_BUILD_TOOLS = '35.0.0';

const variablesGradle = path.join(notes.REPO_ROOT, 'spore-photos-mobile', 'android', 'variables.gradle');
const builderDockerfile = path.join(notes.REPO_ROOT, 'docker', 'Dockerfile.builder');
if (fs.existsSync(variablesGradle) && fs.existsSync(builderDockerfile)) {
  const compileSdk = (/compileSdkVersion\s*=\s*(\d+)/.exec(fs.readFileSync(variablesGradle, 'utf8')) || [])[1];
  const dockerfile = fs.readFileSync(builderDockerfile, 'utf8');
  const platform = (/^ARG ANDROID_PLATFORM=(\S+)/m.exec(dockerfile) || [])[1];
  const buildTools = (/^ARG ANDROID_BUILD_TOOLS=(\S+)/m.exec(dockerfile) || [])[1];

  if (!compileSdk) {
    problem('spore-photos-mobile/android/variables.gradle has no compileSdkVersion to check the builder image against');
  } else if (platform !== `android-${compileSdk}`) {
    problem(`docker/Dockerfile.builder installs ${platform} but the project compiles against API ${compileSdk} (variables.gradle) — Gradle would fetch the platform at build time and fail on the SDK directory`);
  } else {
    ok(`the builder image's platform matches compileSdkVersion ${compileSdk}`);
  }

  if (buildTools !== AGP_BUILD_TOOLS) {
    problem(`docker/Dockerfile.builder installs build-tools ${buildTools}; the Gradle plugin wants ${AGP_BUILD_TOOLS} (a newer build-tools does not replace it) — update AGP_BUILD_TOOLS in scripts/check-release.js if the plugin changed`);
  } else {
    ok(`the builder image's build-tools is ${AGP_BUILD_TOOLS}, as the plugin requires`);
  }
}

// ── report ──────────────────────────────────────────────────────────────────
for (const line of oks) console.log(`  ok    ${line}`);
for (const line of problems) console.log(`  FAIL  ${line}`);

if (problems.length) {
  console.log(`\n  ${problems.length} problem${problems.length === 1 ? '' : 's'} to fix before this release can be tagged.`);
  process.exit(1);
}

console.log(`\n  Release ${version} checks out.`);
