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

// ── the background prefetch of aggregates ────────────────────────────────────
//
// WHY THIS EXISTS AT ALL. Every community percentage in the app used to arrive
// on demand: open a show, one request for that season; open a film, one request
// for that film. Which means a library of two hundred titles showed no
// percentages anywhere until the user had opened two hundred screens, one at a
// time, and the owner's complaint — "I have to open one each time" — is an
// exact description of that design rather than a bug in it.
//
// The server has supported the bulk form since the first version of
// `GET /v1/aggregates`: `?t=source:key[:season:episode]` repeated, up to
// `MAX_TARGETS` of them, edge-cached for everybody at once. So the fix is not a
// new endpoint, it is asking for a hundred at a time in the background instead
// of one at a time in front of the user.
//
// WHAT IS NOT PREFETCHED, AND WHY. Not the watch history. A seven-year archive
// is tens of thousands of episodes, which is hundreds of requests, which would
// break the whole free-tier assumption of `backend/docs/PLAN.md` §4 (~5
// requests per user per day) on its own. Only what the user RATED: it is the
// smaller set by an order of magnitude, it is the set the percentages are drawn
// under, and it is the set the user will recognise.

/** `MAX_TARGETS` in `backend/src/pure.ts`. More than this in one call is a 400. */
export const PREFETCH_TARGET_CHUNK = 100;

/** One target string, in the grammar `parseTargets` reads. */
export type PrefetchEpisode = { showId: number; season: number; episode: number };
export type PrefetchMovie = { name: string; year: string | null };

function isCountingNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

/**
 * Every target the user could see a number for, as the server spells them.
 *
 * THE GRAMMAR IS NOT NEGOTIABLE and is `parseTargets` in `backend/src/pure.ts`:
 * the source up to the FIRST colon, then a remainder whose LAST TWO
 * colon-separated parts are the season and episode if and only if both are runs
 * of digits. Two consequences this builder is written around:
 *
 *  - A show/film-level target must carry NO colons in its remainder at all.
 *    `title:dune-part-two|2024` parses (one part, season/episode default to
 *    -1/-1, which is the row `postRating` writes with `season: null`). A film
 *    key can hold `|`, which the split never looks at — that is why the film
 *    identity uses a pipe and not a colon.
 *  - `parts.length === 2` is rejected OUTRIGHT by the server ("half a pair"), so
 *    an episode target must always carry both numbers, never just a season.
 *
 * SKIPPED RATHER THAN GUESSED: a rating whose show is no longer in the library
 * (a stale TheTVDB id the split-id migration re-keyed), a negative or
 * fractional season, and a film whose title slugs to nothing. Each of those
 * would still cost one of the hundred slots in a chunk and could only ever come
 * back empty.
 *
 * Sorted and deduplicated, because the run's cursor is a string comparison
 * against this same order — see `prefetchRemaining`.
 */
export function buildPrefetchTargets(input: {
  episodes: readonly PrefetchEpisode[];
  movies: readonly PrefetchMovie[];
  knownShowIds: ReadonlySet<number>;
}): string[] {
  const out = new Set<string>();

  for (const e of input.episodes) {
    if (!isCountingNumber(e.showId) || e.showId <= 0) continue;
    if (!input.knownShowIds.has(e.showId)) continue;
    if (!isCountingNumber(e.season) || !isCountingNumber(e.episode)) continue;
    out.add(`tvdb:${e.showId}:${e.season}:${e.episode}`);
  }

  for (const m of input.movies) {
    const name = (m.name ?? '').trim();
    if (!name) continue;
    const key = targetKey('title', { title: name, year: m.year });
    // `slug|year` with an empty slug is `|2011` — a stable key, but not one any
    // vote was ever filed under, because the film screen would not have had a
    // title to show either.
    if (key.startsWith('|')) continue;
    out.add(`title:${key}`);
  }

  return [...out].sort();
}

/**
 * Whether the background sweep may run again.
 *
 * Inverted `aggregateFresh`, deliberately rather than a second clock rule: a
 * timestamp in the FUTURE (restored backup, corrected timezone) reads as stale
 * there, so it reads as DUE here instead of locking the prefetch out until the
 * clock catches up. A run that never happened is due for the same reason.
 */
export function prefetchDue(
  lastRunAt: number | null | undefined,
  now: number,
  windowMs: number,
): boolean {
  return !aggregateFresh(lastRunAt, now, windowMs);
}

/**
 * What a resumed sweep has left to do.
 *
 * The cursor is the LAST TARGET STRING sent, not an index, for the same reason
 * `runKeyedSeed`'s is a sort key: targets appear and disappear between runs as
 * the user rates things, and an ordinal would silently step over a row that
 * sorted in behind the bookmark. An empty cursor is a sweep starting over.
 */
export function prefetchRemaining(targets: readonly string[], cursor: string): string[] {
  return cursor ? targets.filter((t) => t > cursor) : [...targets];
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

// ── the distribution, the way the design asks for it ─────────────────────────
//
// design/referance/12-episode-page-top.png is a column of percentages under
// every star and under every emotion tile — "BAD 0% · OK 0% · GOOD 5% · GREAT
// 13% · WOW 82%" — not a single mean. A mean cannot say "82% gave it five
// stars", which is the whole sentence the screen is making.

/** The server's score buckets, in star order: one star is a 2, five stars a 10.
 *
 *  Locked to `tellCommunity` in the episode and film screens, both of which
 *  send `(starIndex + 1) * 2`. A doubling, not a rescale, so nothing ever lands
 *  between the app's own five steps. Anything outside this set — a half-star
 *  build sending odd scores, a hand-written row, a future scale — is IGNORED
 *  rather than thrown on: this runs during render on a blob of JSON written by
 *  some other client, and a render must not be able to fail because of it. */
const SCORE_BUCKETS = [2, 4, 6, 8, 10] as const;

/**
 * Largest remainder, so a column of percentages reads as 100 and not as 101.
 *
 * WHY NOT `Math.round` PER SLICE, which is what everyone writes first. Round
 * each share independently and the errors do not cancel: three votes split
 * 1/1/1 rounds to 33/33/33 and reads as 99, while 1/1/1/1/2 on six rounds to
 * 17/17/17/17/33 and reads as 101. The design's own numbers (0/0/5/13/82) sum
 * to exactly 100, and a user reading five figures in a row WILL add them up.
 *
 * The rule: floor every share, then hand the leftover points out one at a time
 * to the largest fractional remainders. Ties go to the earlier index — stars
 * are ordered, so "the lower star keeps the point" is at least a rule, where
 * `Object.entries` order is whatever the server's last `json_set` produced.
 *
 * Returns integers summing to exactly 100 whenever `total > 0`.
 */
function largestRemainder(counts: readonly number[], total: number): number[] {
  if (total <= 0) return counts.map(() => 0);
  const exact = counts.map((c) => (c / total) * 100);
  const out = exact.map((v) => Math.floor(v));
  let left = 100 - out.reduce((a, b) => a + b, 0);
  // Indices by descending remainder; a stable sort keeps ties in index order.
  const order = exact
    .map((v, i) => ({ i, rem: v - Math.floor(v) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) {
    const slot = order[k];
    if (slot) out[slot.i] = (out[slot.i] ?? 0) + 1;
  }
  return out;
}

/** Only finite, positive numbers count. Everything else is a zero, never a throw. */
function countAt(counts: Record<string, unknown>, key: string): number {
  const raw = counts[key];
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** A counts blob from the API, or the JSON string a cache round-trip may hand
 *  back, reduced to a plain object. Anything unusable becomes null. */
function countsObject(counts: unknown): Record<string, unknown> | null {
  let parsed: unknown = counts;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/**
 * The five star shares, index 0–4 for one to five stars, or null for no data.
 *
 * THE DENOMINATOR IS THE SCORED VOTES — the SUM OF `score_counts`' values —
 * NOT `vote_count`, and it always has been (`total`, below). `vote_count` counts
 * people who voted, and an emotion-only vote is a person who voted (see
 * `communityScore` above) — dividing by it would make the five figures sum to
 * something less than 100 on any episode where somebody picked a face without
 * picking a star, and the design's column is plainly a distribution of the
 * ratings given. `voteCount` is still taken, and still decides: a rollup
 * claiming nobody voted has nothing to show whatever its blob says, and the
 * two can disagree while the server's nightly `counter_repair` catches up.
 */
export function starPercents(counts: unknown, voteCount: number): number[] | null {
  if (!Number.isFinite(voteCount) || voteCount <= 0) return null;
  const obj = countsObject(counts);
  if (!obj) return null;

  const raw = SCORE_BUCKETS.map((b) => countAt(obj, String(b)));
  const total = raw.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  return largestRemainder(raw, total);
}

/**
 * Every emotion's share of the SELECTIONS cast, keyed by the server's name.
 *
 * `{}` — never null — for absent, empty, malformed or all-zero input, so the
 * caller renders one shape and a lookup miss is simply "no percentage here".
 *
 * THE DENOMINATOR IS THE SUM OF THE COUNTS, AND `vote_count` IS NOT AN INPUT
 * AT ALL. Since the set contract (backend commit d844861) a person's feelings
 * are a SET: `emotion_counts` counts SELECTIONS while `vote_count` counts
 * PEOPLE, so the two are not on the same scale and one cannot be a share of the
 * other. One person who picked shocked and thrilled is `{shocked:1,thrilled:1}`
 * against a `vote_count` of 1 — over `vote_count` that reads 100%/100%, which
 * is what the film screen actually printed. Over the two selections it reads
 * 50%/50%, which is what it means.
 *
 * Passing `vote_count` in as a gate was also wrong in its own right: it made a
 * rollup mid-repair (counts present, count drifted to 0) hide figures it holds.
 * The counts alone decide.
 *
 * Names are NOT filtered against the app's twelve. An unknown emotion from a
 * newer client still belongs in the denominator — dropping it would inflate
 * everything else — and the screen simply has no tile to hang it under.
 */
export function emotionPercents(counts: unknown): Record<string, number> {
  const obj = countsObject(counts);
  if (!obj) return {};

  // Sorted so the ordering fed to the tie-break is the blob's key order made
  // deterministic, rather than whatever order the server's json_set left.
  const names = Object.keys(obj).sort();
  const raw = names.map((n) => countAt(obj, n));
  const total = raw.reduce((a, b) => a + b, 0);
  if (total <= 0) return {};

  const pct = largestRemainder(raw, total);
  const out: Record<string, number> = {};
  names.forEach((n, i) => {
    out[n] = pct[i] ?? 0;
  });
  return out;
}

/**
 * The figure under each face in "Who was your favourite?" — character name to
 * whole percent, summing to 100 by the same largest-remainder rule the feelings
 * tiles use.
 *
 * THE DENOMINATOR IS THE SUM OF THE VOTES, NOT `total`, and the two are only
 * incidentally the same. `total` counts PEOPLE and the server maintains it on
 * write, so a rollup mid-repair — counts present, `total` drifted — would
 * otherwise print percentages that do not add up, or none at all. The votes
 * being divided are the only numbers guaranteed to be consistent with each
 * other. `total` is still taken, and still respected: a server that reports
 * nobody has voted is believed even if a stale `counts` blob says otherwise,
 * because that is the shape a just-recounted empty row has.
 *
 * Malformed input is {} and never a throw — this is called during render, from
 * a blob that survived a cache round trip. Nothing here can take a screen down.
 */
export function characterPercents(items: unknown, total?: unknown): Record<string, number> {
  if (typeof total === 'number' && Number.isFinite(total) && total <= 0) return {};
  if (!Array.isArray(items)) return {};

  // Name → votes, folded first so a blob that repeats a name cannot be counted
  // twice and cannot produce two rows for one face.
  const counts = new Map<string, number>();
  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const it = raw as { character?: unknown; votes?: unknown };
    if (typeof it.character !== 'string' || it.character.length === 0) continue;
    const votes = it.votes;
    if (typeof votes !== 'number' || !Number.isFinite(votes) || votes <= 0) continue;
    counts.set(it.character, (counts.get(it.character) ?? 0) + Math.floor(votes));
  }
  if (counts.size === 0) return {};

  // Sorted for the same reason `emotionPercents` sorts: the tie-break inside
  // largestRemainder must not depend on the server's key order.
  const names = [...counts.keys()].sort();
  const raw = names.map((n) => counts.get(n) ?? 0);
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) return {};

  const pct = largestRemainder(raw, sum);
  const out: Record<string, number> = {};
  names.forEach((n, i) => {
    out[n] = pct[i] ?? 0;
  });
  return out;
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

// ── profiles, following, notifications ───────────────────────────────────────
//
// The pure half of Phase 5. As with the comment rules above, none of this is
// the authority — the server is. `visibleProfileFields` in particular is a
// character-for-character mirror of `backend/src/pure.ts`, and it exists on
// this side so a cached profile cannot out-live the rule that hid half of it.

/** The four numbers a profile carries, as `ProfileCounts` on the server. */
export type ProfileCounts = {
  followers: number;
  following: number;
  comments: number;
  lists: number;
};

/** The fields the privacy rule acts on. Anything with these may be passed in. */
export type ProfileVisibility = {
  is_private: boolean;
  bio: string | null;
  links: unknown;
  counts: ProfileCounts | null;
};

/**
 * The `is_private` matrix, mirroring `visibleProfileFields` in
 * `backend/src/pure.ts` line for line.
 *
 * A private profile still returns its SHELL — handle, display name, avatar,
 * `is_private: true` — because you cannot ask to follow somebody you cannot
 * find. What it withholds is bio, links and counts, and it withholds them from
 * everyone except the owner and an accepted follower.
 *
 * WHY THE CLIENT REPEATS A SERVER RULE. The server already strips these before
 * they leave, so on a fresh read this function changes nothing. It earns its
 * place on the two paths where the server is not in the loop: a profile held in
 * state while the viewer unfollows, and any future cache. Both would otherwise
 * keep showing a bio the rule has since taken away.
 */
export function visibleProfileFields<T extends ProfileVisibility>(
  profile: T,
  viewerFollows: boolean,
  isSelf: boolean,
): T {
  if (!profile.is_private || isSelf || viewerFollows) return { ...profile };
  return { ...profile, bio: null, links: null, counts: null };
}

/** The notification kinds the server writes. Mirrored from its `kind` column. */
export const NOTIFICATION_KINDS = ['reply', 'like', 'follow', 'friend_found', 'moderation'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationTextKey =
  | 'community.notifications.reply'
  | 'community.notifications.replyAnon'
  | 'community.notifications.like'
  | 'community.notifications.likeAnon'
  | 'community.notifications.follow'
  | 'community.notifications.followAnon'
  | 'community.notifications.friendFound'
  | 'community.notifications.friendFoundAnon'
  | 'community.notifications.moderation'
  | 'community.notifications.unknown';

/** What one notification says: a key, and the values it interpolates. */
export type NotificationText = { key: NotificationTextKey; params: Record<string, string> };

/**
 * The sentence a notification reads as, as a key and its parameters — never as
 * a built string.
 *
 * NO CONCATENATION, and this is the whole reason the function exists. "@sara
 * replied to your comment" is a handle followed by a verb in English and very
 * nearly the reverse in Arabic, so a client that glued `@handle` to a
 * translated fragment would produce a correct English sentence and a broken
 * Arabic one. Each kind is therefore one COMPLETE localised sentence with the
 * handle interpolated into it, and each language decides where the handle goes.
 *
 * A MISSING ACTOR IS ITS OWN KEY, not a translated word substituted into the
 * named sentence. `actor_id` is `ON DELETE SET NULL`, so a notification outlives
 * the account that caused it and the server sends `actor: null` — the like
 * really happened and hiding it would be worse. Interpolating a translated
 * "someone" would put a noun where a proper name goes, which several of these
 * languages inflect differently; a separate sentence per kind lets each one be
 * written naturally.
 *
 * `moderation` never has an actor — the moderator is deliberately not named —
 * so it has one key and no parameters. An unrecognised kind falls back to a
 * neutral "something happened" line rather than being dropped: a server that
 * grows a new kind must not leave old clients with silent blank rows.
 */
export function notificationText(kind: string, actorHandle: string | null | undefined): NotificationText {
  const handle = typeof actorHandle === 'string' && actorHandle.length > 0 ? actorHandle : null;
  const named = handle !== null;
  switch (kind) {
    case 'reply':
      return named
        ? { key: 'community.notifications.reply', params: { handle } }
        : { key: 'community.notifications.replyAnon', params: {} };
    case 'like':
      return named
        ? { key: 'community.notifications.like', params: { handle } }
        : { key: 'community.notifications.likeAnon', params: {} };
    case 'follow':
      return named
        ? { key: 'community.notifications.follow', params: { handle } }
        : { key: 'community.notifications.followAnon', params: {} };
    case 'friend_found':
      return named
        ? { key: 'community.notifications.friendFound', params: { handle } }
        : { key: 'community.notifications.friendFoundAnon', params: {} };
    case 'moderation':
      return { key: 'community.notifications.moderation', params: {} };
    default:
      return { key: 'community.notifications.unknown', params: {} };
  }
}

/** Above this the badge stops counting and starts saying "lots". */
export const UNREAD_BADGE_MAX = 99;

/**
 * The badge on the bell, as a string — EMPTY when there is nothing to show.
 *
 * An empty string rather than "0" so the caller's test is `badge !== ''` and
 * there is exactly one place that decides what "no badge" means. A count the
 * server has not answered yet arrives here as a stale or negative number from
 * `meta`; both read as nothing rather than as a red dot promising activity that
 * is not there.
 */
export function unreadBadge(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  return n > UNREAD_BADGE_MAX ? `${UNREAD_BADGE_MAX}+` : String(Math.floor(n));
}

// ── bringing the archive with you ────────────────────────────────────────────
//
// Seeding turns comments the user wrote inside TV Time, years ago, into rows
// the community can read. Everything below is the pure half of it: the mapping
// and the arithmetic, with no database and no network, so the rules that decide
// what is uploaded are testable in isolation. `community-seed.ts` is the half
// that touches SQLite and the wire.

/** Everything a comment row must carry to be seedable. Matches the `comments` table. */
export type LocalComment = {
  /** `comment` or `reply` in the export. Both are the user's own words. */
  type?: string | null;
  /** "Attack on Titan S4E28", or a bare show/film title. */
  entity: string;
  text: string;
  /**
   * The local filename of the comment's PHOTOGRAPH, when the file reached this
   * device before TV Time's CDN went dark.
   */
  image?: string | null;
  /**
   * The photograph's ORIGINAL address in the export — dead now, and kept as
   * evidence rather than as a link. Its presence is what makes an empty `text`
   * legitimate: TV Time let a comment be a picture with no caption, and two of
   * the four in the reference export are exactly that. Keyed on separately
   * from `image` because a comment must not stop existing merely because its
   * picture could not be downloaded in time.
   */
  imageUrl?: string | null;
  /** TV Time's `created_at`: "2021-05-21 11:45:57", occasionally already ISO. */
  date: string;
};

/** What a resolver answers with: the thread this entity addresses, or nothing. */
export type SeedTarget = { source: 'tvdb' | 'tmdb' | 'title'; key: string };

/**
 * A resolver from a bare entity NAME (the "S4E28" already stripped) to a target.
 * Passed in rather than imported so this file stays free of the database.
 */
export type SeedTargetResolver = (entityName: string) => SeedTarget | null;

/** One item of `POST /v1/comments/import`, field for field as the Worker reads it. */
export type SeedItem = {
  target_source: 'tvdb' | 'tmdb' | 'title';
  target_key: string;
  season: number | null;
  episode: number | null;
  body: string;
  /** HISTORICAL, never now — the server sorts a 2019 comment as a 2019 comment. */
  created_at: string;
  lang: string | null;
  /**
   * Tells the server a photograph follows, which is the ONLY condition under
   * which it accepts an empty body. Set from the local row having an image
   * file, so it is never a claim the upload cannot honour.
   */
  has_image?: boolean;
};

/** "Show Name S4E28" → the season and episode, and the name without them. */
const EPISODE_SUFFIX = /\s+S(\d+)(?:E(\d+))?\s*$/i;

/**
 * TV Time stamps its exports "2021-05-21 11:45:57" — a space, no zone.
 *
 * That has to become real ISO before it goes out, for a reason that is easy to
 * miss: the server VALIDATES with `Date.parse` (which accepts either) but STORES
 * the string as given, and orders threads by it. A space sorts before "T", so a
 * space-form timestamp would file every imported comment underneath every
 * natively-written one whatever its year, and the cursor — `created_at|id`,
 * compared as text — would page through them in the wrong order. Naive times
 * are read as UTC, which is what TV Time exported.
 *
 * Anything unparseable answers null, and the caller drops the comment. Stamping
 * `now` on a timestamp we could not read would put a seven-year-old comment at
 * the top of tonight's thread, which is the one thing this whole endpoint exists
 * to avoid.
 */
export function seedTimestamp(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const naive = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(s);
  const iso = naive ? `${naive[1]}T${naive[2]}${naive[2].length === 5 ? ':00' : ''}Z` : s;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * One local comment as the server wants it, or null when it cannot be brought.
 *
 * NULL IS A COUNTED OUTCOME, not a swallowed error. Three things produce it and
 * all three are reported to the user rather than quietly dropped:
 *
 *  - the entity resolves to nothing this library still holds (a show deleted
 *    since, a film whose row never matched),
 *  - the body is empty — an image-only comment, and images are not part of the
 *    community surface (see the header of `community-comments.ts`),
 *  - the date cannot be read at all.
 *
 * `lang` IS ALWAYS NULL, deliberately. The export does not record what language
 * a comment was written in, and stamping the app's current locale would assert
 * something untrue about every comment the user wrote in a different one —
 * which then drives other people's language filters. Unknown is the honest
 * value, and the column is nullable for exactly this case.
 *
 * A `reply` row lands as a TOP-LEVEL comment: the export carries no link to the
 * comment it answered, and the parent is somebody else's row that was never in
 * this database. Losing the thread shape is the honest cost of keeping the
 * words; inventing a parent would be worse.
 */
export function localCommentToSeed(row: LocalComment, resolveTarget: SeedTargetResolver): SeedItem | null {
  const body = (row.text ?? '').trim();
  // WORDS OR A PICTURE. An empty body was once disqualifying, which quietly
  // dropped every caption-less photo comment — and with it every image the
  // rescue was built to save, since an image is attached to a comment that has
  // to exist first.
  const had = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  const hasImage = had(row.image) || had(row.imageUrl);
  if (body.length === 0 && !hasImage) return null;

  const created_at = seedTimestamp(row.date);
  if (created_at === null) return null;

  const raw = (row.entity ?? '').trim();
  const m = EPISODE_SUFFIX.exec(raw);
  const name = (m ? raw.slice(0, m.index) : raw).trim();
  if (name.length === 0) return null;

  const target = resolveTarget(name);
  if (!target) return null;

  // "S4" with no episode is a season comment; the server takes a season with a
  // null episode, and it addresses the season's own thread.
  const season = m ? Number(m[1]) : null;
  const episode = m && m[2] !== undefined ? Number(m[2]) : null;

  return {
    target_source: target.source,
    target_key: target.key,
    season,
    episode,
    body,
    created_at,
    lang: null,
    ...(hasImage ? { has_image: true } : {}),
  };
}

// ── the rest of the archive: ratings, feelings, favourites ───────────────────
//
// Seeding shipped with comments only, so every number the community screen drew
// started at zero and stayed there: a library with 2,000 rated episodes told the
// server about none of them. The three mappers below are the missing half, and
// they are here — pure, resolver-injected, database-free — for the same reason
// `localCommentToSeed` is: everything decided about WHAT is published happens in
// one readable place with a test standing over it.

/**
 * The emotion allow-list, index-locked to the local grid.
 *
 * The local tables store an INDEX, not a name: `episode_emotions.emotion` is
 * 0–11 and the `emotions` table's movie rows are the same 0–11 offset by 28 (the
 * raw TV Time export ids). That index means nothing to the server, which takes
 * one of these twelve names and interpolates it into a JSON path — so this array
 * is the whole translation, and its ORDER is the contract. Reorder it and every
 * archived "shocked" becomes an archived "frustrated" on somebody else's screen.
 *
 * Mirrored from `EMOTIONS` in `backend/src/pure.ts`, and re-exported by
 * `community-ratings.ts` as `COMMUNITY_EMOTIONS` so the live vote path and the
 * seeding path cannot drift apart: there is one list, in this file, because this
 * is the file the tests can reach.
 */
export const EMOTION_NAMES = [
  'shocked',
  'frustrated',
  'sad',
  'reflective',
  'touched',
  'amused',
  'scared',
  'bored',
  'understood',
  'thrilled',
  'confused',
  'tense',
] as const;
export type EmotionName = (typeof EMOTION_NAMES)[number];

/** Local stars run 1–5. The server's scale is 1–10. */
export const LOCAL_STARS_MAX = 5;

/**
 * A local star rating on the server's scale, or null when it is not a rating.
 *
 * ONE STAR IS WORTH TWO POINTS, and this is not a rescale — it is the exact
 * arithmetic the live vote already uses. `tellCommunity` in
 * `src/app/episode/[id].tsx` and in `src/app/movie/[name].tsx` both send
 * `(nextStars + 1) * 2`, where `nextStars` is the ZERO-BASED index of the tapped
 * star (0–4) and the row written to SQLite is that index plus one (1–5). So the
 * value in `episode_ratings.stars` / `movies.stars` doubles directly:
 *
 *     1★ → 2   2★ → 4   3★ → 6   4★ → 8   5★ → 10
 *
 * Getting this wrong by the off-by-one — sending `stars * 2 + 2`, or halving the
 * live path's number — would file the whole archive one star away from every
 * rating the same user gives from now on, in the same average.
 *
 * Anything outside 1–5 is not a star this app can have written; it becomes null
 * rather than a clamped guess, and an item with no score and no emotion is not
 * sent at all (the server calls that `empty_vote`, correctly).
 */
export function seedScore(stars: number | null | undefined): number | null {
  if (typeof stars !== 'number' || !Number.isInteger(stars)) return null;
  if (stars < 1 || stars > LOCAL_STARS_MAX) return null;
  return stars * 2;
}

/** A local emotion index (0–11) as the server's name, or null if it is neither. */
export function seedEmotion(index: number | null | undefined): EmotionName | null {
  if (typeof index !== 'number' || !Number.isInteger(index)) return null;
  return EMOTION_NAMES[index] ?? null;
}

/**
 * A multi-select of local emotion tiles as the set of names the server takes.
 *
 * THE WHOLE SELECTION, because since the set contract every one of them counts.
 * Both vote screens hold their tiles in a `Set<number>` of grid indexes and both
 * used to walk it for the LOWEST index and send that one emotion; picking two
 * faces therefore put one of them on the server and threw the other away before
 * it ever left the phone.
 *
 * ORDER IS THE GRID'S, not the tap order's, and that is deliberate: the server
 * diffs the set it is given against the set it holds, so a stable order makes
 * re-sending an unchanged selection provably a no-op. Unknown indexes (a tile
 * this build has and `EMOTION_NAMES` does not, a negative, a fraction) are
 * dropped rather than guessed — an unvalidated name becomes a JSON path in the
 * aggregate upsert, so the allow-list is the border.
 */
export function emotionNames(selected: Iterable<number> | null | undefined): EmotionName[] {
  const want = new Set<number>();
  for (const i of selected ?? []) if (typeof i === 'number' && Number.isInteger(i)) want.add(i);
  const out: EmotionName[] = [];
  EMOTION_NAMES.forEach((name, i) => {
    if (want.has(i)) out.push(name);
  });
  return out;
}

/** A non-negative integer, or null. Season 0 is real (specials), so 0 passes. */
function seedOrdinal(v: number | null | undefined): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null;
  return v;
}

/**
 * One local vote, whichever of the two local shapes it came from.
 *
 * Shows are addressed by their TheTVDB id and carry a season and an episode;
 * films are addressed by title and year and carry neither, exactly as
 * `postRating` sends them from the film screen today.
 */
export type LocalRatingRow = {
  kind: 'show' | 'movie';
  showId?: number | null;
  title?: string | null;
  year?: string | null;
  season?: number | null;
  episode?: number | null;
  /** `episode_ratings.stars` / `movies.stars` — 1–5, or null for feeling-only. */
  stars: number | null;
  /** Grid indexes 0–11 — ALL of them. Both local emotion tables are
   *  multi-select, and so is the server's set: see `mergeRatingAndEmotion`. */
  emotions: number[];
};

/** Where a local vote's entity lives on the server, or nothing if it cannot be addressed. */
export type RatingTargetResolver = (row: LocalRatingRow) => SeedTarget | null;

/** One item of `POST /v1/ratings/import`, field for field as the Worker reads it. */
export type RatingSeedItem = {
  target_source: 'tvdb' | 'tmdb' | 'title';
  target_key: string;
  season: number | null;
  episode: number | null;
  score: number | null;
  /** The whole set. `POST /v1/ratings/import` reads `emotions: string[]` and
   *  seeds one `emotion_votes` row per member (backend `routes/import.ts`). */
  emotions: EmotionName[];
};

/**
 * One local rating (plus its feeling) as the server wants it, or null.
 *
 * NULL IS A COUNTED OUTCOME, as it is for comments. Three things produce it:
 *
 *  - neither a usable star nor a usable emotion — there is no vote to send, and
 *    the server would answer `empty_vote`,
 *  - the entity resolves to nothing (a show whose row is gone, a film with no
 *    title left to key on),
 *  - an episode number with no season, which is not addressable — the server
 *    rejects it as `episode_without_season`, so it is refused here rather than
 *    spent as one of the 500 items in a chunk.
 */
export function localRatingToSeed(
  row: LocalRatingRow,
  resolveTarget: RatingTargetResolver,
): RatingSeedItem | null {
  const score = seedScore(row.stars);
  const emotions = emotionNames(row.emotions);
  if (score === null && emotions.length === 0) return null;

  const season = seedOrdinal(row.season);
  const episode = seedOrdinal(row.episode);
  if (episode !== null && season === null) return null;

  const target = resolveTarget(row);
  if (!target) return null;

  return {
    target_source: target.source,
    target_key: target.key,
    season,
    episode,
    score,
    emotions,
  };
}

/**
 * The two local tables, folded into the one vote the server takes.
 *
 * The app keeps a rating in `episode_ratings` and any number of feelings in
 * `episode_emotions` (films: `movies.stars` and the `emotions` table). The
 * server's vote now holds a score AND A SET of feelings, so somebody who tapped
 * three faces on one episode arrives as three — the earlier version of this
 * function kept the LOWEST index and dropped the rest, mirroring what the live
 * vote path did, and both were the same bug: two feelings were selected on this
 * phone and only one was ever counted anywhere else.
 *
 * ASCENDING, DEDUPLICATED, because the server replaces a set by diffing it: a
 * canonical order makes re-seeding an unchanged archive provably a no-op, and a
 * duplicate row in `episode_emotions` must not become a second selection.
 *
 * Either half may be absent: a rating with no feelings, feelings with no rating.
 * Both absent is a non-vote and `localRatingToSeed` drops it.
 */
export function mergeRatingAndEmotion(
  rating: { stars: number | null } | null | undefined,
  emotions: readonly { emotion: number }[] | null | undefined,
): { stars: number | null; emotions: number[] } {
  const stars = rating && typeof rating.stars === 'number' ? rating.stars : null;
  const picked = new Set<number>();
  for (const e of emotions ?? []) {
    const i = e?.emotion;
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0) continue;
    picked.add(i);
  }
  return { stars, emotions: [...picked].sort((a, b) => a - b) };
}

/** `CHARACTER_NAME_MAX` in `backend/src/pure.ts`, counted in code points. */
export const CHARACTER_NAME_MAX = 100;

/**
 * A character name the server will accept, trimmed — or null.
 *
 * Mirrored **rule for rule** from `validateCharacterName` in
 * `backend/src/pure.ts`, and the reason it is mirrored is worth stating: the
 * rollup increments a JSON path built as `'$."' || ? || '"'`, so a `"` or a `\`
 * in the name could close that quote, and a control character survives the
 * nightly recount as different bytes and makes a clean row look permanently
 * drifted. The server refuses those names.
 *
 * The app therefore does not send them. Not sending is strictly better than
 * being told 400: a rejected item still costs one of the 500 slots in a chunk
 * and lands in `skipped`, where the user reads it as "something of mine did not
 * make it" without any way to tell it apart from the per-show collapse below.
 *
 * A NULL NAME IS THE COMMON CASE, not an error. TV Time's export kept only an
 * internal character id whose lookup died with their servers, so every imported
 * vote has `name = NULL` and a count but no name (see `getCharacterVote` in
 * db.ts). Those are unmappable: there is no name to attribute the vote to.
 */
export function safeCharacterName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const name = input.trim();
  if (name.length === 0) return null;
  if ([...name].length > CHARACTER_NAME_MAX) return null;
  for (const ch of name) {
    const code = ch.codePointAt(0)!;
    if (ch === '"' || ch === '\\' || code < 0x20 || code === 0x7f) return null;
  }
  return name;
}

/**
 * The face to put in the poll: the CHARACTER, and the performer only as a
 * fallback.
 *
 * THE BUG THIS IS. TheTVDB returns two images per character — `image`, the
 * character as they appear in the work, and `personImgURL`, the performer's
 * headshot — and both cast builders took the headshot. So "who was your
 * favourite?" showed a voice actor's publicity photo instead of the animated
 * character the question is about, and a film from 1975 showed its cast as they
 * look today. The question is about the character; the picture must be too.
 *
 * WHY BOTH IMAGES SURVIVE ON `CastMeta` rather than one replacing the other:
 * the ABOUT tab's Cast row is legitimately about PERFORMERS — it prints the
 * actor's name over the role they played — and would be wrong with a character
 * portrait under an actor's name. One record, two pictures, two consumers.
 *
 * TMDB-sourced cast has no character image at all (its `profile_path` is a
 * headshot), so it falls back, which is exactly the old behaviour and the best
 * available. Empty strings count as absent: an artwork URL built from a missing
 * path is `''`, not null, and `''` would render as a broken tile.
 */
export function characterFace(c: { photo?: string | null; charPhoto?: string | null } | null | undefined): string | null {
  if (!c) return null;
  const character = typeof c.charPhoto === 'string' ? c.charPhoto.trim() : '';
  if (character.length > 0) return character;
  const actor = typeof c.photo === 'string' ? c.photo.trim() : '';
  return actor.length > 0 ? actor : null;
}

/** The fields the poll merge reads. Both sources' cast records satisfy it. */
export type PollCastEntry = {
  name?: string | null;
  character?: string | null;
  photo?: string | null;
  charPhoto?: string | null;
};

/** '' and whitespace are absent; an artwork URL built from a missing path is ''. */
function present(v: string | null | undefined): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 ? s : null;
}

/**
 * How one person is recognised across two catalogues that share no ids.
 *
 * The ROLE first, because the poll asks about the role and because it is the
 * field both sources agree on most often. The performer is the fallback for a
 * record whose character is blank — TheTVDB lists crew-ish entries with a
 * person and no role — and is prefixed so a performer named "Woody" can never
 * collide with a character named "Woody".
 *
 * Returns null when neither field is usable: such a record can only ever be
 * kept as itself, never merged, because there is nothing to match it on.
 */
function castKey(c: PollCastEntry): string | null {
  const role = present(c.character);
  if (role) return `c:${slug(role)}`;
  const person = present(c.name);
  return person ? `p:${slug(person)}` : null;
}

/**
 * The cast the "Who was your favourite?" poll draws — both catalogues, merged
 * per person rather than one chosen wholesale.
 *
 * WHY NOT EITHER/OR, WHICH IS WHAT THIS USED TO BE. Only TheTVDB has a picture
 * of the CHARACTER; TMDB's `profile_path` is the performer's present-day
 * headshot, which is the wrong answer to "who was your favourite?" and is
 * badly wrong for animation, where it shows the voice actor. So the old rule
 * was: TheTVDB's list if there is one, TMDB's only if there is not. That threw
 * away real information in both directions. TheTVDB's film records are thin —
 * a cast member with no headshot, or a lead missing from the list entirely,
 * both of which TMDB usually has — and discarding TMDB whenever a single
 * TheTVDB row existed left blank tiles next to a source that could have filled
 * them.
 *
 * So, per person: TheTVDB's character art if it has any, then TheTVDB's
 * headshot, then TMDB's, and anyone TheTVDB never listed is appended rather
 * than dropped. TheTVDB's order leads, because it sorts featured-first and
 * that is the order the leads should appear in.
 *
 * WHAT THIS CANNOT FIX, so it is not mistaken for a fix: merging never adds
 * character art, because TMDB has none to add. A film with no TheTVDB id at
 * all still shows headshots — the answer there is to find its id (see
 * `movie-tvdb-match.ts`), not to merge harder.
 */
export function mergeCastForPoll<T extends PollCastEntry>(
  tvdbCast: T[] | null | undefined,
  tmdbCast: T[] | null | undefined,
): T[] {
  const tvdb = Array.isArray(tvdbCast) ? tvdbCast : [];
  const tmdb = Array.isArray(tmdbCast) ? tmdbCast : [];
  // One source only still gets the poll's two cuts below — a TMDB-only film
  // has crew rows in it too.
  if (tvdb.length === 0) return narrowPollCast([...tmdb]);
  if (tmdb.length === 0) return narrowPollCast([...tvdb]);

  // First record wins a duplicate key, matching the "featured first" order both
  // sources are already sorted into.
  const byKey = new Map<string, T>();
  for (const c of tmdb) {
    const k = castKey(c);
    if (k && !byKey.has(k)) byKey.set(k, c);
  }

  const used = new Set<string>();
  const merged = tvdb.map((c) => {
    const k = castKey(c);
    const other = k ? byKey.get(k) : undefined;
    if (k) used.add(k);
    if (!other) return c;
    return {
      ...c,
      // TheTVDB's own values win wherever it has one; TMDB fills the holes.
      // `charPhoto` is listed for symmetry and to survive a future source that
      // does carry character art — today TMDB's is always null.
      name: present(c.name) ?? other.name ?? null,
      character: present(c.character) ?? other.character ?? null,
      photo: present(c.photo) ?? other.photo ?? null,
      charPhoto: present(c.charPhoto) ?? other.charPhoto ?? null,
    };
  });

  // Anyone TheTVDB never listed. Keyless records are kept too: unmergeable is
  // not a reason to be invisible.
  for (const c of tmdb) {
    const k = castKey(c);
    if (!k || !used.has(k)) merged.push(c);
  }
  return narrowPollCast(merged);
}

/**
 * How many pictured characters make a poll of pictured characters alone.
 *
 * Below this, filtering would leave a poll too thin to be a poll — a film with
 * one illustrated character would ask "who was your favourite?" and offer one
 * answer. Above it, the mixed list is the worse option and the cut is worth
 * making.
 */
export const MIN_PICTURED_CAST = 3;

/**
 * The name a poll tile shows, votes under, and is stored as.
 *
 * ONE DEFINITION, because this string is an identity and not a caption: it is
 * the local vote's key, the name posted to the server, and what the community
 * percentages are looked up by. Two slightly different derivations — one in the
 * tile, one in the ordering — would silently stop matching for exactly the
 * characters that have a suffix.
 *
 * TheTVDB names an animated cast "Woody (voice)", which is true of the
 * PERFORMER and not of the character the question asks about.
 */
export function pollLabel(c: PollCastEntry): string {
  return (c.character ?? c.name ?? '')
    .replace(/\s*\(voice\)$/i, '')
    .trim();
}

/**
 * Most-voted first, everyone else in the order the catalogues gave.
 *
 * A poll's job is to show what people picked, and a favourite buried eight
 * tiles into a horizontal scroll is not shown at all. Sorting by the community
 * count puts the answer where it is read.
 *
 * STABLE, which matters more than it looks: every character with no votes has
 * the same key, and an unstable sort would reshuffle those tiles on every
 * render as the aggregate refetches — a row that quietly rearranges itself
 * under a thumb. `sort` is stable in every JS engine the app runs on, and the
 * copy keeps the caller's memoised array intact.
 */
export function orderPollCast<T extends PollCastEntry>(cast: T[], percents: Record<string, number>): T[] {
  return [...cast].sort((a, b) => (percents[pollLabel(b)] ?? 0) - (percents[pollLabel(a)] ?? 0));
}

/**
 * The two cuts that turn a cast list into a poll about CHARACTERS.
 *
 * CREW. TheTVDB's `characters` array is not only characters: directors,
 * writers and producers sit in it with `name: null` and a headshot, sorted
 * first. Toy Story 5 opened its "who was your favourite?" poll with two
 * portraits of Andrew Stanton. They go — but only when something with a role
 * remains, because a list of nothing is worse than a list of performers.
 *
 * UNPICTURED. TheTVDB has character art for 3 of Shawshank's 36 cast and 11 of
 * Toy Story 5's 24; the rest fall back to the performer, which for animation is
 * the voice actor and for an older film is that actor as they look now — the
 * two complaints this whole path exists to answer. When a film has enough
 * pictured characters to make a poll from, that poll is strictly better than a
 * longer one padded with wrong pictures. When it does not (or has none at all,
 * like a film with no TheTVDB id), everyone stays: a headshot is a poor answer
 * and an empty screen is no answer.
 *
 * Both cuts are conditional, and that is the point — neither can empty a poll
 * that had entries.
 */
function narrowPollCast<T extends PollCastEntry>(cast: T[]): T[] {
  const withRole = cast.filter((c) => present(c.character));
  const kept = withRole.length > 0 ? withRole : cast;
  const pictured = kept.filter((c) => present(c.charPhoto));
  return pictured.length >= MIN_PICTURED_CAST ? pictured : kept;
}

/**
 * What the local favourite becomes when a face is tapped: tapping the current
 * favourite clears it, tapping anyone else replaces it. A poll with no way back
 * out is a trap — the same rule the emotion tiles already follow.
 *
 * Pure, and separate from the write, so the rule is testable without a
 * database; `setCharacterVote` in db.ts applies exactly this.
 */
export function nextCharacterVote(current: string | null | undefined, tapped: string): string | null {
  return current === tapped ? null : tapped;
}

/** One row of the local `character_votes` table. */
export type LocalCharacterRow = {
  showId: number;
  season: number;
  episode: number;
  name: string | null;
  charId: number | null;
};

export type CharacterTargetResolver = (row: LocalCharacterRow) => SeedTarget | null;

/**
 * Which character ids still need a name fetched from TheTVDB.
 *
 * TV Time's export gives a favourite as `show_character_id` and NOTHING else —
 * no name anywhere in the file. That was read as unrecoverable and those votes
 * were skipped by the seeder for want of a name. It is not unrecoverable: TV
 * Time was built on TheTVDB, and the id is a TheTVDB character id, so
 * `/characters/{id}` returns the name directly.
 *
 * A row is worth asking about when all three hold:
 *  - it has no usable name yet (null, or whitespace — a blank name is no name);
 *  - it HAS an id to ask with (a vote the user made in-app already carries the
 *    name and carries no id, so there is nothing to look up);
 *  - it has not already been asked and answered "no" (`nameTried`). Ids TheTVDB
 *    has since deleted never resolve; without this every launch would re-ask
 *    them for ever.
 *
 * Ids are returned once each, in first-seen order — the same character can be
 * the favourite of several episodes, and that is one request, not several.
 */
export function characterIdsNeedingNames(
  rows: readonly { name: string | null; charId: number | null; nameTried?: number | null }[],
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    if ((r.name ?? '').trim() !== '') continue;
    if (r.nameTried) continue;
    const id = r.charId;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** A library film, as far as the TheTVDB-id backfill is concerned. */
export type MovieMatchRow = {
  name: string;
  year: string | null;
  tvdbId: number | null;
  /** TMDB's id, when the film has one — the shortcut past name matching. */
  tmdbId?: number | null;
  tvdbTried?: number | null;
  watchedAt?: string | null;
};

/**
 * Which films still need a TheTVDB id looked up, and what year to look them
 * up with.
 *
 * `movies.tvdbId` is null for every imported film, and always was: the
 * importer reads `movie_tvdb_id`, a column that appears in NO file of TV
 * Time's GDPR export. Nothing else ever filled it, so the film screen had no
 * id to fetch a TheTVDB record with — which is why the favourite-character
 * poll fell back to TMDB's cast and showed the performer's headshot instead
 * of the character.
 *
 * A row is worth asking about when both hold:
 *  - it has no `tvdbId` yet (one from a search tap, a community-export import
 *    or the release-date pass is already the real thing — never re-ask);
 *  - it has not already been asked and answered (`tvdbTried`). Some films
 *    genuinely are not on TheTVDB, and some titles are permanently ambiguous;
 *    without this every launch would re-ask all of them for ever.
 *
 * The year is what makes a generic title resolvable at all (see
 * `pickMovieMatch`): the stored release year when there is one, otherwise the
 * year the user watched it — a film cannot predate its own release.
 */
export function moviesNeedingTvdbMatch(
  rows: readonly MovieMatchRow[],
): { name: string; year: number | null; tmdbId: number | null }[] {
  const out: { name: string; year: number | null; tmdbId: number | null }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.tvdbId) continue;
    if (r.tvdbTried) continue;
    const name = (r.name ?? '').trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      year: yearHead(movieYearOf(name, r.year)) ?? yearHead(r.watchedAt),
      // Carried so the lookup can try the id route first; null for a bare GDPR
      // import, which is what name matching is still there for.
      tmdbId: typeof r.tmdbId === 'number' && r.tmdbId > 0 ? r.tmdbId : null,
    });
  }
  return out;
}

/** The four-digit year at the head of a year or date string, if it is one. */
function yearHead(s: string | null | undefined): number | null {
  const y = Number((s ?? '').slice(0, 4));
  return Number.isFinite(y) && y > 1800 ? y : null;
}

/**
 * How many favourite-character votes could actually be SENT.
 *
 * The mirror of the `characterVotes` figure in `archiveCounts` — and the reason
 * that figure is not a plain `COUNT(*)`. The seeder drops a nameless vote
 * rather than spend one of a chunk's 500 slots earning a rejection, so a
 * nameless row is not archive content at all. Counting it made the fingerprint
 * describe rows the server would never receive: backfilling the names changes
 * no COUNT, so the fingerprint would not move, so no incremental seed would
 * run, so the recovered names would sit on the device for ever. Counting only
 * the sendable ones makes recovery itself the thing that trips the sync.
 */
export function sendableCharacterVoteCount(rows: readonly { name: string | null }[]): number {
  return rows.filter((r) => (r.name ?? '').trim() !== '').length;
}

/** One item of `POST /v1/character-votes/import`. */
export type CharacterSeedItem = {
  target_source: 'tvdb' | 'tmdb' | 'title';
  target_key: string;
  character: string;
  character_id: number | null;
  season: number | null;
  episode: number | null;
};

/**
 * One local favourite as the server wants it, or null when it cannot be sent.
 *
 * The season and episode ride along as PROVENANCE only. The community question
 * is "who was your favourite in this show", asked once; the app has asked it per
 * episode since 1.0. That mismatch is handled honestly on both sides — the
 * server keeps the first and reports the rest as `skipped`, and `seedSummary`
 * says so in words rather than letting a big `skipped` number read as failure.
 */
export function localCharacterToSeed(
  row: LocalCharacterRow,
  resolveTarget: CharacterTargetResolver,
): CharacterSeedItem | null {
  const character = safeCharacterName(row.name);
  if (character === null) return null;

  const season = seedOrdinal(row.season);
  const episode = seedOrdinal(row.episode);
  if (episode !== null && season === null) return null;

  const target = resolveTarget(row);
  if (!target) return null;

  return {
    target_source: target.source,
    target_key: target.key,
    character,
    character_id: typeof row.charId === 'number' && Number.isInteger(row.charId) ? row.charId : null,
    season,
    episode,
  };
}

/**
 * Fixed-size slices, in order. `size` below 1 is treated as 1 rather than
 * looping forever — a caller that computes a chunk size and gets it wrong should
 * send small batches, not hang.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

export type SeedTotals = {
  /** Rows the server actually wrote. */
  imported: number;
  /** The server's `skipped` — already there, or rejected by its own validation. */
  skipped: number;
  /** Never sent at all: no target, no body, no readable date. */
  unmappable: number;
};

export type SeedSummary = { key: SeedSummaryKey; params: Record<string, number> };

/**
 * What KIND of thing a summary is describing. The three read differently enough
 * that one sentence cannot serve all of them — see `seedSummary`.
 */
export type SeedKind = 'comments' | 'ratings' | 'characters';

export type SeedSummaryKey =
  | 'community.seed.resultNone'
  | 'community.seed.resultAll'
  | 'community.seed.resultAlready'
  | 'community.seed.resultMixed'
  | 'community.seed.ratingsNone'
  | 'community.seed.ratingsAll'
  | 'community.seed.ratingsAlready'
  | 'community.seed.ratingsMixed'
  | 'community.seed.charactersNone'
  | 'community.seed.charactersAll'
  | 'community.seed.charactersAlready'
  | 'community.seed.charactersMixed';

/** The four endings, per kind. Comments keep their original key names. */
const SUMMARY_KEYS: Record<SeedKind, Record<'none' | 'all' | 'already' | 'mixed', SeedSummaryKey>> = {
  comments: {
    none: 'community.seed.resultNone',
    all: 'community.seed.resultAll',
    already: 'community.seed.resultAlready',
    mixed: 'community.seed.resultMixed',
  },
  ratings: {
    none: 'community.seed.ratingsNone',
    all: 'community.seed.ratingsAll',
    already: 'community.seed.ratingsAlready',
    mixed: 'community.seed.ratingsMixed',
  },
  characters: {
    none: 'community.seed.charactersNone',
    all: 'community.seed.charactersAll',
    already: 'community.seed.charactersAlready',
    mixed: 'community.seed.charactersMixed',
  },
};

/**
 * The sentence at the end, and it tells the truth even when the truth is
 * partial: "44 brought over, 3 already there, 2 couldn't be matched".
 *
 * A bare "Done!" would be a lie in every run where something did not make it,
 * and the person it lies to is the one who most cares — someone who has just
 * handed over seven years of their own writing. So there are four endings, not
 * one, and only the first is a clean success:
 *
 *   resultAll     — everything went, nothing was skipped or dropped.
 *   resultAlready — nothing new; it had all been brought before. A second run
 *                   is the ordinary case, because the server dedupes by content.
 *   resultMixed   — any run where the three numbers disagree. Three numbers in
 *                   one sentence, no plural agreement on any of them (no
 *                   language can agree on three at once), which is why it is a
 *                   flat string in the locale files rather than a plural set.
 *   resultNone    — there was nothing to bring at all.
 *
 * THE SAME FOUR ENDINGS FOR RATINGS AND FAVOURITES, with their own wording,
 * because the numbers mean different things:
 *
 *   RATINGS collapse nothing. A skipped rating really was already on the server.
 *
 *   FAVOURITES collapse a lot, and this is the sentence that has to be got
 *   right. The app has asked "who was your favourite?" per EPISODE since 1.0;
 *   the community asks it once per SHOW. A show with forty per-episode
 *   favourites therefore imports as one accepted and thirty-nine skipped, and
 *   that is the endpoint working exactly as designed — not a failure, not a
 *   dropped vote, not something the user should try again. So the character
 *   wording never says "couldn't be brought": it says the extra picks were
 *   folded into one favourite per show, which is what actually happened.
 */
export function seedSummary(totals: SeedTotals, kind: SeedKind = 'comments'): SeedSummary {
  const imported = Math.max(0, Math.floor(totals.imported));
  const skipped = Math.max(0, Math.floor(totals.skipped));
  const unmappable = Math.max(0, Math.floor(totals.unmappable));
  const keys = SUMMARY_KEYS[kind] ?? SUMMARY_KEYS.comments;

  if (imported + skipped + unmappable === 0) return { key: keys.none, params: {} };
  if (skipped === 0 && unmappable === 0) return { key: keys.all, params: { count: imported } };
  if (imported === 0 && unmappable === 0) return { key: keys.already, params: { count: skipped } };
  return { key: keys.mixed, params: { imported, skipped, unmappable } };
}

/**
 * LEAVING, AND WHAT LEAVING IS ALLOWED TO TOUCH
 * ---------------------------------------------
 * Deleting the community account removes a presence on a server. It must not
 * remove a single row of the library, and the only way that promise survives a
 * future refactor is if the list of keys the deletion clears lives here, in a
 * pure function, with a test standing over it.
 *
 * `meta` is one flat key-value table. The community flags and the imported
 * library's own bookkeeping — `tvtimeUserId`, `tvtimeFriends`, the import
 * state, the backup signatures — sit side by side in it. A loop written in a
 * hurry ("clear everything we wrote") would take both, and the user would tap
 * "delete my community account" and lose their TV Time friend list, which came
 * out of their own export and was never on any server.
 *
 * So: an explicit allow-list, every entry of which is a community key, checked
 * by `account.test.ts` against the deny-list below.
 */
export const COMMUNITY_META_KEYS = [
  // the session — also cleared by signOutLocally(), listed for completeness
  'communityJoined',
  'communityProfileId',
  'communityHandle',
  // the one-time offer, reset so a later re-join can be proposed again
  'communityAsked',
  'communityDeclined',
  'communityBannerDismissed',
  // the archive upload's bookmark, and whether it finished — one pair per kind,
  // because the three walk three different tables and resume independently
  'communitySeedProgress',
  'communitySeedDone',
  'communitySeedRatingsProgress',
  'communitySeedRatingsDone',
  'communitySeedCharactersProgress',
  'communitySeedCharactersDone',
  // and for the rescued comment photographs, which upload one at a time and so
  // resume more often than any other phase
  'communitySeedImagesProgress',
  'communitySeedImagesDone',
  // what the last COMPLETE upload sent, and under which contract revision —
  // the pair `syncArchiveIfNeeded` compares on every open. Cleared on deletion
  // so a re-join uploads its archive to the new account instead of believing a
  // previous account's run covered it.
  'communitySeedRevision',
  'communitySeedFingerprint',
  // friend reconciliation: what was last sent, and what came back
  'communityFriendsFingerprint',
  'communityFriendMatches',
  // the cached inbox badge
  'communityUnread',
  // the background aggregate sweep: when it last ran, where it got to, when it
  // last completed and against which set of ratings. All four are derived from
  // local rows and cost nothing to lose — they are cleared with the rest so a
  // re-join starts its sweep clean rather than resuming somebody else's.
  'communityPrefetchAt',
  'communityPrefetchCursor',
  'communityPrefetchSweptAt',
  'communityPrefetchFingerprint',
] as const;

/**
 * The seed bookmarks alone — what "re-upload my archive" clears and nothing
 * else.
 *
 * A SUBSET OF `COMMUNITY_META_KEYS`, and `account.test.ts`'s sibling guard
 * stands over that: re-uploading must not sign the user out, must not re-arm
 * the one-time join offer, must not drop the friend matches, and above all must
 * not touch a single local key. It clears six bookmarks so `seedEverything()`
 * walks the archive from the top again — which is safe by construction, because
 * the server derives a comment's id from its content and keys a vote on
 * (person, target), so every re-sent row is a no-op it reports as `skipped`.
 *
 * WHY IT IS NEEDED AT ALL. A phase marked done under an older build is never
 * revisited. Someone who seeded in the comment-only era has a `communitySeedDone`
 * flag and no ratings on the server; someone who seeded before the multi-emotion
 * contract has ratings carrying exactly ONE feeling each, because the old mapper
 * kept the lowest-indexed one. Both are invisible from inside the app, and both
 * are fixed by walking the archive again.
 */
export const COMMUNITY_SEED_META_KEYS = [
  'communitySeedProgress',
  'communitySeedDone',
  'communitySeedRatingsProgress',
  'communitySeedRatingsDone',
  'communitySeedCharactersProgress',
  'communitySeedCharactersDone',
  'communitySeedImagesProgress',
  'communitySeedImagesDone',
] as const;

/** A fresh array, for the same reason `metaKeysClearedOnAccountDeletion` returns one. */
export function metaKeysClearedByArchiveReupload(): readonly string[] {
  return [...COMMUNITY_SEED_META_KEYS];
}

/**
 * The session keys. `signOutLocally()` writes these three itself; they are
 * named here only so the partition test below can account for every key.
 */
export const COMMUNITY_SESSION_META_KEYS = [
  'communityJoined',
  'communityProfileId',
  'communityHandle',
] as const;

/**
 * The one-time join offer. Deliberately NOT cleared by a sign-out: the user
 * answered that question once, and re-asking someone who chose to leave is the
 * behaviour the prompt module exists to prevent. A deletion re-arms it, because
 * "I deleted my account" is the one event that makes the offer new again.
 */
export const COMMUNITY_OFFER_META_KEYS = [
  'communityAsked',
  'communityDeclined',
  'communityBannerDismissed',
] as const;

/**
 * What a SIGN-OUT clears: every key that records what THIS DEVICE has already
 * sent to, or already learned from, ONE PARTICULAR ACCOUNT.
 *
 * WHY SIGNING OUT MUST CLEAR THEM. None of these keys names the account it
 * belongs to. `communitySeedDone` means "the archive was uploaded" with no
 * "…to whom"; `communityFriendMatches` holds people found under one identity;
 * the prefetch cursor bookmarks a sweep made with one token. Leave them in
 * place across a sign-out and the next sign-in — which may be a different
 * Apple ID, and after a deletion is ALWAYS a new profile — inherits the last
 * account's bookkeeping and concludes there is nothing to upload. The archive
 * then never reaches the new account, silently, with no surface anywhere in
 * the app that would show it.
 *
 * Everything here is derived from local rows and costs nothing to rebuild: the
 * seed re-walks tables the phone already holds, the sweep re-runs, the friend
 * list re-reconciles. Re-sending is safe by construction — the server derives
 * a comment's id from its content and keys a vote on (person, target), so a
 * repeat is a no-op it reports as `skipped`.
 *
 * A SUBSET OF `COMMUNITY_META_KEYS`, guarded by `account.test.ts`, which also
 * checks the three sets partition it exactly — so a key added to the deletion
 * list in future has to be classified rather than quietly forgotten here.
 */
export const COMMUNITY_SIGN_OUT_META_KEYS = [
  ...COMMUNITY_SEED_META_KEYS,
  'communitySeedRevision',
  'communitySeedFingerprint',
  'communityFriendsFingerprint',
  'communityFriendMatches',
  'communityUnread',
  'communityPrefetchAt',
  'communityPrefetchCursor',
  'communityPrefetchSweptAt',
  'communityPrefetchFingerprint',
] as const;

/** A fresh array, for the same reason `metaKeysClearedOnAccountDeletion` returns one. */
export function metaKeysClearedOnSignOut(): readonly string[] {
  return [...COMMUNITY_SIGN_OUT_META_KEYS];
}

/**
 * Keys that hold LOCAL data — the library, the import, the backups. Nothing in
 * the community layer may ever clear one of these. This constant exists to be
 * the other half of a test, not to be read at runtime.
 *
 * `tvtimeUserId` and `tvtimeFriends` are the trap: they are named after TV
 * Time and they are read by the community code (friend reconciliation sends
 * them), so they look like community state. They are not. They came out of the
 * user's own GDPR export, they are what `exporter.ts` writes back out, and
 * they must survive an account deletion exactly as the watch history does.
 */
export const LOCAL_ONLY_META_KEYS = [
  'tvtimeUserId',
  'tvtimeFriends',
  'tvtimeFollowers',
  'tvtimeFollowingNames',
  'tvtimeNotifications',
  'libraryOwner',
  'importPending',
  'importResumeTries',
  'resumedImportSummary',
  'repairRev',
  'customLists',
  'deletedShows',
  'deletedMovies',
  'deletedComments',
  'deletedImportedLists',
  'unmarkedEpisodes',
  'moviesVersion',
  'votesVersion',
  'username',
  'bio',
  'avatarFile',
  'avatarUrl',
  'coverFile',
  'coverUrl',
  'birthYear',
  'gender',
  'country',
  'countryCode',
  'icloudBackupAt',
  'icloudBackupHash',
  'icloudBackupSig',
  'lastExportSig',
  'manualExportAt',
  'onboarded',
  'userTvdbKey',
  'popcornBest',
] as const;

/**
 * Exactly the `meta` keys a community account deletion clears — nothing else
 * in the app is touched, and no table is touched at all.
 *
 * A function rather than the bare constant so the caller cannot mutate the
 * list it is about to loop over, and so the guard test has something with a
 * signature to hold onto.
 */
export function metaKeysClearedOnAccountDeletion(): readonly string[] {
  return [...COMMUNITY_META_KEYS];
}

// ── the archive's own shape, and when to send it again ───────────────────────
//
// A DONE FLAG CAN NEVER SURVIVE A CONTRACT CHANGE. `runKeyedSeed` bookmarks a
// cursor and stamps a "finished" flag, and neither is ever revisited. That is
// the right answer to "was this row sent" and the wrong answer to "was this row
// sent in the shape the server now stores", which is a different question and
// the one that actually broke: everything seeded before the multi-emotion
// change went up carrying ONE feeling per title, and no flag anywhere records
// that. Two facts are needed, and they are independent:
//
//  - a REVISION of the upload contract, bumped by hand when what we send
//    changes shape, and
//  - a FINGERPRINT of what the archive locally holds, so a rating tapped after
//    the seeding run still reaches the server.
//
// Both live here, pure, so the launch path is a comparison of two short strings
// and the whole decision is testable without a database or a network.

/**
 * How much of each seedable thing the library currently holds.
 *
 * COUNTS, NOT CONTENT. This is composed on every launch, so it has to be nearly
 * free: six `COUNT(*)`s over indexed tables. Hashing row contents would catch a
 * rating changed from four stars to five without changing the count — and would
 * also read every rated row on every launch, which is exactly the cost this is
 * supposed to avoid. The miss is acceptable and self-correcting: the same star
 * is re-sent by the live vote path the moment it is tapped, and any revision
 * bump re-walks everything anyway.
 */
export type ArchiveCounts = {
  comments: number;
  episodeRatings: number;
  episodeEmotions: number;
  movieRatings: number;
  movieEmotions: number;
  characterVotes: number;
  movieCharacterVotes: number;
};

/**
 * The counts as one short, stable string.
 *
 * Order is fixed and positional, so a zero still occupies its slot and two
 * different archives cannot collide by shifting. Non-numbers and negatives fold
 * to 0 rather than producing `NaN`, because this string is compared for equality
 * and `'NaN' === 'NaN'` would silently mean "nothing changed" for ever.
 */
export function archiveFingerprint(counts: ArchiveCounts): string {
  const n = (v: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  return [
    n(counts.comments),
    n(counts.episodeRatings),
    n(counts.episodeEmotions),
    n(counts.movieRatings),
    n(counts.movieEmotions),
    n(counts.characterVotes),
    n(counts.movieCharacterVotes),
  ].join('.');
}

/**
 * What a launch should do about the archive.
 *
 *  - `nothing` — same contract, same archive. Returns before a token is even
 *    read, so an unchanged launch costs ZERO requests. This is the common case
 *    and it has to be genuinely free: `backend/docs/PLAN.md` §4 sizes the free
 *    tier at a handful of requests per user per day.
 *  - `full` — the contract moved (or nothing was ever stamped). Every cursor and
 *    DONE flag is cleared first, so the whole archive is re-sent in the new
 *    shape. Safe by construction: the server derives a comment's id from its
 *    content and keys a vote on (person, target), so a re-sent row is written
 *    once and reported as `skipped` for ever after.
 *  - `incremental` — same contract, more rows locally than last time. The
 *    cursors STAY, so only what sits past each bookmark is sent. A user who
 *    rated three episodes last night uploads three rows, not seven years.
 */
export type ArchiveSyncAction = 'nothing' | 'full' | 'incremental';

export function decideArchiveSync(
  stored: { revision: string | null; fingerprint: string | null },
  current: { revision: number; fingerprint: string },
): ArchiveSyncAction {
  // Nothing stored, a blank left by `resetSeedProgress`, or a number this build
  // does not recognise: treat as never synced. `full` is always the safe answer
  // — it costs requests the server dedupes, where a wrong `nothing` costs the
  // user their archive silently and for ever.
  const rev = Number(stored.revision ?? '');
  if (!stored.revision || !Number.isInteger(rev) || rev !== current.revision) return 'full';
  if (!stored.fingerprint) return 'full';
  return stored.fingerprint === current.fingerprint ? 'nothing' : 'incremental';
}

// ── one follow list, from two places ─────────────────────────────────────────

/** A person as the export knew them: an id, and whatever the notifications named. */
export type ArchiveFriend = {
  id: string;
  name: string | null;
  /** Local filename of the avatar rescued at import, when there is one. */
  image?: string | null;
  /** The original CDN link, dead now, kept so an export round-trips. */
  imageUrl?: string | null;
};

/** A person as the server knows them. */
export type CommunityPerson = {
  handle: string;
  display_name?: string | null;
  avatar_key?: string | null;
};

/** One row of the merged list. */
export type FollowRow = {
  /** Stable across a re-render: the handle when there is one, else the TV Time id. */
  key: string;
  name: string;
  /** Set only for somebody who is on OpenTV — the row taps through to them. */
  handle: string | null;
  avatarKey: string | null;
  /** The archive's own avatar, for a person who is not here. */
  image: string | null;
  imageUrl: string | null;
  /**
   * False means: this is somebody you followed on TV Time who has not joined.
   * The row offers an invite instead of a profile.
   */
  onOpenTV: boolean;
};

/**
 * The follow list the app shows: everybody, once.
 *
 * WHY THEY MERGE AT ALL. A user's TV Time friends and their OpenTV follows are
 * not two audiences; they are one list of people, some of whom have arrived.
 * Shown as separate screens — which is what the app did — the numbers under a
 * profile read "0 following" to somebody with ten friends, and the people they
 * came here to find look like they do not exist.
 *
 * DEDUPE IS BY TV TIME ID, NOT BY NAME. `matches` maps an archive id to the
 * handle it answered to during reconciliation, so a friend who has joined is
 * one row and not two. Matching on names would fold two different people
 * called "sarah" into one and split anybody who renamed themselves — and this
 * export has both a "Sarah" and a "sarah".
 *
 * ARCHIVE ORDER IS KEPT, and community-only people follow. The archive is the
 * list the user recognises; a name they have known for years should not be
 * pushed below a handle they just met.
 */
export function mergeFollowList(
  archive: readonly ArchiveFriend[],
  community: readonly CommunityPerson[],
  matches: readonly { handle: string; tvtime_user_id?: number | null }[],
  fallbackName: string,
): FollowRow[] {
  const handleFor = new Map<string, string>();
  for (const m of matches) {
    if (m.tvtime_user_id != null) handleFor.set(String(m.tvtime_user_id), m.handle);
  }
  const byHandle = new Map(community.map((p) => [p.handle, p]));

  const claimed = new Set<string>();
  const rows: FollowRow[] = archive.map((f) => {
    const handle = handleFor.get(f.id) ?? null;
    const person = handle ? byHandle.get(handle) : undefined;
    if (handle) claimed.add(handle);
    return {
      key: handle ?? f.id,
      // The community display name wins where there is one — it is what that
      // person calls themselves NOW — then the archive's, then the fallback.
      name: person?.display_name || f.name || (handle ? `@${handle}` : fallbackName),
      handle,
      avatarKey: person?.avatar_key ?? null,
      image: f.image ?? null,
      imageUrl: f.imageUrl ?? null,
      onOpenTV: handle !== null,
    };
  });

  for (const p of community) {
    if (claimed.has(p.handle)) continue;
    rows.push({
      key: p.handle,
      name: p.display_name || `@${p.handle}`,
      handle: p.handle,
      avatarKey: p.avatar_key ?? null,
      image: null,
      imageUrl: null,
      onOpenTV: true,
    });
  }
  return rows;
}
