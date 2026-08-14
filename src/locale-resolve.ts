/**
 * Which language the app runs in. Pure so it can be tested without a device:
 * the wrapper that reads the phone and the database lives in src/i18n.ts.
 */
export const SUPPORTED = ['en', 'ar', 'it', 'es', 'pt-BR', 'fr'] as const;
export type Locale = (typeof SUPPORTED)[number];

const isSupported = (tag: string): tag is Locale => (SUPPORTED as readonly string[]).includes(tag);

/**
 * @param override what the user picked in Settings, or null to follow the phone
 * @param device the phone's preferred languages, best first ("en-GB", "es-MX")
 *
 * A regional tag must match a shipped file exactly before its bare language is
 * tried: pt-PT is not pt-BR, and quietly serving Brazilian Portuguese to a
 * Portuguese speaker is worse than serving English.
 */
export function resolveLocale(override: string | null, device: readonly string[]): Locale {
  if (override && isSupported(override)) return override;

  for (const tag of device) {
    if (isSupported(tag)) return tag;
    const bare = tag.split('-')[0];
    if (isSupported(bare)) return bare;
  }
  return 'en';
}

/** Arabic is the only right-to-left language shipped. */
export function isRtlLocale(locale: Locale): boolean {
  return locale === 'ar';
}

/**
 * Format a plain integer/decimal count using the target language's grouping
 * and decimal conventions (en: "1,234,567" vs es/it/pt-BR: "1.234.567").
 * Pure wrapper around Intl so the "always pass the app's locale, never the
 * device's" rule is centralised and testable — see locale-resolve.test.ts.
 */
export function formatCount(n: number, locale: Locale): string {
  return n.toLocaleString(locale);
}

/**
 * A Wrapped period as a person reads it: 'July 2026' for '2026-07', and the
 * bare year for '2026'. Month names come from Intl, so all six languages are
 * covered without a key each.
 *
 * Here rather than beside the screen because the period picker and the
 * month-closed notification must name the same month the same way, and they
 * live at opposite ends of the app.
 */
export function formatPeriod(key: string, locale: Locale): string {
  if (/^\d{4}$/.test(key)) return key;
  if (!/^\d{4}-\d{2}$/.test(key)) return key;
  const d = new Date(`${key}-01T00:00:00`);
  return Number.isNaN(d.getTime()) ? key : d.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}
