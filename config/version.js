// Single source of truth for the release version.
// Every component reports this same value so a mixed-version deployment is
// visible instead of silent.
const fs = require('fs');
const path = require('path');

module.exports = fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim();