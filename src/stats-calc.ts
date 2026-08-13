/**
 * All Stats-page numbers computed live from SQLite + bundled metadata, so
 * they're correct for any user's import — nothing hardcoded.
 */
import db, { getCharacterVoteStats, getComments, getMovies, getMovieTotals, getTotals } from '@/db';
import metadata, { showMeta } from '@/metadata';
import { movieMeta } from '@/movie-metadata';
import seed from '@/seed';
import { isSeedLibrary } from '@/library';
import {
  bingeReport,
  collagePosters,
  contrarianScore,
  ratingPersonality,
  watchRuntimeSeconds,
  watchTimeShape,
} from '@/pure';

export type Clock = { months: number; days: number; hours: number };

export function clockOf(minutes: number): Clock {
  return {
    months: Math.floor(minutes / (60 * 24 * 30)),
    days: Math.floor(minutes / (60 * 24)) % 30,
    hours: Math.floor(minutes / 60) % 24,
  };
}

type WatchRow = { showId: number; watchedAt: string; runtime: number | null };

/**
 * THE 24-MINUTE FLOOR MADE THE CLOCK MOVE ON ITS OWN.
 *
 * Metadata is fetched lazily, and the bundled entries carry no runtime for
 * about half the shows in them — Game of Thrones among them. So every GoT
 * episode counted as 24 minutes until the show was opened, at which point real
 * metadata landed at ~57 and the total leapt. Watch time went up by opening a
 * screen, which reads as a broken statistic and is one.
 *
 * The export already knows better: most rows carry a real runtime, and the
 * ones that do not sit beside ones that do. Averaging a show's own known
 * episodes is a far better guess than a constant, and it does not change when
 * a network request happens to finish.
 */
function averageRuntimes(): Map<number, number> {
  const rows = db.getAllSync<{ showId: number; avg: number }>(
    'SELECT showId, AVG(runtime) AS avg FROM watches WHERE runtime > 0 GROUP BY showId',
  );
  return new Map(rows.map((r) => [r.showId, r.avg]));
}

function allWatches(): WatchRow[] {
  const averages = averageRuntimes();
  return db
    .getAllSync<WatchRow>('SELECT showId, watchedAt, runtime FROM watches ORDER BY watchedAt')
    .map((w) => ({
      ...w,
      runtime: watchRuntimeSeconds(w.runtime, showMeta(w.showId)?.runtime, averages.get(w.showId)),
    }));
}

function ts(iso: string): number {
  return Date.parse(iso.replace(' ', 'T')) || 0;
}

export type ShowStats = ReturnType<typeof computeShowStats>;

export function computeShowStats() {
  const totals = getTotals();
  const watches = allWatches();
  const now = Date.now();

  // hours watched in the last 7 days
  const last7dMin = watches
    .filter((w) => now - ts(w.watchedAt) < 7 * 864e5)
    .reduce((n, w) => n + (w.runtime ?? 0) / 60, 0);

  // per-week buckets, last 12 weeks (oldest → newest), like the real charts
  const WEEKS = 12;
  const buckets = Array.from({ length: WEEKS }, (_, i) => {
    const end = now - i * 7 * 864e5;
    const start = end - 7 * 864e5;
    const inWeek = watches.filter((w) => ts(w.watchedAt) >= start && ts(w.watchedAt) < end);
    // ISO-ish week number for the axis label
    const d = new Date(start);
    const jan1 = new Date(d.getFullYear(), 0, 1).getTime();
    const week = Math.ceil(((start - jan1) / 864e5 + 1) / 7);
    return {
      label: String(week),
      episodes: inWeek.length,
      hours: Math.round(inWeek.reduce((n, w) => n + (w.runtime ?? 0), 0) / 3600),
    };
  }).reverse();
  const weekly = buckets.map((b) => b.episodes);
  const weeklyHours = buckets.map((b) => b.hours);
  const weekLabels = buckets.map((b) => b.label);
  const last7dEpisodes = buckets[buckets.length - 1]?.episodes ?? 0;

  // biggest marathons: most episodes of one show inside any 24h window
  const byShow = new Map<number, number[]>();
  for (const w of watches) {
    if (!byShow.has(w.showId)) byShow.set(w.showId, []);
    byShow.get(w.showId)!.push(ts(w.watchedAt));
  }
  const nameOf = (id: number) =>
    metadata[String(id)]?.name ?? seed.shows.find((s) => s.tvdbId === id)?.name ?? String(id);
  // `showMeta`, not the bundle: the bundle carries no runtime for about half
  // its entries, and reading it directly ignores anything since fetched.
  const runtimeOf = (id: number) => showMeta(id)?.runtime ?? 24;
  const windowMax = (times: number[], hours: number) => {
    const t = [...times].sort((a, b) => a - b);
    let best = 0;
    for (let i = 0, j = 0; i < t.length; i++) {
      while (t[i] - t[j] > hours * 36e5) j++;
      best = Math.max(best, i - j + 1);
    }
    return best;
  };
  const marathons = [...byShow.entries()]
    .map(([id, times]) => {
      const count = windowMax(times, 24);
      return { name: nameOf(id), count, hours: Math.round((count * runtimeOf(id)) / 60) };
    })
    .filter((m) => m.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // library shape
  const trackedIds = db.getAllSync<{ tvdbId: number }>('SELECT tvdbId FROM shows').map((r) => r.tvdbId);
  const inProduction = trackedIds.filter((id) => metadata[String(id)]?.inProduction).length;

  const genreCount = new Map<string, number>();
  const networkCount = new Map<string, number>();
  for (const id of trackedIds) {
    const m = metadata[String(id)];
    if (!m) continue;
    for (const g of m.genres) genreCount.set(g, (genreCount.get(g) ?? 0) + 1);
    if (m.network) networkCount.set(m.network, (networkCount.get(m.network) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));

  // votes
  const voteRows = db.getAllSync<{ showId: number; stars: number }>('SELECT showId, stars FROM episode_ratings');
  const voteShows = new Set(voteRows.map((v) => v.showId)).size;
  const STAR = ['Bad', 'Ok', 'Good', 'Great', 'Wow'];
  const perShow = new Map<number, number[]>();
  for (const v of voteRows) {
    if (!perShow.has(v.showId)) perShow.set(v.showId, [0, 0, 0, 0, 0]);
    perShow.get(v.showId)![v.stars - 1]++;
  }
  const mostVoted = [...perShow.entries()]
    .map(([id, buckets]) => {
      const total = buckets.reduce((a, b) => a + b, 0);
      const modeIdx = buckets.indexOf(Math.max(...buckets));
      return { name: nameOf(id), label: STAR[modeIdx], count: total };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // comments (your own, from the import) — split like the real app
  const ownComments = isSeedLibrary() ? seed.comments : getComments();
  const isEpisodeComment = (e: string) => /\sS\d+/.test(e);
  const movieNames = new Set(getMovies().map((mv) => mv.name));
  const showComments = ownComments.filter((c) => !isEpisodeComment(c.entity) && !movieNames.has(c.entity)).length;
  const episodeComments = ownComments.filter((c) => isEpisodeComment(c.entity)).length;
  const comments = ownComments.length;
  const likes = ownComments.reduce((n, c) => n + (c.likes ?? 0), 0);

  // episode comments per month, last 12 months
  const MONTH_L = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const nowD = new Date();
  const commentsByMonth = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(nowD.getFullYear(), nowD.getMonth() - 11 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return {
      label: MONTH_L[d.getMonth()],
      value: ownComments.filter((c) => isEpisodeComment(c.entity) && c.date.startsWith(key)).length,
    };
  });

  // upcoming episodes in the next 6 months (from known air dates)
  const upcoming = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(nowD.getFullYear(), nowD.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let eps = 0;
    let minutes = 0;
    for (const id of trackedIds) {
      const meta2 = metadata[String(id)];
      if (!meta2) continue;
      for (const em of Object.values(meta2.episodes)) {
        if (em.air?.startsWith(key) && ts(`${em.air} 12:00:00`) > now) {
          eps++;
          minutes += meta2.runtime ?? 24;
        }
      }
    }
    return { label: MONTH_L[d.getMonth()], episodes: eps, hours: Math.round(minutes / 60) };
  });

  // remaining + pace + projection
  const watchedByShow = db.getAllSync<{ showId: number; n: number }>(
    'SELECT showId, COUNT(DISTINCT season || "-" || episode) AS n FROM watches GROUP BY showId',
  );
  let remaining = 0;
  let started = 0;
  let remainingMinutes = 0;
  for (const r of watchedByShow) {
    const m = metadata[String(r.showId)];
    if (!m?.totalEpisodes) continue;
    const left = Math.max(m.totalEpisodes - r.n, 0);
    if (left > 0) started++;
    remaining += left;
    remainingMinutes += left * (m.runtime ?? 24);
  }
  const recent = watches.filter((w) => now - ts(w.watchedAt) < 60 * 864e5).length;
  const pace = Math.round((recent / (60 / 7)) * 100) / 100; // eps/week
  const catchUpDate =
    pace > 0.05 && remaining > 0 ? new Date(now + (remaining / pace) * 7 * 864e5) : null;

  // marathoner badges, TV Time's tiers: 3+/5+ in 24h, 10+/20+ in 48h
  const badges: { show: string; label: string }[] = [];
  for (const [id, times] of byShow) {
    const in24 = windowMax(times, 24);
    const in48 = windowMax(times, 48);
    if (in24 >= 3) badges.push({ show: nameOf(id), label: '3 in 24h' });
    if (in24 >= 5) badges.push({ show: nameOf(id), label: '5 in 24h' });
    if (in48 >= 10) badges.push({ show: nameOf(id), label: '10 in 48h' });
    if (in48 >= 20) badges.push({ show: nameOf(id), label: '20 in 48h' });
  }

  return {
    totals,
    clock: clockOf(totals.minutes),
    last7dHours: Math.round(last7dMin / 60),
    last7dEpisodes,
    weekly,
    weeklyHours,
    weekLabels,
    showComments,
    episodeComments,
    commentsByMonth,
    upcoming,
    marathons,
    addedShows: trackedIds.length,
    inProduction,
    genres: top(genreCount),
    networks: top(networkCount),
    votes: voteRows.length,
    voteShows,
    mostVoted,
    comments,
    likes,
    remaining,
    started,
    pace,
    timeToWatchHours: Math.round(remainingMinutes / 60),
    catchUpDate,
    badges,
  };
}

export function computeMovieStats() {
  const t = getMovieTotals();
  const movies = getMovies();
  const watched = movies.filter((m) => m.watchedAt != null);
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // per-week buckets, last 12 weeks (movies watched + hours)
  const WEEKS = 12;
  const buckets = Array.from({ length: WEEKS }, (_, i) => {
    const end = now - i * 7 * 864e5;
    const start = end - 7 * 864e5;
    const inWeek = watched.filter((m) => {
      const at = ts(m.watchedAt!.replace(' ', 'T')) || ts(m.watchedAt!);
      return at >= start && at < end;
    });
    const d = new Date(start);
    const jan1 = new Date(d.getFullYear(), 0, 1).getTime();
    return {
      label: String(Math.ceil(((start - jan1) / 864e5 + 1) / 7)),
      count: inWeek.length,
      hours: Math.round(inWeek.reduce((n, m) => n + (m.runtime ?? 0), 0) / 3600),
    };
  }).reverse();
  const last7d = buckets[buckets.length - 1];

  // genres across the whole collection (watched + watchlist), like the real app
  const genreCount = new Map<string, number>();
  for (const m of movies) {
    const meta = movieMeta(m.tmdbId);
    for (const g of meta?.genres ?? []) genreCount.set(g, (genreCount.get(g) ?? 0) + 1);
  }
  const rated = watched.filter((m) => m.stars != null).length;

  // your movie comments (top-level, not replies) + likes on them
  const movieNames = new Set(movies.map((mv) => mv.name));
  const movieComments = (isSeedLibrary() ? seed.comments : getComments()).filter(
    (c) => c.type === 'comment' && movieNames.has(c.entity),
  );
  const commentMovies = new Set(movieComments.map((c) => c.entity)).size;
  const commentLikes = movieComments.reduce((n, c) => n + (c.likes ?? 0), 0);
  const MONTH_L = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const nowD = new Date();
  const commentsByMonth = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(nowD.getFullYear(), nowD.getMonth() - 11 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { label: MONTH_L[d.getMonth()], value: movieComments.filter((c) => c.date.startsWith(key)).length };
  });

  // remaining = watchlist movies not yet released; upcoming by release month
  const unreleased = movies.filter((m) => {
    if (m.watchedAt != null) return false;
    const rel = movieMeta(m.tmdbId)?.release;
    return !!rel && rel > today;
  });
  const upcoming = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(nowD.getFullYear(), nowD.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const inMonth = unreleased.filter((m) => movieMeta(m.tmdbId)?.release?.startsWith(key));
    const minutes = inMonth.reduce((n, m) => n + (movieMeta(m.tmdbId)?.runtime ?? 0), 0);
    return { label: MONTH_L[d.getMonth()], count: inMonth.length, hours: Math.round(minutes / 60) };
  });
  const recent = watched.filter((m) => now - ts(m.watchedAt!.replace(' ', 'T')) < 60 * 864e5).length;
  const pace = Math.round((recent / (60 / 7)) * 100) / 100;
  const timeToWatchHours = Math.round(unreleased.reduce((n, m) => n + (movieMeta(m.tmdbId)?.runtime ?? 0), 0) / 60);
  const catchUpDate =
    pace > 0.01 && unreleased.length > 0 ? new Date(now + (unreleased.length / pace) * 7 * 864e5) : null;

  return {
    clock: clockOf(t.minutes),
    watched: t.watched,
    watchlist: movies.length - watched.length,
    added: movies.length,
    rated,
    genres: [...genreCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
    weekly: buckets.map((b) => b.count),
    weeklyHours: buckets.map((b) => b.hours),
    weekLabels: buckets.map((b) => b.label),
    last7dCount: last7d?.count ?? 0,
    last7dHours: last7d?.hours ?? 0,
    comments: movieComments.length,
    commentMovies,
    commentLikes,
    commentsByMonth,
    remaining: unreleased.length,
    upcoming,
    pace,
    timeToWatchHours,
    catchUpDate,
  };
}

/* ── Deep Stats (Plus) ─────────────────────────────────────────────────────
 * The dashboard behind the Plus gate. Everything here is derived from the
 * same tables and the same cached metadata the free Stats page reads — no
 * network call, no new column, nothing published.
 */

export type NamedMinutes = { name: string; minutes: number };

/** Years that have a watch in them, newest first. Drives the chip row. */
export function watchYears(): number[] {
  const rows = db.getAllSync<{ y: string }>(
    "SELECT DISTINCT substr(watchedAt, 1, 4) AS y FROM watches WHERE watchedAt <> '' ORDER BY y DESC",
  );
  return rows.map((r) => Number(r.y)).filter((y) => y >= 1900 && y <= 2200);
}

/** One rating with the date of the watch it belongs to. `episode_ratings` has
 *  no timestamp of its own, so the episode's first watch stands in for it —
 *  the only date the schema knows for a rating, and close enough to place it
 *  in a year. */
type DatedRating = { stars: number; at: string | null };

function datedEpisodeRatings(): DatedRating[] {
  return db.getAllSync<DatedRating>(
    `SELECT r.stars AS stars, MIN(w.watchedAt) AS at
     FROM episode_ratings r
     LEFT JOIN watches w ON w.showId = r.showId AND w.season = r.season AND w.episode = r.episode
     GROUP BY r.showId, r.season, r.episode`,
  );
}

/** Inclusive 'YYYY-MM-DD' bounds. All-time is a range too — see `ALL_TIME`. */
export type DayRange = { start: string; end: string };

/**
 * Everything, INCLUDING rows with no date at all: `''` sorts below any real
 * date, so an empty `watchedAt` still lands inside all-time and outside every
 * real period. That is what the year-based filter this replaced did, and a
 * dateless watch dropping out of the all-time totals would be a regression.
 */
const ALL_TIME: DayRange = { start: '', end: '9999-12-31' };

export function yearRange(year: number | null): DayRange {
  return year === null ? ALL_TIME : { start: `${year}-01-01`, end: `${year}-12-31` };
}

/** Compared on the DATE PREFIX, so a stamp carrying a clock time
 *  ('2026-12-31 22:10:00') is not pushed past a bound of '2026-12-31'. */
const inRange = (at: string | null | undefined, r: DayRange): boolean => {
  const day = (at ?? '').slice(0, 10);
  return day >= r.start && day <= r.end;
};

function topOf(m: Map<string, number>, limit = 5): NamedMinutes[] {
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, seconds]) => ({ name, minutes: Math.round(seconds / 60) }));
}

export type DeepStats = ReturnType<typeof computeDeepStats>;

/**
 * ONE PASS over the watch table for a date range: a library of 30k watches is
 * a single indexed read plus a walk, and every section built on this shares
 * it. Splitting it into a query per section is what makes a stats screen hang.
 *
 * Deep Stats (a year, or all time) and Wrapped (a month, or a year) are the
 * same walk over different bounds, so they are the same function — the year
 * chip and the July recap cannot disagree about what July was.
 */
function watchPass(range: DayRange) {
  const watches = allWatches().filter((w) => inRange(w.watchedAt, range));

  const genreSec = new Map<string, number>();
  const decadeSec = new Map<string, number>();
  const networkSec = new Map<string, number>();
  const showSec = new Map<number, number>();
  const showEps = new Map<number, number>();
  // showMeta() merges bundle and cache on first call per show — memoised here
  // so a 30k-row walk asks it once per show, not once per episode
  const metaCache = new Map<number, ReturnType<typeof showMeta>>();
  const metaOf = (id: number) => {
    if (!metaCache.has(id)) metaCache.set(id, showMeta(id));
    return metaCache.get(id);
  };

  for (const w of watches) {
    const sec = w.runtime ?? 0;
    showSec.set(w.showId, (showSec.get(w.showId) ?? 0) + sec);
    showEps.set(w.showId, (showEps.get(w.showId) ?? 0) + 1);
    const m = metaOf(w.showId);
    if (!m) continue;
    for (const g of m.genres ?? []) genreSec.set(g, (genreSec.get(g) ?? 0) + sec);
    if (m.network) networkSec.set(m.network, (networkSec.get(m.network) ?? 0) + sec);
    const first = Number(m.year?.slice(0, 4));
    if (first >= 1900) {
      const decade = `${Math.floor(first / 10) * 10}s`;
      decadeSec.set(decade, (decadeSec.get(decade) ?? 0) + sec);
    }
  }

  const nameOf = (id: number) =>
    metaOf(id)?.name ?? metadata[String(id)]?.name ?? seed.shows.find((s) => s.tvdbId === id)?.name ?? String(id);
  const topShowIds = [...showSec.entries()].sort((a, b) => b[1] - a[1]);
  const topShows = topShowIds.slice(0, 8).map(([id, sec]) => ({
    id,
    name: nameOf(id),
    minutes: Math.round(sec / 60),
    episodes: showEps.get(id) ?? 0,
  }));

  // 1–5 star histogram over episodes AND films, the two things a person rates
  const epRatings = datedEpisodeRatings().filter((r) => inRange(r.at, range));
  const movieRatings = getMovies().filter((m) => m.stars != null && inRange(m.watchedAt, range));
  const starCounts = [0, 0, 0, 0, 0];
  for (const r of epRatings) if (r.stars >= 1 && r.stars <= 5) starCounts[r.stars - 1]++;
  for (const m of movieRatings) {
    const stars = m.stars ?? 0;
    if (stars >= 1 && stars <= 5) starCounts[stars - 1]++;
  }

  return {
    watches,
    genreSec,
    decadeSec,
    networkSec,
    topShows,
    starCounts,
    episodes: watches.length,
    minutes: Math.round(watches.reduce((n, w) => n + (w.runtime ?? 0), 0) / 60),
  };
}

/**
 * @param year a calendar year, or null for all time.
 */
export function computeDeepStats(year: number | null) {
  const p = watchPass(yearRange(year));
  return {
    episodes: p.episodes,
    minutes: p.minutes,
    genres: topOf(p.genreSec),
    decades: topOf(p.decadeSec),
    networks: topOf(p.networkSec),
    topShows: p.topShows,
    // character votes carry no date — the schema has never stored one — so
    // this stays all-time whatever the chip row says, and the card says so
    characters: getCharacterVoteStats().top.slice(0, 5),
    binge: bingeReport(p.watches.map((w) => w.watchedAt)),
    when: watchTimeShape(p.watches.map((w) => w.watchedAt)),
    starCounts: p.starCounts,
    personality: ratingPersonality(p.starCounts),
  };
}

/* ── Wrapped ────────────────────────────────────────────────────────────────
 * The same pass, over a month or a year, plus the things a recap needs that a
 * dashboard does not: films, posters, and whether a show was new to you.
 * Computed and shown entirely on the device — nothing here is uploaded.
 */

export type Wrapped = ReturnType<typeof computeWrapped>;

/** A film's length in minutes, with the same fallbacks `getMovieTotals` uses:
 *  the row's own seconds, else the bundled metadata, else ~100. */
function filmMinutes(m: { runtime: number | null; tmdbId: number | null }): number {
  if (m.runtime != null && m.runtime > 0) return Math.round(m.runtime / 60);
  return movieMeta(m.tmdbId)?.runtime ?? 100;
}

/**
 * Everything one period of watching amounts to.
 *
 * @param start inclusive 'YYYY-MM-DD'
 * @param end   inclusive 'YYYY-MM-DD'
 */
export function computeWrapped(start: string, end: string) {
  const range: DayRange = { start, end };
  const p = watchPass(range);

  const films = getMovies().filter((m) => m.watchedAt != null && inRange(m.watchedAt, range));

  // posters come from the library's own rows, which is where the app already
  // keeps artwork — no fetch to open a recap
  const posterOf = new Map(
    db
      .getAllSync<{ tvdbId: number; posterUrl: string | null }>('SELECT tvdbId, posterUrl FROM shows')
      .map((r) => [r.tvdbId, r.posterUrl]),
  );

  /** A show is NEW if the first time you ever watched it falls in this period;
   *  otherwise this period continued something already under way. */
  const firstWatch = new Map(
    db
      .getAllSync<{ showId: number; at: string | null }>(
        'SELECT showId, MIN(watchedAt) AS at FROM watches GROUP BY showId',
      )
      .map((r) => [r.showId, r.at]),
  );
  let newShows = 0;
  for (const id of new Set(p.watches.map((w) => w.showId))) {
    if (inRange(firstWatch.get(id), range)) newShows++;
  }

  const topShows = p.topShows.map((s) => ({ ...s, poster: posterOf.get(s.id) ?? null }));
  const topFilms = [...films].sort((a, b) => filmMinutes(b) - filmMinutes(a));

  const stars = p.starCounts.reduce((a, n, i) => a + n * (i + 1), 0);
  const rated = p.starCounts.reduce((a, b) => a + b, 0);

  return {
    start,
    end,
    episodes: p.episodes,
    films: films.length,
    minutes: p.minutes + films.reduce((n, m) => n + filmMinutes(m), 0),
    topShows,
    topGenres: topOf(p.genreSec),
    topDecade: topOf(p.decadeSec, 1)[0]?.name ?? null,
    newShows,
    continuedShows: new Set(p.watches.map((w) => w.showId)).size - newShows,
    /** Mean stars given in the period, 1–5, or null if nothing was rated. */
    averageRating: rated === 0 ? null : Math.round((stars / rated) * 10) / 10,
    ...(() => {
      // episodes AND films: "your biggest day" is about the evening, not the
      // table a row happens to live in
      const b = bingeReport([...p.watches.map((w) => w.watchedAt), ...films.map((m) => m.watchedAt ?? '')]);
      return {
        biggestDay: { date: b.biggestDayDate, count: b.biggestDay },
        longestStreak: b.longestStreak,
        activeDays: b.activeDays,
      };
    })(),
    posters: collagePosters([...topShows.map((s) => s.poster), ...topFilms.map((m) => m.poster)]),
  };
}

export type CrowdRow = { name: string; yours: number; crowd: number; delta: number };

/**
 * YOU VS THE CROWD — your stars against the community average that is ALREADY
 * cached on the phone (`showMeta().rating`, `movieMeta().rating`, both 0–10).
 * No fetch: a title nobody has opened has no crowd score here, and that is
 * correct — the alternative is a stats screen that goes to the network.
 *
 * Both sides land on 0–10, stars doubled.
 */
export function computeCrowdCompare(year: number | null): { rows: CrowdRow[]; score: number | null } {
  const rows: CrowdRow[] = [];
  const range = yearRange(year);

  const perShow = db.getAllSync<{ showId: number; stars: number; at: string | null }>(
    `SELECT r.showId AS showId, r.stars AS stars, MIN(w.watchedAt) AS at
     FROM episode_ratings r
     LEFT JOIN watches w ON w.showId = r.showId AND w.season = r.season AND w.episode = r.episode
     GROUP BY r.showId, r.season, r.episode`,
  );
  const byShow = new Map<number, { sum: number; n: number }>();
  for (const r of perShow) {
    if (!inRange(r.at, range)) continue;
    const acc = byShow.get(r.showId) ?? { sum: 0, n: 0 };
    acc.sum += r.stars;
    acc.n++;
    byShow.set(r.showId, acc);
  }
  for (const [showId, acc] of byShow) {
    const m = showMeta(showId);
    if (!m?.rating) continue;
    const yours = (acc.sum / acc.n) * 2;
    rows.push({ name: m.name ?? String(showId), yours, crowd: m.rating, delta: yours - m.rating });
  }

  for (const mv of getMovies()) {
    if (mv.stars == null || !inRange(mv.watchedAt, range)) continue;
    const crowd = movieMeta(mv.tmdbId)?.rating;
    if (!crowd) continue;
    const yours = mv.stars * 2;
    rows.push({ name: mv.name, yours, crowd, delta: yours - crowd });
  }

  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { rows, score: contrarianScore(rows.map((r) => r.delta)) };
}

/* ── Activity: the heatmap's data, and the timeline ─────────────────────────
 * Both read the one thing this app has that nothing else does: years of dated
 * watches, imported from TV Time and kept on the phone.
 */

/**
 * Episodes and films per calendar day, for the heatmap.
 *
 * Grouped in SQL rather than walked in JS: a 30,000-row library returns a few
 * hundred rows instead of thirty thousand, and the grid only ever asks about
 * days. Films count as one, same as an episode — the grid is "did you watch
 * something", not "for how long".
 */
export function watchDayCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (rows: { d: string | null; n: number }[]) => {
    for (const r of rows) {
      if (!r.d) continue;
      counts.set(r.d, (counts.get(r.d) ?? 0) + r.n);
    }
  };
  add(
    db.getAllSync<{ d: string | null; n: number }>(
      "SELECT substr(watchedAt, 1, 10) AS d, COUNT(*) AS n FROM watches WHERE watchedAt IS NOT NULL GROUP BY d",
    ),
  );
  add(
    db.getAllSync<{ d: string | null; n: number }>(
      "SELECT substr(watchedAt, 1, 10) AS d, COUNT(*) AS n FROM movies WHERE watchedAt IS NOT NULL GROUP BY d",
    ),
  );
  return counts;
}

/** One thing watched, on one day. */
export type TimelineRow = {
  key: string;
  kind: 'episode' | 'movie';
  /** 'YYYY-MM-DD', the day it was watched. */
  day: string;
  /** The show, or the film. */
  title: string;
  /** 'S01E04' for an episode, the year for a film — whatever names the thing. */
  code: string;
  poster: string | null;
  /** What to open: a show id, or a film name. */
  tvdbId?: number;
  rewatch: boolean;
};

/**
 * The watch history, newest first, one page at a time.
 *
 * PAGED IN SQL. This is the only screen that reads the whole watch table, and
 * for the users this app was built for that is thousands of rows going back to
 * 2018 — loading it whole to show the top twenty is how a Profile tab starts
 * taking four seconds to open.
 *
 * A UNION of two tables that mean the same thing on this screen: something you
 * watched, on a date. The `rowid` tiebreak keeps a day's episodes in the order
 * they were imported, which for a binge is the order they were watched.
 */
export function watchTimeline(limit: number, offset: number): TimelineRow[] {
  const rows = db.getAllSync<{
    kind: string;
    day: string;
    title: string;
    season: number | null;
    episode: number | null;
    year: string | null;
    poster: string | null;
    tvdbId: number | null;
    rewatch: number;
    id: number;
  }>(
    `SELECT 'episode' AS kind, w.watchedAt AS day, s.name AS title,
            w.season AS season, w.episode AS episode, NULL AS year,
            s.posterUrl AS poster, s.tvdbId AS tvdbId, w.rewatch AS rewatch, w.id AS id
       FROM watches w JOIN shows s ON s.tvdbId = w.showId
      WHERE w.watchedAt IS NOT NULL
     UNION ALL
     SELECT 'movie', m.watchedAt, m.name, NULL, NULL, m.year, m.poster, NULL, 0, m.rowid
       FROM movies m
      WHERE m.watchedAt IS NOT NULL
      ORDER BY day DESC, id DESC
      LIMIT ? OFFSET ?`,
    [limit, offset],
  );

  return rows.map((r) => ({
    key: `${r.kind}${r.id}`,
    kind: r.kind === 'movie' ? 'movie' : 'episode',
    day: (r.day ?? '').slice(0, 10),
    title: r.title,
    code:
      r.kind === 'movie'
        ? (r.year ?? '')
        : `S${String(r.season ?? 0).padStart(2, '0')}E${String(r.episode ?? 0).padStart(2, '0')}`,
    poster: r.poster,
    ...(r.tvdbId != null ? { tvdbId: r.tvdbId } : {}),
    rewatch: r.rewatch === 1,
  }));
}
