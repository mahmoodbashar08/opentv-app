/**
 * Bringing Simkl's watched episodes into the library — the fourth live source
 * after Plex, Jellyfin and Stremio, with the same standing: read-only, tracked
 * shows only, the phone stays the source of truth, and nothing about what the
 * user watched goes to OUR server (this file never imports `api.ts`).
 *
 * IDS FIRST, A NAME ONLY WITH A YES. Simkl hands back `ids.tvdb` for most
 * shows, which is exactly what this app keys on. Without it, an IMDb id is
 * asked of TheTVDB (`tvdbSeriesByImdbId`, as Stremio does). Only when neither
 * places the show is its TITLE compared with the shows the user tracks — and a
 * title match writes nothing: it is filed under "Check these matches" on the
 * Simkl screen, episodes and all, and applied only when the user says it is
 * the same show. "No" is remembered, so it is never asked again.
 *
 * SIMKL'S OWN RULES ARE THE SHAPE OF THIS (api.simkl.org/guides/sync):
 * `GET /sync/activities` first, every time; `/sync/all-items` only for a type
 * whose timestamp moved, with `date_from` set to the saved timestamp exactly as
 * Simkl returned it; the full pull once, ever; no background timers, at most
 * one check per 15 minutes on a phone; and if any fetch fails, the new
 * timestamps are NOT saved, so the next run asks for the same window again.
 * A client that ignores these has its client id suspended — for every user.
 */
import * as SecureStore from 'expo-secure-store';

import { getMeta, setMeta } from '@/db';
import { applyExternalWatches } from '@/external-apply';
import { simklShowsFromItems, simklTitleCandidate, type ExternalWatchRow, type SimklShow } from '@/pure';
import type { SimklTokens } from '@/simkl';

const TOKENS_KEY = 'opentv.simkl.tokens';
/** `{ shows, anime }`: the `all` timestamps from the last COMPLETE pass. */
const ACTIVITY_KEY = 'simklActivity';
/** When `/sync/activities` was last asked, for the 15-minute floor. */
const CHECK_KEY = 'simklLastCheck';
const LAST_KEY = 'simklLastSync';
/** Title matches waiting for a yes or no. See `SimklPendingMatch`. */
const PENDING_KEY = 'simklPending';
/** `simklTvdb:<simkl id>` → a TheTVDB id, or '0' for "not a show you track". */
const ID_PREFIX = 'simklTvdb:';

const MIN_GAP_MS = 15 * 60 * 1000;

export async function getSimklTokens(): Promise<SimklTokens | null> {
  try {
    const raw = await SecureStore.getItemAsync(TOKENS_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as Partial<SimklTokens>;
    return t.access && t.refresh ? { access: t.access, refresh: t.refresh, expiresAt: Number(t.expiresAt) || 0 } : null;
  } catch {
    return null;
  }
}

export async function setSimklTokens(t: SimklTokens): Promise<void> {
  await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(t));
}

/**
 * Disconnect. The timestamps, the remembered ids and the pending matches go
 * with the token: a DIFFERENT Simkl account connected next must get its own
 * full first pull, not resume from this one's `date_from` — the same bug class
 * as a publish fingerprint that records a library's shape but not its owner.
 */
export async function disconnectSimkl(): Promise<void> {
  const t = await getSimklTokens();
  try {
    await SecureStore.deleteItemAsync(TOKENS_KEY);
  } catch {
    // Already gone.
  }
  if (t) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    void (require('@/simkl') as typeof import('@/simkl')).simklRevoke(t.refresh);
  }
  setMeta(ACTIVITY_KEY, '');
  setMeta(CHECK_KEY, '');
  setMeta(LAST_KEY, '');
  setMeta(PENDING_KEY, '');
}

export function simklSyncedAt(): string | null {
  return getMeta(LAST_KEY) || null;
}

/**
 * A title-only match the user has not answered yet. The episodes ride along so
 * a "yes" can apply them at once, without waiting for Simkl to report the show
 * again (it will not: the timestamps have already moved past it).
 */
export type SimklPendingMatch = {
  simklId: number;
  title: string;
  year: number | null;
  tvdbId: number;
  name: string;
  rows: { season: number; episode: number; watchedAt: string }[];
};

export function simklPending(): SimklPendingMatch[] {
  try {
    const raw = getMeta(PENDING_KEY);
    const list = raw ? (JSON.parse(raw) as SimklPendingMatch[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function savePending(list: readonly SimklPendingMatch[]): void {
  setMeta(PENDING_KEY, list.length ? JSON.stringify(list) : '');
}

/** The user's answer to one match. Yes applies its episodes; either way it is never asked again. */
export function answerSimklMatch(simklId: number, same: boolean): number {
  const list = simklPending();
  const hit = list.find((p) => p.simklId === simklId);
  savePending(list.filter((p) => p.simklId !== simklId));
  if (!hit) return 0;
  setMeta(ID_PREFIX + simklId, same ? String(hit.tvdbId) : '0');
  return same ? applyExternalWatches(hit.rows.map((r) => ({ ...r, tvdbId: hit.tvdbId }))) : 0;
}

type Activity = { shows: string; anime: string };

function savedActivity(): Activity | null {
  try {
    const raw = getMeta(ACTIVITY_KEY);
    return raw ? (JSON.parse(raw) as Activity) : null;
  } catch {
    return null;
  }
}

export type SimklOutcome = { applied: number; scanned: number; ran: boolean; pending: number };

/**
 * One pass. With no token it costs nothing; with nothing new, one small
 * request; called on launch it asks at most once per 15 minutes. `force` is
 * the screen's "Check now", which a person pressed.
 */
export async function syncSimkl(force = false): Promise<SimklOutcome> {
  const none: SimklOutcome = { applied: 0, scanned: 0, ran: false, pending: simklPending().length };
  let tokens = await getSimklTokens();
  if (!tokens) return none;
  const lastCheck = Date.parse(getMeta(CHECK_KEY) || '');
  if (!force && Number.isFinite(lastCheck) && Date.now() - lastCheck < MIN_GAP_MS) return none;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sk = require('@/simkl') as typeof import('@/simkl');

  // A day before it lapses rather than on the first 401: a refresh is cheap and
  // a sync that half-fails on an expired token has to be retried whole.
  if (tokens.expiresAt - Date.now() < 24 * 60 * 60 * 1000) {
    const fresh = await sk.simklRefresh(tokens.refresh);
    if (fresh) {
      tokens = fresh;
      await setSimklTokens(fresh);
    }
  }
  let refreshed = false;
  const get = async (path: string): Promise<{ ok: true; json: unknown } | { ok: false; status: number }> => {
    let res = await sk.simklGet(path, tokens!.access);
    // ONE refresh on a 401, then give up for this pass. Refreshing in a loop is
    // how two holders of one grant cut each other off (oauth2-tokens, "Handling a 401").
    if (!res.ok && res.status === 401 && !refreshed) {
      refreshed = true;
      const fresh = await sk.simklRefresh(tokens!.refresh);
      if (!fresh) return res;
      tokens = fresh;
      await setSimklTokens(fresh);
      res = await sk.simklGet(path, fresh.access);
    }
    return res;
  };

  // `GET /sync/activities` — "Always call this first" (get-activities).
  const act = await get('/sync/activities');
  if (!act.ok) return none;
  setMeta(CHECK_KEY, new Date().toISOString());
  const a = (act.json ?? {}) as { tv_shows?: { all?: string | null }; anime?: { all?: string | null } };
  const now: Activity = { shows: a.tv_shows?.all ?? '', anime: a.anime?.all ?? '' };
  const before = savedActivity();

  const shows: SimklShow[] = [];
  for (const kind of ['shows', 'anime'] as const) {
    // Nothing moved in this list since the last complete pass: not asked.
    if (before && before[kind] === now[kind]) continue;
    const got = await fetchKind(get, kind, before?.[kind] || null);
    if (got == null) return none;
    shows.push(...got);
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db = require('@/db') as typeof import('@/db');
  const library = db.getShowNames();
  const rows: ExternalWatchRow[] = [];
  const pending = simklPending();
  for (const show of shows) {
    if (show.episodes.length === 0) continue;
    const tvdbId = await placeShow(show);
    if (tvdbId === 'refused') continue;
    if (tvdbId != null) {
      for (const e of show.episodes) rows.push({ tvdbId, ...e });
      continue;
    }
    const guess = simklTitleCandidate(show.title, show.year, library);
    if (!guess) continue;
    const existing = pending.find((p) => p.simklId === show.simklId);
    if (existing) existing.rows.push(...show.episodes);
    else pending.push({ simklId: show.simklId, title: show.title, year: show.year, tvdbId: guess.tvdbId, name: guess.name, rows: show.episodes });
  }

  const applied = applyExternalWatches(rows);
  savePending(pending);
  // Only now, with every fetch answered: a failure above returned before this,
  // so the next pass asks for the same window again.
  setMeta(ACTIVITY_KEY, JSON.stringify(now));
  setMeta(LAST_KEY, new Date().toISOString());
  return { applied, scanned: rows.length, ran: true, pending: pending.length };
}

/**
 * One list's changes. `include_all_episodes=original` brings the episodes of
 * completed and dropped shows too (they are skipped by default) but only the
 * ones actually recorded, not virtual rows Simkl would invent for a show
 * marked complete in one tap — those would all carry one made-up date.
 *
 * TOO BIG FOR ONE REPLY: Simkl refuses a response it cannot build with
 * `400 max_items`, a real risk on the first pull of a decade's library. The
 * documented answer is one status per call, so a 400 retries that way.
 */
async function fetchKind(
  get: (path: string) => Promise<{ ok: true; json: unknown } | { ok: false; status: number }>,
  kind: 'shows' | 'anime',
  dateFrom: string | null,
): Promise<SimklShow[] | null> {
  const query = `extended=${kind === 'anime' ? 'full_anime_seasons' : 'full'}&episode_watched_at=yes&include_all_episodes=original${
    dateFrom ? `&date_from=${encodeURIComponent(dateFrom)}` : ''
  }`;
  const whole = await get(`/sync/all-items/${kind}?${query}`);
  if (whole.ok) return simklShowsFromItems(whole.json, kind);
  if (whole.status !== 400) return null;
  const out: SimklShow[] = [];
  // `plantowatch` is left out: nothing in it has been watched.
  for (const status of ['watching', 'completed', 'hold', 'dropped']) {
    const part = await get(`/sync/all-items/${kind}/${status}?${query}`);
    if (!part.ok) return null;
    out.push(...simklShowsFromItems(part.json, kind));
  }
  return out;
}

/**
 * The show's TheTVDB id by identity, null when only its title is left to go
 * on, or 'refused' when the user already said a title match was wrong.
 */
async function placeShow(show: SimklShow): Promise<number | null | 'refused'> {
  if (show.tvdbId != null) return show.tvdbId;
  const known = getMeta(ID_PREFIX + show.simklId);
  if (known) return Number(known) || 'refused';
  if (show.imdb) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { tvdbSeriesByImdbId } = require('@/tvdb') as typeof import('@/tvdb');
    const id = await tvdbSeriesByImdbId(show.imdb);
    // Only a found id is remembered: null is also what a failed request says.
    if (id != null) {
      setMeta(ID_PREFIX + show.simklId, String(id));
      return id;
    }
  }
  return null;
}
