/**
 * Bringing a library over from a tracker that is still alive.
 *
 * WHY THIS EXISTS, and it is not the same reason as the TV Time importer. That
 * one reaches people whose app DIED, which is a finite pool that empties. These
 * reach people whose app is alive and annoying them — millions of them, right
 * now, asking about alternatives in their own communities every week. The
 * bottleneck on this project has never been features; it is that not enough
 * people have heard of it.
 *
 * NOTHING HERE TOUCHES THE DATABASE. Each function maps a foreign export into
 * the three row shapes `importer.ts` already speaks — the GDPR shapes — and the
 * whole merge-safe, self-repairing, idempotent pipeline behind them runs
 * unchanged. That is deliberate and it is the entire design: a second source
 * must not be a second importer, or "re-importing is always safe" becomes a
 * promise that holds for one of them.
 *
 * The same trick the third-party TV Time browser extension already gets — see
 * the `communityCsv` fallback in `importer.ts` — generalised to sources that
 * were never TV Time at all.
 *
 * PURE, so every mapping is tested under plain Node against real export
 * headers rather than discovered on a user's phone.
 */

import { starsFromTen } from '@/pure';

/** The GDPR-shaped rows the importer consumes. Strings throughout, as CSV. */
export type ForeignRows = {
  /** `user_tv_show_data.csv` shape — one per tracked show. */
  showRows: Record<string, string>[];
  /** `tracking-prod-records-v2.csv` shape — one per episode watch. */
  episodeRows: Record<string, string>[];
  /** `tracking-prod-records.csv` shape — watches, rewatches and watchlist. */
  movieRows: Record<string, string>[];
  /** Film ratings, already on the app's 1–5 star scale. */
  movieRatings: { name: string; stars: number }[];
  /**
   * Episode scores on the app's 1–5 scale, keyed by show NAME because that is
   * how the GDPR votes file arrives and how the importer places them. Only
   * Serializd rates episodes at all; the other sources leave this out.
   */
  episodeRatings?: { name: string; season: number; episode: number; stars: number }[];
  /** Reviews as rows of the comments table: `entity` is "Show" or "Show S1E2". Serializd only. */
  comments?: { entity: string; text: string; date: string }[];
};

export const NO_ROWS: ForeignRows = { showRows: [], episodeRows: [], movieRows: [], movieRatings: [] };

/** A day, as the importer's `created_at` wants it. Letterboxd gives 'YYYY-MM-DD'. */
function stamp(day: string | undefined): string {
  const d = (day ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d} 12:00:00` : d;
}

/**
 * LETTERBOXD — a plain CSV export, and the cheapest of the three by a distance:
 * no OAuth, no API key, no rate limit, no application to register. The user
 * downloads a ZIP from their settings and hands it over.
 *
 * FILMS ONLY, which is the honest limit and has to be said out loud before
 * somebody imports and finds half an app. Letterboxd does not track television,
 * so a person arriving this way brings their films and none of their shows.
 *
 * FOUR FILES, and `diary.csv` is the valuable one: `watched.csv` knows only
 * THAT you saw something, while the diary knows WHEN — including rewatches as
 * separate dated entries. A tracker whose whole argument is that it remembers
 * the day should prefer the file with the days in it.
 */
export function letterboxdRows(files: Record<string, Record<string, string>[]>): ForeignRows {
  const rows: ForeignRows = { showRows: [], episodeRows: [], movieRows: [], movieRatings: [] };

  /*
   * ALREADY PARSED BY `parseCsv`, deliberately. A second CSV parser here would
   * be a second thing to get quoting wrong, and film titles are full of commas
   * — "The Good, the Bad and the Ugly" splits into three columns under any
   * parser that merely cuts on commas. Headers are lowercased because
   * Letterboxd writes "Watched Date" and this reads it as one key.
   */
  const table = (name: string): Record<string, string>[] => {
    const key = Object.keys(files).find((k) => k.toLowerCase().endsWith(`${name}.csv`));
    if (!key) return [];
    return files[key].map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase(), (v ?? '').trim()])),
    );
  };

  /*
   * THE DIARY FIRST, THEN WATCHED for anything the diary never mentioned.
   *
   * Somebody who logged films for years has both: the diary carries the dates
   * and the rewatches, and `watched.csv` carries everything they ever ticked
   * including the ones they added before they kept a diary. Taking the diary
   * first means a film seen three times arrives with three dates rather than
   * one, and taking watched.csv afterwards means nothing is dropped.
   */
  const seen = new Set<string>();
  const keyOf = (name: string, year: string) => `${name.toLowerCase()}|${year}`;

  for (const r of table('diary')) {
    const name = r.name;
    if (!name) continue;
    // ONLY A FIRST WATCH COUNTS AS SEEN (8 Oct). A film whose diary holds
    // nothing but a rewatch was marked seen here, so its watched.csv row was
    // skipped — and a rewatch with no watch under it imported as nothing: the
    // film was simply missing from the library.
    if (r.rewatch !== 'Yes') seen.add(keyOf(name, r.year ?? ''));
    rows.movieRows.push({
      // A REWATCH IS ITS OWN ROW TYPE, exactly as the GDPR export models it, so
      // the film keeps one watch and a rewatch count rather than appearing
      // three times in the library.
      type: r.rewatch === 'Yes' ? 'rewatch' : 'watch',
      entity_type: 'movie',
      movie_name: name,
      movie_year: r.year ?? '',
      // 'Watched Date' is when they say they saw it; 'Date' is when they logged
      // it. The first is the truth the archive is for.
      created_at: stamp(r['watched date'] || r.date),
    });
  }

  for (const r of table('watched')) {
    const name = r.name;
    if (!name || seen.has(keyOf(name, r.year ?? ''))) continue;
    seen.add(keyOf(name, r.year ?? ''));
    rows.movieRows.push({
      type: 'watch',
      entity_type: 'movie',
      movie_name: name,
      movie_year: r.year ?? '',
      created_at: stamp(r.date),
    });
  }

  for (const r of table('watchlist')) {
    if (!r.name) continue;
    rows.movieRows.push({
      type: 'towatch',
      entity_type: 'movie',
      movie_name: r.name,
      movie_year: r.year ?? '',
      created_at: stamp(r.date),
    });
  }

  /*
   * RATINGS ARE HALVED, and this is the one number that must not be fudged.
   * Letterboxd runs 0.5–5 in half stars; this app stores 1–5 whole ones. A
   * half star has to go somewhere, and it goes UP: rounding 3.5 down to 3
   * silently makes somebody's opinion worse than they said, and there is no
   * screen anywhere that would let them notice it happened.
   */
  for (const r of table('ratings')) {
    const stars = Math.round(Number(r.rating));
    if (!r.name || !Number.isFinite(stars) || stars < 1) continue;
    rows.movieRatings.push({ name: r.name, stars: Math.min(5, stars) });
  }

  return rows;
}

/**
 * IMDB — asked for on r/moviecritic, 25 Sep 2026, and the cheapest door of the
 * lot: one CSV, no ZIP, no OAuth, no key. Ratings live at
 * imdb.com/list/ratings behind an Export button; the Watchlist and any custom
 * list export the same way.
 *
 * FILMS ONLY, for the same reason Letterboxd is, and it has to be said before
 * somebody imports and finds half an app. IMDb's export carries no series
 * column and no season or episode number -- a rated episode is a row whose
 * Title is the EPISODE's name and nothing else -- so there is no way to place
 * a television watch. `tvSeries` rows would add a show with nothing in it and
 * `tvEpisode` rows cannot be placed at all, so both are skipped rather than
 * imported wrong.
 *
 * A RATING IS THE ONLY EVIDENCE OF A WATCH. IMDb has no watch history: it
 * knows what you scored and when you scored it, so an import has to decide
 * that a rated film is a watched film. True of nearly everybody, not true of
 * everybody -- somebody who rates trailers or rates from memory gets a watch
 * they did not have. The alternative is importing ratings with no watches,
 * which leaves a library of films the app thinks you have never seen, and that
 * is wrong for far more people.
 *
 * WHICH DATE. `Date Rated` for a rating, `Created` for a watchlist row --
 * neither is the day they actually watched it, and IMDb does not hold that
 * day. It is the closest true thing in the file, and it is better than today.
 *
 * TWO HEADER GENERATIONS, both read: IMDb changed the columns at the end of
 * 2017 (`You rated` -> `Your Rating`, `Title type` -> `Title Type`, and the
 * old `position`/`created`/`modified` block). Exports from before then are
 * still sitting in people's downloads folders.
 */
const IMDB_FILM_TYPES = new Set([
  'movie',
  'tvmovie',
  'tv movie',
  'video',
  'short',
  'tvshort',
  'tv short',
  'tvspecial',
  'tv special',
  'documentary',
]);

/** A day as `created_at` wants it, from the handful of shapes IMDb has used. */
function imdbDay(raw: string | undefined): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return `${v.slice(0, 10)} 12:00:00`;
  const months = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
  // '24 Sep 2026' / 'Sep 24, 2026' — the pre-2018 exports and some locales.
  const named = /^(?:(\d{1,2})\s+)?([a-z]{3})[a-z]*\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})$/i.exec(v);
  if (named) {
    const m = months.indexOf(named[2].toLowerCase());
    const day = named[1] ?? named[3];
    if (m >= 0 && day) {
      return `${named[4]}-${String(m + 1).padStart(2, '0')}-${day.padStart(2, '0')} 12:00:00`;
    }
  }
  // 'M/D/YYYY', IMDb's old "Release Date (month/day/year)".
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (slash) {
    return `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')} 12:00:00`;
  }
  /* UNDATED RATHER THAN WRONGLY DATED. A date nobody can parse must not become
     today's: the whole point of the archive is the day, and inventing one is
     worse than admitting there isn't one. */
  return '';
}

/**
 * THE LETTERBOXD *IMPORT* SHAPE, which is not the shape `letterboxdRows`
 * reads — and the distinction is the whole reason this exists.
 *
 * Letterboxd's EXPORT is four files (`diary.csv`, `watched.csv`,
 * `ratings.csv`, `watchlist.csv`) with the columns `Name`, `Date`, `Watched
 * Date`, `Rewatch`. Letterboxd's IMPORT is ONE file with `Title`, `Year`,
 * `Rating`, `WatchedDate`, `imdbID`, `tmdbID`. Same company, different
 * vocabulary; reading one with the other's keys yields a file of blank names
 * and an import that reports zero.
 *
 * WHY THE IMPORT SHAPE MATTERS MORE. It is the interchange format the whole
 * ecosystem writes: it is what the JustWatch browser extension produces —
 * JustWatch has no export of its own, which is the finding that killed the
 * idea of a JustWatch parser — and what a dozen other "get your list out of X"
 * tools produce, because Letterboxd is where people were taking their lists.
 * Supporting one documented format reaches all of them.
 *
 * FILMS ONLY, like everything that comes through Letterboxd's shape.
 */
const LBX_MARKERS = ['watcheddate', 'letterboxduri', 'letterboxd uri', 'rating10', 'imdbid', 'tmdbid'];

/** One row per film, so it is detected on its columns like the IMDb one. */
export function isLetterboxdImportCsv(header: readonly string[]): boolean {
  const keys = new Set(header.map((h) => h.trim().toLowerCase()));
  // `Const` is IMDb's, and an IMDb export also carries a `Title`. Whichever
  // detector runs first must not answer for the other's file.
  if (keys.has('const')) return false;
  if (!keys.has('title')) return false;
  return LBX_MARKERS.some((m) => keys.has(m));
}

export function letterboxdImportRows(table: readonly Record<string, string>[]): ForeignRows {
  const rows: ForeignRows = { showRows: [], episodeRows: [], movieRows: [], movieRatings: [] };

  for (const raw of table) {
    const r: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) r[k.trim().toLowerCase()] = (v ?? '').trim();

    const name = r.title;
    if (!name) continue;
    const year = r.year ?? '';
    const watched = r.watcheddate || r['watched date'];

    /* RATING10 FIRST. A file that carries both is giving the same opinion at
       two resolutions, and ten points survives the trip better: 3.5 stars is
       7, and reading the 3.5 means deciding where the half goes all over
       again. */
    const ten = Number(r.rating10);
    const five = Number(r.rating);
    const stars = Number.isFinite(ten) && ten >= 1
      ? starsFromTen(ten)
      : Number.isFinite(five) && five >= 0.5
        ? Math.min(5, Math.max(1, Math.round(five)))
        : null;

    /*
     * A DATE OR A SCORE MEANS WATCHED; NEITHER MEANS WATCHLIST.
     *
     * This format carries no "seen" flag, so the evidence is what is in the
     * row. A watchlist export from any of these tools is titles and years and
     * nothing else, which is exactly the row that falls through to `towatch`.
     */
    if (watched || stars != null) {
      rows.movieRows.push({
        type: 'watch',
        entity_type: 'movie',
        movie_name: name,
        movie_year: year,
        created_at: imdbDay(watched),
      });
      if (stars != null) rows.movieRatings.push({ name, stars });
      continue;
    }

    rows.movieRows.push({
      type: 'towatch',
      entity_type: 'movie',
      movie_name: name,
      movie_year: year,
      created_at: '',
    });
  }

  return rows;
}

/**
 * The 32 characters where windows-1252 and Latin-1 disagree. Everything else
 * in cp1252 is its Latin-1 self, which is its byte value as a code point.
 */
const CP1252_HIGH = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

/**
 * Bytes as windows-1252 text.
 *
 * IMDb has written these exports in cp1252 since 2018, and RN's `TextDecoder`
 * is not guaranteed to know that label, so the table is here rather than
 * borrowed. Thirty-two entries is the whole difference.
 */
export function cp1252(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    out += b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b);
  }
  return out;
}

/** Is this parsed CSV an IMDb export? The header row is the only signature a
 *  bare `.csv` has, and it is the one thing nobody edits. */
export function isImdbCsv(header: readonly string[]): boolean {
  const keys = new Set(header.map((h) => h.trim().toLowerCase()));
  return keys.has('const') && (keys.has('title type') || keys.has('title_type'));
}

export function imdbRows(table: readonly Record<string, string>[]): ForeignRows {
  const rows: ForeignRows = { showRows: [], episodeRows: [], movieRows: [], movieRatings: [] };

  for (const raw of table) {
    // Lowercased once per row so both header generations read as one shape.
    const r: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) r[k.trim().toLowerCase()] = (v ?? '').trim();

    const name = r.title || r['original title'];
    if (!name) continue;
    if (!IMDB_FILM_TYPES.has((r['title type'] || r['title_type']).toLowerCase())) continue;

    const year = r.year ?? '';
    const score = Number(r['your rating'] || r['you rated']);
    const stars = starsFromTen(score);

    if (stars == null) {
      /* No score: a watchlist or a list row. `Created` is when it went on the
         list, which is the only date that file has. */
      rows.movieRows.push({
        type: 'towatch',
        entity_type: 'movie',
        movie_name: name,
        movie_year: year,
        created_at: imdbDay(r.created || r.modified),
      });
      continue;
    }

    rows.movieRows.push({
      type: 'watch',
      entity_type: 'movie',
      movie_name: name,
      movie_year: year,
      created_at: imdbDay(r['date rated'] || r.created),
    });
    rows.movieRatings.push({ name, stars });
  }

  return rows;
}

/** What a foreign export turned out to be, for the screen that reports it. */
export type ForeignSource = 'letterboxd' | 'simkl' | 'trakt' | 'serializd';

/**
 * Which service a ZIP came from, by the files inside it.
 *
 * BY CONTENT, NEVER BY FILE NAME. People rename downloads, and a ZIP called
 * "letterboxd.zip" that holds a TV Time export must import as TV Time. The
 * signature is the header row, which nobody edits.
 */
export function detectForeignSource(names: readonly string[]): ForeignSource | null {
  const lower = names.map((n) => (n.split('/').pop() ?? '').toLowerCase());
  if (lower.some((n) => n === 'diary.csv' || n === 'watched.csv') && lower.some((n) => n === 'ratings.csv')) {
    return 'letterboxd';
  }
  return null;
}

/**
 * Trakt and Simkl both export JSON, so their signature is a SHAPE rather than a
 * header row — but the rule is the same one, and for the same reason: a ZIP
 * called "trakt.zip" holding a Simkl backup must import as Simkl.
 *
 * A Simkl backup is ONE object with `shows`, `movies` or `anime` in it. A Trakt
 * export is SEVERAL arrays, one per file, and which array is which is knowable
 * from what its items carry — `watched_at` is a watch, `listed_at` is a
 * watchlist entry, `rated_at` is a rating. So a renamed file still lands in the
 * right pile, which is the whole point of not reading the name.
 */
export type ForeignJson =
  | { source: 'simkl'; json: unknown }
  | { source: 'trakt'; payload: TraktPayload }
  | { source: 'serializd'; records: SerializdRecord[] }
  | null;

export type TraktPayload = {
  history?: ForeignItem[];
  watchlist?: ForeignItem[];
  ratings?: ForeignItem[];
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Does this array look like Trakt/Simkl items rather than somebody else's JSON? */
function looksForeign(items: unknown[]): boolean {
  return items.some(
    (it) => isObject(it) && ('show' in it || 'movie' in it || 'episode' in it || 'ids' in it),
  );
}

export function classifyForeignJson(parsed: readonly unknown[]): ForeignJson {
  /*
   * SERIALIZD FIRST, by the records its walker recognises — `showId`,
   * `dateAdded`, `episodeNumber`, words neither Trakt nor Simkl ever write, so
   * their files yield nothing here and fall through. Ahead of Simkl because
   * Simkl is known by a top-level `shows` array, and a Serializd export that
   * wraps its records in one would otherwise be read as Simkl and import
   * nothing. Every JSON in the ZIP pools into one list: a context dump beside
   * an episode dump is one library.
   */
  const records = parsed.flatMap((j) => serializdRecords(j));
  if (records.length > 0) return { source: 'serializd', records };

  // Simkl next: one object that carries the lists by name.
  for (const j of parsed) {
    if (!isObject(j)) continue;
    const lists = ['shows', 'movies', 'anime'].filter((k) => Array.isArray(j[k]));
    if (lists.length > 0) return { source: 'simkl', json: j };
  }

  const payload: TraktPayload = {};
  for (const j of parsed) {
    if (!Array.isArray(j) || !looksForeign(j)) continue;
    const items = j as ForeignItem[];
    // Sorted by the field that is present, most specific first: a rating row
    // carries `rated_at`, a watchlist row `listed_at`, and a watch the date it
    // happened. Anything else is left alone rather than guessed at.
    if (items.some((it) => it?.rated_at != null || it?.rating != null)) {
      payload.ratings = [...(payload.ratings ?? []), ...items];
    } else if (items.some((it) => it?.listed_at != null)) {
      payload.watchlist = [...(payload.watchlist ?? []), ...items];
    } else if (items.some((it) => it?.watched_at != null || it?.last_watched_at != null)) {
      payload.history = [...(payload.history ?? []), ...items];
    }
  }
  return payload.history || payload.watchlist || payload.ratings ? { source: 'trakt', payload } : null;
}

/**
 * One item as Trakt and Simkl both describe it. They are near-identical by
 * design — Simkl copied Trakt's conventions — so one shape reads both, and the
 * fields nobody guarantees are all optional.
 */
type ForeignIds = { tvdb?: number | string; tmdb?: number | string; imdb?: string };
type ForeignTitle = { title?: string; year?: number | string; ids?: ForeignIds };
type ForeignItem = {
  watched_at?: string;
  last_watched_at?: string;
  listed_at?: string;
  rated_at?: string;
  rating?: number;
  user_rating?: number;
  type?: string;
  episode?: { season?: number; number?: number };
  show?: ForeignTitle;
  movie?: ForeignTitle;
} & ForeignTitle;

const idText = (v: number | string | undefined): string => (v == null ? '' : String(v));

/**
 * TRAKT and SIMKL, which are the same mapping because they are the same shape.
 *
 * SHOWS ARRIVE KEYED BY TheTVDB ID, which is what this app's `shows` table uses
 * as its primary key — so a show imported here lands on exactly the row a TV
 * Time import would have created, and somebody who has both does not end up
 * with two of everything. A show with no TheTVDB id is dropped rather than
 * matched by name: name matching is the bug that made search offer "ADD SHOW"
 * for shows already tracked, and it is not worth repeating on the way in.
 *
 * NOT IMPORTED, and it should be said rather than discovered: episode ratings
 * and show ratings. This app rates EPISODES and both services mostly rate
 * SHOWS, and spreading one show score across forty episodes would invent forty
 * opinions nobody expressed.
 */
export function traktRows(payload: {
  history?: readonly ForeignItem[];
  watchlist?: readonly ForeignItem[];
  ratings?: readonly ForeignItem[];
}): ForeignRows {
  const rows: ForeignRows = { showRows: [], episodeRows: [], movieRows: [], movieRatings: [] };
  const shows = new Map<string, string>();

  for (const item of payload.history ?? []) {
    const at = item.watched_at ?? item.last_watched_at ?? '';
    const movie = item.movie ?? (item.type === 'movie' ? item : null);
    const show = item.show;

    if (item.episode && show) {
      const tvdb = idText(show.ids?.tvdb);
      if (!tvdb) continue;
      if (show.title) shows.set(tvdb, show.title);
      rows.episodeRows.push({
        s_id: tvdb,
        season_number: String(item.episode.season ?? ''),
        episode_number: String(item.episode.number ?? ''),
        created_at: at,
        series_name: show.title ?? '',
      });
      continue;
    }

    if (movie?.title) {
      rows.movieRows.push({
        type: 'watch',
        entity_type: 'movie',
        movie_name: movie.title,
        movie_year: idText(movie.year),
        created_at: at,
      });
    }
  }

  for (const item of payload.watchlist ?? []) {
    const movie = item.movie ?? (item.type === 'movie' ? item : null);
    if (!movie?.title) continue;
    rows.movieRows.push({
      type: 'towatch',
      entity_type: 'movie',
      movie_name: movie.title,
      movie_year: idText(movie.year),
      created_at: item.listed_at ?? '',
    });
  }

  for (const item of payload.ratings ?? []) {
    const movie = item.movie ?? (item.type === 'movie' ? item : null);
    const score = item.rating ?? item.user_rating;
    if (!movie?.title || score == null) continue;
    const stars = starsFromTen(score);
    if (stars != null) rows.movieRatings.push({ name: movie.title, stars });
  }

  for (const [tvdbId, name] of shows) {
    rows.showRows.push({
      tv_show_id: tvdbId,
      tv_show_name: name,
      is_followed: '1',
      is_favorited: '0',
      archived: '0',
    });
  }

  return rows;
}

/**
 * SIMKL's file export, which nests episodes under seasons instead of listing
 * each watch — so it is flattened into the same rows before `traktRows` sees
 * the movies and ratings.
 *
 * A NESTED EPISODE HAS NO DATE OF ITS OWN in some exports, only the show's
 * `last_watched_at`. That is carried through rather than dropped, and it is
 * worth knowing what it means: a show watched over two years arrives with every
 * episode stamped on the last day. Wrong, but present — and the alternative is
 * a library with no history at all, which is worse for an app whose whole
 * argument is that it keeps the dates.
 */
export function simklRows(json: unknown): ForeignRows {
  const doc = (json ?? {}) as { shows?: ForeignItem[]; movies?: ForeignItem[] };
  const history: ForeignItem[] = [];
  const ratings: ForeignItem[] = [];
  const watchlist: ForeignItem[] = [];

  for (const show of doc.shows ?? []) {
    const seasons = (show as { seasons?: { number?: number; episodes?: { number?: number; watched_at?: string }[] }[] })
      .seasons;
    for (const season of seasons ?? []) {
      for (const ep of season.episodes ?? []) {
        history.push({
          watched_at: ep.watched_at ?? show.last_watched_at ?? '',
          show: { title: show.title, ids: show.ids },
          episode: { season: season.number, number: ep.number },
        });
      }
    }
  }

  for (const movie of doc.movies ?? []) {
    // `plantowatch` is Simkl's watchlist; anything else with a date is a watch.
    const status = (movie as { status?: string }).status;
    const item: ForeignItem = { movie: { title: movie.title, year: movie.year, ids: movie.ids }, type: 'movie' };
    if (status === 'plantowatch') watchlist.push({ ...item, listed_at: movie.watched_at ?? '' });
    else history.push({ ...item, watched_at: movie.watched_at ?? movie.last_watched_at ?? '' });
    if (movie.user_rating != null) ratings.push({ ...item, rating: movie.user_rating });
  }

  return traktRows({ history, watchlist, ratings });
}

/**
 * SERIALIZD — the "Letterboxd for TV" that TV Time's refugees were pointed at
 * most, free and built on TMDB. Asked for on 5 Oct 2026 (CHANGELOG 2.0.0,
 * item 11).
 *
 * THERE IS NO EXPORT, and that has to be said before anything else. As of
 * August 2026 Serializd has no export button and no public API, and the
 * developer says one is planned (achriom.com/blog/import-data-into-serializd;
 * docs.simkl.org, "Simkl vs Serializd"). The one tool that moves data OUT —
 * github.com/mwsmws22/serializd_to_trakt — logs in with the user's password,
 * reads the site's private API and writes Trakt ids only, which this app
 * cannot place.
 *
 * SO THIS READS SERIALIZD'S OWN VOCABULARY, which IS public: it is what that
 * script reads off the API, field for field (10 Oct 2026):
 *   - `/api/user_information?shouldGetUserContext=true` answers
 *     `{ context: { watched, currentlyWatching, droppedShows, pausedShows,
 *     watchlist } }`, each a list of season records with `showId` and
 *     `dateAdded`;
 *   - `/api/show/{showId}` names the show and its `seasons`, each with a
 *     `seasonNumber`;
 *   - a season's page carries `episodeLogs`, each `{ episodeNumber, dateAdded }`;
 *   - the script's own flattened record is `{ showId, showName, seasonNumber,
 *     episodeNumber, dateAdded }`.
 * `showId` IS THE TMDB ID: the script finds the show on Trakt with
 * `/search/tmdb/{showId}`. Whatever file eventually reaches a phone — the
 * promised export, a saved API reply, a data request answered by the
 * developer — is a dump of these same objects, so the reader walks ANY
 * nesting and collects every record it recognises rather than betting on one
 * file layout nobody has seen.
 *
 * ASSUMPTIONS, each marked where it is made, all waiting on a real file:
 *   1. a record is an object with `showId` (or `tmdbId`) that carries a
 *      `dateAdded` or sits in one of the five lists, or an `episodeNumber`
 *      under such a show — anything less is somebody else's JSON (OpenTV's
 *      own backup sidecar has `showId` on its rating rows, and must not read
 *      as Serializd);
 *   2. `rating` is stars out of five, with halves — the site rates episodes
 *      on a half-star scale — unless any rating in the file exceeds 5, which
 *      means the file counts to ten;
 *   3. review text sits in `review` or `reviewText`;
 *   4. a season record with no `episodeLogs` is a followed show and nothing
 *      more. Whether the export carries a season's episodes inline is the
 *      first thing a real file will settle.
 *
 * TMDB ID IN, TheTVDB ID OUT. This app keys shows by TheTVDB id, so every
 * Serializd show needs one answer before its rows mean anything — and that
 * answer needs the network, which nothing in this file touches. So it is two
 * pure halves around one networked step: `serializdRecords` flattens the
 * file, the importer resolves the distinct `showId`s, and `serializdRows`
 * maps the records through that link. A show the link cannot place is
 * dropped rather than matched by name, for the reason `traktRows` gives.
 */
export type SerializdRecord = {
  /** The show's TMDB id. */
  showId: number;
  /** As the file names it; '' when it does not (a context dump names nothing). */
  showName: string;
  season: number | null;
  episode: number | null;
  /** `dateAdded`, ISO as Serializd writes it; '' when absent. */
  at: string;
  rating: number | null;
  review: string;
  /** Which of the five account lists the record sat in, if any. */
  list: string | null;
};

/** What the importer resolved a Serializd show to. */
export type SerializdLink = { tvdbId: number; name: string };

const SERIALIZD_LISTS = new Set(['watched', 'currentlyWatching', 'droppedShows', 'pausedShows', 'watchlist']);

/** A number, whether the file wrote it as one or as digits in a string. */
const numOf = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
};
const strOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** What an object inherits from the objects above it. */
type SerializdCtx = { showId: number | null; showName: string; season: number | null; list: string | null };

function walkSerializd(v: unknown, ctx: SerializdCtx, out: SerializdRecord[]): void {
  if (Array.isArray(v)) {
    for (const x of v) walkSerializd(x, ctx, out);
    return;
  }
  if (!isObject(v)) return;
  const own = numOf(v.showId ?? v.tmdbId ?? v.tmdb_id);
  const showId = own ?? ctx.showId;
  // `showName` only: a season record's `name` is the SEASON's ("Season 14").
  const showName = strOf(v.showName) || ctx.showName;
  const season = numOf(v.seasonNumber) ?? ctx.season;
  const episode = numOf(v.episodeNumber);
  const at = strOf(v.dateAdded);
  // ASSUMPTION 1: what counts as a record.
  const isRecord = showId != null && showId > 0 && (episode != null || (own != null && (at !== '' || ctx.list != null)));
  if (isRecord) {
    // ASSUMPTION 3: where a review's text lives.
    out.push({ showId, showName, season, episode, at, rating: numOf(v.rating), review: strOf(v.review ?? v.reviewText), list: ctx.list });
  }
  const next: SerializdCtx = { showId, showName, season, list: ctx.list };
  for (const [k, x] of Object.entries(v)) {
    if (x == null || typeof x !== 'object') continue;
    walkSerializd(x, SERIALIZD_LISTS.has(k) ? { ...next, list: k } : next, out);
  }
}

/** Every Serializd record in a file, whatever it is nested in. Empty means
 *  the file is not Serializd's — which is how `classifyForeignJson` knows. */
export function serializdRecords(json: unknown): SerializdRecord[] {
  const out: SerializdRecord[] = [];
  walkSerializd(json, { showId: null, showName: '', season: null, list: null }, out);
  return out;
}

export function serializdRows(records: readonly SerializdRecord[], link: ReadonlyMap<number, SerializdLink>): ForeignRows {
  /*
   * ASSUMPTION 2: THE SCALE. Out of five with halves is what the site shows,
   * and a half star goes UP, for the reason `letterboxdRows` gives. A file
   * that counts to ten declares itself by holding a score above 5, and then
   * `starsFromTen` reads it like a Trakt score.
   */
  const outOfTen = records.some((r) => (r.rating ?? 0) > 5);
  const starsOf = (rating: number | null): number | null => {
    if (rating == null || rating <= 0) return null;
    return outOfTen ? starsFromTen(rating) : Math.min(5, Math.max(1, Math.round(rating)));
  };

  // One show row per show: named by the file where it says and by the link
  // where it does not; archived if ANY record puts it among the dropped, the
  // way the community export's "stopped" becomes archived.
  const shows = new Map<number, { tvdbId: number; name: string; archived: boolean }>();
  for (const r of records) {
    const hit = link.get(r.showId);
    if (!hit) continue;
    const cur = shows.get(r.showId) ?? { tvdbId: hit.tvdbId, name: '', archived: false };
    cur.name ||= r.showName || hit.name;
    cur.archived ||= r.list === 'droppedShows';
    shows.set(r.showId, cur);
  }

  const episodeRows: Record<string, string>[] = [];
  const episodeRatings: NonNullable<ForeignRows['episodeRatings']> = [];
  const comments: NonNullable<ForeignRows['comments']> = [];
  for (const r of records) {
    const show = shows.get(r.showId);
    if (!show) continue;
    const { season, episode } = r;
    const onEpisode = season != null && episode != null;
    if (onEpisode) {
      episodeRows.push({
        s_id: String(show.tvdbId),
        season_number: String(season),
        episode_number: String(episode),
        created_at: r.at,
        series_name: show.name,
      });
      // Keyed by name downstream, exactly like the GDPR votes file, so a show
      // the link could not name has nowhere to hang a score.
      const stars = starsOf(r.rating);
      if (stars != null && show.name) episodeRatings.push({ name: show.name, season, episode, stars });
    }
    /*
     * NOT IMPORTED: season and show ratings. This app rates episodes, and
     * spreading one season score across its episodes would invent opinions
     * nobody expressed — the rule `traktRows` keeps for show scores.
     *
     * REVIEWS ARE COMMENTS. An episode's lands on the episode, in the entity
     * grammar the comments table keeps. A season's has no slot of its own —
     * Serializd's unit is the season, this app's is the show or the episode —
     * so it lands on the show with the season named up front, in the app's
     * own S-notation, rather than losing which season it was about.
     */
    if (r.review && show.name) {
      comments.push({
        entity: onEpisode ? `${show.name} S${season}E${episode}` : show.name,
        text: !onEpisode && season != null ? `S${season}: ${r.review}` : r.review,
        date: r.at,
      });
    }
  }

  const showRows = [...shows.values()].map((s) => ({
    tv_show_id: String(s.tvdbId),
    tv_show_name: s.name,
    is_followed: '1',
    is_favorited: '0',
    archived: s.archived ? '1' : '0',
  }));

  return { showRows, episodeRows, movieRows: [], movieRatings: [], episodeRatings, comments };
}
