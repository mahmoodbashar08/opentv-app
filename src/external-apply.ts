/**
 * The write half every external source shares — Simkl and Nuvio so far; Plex,
 * Jellyfin, Stremio and Trakt still carry their own copy of the same lines.
 *
 * EVERY DECISION IS `externalWatchesToApply`'s: not in the library, already
 * watched, season 0, the same episode twice in one batch. This reads the
 * library once (a query per row would be a query per episode, and a first
 * sync can bring thousands), asks it, and writes what survives.
 *
 * WITH THE SOURCE'S DATE where it has one. `markWatched` takes the moment, and
 * streaks, the calendar and Wrapped all read it; a watch with no usable date
 * falls back to now, as Plex's always have.
 */
import { externalWatchKey, externalWatchesToApply, watchStampFromIso, type ExternalWatchRow } from '@/pure';

export function applyExternalWatches(rows: readonly ExternalWatchRow[]): number {
  if (rows.length === 0) return 0;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db = require('@/db') as typeof import('@/db');
  const tracked = new Set<number>();
  const watched = new Set<string>();
  for (const id of new Set(rows.map((r) => r.tvdbId))) {
    // An unknown show has no watched set AND no row; `getWatchedSet` answers
    // empty for both, so tracking is asked separately.
    if (!db.getShowBrief(id)) continue;
    tracked.add(id);
    // `getWatchedSet` answers `season-episode`; the comparison key is built by
    // `externalWatchKey` so the two cannot drift apart. On the Trakt path they had.
    for (const k of db.getWatchedSet(id)) {
      const [se, ep] = k.split('-');
      watched.add(externalWatchKey(id, Number(se), Number(ep)));
    }
  }
  const toApply = externalWatchesToApply(rows, { tracked, watched });
  let applied = 0;
  for (const r of toApply) {
    try {
      const at = watchStampFromIso(r.watchedAt);
      if (at) db.markWatched(r.tvdbId, r.season, r.episode, at);
      else db.markWatched(r.tvdbId, r.season, r.episode);
      applied++;
    } catch {
      // One row failing must not abandon the rest.
    }
  }
  return applied;
}
