/**
 * Our TV Time — theme v3 (see design/index.html in the repo root).
 * Rules: yellow ACTS · green CONFIRMS · blue LINKS · status colors REPORT.
 * Active bottom tab is white. System font only.
 *
 * PLUS APPEARANCE — accent + OLED, RESOLVED ONCE AT MODULE LOAD.
 *
 * `colors.yellow` is the "act" token: every button, CTA and active state reads
 * it as a plain string at import time, and the React Compiler memoises those
 * reads against their arguments. A live swap would therefore half-apply — some
 * screens repainted, some not — so the chosen accent is baked in here before
 * the first render and a change takes effect on the NEXT launch. The Appearance
 * screen says so. Do not turn this into a context or a hook; that is the same
 * mistake in a costlier shape.
 *
 * Init order: this module reads `@/db`, which imports nothing from here (it
 * imports expo-sqlite, `@/pure`, `@/seed`), so there is no cycle. The read is
 * wrapped because a theme must never be the reason the app fails to boot — a
 * missing table just means "default look".
 */
import type { TextStyle } from 'react-native';

import { getMeta, setMeta } from '@/db';

/** The accent set. Yellow is the brand; the rest are the Plus choices. */
export const ACCENTS = {
  yellow: '#FFD400',
  orange: '#FF8A1E',
  red: '#E5484D',
  pink: '#FF4D8D',
  purple: '#8B5CF6',
  blue: '#3B82F6',
  green: '#4ADE6A',
  teal: '#14C8B8',
} as const;

export type AccentName = keyof typeof ACCENTS;

export const ACCENT_NAMES = Object.keys(ACCENTS) as AccentName[];
export const DEFAULT_ACCENT: AccentName = 'yellow';

/** OLED surfaces: the background is already pure black, these go near-black. */
const OLED_SURFACES = { panel: '#0A0A0B', card: '#101012' } as const;
const NORMAL_SURFACES = { panel: '#141416', card: '#1C1C1E' } as const;

const ACCENT_KEY = 'themeAccent';
const OLED_KEY = 'themeOled';

function readMeta(key: string): string | null {
  try {
    return getMeta(key);
  } catch {
    return null;
  }
}

function isAccent(name: string | null): name is AccentName {
  return name !== null && name in ACCENTS;
}

/**
 * THE ACCENT MAY BE A COLOUR NOBODY NAMED.
 *
 * The eight are a menu; a profile theme taken from a show's artwork is an
 * arbitrary hex, and it must be able to become the app's accent too — a user
 * who themes their profile on Adventure Time and then sees a pink bell on a
 * blue profile has two settings where they thought they had one. So the stored
 * value is either one of the eight names or a literal `#RRGGBB`.
 */
const savedAccent = readMeta(ACCENT_KEY);
/*
 * AND IT IS ONLY PAINTED IF THEY ARE STILL PLUS.
 *
 * A custom hex only ever gets here from a profile theme, which is a Plus
 * feature — so when the subscription ends the app has to stop wearing it, the
 * same way the profile reverts to the default page. Without this line the
 * profile went back to plain black while the tab bar, the buttons and the
 * filter chips kept the old colour: the one visible reminder of a tier they
 * no longer have, everywhere except the screen it belongs to.
 *
 * THE EIGHT NAMED ACCENTS ARE NOT TOUCHED. Choosing one of those is an
 * appearance setting and always has been free; what Plus buys is a colour
 * pulled out of artwork, which is the arbitrary hex.
 *
 * Read straight from meta rather than through `@/plus`, because this runs at
 * module load — before React, before the purchases module has configured
 * anything — and `plus.ts` reads the very same key for the same reason. The
 * key is duplicated deliberately and named on both sides.
 */
const entitled = readMeta('plusEntitled') === '1';
const customAccent =
  entitled && savedAccent !== null && /^#[0-9A-F]{6}$/i.test(savedAccent) ? savedAccent.toUpperCase() : null;
const accent: AccentName = isAccent(savedAccent) ? savedAccent : DEFAULT_ACCENT;
/** The hex actually painted — the custom one if there is one, else the named. */
const accentHex: string = customAccent ?? ACCENTS[accent];
const oled = readMeta(OLED_KEY) === '1';
const surfaces = oled ? OLED_SURFACES : NORMAL_SURFACES;

/**
 * Readable ink for a given accent — dark on the light ones, white on the deep
 * ones. Computed rather than tabulated so adding an accent is one line.
 */
export function onAccent(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? '#141414' : '#FFFFFF';
}

/** What the app is actually painted with right now (i.e. at launch). */
export function appliedAccent(): AccentName {
  return accent;
}

/** The painted hex, named or not. `null` when it is one of the eight. */
export function appliedCustomAccent(): string | null {
  return customAccent;
}

export function appliedOled(): boolean {
  return oled;
}

/** Persisted for the NEXT launch. Callers tell the user that. */
export function setThemeAccent(name: AccentName): void {
  setMeta(ACCENT_KEY, name);
}

/**
 * Paint the app in a colour taken from artwork, from the next launch. Called
 * when a profile theme is chosen, so that one choice moves everything: the
 * profile is themed immediately (it is data), the app follows on reopen (it is
 * a stylesheet). Passing null returns to the last NAMED accent.
 */
export function setThemeAccentHex(hex: string | null): void {
  setMeta(ACCENT_KEY, hex ?? DEFAULT_ACCENT);
}

export function setThemeOled(on: boolean): void {
  setMeta(OLED_KEY, on ? '1' : '0');
}

export const colors = {
  bg: '#000000',
  panel: surfaces.panel,
  card: surfaces.card,
  raise: oled ? '#1A1A1D' : '#26262A',
  line: oled ? '#1E1E22' : '#2A2A2E',
  pillGrey: '#3A3A3E',

  /** The accent. Named `yellow` because every screen already calls it that. */
  yellow: accentHex,
  onYellow: onAccent(accentHex),
  green: '#78BE3D',
  blue: '#2E65F2',

  text: '#FFFFFF',
  dim: '#A7A7AE',
  faint: '#6B6B72',

  checkIdle: '#E9E9EC',
  checkIdleGlyph: '#A0A0A6',

  placeholder: '#4A5CE8',
  placeholderDeep: '#303FA8',

  status: {
    // "watching" is the accent by design — it is the app's own activity.
    watching: accentHex,
    upToDate: '#78BE3D',
    finished: '#7C3AED',
    stopped: '#E5484D',
  },

  danger: '#E5484D',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  poster: 3,
  card: 10,
  pill: 999,
} as const;

export const type = {
  title: { fontSize: 26, lineHeight: 30, fontWeight: '800', color: colors.text },
  section: { fontSize: 20, lineHeight: 24, fontWeight: '800', color: colors.text },
  epCode: { fontSize: 17, lineHeight: 22, fontWeight: '800', color: colors.text },
  plus: { fontSize: 12, fontWeight: '600', color: colors.dim },
  stat: { fontSize: 32, lineHeight: 36, fontWeight: '800', fontVariant: ['tabular-nums'], color: colors.text },
  body: { fontSize: 15, lineHeight: 21, color: colors.text },
  caption: { fontSize: 13, lineHeight: 17, fontVariant: ['tabular-nums'], color: colors.dim },
  label: {
    fontSize: 13.5,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.faint,
  },
} satisfies Record<string, TextStyle>;
