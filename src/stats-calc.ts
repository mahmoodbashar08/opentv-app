/**
 * All Stats-page numbers computed live from SQLite + bundled metadata, so
 * they're correct for any user's import — nothing hardcoded.
 */
import db, { getComments, getMovies, getMovieTotals, getTotals } from '@/db';
import metadata, { showMeta } from '@/metadata';
import { movieMeta } from '@/movie-metadata';
import seed from '@/seed';
import { isSeedLibrary } from '@/library';

export type Clock = { months: number; days: number; hours: number };

export function clockOf(minutes: number): Clock {
  return {
    months: Math.floor(minutes / (60 * 24 * 30)),
    days: Math.floor(minutes / (60 * 24)) % 30,
    hours: Math.floor(minutes / 60) % 24,
  };
}

type WatchRow = { showId: number; watchedAt: string; runtime: number | null };

/** A watch's length in SECONDS (what the column stores), never zero.
 * TV Time exports carry a per-episode runtime for only some rows — in a real
 * library ~40% arrive empty, and counting those as zero made every clock and
 * chart read far short of the truth. Fall back to the show's own runtime,
 * which metadata stores in MINUTES, then to a 24m average as a last resort. */
function watchSeconds(showId: number, stored: number | null): number {
  if (stored && stored > 0) return stored;
  return (showMeta(showId)?.runtime ?? 24) * 60;
}

function allWatches(): WatchRow[] {
  return db
    .getAllSync<WatchRow>('SELECT showId, watchedAt, runtime FROM watches ORDER BY watchedAt')
    .map((w) => ({ ...w, runtime: watchSeconds(w.showId, w.runtime) }));
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
  const runtimeOf = (id: number) => metadata[String(id)]?.runtime ?? 24;
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
