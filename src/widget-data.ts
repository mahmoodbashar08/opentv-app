/**
 * Data for the home-screen widgets — computed from the on-device library, the
 * same way the app itself does (no server, like everything else).
 *
 * Up Next mirrors TV Time's watch-next semantics: for every followed show, the
 * first unwatched regular episode that has actually AIRED (announced/future
 * episodes never appear — the widget answers "what can I watch right now").
 * Shows you touched most recently come first, so the widget tracks whatever
 * you're currently bingeing.
 */
import db, { getMeta } from '@/db';
import { episodeMeta, showMeta } from '@/metadata';
import { heatWidgetData, type HeatWidgetData } from '@/pure';
import { watchDayCounts } from '@/stats-calc';
import { ACCENTS, colors, DEFAULT_ACCENT } from '@/theme';

export type UpNextItem = {
  showId: number;
  showName: string;
  season: number;
  episode: number;
  /** episode title when metadata has it */
  title: string | null;
  /** episode still, falling back to the show poster */
  image: string | null;
};

export type WatchlistMovie = {
  name: string;
  poster: string | null;
  year: string | null;
};

export function upNextList(limit = 8): UpNextItem[] {
  const shows = db.getAllSync<{ tvdbId: number; name: string; posterUrl: string | null; last: string | null }>(
    `SELECT s.tvdbId, s.name, s.posterUrl,
            (SELECT MAX(watchedAt) FROM watches w WHERE w.showId = s.tvdbId) AS last
     FROM shows s WHERE s.followed = 1 AND s.archived = 0
     ORDER BY last DESC NULLS LAST`,
  );
  const today = new Date().toISOString().slice(0, 10);
  const items: UpNextItem[] = [];
  for (const s of shows) {
    if (items.length >= limit) break;
    const m = showMeta(s.tvdbId);
    if (!m) continue; // no episode structure known — nothing to point at
    const watched = new Set(
      db
        .getAllSync<{ k: string }>(`SELECT DISTINCT season || '-' || episode AS k FROM watches WHERE showId = ?`, [
          s.tvdbId,
        ])
        .map((r) => r.k),
    );
    // regular seasons in order; specials never appear in Up Next
    const seasons = Object.keys(m.seasons)
      .map(Number)
      .filter((n) => n >= 1)
      .sort((a, b) => a - b);
    outer: for (const season of seasons) {
      const count = m.seasons[String(season)]?.count ?? 0;
      for (let ep = 1; ep <= count; ep++) {
        if (watched.has(`${season}-${ep}`)) continue;
        const em = m.episodes[`${season}-${ep}`];
        // aired = air date known and past, or unknown (same rule the progress
        // bars use — see airedTotalOf); a future date ends this show's scan:
        // everything after it is even further out
        if (em?.air && em.air > today) break outer;
        items.push({
          showId: s.tvdbId,
          showName: s.name,
          season,
          episode: ep,
          title: episodeMeta(s.tvdbId, season, ep)?.title ?? null,
          image: em?.still ?? m.poster ?? s.posterUrl,
        });
        break outer;
      }
    }
  }
  return items;
}

export function moviesToWatch(limit = 9): WatchlistMovie[] {
  return db.getAllSync<WatchlistMovie>(
    `SELECT name, poster, year FROM movies WHERE watchedAt IS NULL
     ORDER BY addedAt DESC NULLS LAST, name LIMIT ?`,
    [limit],
  );
}

/**
 * THE HEATMAP, FOR THE HOME SCREEN.
 *
 * The one thing this app has that nothing else does is years of dated watches,
 * and the grid is the only view that shows all of them at once — which makes
 * it the widget most worth having and the one least able to fetch anything.
 * So everything it needs is decided here and handed over flat: see
 * `heatWidgetData`.
 *
 * SIZE IS MONTHS. A small square has room for one month, a wide one for three,
 * a large one for six — the same trade the profile's own grid makes, because
 * six months of cells on a 2x2 tile are squares nobody can see.
 *
 * The accent is the profile theme when there is one, so the widget matches the
 * app it came from rather than shipping a second brand colour to the same home
 * screen.
 */
export function heatmapData(months = 6): HeatWidgetData {
  const accent = getMeta('profileThemeColor') || ACCENTS[DEFAULT_ACCENT];
  // Local, not UTC: an evening's watching east of GMT belongs to tonight's
  // square, and `endMonth` is whichever month that day falls in.
  const now = new Date();
  const endMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return heatWidgetData(watchDayCounts(), endMonth, months, accent, colors.raise);
}
