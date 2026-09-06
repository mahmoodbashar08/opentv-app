/**
 * Bringing Jellyfin's watch history into the library — the twin of
 * `plex-sync.ts`, and deliberately the same shape: fetch, resolve ids, hand
 * every decision to `externalWatchesToApply`, record where it got to.
 *
 * THE SESSION LIVES IN THE KEYCHAIN. The token is a credential to somebody
 * else's server; `meta` is a plain table in a database that is exported,
 * backed up and restored. The server address alone is kept in `meta` so the
 * screen can say where it is connected to without touching the Keychain.
 *
 * THE DEVICE ID DOES NOT. Jellyfin ties a session to the device id that asked
 * for it and lists it by that id; a new one every launch would be a new device
 * in the user's session list every launch.
 */
import * as SecureStore from 'expo-secure-store';

import { getMeta, setMeta } from '@/db';
import type { JellyfinSession } from '@/jellyfin';
import { externalWatchKey, externalWatchesToApply, nextWatchWatermark, type ExternalWatchRow } from '@/pure';

const SESSION_KEY = 'opentv.jellyfin.session';
const DEVICE_KEY = 'jellyfinDeviceId';
const SERVER_KEY = 'jellyfinServer';
const MARK_KEY = 'jellyfinWatermark';
const LAST_KEY = 'jellyfinLastSync';

export function jellyfinDeviceId(): string {
  const existing = getMeta(DEVICE_KEY);
  if (existing) return existing;
  const id = `opentv-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  setMeta(DEVICE_KEY, id);
  return id;
}

export async function getJellyfinSession(): Promise<JellyfinSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<JellyfinSession>;
    return s.server && s.token && s.userId ? { server: s.server, token: s.token, userId: s.userId } : null;
  } catch {
    return null;
  }
}

export async function setJellyfinSession(s: JellyfinSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(s));
  setMeta(SERVER_KEY, s.server);
}

/** The address, for the screen. Not a secret. */
export function jellyfinServer(): string | null {
  return getMeta(SERVER_KEY) || null;
}

/** Disconnect. The watermark goes with the session — see `disconnectPlex`. */
export async function disconnectJellyfin(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch {
    // Already gone. A session nothing reads is inert.
  }
  setMeta(SERVER_KEY, '');
  setMeta(MARK_KEY, '');
  setMeta(LAST_KEY, '');
}

export function jellyfinSyncedAt(): string | null {
  return getMeta(LAST_KEY) || null;
}

export type JellyfinOutcome = { applied: number; scanned: number; ran: boolean };

/** One pass. Free with no session; one request with nothing new. */
export async function syncJellyfin(): Promise<JellyfinOutcome> {
  const session = await getJellyfinSession();
  if (!session) return { applied: 0, scanned: 0, ran: false };

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const jf = require('@/jellyfin') as typeof import('@/jellyfin');
  const deviceId = jellyfinDeviceId();
  const since = getMeta(MARK_KEY) || null;

  const watched = await jf.fetchWatched(session, deviceId, since);
  if (watched.length === 0) {
    setMeta(LAST_KEY, new Date().toISOString());
    return { applied: 0, scanned: 0, ran: true };
  }
  const ids = await jf.seriesTvdbIds(session, deviceId, [...new Set(watched.map((w) => w.seriesId))]);
  const rows: ExternalWatchRow[] = [];
  for (const w of watched) {
    const tvdbId = ids.get(w.seriesId);
    if (tvdbId == null) continue;
    rows.push({ tvdbId, season: w.season, episode: w.episode, watchedAt: w.watchedAt });
  }
  if (rows.length === 0) {
    setMeta(LAST_KEY, new Date().toISOString());
    return { applied: 0, scanned: 0, ran: true };
  }

  // The library, read once — see `plex-sync.ts` for why per row is wrong.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db = require('@/db') as typeof import('@/db');
  const tracked = new Set<number>();
  const already = new Set<string>();
  for (const id of new Set(rows.map((r) => r.tvdbId))) {
    if (!db.getShowBrief(id)) continue;
    tracked.add(id);
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
      // One row failing must not abandon the rest.
    }
  }
  setMeta(MARK_KEY, nextWatchWatermark(rows, since) ?? '');
  setMeta(LAST_KEY, new Date().toISOString());
  return { applied: toApply.length, scanned: rows.length, ran: true };
}
