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
