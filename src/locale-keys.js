// src/locale-keys.js
//
// Shared leaf-walking logic for the locale JSON files. Used by both
// scripts/gen-locale-types.mjs (plain ESM, run via node) and
// src/locales.test.ts (ts-jest, compiled to CommonJS). Plain JS with
// CommonJS exports is the least awkward format that both can import:
// Node's ESM loader statically detects this file's named exports, and
// ts-jest's CommonJS output can `require()` it directly.
//
// Do not add TypeScript, JSX, or anything that needs transpilation here —
// the whole point is that it loads with zero build step in either runtime.

/** The CLDR plural categories i18n-js (via i18n.t(key, { count })) selects between. */
const CLDR_PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

/**
 * True when `value` is a plural-form object: a non-null, non-array object
 * whose keys are a non-empty subset of the CLDR plural category set.
 *
 * Locales are allowed to use a different subset of categories than the
 * reference locale (e.g. Arabic legitimately uses all six; English needs
 * only `one`/`other`) — this only checks shape, not which categories.
 */
function isPluralLeaf(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => CLDR_PLURAL_CATEGORIES.includes(k));
}

/**
 * Every leaf path in a locale JSON object, e.g. "settings.account.username".
 *
 * A plural-form object (see isPluralLeaf) is treated as ONE leaf, emitted at
 * its PARENT path — the call site does `t('stats.shows.onShows', { count })`,
 * never `t('stats.shows.onShows.other')`, so the parent path is the one
 * that must appear in the generated key union and in parity checks.
 */
function leaves(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isPluralLeaf(v)) return [path];
    if (typeof v === 'object' && v !== null) return leaves(v, path);
    return [path];
  });
}

/** Read the value at a dot-separated path, e.g. "stats.shows.onShows". */
function getAtPath(obj, path) {
  return path.split('.').reduce((o, part) => (o == null ? undefined : o[part]), obj);
}

module.exports = { CLDR_PLURAL_CATEGORIES, isPluralLeaf, leaves, getAtPath };
