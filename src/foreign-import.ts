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
export function letterboxdRows(files: Record<string, string[][]>): ForeignRows {
  const rows: ForeignRows = { showRows: [], episodeRows: [], movieRows: [], movieRatings: [] };

  const table = (name: string): Record<string, string>[] => {
    const key = Object.keys(files).find((k) => k.toLowerCase().endsWith(`${name}.csv`));
    if (!key) return [];
    const [head, ...body] = files[key];
    if (!head) return [];
    const cols = head.map((h) => h.trim().toLowerCase());
    return body
      .filter((r) => r.length > 1)
      .map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? '').trim()])));
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
    seen.add(keyOf(name, r.year ?? ''));
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

/** What a foreign export turned out to be, for the screen that reports it. */
export type ForeignSource = 'letterboxd' | 'simkl' | 'trakt';

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
