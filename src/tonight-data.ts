/**
 * Everything on this phone that could be watched tonight, flattened.
 *
 * THE SPLIT. `tonight.ts` and `catch-up.ts` hold every judgement and are pure,
 * so they can be tested without a database; this file only reads. Nothing here
 * decides anything, which is why it has no tests and needs none.
 *
 * IT NEVER TOUCHES THE NETWORK. Runtimes, air dates and genres are already
 * cached by the metadata sync, so a screen that exists to answer a question
 * quickly answers it at the speed of SQLite rather than the speed of TheTVDB.
 * Where a runtime was never fetched the field is left null and `fitsTime`
 * decides what to do with it — a guess here would be invisible there.
 */
import type { Behind } from '@/catch-up';
import { getMovies, getShowProgress, getWatchedSet } from '@/db';
import { showMeta } from '@/metadata';
import type { Candidate } from '@/tonight';

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

export const today = (): string => dayKey(new Date());

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.replace(' ', 'T'));
  return isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null;
}

/** Aired episodes of a show that are not watched, cheapest first. */
function unwatchedAired(showId: number, key: string) {
  const m = showMeta(showId);
  if (!m) return [];
  const seen = getWatchedSet(showId);
  const out: { season: number; episode: number; runtime: number | null; air: string }[] = [];
  for (const [k, em] of Object.entries(m.episodes ?? {})) {
    const air = em?.air;
    // Specials are not part of a season's story and would make "two left" a
    // lie on almost every show that has any.
    const [season, episode] = k.split('-').map(Number);
    if (!air || air > key || !season || season < 1 || !episode) continue;
    if (seen.has(`${season}-${episode}`)) continue;
    out.push({ season, episode, runtime: em.runtime ?? null, air });
  }
  return out.sort((a, b) => a.season - b.season || a.episode - b.episode);
}

/**
 * Every candidate, unranked.
 *
 * ARCHIVED SHOWS ARE LEFT OUT. "Stopped watching" is an answer the person
 * already gave, and re-offering it tonight is the app arguing with them.
 */
export function candidates(): Candidate[] {
  const key = today();
  const out: Candidate[] = [];

  for (const s of getShowProgress()) {
    if (s.archived || s.finished) continue;
    const left = unwatchedAired(s.tvdbId, key);
    if (left.length === 0) continue;
    const next = left[0]!;
    const m = showMeta(s.tvdbId);
    out.push({
      key: `show:${s.tvdbId}`,
      // "finish" and "continue" are the same act; the difference is how close
      // the end is, and that is what makes one of them satisfying.
      kind: s.watched === 0 ? 'start' : left.length <= 4 ? 'finish' : 'continue',
      group: `show:${s.tvdbId}`,
      title: s.name,
      poster: s.posterUrl,
      minutes: next.runtime ?? m?.runtime ?? null,
      genres: m?.genres ?? [],
      lastWatchedDaysAgo: daysAgo(s.lastWatchedAt),
      remaining: left.length,
      stars: null,
      available: (m?.providers?.length ?? 0) > 0,
    });
  }

  for (const f of getMovies()) {
    if (f.watchedAt) continue; // the watchlist, which is what "a film tonight" means
    // Something announced but not out yet is not an answer to "tonight".
    if (f.releaseDate && f.releaseDate > key) continue;
    out.push({
      key: `movie:${f.name}`,
      kind: 'movie',
      group: `movie:${f.name}`,
      title: f.name,
      poster: f.poster,
      // The column is seconds everywhere else in this app.
      minutes: f.runtime ? Math.round(f.runtime / 60) : null,
      genres: [],
      lastWatchedDaysAgo: null,
      remaining: null,
      stars: f.stars,
      available: false,
    });
  }

  return out;
}

/**
 * Shows with a season arriving and episodes still unwatched behind it.
 *
 * THE PREMIERE IS THE FIRST EPISODE OF A SEASON THAT STARTS IN THE FUTURE, and
 * only when at least one of its own episodes has not aired — otherwise a show
 * mid-season looks like it is "about to return" every week.
 */
export function behind(): Behind[] {
  const key = today();
  const out: Behind[] = [];

  for (const s of getShowProgress()) {
    if (s.archived) continue;
    const m = showMeta(s.tvdbId);
    if (!m) continue;

    // First episode of each season, and whether the season has aired at all.
    const firsts = new Map<number, string>();
    for (const [k, em] of Object.entries(m.episodes ?? {})) {
      const air = em?.air;
      const [season, episode] = k.split('-').map(Number);
      if (!air || !season || season < 1 || episode !== 1) continue;
      firsts.set(season, air);
    }

    let premiere: string | null = null;
    let season = 0;
    for (const [n, air] of [...firsts].sort((a, b) => a[0] - b[0])) {
      if (air > key) {
        premiere = air;
        season = n;
        break;
      }
    }
    if (!premiere) continue;

    // Only what aired BEFORE the new season — episodes of the new season are
    // not something anybody is "behind" on.
    const left = unwatchedAired(s.tvdbId, key).filter((e) => e.season < season);
    if (left.length === 0) continue;

    const known = left.filter((e) => e.runtime != null);
    out.push({
      showId: s.tvdbId,
      showName: s.name,
      poster: s.posterUrl,
      remaining: left.length,
      /*
       * SCALED FROM WHAT IS KNOWN rather than summing only the episodes that
       * happen to carry a runtime. Roughly forty per cent of episodes have
       * none, so a plain sum reads forty per cent short — and "six hours" when
       * the truth is ten is exactly the kind of wrong that makes somebody miss
       * a premiere they were told they would make.
       */
      minutes: known.length
        ? Math.round((known.reduce((n, e) => n + (e.runtime ?? 0), 0) / known.length) * left.length)
        : null,
      premiere,
      season,
      lastWatchedDaysAgo: daysAgo(s.lastWatchedAt),
    });
  }

  return out;
}
