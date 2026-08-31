/**
 * Plex, as a source of episodes watched somewhere this app cannot see.
 *
 * WHY PLEX AND NOT TRAKT. Trakt was the first choice and the code for it still
 * exists: every item it returns carries `ids: { tvdb }`, so matching is an id
 * lookup rather than a title guess. Then Trakt made registering an OAuth
 * application a paid feature, which puts a gate in front of a thing this app
 * exists to give away. Plex has no gate at all — a client generates its own
 * identifier and asks for a PIN — and, crucially, keeps the same property that
 * made Trakt safe: library items carry GUIDs like `tvdb://121361`, so this
 * still matches on ids and never on names. A fuzzy title match that ticks the
 * wrong episode corrupts the one thing this app exists to protect.
 *
 * THE PIN FLOW IS THE DEVICE FLOW BY ANOTHER NAME. Ask for a PIN, show the
 * user a short code, they approve it in a browser on any device, and this polls
 * until a token appears. Nothing is typed into this app, and there is no
 * callback URL for a phone to defend.
 *
 * IT ONLY EVER READS. There is no write, no "sync back to Plex", and no attempt
 * to keep the two in step. Plex is treated as another export that happens to be
 * live — the same standing the GDPR ZIP has. The phone remains the source of
 * truth.
 */

const PLEX_TV = 'https://plex.tv/api/v2';

/** Sent on every call. Plex uses these to name the device in a user's account
 *  settings, which is where somebody goes to revoke this — so they are honest
 *  rather than decorative. */
function headers(clientId: string, token?: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Plex-Product': 'OpenTV',
    'X-Plex-Version': '1.0',
    'X-Plex-Client-Identifier': clientId,
    'X-Plex-Platform': 'iOS',
    'X-Plex-Device-Name': 'OpenTV',
    ...(token ? { 'X-Plex-Token': token } : {}),
  };
}

export type PlexPin = { id: number; code: string };

/**
 * Step one: ask for a PIN the user will approve in a browser.
 *
 * NOT `strong=true`, and that is a decision rather than an omission. A strong
 * PIN is twenty-five characters — `fx5io2tkccqjbtl93kslin9x5` — which is fine
 * when the only way through is a link on the same device, and useless the
 * moment somebody wants to approve it on a laptop. The plain PIN is four
 * characters, which is what plex.tv/link is built to accept and what a person
 * can read off one screen and type into another. It lives fifteen minutes and
 * is worth nothing to anybody who does not also hold this client identifier.
 */
export async function requestPin(clientId: string): Promise<PlexPin | null> {
  try {
    const res = await fetch(`${PLEX_TV}/pins`, { method: 'POST', headers: headers(clientId) });
    if (!res.ok) return null;
    const j = (await res.json()) as { id?: number; code?: string };
    return j.id && j.code ? { id: j.id, code: j.code } : null;
  } catch {
    return null;
  }
}

/** Where the user approves it. The code travels in the URL so nothing has to be
 *  typed twice; it is shown on screen as well, because a browser that opens on
 *  another device cannot carry it. */
export function pinAuthUrl(clientId: string, code: string): string {
  const q = new URLSearchParams({
    clientID: clientId,
    code,
    'context[device][product]': 'OpenTV',
  });
  return `https://app.plex.tv/auth#?${q.toString()}`;
}

/**
 * Step two: poll until it is approved.
 *
 * A PENDING PIN IS A 200 WITH A NULL TOKEN, not an error — treating any
 * non-token answer as failure would end the flow on the first poll, which is
 * always pending.
 */
export type PinResult = { state: 'token'; token: string } | { state: 'pending' } | { state: 'expired' };

export async function pollForPin(clientId: string, pin: PlexPin): Promise<PinResult> {
  try {
    const res = await fetch(`${PLEX_TV}/pins/${pin.id}?code=${encodeURIComponent(pin.code)}`, {
      headers: headers(clientId),
    });
    // Plex answers 404 once the PIN has expired and been swept.
    if (res.status === 404) return { state: 'expired' };
    if (!res.ok) return { state: 'pending' };
    const j = (await res.json()) as { authToken?: string | null };
    return j.authToken ? { state: 'token', token: j.authToken } : { state: 'pending' };
  } catch {
    // Offline mid-flow is not a refusal: the PIN is still valid until it isn't.
    return { state: 'pending' };
  }
}

export type PlexServer = { name: string; uri: string; token: string };

/**
 * The user's servers, and a URI for each that actually answers.
 *
 * PLEX GIVES SEVERAL ADDRESSES PER SERVER — a LAN address, a public one, and a
 * relay — and which of them works depends on where the phone is standing. They
 * are tried in the order Plex returns with `local` first, because a LAN address
 * is both faster and the one that does not route a library through Plex's
 * relay. A server that answers none of them is skipped rather than failing the
 * whole sync: somebody with two servers and one offline should still get the
 * episodes from the other.
 */
export async function findServers(clientId: string, token: string): Promise<PlexServer[]> {
  let list: {
    name?: string;
    provides?: string;
    accessToken?: string;
    connections?: { uri?: string; local?: boolean; relay?: boolean }[];
  }[];
  try {
    const res = await fetch(`${PLEX_TV}/resources?includeHttps=1&includeRelay=1`, {
      headers: headers(clientId, token),
    });
    if (!res.ok) return [];
    list = (await res.json()) as typeof list;
  } catch {
    return [];
  }

  const out: PlexServer[] = [];
  for (const r of list) {
    if (!r.provides?.split(',').includes('server')) continue;
    const conns = (r.connections ?? [])
      .filter((c): c is { uri: string; local?: boolean; relay?: boolean } => typeof c.uri === 'string')
      // LAN first, relay last: the relay is slow and metered by Plex.
      .sort((a, b) => Number(!!b.local) - Number(!!a.local) || Number(!!a.relay) - Number(!!b.relay));
    const serverToken = r.accessToken ?? token;
    for (const c of conns) {
      if (await reachable(c.uri, clientId, serverToken)) {
        out.push({ name: r.name ?? 'Plex', uri: c.uri, token: serverToken });
        break;
      }
    }
  }
  return out;
}

/** A short timeout on purpose: a LAN address from another network does not
 *  refuse, it hangs, and a sync that waits sixty seconds per address on a
 *  phone that has left the house is a sync nobody keeps switched on. */
async function reachable(uri: string, clientId: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${uri}/identity`, {
      headers: headers(clientId, token),
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** One watched episode, as this app needs it. Season and episode are Plex's
 *  own numbering, which matches TheTVDB's for anything Plex matched to TheTVDB
 *  — see `showTvdbIds` for how that is established rather than assumed. */
export type PlexWatch = {
  /** Plex's internal id for the SHOW, resolved to a TheTVDB id separately. */
  showKey: string;
  season: number;
  episode: number;
  watchedAt: string;
};

type PlexMeta = {
  grandparentRatingKey?: string;
  parentIndex?: number;
  index?: number;
  lastViewedAt?: number;
  viewCount?: number;
  Guid?: { id?: string }[];
};

/**
 * Every watched episode on one server, newest first.
 *
 * `type=4` IS EPISODES and `viewCount>=1` is Plex's own "watched" filter, so
 * the server does the selecting rather than this fetching a whole library and
 * discarding most of it. Paged, because a long-standing server has tens of
 * thousands of episodes.
 *
 * FILMS ARE SKIPPED, as they are for every other source: this app keys films by
 * name, so a film row cannot be matched with the same certainty an id gives.
 * An honest gap beats a wrong tick.
 */
export async function fetchWatched(
  server: PlexServer,
  clientId: string,
  since: string | null,
  maxPages = 20,
): Promise<PlexWatch[]> {
  const out: PlexWatch[] = [];
  const sinceUnix = since ? Math.floor(new Date(since).getTime() / 1000) : null;
  const SIZE = 200;

  for (let page = 0; page < maxPages; page++) {
    let items: PlexMeta[];
    try {
      const url =
        `${server.uri}/library/all?type=4&viewCount%3E%3D=1&sort=lastViewedAt%3Adesc` +
        `&X-Plex-Container-Start=${page * SIZE}&X-Plex-Container-Size=${SIZE}`;
      const res = await fetch(url, { headers: headers(clientId, server.token), signal: AbortSignal.timeout(15000) });
      if (!res.ok) break;
      const j = (await res.json()) as { MediaContainer?: { Metadata?: PlexMeta[] } };
      items = j.MediaContainer?.Metadata ?? [];
    } catch {
      // Partial is fine: the watermark only advances over what actually
      // arrived, so the rest is picked up next time.
      break;
    }
    if (items.length === 0) break;

    let passedWatermark = false;
    for (const m of items) {
      if (!m.grandparentRatingKey || m.parentIndex == null || m.index == null) continue;
      if (!m.lastViewedAt) continue;
      /*
       * SORTED NEWEST FIRST, so the first row older than the watermark means
       * every row after it is too. Stopping there is what makes a launch sync
       * one request instead of a full library read.
       */
      if (sinceUnix != null && m.lastViewedAt <= sinceUnix) {
        passedWatermark = true;
        break;
      }
      out.push({
        showKey: m.grandparentRatingKey,
        season: m.parentIndex,
        episode: m.index,
        watchedAt: new Date(m.lastViewedAt * 1000).toISOString(),
      });
    }
    if (passedWatermark || items.length < SIZE) break;
  }
  return out;
}

/**
 * Plex show key → TheTVDB id, for the shows a batch actually mentions.
 *
 * THIS IS THE WHOLE SAFETY OF THE FEATURE. Plex stores agent GUIDs per item;
 * a show matched against TheTVDB carries `tvdb://121361`. A show Plex matched
 * some other way, or failed to match, has no such GUID and is simply absent
 * from the result — which makes it untracked as far as the decision layer is
 * concerned, and untracked shows are refused. Nothing is ever guessed from a
 * title.
 *
 * One request per show, not per episode: a hundred episodes of one series is
 * one lookup.
 */
export async function showTvdbIds(
  server: PlexServer,
  clientId: string,
  showKeys: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const key of showKeys) {
    try {
      const res = await fetch(`${server.uri}/library/metadata/${encodeURIComponent(key)}`, {
        headers: headers(clientId, server.token),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { MediaContainer?: { Metadata?: PlexMeta[] } };
      const meta = j.MediaContainer?.Metadata?.[0];
      const id = tvdbIdFromGuids(meta?.Guid);
      if (id != null) out.set(key, id);
    } catch {
      // A show that cannot be resolved is left out, and its episodes are
      // therefore refused. That is the safe direction.
    }
  }
  return out;
}

/** `tvdb://121361` or `tvdb://121361?lang=en`. Anything else — `tmdb://`,
 *  `imdb://`, Plex's own `plex://` — is not a TheTVDB id and must not be
 *  treated as one. */
export function tvdbIdFromGuids(guids: { id?: string }[] | undefined): number | null {
  for (const g of guids ?? []) {
    const m = /^tvdb:\/\/(\d+)/.exec(g.id ?? '');
    if (m) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > 0) return n;
    }
  }
  return null;
}
