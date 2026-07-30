import { formatCount, isRtlLocale, resolveLocale, SUPPORTED } from './locale-resolve';

describe('resolveLocale', () => {
  it('prefers an explicit override over the device', () => {
    expect(resolveLocale('ar', ['en-GB'])).toBe('ar');
  });

  it('uses the device language when there is no override', () => {
    expect(resolveLocale(null, ['es-MX', 'en-US'])).toBe('es');
  });

  it('matches a regional file exactly before falling back to its language', () => {
    // pt-BR ships; pt-PT does not, and must not silently become Brazilian
    expect(resolveLocale(null, ['pt-BR'])).toBe('pt-BR');
    expect(resolveLocale(null, ['pt-PT'])).toBe('en');
  });

  it('walks the device list rather than giving up on the first miss', () => {
    expect(resolveLocale(null, ['de-DE', 'it-IT'])).toBe('it');
  });

  it('falls back to English for anything unsupported', () => {
    expect(resolveLocale(null, ['ja-JP'])).toBe('en');
    expect(resolveLocale(null, [])).toBe('en');
  });

  it('ignores an override naming a locale that is not shipped', () => {
    expect(resolveLocale('ja', ['it-IT'])).toBe('it');
  });
});

describe('isRtlLocale', () => {
  it('is true for Arabic only', () => {
    expect(isRtlLocale('ar')).toBe(true);
    for (const l of SUPPORTED.filter((x) => x !== 'ar')) {
      expect(isRtlLocale(l)).toBe(false);
    }
  });
});

describe('formatCount', () => {
  // Guards the one rule that matters here: pass the APP's locale, never the
  // device's or a hardcoded 'en-US'. es/it/pt-BR group with '.' where en uses
  // ',' — a regression back to a hardcoded locale would flatten this to one
  // shared format again.
  it('uses the target language grouping/decimal marks, not a fixed one', () => {
    expect(formatCount(1234567, 'en')).toBe('1,234,567');
    expect(formatCount(1234567, 'es')).toBe('1.234.567');
    expect(formatCount(1234567, 'it')).toBe('1.234.567');
    expect(formatCount(1234567, 'pt-BR')).toBe('1.234.567');
  });

  it('formats Arabic with Western digits under this project\'s ICU (see task-13 report)', () => {
    expect(formatCount(1234567, 'ar')).toBe('1,234,567');
  });

  it('groups French with a narrow no-break space, not a plain space', () => {
    // U+202F, not U+0020 — visually similar but a real distinction Intl makes on its own.
    expect(formatCount(1234567, 'fr')).toBe('1 234 567');
  });
});
