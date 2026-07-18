import { useSyncExternalStore } from 'react';

/** Movie grid filters — set by the sheet, read by the Movies page. */
export type MovieFilters = {
  sort: 'lastWatched' | 'lastAdded' | 'alpha';
  progress: 'all' | 'watched' | 'notWatched';
};

export const DEFAULT_MOVIE_FILTERS: MovieFilters = { sort: 'lastWatched', progress: 'all' };

let movieFilters: MovieFilters = DEFAULT_MOVIE_FILTERS;
const subs = new Set<() => void>();

export function useMovieFilters(): MovieFilters {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => movieFilters,
  );
}

export function getMovieFilters(): MovieFilters {
  return movieFilters;
}

export function setMovieFilters(f: MovieFilters): void {
  movieFilters = f;
  subs.forEach((s) => s());
}

/** Show grid filters — sort/progress are indexes into the sheet's own lists.
 * Same per-visit lifetime as movies: the page resets them to defaults on open. */
export type ShowFilters = { sort: number; progress: number };
export const DEFAULT_SHOW_FILTERS: ShowFilters = { sort: 0, progress: 0 };

let showFilters: ShowFilters = DEFAULT_SHOW_FILTERS;
const showSubs = new Set<() => void>();

export function useShowFilters(): ShowFilters {
  return useSyncExternalStore(
    (cb) => {
      showSubs.add(cb);
      return () => showSubs.delete(cb);
    },
    () => showFilters,
  );
}

export function getShowFilters(): ShowFilters {
  return showFilters;
}

export function setShowFilters(f: ShowFilters): void {
  showFilters = f;
  showSubs.forEach((s) => s());
}
