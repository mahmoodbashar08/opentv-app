/**
 * Our TV Time — theme v3 (see design/index.html in the repo root).
 * Rules: yellow ACTS · green CONFIRMS · blue LINKS · status colors REPORT.
 * Active bottom tab is white. System font only.
 */
import type { TextStyle } from 'react-native';

export const colors = {
  bg: '#000000',
  panel: '#141416',
  card: '#1C1C1E',
  raise: '#26262A',
  line: '#2A2A2E',
  pillGrey: '#3A3A3E',

  yellow: '#FFD400',
  onYellow: '#141414',
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
    watching: '#FFD400',
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
