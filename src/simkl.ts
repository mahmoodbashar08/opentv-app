/**
 * Simkl, as a source of episodes watched somewhere this app cannot see — and,
 * through it, Nuvio, which has scrobbled to Simkl natively since 1 Aug 2026.
 *
 * WHY SIMKL AND NOT TRAKT (CHANGELOG 2.0.0, item 15). Since July 2026 a Trakt
 * API app needs Trakt VIP and a free Trakt account can connect only one
 * community app, so most users would have had to pay Trakt to use it. Simkl's
 * API is free with a client id and has no such limit. The read-only Trakt code
 * is still in `trakt.ts` if that changes.
 *
 * AUTH V2 DEVICE FLOW (api.simkl.org/api-reference/oauth2-device). The user is
 * shown an 8-character code, approves it at simkl.com/pin on any device, and
 * this polls until a token appears. Nothing is typed into this app, and no
 * scope is asked for: omitting it is Simkl's `media:read`, which is all a
 * read-only sync should hold. AUTH V1's `/oauth/pin` is retired around April
 * 2027, so it is not used.
 *
 * TOKENS EXPIRE. A V2 access token lasts 7 days; the refresh token 180, sliding
 * forward on every use and NOT rotating (api.simkl.org/api-reference/oauth2-tokens).
 * So an app opened once a season never asks the user again.
 *
 * EVERY REQUEST carries `client_id`, `app-name` and `app-version` in the URL
 * and a `User-Agent` (api.simkl.org/conventions/headers). Every call here fails
 * to null: Simkl being down costs a sync, never a library.
 */
import Constants from 'expo-constants';

import { SIMKL_CLIENT_ID } from '@/simkl-key';

const API = 'https://api.simkl.com';

/** False on a build whose `simkl-key.ts` was never filled in. */
export function simklConfigured(): boolean {
  return SIMKL_CLIENT_ID.length > 0;
}

const version = (): string => Constants.expoConfig?.version ?? '0';

function withApp(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${API}${path}${sep}client_id=${encodeURIComponent(SIMKL_CLIENT_ID)}&app-name=opentv&app-version=${encodeURIComponent(version())}`;
}

function form(body: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': `opentv/${version()}` },
    body: Object.entries(body)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&'),
  };
}

export type SimklDeviceCode = {
  device_code: string;
  /** `XXXX-YYYY`, shown to the user. */
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

/** Step one: `POST /oauth2/device`. */
export async function simklDeviceCode(): Promise<SimklDeviceCode | null> {
  try {
    const res = await fetch(withApp('/oauth2/device'), form({ client_id: SIMKL_CLIENT_ID }));
    if (!res.ok) return null;
    const j = (await res.json()) as Partial<SimklDeviceCode>;
    return j.device_code && j.user_code
      ? {
          device_code: j.device_code,
          user_code: j.user_code,
          verification_uri: j.verification_uri || 'https://simkl.com/pin',
          expires_in: j.expires_in ?? 900,
          interval: j.interval ?? 5,
        }
      : null;
  } catch {
    return null;
  }
}

export type SimklTokens = { access: string; refresh: string; /** epoch ms */ expiresAt: number };

function tokensFrom(j: { access_token?: string; refresh_token?: string; expires_in?: number }, keepRefresh = ''): SimklTokens | null {
  if (!j.access_token) return null;
  return {
    access: j.access_token,
    refresh: j.refresh_token || keepRefresh,
    expiresAt: Date.now() + (j.expires_in ?? 604800) * 1000,
  };
}

/**
 * Step two: `POST /oauth2/token` with the device-code grant.
 *
 * THERE IS NO DENY SIGNAL. Simkl answers `authorization_pending` both while the
 * user is deciding and after they declined ("declining writes nothing"), so the
 * caller's own deadline is the only end. `slow_down` asks for five more seconds
 * between polls; `expired_token` ends the flow.
 */
export type SimklPoll = { state: 'token'; tokens: SimklTokens } | { state: 'pending' } | { state: 'slow_down' } | { state: 'expired' };

export async function simklPollToken(deviceCode: string): Promise<SimklPoll> {
  try {
    const res = await fetch(
      withApp('/oauth2/token'),
      form({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: SIMKL_CLIENT_ID, device_code: deviceCode }),
    );
    const j = (await res.json().catch(() => ({}))) as { error?: string; access_token?: string; refresh_token?: string; expires_in?: number };
    if (res.ok) {
      const tokens = tokensFrom(j);
      return tokens ? { state: 'token', tokens } : { state: 'pending' };
    }
    if (j.error === 'slow_down') return { state: 'slow_down' };
    if (j.error === 'expired_token' || j.error === 'invalid_client') return { state: 'expired' };
    return { state: 'pending' };
  } catch {
    // Offline mid-flow is not a refusal: the code is good until it expires.
    return { state: 'pending' };
  }
}

/**
 * `POST /oauth2/token` with the refresh grant. Null when Simkl refuses it —
 * revoked in Simkl's Connected Apps, or untouched for 180 days — or cannot be
 * reached; the caller cannot tell those apart and does not need to: either way
 * this sync does nothing and the tokens are kept for the next try.
 */
export async function simklRefresh(refresh: string): Promise<SimklTokens | null> {
  try {
    const res = await fetch(withApp('/oauth2/token'), form({ grant_type: 'refresh_token', client_id: SIMKL_CLIENT_ID, refresh_token: refresh }));
    if (!res.ok) return null;
    return tokensFrom((await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }, refresh);
  } catch {
    return null;
  }
}

/** `POST /oauth2/revoke` on disconnect. Always 200 by RFC 7009, so nothing is checked. */
export async function simklRevoke(refresh: string): Promise<void> {
  try {
    await fetch(withApp('/oauth2/revoke'), form({ client_id: SIMKL_CLIENT_ID, token: refresh }));
  } catch {
    // The token is discarded on this side either way.
  }
}

/** A GET with the user's token. `unauthorized` is told apart so the caller can refresh once. */
export async function simklGet(path: string, access: string): Promise<{ ok: true; json: unknown } | { ok: false; status: number }> {
  try {
    const res = await fetch(withApp(path), {
      headers: { Authorization: `Bearer ${access}`, 'User-Agent': `opentv/${version()}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { ok: false, status: res.status };
    // An empty library is a literal `null` body, which is a valid answer.
    return { ok: true, json: await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0 };
  }
}
