/**
 * The `a11y` namespace — the screen-reader labels — against the source.
 *
 * `locales.test.ts` already proves the six files agree with each other key for
 * key. This proves the SCREENS agree with them: a label typed as a key no file
 * holds renders as the raw key, and nobody sighted would ever notice that a
 * VoiceOver label is wrong. No JSX is parsed here — a `'a11y.…'` literal is
 * all a label needs to be, and all this needs to find.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { SUPPORTED } from './locale-resolve';

const load = (l: string): { a11y?: Record<string, unknown> } =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(`./locales/${l}.json`) as { a11y?: Record<string, unknown> };

/** Every .ts/.tsx under `dir`, tests and the locale files left out. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'locales' && name !== '__mocks__') out.push(...sources(p));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const usedKeys = (): Set<string> => {
  const used = new Set<string>();
  for (const file of sources(__dirname)) {
    // Quotes only: a backticked `a11y.ts` in a comment is a file, not a key.
    for (const m of readFileSync(file, 'utf8').matchAll(/['"]a11y\.([A-Za-z0-9_.]+)['"]/g)) used.add(m[1]!);
  }
  return used;
};

describe('a11y labels', () => {
  const en = load('en').a11y;

  it('exist as a namespace in every locale, with the same keys', () => {
    expect(en).toBeDefined();
    const reference = Object.keys(en!).sort();
    expect(reference.length).toBeGreaterThan(0);
    for (const locale of SUPPORTED) {
      expect({ locale, keys: Object.keys(load(locale).a11y ?? {}).sort() }).toEqual({ locale, keys: reference });
    }
  });

  it('every a11y key the source uses is in en.json', () => {
    const missing = [...usedKeys()].filter((k) => !(k in en!));
    expect(missing).toEqual([]);
  });

  it('every a11y key in en.json is used somewhere — a label nobody reads is a translation nobody needed', () => {
    const used = usedKeys();
    const dead = Object.keys(en!).filter((k) => !used.has(k));
    expect(dead).toEqual([]);
  });
});
