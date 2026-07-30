/**
 * Proves, at runtime, that French plural selection actually works — not just
 * that the types compile. Same rationale as i18n-plural.test.ts (which does
 * this for Arabic): src/i18n.ts can't be imported directly here because it
 * pulls in expo-localization and react-native, neither of which run in this
 * plain-Node jest environment (see jest.config.js). So this test builds a
 * real I18n instance straight from i18n-js, using the exact fr.json data and
 * the exact French pluralizer registration i18n.ts uses, and calls the real
 * translate/pluralize code path — the thing under doubt.
 *
 * French is the one an English speaker gets wrong in the other direction
 * from Arabic: it's "only" one/other, but 0 belongs to "one" ("0 film",
 * "1 film" vs "2 films"), not "other" like English's "0 films". Asserting
 * count = 0 here is the whole point of this file.
 */
import { I18n, useMakePlural } from 'i18n-js';
import { fr as frPluralRule } from 'make-plural';

import en from './locales/en.json';
import fr from './locales/fr.json';

describe('French plural selection at runtime', () => {
  const i18n = new I18n({ en, fr });
  i18n.enableFallback = true;
  i18n.defaultLocale = 'en';
  i18n.pluralization.register('fr', useMakePlural({ pluralizer: frPluralRule }));
  i18n.locale = 'fr';

  it('selects the CLDR category matching each count for stats.shows.onShows', () => {
    expect(i18n.t('stats.shows.onShows', { count: 0 })).toBe('sur 0 série');
    expect(i18n.t('stats.shows.onShows', { count: 1 })).toBe('sur 1 série');
    expect(i18n.t('stats.shows.onShows', { count: 2 })).toBe('sur 2 séries');
    expect(i18n.t('stats.shows.onShows', { count: 100 })).toBe('sur 100 séries');
  });

  it('selects the CLDR category matching each count for settings.app.reviewMatchedMoviesSub', () => {
    expect(i18n.t('settings.app.reviewMatchedMoviesSub', { count: 0 })).toBe(
      "0 film partage son nom avec un autre — vérifie qu'on a choisi le bon",
    );
    expect(i18n.t('settings.app.reviewMatchedMoviesSub', { count: 1 })).toBe(
      "1 film partage son nom avec un autre — vérifie qu'on a choisi le bon",
    );
    expect(i18n.t('settings.app.reviewMatchedMoviesSub', { count: 2 })).toBe(
      "2 films partagent leur nom avec d'autres — vérifie qu'on a choisi les bons",
    );
    expect(i18n.t('settings.app.reviewMatchedMoviesSub', { count: 100 })).toBe(
      "100 films partagent leur nom avec d'autres — vérifie qu'on a choisi les bons",
    );
  });

  it('would treat 0 as plural without the French pluralizer registered', () => {
    // Regression guard for the exact bug this task warns about: the
    // *default* i18n-js pluralizer buckets French 0 as "zero"/"other", not
    // "one" — so without registering the CLDR-accurate `fr` rule, count = 0
    // falls into the "other" (plural) form instead of "one" (singular).
    const unregistered = new I18n({ en, fr });
    unregistered.enableFallback = true;
    unregistered.defaultLocale = 'en';
    unregistered.locale = 'fr';

    expect(unregistered.t('stats.shows.onShows', { count: 0 })).toBe('sur 0 séries');
    expect(unregistered.t('stats.shows.onShows', { count: 0 })).not.toBe(
      i18n.t('stats.shows.onShows', { count: 0 }),
    );
  });
});
