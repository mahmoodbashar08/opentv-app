/**
 * Bringing Stremio's watched episodes into the library — the twin of
 * `jellyfin-sync.ts`, and deliberately the same shape: fetch, resolve ids,
 * hand every decision to `externalWatchesToApply`, record where it got to.
 *
 * TRACKED SHOWS ONLY, like Plex and Jellyfin: a Stremio library is full of
 * things somebody opened once, and adding every one of them as a show would
 * fill the Shows tab with strangers.
 *
 * IDS, NEVER NAMES. Stremio keys everything by IMDb id; TheTVDB answers which
 * of its shows that is (`tvdbSeriesByImdbId`), and the answer — including "no
 * such show" — is remembered, so a library is resolved once, not every launch.
 *
 * THE WATERMARK IS THE ITEM'S `_mtime`. Stremio stamps an item whenever its
 * state changes, so an item not touched since the last pass has nothing new and
 * costs nothing: no Cinemeta request, no decoding.
 */
import * as SecureStore from 'expo-secure-store';
import { unzlibSync } from 'fflate';

import { getMeta, setMeta } from '@/db';
import { decodeStremioWatched, externalWatchKey, externalWatchesToApply, parseStremioVideoId, stremioVideoOrder, type ExternalWatchRow } from '@/pure';
import type { StremioSession } from '@/stremio';

const SESSION_KEY = 'opentv.stremio.session';
const EMAIL_KEY = 'stremioEmail';
const MARK_KEY = 'stremioWatermark';
const LAST_KEY = 'stremioLastSync';
const ID_PREFIX = 'stremioTvdb:';

export async function getStremioSession(): Promise<StremioSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<StremioSession>;
    return s.authKey && s.email ? { authKey: s.authKey, email: s.email } : null;
  } catch {
    return null;
  }
}

export async function setStremioSession(s: StremioSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(s));
  setMeta(EMAIL_KEY, s.email);
}

/** Which account is connected, for the screen. */
export function stremioEmail(): string | null {
  return getMeta(EMAIL_KEY) || null;
}

export async function disconnectStremio(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch {
    // Already gone.
  }
  setMeta(EMAIL_KEY, '');
  setMeta(MARK_KEY, '');
  setMeta(LAST_KEY, '');
}

export function stremioSyncedAt(): string | null {
  return getMeta(LAST_KEY) || null;
}

/** IMDb → TheTVDB, asked once per show and remembered (0 = TheTVDB has none). */
async function tvdbFor(imdb: string): Promise<number | null> {
  const known = getMeta(ID_PREFIX + imdb);
  if (known) return Number(known) || null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tvdbSeriesByImdbId } = require('@/tvdb') as typeof import('@/tvdb');
  const id = await tvdbSeriesByImdbId(imdb);
  // Only a definite answer is remembered; a failed request is asked again.
  if (id != null) setMeta(ID_PREFIX + imdb, String(id));
  return id;
}

export type StremioOutcome = { applied: number; scanned: number; ran: boolean };

/** One pass. Free with no session; one request when nothing changed. */
export async function syncStremio(): Promise<StremioOutcome> {
  const session = await getStremioSession();
  if (!session) return { applied: 0, scanned: 0, ran: false };

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const st = require('@/stremio') as typeof import('@/stremio');
  const items = await st.stremioLibrary(session);
  if (!items) return { applied: 0, scanned: 0, ran: false };

  const since = getMeta(MARK_KEY) || '';
  const changed = items.filter((i) => i.type === 'series' && !i.removed && typeof i.state?.watched === 'string' && (i._mtime ?? '') > since);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db = require('@/db') as typeof import('@/db');
  const now = new Date().toISOString();
  const rows: ExternalWatchRow[] = [];
  let mark = since;
  for (const item of changed) {
    if ((item._mtime ?? '') > mark) mark = item._mtime ?? mark;
    const tvdbId = await tvdbFor(item._id);
    // Not a show this person tracks: no episode list is fetched for it.
    if (tvdbId == null || !db.getShowBrief(tvdbId)) continue;
    const episodes = await st.stremioEpisodes(item._id);
    if (!episodes) continue;
    const order = stremioVideoOrder(episodes.map((e) => ({ id: e.id, season: e.season, episode: e.episode, released: e.released })));
    for (const id of decodeStremioWatched(item.state!.watched!, order, unzlibSync)) {
      const ep = parseStremioVideoId(id);
      if (ep && ep.season > 0) rows.push({ tvdbId, season: ep.season, episode: ep.episode, watchedAt: now });
    }
  }

  const tracked = new Set<number>();
  const already = new Set<string>();
  for (const id of new Set(rows.map((r) => r.tvdbId))) {
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
  setMeta(MARK_KEY, mark);
  setMeta(LAST_KEY, now);
  return { applied: toApply.length, scanned: rows.length, ran: true };
}
