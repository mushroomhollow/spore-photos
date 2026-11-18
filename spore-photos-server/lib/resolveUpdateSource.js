/**
 * Which release.json does this install follow?
 *
 * One source: the operator's own configuration. `UPDATE_SOURCE_URL` in the
 * environment, or `update.sourceUrl` in the config file — the environment wins,
 * as it does for every other setting here.
 *
 * There is deliberately no fallback and no default. An install has no release
 * source until its owner sets one: naming a repository in code would mean every
 * install quietly checking somewhere they never chose, and a web panel that
 * writes this value would be a second place for the same setting to live, able
 * to drift from the file.
 *
 * A value that is present but unusable (a typo, a `file:` URL) is reported and
 * treated as unset rather than fatal — the panel can then say the config file
 * needs fixing, instead of silently checking nothing. Keeping this a pure
 * function is what makes that rule testable without a config file.
 */

const { parseUpdateSource } = require('./updateSource');

/**
 * @param {object} input
 * @param {string} [input.configured] the value from config/env
 * @returns {{url: string, origin: 'config'|'unset', kind: string|null, skipped: Array<{origin: string, value: string}>}}
 */
function resolveUpdateSource({ configured } = {}) {
  const value = typeof configured === 'string' ? configured.trim() : '';

  if (!value) return { url: '', origin: 'unset', kind: null, skipped: [] };

  const parsed = parseUpdateSource(value);
  if (parsed) return { url: parsed.url, origin: 'config', kind: parsed.kind, skipped: [] };

  // Present but not usable: say so, and behave as if unset. Reporting beats
  // silently doing nothing, because the operator has to edit a file to fix it.
  return {
    url: '',
    origin: 'unset',
    kind: null,
    skipped: [{ origin: 'config', value }],
  };
}

module.exports = { resolveUpdateSource };
