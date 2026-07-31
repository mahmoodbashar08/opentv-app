/**
 * Dependency-free helpers — no native/RN imports, so they're unit-testable in
 * plain Node. The app modules (update-gate, importer, db, tvdb) call into these
 * for the tricky bits (version compare, list naming/merge, movie matching,
 * import diagnostics) so that logic has real test coverage.
 */

/**
 * The export's CSV dialect: quoted fields with embedded commas and newlines,
 * doubled quotes as an escape, CRLF or LF.
 *
 * Lives here rather than in `importer.ts` because it is the first thing every
 * import runs and the last thing anything can mock away — an "imported 0" bug
 * is far more likely to be a parse that quietly returned `[]` than a database
 * failure. Being here it can be run against the real export files in a test.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows;
  if (!header) return [];
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

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

/**
 * A storage name for a film, disambiguated when two genuinely different films
 * share a title.
 *
 * `movies.name` is the primary key, so "Ghostbusters" (1984) and "Ghostbusters"
 * (2016) overwrite each other — five films were silently lost from a real
 * 546-film export that way. When the source tells us they are different works
 * (different ids), the later one takes a year suffix, which is how TV Time
 * itself disambiguates and what the deduper already understands.
 */
export function disambiguatedMovieName(title: string, year: string | null | undefined, taken: Set<string>): string {
  const base = title.trim();
  if (!taken.has(base.toLowerCase())) return base;
  const y = (year ?? '').trim().slice(0, 4);
  if (/^\d{4}$/.test(y) && !taken.has(`${base} (${y})`.toLowerCase())) return `${base} (${y})`;
  for (let n = 2; n < 50; n++) {
    const alt = `${base} (${n})`;
    if (!taken.has(alt.toLowerCase())) return alt;
  }
  return base;
}

export type MovieCandidate = { name?: string | null; year?: string | null };

/**
 * Pick a movie from search results, using the date it was watched to break ties.
 *
 * TV Time's export gives a movie NAME and nothing else — no id, no year — so
 * generic titles are hopeless on name alone: "Superman" returns 1978, 1987,
 * 1997, 2948 and 2025; "Frozen" returns six. The old rule refused anything
 * ambiguous, which left roughly a quarter of a real library unmatched (23% of
 * a 30-film sample, verified against a tester's export).
 *
 * The watch date resolves it. You cannot watch a film before it exists, so
 * anything released after the watch is out; among what remains the most recent
 * release is overwhelmingly the one people mean — someone watching "Ghostbusters"
 * in 2020 usually means the recent one.
 *
 * "Overwhelmingly" is not "always", so a tie broken this way is returned with
 * `guessed: true`. Callers surface those for review rather than presenting a
 * guess as fact.
 */
export function pickMovieMatch<T extends MovieCandidate>(
  candidates: T[],
  name: string,
  watchedYear: number | null,
): { hit: T; guessed: boolean } | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(name);
  const exact = candidates.filter((c) => norm(c.name ?? '') === target);
  if (exact.length === 0) return null;
  if (exact.length === 1) return { hit: exact[0], guessed: false };

  const yearOf = (c: T) => {
    const y = Number((c.year ?? '').slice(0, 4));
    return Number.isFinite(y) && y > 1800 ? y : null;
  };
  const dated = exact.filter((c) => yearOf(c) != null);
  // released by the time it was watched
  const plausible = watchedYear ? dated.filter((c) => (yearOf(c) as number) <= watchedYear) : dated;

  // the watch date rules out everything but one — that is evidence, not a guess
  if (plausible.length === 1) return { hit: plausible[0], guessed: false };
  const pool = plausible.length > 0 ? plausible : dated.length > 0 ? dated : exact;
  const best = pool.reduce((a, b) => ((yearOf(b) ?? 0) > (yearOf(a) ?? 0) ? b : a));
  return { hit: best, guessed: true };
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

export type FoldCandidate = {
  /** watch rows the entry holds */
  watches: number;
  /** the user added this in-app rather than it arriving in an import */
  userAdded: boolean;
  tmdbId: number | null;
};

/**
 * May a same-named entry be folded into the primary one?
 *
 * The duplicate-cleaner runs after every import and merges entries that share a
 * base name. That is right for TV Time's deprecated placeholders and wrong for
 * everything else, so it needs evidence before it destroys a row.
 *
 * Two kinds of entry are protected, and the second is the one 1.2.0 missed:
 *
 *  - **Real watch history.** Folding drops every episode the primary also has,
 *    then deletes the row — so "Avatar: The Last Airbender (2024)" disappeared
 *    into the 2005 animated series.
 *  - **Anything the user added in-app.** A show tracked from Discover starts
 *    with zero watches, so the history test alone does not cover it, and since
 *    TheTVDB became primary its TMDB id is fetched lazily — meaning a show
 *    added but not yet opened has no identity either. It was folded away by the
 *    next import.
 *
 * Either of those may still be folded when BOTH sides' TMDB identities are
 * known: the caller has already established the ids are equal by then, which is
 * proof they are the same work rather than a remake. Imported placeholders with
 * no history and no user intent still fold freely, which is the whole point.
 */
export function mayFoldDuplicateShow(cand: FoldCandidate, primary: { tmdbId: number | null }): boolean {
  const protectedEntry = cand.watches > 0 || cand.userAdded;
  if (!protectedEntry) return true;
  // truthiness, not a null check: 0 is the "matched via TheTVDB, no TMDB id"
  // sentinel the app uses, so it means the identity is UNKNOWN. Two entries
  // both carrying 0 are not thereby the same show, and letting one delete the
  // other is the exact failure this guard exists to prevent.
  return !!cand.tmdbId && !!primary.tmdbId;
}

/** The tombstone key for one episode, shared by the un-mark list and the
 *  importer that has to honour it. */
export function episodeKey(showId: number, season: number, episode: number): string {
  return `${showId}-${season}-${episode}`;
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

/**
 * The episode count to store on a show at import.
 *
 * Watch ROWS are the truth. The raw TV Time counter (`nb_episodes_seen`) is
 * inflated by rewatches and re-marks, and on some shows is simply wrong — it
 * claimed 84 watched episodes of a show whose own records list none.
 *
 * Zero rows is a truth like any other. Treating "no rows" as "no information"
 * and falling back to the counter is how a show the importer had just refused
 * to fill got stored as fully watched anyway: progress takes
 * MAX(rows, episodesSeen), so the phantom count won.
 *
 * The one exception is a bulk-only show, where TV Time stored a count and no
 * rows and the fill materialises them — there the counter IS the record.
 */
export function effectiveEpisodesSeen(explicitRows: number, counter: number, bulkFilled: boolean): number {
  return bulkFilled ? counter : explicitRows;
}

/**
 * Whether the native layout direction needs to change to match a resolved
 * locale's direction.
 *
 * `I18nManager.forceRTL` is not guaranteed to re-lay-out an already-running
 * app — React Native's own docs say the flip takes effect on the NEXT
 * launch — so callers must not assume calling it fixes the current session.
 * What they can rely on is this: when the two already agree, there is
 * nothing to do, and that is true on every normal launch (RTL device already
 * forced RTL last time, LTR device never touched). Only a genuine mismatch
 * (fresh install, or the phone's language changed outside the app) calls for
 * anything at all.
 *
 * Takes plain booleans rather than `I18nManager` itself so this stays free
 * of react-native/expo imports and testable in plain Node.
 */
export function needsDirectionChange(localeIsRtl: boolean, currentIsRtl: boolean): boolean {
  return localeIsRtl !== currentIsRtl;
}

/* ---- reorder grid geometry ------------------------------------------------
 * The lists drag-to-reorder grid was sized once at module load from
 * `Dimensions.get('window')`, so it kept portrait-width columns after the app
 * learned to rotate (1.2.0). These are the pure maths behind it, split out so
 * the drag can be tested without a device: a wrong slot does not just look
 * wrong, it silently reorders the user's list.
 *
 * They carry the 'worklet' directive because the gesture handler calls them on
 * the UI thread; they are ordinary functions everywhere else.
 */

export type GridGeometry = {
  cols: number;
  cellW: number;
  cellH: number;
  slotW: number;
  slotH: number;
};

/** A viewport this wide or wider is a tablet. A WIDTH test, not a device test:
 *  an iPad in Split View is genuinely phone-width and wants the phone layout.
 *
 *  Equal by design to ui.tsx's CONTENT_MAX_WIDTH (also 700) — that equality is
 *  what guarantees the content cap never binds below this breakpoint. Kept as
 *  two separate constants (a breakpoint vs. a layout cap); do not merge them. */
export const TABLET_MIN_W = 700;

/** Poster width each layout aims for. A tablet is held further away, so its
 *  posters are bigger rather than merely more numerous — reusing the phone's
 *  118pt would give ~11 columns of postage stamps on a 13" iPad.
 *
 *  140 and not 150: raising the target size at a breakpoint always costs
 *  columns (that is arithmetic, not a choice), so the question is only how
 *  many. 140 gives up AT MOST ONE column at 700pt (6 -> 5, cell growing
 *  ~21%); 150 gives up two (6 -> 4, cell growing ~51%, the lurch from
 *  109pt -> 165pt). */
const TARGET_CELL_W = 118;
const TARGET_CELL_W_TABLET = 140;

/** Columns/cell sizes for a viewport width. Phones in portrait always resolve
 *  to the 3 columns the grid shipped with; only wider viewports change. */
export function gridGeometry(width: number, hPad: number, gap: number): GridGeometry {
  'worklet';
  const inner = width - hPad * 2;
  const target = width >= TABLET_MIN_W ? TARGET_CELL_W_TABLET : TARGET_CELL_W;
  const cols = Math.max(3, Math.round((inner + gap) / (target + gap)));
  const cellW = (inner - gap * (cols - 1)) / cols;
  const cellH = cellW * 1.5; // poster aspect 2:3
  return { cols, cellW, cellH, slotW: cellW + gap, slotH: cellH + gap };
}

/** Top-left offset of a slot within the grid. */
export function slotPosition(order: number, geo: GridGeometry): { x: number; y: number } {
  'worklet';
  return { x: (order % geo.cols) * geo.slotW, y: Math.floor(order / geo.cols) * geo.slotH };
}

/** The slot a dragged tile is currently over, clamped inside the list. */
export function slotAt(x: number, y: number, count: number, geo: GridGeometry): number {
  'worklet';
  const col = Math.max(0, Math.min(geo.cols - 1, Math.round(x / geo.slotW)));
  const row = Math.max(0, Math.round(y / geo.slotH));
  return Math.max(0, Math.min(count - 1, row * geo.cols + col));
}

/** Shift every position between the old and new slot by one — a reorder, not a
 *  swap. Always returns a permutation of the input. */
export function reflow(obj: Record<string, number>, from: number, to: number): Record<string, number> {
  'worklet';
  const next: Record<string, number> = {};
  for (const k in obj) {
    let v = obj[k];
    if (v === from) v = to;
    else if (from < to && v > from && v <= to) v = v - 1;
    else if (from > to && v < from && v >= to) v = v + 1;
    next[k] = v;
  }
  return next;
}

export type MovieFoldCandidate = {
  watched: boolean;
  rated: boolean;
  favorited: boolean;
  /** the user added this in-app rather than it arriving in an import */
  userAdded: boolean;
  tmdbId: number | null;
};

/**
 * May a same-named film be folded into the primary one?
 *
 * The movie deduper is the show deduper's twin — it runs after every import and
 * merges rows sharing a base title, which is right for the export's bare
 * watchlist stubs ("Dune" into "Dune (2021)") and wrong for anything carrying
 * user intent. Shows got this guard in 1.2.0; movies never did, so a film added
 * from search could be deleted by the next import exactly as a Discover-added
 * show once was.
 *
 * A film is protected if it holds history (watched, rated, favourited) or the
 * user added it in-app. Protected rows fold only when BOTH sides' TMDB
 * identities are known — the caller has already matched title and year by then,
 * so known-and-equal ids are proof it is the same film rather than a remake.
 */
export function mayFoldDuplicateMovie(cand: MovieFoldCandidate, primary: { tmdbId: number | null }): boolean {
  const protectedEntry = cand.watched || cand.rated || cand.favorited || cand.userAdded;
  if (!protectedEntry) return true;
  // truthiness, not a null check: 0 is the "matched via TheTVDB, no TMDB id"
  // sentinel, i.e. identity UNKNOWN — see mayFoldDuplicateShow
  return !!cand.tmdbId && !!primary.tmdbId;
}

/**
 * Merge the `tvdbRowIds` maps of two show ids when one is re-keyed onto the
 * other (season-episode → TheTVDB episode id).
 *
 * These ids are what an export round-trip writes back, and nothing but a
 * re-import can regenerate them — so a fix-match that re-keys a show to its
 * current TheTVDB id must carry them over rather than drop them. The target's
 * entries win where both sides know an episode: those were resolved under the
 * id the show now lives at.
 */
export function mergeTvdbRowIds(
  fromIds: Record<string, number>,
  toIds: Record<string, number>,
): Record<string, number> {
  return { ...fromIds, ...toIds };
}

/**
 * Keep a dragged tile inside the grid's own bounds.
 *
 * `slotAt` derives a row from `y / slotH`, so a tile dragged past the last row
 * reads as a row that does not exist and clamps to the final slot. With one row
 * — 8 items across 9 columns on a landscape iPad — dragging downwards flipped
 * the target between "somewhere in row 0" and "the last slot" as the finger
 * wandered, and every flip reflowed the whole range. The dragged item did land
 * where it was dropped, but the items it passed came back permuted.
 *
 * On a phone the grid is several rows tall, so there is nearly always a real
 * row under the finger and this never showed.
 */
export function clampToGrid(
  x: number,
  y: number,
  count: number,
  geo: GridGeometry,
): { x: number; y: number } {
  'worklet';
  const lastRow = Math.max(0, Math.ceil(count / geo.cols) - 1);
  const lastCol = Math.min(geo.cols, count) - 1;
  return {
    x: Math.max(0, Math.min(lastCol * geo.slotW, x)),
    y: Math.max(0, Math.min(lastRow * geo.slotH, y)),
  };
}

/**
 * Whether to show the notification opt-in screen.
 *
 * iOS shows its permission dialog ONCE. If the user declines it, the app can
 * never prompt again — only send them to iOS Settings. So the app asks in its
 * own UI first and spends the system prompt only on a yes; a "Not now" leaves
 * it unspent, and the Profile banner keeps the offer available.
 *
 * `asked` is stamped by EITHER answer, so the screen never returns. `enabled`
 * covers the upgrade case: someone who already turned reminders on from
 * Settings should never be asked at all.
 */
export function shouldAskForNotifications(s: {
  onboarded: boolean;
  asked: boolean;
  enabled: boolean;
}): boolean {
  return s.onboarded && !s.asked && !s.enabled;
}

export type ProfileBanner = 'cloud' | 'backup' | 'notifications' | null;

/**
 * Which single banner Profile shows.
 *
 * Three could apply at once, and three stacked yellow bars read as nagging
 * rather than helping. Ordered by what it costs the user to ignore: losing the
 * whole library outranks losing a backup copy, which outranks missing tonight's
 * episode.
 */
export function topBanner(s: {
  cloudOff: boolean;
  backupOverdue: boolean;
  notificationsOff: boolean;
}): ProfileBanner {
  if (s.cloudOff) return 'cloud';
  if (s.backupOverdue) return 'backup';
  if (s.notificationsOff) return 'notifications';
  return null;
}

export type PosterStatus = 'watching' | 'upToDate' | 'finished' | 'stopped' | 'none';

/**
 * What VoiceOver reads for a poster tile.
 *
 * A poster is artwork with no text, so the tile aggregated to an EMPTY
 * accessibility label — the whole library grid came back as unlabelled
 * elements and could not be navigated by a screen reader at all.
 *
 * Progress is spoken as a percentage rather than described as a bar, and the
 * two ends are given words: "not started" and "finished" carry the meaning
 * that "0%" and "100%" only imply.
 */
export function posterLabel(
  name: string,
  s: { progress?: number; status?: PosterStatus },
): string {
  if (s.progress != null) {
    if (s.progress <= 0) return `${name}, not started`;
    if (s.progress >= 1) return `${name}, finished`;
    return `${name}, ${Math.round(s.progress * 100)}% watched`;
  }
  const words: Record<PosterStatus, string> = {
    watching: 'watching',
    upToDate: 'up to date',
    finished: 'finished',
    stopped: 'stopped',
    none: '',
  };
  const w = s.status ? words[s.status] : '';
  return w ? `${name}, ${w}` : name;
}

/** Below this the screen is not wide enough for two usable halves: a 60% pane
 *  at 700pt is 420pt, narrower than a phone, and the list beside it would be
 *  280pt — too cramped for a poster grid. */
export const DETAIL_PANE_MIN_W = 900;

/**
 * How a detail screen (show, movie, episode) sits on screen.
 *
 * The detail screens are already presented so that the screen beneath stays
 * rendered — that is what lets you drag one down and see the list behind it.
 * So showing them beside the list is not a navigation change: it is the same
 * screen, given a narrower container and pushed to the right edge.
 *
 * The detail takes the larger share deliberately. It is the denser side —
 * episode rows, a description, controls — while the list beside it only has to
 * stay browsable.
 */
export function detailPaneLayout(width: number): { paned: boolean; width: number } {
  if (width < DETAIL_PANE_MIN_W) return { paned: false, width };
  return { paned: true, width: Math.round(width * 0.6) };
}

/**
 * Whether the drag-to-dismiss gesture should be armed after a scroll event.
 *
 * The gesture is only allowed while the list sits at its top, otherwise a
 * downward drag would fight the scroll. The trap is re-arming: scrolling back
 * up reaches the top while the finger is STILL travelling downwards, so the
 * gesture would activate on that same motion and dismiss the page instead of
 * letting it settle. Scrolling up to the top read as "go back".
 *
 * So the gesture disarms immediately whenever the list leaves the top, but
 * only re-arms once the scroll has actually come to rest there.
 */
export function nextAtTop(current: boolean, top: boolean, scrolling: boolean): boolean {
  if (!top) return false;
  if (current) return true;
  return !scrolling;
}

/**
 * Episode stills to borrow from TMDB, matched by TITLE.
 *
 * 1.2.0 moved episode structure to TheTVDB because the two databases number
 * episodes differently — that is the whole reason the migration existed — so
 * numbering cannot line them up. Air dates cannot either: checked against a
 * real library, TheTVDB schedules Noddy's Toyland Adventures daily and TMDB
 * weekly, so the same date lands on different episodes and matching on it
 * would put one episode's picture on another.
 *
 * Titles survive both disagreements — they were identical in every case
 * sampled. A title TMDB lists more than once is skipped rather than guessed
 * at, and a still TheTVDB already provided is never replaced.
 */
export function matchStillsByTitle(
  episodes: Record<string, { title: string | null; still: string | null }>,
  tmdb: { title: string | null; still: string | null }[],
): Record<string, string> {
  const key = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const byTitle = new Map<string, string | null>();
  for (const e of tmdb) {
    if (!e.title || !e.still) continue;
    const k = key(e.title);
    // seen twice -> ambiguous, poison it so neither wins
    byTitle.set(k, byTitle.has(k) ? null : e.still);
  }
  const out: Record<string, string> = {};
  for (const [id, ep] of Object.entries(episodes)) {
    if (ep.still || !ep.title) continue;
    const hit = byTitle.get(key(ep.title));
    if (hit) out[id] = hit;
  }
  return out;
}

/** How far past the top the user must pull before the page leaves. Comfortably
 *  beyond a casual rubber-band, so a firm scroll to the top never triggers it. */
export const PULL_TO_DISMISS = 100;

/**
 * Whether a pull past the top should close the page.
 *
 * This is the mechanism TV Time uses, and it is the right one: you scroll up,
 * the header image expands back to full height, you reach the top — and only
 * if you then keep pulling does the page leave.
 *
 * Earlier attempts armed a drag gesture the moment the list REACHED the top,
 * which is a different event entirely. The finger is still travelling
 * downwards at that instant, so the gesture captured the same motion and
 * scrolling up read as "go back". Overscroll cannot be confused that way: the
 * scroll view only reports it once there is nothing left to scroll and the
 * user is still pulling.
 *
 * `dragging` is required so momentum can never do it — a fast flick that
 * bounces past the top is not a request to leave.
 */
export function shouldDismissOnPull(offsetY: number, dragging: boolean): boolean {
  return dragging && offsetY <= -PULL_TO_DISMISS;
}

/** What a movie's stored match actually is. */
export type MovieMatchState = 'unmatched' | 'tvdb' | 'tmdb';

/**
 * Read a movie's match state from its stored tmdbId.
 *
 * `0` is the sentinel for "matched by hand via TheTVDB" — chosen because it is
 * falsy, so the page's `if (!tmdbId)` fetch guards skip it cleanly. That same
 * falsiness is what broke the Fix-match banner: `!tmdbId` could not tell a
 * TheTVDB match from a movie that had never been matched, and the banner's
 * wording keyed off the poster instead — which the automatic artwork backfill
 * had already filled in. Picking a TheTVDB entry therefore produced no visible
 * change at all, and read as a dead button.
 *
 * The show screen has always distinguished the sentinel explicitly. This is
 * the same rule, for movies.
 */
export function movieMatchState(
  tmdbId: number | null | undefined,
  tvdbId?: number | null,
): MovieMatchState {
  if (tmdbId) return 'tmdb';
  // A real TheTVDB id counts as matched, and so does the legacy `tmdbId = 0`
  // sentinel that Fix match writes for a hand-picked TheTVDB result.
  //
  // Asking only about TMDB was wrong once TheTVDB became the primary
  // catalogue: a film added from a TheTVDB search result stores no TMDB id,
  // so the screen showed "not matched to the movie database" above a poster,
  // genres, runtime and release date it had just fetched from TheTVDB. The
  // app was denying knowledge of a film it had plainly identified.
  if (tvdbId || tmdbId === 0) return 'tvdb';
  return 'unmatched';
}

/**
 * One step of the episode pager, clamped at both ends. `direction` is +1
 * (forward, physically the same direction a left swipe advances in the LTR
 * FlatList pager) or -1 (back) — passed in by the caller rather than derived
 * here, so this stays free of any notion of RTL/LTR or gesture geometry.
 *
 * Exists because five earlier attempts tried to MODEL React Native's RTL
 * horizontal-scroll geometry (mirrored offsets, `direction: 'ltr'` pins,
 * index-based scrollToIndex) and each made a physical iPhone under Arabic
 * land on the wrong episode in a new way — none of it was verifiable from a
 * simulator, which renders RTL correctly and never reproduced the bug at all.
 * This function replaces that machinery entirely: under RTL the pager renders
 * a single page and steps this index with a plain swipe gesture, so there is
 * no scroll offset, no `getItemLayout`, nothing RTL-scroll-shaped left to get
 * wrong. It is plain arithmetic and is fully covered by ordinary unit tests.
 *
 * An empty list (`count <= 0`) has no page to be on; it returns 0 rather than
 * throwing, since a caller mid-render (season data still loading) must not
 * crash over it.
 */
export function nextPage(current: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, current + direction));
}

/**
 * Turn a released horizontal drag into a pager step, or none.
 *
 * Mirrors the "flick vs. deliberate drag" thresholds `shouldDismissOnPull`
 * uses for the vertical dismiss gesture: a fast flick counts even with little
 * travel (velocity), and a slow deliberate drag counts once it has crossed
 * roughly a third of the page (translation). Anything short of both springs
 * back to the current page — returned as 0, not a step.
 */
export function swipeDirection(
  translationX: number,
  velocityX: number,
  pageWidth: number,
  rtl: boolean,
): -1 | 0 | 1 {
  // called from the pan gesture's onEnd, which runs on the UI runtime —
  // without this the worklet throws "Tried to synchronously call a Remote
  // Function". Same reason the drag-reorder helpers above carry it.
  'worklet';
  const FLICK_VELOCITY = 500;
  const distanceThreshold = pageWidth > 0 ? pageWidth / 3 : Infinity;

  // Which way the finger went, before meaning is attached to it.
  let swipe: -1 | 0 | 1 = 0;
  if (translationX <= -distanceThreshold || velocityX <= -FLICK_VELOCITY) swipe = 1;
  else if (translationX >= distanceThreshold || velocityX >= FLICK_VELOCITY) swipe = -1;

  // In Arabic the pages read right-to-left, so the gesture mirrors with them:
  // dragging LEFT advances in English, dragging RIGHT advances in Arabic.
  // This is a deliberate mirror of MEANING, not of scroll geometry — the
  // pager renders one page and steps an index, so there is no offset here to
  // get backwards.
  if (rtl && swipe !== 0) return (swipe === 1 ? -1 : 1);
  return swipe;
}

export type MovieIdentityCandidate = { tmdbId: number | null; tvdbId?: number | null; name: string; year?: string | null };
export type MovieLibraryEntry = { tmdbId: number | null; tvdbId?: number | null; name: string; originalName?: string | null; year?: string | null };

/**
 * Whether a search result and a library row are the SAME film.
 *
 * Two rows can share a title and be different films — "Amado" (2011) and
 * "Amado" (2022) is the reported bug: deciding membership by name alone
 * ticked BOTH search rows the moment either was added. `tmdbId` is real
 * identity, so it wins whenever both sides carry one, including the case
 * that matters here: same name, different ids, definitely not a match.
 *
 * Name is still the fallback, and a necessary one — imported rows (TV
 * Time's GDPR export) routinely carry no tmdbId at all, having never been
 * matched against TMDB, so a title compare is the best evidence available
 * for them.
 *
 * `0` is excluded from the tmdbId compare: it is the sentinel for "matched
 * by hand via TheTVDB" (see `movieMatchState`), not a real TMDB id, so two
 * rows both carrying it are not thereby proven to be the same film.
 */
export function movieIdentityMatches(a: MovieIdentityCandidate, b: MovieLibraryEntry): boolean {
  // A real id on both sides settles it outright. TheTVDB counts: it is the
  // primary catalogue for movies, and a film added from search carries its
  // TheTVDB id even when no TMDB id exists.
  if (a.tmdbId && b.tmdbId) return a.tmdbId === b.tmdbId;
  if (a.tvdbId && b.tvdbId) return a.tvdbId === b.tvdbId;

  const name = a.name.trim().toLowerCase();
  const nameMatches =
    name === b.name.trim().toLowerCase() || name === (b.originalName ?? '').trim().toLowerCase();
  if (!nameMatches) return false;

  // Names match but at least one side has no TMDB id — which is the NORMAL
  // case, not an edge one: TheTVDB is the primary catalogue for movies and
  // supplies no TMDB id at all, and imported films often carry none either.
  //
  // The release year is then the only evidence available, and it is good
  // evidence: two films sharing a title AND a release year are almost always
  // the same film, while "Amado" 2011 and "Amado" 2022 are demonstrably not.
  // Comparing on name alone is what ticked both rows and made the second
  // film impossible to add.
  const ya = movieYear(a.year);
  const yb = movieYear(b.year);
  if (ya && yb) return ya === yb;

  // One side has no year either. Nothing distinguishes them, so treat them as
  // the same film rather than inventing a duplicate of something already held.
  return true;
}

/** The four-digit year, or null if there isn't a usable one. */
export function movieYear(raw: string | null | undefined): string | null {
  const y = (raw ?? '').trim().slice(0, 4);
  return /^\d{4}$/.test(y) ? y : null;
}

// ── the shared identity rule ─────────────────────────────────────────────────
//
// `slug` and `targetKey` below are mirrored **character-for-character** in
// `backend/src/pure.ts`. Phone and server must compute the same key for the
// same film or they build two separate threads for it, and nobody ever sees
// anybody else's comments on it. Change one side and you have split the
// conversation for every film whose title is touched by the change.
//
// The vectors that pin the rule are the eleven-row table in
// `backend/docs/IMPLEMENTATION.md`, "The shared identity rule". They exist
// identically in `src/pure.test.ts` here and in `backend/test/pure.test.ts`.

/**
 * slug: lowercase · NFKD-fold diacritics · non-alphanumerics → single hyphen ·
 * trim hyphens.
 *
 * The single most important line here is the character class `[^\p{L}\p{N}]+`
 * with the `u` flag. An ASCII-only `[^a-z0-9]` would reduce every Arabic title
 * to the empty string and collapse the entire Arabic catalogue into one thread.
 * The NFKD + `\p{M}` strip is the other half of the same idea: it folds
 * diacritics (é → e, مُ → م) so the same film spelled with and without them is
 * one film.
 */
export function slug(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '') // drop combining marks: é → e, مُ → م
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-') // Unicode-aware: Arabic and CJK survive
    .replace(/^-+|-+$/g, '');
}

/**
 * The year `targetKey` addresses a film by: the stored column if it STARTS
 * with four digits, else a "(YYYY)" suffix on the title, else null.
 *
 * THE TRAP, and it is the reason this function exists at all. The app splits
 * its year logic in two: `movieYearOf` (above) tests the column with a bare
 * `/^\d{4}$/` and does NOT slice, while the `.slice(0, 4)` lives in
 * `movieYear` — which is what `movieIdentityMatches` actually calls. The
 * backend's `movieYearOf` folds the slice in, so `targetKey` must be built on
 * the SLICED form. Build it on the app's own `movieYearOf` and the two sides
 * disagree on every film whose year column holds a full release date
 * ("2021-10-22"), silently forking the thread for it.
 *
 * Neither `movieYearOf` nor `movieYear` is changed: other code depends on the
 * behaviour each has today.
 */
function targetYear(name: string, year?: string | null): string | null {
  const col = movieYear(year); // the sliced rule: "2021-10-22" → "2021"
  if (col) return col;
  const m = /\((\d{4})\)\s*$/.exec(name);
  return m ? m[1] : null;
}

/**
 * The address of a thread. Shows are an id; films without one are `slug|year`.
 *
 * An empty (or entirely punctuation) title yields the bare separator — `'|'`,
 * or `'|2011'` with a year — because `slug('')` is `''`. Deliberately not
 * special-cased: it is a valid, stable, total key, and callers validate a title
 * before there is anything to comment on.
 */
export function targetKey(
  source: 'tvdb' | 'tmdb' | 'title',
  a: { id?: number | string | null; title?: string | null; year?: string | null },
): string {
  if (source === 'tvdb' || source === 'tmdb') return String(a.id);
  const base = movieBaseName(a.title ?? ''); // strips a trailing "(YYYY)"
  const year = targetYear(a.title ?? '', a.year); // column first, then suffix
  return `${slug(base)}|${year ?? ''}`;
}

// ── joining the community ────────────────────────────────────────────────────

/**
 * Whether to offer the community, unasked.
 *
 * The offer is made ONCE and never again on its own. Everything below is a
 * reason not to interrupt someone:
 *
 *  - `joined`   — they are already in; there is nothing to offer.
 *  - `declined` — they said no. "Not now" is answered, not deferred; the
 *                 Profile banner keeps the door open without asking again.
 *  - `asked`    — the prompt has already been shown once. Stamped when it
 *                 appears, not when it is answered, so a prompt dismissed by
 *                 a swipe or a crash does not come back on the next launch.
 *  - `hasImported` — the pitch is "find the friends you had on TV Time", and
 *                 to someone who never imported that sentence means nothing.
 *                 They can still join deliberately from Settings or the
 *                 Profile banner, which do not consult this function.
 *
 * Note there is no "is the user online" term. A failed sign-in is a visible,
 * recoverable error on a screen the user opened on purpose; suppressing the
 * offer on a flaky connection would just move the prompt to a random later
 * launch.
 */
export function shouldShowJoinPrompt(s: {
  hasImported: boolean;
  joined: boolean;
  asked: boolean;
  declined: boolean;
}): boolean {
  if (s.joined || s.declined || s.asked) return false;
  return s.hasImported;
}

// ── handles ──────────────────────────────────────────────────────────────────
//
// Mirrored **character-for-character** from `backend/src/pure.ts`. The server
// is the authority — it re-validates everything — but the app validates too so
// the user learns the rule while typing rather than after a round trip.
// Divergence here would show a green tick for a handle the server then
// refuses, which is worse than not checking at all.

/** Handles the server keeps for itself. Lowercase; compared after normalising. */
export const RESERVED_HANDLES: readonly string[] = [
  'admin',
  'opentv',
  'support',
  'help',
  'api',
  'moderator',
];

/** The prefix of a server-generated placeholder handle (`user_ab12cd34ef`). */
export const HANDLE_PLACEHOLDER_PREFIX = 'user_';

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;

/** NFKC, lowercase, trim. Everything downstream sees only this form. */
export function normaliseHandle(input: string): string {
  return input.normalize('NFKC').trim().toLowerCase();
}

export type HandleFailure = 'too_short' | 'too_long' | 'bad_characters' | 'reserved';

/**
 * `[a-z0-9_]` only, and that is not an oversight. A handle is an address people
 * type and read aloud; homograph attacks on a follow-someone-by-name flow are
 * not theoretical. A Cyrillic "а" fails here, which is the point.
 *
 * Takes the RAW input and normalises internally, so a caller cannot forget to.
 */
export function isHandleValid(
  input: string,
): { ok: true; handle: string } | { ok: false; reason: HandleFailure } {
  const h = normaliseHandle(input);
  if (h.length < HANDLE_MIN) return { ok: false, reason: 'too_short' };
  if (h.length > HANDLE_MAX) return { ok: false, reason: 'too_long' };
  if (!/^[a-z0-9_]+$/.test(h)) return { ok: false, reason: 'bad_characters' };
  if (h.startsWith(HANDLE_PLACEHOLDER_PREFIX)) return { ok: false, reason: 'reserved' };
  if (RESERVED_HANDLES.includes(h)) return { ok: false, reason: 'reserved' };
  return { ok: true, handle: h };
}

/** True when the app must run the handle flow before anything social. */
export function needsHandle(handle: string): boolean {
  return handle.startsWith(HANDLE_PLACEHOLDER_PREFIX);
}

/**
 * A first suggestion for the handle field, from the imported TV Time name.
 *
 * Deliberately lossy and deliberately allowed to fail: it strips what the rule
 * forbids rather than transliterating, because a name in Arabic or Japanese
 * has no honest ASCII handle and inventing one ("user4821") is worse than an
 * empty field the user fills in themselves. `null` means "leave it blank".
 *
 * The suggestion is a starting point, never a claim: the server owns
 * uniqueness and refuses a taken handle whatever the app pre-filled.
 */
export function suggestedHandle(name: string | null | undefined): string | null {
  if (!name) return null;
  const stripped = normaliseHandle(name)
    .replace(/[^a-z0-9_]+/g, '_') // spaces, dots and punctuation all become _
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, HANDLE_MAX);
  // Trimming to the maximum can leave a trailing separator behind.
  const trimmed = stripped.replace(/_+$/g, '');
  return isHandleValid(trimmed).ok ? trimmed : null;
}

/**
 * The locale key for an `ApiError.code`.
 *
 * The server's English `message` never reaches a user (see the header of
 * `api.ts`): OpenTV ships in six languages and the server does not know which
 * one this phone is in. Codes come across the wire, strings come out of the
 * locale files, and this is the only join between them.
 *
 * The return type is a literal union deliberately, not `string`: it is
 * assignable to `LocaleKey`, so a key deleted from en.json breaks the build
 * here rather than rendering as the raw key on a user's screen.
 *
 * The default is `community.error.generic` rather than a thrown error — a
 * failure path must never fail. Unknown codes are the ones most likely to
 * appear after a server change, which is exactly when the app must still say
 * something sensible.
 */
export function communityErrorKey(
  code: string,
):
  | 'community.error.network'
  | 'community.error.rateLimited'
  | 'community.error.signInRejected'
  | 'community.error.handleTaken'
  | 'community.error.handleInvalid'
  | 'community.error.generic' {
  switch (code) {
    case 'network':
      return 'community.error.network';
    case 'rate_limited':
      return 'community.error.rateLimited';
    case 'unauthenticated':
    case 'forbidden':
      return 'community.error.signInRejected';
    case 'handle_taken':
      return 'community.error.handleTaken';
    case 'handle_invalid':
      return 'community.error.handleInvalid';
    default:
      return 'community.error.generic';
  }
}

/** The locale key explaining why a handle is refused, before any round trip. */
export function handleFailureKey(
  reason: HandleFailure,
):
  | 'community.handle.errTooShort'
  | 'community.handle.errTooLong'
  | 'community.handle.errCharacters'
  | 'community.handle.errReserved' {
  switch (reason) {
    case 'too_short':
      return 'community.handle.errTooShort';
    case 'too_long':
      return 'community.handle.errTooLong';
    case 'bad_characters':
      return 'community.handle.errCharacters';
    case 'reserved':
      return 'community.handle.errReserved';
  }
}

/**
 * Builds the `/movie/[name]` route, carrying along whatever identity/preview
 * hints the caller already has in hand (a search or catalog row usually has a
 * poster and year right there — losing them on navigation is what left the
 * detail screen blank for anything not yet in the library).
 *
 * `tvdbId` rides along the same way: a TheTVDB-first catalog hit (search,
 * Explore, Discover) always carries one and never a `tmdbId`, and without it
 * the movie screen had no identity to fetch real detail by at all — TheTVDB
 * has no name-search precise enough to stand in for a direct id lookup.
 *
 * `poster` is a full URL, so it's percent-encoded like any other query value
 * — `encodeURIComponent` on the whole querystring segment, not just the path.
 * Every param is optional and omitted entirely when absent, so a bare
 * imported title with nothing to offer still produces the same plain route
 * it always has.
 */
export function movieRoute(
  name: string,
  hints: { tmdbId?: number | null; tvdbId?: number | null; poster?: string | null; year?: string | null } = {},
): string {
  const parts: string[] = [];
  if (hints.tmdbId != null) parts.push(`tmdbId=${encodeURIComponent(String(hints.tmdbId))}`);
  if (hints.tvdbId != null) parts.push(`tvdbId=${encodeURIComponent(String(hints.tvdbId))}`);
  if (hints.poster) parts.push(`poster=${encodeURIComponent(hints.poster)}`);
  const year = movieYear(hints.year);
  if (year) parts.push(`year=${encodeURIComponent(year)}`);
  return `/movie/${encodeURIComponent(name)}${parts.length ? `?${parts.join('&')}` : ''}`;
}

/**
 * Which row a movie route actually means, given what was tapped to get there
 * (a candidate — always a name, a tmdbId only when the tap came from a
 * search/catalog result rather than a bare imported title) and the rows
 * already in the library.
 *
 * This is the fix for routing `/movie/[name]` by title: two different films
 * can share a display name ("Amado" 2011 vs. 2022), so once a candidate
 * carries a real tmdbId it is checked against every row's tmdbId FIRST, and
 * wins outright the moment one matches — before name is even considered.
 * That check has to run as its own pass, not by folding it into a single
 * `rows.find(movieIdentityMatches(...))` scan: `movieIdentityMatches` falls
 * back to a name compare for any row that itself has no tmdbId, so if such a
 * same-named row happened to sit earlier in `rows` than the true tmdbId
 * match, a naive single-pass scan could return the wrong one. Checking every
 * row's tmdbId before ever consulting a name removes that ordering hazard.
 *
 * When no row's tmdbId matches — including when the candidate has none at
 * all, true for the overwhelming majority of rows, since a GDPR-imported
 * movie is never matched against TMDB — name is the only evidence there is,
 * so it decides, exactly as `getMovie()` already does today. That includes
 * the case where an existing row has no tmdbId of its own: a real tmdbId on
 * the candidate still can't distinguish itself from that row, so this falls
 * back to matching it by name. That is a deliberate, known limitation (an
 * imported, unmatched row can still collapse with an unrelated same-named
 * add) left as-is for the owner to decide, not something this function
 * papers over.
 *
 * `tmdbId === 0` is TheTVDB-match sentinel (see `movieMatchState`), not a
 * real TMDB id — it is falsy, so it is never used to decide identity here
 * either, on the candidate side or the row side, same as `movieIdentityMatches`.
 */
export function resolveMovieRow<T extends MovieLibraryEntry>(candidate: MovieIdentityCandidate, rows: readonly T[]): T | null {
  if (candidate.tmdbId) {
    const byId = rows.find((r) => r.tmdbId === candidate.tmdbId);
    if (byId) return byId;
  }
  // The year has to come along. Dropping it here was the bug: TheTVDB gives
  // movies no TMDB id, so for two films sharing a title BOTH candidates fall
  // to the name compare, and tapping "Amado" (2011) opened "Amado" (2022)
  // simply because that row was found first.
  return rows.find((r) => movieIdentityMatches({ tmdbId: null, name: candidate.name, year: candidate.year }, r)) ?? null;
}

// ---- search catalogue merge -------------------------------------------------

type SearchHit = { kind: 'tv' | 'movie'; title: string; sub: string };

/**
 * The four-digit year embedded in a catalog row's `sub` line ("2026",
 * "2 seasons • BBC"), the only place either provider's search result carries
 * one. Used purely to tell same-titled rows apart when de-duping, same idea
 * as `movieYear` but reading out of free text instead of a dedicated field.
 */
function searchHitYear(sub: string): string {
  return (sub.match(/\b(\d{4})\b/) ?? [])[1] ?? '';
}

function searchDedupeKey(h: SearchHit): string {
  return `${h.kind}:${h.title.trim().toLowerCase()}:${searchHitYear(h.sub)}`;
}

/**
 * Which of the two kinds TheTVDB's search came back with nothing for, so the
 * caller knows what (if anything) is worth asking TMDB about.
 *
 * TheTVDB is the primary catalogue for search — it is asked first and its
 * rows are trusted as-is. But its coverage is uneven: a query can turn up a
 * film and nothing else, even when a series of the same or a similar name
 * exists on TMDB (the reported case: TheTVDB's "Amadeo" search returns a 2023
 * film and no series at all). Asking TMDB only for the kind(s) genuinely
 * missing keeps the common case — TheTVDB already covers both kinds — at the
 * same single request it costs today.
 */
export function missingSearchKinds(primary: readonly { kind: 'tv' | 'movie' }[]): ('tv' | 'movie')[] {
  const kinds: ('tv' | 'movie')[] = ['tv', 'movie'];
  return kinds.filter((k) => !primary.some((p) => p.kind === k));
}

/**
 * Appends TMDB's supplement rows after TheTVDB's, skipping any that duplicate
 * a title TheTVDB already returned (same kind, title and year).
 *
 * The caller is expected to have already filtered `supplement` down to the
 * kind(s) `missingSearchKinds` reported empty, so overlap should not arise in
 * practice — but a title-based safety net is cheap and this is exactly the
 * kind of silent-duplicate bug that is easy to reintroduce later (e.g. if a
 * TMDB multi-search result's kind is ever miscategorised upstream), so it is
 * checked here rather than assumed.
 */
export function mergeSearchFallback<T extends SearchHit>(primary: readonly T[], supplement: readonly T[]): T[] {
  const seen = new Set(primary.map(searchDedupeKey));
  const extra = supplement.filter((s) => !seen.has(searchDedupeKey(s)));
  return [...primary, ...extra];
}

/**
 * Whether a periodic background resync should actually run this time.
 *
 * Rescheduling every episode reminder means cancelling all pending
 * notifications, walking every episode of every followed show, and issuing one
 * native scheduling call per reminder. That is fine occasionally and far too
 * expensive to do on every trip to the background: a user reported buttons
 * lagging for seconds after switching to another app and back, because the
 * resync kicked off as they left and was still running when they returned.
 *
 * Nothing it computes changes minute to minute — reminders are for episodes
 * airing days ahead — so a gap between runs costs nothing and removes the
 * stall. A `lastAt` in the future (clock changed, restored backup) is treated
 * as "run now" rather than blocking resyncs until the clock catches up.
 */
export function shouldResync(lastAt: number | null | undefined, now: number, minGapMs: number): boolean {
  if (lastAt == null || !Number.isFinite(lastAt) || lastAt <= 0) return true;
  if (lastAt > now) return true;
  return now - lastAt >= minGapMs;
}

// ── community ratings ────────────────────────────────────────────────────────
//
// Three pure readings of what `GET /v1/aggregates` hands back. The network,
// the cache and the screen all live in `community-ratings.ts`; the arithmetic
// lives here so it can be tested without a fetch or a database.

/**
 * Whether a cached aggregate may still be shown without refetching.
 *
 * The TTL is the server's own: `Cache-Control: public, max-age=300`. Matching
 * it exactly means the phone never asks for something the edge would answer
 * from cache anyway, and never shows a number older than the edge would.
 *
 * A `fetchedAt` in the FUTURE is stale, not fresh-forever. A restored backup or
 * a corrected clock can put a timestamp ahead of `now`; treating that as fresh
 * would freeze the number until the clock caught up — which for a manual
 * timezone fix could be hours. Same reasoning as `shouldResync` above.
 *
 * Exactly at the TTL counts as stale: `max-age=300` means "good for 300
 * seconds", and the 300th is the first one it is not.
 */
export function aggregateFresh(
  fetchedAt: number | null | undefined,
  now: number,
  ttlMs: number,
): boolean {
  if (fetchedAt == null || !Number.isFinite(fetchedAt) || fetchedAt <= 0) return false;
  if (fetchedAt > now) return false;
  return now - fetchedAt < ttlMs;
}

/**
 * The community's score out of 10, or null when nobody has scored it.
 *
 * WHY `score_sum / vote_count` AND NOT SOMETHING CLEVERER. The server exposes
 * the two raw columns deliberately (`backend/src/routes/ratings.ts`,
 * `shapeAggregate`) because `rating_aggregates` carries no `scored_count`:
 * `vote_count` counts *people who voted*, and an emotion-only vote is a person
 * who voted. So this average is "average of the votes cast", with emotion-only
 * votes contributing 0 to the sum and 1 to the divisor — it drags the number
 * down, and that is the documented, intended reading
 * (backend/docs/IMPLEMENTATION.md Step 2, "The delta logic").
 *
 * DO NOT "FIX" THIS by dividing by some inferred count of scored votes. That
 * count does not exist anywhere in the schema, so any client-side attempt to
 * reconstruct it would be a guess, and it would disagree with every other
 * client. If the reading is ever to change it changes on the server, by adding
 * the column, not here.
 *
 * One decimal: a 1–10 scale with thousands of voters moves in tenths, and a
 * figure that renders as "8" next to five stars reads like a star count.
 */
export function communityScore(voteCount: number, scoreSum: number): number | null {
  if (!Number.isFinite(voteCount) || voteCount <= 0) return null;
  if (!Number.isFinite(scoreSum)) return null;
  return Math.round((scoreSum / voteCount) * 10) / 10;
}

export type TopEmotion = { emotion: string; percent: number };

/**
 * The emotion most people picked, and its share of the emotions cast.
 *
 * Accepts either the parsed object the API returns or the raw JSON string a
 * cache round-trip might hand back, and answers null for anything unusable —
 * absent, empty, malformed, or all zeroes. A blob of JSON written by another
 * client is untrusted input; it must never throw on the way to a render.
 *
 * TIES BREAK ALPHABETICALLY. Two emotions on 40 each is common early on, and
 * `Object.entries` order is insertion order, which the server's `json_set`
 * upserts reorder as counts move. Without a deterministic rule the label would
 * flip between two equal winners on every refresh — visible, and read as a bug.
 *
 * The percentage is of emotions cast, not of `vote_count`: score-only votes
 * carry no emotion, and counting them in the denominator would make "62% found
 * it scary" mean "62% of everyone, including the people who said nothing about
 * how it felt", which is not what the sentence says.
 */
export function topEmotion(counts: unknown): TopEmotion | null {
  let parsed: unknown = counts;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  let total = 0;
  let best: TopEmotion | null = null;
  let bestCount = 0;
  for (const [emotion, raw] of Object.entries(parsed as Record<string, unknown>)) {
    const n = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0;
    if (n === 0) continue;
    total += n;
    if (n > bestCount || (n === bestCount && best !== null && emotion < best.emotion)) {
      bestCount = n;
      best = { emotion, percent: 0 };
    }
  }
  if (!best || total <= 0) return null;
  return { emotion: best.emotion, percent: Math.round((bestCount / total) * 100) };
}

// ── comments ─────────────────────────────────────────────────────────────────
//
// The pure half of Phase 4. Everything here mirrors a rule the server also
// enforces (`backend/src/pure.ts`, `backend/src/routes/comments.ts`); none of
// it is the authority. The server is. These exist so the app can refuse an
// impossible action before spending a round trip on it, and so the reasons it
// refuses are testable without a network.

/**
 * Counted in CODE POINTS, matching `COMMENT_BODY_MAX` and `validateCommentBody`
 * in `backend/src/pure.ts` exactly. A UTF-16 length would let a body of 1,400
 * emoji through the app and straight into a 400, and would make "2,000
 * characters" mean something different in Arabic than in English.
 */
export const COMMENT_BODY_MAX = 2000;

export type CommentBodyFailure = 'empty' | 'too_long';

/**
 * Why a composed comment cannot be sent, or null when it can.
 *
 * Trimmed first, like the server: a body of spaces and newlines is empty, not
 * short. An emoji-only body is VALID — it is a complete reaction, it is what
 * half of TV Time's comments were, and the code-point count above is what
 * keeps it from being measured as two characters per emoji.
 */
export function commentBodyError(text: string): CommentBodyFailure | null {
  const body = text.trim();
  if (body.length === 0) return 'empty';
  if ([...body].length > COMMENT_BODY_MAX) return 'too_long';
  return null;
}

/**
 * Replies are ONE LEVEL DEEP. A reply cannot be replied to.
 *
 * The server refuses a deeper one outright (`replyDepthOk`), so a UI that
 * offered the button would be offering a 400. Mirrored here rather than
 * imported because the rule is a product decision — "deeper threading is a
 * moderation problem wearing a feature costume" — and both halves must be able
 * to state it.
 */
export function canReplyTo(comment: { parent_id: string | null }): boolean {
  return comment.parent_id === null;
}

/**
 * Whether a comment's body must stay behind the tap-to-reveal.
 *
 * Revealing is per-comment and lives in the screen's state, never persisted:
 * the flag is the author's claim about their own text, and a reader who
 * revealed one spoiler last week has not agreed to see every spoiler forever.
 */
export function spoilerHidden(
  comment: { id: string; is_spoiler: number | boolean },
  revealedIds: ReadonlySet<string>,
): boolean {
  const flagged = comment.is_spoiler === true || comment.is_spoiler === 1;
  return flagged && !revealedIds.has(comment.id);
}

/** The unit and count a timestamp reads as, or null when it is unparseable. */
export type RelativeTime = {
  key:
    | 'community.time.now'
    | 'community.time.minutes'
    | 'community.time.hours'
    | 'community.time.days'
    | 'community.time.weeks'
    | 'community.time.months'
    | 'community.time.years';
  count: number;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "3 hours" as a key and a count, never as a formatted string.
 *
 * The formatting belongs to i18n — six languages, two of which pluralise on
 * rules English does not have — so this returns what to say and how many, and
 * `t()` decides how it reads. That also makes it testable without a locale.
 *
 * A FUTURE timestamp reads as "now", not as a negative age. Phone clocks are
 * wrong, servers stamp in UTC, and "in -2 minutes" is the kind of detail that
 * makes a whole screen look broken. Unparseable input returns null, and the
 * row simply shows no time rather than the word "Invalid Date".
 */
export function relativeTime(iso: string, now: number): RelativeTime | null {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;

  const ms = now - then;
  if (ms < MINUTE) return { key: 'community.time.now', count: 0 };
  if (ms < HOUR) return { key: 'community.time.minutes', count: Math.floor(ms / MINUTE) };
  if (ms < DAY) return { key: 'community.time.hours', count: Math.floor(ms / HOUR) };
  if (ms < 7 * DAY) return { key: 'community.time.days', count: Math.floor(ms / DAY) };
  if (ms < 30 * DAY) return { key: 'community.time.weeks', count: Math.floor(ms / (7 * DAY)) };
  if (ms < 365 * DAY) return { key: 'community.time.months', count: Math.floor(ms / (30 * DAY)) };
  return { key: 'community.time.years', count: Math.floor(ms / (365 * DAY)) };
}

/**
 * The locale key for a failure on the comment surface.
 *
 * Deliberately NOT folded into `communityErrorKey`: that one answers for the
 * sign-in and handle screens, where `not_found` and `too_large` genuinely have
 * nothing better to say than "something went wrong". Here they do — a comment
 * can be too long, and a comment can have been deleted while you were reading
 * it. Anything this surface has no specific words for falls through to the
 * shared mapping, so there is still exactly one default.
 */
export function commentErrorKey(
  code: string,
): ReturnType<typeof communityErrorKey> | 'community.comments.errTooLong' | 'community.comments.errGone' {
  switch (code) {
    case 'too_large':
    case 'invalid_body':
      return 'community.comments.errTooLong';
    case 'not_found':
    // `forbidden` is what DELETE answers for a comment that is not yours AND
    // for one that does not exist — deliberately indistinguishable, so DELETE
    // cannot be used to discover which ids are real. The UI only offers delete
    // on your own rows, so on this surface it means the row is already gone.
    case 'forbidden':
      return 'community.comments.errGone';
    default:
      return communityErrorKey(code);
  }
}

/**
 * The server's report reasons, mirrored from `REPORT_REASONS` in
 * `backend/src/pure.ts`. Anything outside this list earns a 400, so the picker
 * is generated from it rather than hand-listed in JSX.
 */
export const REPORT_REASONS = ['spam', 'harassment', 'hate', 'sexual', 'violence', 'spoiler', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** The label for a reason. A literal union, so a deleted key breaks the build. */
export function reportReasonKey(
  reason: ReportReason,
):
  | 'community.report.spam'
  | 'community.report.harassment'
  | 'community.report.hate'
  | 'community.report.sexual'
  | 'community.report.violence'
  | 'community.report.spoiler'
  | 'community.report.other' {
  return `community.report.${reason}` as const;
}
