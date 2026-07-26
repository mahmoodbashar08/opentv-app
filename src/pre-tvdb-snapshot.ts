/**
 * A copy of every episode-keyed row, taken once, immediately before the 1.2.0
 * migration moves anything.
 *
 * The migration re-numbers watch history across five tables. That is the most
 * invasive thing the app has ever done to a user's data, and the two existing
 * safety nets don't cover it:
 *
 *  - the preserved TV Time ZIP restores what was *imported*, but not a single
 *    episode checked off inside OpenTV since;
 *  - `epRemap:` records the moves the old remapper logged, but not the rows it
 *    dropped on a conflict (`episode-remap.ts:83`, now deleted).
 *
 * So the pre-migration state is captured verbatim first and kept afterwards.
 * Nothing here is ever auto-deleted: once TheTVDB numbering is in place these
 * tables simply stop being read. They exist so the change is reversible on a
 * real device, by a real user, without a re-import.
 */
import db, { getMeta, setMeta } from '@/db';

/** Every table keyed by (showId, season, episode). */
const TABLES = ['watches', 'episode_ratings', 'episode_watched_on', 'episode_emotions', 'character_votes'] as const;

const SNAPSHOT_AT = 'preTvdbSnapshotAt';
const SNAPSHOT_COUNTS = 'preTvdbSnapshotCounts';

function ensureTable(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS pre_tvdb_rows (
      kind TEXT NOT NULL,
      payload TEXT NOT NULL
    );
  `);
}

/** ISO timestamp of the snapshot, or null if none was ever taken. */
export function snapshotTakenAt(): string | null {
  return getMeta(SNAPSHOT_AT) || null;
}

/** Row counts at the time of the snapshot, for the confirmation dialog. */
export function snapshotCounts(): Record<string, number> {
  try {
    return JSON.parse(getMeta(SNAPSHOT_COUNTS) || '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * Copy every episode-keyed row aside. Runs ONCE — a second call is a no-op, so
 * a migration that fails and retries next launch can't overwrite the original
 * pre-migration state with a half-migrated one.
 *
 * Row-by-row rather than one big JSON blob: a large library is tens of
 * thousands of watches, and building that string in memory on a phone is how
 * you get an OOM on the exact launch you most need to not crash.
 */
export function takeSnapshot(): void {
  if (snapshotTakenAt()) return; // already have the real pre-migration state
  try {
    ensureTable();
    const counts: Record<string, number> = {};
    db.withTransactionSync(() => {
      db.runSync('DELETE FROM pre_tvdb_rows');
      for (const table of TABLES) {
        const rows = db.getAllSync<Record<string, unknown>>(`SELECT * FROM ${table}`);
        counts[table] = rows.length;
        for (const r of rows) {
          db.runSync('INSERT INTO pre_tvdb_rows (kind, payload) VALUES (?, ?)', [table, JSON.stringify(r)]);
        }
      }
    });
    setMeta(SNAPSHOT_COUNTS, JSON.stringify(counts));
    // stamped LAST: a crash mid-copy leaves no timestamp, so the next launch
    // retakes it rather than trusting a partial one
    setMeta(SNAPSHOT_AT, new Date().toISOString());
  } catch {
    // a failed snapshot must not block the migration, but it does mean the
    // undo isn't available — the ZIP re-import remains the fallback
  }
}

/**
 * Put every episode-keyed row back exactly as it was before the migration.
 *
 * Deliberately a full replace, not a merge: the point is to reproduce the old
 * state, and merging would leave migrated rows sitting alongside restored ones
 * at different positions — the duplicate mess this whole change exists to end.
 *
 * The snapshot itself is kept, so this is repeatable and can't strand anyone.
 */
export function restoreSnapshot(): boolean {
  if (!snapshotTakenAt()) return false;
  try {
    ensureTable();
    db.withTransactionSync(() => {
      for (const table of TABLES) {
        const saved = db.getAllSync<{ payload: string }>('SELECT payload FROM pre_tvdb_rows WHERE kind = ?', [table]);
        db.runSync(`DELETE FROM ${table}`);
        for (const { payload } of saved) {
          const row = JSON.parse(payload) as Record<string, unknown>;
          const cols = Object.keys(row);
          if (!cols.length) continue;
          db.runSync(
            `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
            cols.map((c) => row[c] as string | number | null),
          );
        }
      }
    });
    // counters are derived from the rows we just replaced
    db.execSync(`
      UPDATE shows SET episodesSeen = (
        SELECT COUNT(DISTINCT season || '-' || episode) FROM watches WHERE watches.showId = shows.tvdbId
      )
    `);
    return true;
  } catch {
    return false;
  }
}

/** Free the space, once the user is satisfied the migration went well. Only
 *  ever called from an explicit action — never automatically. */
export function discardSnapshot(): void {
  try {
    db.execSync('DROP TABLE IF EXISTS pre_tvdb_rows');
    setMeta(SNAPSHOT_AT, '');
    setMeta(SNAPSHOT_COUNTS, '');
  } catch {
    // nothing to do — worst case the table lingers, which is harmless
  }
}

/** How much room the snapshot is taking, roughly, for the Settings row. */
export function snapshotRowCount(): number {
  try {
    return db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM pre_tvdb_rows')?.n ?? 0;
  } catch {
    return 0;
  }
}
