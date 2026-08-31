/**
 * Bringing Plex's watch history into the library.
 *
 * THE PHONE STAYS THE SOURCE OF TRUTH. This reads from Plex and writes to
 * SQLite, never the other way, and never anything but episodes of shows the
 * user already tracks.
 *
 * EVERY DECISION IS IN `externalWatchesToApply`, not here, because a scrobbler's
 * failures are silent and cumulative: a duplicate tick looks like nothing on
 * screen while every total, streak and chart built on it drifts. That function
 * has a test per refusal, it is shared with the Trakt path, and it does not
 * know or care which source it is deciding about. This file only fetches,
 * applies and records where it got to.
 *
 * THE TOKEN LIVES IN THE KEYCHAIN, like the community session and for the same
 * reason: it is a credential to somebody else's server, and `meta` is a plain
 * table inside a database that gets exported, backed up and restored.
 *
 * THE CLIENT IDENTIFIER DOES NOT. It is not a secret — Plex shows it in the
 * user's own device list — and it must survive a Keychain that has been cleared
 * without the app losing the identity its authorisation is attached to.
 */
import * as SecureStore from 'expo-secure-store';

import { getMeta, setMeta } from '@/db';
import { externalWatchKey, externalWatchesToApply, nextWatchWatermark, type ExternalWatchRow } from '@/pure';

const TOKEN_KEY = 'opentv.plex.token';
/** Stable per install. See the header for why this is not in the Keychain. */
const CLIENT_KEY = 'plexClientId';
/** ISO instant of the newest watch already applied. See `nextWatchWatermark`. */
const MARK_KEY = 'plexWatermark';
/** Set once a sync has run, so the UI can say when rather than guessing. */
const LAST_KEY = 'plexLastSync';

/**
 * This installation's identity to Plex.
 *
 * GENERATED ONCE AND KEPT. Plex ties an authorisation to the client identifier
 * that asked for it, so a new one on every launch would mean a new device in
 * the user's Plex account every launch, and a token that no longer matches the
 * client presenting it.
 */
export function plexClientId(): string {
  const existing = getMeta(CLIENT_KEY);
  if (existing) return existing;
  const id = `opentv-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  setMeta(CLIENT_KEY, id);
  return id;
}

export async function getPlexToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setPlexToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

/**
 * Disconnect. The watermark goes with the token, deliberately: reconnecting a
 * DIFFERENT Plex account against the old mark would skip everything that account
 * watched before it — the same class of bug as a publish fingerprint that
 * records the shape of a library but not whose it is.
 */
export async function disconnectPlex(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Already gone, or the Keychain is unavailable. A token nothing reads is
    // inert either way.
  }
  setMeta(MARK_KEY, '');
  setMeta(LAST_KEY, '');
}

export function plexSyncedAt(): string | null {
  return getMeta(LAST_KEY) || null;
}

export type PlexOutcome = { applied: number; scanned: number; ran: boolean; servers: number };

/**
 * One pass. Safe to call on every launch: with no token it costs nothing at
 * all, and with nothing new it costs one request per server.
 */
export async function syncPlex(): Promise<PlexOutcome> {
  const token = await getPlexToken();
  if (!token) return { applied: 0, scanned: 0, ran: false, servers: 0 };

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const plex = require('@/plex') as typeof import('@/plex');
  const clientId = plexClientId();
  const since = getMeta(MARK_KEY) || null;

  const servers = await plex.findServers(clientId, token);
  // No server reachable is not a failure worth recording: the phone may simply
  // be away from home. The watermark does not move, so nothing is skipped.
  if (servers.length === 0) return { applied: 0, scanned: 0, ran: false, servers: 0 };

  const rows: ExternalWatchRow[] = [];
  for (const server of servers) {
    const watched = await plex.fetchWatched(server, clientId, since);
    if (watched.length === 0) continue;
    /*
     * THE SHOW IDS, ONE LOOKUP PER SHOW. Plex keys an episode by its show's
     * internal rating key; only the show's own metadata carries the TheTVDB
     * GUID. A show Plex could not match to TheTVDB is absent from this map, so
     * its episodes carry no id and are dropped here — before the decision layer
     * ever sees them, and without anything being guessed from a title.
     */
    const ids = await plex.showTvdbIds(server, clientId, [...new Set(watched.map((w) => w.showKey))]);
    for (const w of watched) {
      const tvdbId = ids.get(w.showKey);
      if (tvdbId == null) continue;
      rows.push({ tvdbId, season: w.season, episode: w.episode, watchedAt: w.watchedAt });
    }
  }

  if (rows.length === 0) {
    setMeta(LAST_KEY, new Date().toISOString());
    return { applied: 0, scanned: 0, ran: true, servers: servers.length };
  }

  /*
   * THE LIBRARY, READ ONCE. Asking per row would be a query per episode and a
   * long-standing server can return hundreds in a batch. `tracked` is what the
   * user chose to follow; `watched` is what is already recorded, and the two
   * together are every question `externalWatchesToApply` needs to answer.
   */
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db = require('@/db') as typeof import('@/db');
  const tracked = new Set<number>();
  const already = new Set<string>();
  for (const id of new Set(rows.map((r) => r.tvdbId))) {
    // An unknown show has no watched set AND no row; `getWatchedSet` answers
    // empty for both, so tracking is asked separately.
    if (!db.getShowBrief(id)) continue;
    tracked.add(id);
    // `getWatchedSet` answers `season-episode`; the comparison key is built by
    // `externalWatchKey` so the two cannot drift apart. On the Trakt path, they
    // already had.
    for (const k of db.getWatchedSet(id)) {
      const [se, ep] = k.split('-');
      already.add(externalWatchKey(id, Number(se), Number(ep)));
    }
  }

  const toApply = externalWatchesToApply(rows, { tracked, watched: already });
  for (const r of toApply) {
    try {
      db.markWatched(r.tvdbId, r.season, r.episode);
    } catch {
      // One row failing must not abandon the rest, and the watermark below
      // still only advances over what was actually read.
    }
  }

  setMeta(MARK_KEY, nextWatchWatermark(rows, since) ?? '');
  setMeta(LAST_KEY, new Date().toISOString());
  return { applied: toApply.length, scanned: rows.length, ran: true, servers: servers.length };
}
