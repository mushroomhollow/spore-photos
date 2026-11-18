#!/usr/bin/env node
/**
 * Write release.json from releases/<version>.md.
 *
 *   node scripts/build-release-json.js            # for the version in VERSION
 *   node scripts/build-release-json.js 2.1.0      # for a specific release
 *   node scripts/build-release-json.js --dry-run  # print it, write nothing
 *
 * release.json is the file another install fetches when an operator points their
 * server at this repo's copy of it. It is generated, never hand-edited: the
 * release notes are the source, so the panel text, the upgrade flags and the
 * docs cannot drift apart.
 *
 * Run by the maintainer-side release process (`release.sh`, which lives outside
 * this repository) as part of cutting a release, and by `check-release.js` to
 * detect drift.
 */

const fs = require('fs');
const path = require('path');
const notes = require('./lib/release-notes');

const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const dryRun = process.argv.includes('--dry-run');

const version = (args[0] || fs.readFileSync(path.join(notes.REPO_ROOT, 'VERSION'), 'utf8')).trim().replace(/^v/, '');
const target = path.join(notes.REPO_ROOT, 'release.json');

let json;
try {
  json = notes.toReleaseJson(version);
} catch (error) {
  console.error(`  ${error.message}`);
  process.exit(1);
}

const text = `${JSON.stringify(json, null, 2)}\n`;

if (dryRun) {
  process.stdout.write(text);
  process.exit(0);
}

fs.writeFileSync(target, text);
console.log(`  release.json  version ${json.version} (${json.released})`);
console.log(`                notes    ${json.notes ? `${json.notes.slice(0, 60)}${json.notes.length > 60 ? '…' : ''}` : `EMPTY — write a "${notes.SUMMARY_SECTION}" section`}`);
console.log(`                upgrade  breaking=${json.upgrade.breaking} migrations=${json.upgrade.migrations} backupFirst=${json.upgrade.backupFirst}${json.upgrade.minFrom ? ` minFrom=${json.upgrade.minFrom}` : ''}`);
console.log(`                android  version ${json.android.version}, rebuild=${json.android.rebuild}`);
