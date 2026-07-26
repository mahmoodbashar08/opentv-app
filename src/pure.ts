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
 * Is a watch row from TV Time's LEGACY tracking file stale?
 *
 * The export ships two tracking files. `tracking-prod-records-v2.csv` is the
 * current one and carries almost everything; `tracking-prod-records.csv` is
 * the 2021-era original. When TV Time migrated a user forward, their real
 * history moved to v2 — so a show whose ONLY episode evidence is a v1 row was
 * dropped by TV Time itself, and resurrecting it invents history.
 *
 * Verified on a real export: exactly two shows had v1-only rows — Haikyu!! and
 * Madan Senki Ryukendo, one `fill-previous` row each, logged seconds after the
 * show was followed in 2021 and absent from all 1,095 v2 rows. Other TV Time
 * importers show neither show; OpenTV resurrected both.
 *
 * Guarded on the export as a whole: if v2 carries no episodes at all, this is
 * simply an old export and v1 is the only record there is — trust it entirely.
 */
export function v1WatchIsStale(showHasV2Episodes: boolean, exportHasV2Episodes: boolean): boolean {
  if (!exportHasV2Episodes) return false; // v1 is all we have; it is the truth
  return !showHasV2Episodes;
}

/**
 * Should a show's missing episodes be rebuilt from TV Time's counter?
 *
 * TV Time ships two disagreeing counters. `nb_episodes_seen` is the one the
 * rebuild sizes itself from, and it is demonstrably unreliable: in a real
 * export, Haikyu!! carries nb_episodes_seen 84 against a single watch row for
 * S01E01 logged four minutes after the account was created. Trusting it
 * fabricated 83 episodes of a show that had never been watched.
 *
 * The v1 `count-watch-episode-series` row is the cross-check. When it AGREES
 * with the rows the export actually lists, that record is complete and the
 * inflated counter must be ignored. It undercounts badly on large libraries
 * (16 against 64 real rows for one show), so it may only ever VETO a rebuild,
 * never size one.
 *
 * This decides whether rows get written AND, on a merge re-import, whether
 * previously-fabricated rows get deleted — so it is the rule that governs
 * whether a user's history changes.
 */
export function shouldBulkFill(
  explicitRows: number,
  episodesSeen: number,
  corroboratedWatchCount: number | null | undefined,
): boolean {
  // a real row history is never topped up — the surplus there is rewatch
  // inflation, and filling from it invents watches the user never made
  if (explicitRows > 2) return false;
  if (episodesSeen < explicitRows + 8) return false;
  // the export's own watch count matches what it listed: nothing is missing
  if (corroboratedWatchCount != null && corroboratedWatchCount <= explicitRows) return false;
  return true;
}

/**
 * TheTVDB artwork, as a URL you can actually load.
 *
 * The v4 API is inconsistent about this: `/series/{id}/extended` and the
 * untranslated episode lists return absolute URLs, but the TRANSLATED episode
 * endpoints (`/episodes/default/eng`, which is what we use so anime titles
 * come back in English) return bare paths like
 * `/banners/v4/episode/.../screencap/x.jpg`. Passing one of those to an image
 * component renders nothing, silently.
 *
 * Anything already absolute — TheTVDB's own or TMDB's — is left untouched.
 */
export function artworkUrl(path: string | null | undefined): string | null {
  const p = (path ?? '').trim();
  if (!p) return null;
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  return `https://artworks.thetvdb.com/${p.replace(/^\/+/, '')}`;
}

/**
 * Movie identity across TV Time's two spellings of the same film.
 *
 * `movies.name` is the primary key, and an import can produce BOTH
 * "Dune (2021)" (the watched row, originalName "Dune") and a bare "Dune" from
 * the watchlist. They are one film, so the grid showed the unwatched copy
 * while opening it resolved to the watched one.
 *
 * The trailing year is the only thing separating them — and the only thing
 * separating a genuine remake, so it decides both ways.
 */
export function movieBaseName(name: string): string {
  return name
    .replace(/\s*\((\d{4})\)\s*$/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** The film's year: the stored column if there is one, else a "(YYYY)" suffix
 *  on the title. null when neither says. */
export function movieYearOf(name: string, year?: string | null): string | null {
  const col = (year ?? '').trim();
  if (/^\d{4}$/.test(col)) return col;
  const m = /\((\d{4})\)\s*$/.exec(name);
  return m ? m[1] : null;
}

export type MovieIdent = { name: string; year?: string | null };

/**
 * Whether two rows are the same film and may be folded together.
 *
 * Same base title, and years that don't contradict — one side missing a year
 * still folds ("Dune" into "Dune (2021)"), two different years never do
 * ("Dune (1984)" vs "Dune (2021)"). Same rule that stopped the show deduper
 * eating remakes.
 */
export function canFoldMovie(a: MovieIdent, b: MovieIdent): boolean {
  if (movieBaseName(a.name) !== movieBaseName(b.name)) return false;
  const ya = movieYearOf(a.name, a.year);
  const yb = movieYearOf(b.name, b.year);
  return ya == null || yb == null || ya === yb;
}

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

/**
 * Undo the TMDB episode remap. `epRemap:{showId}` maps the TMDB position a row
 * was moved TO → the original TheTVDB position it came FROM, so reversing it
 * is a straight swap. Entries whose two sides are equal never moved.
 */
export function reversalMoves(applied: Record<string, string>): { from: string; to: string }[] {
  const wellFormed = (k: string) => /^\d+-\d+$/.test(k);
  return Object.entries(applied)
    .filter(([from, to]) => from !== to && wellFormed(from) && wellFormed(to))
    .map(([from, to]) => ({ from, to }));
}
