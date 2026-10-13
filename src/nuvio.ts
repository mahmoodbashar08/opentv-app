/**
 * Nuvio, read directly with a Nuvio account — for the people who expect to
 * "sign in with Nuvio" because Movie Paradise and Seenr let them (CHANGELOG
 * 2.0.0, item 15). Simkl stays the fallback: Nuvio scrobbles there natively.
 *
 * ITS OWN MODULE AND NOTHING ELSE TOUCHES IT. A Nuvio account is a Supabase
 * project; its sync RPCs were unofficial when this was planned and are now
 * written up in nuvio.tv/docs/nuvio-public-api.md (v1.3, 20 Aug 2026) — but a
 * document a service can rewrite is not a contract, and the publishable key
 * below is theirs to rotate. So EVERY call here fails to null and never
 * throws: a Nuvio change can cost a sync, never a library.
 *
 * THE PUBLISHABLE KEY IS NOT A SECRET. Nuvio prints it in that document for
 * public clients to send as `apikey` ("Getting started → Publishable key"); a
 * Supabase publishable key only identifies the project, and the user's own
 * token is what row-level security checks.
 *
 * IT ONLY READS. The push RPCs exist and none is called; nothing here can
 * write to a Nuvio account.
 */
const BASE = 'https://api.nuvio.tv';
const PUBLISHABLE_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';

export type NuvioSession = { access: string; refresh: string; email: string; /** Nuvio profile index, 1–6; 0 until the user has chosen one. */ profile: number };

function headers(access?: string): Record<string, string> {
  return {
    apikey: PUBLISHABLE_KEY,
    'Content-Type': 'application/json',
    ...(access ? { Authorization: `Bearer ${access}` } : {}),
  };
}

async function post(path: string, body: unknown, access?: string): Promise<unknown> {
  try {
    const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: headers(access), body: JSON.stringify(body ?? {}) });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

function tokens(j: unknown): { access: string; refresh: string } | null {
  const t = j as { access_token?: unknown; refresh_token?: unknown } | null;
  return typeof t?.access_token === 'string' && typeof t.refresh_token === 'string' ? { access: t.access_token, refresh: t.refresh_token } : null;
}

/** `POST /auth/v1/token?grant_type=password`. The password goes to Nuvio once and is not kept. */
export async function nuvioSignIn(email: string, password: string): Promise<NuvioSession | null> {
  const t = tokens(await post('/auth/v1/token?grant_type=password', { email, password }));
  return t ? { ...t, email, profile: 0 } : null;
}

/**
 * `POST /auth/v1/token?grant_type=refresh_token`. A Nuvio access token lasts an
 * hour, so every sync starts here. Supabase ROTATES the refresh token, so the
 * caller must keep the new one — the old one is spent.
 */
export async function nuvioRefresh(refresh: string): Promise<{ access: string; refresh: string } | null> {
  return tokens(await post('/auth/v1/token?grant_type=refresh_token', { refresh_token: refresh }));
}

/** `POST /auth/v1/logout`, on disconnect. Best effort. */
export async function nuvioSignOut(access: string): Promise<void> {
  await post('/auth/v1/logout', {}, access);
}

/** `rpc/sync_pull_profiles`: the account's profiles, for the picker. */
export async function nuvioProfiles(access: string): Promise<{ index: number; name: string }[] | null> {
  const raw = await post('/rest/v1/rpc/sync_pull_profiles', {}, access);
  if (!Array.isArray(raw)) return null;
  return (raw as { profile_index?: unknown; name?: unknown }[])
    .map((p) => ({ index: Number(p?.profile_index), name: typeof p?.name === 'string' ? p.name : '' }))
    .filter((p) => Number.isInteger(p.index) && p.index > 0)
    .sort((a, b) => a.index - b.index);
}

/** `rpc/sync_get_watched_items_delta_cursor`: the newest history event id now. */
export async function nuvioCursor(access: string, profile: number): Promise<number | null> {
  const raw = await post('/rest/v1/rpc/sync_get_watched_items_delta_cursor', { p_profile_id: profile }, access);
  const n = Number(raw);
  return raw != null && Number.isFinite(n) ? n : null;
}

/** `rpc/sync_pull_watched_items`, one page, newest first. */
export async function nuvioWatchedPage(access: string, profile: number, page: number, size: number): Promise<unknown[] | null> {
  const raw = await post('/rest/v1/rpc/sync_pull_watched_items', { p_profile_id: profile, p_page: page, p_page_size: size }, access);
  return Array.isArray(raw) ? raw : null;
}

/** `rpc/sync_pull_watched_items_delta`: events after `since`, at most 1000. */
export async function nuvioWatchedDelta(access: string, profile: number, since: number): Promise<unknown[] | null> {
  const raw = await post('/rest/v1/rpc/sync_pull_watched_items_delta', { p_profile_id: profile, p_since_event_id: since, p_limit: 1000 }, access);
  return Array.isArray(raw) ? raw : null;
}
