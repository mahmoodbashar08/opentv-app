/**
 * Bringing Trakt's history into the library.
 *
 * THE PHONE STAYS THE SOURCE OF TRUTH. This reads from Trakt and writes to
 * SQLite, never the other way, and never anything but episodes of shows the
 * user already tracks. Trakt is treated as another export that happens to be
 * live — the same standing the GDPR ZIP has.
 *
 * EVERY DECISION IS IN `traktRowsToApply`, not here, because a scrobbler's
 * failures are silent and cumulative: a duplicate tick looks like nothing on
 * screen while every total, streak and chart built on it drifts. That function
 * has a test per refusal; this file only fetches, applies and records where it
 * got to.
 *
 * THE TOKEN LIVES IN THE KEYCHAIN, like the community session and for the same
 * reason: it is a credential to somebody else's account, and `meta` is a plain
 * table inside a database that gets exported, backed up and restored.
 */
import * as SecureStore from 'expo-secure-store';

import { getMeta, setMeta } from '@/db';
import { nextTraktWatermark, traktRowsToApply, traktWatchKey, type TraktWatchRow } from '@/pure';

const TOKEN_KEY = 'opentv.trakt.token';
/** ISO instant of the newest watch already applied. See `nextTraktWatermark`. */
const MARK_KEY = 'traktWatermark';
/** Set once a sync has run, so the UI can say when rather than guessing. */
const LAST_KEY = 'traktLastSync';

export async function getTraktToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setTraktToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

/**
 * Disconnect. The watermark goes with the token, deliberately: reconnecting a
 * different Trakt account against the old mark would skip everything that
 * account watched before it — the same class of bug as a publish fingerprint
 * that records the shape of a library but not whose it is.
 */
export async function disconnectTrakt(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Already gone, or the Keychain is unavailable. A token nothing reads is
    // inert either way.
  }
  setMeta(MARK_KEY, '');
  setMeta(LAST_KEY, '');
}

export function traktConnectedAt(): string | null {
  return getMeta(LAST_KEY) || null;
}

export type SyncOutcome = { applied: number; scanned: number; ran: boolean };

/**
 * One pass. Safe to call on every launch: with nothing new it costs one request
 * and writes nothing.
 */
export async function syncTrakt(): Promise<SyncOutcome> {
  const token = await getTraktToken();
  if (!token) return { applied: 0, scanned: 0, ran: false };

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { fetchHistory } = require('@/trakt') as typeof import('@/trakt');
  const since = getMeta(MARK_KEY) || null;

  let rows: TraktWatchRow[];
  try {
    rows = await fetchHistory(token, since);
  } catch {
    // Offline, rate-limited, or a revoked token. The watermark does not move,
    // so nothing is skipped — this simply runs again later.
    return { applied: 0, scanned: 0, ran: false };
  }
  if (!rows.length) {
    setMeta(LAST_KEY, new Date().toISOString());
    return { applied: 0, scanned: 0, ran: true };
  }

  /*
   * THE LIBRARY, READ ONCE. Asking per row would be a query per episode and a
   * Trakt account can return hundreds in a batch. `tracked` is what the user
   * chose to follow; `watched` is what is already recorded, and the two
   * together are every question `traktRowsToApply` needs to answer.
   */
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db = require('@/db') as typeof import('@/db');
  const tracked = new Set<number>();
  const watched = new Set<string>();
  for (const id of new Set(rows.map((r) => r.tvdbId))) {
    const set = db.getWatchedSet(id);
    // An unknown show has no watched set AND no row; `getWatchedSet` answers
    // empty for both, so tracking is asked separately.
    if (db.getShowBrief(id)) {
      tracked.add(id);
      // `getWatchedSet` answers `season-episode`; the comparison key is built
      // by `traktWatchKey` so the two cannot drift apart. They already had.
      for (const k of set) {
        const [se, ep] = k.split('-');
        watched.add(traktWatchKey(id, Number(se), Number(ep)));
      }
    }
  }

  const toApply = traktRowsToApply(rows, { tracked, watched });
  for (const r of toApply) {
    try {
      db.markWatched(r.tvdbId, r.season, r.episode);
    } catch {
      // One row failing must not abandon the rest, and the watermark below
      // still only advances over what was actually read.
    }
  }

  setMeta(MARK_KEY, nextTraktWatermark(rows, since) ?? '');
  setMeta(LAST_KEY, new Date().toISOString());
  return { applied: toApply.length, scanned: rows.length, ran: true };
}
