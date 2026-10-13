/**
 * Bringing a Nuvio account's watched episodes into the library — the Stremio
 * screen's twin (Nuvio is a Stremio-addon player), with the Stremio rules:
 * read-only, tracked shows only, ids never names, the phone stays the source
 * of truth, nothing about what was watched goes to OUR server.
 *
 * THE WATERMARK IS NUVIO'S OWN EVENT CURSOR, the bootstrap its document
 * prescribes ("Concepts → Incremental sync"): take the cursor, pull the whole
 * history once, and from then on read only events after it. Not `watched_at`:
 * a history row pushed late from another device can be dated last year, and a
 * date watermark would step straight over it.
 *
 * FAILS QUIETLY, ALL OF IT. The whole pass sits in one try, every Nuvio call
 * already answers null rather than throwing, and the cursor moves only after a
 * pass that read everything — so a Nuvio change costs a sync, never a library,
 * and never skips a row either. Simkl is the fallback for anyone it breaks for.
 */
import * as SecureStore from 'expo-secure-store';

import { getMeta, setMeta } from '@/db';
import { applyExternalWatches } from '@/external-apply';
import type { NuvioSession } from '@/nuvio';
import { nuvioContentRef, nuvioEpisodesFromRows, nuvioMaxEventId, type ExternalWatchRow, type NuvioEpisode } from '@/pure';

const SESSION_KEY = 'opentv.nuvio.session';
const EMAIL_KEY = 'nuvioEmail';
/** The last Nuvio history event applied; '' until the first full pull. */
const CURSOR_KEY = 'nuvioCursor';
const LAST_KEY = 'nuvioLastSync';
/** `nuvioTvdb:<content id>` → the TheTVDB id once found. */
const ID_PREFIX = 'nuvioTvdb:';

const PAGE = 1000;

export async function getNuvioSession(): Promise<NuvioSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<NuvioSession>;
    return s.access && s.refresh && s.email ? { access: s.access, refresh: s.refresh, email: s.email, profile: Number(s.profile) || 0 } : null;
  } catch {
    return null;
  }
}

export async function setNuvioSession(s: NuvioSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(s));
  setMeta(EMAIL_KEY, s.email);
}

/**
 * The account's profiles, for the picker, with a refreshed session — the one
 * from sign-in may be hours old by the time somebody comes back to choose.
 */
export async function nuvioProfileChoices(): Promise<{ index: number; name: string }[] | null> {
  try {
    const s = await getNuvioSession();
    if (!s) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nv = require('@/nuvio') as typeof import('@/nuvio');
    const fresh = await nv.nuvioRefresh(s.refresh);
    if (!fresh) return null;
    await setNuvioSession({ ...s, ...fresh });
    return await nv.nuvioProfiles(fresh.access);
  } catch {
    return null;
  }
}

/**
 * Which Nuvio profile to read. 0 means "not chosen yet": an account with more
 * than one profile does not sync until the user says which is theirs, or a
 * family's shared account would tick everybody's episodes into one library.
 * A different profile is a different history, so the cursor resets with it —
 * the same rule as disconnecting.
 */
export async function setNuvioProfile(profile: number): Promise<void> {
  const s = await getNuvioSession();
  if (!s || s.profile === profile) return;
  await setNuvioSession({ ...s, profile });
  setMeta(CURSOR_KEY, '');
}

export function nuvioEmail(): string | null {
  return getMeta(EMAIL_KEY) || null;
}

export function nuvioSyncedAt(): string | null {
  return getMeta(LAST_KEY) || null;
}

/** Disconnect. The cursor goes with the session, so another account starts with its own full pull. */
export async function disconnectNuvio(): Promise<void> {
  const s = await getNuvioSession();
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch {
    // Already gone.
  }
  if (s) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    void (require('@/nuvio') as typeof import('@/nuvio')).nuvioSignOut(s.access);
  }
  setMeta(EMAIL_KEY, '');
  setMeta(CURSOR_KEY, '');
  setMeta(LAST_KEY, '');
}

export type NuvioOutcome = { applied: number; scanned: number; ran: boolean };

/** One pass. Free with no session. */
export async function syncNuvio(): Promise<NuvioOutcome> {
  const none: NuvioOutcome = { applied: 0, scanned: 0, ran: false };
  try {
    const session = await getNuvioSession();
    if (!session || session.profile === 0) return none;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nv = require('@/nuvio') as typeof import('@/nuvio');

    // Every pass starts with a refresh: the access token lasts an hour, and
    // the refresh token ROTATES, so the new pair is saved before anything else
    // can fail — losing it would sign the user out.
    const fresh = await nv.nuvioRefresh(session.refresh);
    if (!fresh) return none;
    const s: NuvioSession = { ...session, ...fresh };
    await setNuvioSession(s);

    const cursorText = getMeta(CURSOR_KEY) || '';
    const episodes: NuvioEpisode[] = [];
    let cursor: number;
    if (cursorText === '') {
      // First pull: cursor FIRST, then the snapshot, so nothing that happens
      // in between is lost — it is simply read again as a delta next time.
      const c = await nv.nuvioCursor(s.access, s.profile);
      if (c == null) return none;
      for (let page = 1; page <= 100; page++) {
        const rows = await nv.nuvioWatchedPage(s.access, s.profile, page, PAGE);
        if (rows == null) return none;
        episodes.push(...nuvioEpisodesFromRows(rows));
        if (rows.length < PAGE) break;
      }
      cursor = c;
    } else {
      cursor = Number(cursorText) || 0;
      for (let i = 0; i < 50; i++) {
        const events = await nv.nuvioWatchedDelta(s.access, s.profile, cursor);
        if (events == null) return none;
        episodes.push(...nuvioEpisodesFromRows(events));
        cursor = nuvioMaxEventId(events, cursor);
        if (events.length < PAGE) break;
      }
    }

    const rows: ExternalWatchRow[] = [];
    const ids = new Map<string, number | null>();
    for (const e of episodes) {
      if (!ids.has(e.contentId)) ids.set(e.contentId, await tvdbFor(e.contentId));
      const tvdbId = ids.get(e.contentId);
      if (tvdbId != null) rows.push({ tvdbId, season: e.season, episode: e.episode, watchedAt: e.watchedAt });
    }
    const applied = applyExternalWatches(rows);
    setMeta(CURSOR_KEY, String(cursor));
    setMeta(LAST_KEY, new Date().toISOString());
    return { applied, scanned: rows.length, ran: true };
  } catch {
    return none;
  }
}

/** A Nuvio content id → TheTVDB, asked once per show and remembered. */
async function tvdbFor(contentId: string): Promise<number | null> {
  const known = getMeta(ID_PREFIX + contentId);
  if (known) return Number(known) || null;
  const ref = nuvioContentRef(contentId);
  if (!ref) return null;
  let id: number | null;
  if ('imdb' in ref) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    id = await (require('@/tvdb') as typeof import('@/tvdb')).tvdbSeriesByImdbId(ref.imdb);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    id = await (require('@/catalog') as typeof import('@/catalog')).showTvdbIdForTmdb(ref.tmdb);
  }
  // Only a found id is remembered: null is also what a failed request says.
  if (id != null) setMeta(ID_PREFIX + contentId, String(id));
  return id;
}
