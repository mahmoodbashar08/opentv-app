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

describe('the light theme', () => {
  /*
   * A LIGHT THEME IS NOT THE DARK ONE INVERTED, and these pin the three places
   * a literal inversion goes wrong. Requested by a subscriber who said the dark
   * theme was "kind of difficult" for them — an accessibility report, not a
   * preference, which is why it ships free rather than as a Plus feature.
   *
   * The palette is resolved at module load, so a test can only see the scheme
   * this run was launched in. What it CAN check is the shape of the rules,
   * which is where the mistakes live.
   */
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { colors } = require('./theme') as typeof import('./theme');

  const lum = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  it('never paints text the same colour as the page', () => {
    // The single failure that makes an app unusable rather than ugly.
    expect(colors.text.toLowerCase()).not.toBe(colors.bg.toLowerCase());
  });

  it('keeps text and background far apart', () => {
    // Not a full WCAG ratio — the point is that one is ink and one is paper,
    // whichever scheme this run resolved to.
    expect(Math.abs(lum(colors.text) - lum(colors.bg))).toBeGreaterThan(0.5);
  });

  it('orders text, dim and faint by prominence', () => {
    /*
     * `dim` and `faint` are quieter than `text` in BOTH themes — which means
     * darker on paper and lighter on black. Inverting the dark values literally
     * would have made faint the LOUDEST colour on a light page, and every
     * caption would have shouted.
     */
    const ink = lum(colors.text) < lum(colors.bg); // dark ink on light paper
    const quieter = (a: string, b: string) => (ink ? lum(a) < lum(b) : lum(a) > lum(b));
    expect(quieter(colors.text, colors.dim)).toBe(true);
    expect(quieter(colors.dim, colors.faint)).toBe(true);
  });

  it('has overlay tokens that lift and sink rather than always whitening', () => {
    // The commonest hardcoded value in the app is rgba(255,255,255,0.05) —
    // invisible on paper. These exist so the sweep is mechanical.
    expect(colors.lift).toMatch(/^rgba\(/);
    expect(colors.sink).toMatch(/^rgba\(/);
    expect(colors.lift).not.toBe(colors.sink);
  });
});

describe('the accent on paper', () => {
  /*
   * On black, yellow is the brightest thing on screen and carries every action.
   * On white it is the dimmest — a yellow button on a white page has almost no
   * contrast and yellow text on white is unreadable at any size. So in light
   * mode the accent token becomes ink and every filled control turns
   * black-on-white at once, which is what a light theme actually looks like.
   *
   * 244 call sites paint with this token. If it ever stops being readable
   * against its own foreground, all 244 break together.
   */
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { colors } = require('./theme') as typeof import('./theme');

  const lum = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  it('is readable against its own foreground', () => {
    expect(Math.abs(lum(colors.yellow) - lum(colors.onYellow))).toBeGreaterThan(0.4);
  });

  it('stands out from the page it sits on', () => {
    // A filled button the same brightness as the background is not a button.
    expect(Math.abs(lum(colors.yellow) - lum(colors.bg))).toBeGreaterThan(0.3);
  });

  it('keeps the brand colour available even when the accent is overridden', () => {
    // `brand` is the accent as chosen, for thin marks and identity. Losing it
    // would mean the light theme had no yellow in it anywhere.
    expect(colors.brand).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(Math.abs(lum(colors.brand) - lum(colors.onBrand))).toBeGreaterThan(0.4);
  });
});
