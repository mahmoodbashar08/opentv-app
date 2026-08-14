/**
 * The impure half of the library filters: turning rows and metadata into the
 * `TitleFacts` the pure matcher in `pure.ts` decides on.
 *
 * ONE PASS, ONE READ EACH. Both builders take the rows their caller already
 * has, so the Shows grid does not re-query what it just rendered, and both ask
 * the metadata layer once per title -- `showMeta()` merges bundle and cache on
 * its first call for a show and hands back the same object after that, so a
 * thousand-show library is a thousand map lookups plus two grouped SQL scans.
 *
 * Every option the sheet offers comes out of these facts, which is what makes
 * "derived from the user's own library" true by construction: a genre nobody
 * has watched has no fact to appear in.
 */
import { getShowFilterFacts, type MovieRow, type ShowProgress } from '@/db';
import { showMeta } from '@/metadata';
import { movieMeta } from '@/movie-metadata';
import { runtimeBand, type TitleFacts } from '@/pure';
import { airedTotalOf } from '@/show-status';

/** '1994' -> '1990s'. Anything that isn't a plausible year is no decade. */
function decadeOf(year: string | null | undefined): string | null {
  const n = Number((year ?? '').slice(0, 4));
  return n >= 1900 && n <= 2999 ? `${Math.floor(n / 10) * 10}s` : null;
}

/**
 * Which progress bucket a show is in -- the same six the sheet has always
 * offered, now as names rather than list indexes so a preset written today
 * still means the same thing if the list is ever reordered.
 */
export function showProgressClass(sp: ShowProgress): string {
  if (sp.finished) return 'finished'; // user manually marked complete
  if (sp.archived) return 'stopped';
  const seen = Math.max(sp.watched, sp.episodesSeen);
  if (seen === 0) return 'notStarted';
  const total = airedTotalOf(sp.tvdbId);
  if (total && seen >= total) {
    const m = showMeta(sp.tvdbId);
    const ended = m?.status === 'Ended' || m?.status === 'Canceled';
    const hasUnaired = (m?.totalEpisodes ?? 0) > total;
    return ended && !hasUnaired ? 'finished' : 'upToDate';
  }
  return 'watching';
}

export function showFacts(rows: readonly ShowProgress[]): TitleFacts[] {
  const extra = getShowFilterFacts();
  return rows.map((sp) => {
    const m = showMeta(sp.tvdbId);
    const x = extra.get(sp.tvdbId);
    return {
      key: String(sp.tvdbId),
      progress: showProgressClass(sp),
      genres: m?.genres ?? [],
      network: m?.network ?? null,
      decade: decadeOf(m?.year),
      runtime: runtimeBand(m?.runtime, 'show'),
      watchedYears: x?.years ?? [],
      stars: x?.stars ?? null,
    };
  });
}

export function movieFacts(rows: readonly MovieRow[]): TitleFacts[] {
  return rows.map((mv) => {
    const m = movieMeta(mv.tmdbId);
    // the metadata runtime is MINUTES; the movies column is SECONDS (see
    // getMovieTotals) -- mixing them would file half the library as "short"
    const minutes = m?.runtime ?? (mv.runtime != null && mv.runtime > 0 ? Math.round(mv.runtime / 60) : null);
    const watched = mv.watchedAt?.slice(0, 4);
    return {
      key: mv.name,
      progress: mv.watchedAt != null ? 'watched' : 'notWatched',
      genres: m?.genres ?? [],
      network: null, // films have no network, and the axis is absent for them
      decade: decadeOf(mv.year ?? mv.releaseDate ?? m?.release),
      runtime: runtimeBand(minutes, 'movie'),
      watchedYears: watched && /^\d{4}$/.test(watched) ? [watched] : [],
      stars: mv.stars,
    };
  });
}
