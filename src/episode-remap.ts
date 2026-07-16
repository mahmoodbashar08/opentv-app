/**
 * TVDB → TMDB episode remapping. TV Time's export numbers episodes the TVDB
 * way; all our metadata speaks TMDB. When the two disagree (merged two-part
 * finales, anime renumbered as one long season), imported rows point at
 * episodes that don't exist here — "orphans". The export carries a TVDB
 * episode id on every row and TMDB stores the same id per episode, so
 * orphans resolve exactly instead of by guesswork.
 *
 * meta keys, all per show:
 *  tvdbRowIds:{id}  "season-episode" (TVDB numbering) → TVDB episode id,
 *                   recorded at import from the export's episode_id column
 *  tvdbEpMap:{id}   TVDB episode id → "season-episode" (TMDB numbering),
 *                   fetched once from TMDB per-episode external ids
 *  epRemap:{id}     the 1:1 moves applied — the exporter reverses them so
 *                   a round-trip export keeps TV Time's own numbering
 */
import db, { getMeta, setMeta } from '@/db';
import { showMeta } from '@/metadata';
import { pool, tmdb } from '@/tmdb';

const EP_TABLES = ['watches', 'episode_ratings', 'episode_watched_on', 'episode_emotions', 'character_votes'] as const;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = getMeta(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Merge freshly-imported TVDB episode ids into the per-show record. */
export function recordTvdbRowIds(showId: number, ids: Record<string, number>): void {
  if (Object.keys(ids).length === 0) return;
  const key = `tvdbRowIds:${showId}`;
  setMeta(key, JSON.stringify({ ...readJson<Record<string, number>>(key, {}), ...ids }));
}

/** TVDB episode id → TMDB "season-episode" for one show. Cached with a
 * fingerprint of how many episodes it covered — when the show's episode list
 * grows (new season, healed metadata), the map rebuilds instead of blocking
 * newer orphans forever. Returns null when TMDB couldn't be reached for part
 * of the show (retry on a later pass, never cached). */
async function tvdbEpisodeMap(showId: number, tmdbId: number, episodeKeys: string[]): Promise<Map<number, string> | null> {
  const cacheKey = `tvdbEpMap:${showId}`;
  const cached = readJson<{ n?: number; map?: Record<string, string> } | null>(cacheKey, null);
  if (cached?.map && (cached.n ?? 0) >= episodeKeys.length) {
    return new Map(Object.entries(cached.map).map(([id, se]) => [Number(id), se]));
  }

  const entries: [number, string][] = [];
  let failed = 0;
  await pool(
    episodeKeys,
    async (key) => {
      const [season, episode] = key.split('-').map(Number);
      try {
        const ext = await tmdb<{ tvdb_id?: number | null }>(`/tv/${tmdbId}/season/${season}/episode/${episode}/external_ids`);
        if (ext.tvdb_id) entries.push([ext.tvdb_id, key]);
      } catch {
        failed++;
      }
      return null;
    },
    8,
  );
  if (failed > 0) return null; // partial map must not be cached as truth
  setMeta(cacheKey, JSON.stringify({ n: episodeKeys.length, map: Object.fromEntries(entries.map(([id, se]) => [String(id), se])) }));
  return new Map(entries);
}

/** Move every episode-keyed row from one (season, episode) to another.
 * When the target already has a watch row, the redundant first-watch is
 * dropped but rewatch history still moves — same aired content, and rewatch
 * events must never disappear. Returns true when the primary rows moved
 * (i.e. the target now carries the orphan's identity). */
function moveEpisodeRows(showId: number, from: { s: number; e: number }, to: { s: number; e: number }): boolean {
  const targetWatched = db.getFirstSync<{ x: number }>(
    'SELECT 1 AS x FROM watches WHERE showId = ? AND season = ? AND episode = ? LIMIT 1',
    [showId, to.s, to.e],
  );
  if (targetWatched) {
    db.runSync('DELETE FROM watches WHERE showId = ? AND season = ? AND episode = ? AND rewatch = 0', [showId, from.s, from.e]);
  }
  db.runSync('UPDATE watches SET season = ?, episode = ? WHERE showId = ? AND season = ? AND episode = ?', [
    to.s,
    to.e,
    showId,
    from.s,
    from.e,
  ]);
  for (const table of ['episode_ratings', 'episode_watched_on', 'episode_emotions', 'character_votes'] as const) {
    db.runSync(`UPDATE OR IGNORE ${table} SET season = ?, episode = ? WHERE showId = ? AND season = ? AND episode = ?`, [
      to.s,
      to.e,
      showId,
      from.s,
      from.e,
    ]);
    db.runSync(`DELETE FROM ${table} WHERE showId = ? AND season = ? AND episode = ?`, [showId, from.s, from.e]);
  }
  return !targetWatched;
}

const inFlight = new Set<number>();

/** Find rows of one show that point outside TMDB's episode structure and put
 * them where they belong: exact id match first, then the merged-two-parter
 * fold. Safe to call any time; no-ops in one cheap query when nothing is
 * orphaned. Runs after import and whenever a show's metadata first arrives. */
export async function remapOrphanEpisodes(showId: number): Promise<void> {
  if (inFlight.has(showId)) return;
  inFlight.add(showId);
  try {
    const m = showMeta(showId);
    if (!m || Object.keys(m.episodes).length === 0) return;

    const orphans: { s: number; e: number }[] = [];
    const seen = new Set<string>();
    for (const table of EP_TABLES) {
      for (const row of db.getAllSync<{ season: number; episode: number }>(
        `SELECT DISTINCT season, episode FROM ${table} WHERE showId = ?`,
        [showId],
      )) {
        const key = `${row.season}-${row.episode}`;
        if (seen.has(key) || m.episodes[key]) continue;
        seen.add(key);
        orphans.push({ s: row.season, e: row.episode });
      }
    }
    if (orphans.length === 0) return;

    const rowIds = readJson<Record<string, number>>(`tvdbRowIds:${showId}`, {});
    const applied = readJson<Record<string, string>>(`epRemap:${showId}`, {});
    // a row that was remapped before keeps its TVDB identity under the
    // position it moved to — resolve ids through that record, not the raw key
    const tvdbIdOf = (key: string) => rowIds[applied[key] ?? key];
    const withIds = orphans.filter((o) => tvdbIdOf(`${o.s}-${o.e}`));
    const epMap = withIds.length > 0 ? await tvdbEpisodeMap(showId, m.tmdbId, Object.keys(m.episodes)) : new Map<number, string>();

    let appliedChanged = false;
    for (const o of orphans) {
      const fromKey = `${o.s}-${o.e}`;
      const id = tvdbIdOf(fromKey);
      const target = id ? epMap?.get(id) : undefined;
      if (target && target !== fromKey) {
        const [ts, te] = target.split('-').map(Number);
        if (moveEpisodeRows(showId, o, { s: ts, e: te })) {
          applied[target] = applied[fromKey] ?? fromKey; // keyed by TMDB position, for the exporter
          appliedChanged = true;
        }
        if (applied[fromKey]) {
          delete applied[fromKey];
          appliedChanged = true;
        }
        continue;
      }
      // merged two-parter: TVDB counts one more episode at the season's end
      // than TMDB — part 2's id exists on no TMDB episode, but it IS the
      // tail of the season's last episode. Fold ONLY on that exact evidence:
      // the row carries a TVDB id (imported, not an in-app check-in that
      // stale metadata mislabels) and a COMPLETE id map failed to place it.
      const count = m.seasons[String(o.s)]?.count ?? 0;
      if (epMap && id && o.s !== 0 && count > 0 && o.e === count + 1) {
        moveEpisodeRows(showId, o, { s: o.s, e: count });
      }
      // anything else stays put: excluded from progress by the aired-total
      // clamp, and a later pass retries once TMDB is reachable again
    }
    if (appliedChanged) setMeta(`epRemap:${showId}`, JSON.stringify(applied));
  } finally {
    inFlight.delete(showId);
  }
}

/** TMDB "season-episode" → original TVDB {s, e} for one show, for exports. */
export function exportRemapOf(showId: number): Map<string, { s: number; e: number }> {
  const applied = readJson<Record<string, string>>(`epRemap:${showId}`, {});
  return new Map(
    Object.entries(applied).map(([to, from]) => {
      const [s, e] = from.split('-').map(Number);
      return [to, { s, e }];
    }),
  );
}

/** All recorded TVDB episode ids of one show, keyed "season-episode" in the
 * original TVDB numbering — callers cache this per show when iterating rows. */
export function tvdbRowIdsOf(showId: number): Record<string, number> {
  return readJson<Record<string, number>>(`tvdbRowIds:${showId}`, {});
}
