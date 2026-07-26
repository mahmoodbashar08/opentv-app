/**
 * Dependency-free helpers — no native/RN imports, so they're unit-testable in
 * plain Node. The app modules (update-gate, importer, db, tvdb) call into these
 * for the tricky bits (version compare, list naming/merge, movie matching,
 * import diagnostics) so that logic has real test coverage.
 */

/** true when a < b, comparing dotted numeric versions ("1.2" < "1.10"). */
export function olderThan(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Placeholder name for a TV Time private list (its real name is gone). */
export function listPlaceholderName(createdAt: string): string {
  const d = new Date(createdAt);
  return isNaN(d.getTime()) ? 'Untitled list' : `Untitled · ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Disambiguate a list name against names already used (case-insensitive),
 *  appending " (2)", " (3)" … Mutates and returns the used-set. */
export function uniqueListName(base: string, used: Set<string>): string {
  let nm = base;
  let i = 2;
  while (used.has(nm.toLowerCase())) nm = `${base} (${i++})`;
  used.add(nm.toLowerCase());
  return nm;
}

export type ListLike = { name: string; userCreated?: boolean };

/** Merge freshly-imported lists with the user's edits: drop imported lists the
 *  user renamed/deleted (tombstones) or that collide with a user list, keep the
 *  user's own lists first. Pure core of db.mergeImportedCustomLists. */
export function mergeCustomLists<T extends ListLike>(imported: T[], userLists: T[], tombstones: string[]): T[] {
  const userNames = new Set(userLists.map((l) => l.name.toLowerCase()));
  const tomb = new Set(tombstones.map((n) => n.toLowerCase()));
  const keptImported = imported.filter(
    (l) => !tomb.has(l.name.toLowerCase()) && !userNames.has(l.name.toLowerCase()),
  );
  return [...userLists, ...keptImported];
}

export type TvdbMovieHit = { tvdb_id?: string; name?: string; year?: string; image_url?: string };

/** Pick a movie result for the AUTOMATIC fill: only an unambiguous exact-name
 *  match (year must match when known; a single exact-name hit otherwise).
 *  Multiple exact names or no exact name → null (leave it for manual fix). */
export function pickTvdbMovie(raw: TvdbMovieHit[], name: string, year?: string | null): TvdbMovieHit | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(name);
  const exact = raw.filter((r) => norm(r.name ?? '') === target);
  if (year) return exact.find((r) => r.year === year) ?? (exact.length === 1 ? exact[0] : null);
  return exact.length === 1 ? exact[0] : null;
}

/** Human-readable list of the CSVs found inside a ZIP — for the "imported 0"
 *  error so the user (and us) can see what the file actually contained. */
export function foundCsvsMessage(fileKeys: string[]): string {
  const csvKeys = fileKeys.filter((k) => k.endsWith('.csv') && !k.includes('__MACOSX'));
  const names = csvKeys.map((k) => k.split('/').pop()).slice(0, 12);
  return names.length
    ? `Files found: ${names.join(', ')}${csvKeys.length > 12 ? ', …' : ''}.`
    : 'No CSV files were found inside the ZIP.';
}

/**
 * Field ownership between the two metadata databases.
 *
 * Structure (seasons, episode numbers, titles, air dates) always comes from
 * TheTVDB and is never merged — TV Time's export uses TheTVDB's numbering, so
 * anything else puts watches on the wrong episodes. These helpers cover
 * everything else: TMDB's value when it has one, TheTVDB's otherwise. Per
 * field, not all-or-nothing, so a show TMDB never matched still renders a
 * complete header instead of a half-empty one.
 */

/** TMDB returns '' and [] where it means "nothing", so a plain null check is
 *  not enough. 0 counts as present — a rating of 0 is a real value. */
export function hasValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function preferred<T>(primary: T | null | undefined, fallback: T | null | undefined): T | null {
  if (hasValue(primary)) return primary as T;
  if (hasValue(fallback)) return fallback as T;
  return null;
}

/** Merge the listed keys, TMDB first. Keys neither side has are omitted
 *  entirely rather than set to null, so a caller spreading the result cannot
 *  blank out a value that was already there. */
export function mergeEnrichment<T extends object>(
  tmdb: Partial<T>,
  tvdb: Partial<T>,
  keys: (keyof T)[],
): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) {
    const v = preferred(tmdb[k], tvdb[k]);
    if (v !== null) out[k] = v;
  }
  return out;
}

/**
 * Undo the TMDB episode remap. `epRemap:{showId}` maps the TMDB position a row
 * was moved TO → the original TheTVDB position it came FROM, so reversing it
 * is a straight swap. Entries whose two sides are equal never moved.
 */
/**
 * How an unaired episode reads in the list: "Today", "Tomorrow", "in 5 days".
 * Returns null once it has aired (or for a missing/unparseable date), which is
 * the signal to show the normal watched-state UI instead.
 *
 * Compared date-only, in local terms: an episode airing later today is "Today",
 * not "in 0 days", and one that aired earlier today counts as released.
 */
export function airCountdown(air: string | null | undefined, now: number): string | null {
  if (!air) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(air);
  if (!m) return null;
  const airDay = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const n = new Date(now);
  const today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  const days = Math.round((airDay - today) / 86400000);
  if (days <= 0) return null; // already aired
  if (days === 1) return 'Tomorrow';
  if (days < 30) return `in ${days} days`;
  const months = Math.round(days / 30);
  if (months < 12) return `in ${months} month${months === 1 ? '' : 's'}`;
  const years = Math.round(days / 365);
  return `in ${years} year${years === 1 ? '' : 's'}`;
}

export function reversalMoves(applied: Record<string, string>): { from: string; to: string }[] {
  const wellFormed = (k: string) => /^\d+-\d+$/.test(k);
  return Object.entries(applied)
    .filter(([from, to]) => from !== to && wellFormed(from) && wellFormed(to))
    .map(([from, to]) => ({ from, to }));
}
