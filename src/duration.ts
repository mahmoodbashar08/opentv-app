/**
 * Localized duration formatting.
 *
 * Deliberately its own module rather than living in movie-metadata.ts: this
 * needs @/i18n, and i18n.ts statically imports @/db, which lazily
 * `require`s movie-metadata.ts (see db.ts's getMovieTotals) — so movie-metadata.ts
 * pulling in @/i18n at the top level would close that require into a real
 * cycle (db.ts -> movie-metadata.ts -> i18n.ts -> db.ts). madge confirms this
 * module has no such cycle.
 */
import { t } from '@/i18n';

/** "2h 15m" (or "45m" under an hour), in the current locale. null means
 *  there is no runtime to show — callers branch on that. */
export function runtimeLabel(minutes: number | null | undefined): string | null {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? t('duration.hoursMinutes', { h, m }) : t('duration.minutesOnly', { m });
}
