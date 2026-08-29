/**
 * Trakt, as a source of episodes you watched somewhere else.
 *
 * WHY TRAKT AND NOT PLEX OR JELLYFIN FIRST. Every item Trakt returns carries
 * `ids: { tvdb, tmdb, imdb }`, and TheTVDB id is exactly what this app keys a
 * show on. So matching is an id lookup, not a title guess. Plex and Jellyfin
 * hand back their own internal ids and a title string, which means fuzzy
 * matching — and a fuzzy match that ticks the wrong episode corrupts the one
 * thing this app exists to protect. Those can come later, behind a confirmation
 * step; this one is safe to run unattended.
 *
 * DEVICE FLOW, not a redirect. A phone has no callback URL worth defending, and
 * `trakt-keys.example.ts` is written for `urn:ietf:wg:oauth:2.0:oob` for that
 * reason. The user is shown a short code, types it on trakt.tv on any device,
 * and this polls until it is approved. Nothing is typed into this app.
 *
 * IT ONLY EVER READS. There is no write scope used here, no "sync back to
 * Trakt", and no attempt to keep the two in step. Trakt is treated as another
 * export that happens to be live — the phone remains the source of truth, which
 * is the same rule the GDPR import follows.
 */
import { TRAKT_CLIENT_ID, TRAKT_CLIENT_SECRET } from '@/trakt-keys';

const API = 'https://api.trakt.tv';

/** Trakt requires all three on every call; the version header is not optional. */
function headers(token?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'trakt-api-version': '2',
    'trakt-api-key': TRAKT_CLIENT_ID,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
};

/** Step one: ask for a code the user will type on trakt.tv/activate. */
export async function requestDeviceCode(): Promise<DeviceCode | null> {
  try {
    const res = await fetch(`${API}/oauth/device/code`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ client_id: TRAKT_CLIENT_ID }),
    });
    if (!res.ok) return null;
    return (await res.json()) as DeviceCode;
  } catch {
    return null;
  }
}

/**
 * Step two: poll until they approve it, or it expires.
 *
 * THE STATUS CODES ARE THE PROTOCOL, not errors to log and ignore: 400 means
 * "not yet, keep waiting", 409 means already used, 410 expired, 418 the user
 * said no, 429 slow down. Treating any non-200 as failure would end the flow
 * the instant it started, because 400 is the normal answer for the first
 * several polls.
 */
export type PollResult =
  | { state: 'token'; access_token: string }
  | { state: 'pending' }
  | { state: 'slow_down' }
  | { state: 'denied' }
  | { state: 'expired' };

export async function pollForToken(deviceCode: string): Promise<PollResult> {
  try {
    const res = await fetch(`${API}/oauth/device/token`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        code: deviceCode,
        client_id: TRAKT_CLIENT_ID,
        client_secret: TRAKT_CLIENT_SECRET,
      }),
    });
    if (res.status === 200) {
      const j = (await res.json()) as { access_token?: string };
      return j.access_token ? { state: 'token', access_token: j.access_token } : { state: 'pending' };
    }
    if (res.status === 429) return { state: 'slow_down' };
    if (res.status === 410) return { state: 'expired' };
    if (res.status === 418) return { state: 'denied' };
    // 400 (pending) and 409 (already approved elsewhere) both mean "keep going".
    return { state: 'pending' };
  } catch {
    // Offline mid-flow is not a denial: the code is still valid until it isn't.
    return { state: 'pending' };
  }
}

/** One watched episode, as this app needs it. */
export type TraktWatch = {
  tvdbId: number;
  season: number;
  episode: number;
  /** ISO instant Trakt recorded, used as the watch date. */
  watchedAt: string;
};

type HistoryRow = {
  watched_at?: string;
  type?: string;
  episode?: { season?: number; number?: number; ids?: { tvdb?: number | null } };
  show?: { ids?: { tvdb?: number | null } };
};

/**
 * Everything watched since `since`, newest first, paged.
 *
 * SINCE A WATERMARK, not "everything, every time". A long-standing Trakt
 * account has tens of thousands of rows and re-reading them on every launch
 * would be rude to their servers and slow on the phone. The caller keeps the
 * watermark; this only asks.
 *
 * EPISODES ONLY. Trakt's history mixes films in, and films in this app are
 * keyed by name rather than by id, so a film row cannot be matched with the
 * same certainty. Rather than guess, they are skipped — an honest gap beats a
 * wrong tick.
 */
export async function fetchHistory(token: string, since: string | null, maxPages = 10): Promise<TraktWatch[]> {
  const out: TraktWatch[] = [];
  for (let page = 1; page <= maxPages; page++) {
    let rows: HistoryRow[];
    try {
      const url = `${API}/sync/history/episodes?limit=100&page=${page}${since ? `&start_at=${encodeURIComponent(since)}` : ''}`;
      const res = await fetch(url, { headers: headers(token) });
      if (!res.ok) break;
      rows = (await res.json()) as HistoryRow[];
    } catch {
      // Partial is fine: the watermark only advances over what actually
      // arrived, so the rest is picked up next time.
      break;
    }
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      const tvdbId = r.show?.ids?.tvdb;
      const season = r.episode?.season;
      const episode = r.episode?.number;
      // A row missing any of the three cannot be placed. Trakt has shows with
      // no TheTVDB id at all, and specials arrive as season 0.
      if (!tvdbId || season == null || episode == null) continue;
      out.push({ tvdbId, season, episode, watchedAt: r.watched_at ?? new Date().toISOString() });
    }
    if (rows.length < 100) break;
  }
  return out;
}
