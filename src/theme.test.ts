/**
 * The theme resolves the Plus appearance ONCE, at module load, so the thing
 * worth testing is exactly that: what the meta table said becomes what the
 * exported tokens are, and a garbage value still yields the brand.
 *
 * `@/db` is mocked because the real one opens SQLite at import time — which is
 * also the point of the first test: importing `@/theme` must not explode.
 */
const meta: Record<string, string | null> = { themeAccent: 'purple', themeOled: '1' };

jest.mock('@/db', () => ({
  getMeta: (key: string) => meta[key] ?? null,
  setMeta: (key: string, value: string) => {
    meta[key] = value;
  },
}));

import { ACCENTS, appliedAccent, appliedOled, colors, onAccent } from '@/theme';

test('the saved accent becomes every "act" token', () => {
  expect(appliedAccent()).toBe('purple');
  expect(colors.yellow).toBe(ACCENTS.purple);
  expect(colors.status.watching).toBe(ACCENTS.purple);
  // Semantics that are not the accent stay put.
  expect(colors.green).toBe('#78BE3D');
  expect(colors.blue).toBe('#2E65F2');
});

test('OLED darkens the surfaces but never the background', () => {
  expect(appliedOled()).toBe(true);
  expect(colors.bg).toBe('#000000');
  expect(colors.panel).toBe('#0A0A0B');
  expect(colors.card).toBe('#101012');
});

test('ink on the accent stays readable', () => {
  expect(onAccent(ACCENTS.yellow)).toBe('#141414');
  expect(onAccent(ACCENTS.purple)).toBe('#FFFFFF');
});

test('an unknown accent falls back to the brand', () => {
  meta.themeAccent = 'chartreuse';
  meta.themeOled = '0';
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const t = require('@/theme') as typeof import('@/theme');
    expect(t.appliedAccent()).toBe('yellow');
    expect(t.colors.yellow).toBe('#FFD400');
    expect(t.colors.panel).toBe('#141416');
  });
});
