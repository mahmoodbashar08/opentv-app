import { SUPPORTED } from './locale-resolve';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { I18n, useMakePlural } from 'i18n-js';
import { ar as arPluralRule, fr as frPluralRule } from 'make-plural';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { leaves, isPluralLeaf, getAtPath } = require('./locale-keys') as {
  leaves: (obj: Record<string, unknown>, prefix?: string) => string[];
  isPluralLeaf: (value: unknown) => boolean;
  getAtPath: (obj: Record<string, unknown>, path: string) => unknown;
};

const load = (l: string): Record<string, unknown> =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(`./locales/${l}.json`) as Record<string, unknown>;

describe('locale files', () => {
  const reference = leaves(load('en')).sort();

  it('has a reference set to compare against', () => {
    expect(reference.length).toBeGreaterThan(0);
  });

  for (const locale of SUPPORTED.filter((l) => l !== 'en')) {
    it(`${locale} has exactly the keys en has`, () => {
      const theirs = leaves(load(locale)).sort();
      // named separately so the failure says WHICH keys, not just "not equal"
      const missing = reference.filter((k) => !theirs.includes(k));
      const extra = theirs.filter((k) => !reference.includes(k));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });
  }

  for (const locale of SUPPORTED) {
    it(`${locale} has valid plural shapes for every plural leaf`, () => {
      // A plural leaf in the reference locale must be a plural leaf in every
      // locale too (each with its own arity — Arabic may carry more forms
      // than English needs) — and a flat-string leaf must stay a flat string.
      // This is what catches "Arabic forgot to pluralise" as well as
      // "someone accidentally nested an object where a flat string belongs".
      const theirs = load(locale);
      const mismatched = reference.filter((path) => {
        const refIsPlural = isPluralLeaf(getAtPath(load('en'), path));
        const theirsIsPlural = isPluralLeaf(getAtPath(theirs, path));
        return refIsPlural !== theirsIsPlural;
      });
      expect(mismatched).toEqual([]);
    });
  }

  // Mirrors src/i18n.ts's pluralizer wiring exactly (same `useMakePlural` +
  // same `ar` CLDR rule, registered the same way), so this test asks the SAME
  // pluralizer the app runs at runtime instead of hardcoding a CLDR category
  // table that could silently drift from the real registration.
  const pluralI18n = new I18n({});
  pluralI18n.pluralization.register('ar', useMakePlural({ pluralizer: arPluralRule }));
  pluralI18n.pluralization.register('fr', useMakePlural({ pluralizer: frPluralRule }));

  // Every count from 0-200: enough to hit every CLDR Arabic boundary (zero,
  // one, two, few 3-10, many 11-99, other) AND its n%100 repeats across
  // hundreds (103, 111, 200...), without relying on a curated boundary list
  // that could miss a case.
  const SAMPLE_COUNTS = Array.from({ length: 201 }, (_, n) => n);

  for (const locale of SUPPORTED) {
    it(`${locale} plural sets have exactly the categories its pluralizer can produce`, () => {
      // For every plural leaf, walk the same candidate-key list
      // i18n-js's pluralize() walks (see helpers/pluralize.js) and record,
      // per count, which key actually resolves. A category present in the
      // JSON that never resolves for any sampled count is dead weight; a
      // count that resolves to nothing (every candidate key absent from the
      // JSON) is exactly the "[missing ... zero]" bug this test exists to
      // catch.
      const data = load(locale);
      const problems: string[] = [];

      for (const path of reference) {
        const value = getAtPath(data, path);
        if (!isPluralLeaf(value)) continue; // shape mismatches are caught above

        const forms = value as Record<string, string>;
        const available = Object.keys(forms);
        const reached = new Set<string>();

        for (const count of SAMPLE_COUNTS) {
          const candidates = pluralI18n.pluralization.get(locale)(pluralI18n, count);
          const match = candidates.find((key) => available.includes(key));
          if (match) {
            reached.add(match);
          } else {
            problems.push(
              `${locale}.${path}: count=${count} resolves to nothing (tried [${candidates.join(', ')}], has [${available.join(', ')}])`,
            );
          }
        }

        const unreachable = available.filter((key) => !reached.has(key));
        for (const key of unreachable) {
          problems.push(`${locale}.${path}: "${key}" is never selected by the ${locale} pluralizer — dead category`);
        }
      }

      expect(problems).toEqual([]);
    });
  }

  for (const locale of SUPPORTED) {
    it(`${locale} has no empty strings`, () => {
      const data = load(locale);
      const empty = reference.filter((path) => {
        const value = getAtPath(data, path);
        if (isPluralLeaf(value)) {
          // reach inside the plural object — a blank `few` form is exactly
          // as broken as a blank flat string
          return Object.values(value as Record<string, unknown>).some(
            (form) => typeof form === 'string' && form.trim() === '',
          );
        }
        return typeof value === 'string' && value.trim() === '';
      });
      expect(empty).toEqual([]);
    });
  }

  /**
   * A PLACEHOLDER WITH ONE BRACE IS A LITERAL, and it ships as one.
   *
   * `t()` substitutes `{{name}}`. `{name}` looks identical while reading the
   * file, matches nothing, and reaches the user verbatim — a sign-in dialog
   * went out reading "This address already signs in with {provider}". Nothing
   * else catches it: the string is present, non-empty, and typed.
   */
  for (const locale of SUPPORTED) {
    it(`${locale} has no single-brace placeholders`, () => {
      const data = load(locale);
      const strings = (v: unknown): string[] =>
        typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
      const bad = strings(data).filter((v) => /(^|[^{]){[A-Za-z_][A-Za-z0-9_]*}/.test(v));
      expect(bad).toEqual([]);
    });
  }

  it('keys.d.ts is in sync with en.json', () => {
    // Derive expected keys from en.json exactly like the generator does
    const expectedKeys = leaves(load('en')).sort();

    // Read keys.d.ts and extract all double-quoted strings
    const typeDefPath = resolve(dirname(__filename), './locales/keys.d.ts');
    const typeDef = readFileSync(typeDefPath, 'utf8');

    // Extract keys from the union type: match double-quoted JSON string literals
    // Regex handles escapes: /"((?:[^"\\]|\\.)*)"/g
    const extractedKeys = (typeDef.match(/"((?:[^"\\]|\\.)*?)"/g) || [])
      .map((m) => JSON.parse(m)) // decode escape sequences
      .sort();

    // Compare sets
    const missing = expectedKeys.filter((k) => !extractedKeys.includes(k));
    const extra = extractedKeys.filter((k) => !expectedKeys.includes(k));

    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `keys.d.ts is out of sync with en.json.\n` +
          (missing.length > 0 ? `Missing from keys.d.ts: ${missing.join(', ')}\n` : '') +
          (extra.length > 0 ? `Extra in keys.d.ts: ${extra.join(', ')}\n` : '') +
          `Run: npm run i18n:types`,
      );
    }
  });
});
