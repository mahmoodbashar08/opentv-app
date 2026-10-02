/**
 * Stremio, as a source of episodes watched somewhere this app cannot see —
 * the third after Plex and Jellyfin, and the same standing: read-only, ids
 * never names, the phone stays the source of truth.
 *
 * THE API IS UNOFFICIAL. Stremio publishes no API for this; these are the two
 * calls its own apps make (`api.strem.io` for the account and library, Cinemeta
 * for a series' episode list). They can change without notice, so every call
 * here fails to null and the sync simply does nothing that day.
 *
 * WHAT IT CAN AND CANNOT SAY. A library item records WHICH episodes are watched
 * (a bitfield, see `decodeStremioWatched`) and when the item was last watched,
 * not when each episode was. So episodes arrive with the sync's own date, the
 * same as Jellyfin's, and that is said on the screen rather than discovered.
 */
const API = 'https://api.strem.io/api';
const CINEMETA = 'https://v3-cinemeta.strem.io';

export type StremioSession = { authKey: string; email: string };

async function call<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: T; error?: unknown };
    return json.error ? null : (json.result ?? null);
  } catch {
    return null;
  }
}

/** The password goes to Stremio once, for an auth key, and is not kept. */
export async function stremioLogin(email: string, password: string): Promise<StremioSession | null> {
  const r = await call<{ authKey?: string }>('login', { type: 'Login', email, password, facebook: false });
  return r?.authKey ? { authKey: r.authKey, email } : null;
}

export type StremioItem = {
  _id: string;
  type: string;
  removed?: boolean;
  temp?: boolean;
  _mtime?: string;
  state?: { watched?: string | null; lastWatched?: string | null; timesWatched?: number };
};

/** Every library item, or null when Stremio cannot be asked. */
export async function stremioLibrary(s: StremioSession): Promise<StremioItem[] | null> {
  return call<StremioItem[]>('datastoreGet', { type: 'DatastoreGet', authKey: s.authKey, collection: 'libraryItem', ids: [], all: true });
}

/** A series' episodes from Cinemeta, as Stremio itself sees them. */
export async function stremioEpisodes(imdbId: string): Promise<{ id: string; season?: number; episode?: number; released?: string }[] | null> {
  try {
    const res = await fetch(`${CINEMETA}/meta/series/${encodeURIComponent(imdbId)}.json`);
    if (!res.ok) return null;
    const json = (await res.json()) as { meta?: { videos?: { id: string; season?: number; episode?: number; released?: string }[] } };
    return json.meta?.videos ?? null;
  } catch {
    return null;
  }
}
