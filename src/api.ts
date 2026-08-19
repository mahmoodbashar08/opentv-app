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
  // The act needs OpenTV Plus. Its own code because the app answers it with the
  // paywall, which is a different screen from "you may not".
  | 'plus_required'
  // A shared list at its member ceiling. A fact about the list, not about the
  // person trying to join — `forbidden` would read to them as "you are not
  // welcome", which is the wrong sentence entirely.
  | 'list_full'
  // Signed in, but the email behind the account is unconfirmed. Its own code
  // because it is the one failure with a SCREEN to send somebody to.
  | 'email_unverified'
  // Sign-in against an address with no account, and against one whose account
  // uses Apple or Google. Both exist so the screen can say the useful thing
  // instead of "email or password is wrong" — see `email-sign-in.tsx`.
  | 'no_account'
  | 'use_provider'
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
  'email_unverified',
  'no_account',
  'use_provider',
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
  /**
   * The sign-in methods already on the address, for `use_provider` — empty for
   * every other code. Carried on the error rather than returned, because the
   * call it belongs to threw: a 409 is not a value the caller can read.
   */
  readonly providers: readonly string[];

  /**
   * THE SERVER'S OWN SENTENCE, and the narrow case it is for.
   *
   * Set only when the envelope actually carried a `message` — never a slice of
   * an HTML error page, never `HTTP 500`. Everything a user sees is still
   * localised from `code`; this exists for the one case that rule cannot cover.
   *
   * A build ships knowing the codes that existed the day it was archived. Any
   * code added to the server afterwards is `unknown` to it, for ever, and it
   * says "Something went wrong" — which is what somebody got when email
   * sign-up was closed and the server was answering, clearly, that sign-up was
   * temporarily unavailable and to use Apple or Google. The generic string was
   * worse than the English one it was hiding.
   *
   * English, and that is the trade: six locales, and a sentence in one of them
   * beats a shrug in all six. Only reached when the code maps to nothing.
   */
  readonly serverMessage: string | null;

  constructor(
    code: ApiErrorCode,
    status: number,
    message: string,
    providers: readonly string[] = [],
    serverMessage: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.providers = providers;
    this.serverMessage = serverMessage;
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
  // Distinct from `message`, which falls back to the raw body: only a sentence
  // the server deliberately wrote is ever shown to anybody.
  let serverMessage: string | null = null;
  let providers: string[] = [];
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
      if (typeof e.message === 'string') {
        message = e.message;
        const trimmed = e.message.trim();
        if (trimmed.length > 0) serverMessage = trimmed.slice(0, 200);
      }
    }
    // Alongside the envelope, not inside it: the envelope's shape is fixed.
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { providers?: unknown }).providers)) {
      providers = (parsed as { providers: unknown[] }).providers.filter((p): p is string => typeof p === 'string');
    }
  } catch {
    // Not JSON — an edge error page, a captive portal's login form, an empty
    // body. The status-derived code above stands.
  }
  return new ApiError(code, status, message || `HTTP ${status}`, providers, serverMessage);
}

/**
 * What to do when the server says the session is dead.
 *
 * WHY A CALLBACK AND NOT A DIRECT CALL. This module must not know about the
 * Keychain, and importing `community-session` here would be a cycle — it
 * imports `api`. `community-session` registers itself at import time instead.
 *
 * WHY IT IS HERE AT ALL, given `signOutLocally()` already ran from the `write()`
 * wrappers: only writes went through those. Every read swallowed its error, and
 * the app never calls `GET /v1/me`, so nothing on the device ever asked whether
 * the account still existed. A profile deleted by moderation left the phone
 * showing itself as signed in indefinitely — until the user happened to try to
 * post something. One place, so a future call site cannot forget.
 */
type Unauthenticated = () => void;
let onUnauthenticated: Unauthenticated | null = null;

export function setUnauthenticatedHandler(fn: Unauthenticated | null): void {
  onUnauthenticated = fn;
}

/**
 * Turn a failed response into the throw, firing the dead-session handler on the
 * way past. Every non-ok path in this module goes through here so that exactly
 * one of them has to remember.
 *
 * The handler is fired, never awaited: the caller is being told its request
 * failed, and it must not wait on a Keychain write to hear so.
 */
function raise(status: number, body: string): ApiError {
  const err = errorFromResponse(status, body);
  if (err.needsSignIn && onUnauthenticated) {
    try {
      onUnauthenticated();
    } catch {
      // A sign-out that throws must not replace the error the caller needs.
    }
  }
  return err;
}

export type ApiOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Serialised as JSON. Omitted entirely for GET. */
  body?: unknown;
  /** The session token, from `getToken()`. Absent → an anonymous request. */
  token?: string | null;
  /**
   * Extra headers. One caller: the development sign-in, which authenticates
   * with a shared secret rather than a bearer token. Merged UNDER the ones this
   * module sets, so nothing can override Accept, Content-Type or Authorization
   * by passing them here.
   */
  headers?: Record<string, string>;
};

/** Same 15s ceiling as `tmdb.ts`: a stuck socket must never hang a screen. */
const TIMEOUT_MS = 15000;

/**
 * Longer, for `apiUpload`. A photograph on a slow connection legitimately takes
 * more than fifteen seconds, and aborting one that was going to succeed costs
 * the only surviving copy of it a retry it may not get.
 */
const UPLOAD_TIMEOUT_MS = 60000;

/**
 * One request. Resolves with the parsed body, or throws `ApiError` — always
 * `ApiError`, never a bare `TypeError` from fetch, so every caller has exactly
 * one thing to catch and one `code` to localise.
 *
 * A 204 (and any other empty body) resolves as `undefined` rather than dying
 * in `JSON.parse`: `DELETE /v1/me` and the read-watermark call both answer
 * with nothing, and nothing is the correct answer.
 *
 * On 401 the session is cleared through the handler `community-session`
 * registers with `setUnauthenticatedHandler` — see `raise()`. The call is not
 * retried: the token is dead, so the next attempt fails identically.
 */
/**
 * The same call, with a multipart body.
 *
 * SEPARATE FROM `api` BECAUSE THE CONTENT TYPE MUST NOT BE SET. `FormData`
 * carries a generated boundary, and the platform writes the whole
 * `multipart/form-data; boundary=…` header itself; setting `Content-Type` by
 * hand omits the boundary and the server sees a body it cannot parse. Rather
 * than a conditional inside `api` that is right in one branch and silently
 * fatal in the other, the two shapes are two functions.
 *
 * A longer timeout, because this uploads a photograph over a phone connection
 * rather than exchanging a few hundred bytes of JSON.
 *
 * Everything else — the error envelope, the codes, the network/abort handling —
 * is deliberately identical, so callers handle failures the same way whichever
 * they used.
 */
/**
 * The same upload, with the multipart encoder taken out of the picture.
 *
 * WHY THIS EXISTS ALONGSIDE `apiUpload`. React Native's `FormData` does not
 * take a real File — it takes a `{ uri, name, type }` shim, and the platform
 * reads that file and builds the body natively. When that fails it fails as an
 * opaque "Network request failed" with no request ever leaving the phone, which
 * is unobservable from the server end: a Worker tail shows nothing, because
 * there is nothing. A profile cover failed this way three launches running.
 *
 * Here the caller has already read the bytes, so the body is just bytes and the
 * Content-Type is just a string. Nothing is encoded and nothing is read off the
 * JS thread. The server accepts both shapes.
 */
export async function apiUploadBytes<T>(
  path: string,
  bytes: Uint8Array,
  contentType: string,
  token: string,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      // A fresh ArrayBuffer, never the view: some runtimes send the whole
      // backing buffer when handed a subarray.
      body: bytes.slice().buffer as ArrayBuffer,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ApiError('network', 0, e instanceof Error ? e.message : 'upload failed');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text().catch(() => '');
  if (!res.ok) throw raise(res.status, text);
  if (res.status === 204 || text.length === 0) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('unknown', res.status, 'response was not JSON');
  }
}

export async function apiUpload<T>(path: string, form: FormData, token: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      body: form,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ApiError('network', 0, e instanceof Error ? e.message : 'upload failed');
  } finally {
    clearTimeout(timer);
  }

  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new ApiError('network', res.status, 'response body could not be read');
  }

  if (!res.ok) throw raise(res.status, text);
  if (res.status === 204 || text.length === 0) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('network', res.status, 'response was not JSON');
  }
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = opts;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    const headers: Record<string, string> = { ...(opts.headers ?? {}), Accept: 'application/json' };
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

  if (!res.ok) throw raise(res.status, text);

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
