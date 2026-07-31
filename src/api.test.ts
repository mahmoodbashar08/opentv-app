/**
 * The API client's failure handling. `fetch` is stubbed, so nothing here goes
 * near a network; what is being pinned is that EVERY outcome — envelope, HTML
 * error page, empty 204, dead socket — arrives at the caller as an `ApiError`
 * with a usable `code`, because the UI localises from `code` and has nothing
 * to show without one.
 *
 * `@/api-config` is mapped to the committed `.example` in jest.config.js: the
 * real one is gitignored, and a test must never aim at the production host.
 *
 * The session store is NOT tested here — `expo-secure-store` is native, and a
 * mock of the Keychain would only assert that the mock works.
 */
import { api, ApiError, errorFromResponse } from '@/api';

type FetchArgs = { url: string; init: RequestInit };

/** A stub `fetch` that answers once with the given status/body. */
function stubFetch(status: number, body: string, headers: Record<string, string> = {}): FetchArgs[] {
  const calls: FetchArgs[] = [];
  global.fetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(status === 204 ? null : body, { status, headers }));
  }) as unknown as typeof fetch;
  return calls;
}

afterEach(() => {
  // @ts-expect-error — putting the global back the way it was found
  delete global.fetch;
});

describe('errorFromResponse — the {error:{code,message}} envelope', () => {
  it('reads a real envelope', () => {
    const e = errorFromResponse(401, JSON.stringify({ error: { code: 'unauthenticated', message: 'no session' } }));
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('unauthenticated');
    expect(e.status).toBe(401);
    expect(e.needsSignIn).toBe(true);
  });

  it('reads every other server code the same way', () => {
    expect(errorFromResponse(409, '{"error":{"code":"handle_taken","message":"taken"}}').code).toBe('handle_taken');
    expect(errorFromResponse(429, '{"error":{"code":"rate_limited","message":"slow"}}').code).toBe('rate_limited');
    expect(errorFromResponse(403, '{"error":{"code":"blocked","message":"nope"}}').code).toBe('blocked');
  });

  /** An edge 502 arrives as HTML. It must not become a SyntaxError on top of
   *  the failure it was already reporting. */
  it('gives a non-JSON 500 the synthetic code', () => {
    const e = errorFromResponse(500, '<html><body>Bad gateway</body></html>');
    expect(e.code).toBe('unknown');
    expect(e.status).toBe(500);
  });

  it('still knows a bodyless 401 is a dead session', () => {
    expect(errorFromResponse(401, '').code).toBe('unauthenticated');
  });

  it('refuses a code the server does not define', () => {
    expect(errorFromResponse(400, '{"error":{"code":"made_up","message":"x"}}').code).toBe('unknown');
  });

  it('ignores JSON of the wrong shape', () => {
    expect(errorFromResponse(400, '[1,2,3]').code).toBe('unknown');
    expect(errorFromResponse(400, 'null').code).toBe('unknown');
    expect(errorFromResponse(400, '{"error":"a string"}').code).toBe('unknown');
  });
});

describe('api', () => {
  it('parses a success body', async () => {
    stubFetch(200, JSON.stringify({ ok: true, db: true }));
    await expect(api<{ ok: boolean }>('/health')).resolves.toEqual({ ok: true, db: true });
  });

  it('returns undefined for a 204 rather than dying in JSON.parse', async () => {
    stubFetch(204, '');
    await expect(api<void>('/v1/me', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('attaches the bearer token only when one is given', async () => {
    const withToken = stubFetch(200, '{}');
    await api('/v1/me', { token: 'abc123' });
    expect((withToken[0].init.headers as Record<string, string>).Authorization).toBe('Bearer abc123');

    const without = stubFetch(200, '{}');
    await api('/v1/aggregates');
    expect((without[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('sends a JSON body and no body at all for a plain GET', async () => {
    const posted = stubFetch(200, '{}');
    await api('/v1/ratings', { method: 'POST', body: { score: 9 } });
    expect(posted[0].init.method).toBe('POST');
    expect(posted[0].init.body).toBe('{"score":9}');

    const got = stubFetch(200, '{}');
    await api('/v1/me');
    expect(got[0].init.body).toBeUndefined();
  });

  it('throws ApiError with the envelope code on a failure', async () => {
    stubFetch(401, '{"error":{"code":"unauthenticated","message":"no session"}}');
    await expect(api('/v1/me', { token: 'bad' })).rejects.toMatchObject({
      name: 'ApiError',
      code: 'unauthenticated',
      status: 401,
    });
  });

  it('turns a thrown fetch — offline, DNS, our own abort — into code network, status 0', async () => {
    global.fetch = (() => Promise.reject(new TypeError('Network request failed'))) as unknown as typeof fetch;
    await expect(api('/health')).rejects.toMatchObject({ name: 'ApiError', code: 'network', status: 0 });
  });

  it('treats a 200 that is not JSON as a network failure, not a success', async () => {
    stubFetch(200, '<html>captive portal</html>');
    await expect(api('/health')).rejects.toMatchObject({ code: 'network', status: 200 });
  });
});
