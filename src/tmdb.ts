/** Runtime TMDB client for the on-device importer.
 *  Key lives in src/tmdb-token.ts (gitignored) — see tmdb-token.example.ts. */
import { getMeta, setMeta } from '@/db';
import { TMDB_TOKEN as BUNDLED } from '@/tmdb-token';
import { isNetworkError, netGuard, netReachable, netUnreachable } from '@/net-circuit';

/**
 * THE READER'S OWN TMDB TOKEN, if they added one.
 *
 * Same shape as `userTvdbKey` in `tvdb.ts`, and here for the same two reasons:
 * a shared free-tier token can expire, be revoked or hit its quota, and
 * somebody running their own server reasonably wants nothing of ours in their
 * setup at all — including the token their phone fetches artwork with.
 *
 * Metadata NEVER passes through the community server, so this cannot live
 * there: the phone asks TMDB directly, and the token has to be on the phone.
 *
 * Blank means the bundled one, which is what every store install uses.
 */
export function userTmdbToken(): string {
  return (getMeta('userTmdbToken') || '').trim();
}

export function activeTmdbToken(): string {
  return userTmdbToken() || BUNDLED;
}

export function setUserTmdbToken(token: string): void {
  setMeta('userTmdbToken', token.trim());
}

/**
 * Does this token actually work?
 *
 * Asked BEFORE it is saved, because self-hosting requires a reader's own keys
 * and a rejected one would leave an app with no artwork and no titles and no
 * explanation. `/configuration` is the cheapest authenticated call TMDB has.
 *
 * Only a 401 means the token is wrong. A timeout or a 5xx is the network, and
 * refusing a good token because a train went into a tunnel would be worse than
 * accepting a bad one — that comes back as missing posters, this comes back as
 * "your key is invalid" about a key that is not.
 */
export async function checkTmdbToken(token: string): Promise<'ok' | 'bad' | 'unreachable'> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch('https://api.themoviedb.org/3/configuration', {
      headers: { Authorization: `Bearer ${token.trim()}` },
      signal: ctrl.signal,
    });
    if (res.ok) return 'ok';
    return res.status === 401 || res.status === 403 ? 'bad' : 'unreachable';
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}

export async function tmdb<T = Record<string, unknown>>(path: string): Promise<T> {
  // a stuck request must never hang the whole import — abort after 15s so
  // pool() records it as a (retryable) miss and moves on
  //
  // AND THE 15s IS NOT ENOUGH ON ITS OWN. `pool` runs ten of these at a time
  // and swallows each failure, so an unreachable TMDB costs a 500-show library
  // twelve minutes of timeouts before the import gives up — see
  // `net-circuit.ts`. The breaker is asked BEFORE the request, so the four
  // hundredth call can act on what the first ten learned.
  netGuard();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`https://api.themoviedb.org/3${path}`, {
      headers: { Authorization: `Bearer ${activeTmdbToken()}` },
      signal: ctrl.signal,
    });
    // A RESPONSE, whatever its status. A 404 says the server is alive and the
    // show is not there; counting that as a network failure would let a
    // library of obscure titles convince the app it is offline.
    netReachable();
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    if (isNetworkError(err)) netUnreachable();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Run tasks with limited concurrency, reporting progress after each. */
export async function pool<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
  onEach?: (done: number, total: number) => void,
): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  let done = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await worker(items[i]);
      } catch {
        out[i] = null;
      }
      done++;
      onEach?.(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return out;
}
