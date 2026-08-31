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

export type ListLike = { name: string; userCreated?: boolean; order?: number };

/** Merge freshly-imported lists with the user's edits: drop imported lists the
 *  user renamed/deleted (tombstones) or that collide with a user list, keep the
 *  user's own lists first. Pure core of db.mergeImportedCustomLists. */
export function mergeCustomLists<T extends ListLike>(imported: T[], userLists: T[], tombstones: string[]): T[] {
  const userNames = new Set(userLists.map((l) => l.name.toLowerCase()));
  const tomb = new Set(tombstones.map((n) => n.toLowerCase()));
  const keptImported = imported.filter(
    (l) => !tomb.has(l.name.toLowerCase()) && !userNames.has(l.name.toLowerCase()),
  );
  // AN ARRANGEMENT MUST SURVIVE A RE-IMPORT. This rebuilds the array from the
  // ZIP, so before `order` existed a user who rearranged their IMPORTED lists —
  // the common case, since the export carries no order of its own (TV Time's own
  // `ordering` column is 0 on every row) — had the arrangement thrown away on
  // the next REPAIR_REV bump. Anything the user has placed keeps its number and
  // sorts by it; lists that have never been placed keep the old behaviour of
  // user-first, then imported.
  const merged = [...userLists, ...keptImported];
  return merged.every((l) => l.order == null)
    ? merged
    : merged
        .map((l, i) => ({ l, i }))
        // An unplaced list sorts after every placed one rather than jumping to
        // the front on a 0 default.
        .sort((a, b) => (a.l.order ?? Number.MAX_SAFE_INTEGER) - (b.l.order ?? Number.MAX_SAFE_INTEGER) || a.i - b.i)
        .map(({ l }) => l);
}

/** Renumber an arrangement 0..n-1 so the stored order never drifts or leaves
 *  gaps — the numbers are re-stamped on every write, so a delete closes up
 *  behind itself and a create lands where the array put it. */
export function renumberLists<T extends ListLike>(lists: readonly T[]): T[] {
  return lists.map((l, i) => ({ ...l, order: i }));
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

/** What an unaired episode's countdown says, as a key and a count. */
export type AirIn = { key: 'airIn.days' | 'airIn.months' | 'airIn.years'; count: number };

/**
 * How long until an episode or film lands — as a key and a count, never a
 * formatted string.
 *
 * A KEY, NOT A SENTENCE, for the same reason `relativeTime` returns one: this
 * used to build `in ${days} days` in English and hand it straight to a <Text>,
 * so every Arabic, French, Italian, Spanish and Portuguese user read the one
 * English phrase on the screen. Six locales, and this function was deciding
 * grammar for all of them.
 *
 * UNDER 100 DAYS IS A BARE NUMBER. `airIn.days` is literally "{{count}}", so
 * the list shows a bold "34" rather than "in 34 days" — testers found the
 * sentence noisy next to an episode code, and a number in that slot reads as
 * days without being told. Past 100 days a bare "365" stops meaning anything,
 * so it switches to months and then years, where the words are worth their
 * space and each locale writes its own.
 *
 * Compared date-only, in local terms: something airing later today has already
 * "arrived" (null) rather than showing "0".
 */
export function airCountdown(air: string | null | undefined, now: number): AirIn | null {
  if (!air) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(air);
  if (!m) return null;
  const airDay = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const n = new Date(now);
  const today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  const days = Math.round((airDay - today) / 86400000);
  if (days <= 0) return null; // already aired
  if (days < 100) return { key: 'airIn.days', count: days };
  const months = Math.round(days / 30);
  if (months < 12) return { key: 'airIn.months', count: months };
  return { key: 'airIn.years', count: Math.round(days / 365) };
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

/**
 * How long one watch counted for, in SECONDS. Never zero.
 *
 * TV Time exports carry a per-episode runtime for only some rows — about 40%
 * arrive empty — so every clock in the app needs a fallback, and the order
 * matters more than it looks.
 *
 * THE 24-MINUTE FLOOR USED TO COME SECOND, AND MADE THE CLOCK MOVE ON ITS OWN.
 * Metadata is fetched lazily and half the bundled entries carry no runtime, so
 * a Game of Thrones episode counted as 24 minutes until the show was opened —
 * at which point real metadata arrived at ~57 and the total leapt. Watch time
 * went up because a screen was opened, which is not a statistic.
 *
 * The show's OWN watches are the better guess: the rows that carry a runtime
 * sit beside the ones that do not, they describe the same episodes, and they
 * do not change when a network request finishes. The constant is left as a
 * last resort for a show with no runtimes anywhere and no metadata yet.
 *
 * @param stored          the row's own runtime in seconds, or null
 * @param metaMinutes     the show's runtime from metadata, in MINUTES
 * @param ownAverageSecs  the mean of this show's watches that do carry one
 */
export function watchRuntimeSeconds(
  stored: number | null,
  metaMinutes: number | null | undefined,
  ownAverageSecs?: number,
): number {
  if (stored && stored > 0) return stored;
  if (metaMinutes && metaMinutes > 0) return metaMinutes * 60;
  if (ownAverageSecs && ownAverageSecs > 0) return ownAverageSecs;
  return 24 * 60;
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

/**
 * A grid broken in two by a rule, with the break at item `at`.
 *
 * WHY THE TOP SECTION IS PADDED TO A WHOLE ROW. Twenty favourites over three
 * columns cuts inside row seven, and a rule drawn to the nearest row edge would
 * put two posters on the wrong side of a line that claims to be exact. So the
 * published section is given `ceil(at / cols)` whole rows — leaving one or two
 * empty cells at its end — and the rule sits under all of them. The line is
 * then straight, full width, and true at every column count, which matters on a
 * tablet where rotating changes `cols`.
 */
export type GridSplit = { at: number; gapH: number };

/** First row of the section below the rule. */
function splitRow(split: GridSplit, geo: GridGeometry): number {
  'worklet';
  return Math.ceil(split.at / geo.cols);
}

/** Top-left offset of a slot within the grid. */
export function slotPosition(order: number, geo: GridGeometry, split?: GridSplit | null): { x: number; y: number } {
  'worklet';
  if (split && order >= split.at) {
    const local = order - split.at;
    return {
      x: (local % geo.cols) * geo.slotW,
      y: splitRow(split, geo) * geo.slotH + split.gapH + Math.floor(local / geo.cols) * geo.slotH,
    };
  }
  return { x: (order % geo.cols) * geo.slotW, y: Math.floor(order / geo.cols) * geo.slotH };
}

/** Where the rule itself is drawn — the centre of the gap. */
export function splitLineY(geo: GridGeometry, split: GridSplit): number {
  'worklet';
  return splitRow(split, geo) * geo.slotH + split.gapH / 2;
}

/** Total height of the grid, gap included. */
export function gridHeight(count: number, geo: GridGeometry, split?: GridSplit | null): number {
  'worklet';
  if (split && count > split.at) {
    const below = Math.ceil((count - split.at) / geo.cols);
    return splitRow(split, geo) * geo.slotH + split.gapH + below * geo.slotH;
  }
  return Math.ceil(count / geo.cols) * geo.slotH;
}

/**
 * The slot a dragged tile is currently over, clamped inside the list.
 *
 * The exact inverse of `slotPosition`, including the gap: drop a tile below the
 * rule and it lands in the first slot below the rule, not in whatever index the
 * ungapped arithmetic would have produced — which would be off by a whole row
 * for everything past the break.
 */
export function slotAt(x: number, y: number, count: number, geo: GridGeometry, split?: GridSplit | null): number {
  'worklet';
  const col = Math.max(0, Math.min(geo.cols - 1, Math.round(x / geo.slotW)));
  if (split && count > split.at) {
    const boundary = splitRow(split, geo) * geo.slotH + split.gapH / 2;
    if (y >= boundary) {
      const localRow = Math.max(0, Math.round((y - splitRow(split, geo) * geo.slotH - split.gapH) / geo.slotH));
      return Math.max(split.at, Math.min(count - 1, split.at + localRow * geo.cols + col));
    }
    const row = Math.max(0, Math.round(y / geo.slotH));
    return Math.max(0, Math.min(split.at - 1, row * geo.cols + col));
  }
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
  split?: GridSplit | null,
): { x: number; y: number } {
  'worklet';
  const lastCol = Math.min(geo.cols, count) - 1;
  // The gap counts towards how far down a tile may be dragged, or the last row
  // below the rule would be unreachable by exactly the height of the gap.
  const maxY = Math.max(0, gridHeight(count, geo, split) - geo.slotH);
  return {
    x: Math.max(0, Math.min(lastCol * geo.slotW, x)),
    y: Math.max(0, Math.min(maxY, y)),
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
export function movieIdentityMatches(
  a: MovieIdentityCandidate,
  b: MovieLibraryEntry,
  opts: { strict?: boolean } = {},
): boolean {
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

  // NEITHER SIDE HAS A YEAR, AND THE RIGHT ANSWER DEPENDS ON WHO IS ASKING.
  // This one line was answering two questions that want opposite defaults.
  //
  // ADDING — "is this the film I already hold?" Err toward YES. A false no
  // creates a duplicate row for something already in the library, and the user
  // sees the same film twice for ever.
  //
  // DISPLAYING — "is this exact search result the film I hold?" Err toward NO.
  // A false yes is what was reported: search "romance", six films share the
  // title, one is held, and every result carrying no year claimed to be it —
  // so tapping + on the first appeared to tick the last. A tick is a statement
  // about one row, and a maybe must not be drawn as a yes.
  //
  // `strict` therefore demands positive evidence: matching ids, or a matching
  // name AND year. Silence is not agreement.
  return !opts.strict;
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
  /**
   * A HANDLE MUST STILL RESEMBLE THE NAME IT CAME FROM.
   *
   * The rule above keeps `[a-z0-9_]` and turns everything else into an
   * underscore, which is right for spaces and punctuation and wrong for entire
   * writing systems: "محمود" reduces to nothing, and "محمود123" reduces to
   * "123" — a valid handle that is claimed silently on somebody's behalf and
   * means nothing to anyone.
   *
   * So a suggestion has to carry at least one latin letter. Names that survive
   * intact are unaffected; names that do not fall through to the handle screen,
   * where the person picks their own instead of being assigned a number.
   *
   * This is the SUGGESTION rule only. A handle somebody types for themselves is
   * still judged by `isHandleValid`, which allows digits — choosing "@123" is
   * their business; being given it is not.
   */
  if (!/[a-z]/.test(trimmed)) return null;
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
  | 'community.error.emailUnverified'
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
    // Its own string, and not folded into `signInRejected`: this one is not a
    // refusal, it is an unfinished step, and the app has a screen for it.
    case 'email_unverified':
      return 'community.error.emailUnverified';
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
 * One result list from both catalogues, best-first.
 *
 * INTERLEAVED, NOT APPENDED, and that is the whole point of the function.
 *
 * Concatenating ranks TheTVDB's thirtieth row above TMDB's sixth, which throws
 * away the only thing a search API tells you for free: how well each row
 * matched. The search screen then shows the first twenty, so a good hit from
 * the shorter list falls off the end of a list it should have been near the top
 * of — the "partner" report was exactly this, once the fallback started running
 * at all.
 *
 * Taking one from each in turn keeps both catalogues' own ordering intact while
 * letting neither bury the other, and TheTVDB goes first on each pair because
 * it is the primary source and carries the ids the library keys on.
 *
 * Duplicates are matched on kind, title and year rather than id, because the
 * two catalogues number the same film differently — an id comparison would
 * agree with itself and show everything twice.
 */
export function mergeSearchFallback<T extends SearchHit>(primary: readonly T[], supplement: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (let i = 0; i < Math.max(primary.length, supplement.length); i++) {
    for (const row of [primary[i], supplement[i]]) {
      if (!row) continue;
      const key = searchDedupeKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
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

/**
 * WHY A COMMENT IS BEHIND A CURTAIN — the author's warning, or the reader's own
 * position in the story.
 *
 * The second is the one that was missing, and it is the one that matters more
 * often. Almost nobody ticks "this is a spoiler"; everybody minds being told
 * how a season ends. On a stranger's profile the feed crosses every title they
 * have ever watched, which is precisely where a reader meets discussion of
 * something they are three episodes into.
 *
 * `'flagged'` OUTRANKS `'unseen'`. An author who marked their own comment gets
 * the stronger label whether or not the reader has caught up, and turning the
 * unseen filter off must never uncover a comment its writer asked to be hidden.
 *
 * The reader's own comments are never hidden from them: they wrote it, they
 * know what is in it, and a curtain over your own words reads as a bug.
 */
/** The `meta` key behind the switch. Absent means ON — see the switch's note. */
export const HIDE_UNSEEN_KEY = 'hideUnseenSpoilers';

export type CurtainReason = 'flagged' | 'unseen' | null;

export function curtainReason(
  comment: { id: string; is_spoiler: number | boolean },
  revealedIds: ReadonlySet<string>,
  opts: { seen: boolean; mine: boolean; hideUnseen: boolean },
): CurtainReason {
  if (revealedIds.has(comment.id)) return null;
  if (comment.is_spoiler === true || comment.is_spoiler === 1) return 'flagged';
  if (opts.mine || opts.seen || !opts.hideUnseen) return null;
  return 'unseen';
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
):
  | ReturnType<typeof communityErrorKey>
  | 'community.comments.errTooLong'
  | 'community.comments.errGone'
  | 'community.comments.translateFailed' {
  switch (code) {
    // TRANSIENT, unlike `unavailable`. The row offers "try again" rather than
    // disappearing, because the model being busy says nothing about whether
    // this comment can ever be translated.
    case 'translate_failed':
      return 'community.comments.translateFailed';
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

/**
 * The four states of the one button under a name.
 *
 * `follow`/`following` are the public pair this app has always had. `request`/
 * `requested` are their private-account counterparts: a private profile cannot
 * be followed by tapping, only ASKED, and the ask is a thing you can take back.
 *
 * The distinction that matters is `requested` vs `following`: a pending request
 * grants nothing — no bio, no counts, no shelves — so a screen that drew it as
 * "Following" would promise content it is about to not show.
 */
export type FollowPillState = 'follow' | 'following' | 'request' | 'requested';

/**
 * Which of the four to draw, from the two booleans the server sends plus the
 * profile's own privacy.
 *
 * ORDER IS THE RULE. `followed_by_me` wins over `follow_requested_by_me`
 * because an accepted request leaves both rows true for as long as it takes the
 * server to clear the pending one, and "Following" is the truthful half of that
 * overlap. Privacy is consulted LAST and only to choose the verb for a stranger
 * — a private account you already follow says Following, exactly like a public
 * one, because from here the two are the same relationship.
 */
export function followPillState(
  followedByMe: boolean,
  requestedByMe: boolean,
  isPrivate: boolean,
): FollowPillState {
  if (followedByMe) return 'following';
  if (requestedByMe) return 'requested';
  return isPrivate ? 'request' : 'follow';
}

/**
 * What the tap does — the optimistic half, applied before the request is sent.
 *
 * Both "on" states go back to the "off" state that matches the profile's
 * privacy, which is why this takes `isPrivate` rather than flipping a boolean:
 * cancelling a request on a private account must land on Request, not Follow,
 * or the button invites a tap that cannot succeed.
 */
export function nextPillState(state: FollowPillState, isPrivate: boolean): FollowPillState {
  switch (state) {
    case 'follow':
      return 'following';
    case 'request':
      return 'requested';
    default:
      return isPrivate ? 'request' : 'follow';
  }
}

/** True when the tap is a DELETE — both "on" states undo, both "off" states do. */
export function pillUndoes(state: FollowPillState): boolean {
  return state === 'following' || state === 'requested';
}

/**
 * The state the SERVER just described, which beats whatever was guessed.
 *
 * `POST /v1/follows/:id` answers `{following, requested}` and those two are the
 * only authority on which happened: a profile that went private since this
 * screen loaded answers `requested`, and one that went public answers
 * `following`, for the identical tap.
 */
export function pillFromFollowResult(
  res: { following?: boolean; requested?: boolean },
  isPrivate: boolean,
): FollowPillState {
  if (res.requested === true) return 'requested';
  if (res.following === true) return 'following';
  return isPrivate ? 'request' : 'follow';
}

/** The i18n key for each state. One place, so the pill and the chip agree. */
export function followPillKey(state: FollowPillState):
  | 'community.profile.follow'
  | 'community.profile.following'
  | 'community.profile.request'
  | 'community.profile.requested' {
  return `community.profile.${state}` as const;
}

/**
 * The sections of a profile whose owner may switch them off, exactly as the
 * server names them in `hidden_sections`.
 *
 * NOT A PLUS FEATURE, and the absence of a `requirePlus` anywhere near this is
 * deliberate: hiding your own things is privacy, and privacy behind a paywall
 * is a shop selling back what was yours.
 *
 * `activity` is in the list and behaves unlike the rest — the heatmap is never
 * published, so hiding it hides it from YOU, on your own profile. It is listed
 * anyway so one array is the whole answer to "what did I switch off", and the
 * copy beside its switch says which profile it acts on.
 */
export const PROFILE_SECTIONS = [
  'stats',
  'activity',
  'lists',
  'favourite_shows',
  'favourite_movies',
  'shows',
  'movies',
  'comments',
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/**
 * The `meta` keys the two privacy controls are mirrored into.
 *
 * THE SERVER IS THE AUTHORITY and these are a local echo, written after a
 * successful PATCH. They exist so the switches are drawn correctly on the first
 * frame, offline included — a privacy switch that renders "off" for half a
 * second while a request is in the air is a switch that has, briefly, lied.
 */
export const PRIVATE_PROFILE_KEY = 'communityIsPrivate';
export const HIDDEN_SECTIONS_KEY = 'communityHiddenSections';

/**
 * Any value — the wire's array, a parsed meta row, a mangled one — as the
 * sections this build can actually draw a switch for.
 *
 * ALWAYS FAILS OPEN. A value that cannot be read means "nothing hidden", never
 * "hide everything": the second would blank somebody's profile because a meta
 * row got corrupted, which looks exactly like the app losing their library.
 */
export function asHiddenSections(v: unknown): ProfileSection[] {
  return Array.isArray(v) ? PROFILE_SECTIONS.filter((s) => v.includes(s)) : [];
}

/** The stored JSON, as an array. Anything unparseable is "nothing hidden". */
export function parseHiddenSections(raw: string | null | undefined): ProfileSection[] {
  if (raw == null || raw === '') return [];
  try {
    return asHiddenSections(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * Is this section switched off?
 *
 * Takes the raw wire value — `null` from a server that has no opinion,
 * `undefined` from one that predates the field — and answers "shown" for both,
 * because a section nobody has hidden is a section that shows.
 */
export function sectionHidden(
  hidden: readonly string[] | null | undefined,
  section: ProfileSection,
): boolean {
  return Array.isArray(hidden) && hidden.includes(section);
}

/**
 * The array to PATCH after one switch moves.
 *
 * Rebuilt from `PROFILE_SECTIONS` rather than pushed/spliced, so the order is
 * stable and a key the phone does not recognise — one a later build added — is
 * dropped rather than carried forward as a hidden section nothing can turn back
 * on. The full array is always sent; the server takes it as the complete truth.
 */
export function withSectionHidden(
  hidden: readonly string[] | null | undefined,
  section: ProfileSection,
  hide: boolean,
): ProfileSection[] {
  return PROFILE_SECTIONS.filter((s) =>
    s === section ? hide : sectionHidden(hidden, s),
  );
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
  //
  // EPISODE ZERO IS KEPT, and this was got wrong once. TV Time writes some
  // comments against season N episode 0 — the reference export has one, and
  // both `episode_comment.csv` and the tracking records agree on it, against a
  // real `episode_id`. TheTVDB has no S4E0 for that series, so no episode page
  // lists it, and the tempting conclusion was that "0" means "no episode" and
  // the row is really a show comment.
  //
  // It is not. It is a comment about an episode, and rewriting it as a show
  // comment discards the one thing it says about itself. A catalogue that does
  // not carry that episode is a gap in the CATALOGUE; the archive is not wrong
  // because a numbering changed. The user reaches it from their own profile,
  // which lists every comment they have written and opens the thread each one
  // belongs to.
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
/**
 * A search box takes "Partner 2007"; a catalogue API takes a title.
 *
 * PEOPLE TYPE THE YEAR BECAUSE IT IS HOW THEY TELL FILMS APART, and both
 * TheTVDB and TMDB match it as part of the NAME — so "Partner 2007" looks for a
 * film called that, finds nothing like it, and returns whatever else shares a
 * word. The 2007 Indian film "Partner" is unreachable by the one query most
 * likely to be typed for it, while "Partner" alone finds it immediately.
 *
 * So the year is lifted out and handed back separately: the title goes to the
 * API, and the year sorts what comes back. NOT filters — somebody misremembering
 * a year by one should still see the film rather than an empty screen, and a
 * search that silently drops the right answer is worse than one that ranks it
 * second.
 *
 * Only a TRAILING year, and only 1900–2099: "1917" and "2012" are films, and a
 * leading four digits is far more likely to be the title than a hint.
 */
export function splitYearQuery(raw: string): { title: string; year: number | null } {
  const q = raw.trim();
  const m = /^(.*\S)[\s,(\[]+((?:19|20)\d{2})\)?\]?$/.exec(q);
  if (!m) return { title: q, year: null };
  // Trailing punctuation goes with the year it belonged to: "Partner, 2007"
  // means the film Partner, not a film called "Partner,".
  return { title: m[1]!.replace(/[\s,([-]+$/, '').trim(), year: Number(m[2]) };
}

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

/**
 * The inverse of `seedScore`: somebody else's ten-point score as local stars.
 *
 * Trakt and Simkl both rate out of ten, this app out of five, and half of every
 * score therefore has nowhere to go. It goes UP — 7 becomes 4, not 3 — for the
 * same reason a Letterboxd half star does: rounding down quietly makes somebody
 * think less of a film than they said, on a screen where they would never
 * notice it happened.
 */
export function starsFromTen(score: number | null | undefined): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  if (score < 1 || score > 10) return null;
  return Math.min(LOCAL_STARS_MAX, Math.round(score / 2) || 1);
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
  // WHICH ACCOUNT THIS PHONE BELONGS TO. Classified with account deletion and
  // NOT with sign-out, which is the whole point of it: leaving has to leave
  // this behind, or coming back means guessing which of three doors was used
  // and which address — and a wrong guess is a second account holding half the
  // person's comments. Deleting the account clears it, because the thing it
  // names is gone. See `rememberAccount`.
  'communityLastEmail',
  'communityLastProvider',
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
  // what the last published profile covered — see `publishIfChanged`
  'communityPublishFingerprint',
  // and WHICH lists and favourites it holds — the grandfather set. Cleared
  // with the account, or a new profile would inherit the previous one's
  // exemptions and publish past its cap on the first run.
  'communityPublishedKeys',
  // What the server was last told the avatar and the cover are. NOT the
  // pictures: `avatarFile` and `coverFile` are this person's own profile on
  // their own phone and outlive any account, exactly as the library does.
  // These two are only the memory of having sent them, so a re-join re-sends.
  'communityCoverSent',
  'communityAvatarSent',
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
 * WHICH ACCOUNT THIS PHONE BELONGS TO — the address and the provider.
 *
 * ITS OWN SET because its lifetime matches none of the others. The session keys
 * die with the token; the sign-out keys record what was sent to an account and
 * must not be trusted for a different one. These two are the opposite: they are
 * worth nothing to an attacker, prove nothing, and are the one thing worth
 * keeping when somebody leaves — otherwise coming back means remembering which
 * of three doors was used, and a wrong guess makes a SECOND account holding
 * half their comments.
 *
 * Cleared by account deletion, where the account they name no longer exists,
 * and by "Not you?" on the join screen. See `rememberAccount`.
 */
export const COMMUNITY_IDENTITY_META_KEYS = ['communityLastEmail', 'communityLastProvider'] as const;

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
  // what the last published profile covered — see `publishIfChanged`
  'communityPublishFingerprint',
  // and which lists and favourites that was — see the note above.
  'communityPublishedKeys',
  // and what it was last told the avatar and cover are — see the note on these
  // two in COMMUNITY_ACCOUNT_META_KEYS above.
  'communityCoverSent',
  'communityAvatarSent',
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

/**
 * How many people the merged follow list holds — the number the Profile tab
 * prints over it.
 *
 * Computed from the same three inputs `mergeFollowList` uses, so the count and
 * the length of the list it opens cannot drift apart. They did: the profile
 * said "0 following" and the screen behind it listed ten.
 *
 * `serverCount` is a COUNT and not a list — the profile endpoint returns a
 * number, and paging every follower just to size a label would be absurd — so
 * the overlap is subtracted rather than deduped: of the people the server
 * counts, `alsoHere` many are already in the archive rows. Clamped at zero,
 * because a stale match (someone who has since deleted their account) would
 * otherwise subtract more than the server ever counted.
 */
export function mergedFollowTotal(
  archive: readonly { id: string }[],
  matches: readonly { tvtime_user_id?: number | null }[],
  serverCount: number,
): number {
  if (archive.length === 0) return serverCount;
  const matched = new Set(
    matches.map((m) => (m.tvtime_user_id == null ? null : String(m.tvtime_user_id))).filter((v): v is string => v !== null),
  );
  const alsoHere = archive.filter((f) => matched.has(f.id)).length;
  return archive.length + Math.max(0, serverCount - alsoHere);
}

/**
 * The archive friends who have NOT turned up on OpenTV — the "not here yet"
 * half of the reconnect screen.
 *
 * The same id-not-name rule `mergeFollowList` documents: a match is claimed by
 * `tvtime_user_id`, so somebody who joined and renamed themselves is still
 * recognised, and two different people called "sarah" stay two people. A match
 * carrying no `tvtime_user_id` (stored by a build before the server returned
 * one) claims nobody, which shows a friend as still absent rather than quietly
 * crossing the wrong name off.
 */
export function unmatchedArchiveFriends<T extends { id: string }>(
  archive: readonly T[],
  matches: readonly { tvtime_user_id?: number | null }[],
): T[] {
  const matched = new Set(matches.map((m) => (m.tvtime_user_id == null ? '' : String(m.tvtime_user_id))));
  return archive.filter((f) => !matched.has(f.id));
}

/** How many matches the profile banner has already been dismissed for. */
export const RECONNECT_SEEN_KEY = 'reconnectMatchesSeen';

/**
 * Whether the profile should offer the reconnect banner, and it is a COUNT and
 * not a boolean because "seen" means "seen this many" — dismissing at two
 * matches must not silence the banner when a third friend arrives, and a fourth
 * after that, for ever. Returns 0 when there is nothing new to say.
 */
export function reconnectBannerCount(matches: number, seen: string | null | undefined): number {
  const n = Number(seen ?? '');
  return matches > (Number.isFinite(n) ? n : 0) ? matches : 0;
}

/**
 * A local comment row — what this phone still knows about a comment the server
 * has returned. Named for the picture because that is what it was added for,
 * and it now carries `type` as well: a row the export marked `reply` whose
 * parent belongs to somebody else is a reply to nothing here, and saying so is
 * the difference between a stray sentence and a comment that makes sense.
 */
export type LocalCommentPicture = {
  text: string;
  date: string;
  image: string | null;
  imageUrl?: string | null;
  ratio?: number | null;
  /** `comment` or `reply`, as TV Time's export had it. */
  type?: string | null;
};

/**
 * True when this is a reply whose original is nowhere in OpenTV.
 *
 * TV Time exported the user's OWN comments and nothing else, so a reply's
 * parent — somebody else's words — was never in the file and cannot be
 * imported by anybody. Rendered without a note, such a reply reads as a
 * non-sequitur: "Happy that you loved the movie" sitting alone at the top of a
 * thread, answering a question no one can see.
 *
 * The server does not carry the distinction (an imported reply arrives with
 * `parent_id` null, because there is no parent row to point at), so this is
 * decided from the local archive and only for comments this phone imported.
 */
export function isOrphanedReply(local: { type?: string | null } | undefined, serverParentId: string | null): boolean {
  return serverParentId === null && (local?.type ?? '').toLowerCase() === 'reply';
}

/** What a server comment carries back for the same post. */
export type PicturedComment = { body: string; created_at: string };

/**
 * The picture for a comment the SERVER returned, found on THIS phone.
 *
 * WHY A LOOKUP AND NOT A FIELD. The server stores comment images but
 * deliberately serves none of them: they sit at `scan_status = 'pending'` until
 * image scanning is live, and until then no route reads one back. So a comment
 * fetched from the server has no picture in it — and the picture-only ones,
 * which are the whole post, rendered as an empty card with a "📷" caption.
 *
 * The phone already holds the file. This joins the two on the pair that both
 * sides derive from the same row — `seedTimestamp(date)` is exactly the
 * `created_at` the seeder sent, and the body is the text it sent — so a match
 * is the same post and not a coincidence. A comment written on another device
 * simply has no local file and keeps the caption.
 *
 * Returns a MAP built once per list rather than a per-row scan: a library with
 * five thousand comments would otherwise be a scan per rendered row.
 */
export function localPictureIndex(rows: readonly LocalCommentPicture[]): Map<string, LocalCommentPicture> {
  const out = new Map<string, LocalCommentPicture>();
  for (const r of rows) {
    const at = seedTimestamp(r.date);
    if (!at) continue;
    // First wins: two identical posts at the identical second are the same
    // picture, and a later duplicate row must not replace it.
    const key = `${at}|${(r.text ?? '').trim()}`;
    if (!out.has(key)) out.set(key, r);
  }
  return out;
}

/** The key side of the same rule, for a comment as the server returned it. */
export function pictureKeyOf(c: PicturedComment): string {
  return `${c.created_at}|${(c.body ?? '').trim()}`;
}

// ── what a profile publishes ─────────────────────────────────────────────────

/**
 * A row on its way to a published shelf.
 *
 * TWO RANKS, because the profile draws two shelves out of one list and they
 * are not in the same order. `rank` is the position on the MAIN shelf — the
 * Shows or Movies rail, most recently watched first. `favRank` is the position
 * among the FAVOURITES, which is the order the owner dragged them into.
 *
 * Either may be null: a hearted show that has never been watched is not on the
 * main shelf, and most titles are not favourites.
 */
export type LocalTitle = {
  name: string;
  poster: string | null;
  favourite: boolean;
  rank: number | null;
  favRank?: number | null;
  tvdbId?: number;
  year?: string | null;
};

/** One title as `PUT /v1/me/published` takes it. Snake case: it is the wire. */
export type PublishedTitle = {
  target_source: 'tvdb' | 'title';
  target_key: string;
  name: string;
  poster: string | null;
  favourite: boolean;
  rank: number | null;
  fav_rank: number | null;
};

/**
 * WHAT A PROFILE SHOWS. Not what a library may hold.
 *
 * These cap the shelf, never the device. A person may favourite as many shows
 * as they like and keep as many lists as they like; the phone stores all of it
 * and always will. What is bounded is how much of it goes onto a public page,
 * which is the part that costs somebody else's bandwidth and our storage.
 *
 * SET BEFORE THE COMMUNITY SHIPS, deliberately. A cap introduced later takes
 * something away from people who already have it — the mistake that earned
 * Trakt its backlash when it capped lists retroactively. Introduced with the
 * feature, it is simply the shape of the feature.
 *
 * The favourites cap is applied by drag order, so it is the owner who decides
 * which twenty — not recency, and not us.
 */
export const PROFILE_FAVOURITE_LIMIT = 20;
export const PROFILE_LIST_LIMIT = 10;

/**
 * THE CAP CONSTRAINS PUBLISHING MORE. IT NEVER UNPUBLISHES.
 *
 * Publishing is a REPLACEMENT — each run sends the whole shelf and the server
 * deletes what was there — so a cap applied naively is not a cap at all, it is
 * a delete. The day somebody's Plus lapses, a blind `.slice(0, 10)` would take
 * thirty published lists off their profile on the next launch, silently, from a
 * background sync they never asked for. That is the Trakt mistake with an
 * automated hand on the lever.
 *
 * So the caller passes the keys it has ALREADY published, and:
 *
 *   - every already-published item is kept, wherever it sits in the order;
 *   - new items join, in order, until the TOTAL reaches `cap`;
 *   - a set already over `cap` therefore stays over it, and simply stops
 *     growing.
 *
 * The published ones are counted BEFORE the walk, not as they are met, or an
 * item grandfathered at the bottom of the order would let the whole cap's worth
 * of new ones in above it — a cap of ten quietly publishing eleven, twelve,
 * thirteen, one lapsed subscriber at a time.
 *
 * `cap` is `Infinity` for Plus, which makes the whole thing a copy.
 */
export function withinPublishCap<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  alreadyPublished: readonly string[],
  cap: number,
): T[] {
  const published = new Set(alreadyPublished);
  // Only the ones still on the device: a list deleted since is not on the
  // server either (publishing replaced it away), so it must not hold a place.
  const grandfathered = items.filter((i) => published.has(keyOf(i))).length;
  let room = Math.max(0, cap - grandfathered);
  const kept: T[] = [];
  for (const item of items) {
    if (published.has(keyOf(item))) kept.push(item);
    else if (room > 0) {
      room -= 1;
      kept.push(item);
    }
  }
  return kept;
}

/**
 * Whether to offer Plus here: the free tier is publishing everything it can and
 * there is more where that came from. False for Plus, and false at exactly the
 * cap — nothing is being held back yet, so there is nothing to say.
 */
export function publishCapHit(plus: boolean, publishable: number, cap: number): boolean {
  return !plus && publishable > cap;
}

/**
 * The shelf, ready to send — or nothing, for a row that cannot be addressed.
 *
 * IDENTITY IS THE WHOLE JOB HERE. A shelf tile and a title's comment thread
 * have to agree about what they point at, or tapping a tile opens a page whose
 * numbers belong to something else. So a show is `tvdb:<id>` and a film is
 * `title:<slug>|<year>` — `targetKey`, the same function the ratings and the
 * comments already go through, rather than a second spelling of the same rule.
 *
 * A film with no title left to key on is dropped rather than sent under an
 * empty key, which would collide with every other such film on the server.
 */
export function titlesForPublish(rows: readonly LocalTitle[], kind: 'show' | 'movie'): PublishedTitle[] {
  const out: PublishedTitle[] = [];
  for (const r of rows) {
    const name = (r.name ?? '').trim();
    if (!name) continue;
    if (kind === 'show') {
      if (!r.tvdbId || r.tvdbId <= 0) continue;
      out.push({
        target_source: 'tvdb',
        target_key: String(r.tvdbId),
        name,
        poster: r.poster ?? null,
        favourite: r.favourite,
        rank: r.rank,
        fav_rank: r.favRank ?? null,
      });
    } else {
      const key = targetKey('title', { title: name, year: r.year ?? null });
      // `slug('')` is empty, and an empty key would put every unnameable film
      // in one bucket shared with every other profile's.
      if (!key || key.startsWith('|')) continue;
      out.push({
        target_source: 'title',
        target_key: key,
        name,
        poster: r.poster ?? null,
        favourite: r.favourite,
        rank: r.rank,
        fav_rank: r.favRank ?? null,
      });
    }
  }
  return out;
}

/**
 * The two totals a profile publishes.
 *
 * Minutes, not seconds and not a formatted string: the server stores a number
 * and every client formats it in its own language. `clockOf` on the phone turns
 * it into "19 months 6 days" and a future web profile would do the same from
 * the same integer.
 */
export function publishableStats(input: {
  episodes: number;
  /** MINUTES, as `getTotals()` returns them — already gap-filled. */
  showMinutes: number;
  /** MINUTES, as `getMovieTotals()` returns them — likewise. */
  movieMinutes: number;
}): { episodes_watched: number; minutes_watched: number; movie_minutes: number } {
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  return {
    episodes_watched: n(input.episodes),
    // MINUTES IN, MINUTES OUT. Both totals arrive already converted and
    // gap-filled — the raw `SUM(runtime)` columns are seconds, but neither
    // getter returns them raw, because roughly 40% of imported rows carry no
    // runtime at all and counting those as zero reads months short. Dividing
    // here, as an earlier version did, made a 3,385-episode profile publish
    // "1 day": the same figure the Stats screen shows, sixty times too small.
    //
    // SEPARATE, because the profile draws four cards and two of them are about
    // films alone — TV time and Movie time. A single combined figure cannot be
    // split back apart, so a profile built from one could never show the same
    // Stats section as the owner's own screen, which is the entire point.
    minutes_watched: n(input.showMinutes),
    movie_minutes: n(input.movieMinutes),
  };
}


/**
 * HOW THE LISTS THEMSELVES ARE ORDERED — not the titles inside one.
 *
 * `customLists` has always been an ordered array, but nothing could reorder it,
 * so an imported library arrived in whatever order the export happened to emit
 * and stayed there. A tester with a dozen imported lists put it exactly: "the
 * lists aren't in the order they were created ... it would be useful to
 * rearrange them."
 *
 * `custom` is that stored array as-is, and it is what the up/down nudges edit.
 * Every other option is a derived view and never writes the stored order back.
 */
export type ListSort = 'custom' | 'az' | 'recent' | 'size';

export const LIST_SORTS: readonly ListSort[] = ['custom', 'az', 'recent', 'size'];

export function isListSort(v: string | null | undefined): v is ListSort {
  return v != null && (LIST_SORTS as readonly string[]).includes(v);
}

/** Only the fields the sort reads, so the bundled seed lists — whose items
 *  carry no `kind` — go through the same function as imported ones. */
export type SortableList = { name: string; items: readonly unknown[]; totalCount?: number; pinned?: boolean };

export function sortLists<T extends SortableList>(lists: readonly T[], sort: ListSort): T[] {
  const out = [...lists];
  // `localeCompare` so "Éire" files under E and Arabic names order sanely — the
  // app ships in six languages and a raw `<` would sort by code point.
  if (sort === 'az') out.sort((a, b) => a.name.localeCompare(b.name));
  // `totalCount` counts entries the export named but could not resolve, so it is
  // the honest size of a list rather than the number of posters we can draw.
  else if (sort === 'size') out.sort((a, b) => sizeOfList(b) - sizeOfList(a));
  // `recent` is CREATION order, not modification: nothing records a modified
  // time, but the export carries a real `created_at` and the importer now lays
  // the lists down in that order (see `orderImportedLists`). So the stored
  // array already IS creation order until the user rearranges it.
  return pinnedFirst(out);
}

/**
 * A PIN OUTRANKS EVERY SORT, including the user's own drag order.
 *
 * Applied last and to all four sorts, because a pin means "this one, at the
 * top" and a list that jumped back into the pack the moment somebody sorted
 * A–Z would be a pin that only sometimes pins. Stable, so within the pinned
 * group and within the rest the chosen sort still decides.
 */
function pinnedFirst<T extends SortableList>(lists: T[]): T[] {
  if (!lists.some((l) => l.pinned === true)) return lists;
  return [...lists.filter((l) => l.pinned === true), ...lists.filter((l) => l.pinned !== true)];
}

function sizeOfList(l: SortableList): number {
  return l.totalCount ?? l.items.length;
}

/**
 * Where a list moves to when nudged, or -1 when it cannot move.
 *
 * Separate from the write so the bounds are testable without a database: the
 * first row cannot go up and the last cannot go down, and a name that is not
 * in the array must not silently reorder something else.
 */
export function movedListIndex(names: readonly string[], name: string, delta: -1 | 1): number {
  const i = names.indexOf(name);
  if (i === -1) return -1;
  const j = i + delta;
  return j < 0 || j >= names.length ? -1 : j;
}


/**
 * The order imported lists should arrive in.
 *
 * TV Time's export HAS an `ordering` column, so it is honoured first — but it is
 * `0` or blank on every row of every export checked (16 lists in one, 4 in
 * another), which is exactly why an imported library arrives jumbled. So the
 * real signal is `created_at`, oldest first, which is the order a tester with a
 * dozen imported lists asked for in as many words: "the lists aren't in the
 * order they were created ... it would be useful to rearrange them."
 *
 * `ordering` is still read rather than ignored: if TV Time populated it for some
 * accounts, or a third-party export does, those users get their real order with
 * no further work.
 */
export type ImportedListOrder = { ordering?: string | null; createdAt?: string | null };

export function orderImportedLists<T extends ImportedListOrder>(lists: readonly T[]): T[] {
  const num = (v: string | null | undefined) => {
    const n = Number((v ?? '').trim());
    return Number.isFinite(n) ? n : 0;
  };
  const useOrdering = lists.some((l) => num(l.ordering) !== 0);
  return lists
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      if (useOrdering) return num(a.l.ordering) - num(b.l.ordering) || a.i - b.i;
      // Oldest first: a list made in 2023 sits above one made last month, which
      // is what "the order they were created" means. A row with no date sorts
      // last rather than to the top on an empty string.
      const at = (a.l.createdAt ?? '').trim();
      const bt = (b.l.createdAt ?? '').trim();
      if (at === '' && bt === '') return a.i - b.i;
      if (at === '') return 1;
      if (bt === '') return -1;
      return at.localeCompare(bt) || a.i - b.i;
    })
    .map(({ l }) => l);
}


/**
 * The identity of an archived comment: what it is ABOUT, WHEN, and how it opens.
 *
 * Content rather than a rowid on purpose — a re-import rebuilds the table and
 * every rowid with it, so a tombstone keyed on one would stop matching and a
 * comment the user deleted would come back. Both the delete list and the count
 * must derive it identically, which is why it lives here rather than in a screen.
 */
export function archivedCommentKey(c: { entity: string; date: string; text: string }): string {
  return `${c.entity}|${c.date}|${c.text.slice(0, 40)}`;
}

/**
 * What somebody has looked at from the search screen.
 *
 * BOTH HALVES, not just typed words. A search is a means, not an end — a person
 * who typed "sev" and opened Severance wants Severance back, not the letters.
 * So an opened show, film or profile is remembered as itself, and a query is
 * remembered only when nothing was opened from it.
 */
export type SearchHistoryEntry = {
  /** `query` re-runs the search; the rest open the thing directly. */
  kind: 'query' | 'show' | 'movie' | 'profile';
  /** What the row says. */
  label: string;
  /** What re-opens it: a query string, a tvdbId, a movie name, a handle. */
  value: string;
  /** Drawn on the row when there is one. */
  poster?: string | null;
  at: string;
};

/** Enough to be useful, few enough that the screen stays a search screen. */
export const SEARCH_HISTORY_MAX = 12;

/**
 * Put an entry at the front, most recent first, with no duplicates.
 *
 * Matched on kind AND value: the film "Dune" and the query "dune" are two
 * different things to want back, and collapsing them would lose whichever was
 * touched second.
 */
export function addSearchHistory(
  history: readonly SearchHistoryEntry[],
  entry: SearchHistoryEntry,
): SearchHistoryEntry[] {
  const label = entry.label.trim();
  if (label === '' || entry.value.trim() === '') return [...history];
  const without = history.filter((h) => !(h.kind === entry.kind && h.value === entry.value));
  return [{ ...entry, label }, ...without].slice(0, SEARCH_HISTORY_MAX);
}

/** Drop one entry — a person can un-remember a single search without clearing
 *  everything, which is the difference between a list and a confession. */
export function removeSearchHistory(
  history: readonly SearchHistoryEntry[],
  kind: SearchHistoryEntry['kind'],
  value: string,
): SearchHistoryEntry[] {
  return history.filter((h) => !(h.kind === kind && h.value === value));
}

/* ── Deep Stats (Plus) ─────────────────────────────────────────────────────
 * The arithmetic behind the Deep Stats dashboard. Pure so it can be tested
 * without a database: the screen hands these functions plain rows.
 */

export type BingeReport = {
  /** most episodes watched on any one calendar day */
  biggestDay: number;
  /** which day that was, '' when there is nothing to report */
  biggestDayDate: string;
  /** longest run of calendar days with at least one episode on each */
  longestStreak: number;
  /** days with at least one episode */
  activeDays: number;
  /** episodes ÷ active days, one decimal */
  perActiveDay: number;
};

/**
 * Binge shape from watch DATES ('YYYY-MM-DD', one entry per episode, repeats
 * included). Dates rather than timestamps on purpose: most imported watches
 * carry no clock time at all, and a "biggest day" is a calendar question.
 */
export function bingeReport(days: readonly string[]): BingeReport {
  const perDay = new Map<string, number>();
  for (const d of days) {
    const key = d.slice(0, 10);
    if (key.length < 10) continue;
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  if (perDay.size === 0) {
    return { biggestDay: 0, biggestDayDate: '', longestStreak: 0, activeDays: 0, perActiveDay: 0 };
  }
  let biggestDay = 0;
  let biggestDayDate = '';
  let total = 0;
  for (const [day, n] of perDay) {
    total += n;
    // ties go to the earlier date, so the number stops moving between renders
    if (n > biggestDay || (n === biggestDay && day < biggestDayDate)) {
      biggestDay = n;
      biggestDayDate = day;
    }
  }
  const sorted = [...perDay.keys()].sort();
  let longestStreak = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const gap = Date.parse(`${sorted[i]}T00:00:00Z`) - Date.parse(`${sorted[i - 1]}T00:00:00Z`);
    run = gap === 864e5 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
  }
  return {
    biggestDay,
    biggestDayDate,
    longestStreak,
    activeDays: perDay.size,
    perActiveDay: Math.round((total / perDay.size) * 10) / 10,
  };
}

/** The key under `plus.stats.personality.*` that describes a rating habit. */
export type PersonalityLabel = 'unrated' | 'allOrNothing' | 'generous' | 'tough' | 'consistent' | 'balanced';

export type RatingPersonality = {
  /** how many ratings went into this */
  total: number;
  /** mean stars, 1–5, one decimal */
  mean: number;
  /** population standard deviation, one decimal */
  spread: number;
  label: PersonalityLabel;
};

/** Below this a mean is noise, not a personality. */
export const PERSONALITY_MIN_RATINGS = 5;

/**
 * Turn a 1–5 star histogram into a one-word habit.
 *
 * Spread is asked FIRST because it beats the mean as a description: somebody
 * who only ever gives 1s and 5s averages 3, which "balanced" would describe
 * exactly backwards.
 */
export function ratingPersonality(counts: readonly number[]): RatingPersonality {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return { total: 0, mean: 0, spread: 0, label: 'unrated' };
  const sum = counts.reduce((a, n, i) => a + n * (i + 1), 0);
  const mean = sum / total;
  const variance = counts.reduce((a, n, i) => a + n * (i + 1 - mean) ** 2, 0) / total;
  const spread = Math.sqrt(variance);
  const round = (n: number) => Math.round(n * 10) / 10;
  const label: PersonalityLabel =
    total < PERSONALITY_MIN_RATINGS
      ? 'unrated'
      : spread >= 1.3
        ? 'allOrNothing'
        : mean >= 4.2
          ? 'generous'
          : mean <= 2.5
            ? 'tough'
            : spread <= 0.6
              ? 'consistent'
              : 'balanced';
  return { total, mean: round(mean), spread: round(spread), label };
}

export type WatchTimeShape = {
  /** episodes per hour of day, index 0 = 00:00 */
  hours: number[];
  /** episodes per weekday, index 0 = Monday */
  weekdays: number[];
  /** share of watches stamped exactly midnight, 0–1 */
  midnightShare: number;
  /** false when the clock would be a lie — see below */
  clockIsReal: boolean;
};

/**
 * A GDPR import carries DATES, not times, and every one of them lands at
 * 00:00:00. Drawing that produces a magnificent spike at midnight which is
 * pure artefact — so when most stamps are exactly midnight the screen says so
 * instead of charting it. The weekday chart survives either way: the date is
 * real even when the clock isn't.
 */
export const MIDNIGHT_SHARE_LIMIT = 0.7;

export function watchTimeShape(timestamps: readonly string[]): WatchTimeShape {
  const hours = new Array<number>(24).fill(0);
  const weekdays = new Array<number>(7).fill(0);
  let midnight = 0;
  let counted = 0;
  for (const raw of timestamps) {
    const date = raw.slice(0, 10);
    const at = Date.parse(`${date}T00:00:00Z`);
    if (Number.isNaN(at)) continue;
    counted++;
    // Sunday is 0 in JS and last in every calendar this app draws
    weekdays[(new Date(at).getUTCDay() + 6) % 7]++;
    const hour = Number(raw.slice(11, 13));
    const minute = Number(raw.slice(14, 16));
    const h = Number.isFinite(hour) && raw.length >= 13 ? hour : 0;
    hours[h % 24]++;
    if (h === 0 && (!Number.isFinite(minute) || minute === 0)) midnight++;
  }
  const midnightShare = counted === 0 ? 1 : midnight / counted;
  return { hours, weekdays, midnightShare, clockIsReal: counted > 0 && midnightShare <= MIDNIGHT_SHARE_LIMIT };
}

/** Under this many overlapping titles a contrarian score means nothing. */
export const CONTRARIAN_MIN_TITLES = 5;

/** A delta this big (on the 0–10 scale both sides are put on) is as far apart
 *  as two opinions realistically get, so it anchors the top of the scale. */
export const CONTRARIAN_FULL_DELTA = 4;

/**
 * 0 = you agree with everyone, 100 = you never do. Mean ABSOLUTE delta, so
 * rating everything above the crowd and rating everything below it are equally
 * contrarian — averaging the signed deltas would cancel them into "typical".
 */
export function contrarianScore(deltas: readonly number[]): number | null {
  if (deltas.length < CONTRARIAN_MIN_TITLES) return null;
  const mean = deltas.reduce((a, d) => a + Math.abs(d), 0) / deltas.length;
  return Math.round(Math.min(mean / CONTRARIAN_FULL_DELTA, 1) * 100);
}

/**
 * The annual saving as a whole percent, or null when it cannot be stated
 * honestly — no price, a free product, or a "saving" that is zero or negative.
 *
 * Computed from the two real store prices rather than written down: a
 * hardcoded "SAVE 37%" becomes false the first time a price moves in one
 * storefront, and a paywall whose numbers disagree with its products is a
 * rejection. Both prices come from the same storefront, so the ratio needs no
 * currency.
 */
export function annualSavingPercent(monthly: number | undefined, annual: number | undefined): number | null {
  if (!monthly || !annual || monthly <= 0 || annual <= 0) return null;
  const pct = Math.round((1 - annual / (monthly * 12)) * 100);
  return pct > 0 && pct < 100 ? pct : null;
}

/* ── Theme from artwork ─────────────────────────────────────────────────────
 * The profile theme's colour comes FROM the chosen show's artwork, not from a
 * swatch — "my profile is themed on The Matrix" is identity; "my profile is
 * green" is a preference nobody mentions. Pure over decoded pixels so the
 * algorithm is testable without an image library.
 */

/** Blend two #RRGGBB colours; `t` is the share of `b`. Used for the wash. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i]! - v) * Math.min(Math.max(t, 0), 1)));
  return `#${c.map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('')}`;
}

/**
 * The dominant VIVID colour of an image, as #RRGGBB, or null when there is
 * none worth naming (a black-and-white poster is honest about it).
 *
 * Not the average — averaging a Matrix backdrop gives murky grey. Pixels are
 * binned by hue, weighted by saturation × brightness so neon beats mud, greys
 * and near-blacks are ignored entirely, and the winning bin's members are
 * averaged. The result is then pulled toward a UI-usable range: an accent
 * must survive as text on a dark ground, so brightness is floored — the SHADE
 * on screen may differ from the frame, the HUE never does.
 */
/**
 * THE SECOND COLOUR IN THE PICTURE, and why a theme needs one.
 *
 * `dominantAccent` returns the single loudest hue, which is enough to say
 * "this profile is gold" and not enough to look designed: one colour used for
 * every accent on a page reads as a filter, and a filter is what somebody looks
 * at once. Real artwork has a pairing -- the gold and the deep teal behind it,
 * the red and the bruised blue -- and using two in different roles is the
 * difference between a tint and an identity.
 *
 * FURTHEST HUE THAT STILL CARRIES WEIGHT, rather than the second-heaviest bin:
 * the runner-up is usually the neighbouring bin, a shade of the same colour,
 * which buys nothing. At least 60 degrees away, and worth at least a fifth of
 * the winner so a stray highlight cannot become half the theme.
 *
 * Returns null when the image genuinely has one colour in it -- a poster that
 * is all amber should theme as all amber, not have a colour invented for it.
 */
export function secondaryAccent(rgba: Uint8Array, sampleStride = 4): string | null {
  const BINS = 24;
  const weight = new Array<number>(BINS).fill(0);
  const sumR = new Array<number>(BINS).fill(0);
  const sumG = new Array<number>(BINS).fill(0);
  const sumB = new Array<number>(BINS).fill(0);
  const sumW = new Array<number>(BINS).fill(0);

  for (let i = 0; i + 3 < rgba.length; i += 4 * sampleStride) {
    const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const v = max / 255;
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < 0.25 || v < 0.15 || (v > 0.95 && sat < 0.35)) continue;
    const d = max - min;
    if (d === 0) continue;
    let h: number;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const bin = Math.floor(h / (360 / BINS)) % BINS;
    const w = sat * v;
    weight[bin]! += w;
    sumR[bin]! += r * w;
    sumG[bin]! += g * w;
    sumB[bin]! += b * w;
    sumW[bin]! += w;
  }

  let best = -1;
  for (let i = 0; i < BINS; i++) if (weight[i]! > (best < 0 ? 0 : weight[best]!)) best = i;
  if (best < 0) return null;

  const binDegrees = 360 / BINS;
  const apart = (a: number, b: number) => {
    const raw = Math.abs(a - b) * binDegrees;
    return Math.min(raw, 360 - raw);
  };

  let second = -1;
  for (let i = 0; i < BINS; i++) {
    if (apart(i, best) < 60) continue;
    if (weight[i]! < weight[best]! * 0.2) continue;
    if (second < 0 || weight[i]! > weight[second]!) second = i;
  }
  if (second < 0 || sumW[second]! === 0) return null;

  let r = sumR[second]! / sumW[second]!, g = sumG[second]! / sumW[second]!, b = sumB[second]! / sumW[second]!;
  const v = Math.max(r, g, b) / 255;
  const MIN_V = 0.72;
  if (v < MIN_V && v > 0) {
    const k = MIN_V / v;
    r = Math.min(255, r * k); g = Math.min(255, g * k); b = Math.min(255, b * k);
  }
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0').toUpperCase();
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function dominantAccent(rgba: Uint8Array, sampleStride = 4): string | null {
  const BINS = 24;
  const weight = new Array<number>(BINS).fill(0);
  const sumR = new Array<number>(BINS).fill(0);
  const sumG = new Array<number>(BINS).fill(0);
  const sumB = new Array<number>(BINS).fill(0);
  const sumW = new Array<number>(BINS).fill(0);

  for (let i = 0; i + 3 < rgba.length; i += 4 * sampleStride) {
    const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const v = max / 255;
    const s = max === 0 ? 0 : (max - min) / max;
    // Grey, near-black and blown-out white say nothing about the palette.
    if (s < 0.25 || v < 0.15 || (v > 0.95 && s < 0.35)) continue;
    let h: number;
    const d = max - min;
    if (d === 0) continue;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const bin = Math.floor(h / (360 / BINS)) % BINS;
    const w = s * v;
    weight[bin]! += w;
    sumR[bin]! += r * w;
    sumG[bin]! += g * w;
    sumB[bin]! += b * w;
    sumW[bin]! += w;
  }

  let best = -1;
  for (let i = 0; i < BINS; i++) if (weight[i]! > (best < 0 ? 0 : weight[best]!)) best = i;
  if (best < 0 || sumW[best]! === 0) return null;

  let r = sumR[best]! / sumW[best]!, g = sumG[best]! / sumW[best]!, b = sumB[best]! / sumW[best]!;
  // Floor the brightness so the accent reads on black. Scaling RGB uniformly
  // moves value without touching hue.
  const v = Math.max(r, g, b) / 255;
  const MIN_V = 0.72;
  if (v < MIN_V && v > 0) {
    const k = MIN_V / v;
    r = Math.min(255, r * k); g = Math.min(255, g * k); b = Math.min(255, b * k);
  }
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0').toUpperCase();
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/* ── The activity heatmap ───────────────────────────────────────────────────
 * A year of watching as a GitHub-style grid: one column per week, one cell per
 * day. Laid out here, pure, so the calendar arithmetic — which is where this
 * kind of grid always goes wrong — is testable without a database or a screen.
 */

export type HeatCell = { date: string; count: number };
/**
 * Columns of seven days, oldest first, each column a Sunday-first week.
 * `null` is a day outside the months being shown — drawn as a gap, so the
 * grid begins on a 1st and ends on a 31st however the weeks fall.
 */
export type HeatGrid = (HeatCell | null)[][];

const DAY_MS = 86_400_000;

/** The month `delta` months from `month` ('YYYY-MM'). */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  const total = y * 12 + (m - 1) + delta;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * The half-year a month belongs to, as the month that half ENDS in: June or
 * December.
 *
 * The window is a fixed half of the calendar rather than "the last six months",
 * so it reads as January–June and July–December — halves everybody already
 * thinks in — instead of March–August, which is six months of nothing in
 * particular and shifts under the reader every month. Once aligned it stays
 * aligned: six months back from June is December.
 */
export function halfEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return `${String(y).padStart(4, '0')}-${m <= 6 ? '06' : '12'}`;
}

/** Days in a month ('YYYY-MM'). Day 0 of the next month, so leap years are free. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return 0;
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * `months` whole calendar months ending with `endMonth`, as columns of seven.
 *
 * WHOLE MONTHS, not a window that floats. Counting back a fixed number of weeks
 * from today put the grid's edges in the middle of months — "the 14th of March
 * to the 13th of August" — so the first and last columns were half a month each
 * and the month labels sat over partial columns. Now it runs from the 1st to
 * the 31st and the days before and after are gaps.
 *
 * Six months of whole weeks is at most 27 columns, which still fits a phone.
 */
export function monthsGrid(endMonth: string, months: number, counts: ReadonlyMap<string, number>): HeatGrid {
  const startMonth = shiftMonth(endMonth, -(months - 1));
  const first = Date.parse(`${startMonth}-01T00:00:00Z`);
  const lastDay = daysInMonth(endMonth);
  const last = Date.parse(`${endMonth}-${String(lastDay).padStart(2, '0')}T00:00:00Z`);
  if (Number.isNaN(first) || Number.isNaN(last) || lastDay === 0) return [];

  // Out to whole weeks on both ends so every column has seven rows.
  const gridStart = first - new Date(first).getUTCDay() * DAY_MS;
  const gridEnd = last + (6 - new Date(last).getUTCDay()) * DAY_MS;
  const columns = Math.round((gridEnd - gridStart) / (7 * DAY_MS)) + 1;

  const grid: HeatGrid = [];
  for (let w = 0; w < columns; w++) {
    const week: (HeatCell | null)[] = [];
    for (let d = 0; d < 7; d++) {
      const ms = gridStart + (w * 7 + d) * DAY_MS;
      if (ms < first || ms > last) {
        week.push(null);
        continue;
      }
      const day = new Date(ms).toISOString().slice(0, 10);
      week.push({ date: day, count: counts.get(day) ?? 0 });
    }
    grid.push(week);
  }
  return grid;
}

/**
 * Which columns to write a month name above: the first column containing a day
 * of each month.
 *
 * Read off the grid rather than computed from the range, so the labels cannot
 * drift from the squares they sit over — the failure nobody notices until a
 * heavy December is labelled November.
 */
export function monthColumns(grid: HeatGrid): { index: number; month: string }[] {
  const out: { index: number; month: string }[] = [];
  let last = '';
  grid.forEach((week, index) => {
    const cell = week.find((c): c is HeatCell => c !== null);
    if (!cell) return;
    const month = cell.date.slice(0, 7);
    if (month !== last) {
      out.push({ index, month });
      last = month;
    }
  });
  return out;
}

/**
 * 0–4 for a day's count, the shade the cell is drawn in.
 *
 * Scaled against a BUSY day rather than the busiest: one 30-episode binge would
 * otherwise flatten an entire year of ordinary evenings into the palest shade.
 * Anything at or above `busy` is full strength.
 */
export function heatLevel(count: number, busy: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  const step = Math.max(1, busy) / 4;
  return Math.min(4, Math.ceil(count / step)) as 1 | 2 | 3 | 4;
}

/**
 * The count a full-strength cell represents: the 90th percentile of active
 * days, floored at 2. Percentile rather than max for the reason above, and
 * floored so a light week does not paint a single episode as a heavy day.
 */
export function busyDayCount(counts: ReadonlyMap<string, number>): number {
  const active = [...counts.values()].filter((n) => n > 0).sort((a, b) => a - b);
  if (active.length === 0) return 2;
  return Math.max(2, active[Math.floor(active.length * 0.9)] ?? 2);
}

/* ── Wrapped: one period of watching, recapped ──────────────────────────────
 * A period is a MONTH ('2026-07') or a YEAR ('2026'). Months are the point:
 * a yearly-only recap gives one moment a year, in December, and a reason to
 * cancel in January. Everything below is date arithmetic and honesty checks —
 * the counting itself is `computeWrapped` in stats-calc.ts.
 */

/** Inclusive 'YYYY-MM-DD' bounds of a period, plus what kind it is. */
export type WrappedPeriod = { key: string; kind: 'month' | 'year'; start: string; end: string };

/**
 * '2026-07' → July's bounds, '2026' → the year's. Null for anything else, so a
 * hand-typed deep link cannot produce a recap of a range nobody meant.
 */
export function periodBounds(key: string): WrappedPeriod | null {
  if (/^\d{4}-\d{2}$/.test(key)) {
    const days = daysInMonth(key);
    if (days === 0 || Number(key.slice(5)) > 12) return null;
    return { key, kind: 'month', start: `${key}-01`, end: `${key}-${String(days).padStart(2, '0')}` };
  }
  if (/^\d{4}$/.test(key)) return { key, kind: 'year', start: `${key}-01-01`, end: `${key}-12-31` };
  return null;
}

/**
 * What the period picker offers: the last few COMPLETED months, newest first,
 * then the years that have a watch in them. The current month and the current
 * year are never listed — half a period is not a recap of it, and it would be
 * the first thing tapped.
 */
export function periodOptions(today: string, years: readonly number[], months = 6): string[] {
  const out: string[] = [];
  for (let i = 1; i <= months; i++) out.push(shiftMonth(today.slice(0, 7), -i));
  const thisYear = Number(today.slice(0, 4));
  for (const y of years) if (y < thisYear) out.push(String(y));
  return out;
}

/** The counted shape of a period — whatever produced it. */
export type WrappedShape = {
  episodes: number;
  films: number;
  minutes: number;
  topShows: readonly { name: string; minutes: number; episodes: number }[];
  topGenres: readonly { name: string; minutes: number }[];
  biggestDay: { date: string; count: number };
  longestStreak: number;
  activeDays: number;
  posters: readonly string[];
  /** Shows met for the first time in this period. */
  newShows: number;
  /** Shows that were already under way when it started. */
  continuedShows: number;
  /** Mean stars given, 1–5, or null if nothing was rated. */
  averageRating: number | null;
  /** How many things that mean is made of. */
  ratedCount: number;
};

/**
 * Below this a period has no recap in it.
 *
 * THREE, and it is the whole design of this feature. The owner's own August
 * 2025 holds ONE watch: a story-format recap of it would be six slides of
 * zeroes, an empty poster collage and a "your longest streak: 0 days" — which
 * is not a quiet month, it is a broken screen. One or two things watched is a
 * fact worth one sentence, not a tap-through; three is the least that can fill
 * a couple of honest slides (a total, a top show, a day).
 */
export const WRAPPED_MIN_ITEMS = 3;

/** Nothing to tap through — say so and offer another period. */
export function wrappedTooQuiet(d: Pick<WrappedShape, 'episodes' | 'films'>): boolean {
  return d.episodes + d.films < WRAPPED_MIN_ITEMS;
}

/**
 * Below this an average is a mood, not a habit.
 *
 * FIVE. With four ratings behind it a single 5★ moves the mean by a quarter of
 * a star, so "your average verdict: 4.3" would be a sentence about one evening
 * dressed up as a disposition — and this is the most opinionated number in the
 * deck, the one somebody would actually post. Under five the average is still
 * shown, as the sub-line on the counts card it has always been; it just does
 * not get a card of its own. A user who rates nothing has no average at all
 * and never sees either.
 */
export const WRAPPED_MIN_RATINGS = 5;

export type WrappedSlideId =
  | 'opening'
  | 'time'
  | 'counts'
  | 'newVsContinued'
  | 'topShow'
  | 'topShows'
  | 'topGenre'
  | 'topGenres'
  | 'biggestDay'
  | 'streak'
  | 'ratingCard'
  | 'collage';

/**
 * Which slides this period can actually fill.
 *
 * A slide with no data is DROPPED, never shown as a zero. "Your biggest day: 1
 * episode" and "longest streak: 1 day" are true and worthless; a collage of
 * two posters looks like a failed load. The closing slide is the only one that
 * survives a thin period, because it carries the period's name and the handle
 * and is the thing anybody would share.
 */
export function wrappedSlides(d: WrappedShape): WrappedSlideId[] {
  const out: WrappedSlideId[] = ['opening'];
  if (d.minutes > 0) out.push('time');
  out.push('counts');
  // BOTH SIDES OR NEITHER. "7 new and 0 you stayed with" is the counts card's
  // new-shows sub-line with extra ceremony, and "0 new" reads as a scolding.
  if (d.newShows > 0 && d.continuedShows > 0) out.push('newVsContinued');
  if (d.topShows.length > 0) out.push('topShow');
  // the runners-up, and only if there are two of them — a list of one is the
  // slide before it, said again
  if (d.topShows.length >= 3) out.push('topShows');
  if (d.topGenres.length > 0) out.push('topGenre');
  if (d.topGenres.length >= 2) out.push('topGenres');
  if (d.biggestDay.count >= 2) out.push('biggestDay');
  if (d.longestStreak >= 2 || d.activeDays >= 2) out.push('streak');
  if (d.averageRating != null && d.ratedCount >= WRAPPED_MIN_RATINGS) out.push('ratingCard');
  out.push('collage');
  return out;
}

/** Posters for the closing collage: real ones only, no repeats, capped. */
export function collagePosters(candidates: readonly (string | null | undefined)[], max = 9): string[] {
  const seen = new Set<string>();
  for (const p of candidates) {
    if (p) seen.add(p);
    if (seen.size >= max) break;
  }
  return [...seen];
}

/** The last month whose Wrapped prompt was answered, 'YYYY-MM'. */
export const WRAPPED_SEEN_KEY = 'wrappedSeenMonth';

/**
 * The Discord card, offered once.
 *
 * ONE-WAY, like `plusAnnounced`: a banner on a screen people open daily
 * becomes furniture, and furniture becomes an irritation. Dismissed is
 * dismissed, and the durable home for the link is the Community section that
 * already carries it.
 */
export const DISCORD_SEEN_KEY = 'discordAnnounced';

/* ── The monthly Wrapped prompt ─────────────────────────────────────────────
 * A recap nobody is told about is a recap nobody opens. On the 1st, last month
 * is finished and worth a look — so the owner's own profile offers it, once.
 */

/** 'YYYY-MM' of the month before the one this day is in. */
export function previousMonth(day: string): string {
  return shiftMonth(day.slice(0, 7), -1);
}

/**
 * The month to offer on the profile, or null for "say nothing".
 *
 * OFFERED FROM THE 1ST AND UNTIL IT IS ANSWERED, not only ON the 1st. A prompt
 * that exists for one day is missed by anybody who does not open the app that
 * day, which for a monthly recap is most people — and the recap is just as
 * true on the 4th. It goes away when opened or dismissed, and the next month
 * re-arms it, because `seen` records WHICH month was answered rather than a
 * boolean.
 *
 * `seen` is the last month the user dealt with, 'YYYY-MM' or ''.
 */
export function wrappedToOffer(today: string, seen: string | null): string | null {
  const month = previousMonth(today);
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  return (seen ?? '') >= month ? null : month;
}

/* -- Advanced library filters ----------------------------------------------
 *
 * The whole filter engine, and deliberately all of it: matching a title,
 * deriving the options a library can actually offer, and reading presets back
 * off disk. A filter that silently drops a title is the worst bug this feature
 * can have, so the part that decides lives where it can be tested without a
 * database, a screen, or a phone.
 *
 * ONE RULE runs through it: an axis with nothing selected filters nothing. OR
 * inside an axis, AND across axes -- "Comedy or Drama, on HBO, rated 4+". Every
 * axis empty therefore returns the library untouched, which is the property the
 * tests lean on hardest.
 */

export type FilterKind = 'show' | 'movie';

export const RUNTIME_BANDS = ['short', 'standard', 'long'] as const;
export type RuntimeBand = (typeof RUNTIME_BANDS)[number];

/**
 * Which length band a title falls in -- the bounds differ by kind because a
 * "long" episode and a "long" film share nothing but the word.
 *
 * SHOWS are banded on the per-episode runtime: 25 min or less is the half-hour
 * comedy slot, 26-45 the standard hour-with-adverts drama, over 45 the prestige
 * hour and anything feature-length.
 *
 * FILMS: under 90 min short, 90-150 standard, over 150 long -- the point where
 * a film stops fitting in an evening.
 *
 * A missing runtime is null, not a guess: it drops out of the axis entirely
 * rather than being filed under a band it may not belong to.
 */
export function runtimeBand(minutes: number | null | undefined, kind: FilterKind): RuntimeBand | null {
  if (minutes == null || !(minutes > 0)) return null;
  if (kind === 'movie') return minutes < 90 ? 'short' : minutes <= 150 ? 'standard' : 'long';
  return minutes <= 25 ? 'short' : minutes <= 45 ? 'standard' : 'long';
}

export const SHOW_PROGRESS = ['watching', 'notStarted', 'upToDate', 'finished', 'stopped'] as const;
export const MOVIE_PROGRESS = ['watched', 'notWatched'] as const;

/**
 * Everything the filters need to know about one title, already resolved.
 *
 * Built once per title by `filter-facts.ts` from the database and the metadata
 * caches; nothing here reaches back out to either, so the matcher is pure and
 * a screen can memoise a whole library of these against a revision counter.
 */
export type TitleFacts = {
  /** tvdbId for a show, name for a film -- whatever the screen keys rows by. */
  key: string;
  progress: string;
  genres: readonly string[];
  network: string | null;
  /** '1990s', from the first-air/release year. */
  decade: string | null;
  runtime: RuntimeBand | null;
  /** Calendar years this title was watched in, 'YYYY'. */
  watchedYears: readonly string[];
  /** The USER'S own rating, 1-5 -- null means they never rated it. */
  stars: number | null;
};

export type FilterSort = 'lastWatched' | 'lastAdded' | 'alpha';

export type FilterSet = {
  sort: FilterSort;
  progress: string[];
  genres: string[];
  networks: string[];
  decades: string[];
  runtimes: RuntimeBand[];
  /** Watched-in-year, 'YYYY'. */
  years: string[];
  /** null = any, 0 = unrated only, 1-5 = rated at least that. */
  rating: number | null;
};

export const DEFAULT_FILTERS: FilterSet = {
  sort: 'lastWatched',
  progress: [],
  genres: [],
  networks: [],
  decades: [],
  runtimes: [],
  years: [],
  rating: null,
};

const FILTER_SORTS: readonly FilterSort[] = ['lastWatched', 'lastAdded', 'alpha'];

/** Every multi-select axis, so nothing has to list them twice. */
export const FILTER_AXES = ['progress', 'genres', 'networks', 'decades', 'runtimes', 'years'] as const;
export type FilterAxis = (typeof FILTER_AXES)[number];

/** Does this title survive the filter set? Empty axes let everything through. */
export function matchesFilters(f: TitleFacts, s: FilterSet): boolean {
  if (s.progress.length > 0 && !s.progress.includes(f.progress)) return false;
  if (s.genres.length > 0 && !f.genres.some((g) => s.genres.includes(g))) return false;
  if (s.networks.length > 0 && (f.network == null || !s.networks.includes(f.network))) return false;
  if (s.decades.length > 0 && (f.decade == null || !s.decades.includes(f.decade))) return false;
  if (s.runtimes.length > 0 && (f.runtime == null || !s.runtimes.includes(f.runtime))) return false;
  if (s.years.length > 0 && !f.watchedYears.some((y) => s.years.includes(y))) return false;
  if (s.rating != null) {
    if (s.rating === 0) return f.stars == null;
    if (f.stars == null || f.stars < s.rating) return false;
  }
  return true;
}

export type FilterOption = { value: string; count: number };
export type FilterOptions = Record<FilterAxis, FilterOption[]> & { ratings: FilterOption[] };

/** A copy of the set with one axis emptied -- the basis of a faceted count. */
function without(s: FilterSet, axis: FilterAxis | 'rating'): FilterSet {
  return axis === 'rating' ? { ...s, rating: null } : { ...s, [axis]: [] };
}

/**
 * The options this library can actually offer, each with the number of titles
 * that picking it would leave.
 *
 * FACETED, not absolute: the count beside "Comedy" is what you get after the
 * OTHER axes are applied, so a count is never a promise the sheet then breaks.
 * The axis being counted is excluded from its own filter, which is why picking
 * a second genre widens the result instead of every count collapsing to zero.
 *
 * Nothing is invented -- an option exists only because a title in this library
 * carries it, so an axis nobody has data for comes back empty and the sheet
 * hides the whole section rather than showing a heading with nothing under it.
 */
export function filterOptions(facts: readonly TitleFacts[], s: FilterSet, kind: FilterKind): FilterOptions {
  const base = (axis: FilterAxis | 'rating'): TitleFacts[] => {
    const rest = without(s, axis);
    return facts.filter((f) => matchesFilters(f, rest));
  };
  const tally = (axis: FilterAxis, values: (f: TitleFacts) => readonly string[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const f of base(axis)) for (const v of values(f)) counts.set(v, (counts.get(v) ?? 0) + 1);
    return counts;
  };
  const byCount = (counts: Map<string, number>): FilterOption[] =>
    [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const inOrder = (counts: Map<string, number>, order: readonly string[]): FilterOption[] =>
    order.filter((v) => (counts.get(v) ?? 0) > 0).map((value) => ({ value, count: counts.get(value) ?? 0 }));
  const newestFirst = (counts: Map<string, number>): FilterOption[] =>
    [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.value.localeCompare(a.value));

  // rating is its own shape: "4+" counts everything rated 4 or 5, so it cannot
  // come out of a per-value tally
  const rated = base('rating');
  const ratings: FilterOption[] = [];
  const unrated = rated.filter((f) => f.stars == null).length;
  if (unrated > 0) ratings.push({ value: 'unrated', count: unrated });
  for (let n = 1; n <= 5; n++) {
    const count = rated.filter((f) => f.stars != null && f.stars >= n).length;
    if (count > 0) ratings.push({ value: String(n), count });
  }

  return {
    progress: inOrder(
      tally('progress', (f) => [f.progress]),
      kind === 'show' ? SHOW_PROGRESS : MOVIE_PROGRESS,
    ),
    genres: byCount(tally('genres', (f) => f.genres)),
    networks: byCount(tally('networks', (f) => (f.network == null ? [] : [f.network]))),
    decades: newestFirst(tally('decades', (f) => (f.decade == null ? [] : [f.decade]))),
    runtimes: inOrder(
      tally('runtimes', (f) => (f.runtime == null ? [] : [f.runtime])),
      RUNTIME_BANDS,
    ),
    years: newestFirst(tally('years', (f) => f.watchedYears)),
    ratings,
  };
}

/** How many axes are narrowing the library -- the number on the Filters pill. */
export function activeFilterCount(s: FilterSet): number {
  return FILTER_AXES.filter((a) => s[a].length > 0).length + (s.rating == null ? 0 : 1);
}

export function isDefaultFilters(s: FilterSet): boolean {
  return activeFilterCount(s) === 0 && s.sort === DEFAULT_FILTERS.sort;
}

export function sameFilters(a: FilterSet, b: FilterSet): boolean {
  const axis = (x: readonly string[]): string => [...x].sort().join(' ');
  return a.sort === b.sort && a.rating === b.rating && FILTER_AXES.every((k) => axis(a[k]) === axis(b[k]));
}

/** Add or remove one value from a multi-select axis. */
export function toggleAxis(s: FilterSet, axis: FilterAxis, value: string): FilterSet {
  const current: readonly string[] = s[axis];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  // the cast is the price of one writer for six same-shaped axes; `runtimes` is
  // the only one narrower than string[], and the sheet only ever hands it
  // values that came out of RUNTIME_BANDS
  return { ...s, [axis]: next } as FilterSet;
}

const stringsOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/**
 * Read a filter set back off disk, or out of a preset written by an older
 * build. Anything unrecognised falls back to the default rather than throwing:
 * a corrupt meta row must not be able to make the library screen unopenable.
 */
export function normaliseFilterSet(value: unknown): FilterSet {
  if (value == null || typeof value !== 'object') return { ...DEFAULT_FILTERS };
  const v = value as Record<string, unknown>;
  const rating =
    typeof v.rating === 'number' && Number.isInteger(v.rating) && v.rating >= 0 && v.rating <= 5 ? v.rating : null;
  return {
    sort: FILTER_SORTS.find((s) => s === v.sort) ?? DEFAULT_FILTERS.sort,
    rating,
    progress: stringsOf(v.progress),
    genres: stringsOf(v.genres),
    networks: stringsOf(v.networks),
    decades: stringsOf(v.decades),
    runtimes: stringsOf(v.runtimes).filter((r): r is RuntimeBand => (RUNTIME_BANDS as readonly string[]).includes(r)),
    years: stringsOf(v.years),
  };
}

/** Parse one stored filter set, JSON and all. */
export function parseFilterSet(raw: string | null | undefined): FilterSet {
  if (!raw) return { ...DEFAULT_FILTERS };
  try {
    return normaliseFilterSet(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

/** A named filter set. `kind` keeps show presets out of the movies sheet. */
export type FilterPreset = { id: string; kind: FilterKind; name: string; filters: FilterSet };

export function parsePresets(raw: string | null | undefined): FilterPreset[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: FilterPreset[] = [];
  for (const item of parsed) {
    if (item == null || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    const id = typeof p.id === 'string' ? p.id : '';
    if (!name || !id) continue; // a nameless preset is unreachable in the UI
    out.push({ id, name, kind: p.kind === 'movie' ? 'movie' : 'show', filters: normaliseFilterSet(p.filters) });
  }
  return out;
}

export function serialisePresets(list: readonly FilterPreset[]): string {
  return JSON.stringify(list);
}

/** Insert or replace by id -- so saving and renaming are the same call. */
export function upsertPreset(list: readonly FilterPreset[], preset: FilterPreset): FilterPreset[] {
  const at = list.findIndex((p) => p.id === preset.id);
  if (at < 0) return [...list, preset];
  const out = [...list];
  out[at] = preset;
  return out;
}

// ── an actor's page ──────────────────────────────────────────────────────────

/**
 * ONE BIOGRAPHY OUT OF SEVERAL LANGUAGES.
 *
 * TheTVDB returns `biographies` as an array with a `language` on each, and
 * neither English nor any particular order is guaranteed. Preferring the
 * reader's own language is the point -- the app ships in six -- with English as
 * the fallback and then simply the first one that has text, because a biography
 * in a language you do not read still beats a blank section.
 *
 * TheTVDB's language codes are three letters (`eng`, `ara`, `spa`), so a match
 * is on the first two of ours: `pt-BR` finds `por`.
 */
const BIO_LANG: Record<string, string> = {
  en: 'eng',
  ar: 'ara',
  fr: 'fra',
  it: 'ita',
  es: 'spa',
  pt: 'por',
};

export function pickBiography(
  list: readonly { biography?: string | null; language?: string | null }[],
  locale = 'en',
): string | null {
  const withText = list.filter((b) => (b.biography ?? '').trim().length > 0);
  if (withText.length === 0) return null;
  const want = BIO_LANG[locale.slice(0, 2).toLowerCase()];
  const mine = want ? withText.find((b) => b.language === want) : undefined;
  const english = withText.find((b) => b.language === 'eng');
  return ((mine ?? english ?? withText[0])!.biography ?? '').trim();
}

/**
 * "1961 – 2014", "born 1961", or nothing.
 *
 * Years only. A full date is a fact about a living person that this screen does
 * not need, and the year is what places them.
 */
export function personLife(p: { birth?: string | null; death?: string | null }): string | null {
  const born = (p.birth ?? '').slice(0, 4);
  const died = (p.death ?? '').slice(0, 4);
  if (born && died) return `${born} – ${died}`;
  if (born) return born;
  // A death year with no birth year is not "– 2014", which reads as an error.
  if (died) return died;
  return null;
}

export type PersonCredit = {
  kind: 'series' | 'movie';
  id: number;
  name: string;
  role: string | null;
  image: string | null;
  year: string | null;
};

type RawCredit = {
  name?: string | null;
  seriesId?: number | null;
  movieId?: number | null;
  series?: { id?: number; name?: string | null; image?: string | null; year?: string | null } | null;
  movie?: { id?: number; name?: string | null; image?: string | null; year?: string | null } | null;
};

/**
 * The credits list, as rows worth drawing.
 *
 * THE SAME TITLE APPEARS ONCE. An actor with four roles across a long-running
 * series has four character records, and printing the series four times reads
 * as a bug rather than as thoroughness. The first is kept, which is TheTVDB's
 * own order -- featured roles first.
 *
 * Rows with no title are dropped rather than rendered blank: a credit whose
 * series record did not come back says nothing and cannot be opened.
 *
 * Newest first, and anything undated last -- an actor's page opens on what they
 * are in now, not on their first job.
 */
export function personCredits(list: readonly RawCredit[]): PersonCredit[] {
  const out: PersonCredit[] = [];
  const seen = new Set<string>();
  for (const c of list) {
    const isSeries = c.series != null || (c.seriesId ?? 0) > 0;
    const rec = isSeries ? c.series : c.movie;
    const id = Number(isSeries ? (c.seriesId ?? rec?.id) : (c.movieId ?? rec?.id));
    const name = (rec?.name ?? '').trim();
    if (!name || !(id > 0)) continue;
    const key = `${isSeries ? 's' : 'm'}${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: isSeries ? 'series' : 'movie',
      id,
      name,
      role: (c.name ?? '').trim() || null,
      image: rec?.image ?? null,
      year: (rec?.year ?? '').slice(0, 4) || null,
    });
  }
  return out.sort((a, b) => (b.year ?? '0').localeCompare(a.year ?? '0'));
}

// ── where to watch ───────────────────────────────────────────────────────────

/** Meta key for the region streaming availability is asked about. */
export const WATCH_REGION_KEY = 'watchRegion';

/**
 * THE REGION WAS HARDCODED TO THE UNITED STATES.
 *
 *   providers: d['watch/providers']?.results?.US?.flatrate
 *
 * So everybody, everywhere, was told their show is on fuboTV and Peacock.
 * Reported from Discord as "the streaming information isn't up to date", which
 * was the right observation and the wrong diagnosis: the data is current, it is
 * simply about America. (And the suggested fix -- switch to JustWatch -- would
 * change nothing: TMDB's provider data IS JustWatch, licensed.)
 *
 * A two-letter ISO country code, upper-cased. Anything else is refused rather
 * than passed to TMDB, which would answer a query about "results.undefined"
 * with silence and look exactly like a title nobody streams.
 */
export function validWatchRegion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

/**
 * The region to ask about, from the device's own locales.
 *
 * FROM THE PHONE, NOT FROM A DEFAULT. Somebody in Iraq should see Iraqi
 * availability the first time they open a show, without finding a setting
 * first -- a setting is the fix for when we guess wrong, not the way in.
 *
 * Falls back to US only when the phone offers no region at all, which is rare
 * and is the same answer the app gave everybody until now.
 */
export function deviceWatchRegion(locales: readonly { regionCode?: string | null }[]): string {
  for (const l of locales) {
    const code = validWatchRegion(l.regionCode);
    if (code) return code;
  }
  return 'US';
}

/** One way to watch, and what kind of way it is. */
export type WatchKind = 'flatrate' | 'free' | 'ads' | 'rent' | 'buy';

export type WatchOption = { name: string; logo: string | null; kind: WatchKind };

/**
 * TMDB's per-region block, flattened into one ordered list.
 *
 * ONLY `flatrate` WAS READ BEFORE, so a film you can rent, buy, or watch free
 * with adverts read as "not available to stream" -- which is a different and
 * much more discouraging sentence than the truth.
 *
 * Ordered by what a reader wants first: included with a subscription, then
 * free, then advertising-supported, then paying per title. Deduplicated by
 * provider, keeping the best kind, because Prime Video appearing three times
 * for one film is noise.
 */
const KIND_ORDER: readonly WatchKind[] = ['flatrate', 'free', 'ads', 'rent', 'buy'];

export function watchOptions(
  block: Partial<Record<WatchKind, { provider_name?: string; logo_path?: string | null }[]>> | null | undefined,
): WatchOption[] {
  if (!block) return [];
  const best = new Map<string, WatchOption>();
  for (const kind of KIND_ORDER) {
    for (const p of block[kind] ?? []) {
      const name = (p.provider_name ?? '').trim();
      if (!name || best.has(name)) continue;
      best.set(name, { name, logo: p.logo_path ?? null, kind });
    }
  }
  return [...best.values()];
}

/**
 * One calendar month as rows of seven, for picking a watch date.
 *
 * WHY A CALENDAR AND NOT JUST THE LAST SEVEN DAYS. The seven-day list this
 * replaces was built for "I forgot to log it yesterday", and that turned out to
 * be the smaller half of the problem. The real case: somebody stops opening the
 * app for three weeks, comes back, and marks twenty episodes — all twenty then
 * say TODAY. That does not merely fail to help, it actively damages the archive
 * this app exists to protect, and no relative list can reach three weeks back
 * without becoming a list of thirty rows nobody can read.
 *
 * `null` pads the leading and trailing week so every row has seven cells and
 * the columns line up under their weekday headers.
 *
 * LOCAL DATES, NOT UTC. `monthsGrid` next door is UTC because a heatmap only
 * has to be internally consistent. This one is compared against the user's own
 * today — offering somebody a "tomorrow" they cannot have watched, or hiding
 * the day they are standing in, are both worse than a wrong-looking grid.
 */
export function calendarMonth(month: string): (string | null)[][] {
  const [y, m] = month.split('-').map(Number);
  // The RANGE matters, not just the presence: `daysInMonth('2026-13')` rolls
  // over into January 2027 and cheerfully answers 31, so an out-of-range month
  // would render as a real one. Refuse it here rather than draw a phantom.
  if (!y || !m || m < 1 || m > 12) return [];
  const total = daysInMonth(month);
  if (!total) return [];

  const lead = new Date(y, m - 1, 1).getDay(); // 0 = Sunday, in local time
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= total; d++) {
    cells.push(`${month}-${String(d).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * The last seven days, newest first, for correcting a watch date.
 *
 * NO DATE PICKER, DELIBERATELY. A native picker is a new dependency and a
 * rebuild, and it answers a question nobody asked: the reported case is "I
 * watched three on Friday and opened the app on Sunday", which is two taps
 * away in relative terms and four screens away in a calendar.
 *
 * Seven days because that is the span a person can still remember accurately.
 * Past a week 'was it Tuesday or Wednesday' is a guess, and an invented date is
 * worse than a late one — the whole point of this app is that the dates are
 * true.
 *
 * `today` is injected rather than read from the clock so this is testable, and
 * so a caller in a different timezone gets its own day rather than UTC's.
 */
export function recentDayOptions(
  today: Date,
): { day: string; offset: number }[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const d = new Date(today);
    d.setDate(d.getDate() - offset);
    // Local components, never toISOString(): that converts to UTC first, so
    // anybody east of Greenwich after 21:00 would be offered tomorrow, and
    // anybody west of it before 03:00 would lose today entirely.
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { day, offset };
  });
}

/**
 * "On this day" — a memory from the same date in the user's own history.
 *
 * WHY THIS AND NOT A NOTIFICATION THAT SAYS "OPEN THE APP". A tracker is opened
 * to mark an episode and then has no reason to be opened again until the next
 * one: it reacts, it is never a habit. This is the one thing in the app that
 * gives somebody a reason to look on a day they watched nothing — and it is
 * built from the archive the import rescued, which is the one asset no
 * competitor has. Trakt and Letterboxd do not hold anybody's TV Time past.
 *
 * ONE MEMORY, NOT A FEED. A list of everything that ever happened on 18 August
 * is a report; a single line about the night somebody finished Dark is a
 * memory. Ranking is the entire feature, so it lives here where it can be
 * tested rather than in a query.
 *
 * MOST DAYS HOLD NOTHING, AND THAT IS THE POINT. Returning null is the common
 * answer and the caller must be built for it — a card that is usually absent
 * and a notification that usually does not fire. A daily memory is six weak
 * ones for every good one, and the six are what get it switched off.
 */
export type MemoryEvent =
  | { kind: 'finale'; year: number; showId: number; show: string }
  | { kind: 'binge'; year: number; showId: number; show: string; count: number }
  /*
   * NO `showId`, deliberately. `comments.entity` is a display string — a film
   * name, or "Dark S1E5" — and the only way to turn it into a show id is to
   * match on the name, which is precisely the bug that made search offer
   * "ADD SHOW" for shows already tracked. A memory does not need the id: it
   * opens the comments archive, which is keyed by the same string.
   */
  | { kind: 'comment'; year: number; show: string; text: string }
  | { kind: 'episode'; year: number; showId: number; show: string; season: number; episode: number };

/**
 * Strongest first. The order is about what somebody would want to be told, not
 * about what is rare:
 *
 *   finale   — an ending is the thing people remember about a show
 *   comment  — their own words, years later, is the most personal thing here
 *   binge    — "seven episodes in one day. It was a Friday" is a self-portrait
 *   episode  — one episode is a log entry, and only ever earns the CARD
 *
 * A plain episode is deliberately last and deliberately never notified: "a year
 * ago you watched an episode" is the weak sentence that would train somebody to
 * ignore the good ones.
 */
const MEMORY_RANK: Record<MemoryEvent['kind'], number> = { finale: 0, comment: 1, binge: 2, episode: 3 };

export function pickMemory(events: readonly MemoryEvent[]): MemoryEvent | null {
  let best: MemoryEvent | null = null;
  for (const e of events) {
    if (best == null) {
      best = e;
      continue;
    }
    const better = MEMORY_RANK[e.kind] - MEMORY_RANK[best.kind];
    // OLDEST WINS A TIE. "Four years ago" is a stronger sentence than "last
    // year" for the same event, and the older one is the one they are less
    // likely to have thought about recently.
    if (better < 0 || (better === 0 && e.year < best.year)) best = e;
  }
  return best;
}

/**
 * Whether a memory is worth a push notification, as opposed to a card sitting
 * on a screen somebody already opened.
 *
 * The bar is higher for a notification because it interrupts. A card costs
 * nothing to ignore; a notification that does not earn its place gets the whole
 * feature muted, and there is no way back from that.
 */
export function memoryDeservesNotification(m: MemoryEvent | null): boolean {
  return m != null && m.kind !== 'episode';
}

/** The hour a memory is worth sending. People decide what to watch at night. */
export const MEMORY_HOUR = 21;

/**
 * When today's memory should be delivered, or null if it should not be.
 *
 * FOUR REASONS TO SAY NO, and every one of them is what keeps this feature
 * switched on rather than muted:
 *
 *   - there is no memory (most days)
 *   - it is only a single episode — "a year ago you watched an episode" is the
 *     weak sentence that teaches somebody to ignore the good ones
 *   - the evening has already passed; a memory is not worth a notification at
 *     half past midnight, and there is always tomorrow
 *   - it has already been sent today, because the app syncs on every launch and
 *     three launches must not mean three notifications
 */
export function memoryNotificationAt(m: MemoryEvent | null, now: Date, lastSentDay: string | null): number | null {
  if (!memoryDeservesNotification(m)) return null;
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (lastSentDay === day) return null;
  const at = new Date(now);
  at.setHours(MEMORY_HOUR, 0, 0, 0);
  return at.getTime() > now.getTime() ? at.getTime() : null;
}

/**
 * The emotion calendar — a year read backwards.
 *
 * The app has asked "how did this episode make you feel?" since 1.0 and stores
 * the answer against twelve values. There are 57,287 of those votes and no
 * screen has ever read one of them: ratings appear everywhere, feelings
 * appear nowhere. Joining `watches` (when) to `episode_emotions` (what it felt
 * like) turns them into the answer to a question nobody has asked the app —
 * *what was my year like?*
 *
 * NOBODY ELSE CAN BUILD THIS, and not because it is hard. They do not have the
 * data. TV Time collected it and took it down; this app imported it.
 */

/**
 * The one feeling a day is shown as, out of everything felt on it.
 *
 * MOST WATCHED WINS, and a tie goes to the EARLIER emotion in the contract
 * order — which is arbitrary but must be stable, because a day that changes
 * colour between two launches looks like a bug in the archive rather than a
 * coin toss over two feelings with one vote each.
 *
 * Days with watches but no feeling recorded return null, and the caller shades
 * them the ordinary way: "nothing was watched" and "something was watched and
 * never voted on" are different facts, and most days in a nine-year archive are
 * the second.
 */
export function dominantEmotion(counts: ReadonlyMap<number, number>): number | null {
  let best: number | null = null;
  let bestN = 0;
  for (const [emotion, n] of counts) {
    if (n > bestN || (n === bestN && best !== null && emotion < best)) {
      best = emotion;
      bestN = n;
    }
  }
  return best;
}

/**
 * A colour per feeling.
 *
 * TWELVE HUES, AND THE BRAND KEEPS ITS MEANING. The palette rule is that yellow
 * ACTS and green CONFIRMS, so neither may be spent here on "amused" or
 * "understood" — a grid of controls-coloured squares would say the app wants
 * something from the reader. These are data, so they are their own set: warm
 * for the feelings people call good, cold for the heavy ones, grey for bored,
 * which is the only honest colour for it.
 *
 * Indexed by the SAME contract order as EMOTION_NAMES. Reorder that array and
 * every colour moves with it, which is the correct failure — the alternative is
 * a lookup by name that silently keeps the old colour on a renamed feeling.
 */
export const EMOTION_COLORS: readonly string[] = [
  '#E5484D', // shocked      — the jolt
  '#A8353A', // frustrated   — anger: the same family as shocked, darker, so the
              //                 two nearest feelings are still two colours
  '#3E63DD', // sad
  '#8E7CC3', // reflective
  '#D6409F', // touched
  '#F5A623', // amused
  '#7C3AED', // scared
  '#6B6B72', // bored        — the app's own faint grey, and it means it
  '#30A46C', // understood
  '#00B5D8', // thrilled
  '#B08968', // confused
  '#E93D82', // tense
];

export function emotionColor(index: number): string {
  return EMOTION_COLORS[index] ?? '#6B6B72';
}

/**
 * A library that kept its opinions and lost its history.
 *
 * FOUND ON A REAL ACCOUNT, one week after the community opened. A user signed
 * in with Google, and the server received 428 ratings and 35 comments and not
 * one shelf. Their public profile was a shell: no shows, no films, no stats,
 * and nothing anywhere saying why.
 *
 * The two halves travel by different roads, which is how they can disagree.
 * Comments and ratings need only an IMPORTED library; shelves and stats are
 * refused by `publishProfile` unless something has actually been watched —
 * a guard that exists because a reinstalled phone publishing its empty library
 * would delete somebody's entire profile, and that nearly happened.
 *
 * So the guard was right and the silence was the bug. A phone holding hundreds
 * of ratings and zero watches KNOWS its import went wrong: comments and ratings
 * are keyed by title text and land whatever happens, while every watch row
 * needs an episode the matcher could resolve. That is the exact failure the
 * third-party browser-extension export produces.
 *
 * NOT FOR A NEW USER. An empty library with no ratings and no comments is
 * somebody who has not started, and telling them their import failed would be
 * a lie about an import they never ran. The evidence has to be present for the
 * absence to mean anything.
 */
export function importLostHistory(x: {
  owner: 'seed' | 'imported' | 'fresh';
  episodes: number;
  moviesWatched: number;
  ratings: number;
  comments: number;
}): boolean {
  // A demo library is nobody's history, and a fresh one never had an import to
  // lose — its stars were tapped by hand.
  if (x.owner !== 'imported') return false;
  if (x.episodes > 0 || x.moviesWatched > 0) return false;
  return x.ratings + x.comments > 0;
}

/**
 * What an import actually did, so that "it imported nothing" can be answered.
 *
 * WRITTEN AFTER AN ACCOUNT NOBODY COULD DIAGNOSE. A real user's export produced
 * 428 ratings, 35 comments and zero watched episodes, and the app reported
 * success. Nothing on the phone or the server could say which file had failed,
 * so the only way to find out was to ask them for their entire viewing history
 * — which is the one thing this project should never have to ask for.
 *
 * COUNTS, NOT CONTENT. Rows in, rows accepted, per source. No titles, no dates,
 * nothing about what anybody watched. Enough to name the failure and not enough
 * to describe the person.
 */
export type ImportDiagnosis = {
  /** Rows in the current tracking file that claim to be episode watches. */
  episodeRows: number;
  /** How many of those survived needing a show id, a season and an episode. */
  episodesAccepted: number;
  showRows: number;
  ratingRows: number;
  commentRows: number;
};

export type ImportVerdict = 'ok' | 'no_episode_file' | 'episodes_all_rejected' | 'empty';

/**
 * The three failures are worth telling apart, because they have different
 * causes and different fixes:
 *
 *   no_episode_file      — the export had ratings or comments but no episode
 *                          rows at all. The file is missing, empty, or named
 *                          something this build does not look for.
 *   episodes_all_rejected — the rows were THERE and every one was filtered out.
 *                          That is a column-name problem, and the loudest
 *                          possible signal that the importer, not the export,
 *                          is at fault. `s_id` in the v2 file and `series_id`
 *                          in the v1 one are the same thing under two names,
 *                          which is exactly how this happens.
 *   empty                 — nothing anywhere. Not a failure; an empty account.
 */
export function importVerdict(d: ImportDiagnosis): ImportVerdict {
  if (d.episodesAccepted > 0) return 'ok';
  const hasOtherData = d.ratingRows + d.commentRows + d.showRows > 0;
  if (d.episodeRows > 0) return 'episodes_all_rejected';
  return hasOtherData ? 'no_episode_file' : 'empty';
}

/**
 * Whether a URL is safe for `Linking.openURL`, which opens whatever it is
 * given.
 *
 * MIRRORED FROM `backend/src/pure.ts`, and checked on BOTH sides on purpose.
 * The server refuses to serve a bad row and the app refuses to open one, so a
 * link is only followed if two independent pieces of code agree — which is the
 * right shape for the one value in this app that arrives from a server and is
 * then handed to the operating system.
 *
 * https only. A `javascript:` URL, an `intent://` on Android, or another app's
 * custom scheme are all things `openURL` will happily act on. Whitespace
 * anywhere is a refusal rather than something to strip: it is how a scheme gets
 * past a naive prefix check, and a URL with a space in it was mistyped anyway.
 */
export function isSafeLinkUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  if (url.length === 0 || url.length > 300) return false;
  if (/\s/.test(url)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(url)) return false;
  return /^https:\/\/[^/]+\./i.test(url);
}

/**
 * The links a person can put on their profile.
 *
 * A KNOWN LIST, NOT A FREE URL BOX, with one free "website" slot.
 *
 * This is the first place in the app where a user can put a destination that
 * reaches OTHER people — it publishes with the profile and strangers tap it.
 * An open text field on a public profile is what turns a tracker into a place
 * people advertise from, and it is the first thing abuse finds. A fixed list of
 * services means the app knows the icon, knows the shape, and can refuse
 * anything else.
 *
 * The website slot stays because somebody with a blog is not an abuser, and
 * `isSafeLinkUrl` already refuses everything that is not plain https.
 */
export const LINK_SERVICES = [
  'instagram',
  'tiktok',
  'x',
  'youtube',
  'reddit',
  'discord',
  'letterboxd',
  'website',
] as const;
export type LinkService = (typeof LINK_SERVICES)[number];

export function isLinkService(v: unknown): v is LinkService {
  return typeof v === 'string' && (LINK_SERVICES as readonly string[]).includes(v);
}

export type ProfileLink = { service: LinkService; url: string };

/**
 * HOW MANY FIT, and the number is about legibility rather than arithmetic.
 *
 * An icon under about 44 points is one nobody taps with confidence, so the
 * limit is what stays that size at each width — not what could be squeezed in.
 * Sixteen on a phone would be thirty-point targets and a wall of links, which
 * is a different kind of page from a profile.
 *
 * Eight covers everything a person actually has. Somebody who needs more is
 * not showing who they are, they are distributing, and that is not this.
 */
export function linkCapacity(span: string): number {
  return span === '2x2' ? 8 : 4;
}

/**
 * Read the widget's stored links.
 *
 * TOLERANT ON THE WAY IN, STRICT ON THE WAY OUT. This runs on a VISITOR's phone
 * against JSON that travelled from somebody else's device, so it treats every
 * field as hostile: an unknown service, a missing url, a `javascript:` url or a
 * newer app's extra key all drop out rather than throwing and taking the whole
 * profile with them.
 */
export function parseProfileLinks(raw: string | undefined, span: string): ProfileLink[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is ProfileLink => {
        const x = r as Partial<ProfileLink>;
        return isLinkService(x?.service) && isSafeLinkUrl(x.url);
      })
      .map((r) => ({ service: r.service, url: r.url }))
      .slice(0, linkCapacity(span));
  } catch {
    return [];
  }
}

export function serialiseProfileLinks(links: readonly ProfileLink[]): string {
  return JSON.stringify(links.map((l) => ({ service: l.service, url: l.url })));
}

/**
 * The invite code inside whatever a person pasted.
 *
 * THE APP'S OWN SHARE MESSAGE IS THE COMMONEST PASTE, and it is a whole
 * sentence: `Join my shared list "Bakeoff" on OpenTV. Code: NRVG58Y2JS`. Asking
 * somebody to receive that message, then delete every word of it but ten
 * characters, is asking them to clean up after us — and the first person to try
 * it pasted the sentence, which is the obviously right thing to do.
 *
 * The code alphabet is what makes this safe to do by pattern: ten characters
 * with no 0/O and no 1/I/L, chosen so codes survive being read aloud. That
 * excludes ordinary words — "OPENTV" is six, and any ten-letter word would have
 * to dodge O, I and L to be mistaken for one. So: every ten-character run drawn
 * from that alphabet, and the LAST one wins, because the code comes last in the
 * message in all six languages and a list called something like "MARATHON2026"
 * should not outrank it.
 *
 * Nothing matching means hand back what they typed, trimmed and uppercased —
 * a typed code that is nine characters is the server's business to refuse, with
 * a message about that code, not a silent empty field.
 */
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function inviteCodeFrom(pasted: string): string {
  const text = pasted.trim().toUpperCase();
  const runs = text.match(new RegExp(`[${INVITE_ALPHABET}]{10}`, 'g')) ?? [];
  const boundaried = runs.filter((r) => {
    const at = text.lastIndexOf(r);
    const before = text[at - 1] ?? ' ';
    const after = text[at + r.length] ?? ' ';
    // a run inside a longer word is part of that word, not a code
    return !/[A-Z0-9]/.test(before) && !/[A-Z0-9]/.test(after);
  });
  return boundaried[boundaried.length - 1] ?? text;
}

/**
 * WHERE THE "not on your profile" LINE ACTUALLY BELONGS.
 *
 * The line was drawn at row `cap` — row ten — which is only right when every
 * list is eligible to be published. Hidden lists are not: `publishableLists`
 * filters them out BEFORE applying the cap, so a hidden list costs nothing and
 * the tenth PUBLISHED list can sit at row twelve.
 *
 * With three hidden lists near the top, rows eleven and twelve were drawn below
 * a line saying they would not reach the profile, and they would. The line
 * looks authoritative, which makes it worse than no line at all — the same
 * reason it is hidden entirely when the sort is not the user's own order.
 *
 * So: count only what can be published, and return the index in the DISPLAYED
 * array just past the last one that fits. Null when nothing is cut, which is
 * also the answer when hidden lists bring the eligible count under the cap.
 */
export function publicCutIndex(
  lists: readonly { hidden?: boolean }[],
  cap: number,
): number | null {
  let eligible = 0;
  for (let i = 0; i < lists.length; i++) {
    if (lists[i].hidden === true) continue;
    eligible++;
    if (eligible === cap) {
      // Everything after this row is cut — unless nothing publishable follows,
      // in which case there is nothing to warn about.
      const more = lists.slice(i + 1).some((l) => l.hidden !== true);
      return more ? i + 1 : null;
    }
  }
  return null;
}

/* ── Trakt sync: what may be applied ────────────────────────────────────────
 *
 * The decision, kept away from the network and the database so it can be
 * tested without either. Everything risky about a scrobbler lives here: which
 * rows to trust, which to refuse, and how not to tick the same episode twice.
 */

export type TraktWatchRow = { tvdbId: number; season: number; episode: number; watchedAt: string };

/**
 * The key both sides of the sync compare on.
 *
 * ONE BUILDER, because the two sides nearly shipped with different ones. The
 * decision below composed `tvdbId:season:episode` while the caller built its
 * "already watched" set from `getWatchedSet`, which returns `season-episode`
 * with a DASH — so the lookup never matched, every episode looked new, and
 * every sync would have re-marked the entire history. Silently: the totals just
 * climb.
 *
 * A format two places have to agree on is a format they will eventually
 * disagree on. This is the format.
 */
export function traktWatchKey(tvdbId: number, season: number, episode: number): string {
  return `${tvdbId}:${season}:${episode}`;
}

/**
 * Which of Trakt's rows should actually be written.
 *
 * FOUR REFUSALS, each for a reason worth stating:
 *
 * NOT IN THE LIBRARY. Trakt knows every show somebody ever ticked, including
 * ones they abandoned years ago on another service. Adding them here would let
 * a sync invent a library, and the user asked to import their WATCHES, not to
 * be given shows. A show they track is a show they chose.
 *
 * ALREADY WATCHED. The whole failure mode of a scrobbler is the second run
 * marking everything again — duplicate rows inflate every total the app is
 * built to report, and nothing about the display would look wrong. Keyed on
 * (show, season, episode), which is what a watch IS here.
 *
 * SEASON 0. Specials number differently on every service, and Trakt's season 0
 * ordering does not reliably match TheTVDB's. A wrong tick on a special is
 * still a wrong tick; skipping them is the honest gap.
 *
 * SAME EPISODE TWICE IN ONE BATCH. Trakt returns a row per REWATCH, so a show
 * watched three times yields three identical rows. The first is kept — the
 * others are rewatches, which this app records separately and must not receive
 * as fresh watches.
 */
export function traktRowsToApply(
  rows: readonly TraktWatchRow[],
  library: {
    /** TheTVDB ids of shows the user actually tracks. */
    tracked: ReadonlySet<number>;
    /** `${showId}:${season}:${episode}` for every watch already recorded. */
    watched: ReadonlySet<string>;
  },
): TraktWatchRow[] {
  const out: TraktWatchRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.season === 0) continue;
    if (!library.tracked.has(r.tvdbId)) continue;
    const key = traktWatchKey(r.tvdbId, r.season, r.episode);
    if (library.watched.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * The new watermark after a sync, or the old one if nothing arrived.
 *
 * THE NEWEST `watched_at` THAT WAS ACTUALLY SEEN, never "now". A clock that ran
 * ahead of Trakt's — or a page that failed halfway — would otherwise move the
 * mark past rows that were never read, and those episodes would be invisible
 * for ever without a full resync nothing offers.
 *
 * It only ever moves FORWARD. A row older than the mark (Trakt backfilling an
 * old watch) is applied without dragging the watermark backwards, which would
 * re-read everything since on the next run.
 */
export function nextTraktWatermark(rows: readonly TraktWatchRow[], previous: string | null): string | null {
  let best = previous;
  for (const r of rows) {
    if (!r.watchedAt) continue;
    if (best == null || r.watchedAt > best) best = r.watchedAt;
  }
  return best;
}

/**
 * Whether a failed lookup for the preserved TV Time export is worth another go.
 *
 * `null` from the lookup means "not available right now", and the startup
 * repair treats that as "retry on the next launch" — which is only honest if a
 * later launch could answer differently. A device with no local copy and iCloud
 * switched off answers the same way every time it is ever started, so the
 * repair never stamps its revision and the progress overlay becomes permanent
 * furniture. Three attempts, because one offline launch is ordinary and giving
 * up immediately would lose a repair a working connection would have done.
 *
 * Returns the verdict to use and the miss count to store. A success clears the
 * count so a later outage gets the full budget rather than the remains of an
 * old one.
 */
export function zipLookupVerdict(
  found: 'ok' | 'absent' | 'unavailable',
  storedMisses: number,
  giveUpAfter = 3,
): { verdict: 'ok' | 'none' | 'retry'; misses: number } {
  if (found === 'ok') return { verdict: 'ok', misses: 0 };
  if (found === 'absent') return { verdict: 'none', misses: 0 };
  const misses = storedMisses + 1;
  return { verdict: misses >= giveUpAfter ? 'none' : 'retry', misses };
}

/**
 * "What interests you most about this show?" — where the answer is filed, and
 * how a stored value becomes an answer again.
 *
 * IT WAS NEVER SAVED AT ALL. The poll wrote React state and nothing else, so a
 * choice lasted exactly as long as the screen did. Reported from the outside
 * before it was noticed from the inside, which is what an unsaved control looks
 * like: nothing on screen is wrong, the tap simply means nothing.
 *
 * Films are keyed by NAME and shows by TheTVDB id, because that is how the rest
 * of this app keys each. The kind is in the key so a film called "42" and show
 * 42 cannot read each other's answer.
 */
export function interestKey(kind: 'show' | 'movie', id: string | number): string {
  return `interest:${kind}:${id}`;
}

/**
 * `''` is how a cleared answer is stored, and `Number('')` is 0 — which is a
 * real option ("the cast"). So emptiness is rejected before anything is parsed,
 * or unpicking an answer would silently pick the first one.
 */
export function parseInterest(stored: string | null): number | null {
  if (!stored) return null;
  const n = Number(stored);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
