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
