/**
 * Jellyfin, as a source of episodes watched somewhere this app cannot see.
 *
 * THE BETTER FIT OF THE TWO MEDIA SERVERS. Open source, self-hosted, no
 * company between the user and their own machine — and its users are people
 * who already decided their watch history should not live on somebody
 * else's server, which is the argument this app is built on.
 *
 * WHAT IS DIFFERENT IS THE CONNECTING. Plex has a central directory, so a PIN
 * is enough and no address is ever typed. Jellyfin has no directory by
 * design — there is nobody in the middle to ask — so the user types a server
 * address, a username and a password, and the server answers with a token.
 * The password is used once, here, and never stored.
 *
 * IT MATCHES ON IDS, NEVER ON TITLES. A series carries `ProviderIds.Tvdb`,
 * the same guarantee `tvdb://` gives on Plex. A series Jellyfin never matched
 * has no id, so its episodes are refused. An honest gap beats a wrong tick.
 *
 * IT ONLY EVER READS. No write, no "sync back". Jellyfin is treated as
 * another export that happens to be live — the standing the GDPR ZIP has.
 */

import { normaliseServerUrl as normalise } from '@/pure';

export type JellyfinSession = { server: string; token: string; userId: string };

/** A Jellyfin box is usually on a LAN over plain http, so that is allowed. */
export function normaliseServerUrl(raw: string): string | null {
  return normalise(raw, { allowHttp: true });
}

/** `ProviderIds.Tvdb` as a positive integer, or null. Anything else — tmdb,
 *  imdb, a blank — is not a TheTVDB id and must not be treated as one. */
export function tvdbIdFromProviderIds(ids: Record<string, string | undefined> | undefined): number | null {
  for (const [k, v] of Object.entries(ids ?? {})) {
    if (k.toLowerCase() !== 'tvdb') continue;
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

/** Jellyfin's own header: it names the device in the user's session list,
 *  which is where somebody goes to revoke this — so it is honest. */
function auth(deviceId: string, token?: string): Record<string, string> {
  const parts = [`Client="OpenTV"`, `Device="iOS"`, `DeviceId="${deviceId}"`, `Version="1.0"`];
  if (token) parts.push(`Token="${token}"`);
  return { Authorization: `MediaBrowser ${parts.join(', ')}`, 'Content-Type': 'application/json', Accept: 'application/json' };
}

/**
 * Username and password → a session. The password goes to the user's own
 * server and nowhere else, and is not kept.
 */
export async function authenticate(server: string, username: string, password: string, deviceId: string): Promise<JellyfinSession | null> {
  try {
    const res = await fetch(`${server}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: auth(deviceId),
      body: JSON.stringify({ Username: username, Pw: password }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { AccessToken?: string; User?: { Id?: string } };
    if (!j.AccessToken || !j.User?.Id) return null;
    return { server, token: j.AccessToken, userId: j.User.Id };
  } catch {
    return null;
  }
}

export type JellyfinWatch = {
  /** Jellyfin's id for the SERIES, resolved to a TheTVDB id separately. */
  seriesId: string;
  season: number;
  episode: number;
  watchedAt: string;
};

type Item = {
  SeriesId?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  UserData?: { LastPlayedDate?: string; Played?: boolean };
  ProviderIds?: Record<string, string | undefined>;
};

/**
 * Every played episode, newest first, stopping at the watermark.
 *
 * `IsPlayed` is Jellyfin's own filter and `DatePlayed` descending its own
 * order, so the server does the selecting. Paged; a long-standing server has
 * tens of thousands of episodes. Films are skipped, as for every source.
 */
export async function fetchWatched(s: JellyfinSession, deviceId: string, since: string | null, maxPages = 20): Promise<JellyfinWatch[]> {
  const out: JellyfinWatch[] = [];
  const SIZE = 200;
  for (let page = 0; page < maxPages; page++) {
    let items: Item[];
    try {
      const url =
        `${s.server}/Users/${encodeURIComponent(s.userId)}/Items?IncludeItemTypes=Episode&Recursive=true&Filters=IsPlayed` +
        `&SortBy=DatePlayed&SortOrder=Descending&Fields=ParentIndexNumber,IndexNumber,SeriesId,UserData` +
        `&StartIndex=${page * SIZE}&Limit=${SIZE}`;
      const res = await fetch(url, { headers: auth(deviceId, s.token), signal: AbortSignal.timeout(15000) });
      if (!res.ok) break;
      items = ((await res.json()) as { Items?: Item[] }).Items ?? [];
    } catch {
      // Partial is fine: the watermark only advances over what arrived.
      break;
    }
    if (items.length === 0) break;
    let passedWatermark = false;
    for (const it of items) {
      if (!it.SeriesId || it.ParentIndexNumber == null || it.IndexNumber == null) continue;
      const at = it.UserData?.LastPlayedDate;
      if (!at) continue;
      const iso = new Date(at).toISOString();
      if (since != null && iso <= since) {
        passedWatermark = true;
        break;
      }
      out.push({ seriesId: it.SeriesId, season: it.ParentIndexNumber, episode: it.IndexNumber, watchedAt: iso });
    }
    if (passedWatermark || items.length < SIZE) break;
  }
  return out;
}

/**
 * Series id → TheTVDB id, for the series a batch mentions. Batched: where
 * Plex needs one request per show, `Items?Ids=` takes a hundred at a time.
 * A series without a TheTVDB id is absent, and therefore refused.
 */
export async function seriesTvdbIds(s: JellyfinSession, deviceId: string, seriesIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < seriesIds.length; i += 100) {
    const batch = seriesIds.slice(i, i + 100);
    try {
      const url = `${s.server}/Users/${encodeURIComponent(s.userId)}/Items?Ids=${batch.map(encodeURIComponent).join(',')}&Fields=ProviderIds`;
      const res = await fetch(url, { headers: auth(deviceId, s.token), signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const items = ((await res.json()) as { Items?: (Item & { Id?: string })[] }).Items ?? [];
      for (const it of items) {
        const id = tvdbIdFromProviderIds(it.ProviderIds);
        if (it.Id && id != null) out.set(it.Id, id);
      }
    } catch {
      // Left out, therefore refused. The safe direction.
    }
  }
  return out;
}
