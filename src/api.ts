/**
 * The community API client. One function, one error type, no state.
 *
 * Base URL lives in `src/api-config.ts` (gitignored — see the `.example`), so
 * dev and production can differ without either being committed.
 *
 * Nothing here touches the local library. The server holds comments, ratings,
 * profiles and follows; it holds no watch history and never will
 * (backend/docs/PLAN.md §2). If every call in this file failed forever, the
 * tracker would still work.
 */
import { API_BASE_URL } from '@/api-config';

/**
 * The stable machine strings the app switches on. Mirrors `ErrorCode` in
 * `backend/src/http.ts` exactly, plus the two synthetic codes below.
 *
 * `message` in the envelope is English and for logs only: OpenTV ships in six
 * languages and the server has no business guessing which. **Every message a
 * user sees is localised from `code`** — never from `error.message`.
 *
 * SYNTHETIC CODES. A request can fail without the server saying anything at
 * all: aeroplane mode, a captive portal, DNS, a 15-second timeout, a 502 from
 * Cloudflare's edge with an HTML body. Those failures need a code too, because
 * the localisation path takes one — a thrown `Error` with no `code` would have
 * no string to show. So:
 *   - `network`   — the request never produced a parseable answer.
 *   - `unknown`   — an answer arrived with a status we cannot read a code from.
 */
export type ApiErrorCode =
  // ── mirrored from backend/src/http.ts ──
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'invalid_body'
  | 'handle_taken'
  | 'handle_invalid'
  | 'rate_limited'
  | 'target_invalid'
  | 'too_large'
  | 'blocked'
  | 'internal'
  // ── synthetic, client-side only ──
  | 'network'
  | 'unknown';

const SERVER_CODES: readonly string[] = [
  'unauthenticated',
  'forbidden',
  'not_found',
  'invalid_body',
  'handle_taken',
  'handle_invalid',
  'rate_limited',
  'target_invalid',
  'too_large',
  'blocked',
  'internal',
];

/**
 * Every failure this module throws, success being the bare resource.
 *
 * `code` is what the UI localises from. `status` is 0 when no response ever
 * arrived. `message` is carried for logs and crash reports, not for display.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }

  /** True when the stored session is dead and signing in again is the only fix. */
  get needsSignIn(): boolean {
    return this.code === 'unauthenticated';
  }
}

/**
 * The `{error:{code,message}}` envelope, turned into an `ApiError`.
 *
 * Exported for its tests, and because it is the one piece of `api()` worth
 * pinning: a body that is not JSON, or is JSON of some other shape, must still
 * produce a code rather than throwing inside the error path. A 502 from an
 * edge proxy arrives as HTML, and it must not become an unhandled
 * `SyntaxError` on top of the failure it was already reporting.
 */
export function errorFromResponse(status: number, rawBody: string): ApiError {
  let code: ApiErrorCode = status === 401 ? 'unauthenticated' : 'unknown';
  let message = rawBody.slice(0, 200);
  try {
    const parsed: unknown = JSON.parse(rawBody);
    const envelope =
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? (parsed as { error: unknown }).error
        : null;
    if (envelope && typeof envelope === 'object') {
      const e = envelope as { code?: unknown; message?: unknown };
      if (typeof e.code === 'string' && SERVER_CODES.includes(e.code)) {
        code = e.code as ApiErrorCode;
      }
      if (typeof e.message === 'string') message = e.message;
    }
  } catch {
    // Not JSON — an edge error page, a captive portal's login form, an empty
    // body. The status-derived code above stands.
  }
  return new ApiError(code, status, message || `HTTP ${status}`);
}

export type ApiOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Serialised as JSON. Omitted entirely for GET. */
  body?: unknown;
  /** The session token, from `getToken()`. Absent → an anonymous request. */
  token?: string | null;
};

/** Same 15s ceiling as `tmdb.ts`: a stuck socket must never hang a screen. */
const TIMEOUT_MS = 15000;

/**
 * One request. Resolves with the parsed body, or throws `ApiError` — always
 * `ApiError`, never a bare `TypeError` from fetch, so every caller has exactly
 * one thing to catch and one `code` to localise.
 *
 * A 204 (and any other empty body) resolves as `undefined` rather than dying
 * in `JSON.parse`: `DELETE /v1/me` and the read-watermark call both answer
 * with nothing, and nothing is the correct answer.
 *
 * On 401 the caller — not this function — clears the session, via
 * `signOutLocally()` in `community-session.ts`. Doing it here would mean a
 * module that knows about storage, and a retry loop is exactly what must not
 * happen: the token is dead, so the next attempt fails identically.
 */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = opts;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    // Offline, DNS, TLS, or our own 15s abort. All indistinguishable from the
    // user's side ("it didn't go through"), and all need a code.
    throw new ApiError('network', 0, e instanceof Error ? e.message : 'network request failed');
  } finally {
    clearTimeout(timer);
  }

  let text: string;
  try {
    text = await res.text();
  } catch {
    // The connection died mid-body. A 200 whose body never arrived is a
    // failure, not a success with no data.
    throw new ApiError('network', res.status, 'response body could not be read');
  }

  if (!res.ok) throw errorFromResponse(res.status, text);

  // 204, or any other empty success. `undefined as T` is the deliberate shape:
  // callers of an empty endpoint type it `void`.
  if (res.status === 204 || text.length === 0) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    // A 200 that is not JSON is a proxy or a captive portal, not the API.
    throw new ApiError('network', res.status, 'response was not JSON');
  }
}
