/**
 * The app's language.
 *
 * The decision of WHICH language is pure and lives in locale-resolve.ts, with
 * tests. This file is the part that cannot be unit-tested: it reads the phone,
 * reads the database, and asks React Native to mirror the layout.
 */
import * as Localization from 'expo-localization';
import { I18n, useMakePlural } from 'i18n-js';
import { ar as arPluralRule, fr as frPluralRule } from 'make-plural';
import { I18nManager } from 'react-native';

import { getMeta, setMeta } from '@/db';
import { isRtlLocale, resolveLocale, type Locale } from '@/locale-resolve';
import type { LocaleKey } from '@/locales/keys';
import { needsDirectionChange } from '@/pure';

import ar from '@/locales/ar.json';
import en from '@/locales/en.json';
import es from '@/locales/es.json';
import fr from '@/locales/fr.json';
import it from '@/locales/it.json';
import ptBR from '@/locales/pt-BR.json';

const META_KEY = 'locale';

const i18n = new I18n({ en, ar, it, es, 'pt-BR': ptBR, fr });
i18n.enableFallback = true;
i18n.defaultLocale = 'en';

// The default pluralizer only distinguishes one/other, which is enough for
// en/it/es/pt-BR. Arabic legitimately needs all six CLDR categories (zero,
// one, two, few, many, other) — without this, e.g. count = 3 would fall
// through to whatever "other" form the JSON has, reading grammatically
// wrong. See make-plural's `ar` rule for the exact category boundaries.
i18n.pluralization.register('ar', useMakePlural({ pluralizer: arPluralRule }));

// French also needs its own rule: the default i18n-js table treats 0 as
// "zero"/"other", but real CLDR French puts 0 in "one" alongside 1 (0 and 1
// franc, but 2 francs) — get this wrong and "0 episode(s)" reads plural in a
// language where it shouldn't. make-plural's `fr` rule also has a "many"
// category for exact millions, which our locale files don't carry (no count
// in this app is ever an exact multiple of a million), so fr.json only uses
// one/other, same shape as it/es/pt-BR.
// useMakePlural is a plain factory function from i18n-js, not a React hook —
// same false positive already accepted for the 'ar' registration above.
// eslint-disable-next-line react-hooks/rules-of-hooks
i18n.pluralization.register('fr', useMakePlural({ pluralizer: frPluralRule }));

let active: Locale = 'en';

/** The user's Settings choice, or null when following the phone. */
function storedOverride(): string | null {
  return getMeta(META_KEY);
}

/**
 * Normalise a BCP-47 tag into the canonical casing our locale files use:
 * lowercase language subtag, uppercase region subtag ("pt-br" and "PT-BR"
 * both become "pt-BR"). Some older Android versions hand expo-localization
 * a lowercase regional tag; resolveLocale matches case-sensitively on
 * purpose, so normalisation has to happen here, before the tag reaches it.
 */
function normalizeTag(tag: string): string {
  const [language, ...rest] = tag.split('-');
  if (rest.length === 0) return language.toLowerCase();
  return [language.toLowerCase(), ...rest.map((part) => part.toUpperCase())].join('-');
}

function deviceTags(): string[] {
  return Localization.getLocales().map((l) => normalizeTag(l.languageTag));
}

/**
 * Call once at startup, before the first render.
 *
 * Resolving the locale is only half the job: a phone already set to Arabic
 * resolves straight to 'ar' with no Settings visit needed, so the layout
 * direction has to be brought into line here too, not only in setLocale()
 * (which only runs from the language picker). Returns whether a mismatch was
 * found and corrected, so the caller can tell the user honestly that this
 * session may still be in the old direction — `forceRTL` is not guaranteed to
 * re-lay-out an already-running app, only the next launch. On every normal
 * launch the two already agree and this is a pure read, no write.
 */
export function initI18n(): boolean {
  active = resolveLocale(storedOverride(), deviceTags());
  i18n.locale = active;

  const mismatched = needsDirectionChange(isRtlLocale(active), I18nManager.isRTL);
  if (mismatched) {
    I18nManager.allowRTL(isRtlLocale(active));
    I18nManager.forceRTL(isRtlLocale(active));
  }
  return mismatched;
}

export function currentLocale(): Locale {
  return active;
}

/** Whether the user picked a language, as opposed to following the phone.
 * currentLocale() can't answer this — it returns the resolved locale either way. */
export function hasLocaleOverride(): boolean {
  return !!storedOverride();
}

/**
 * Change language. Pass null to go back to following the phone.
 *
 * Returns whether the app has to restart: React Native can only flip the layout
 * direction at startup, so crossing between Arabic and anything else needs a
 * relaunch. The caller is responsible for telling the user — silently doing
 * nothing is how a switch becomes a dead control.
 */
export function setLocale(locale: Locale | null): { needsRestart: boolean } {
  const next = resolveLocale(locale, deviceTags());
  const wasRtl = isRtlLocale(active);
  const willBeRtl = isRtlLocale(next);

  if (locale === null) {
    setMeta(META_KEY, '');
  } else {
    setMeta(META_KEY, locale);
  }

  active = next;
  i18n.locale = next;

  if (wasRtl !== willBeRtl) {
    I18nManager.allowRTL(willBeRtl);
    I18nManager.forceRTL(willBeRtl);
    return { needsRestart: true };
  }
  return { needsRestart: false };
}

/** Look up a string. The key is typechecked against en.json. */
export function t(key: LocaleKey, vars?: Record<string, string | number>): string {
  return i18n.t(key, vars);
}

/**
 * "August 2026" in the reader's own language — the granularity a joined date
 * wants. A day number invites the arithmetic nobody was asking for, and the
 * month is the part that means "early" or "recently".
 */
export function monthYear(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(currentLocale(), { month: 'long', year: 'numeric' });
}
