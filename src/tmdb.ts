/** Runtime TMDB client for the on-device importer.
 *  Key lives in src/tmdb-token.ts (gitignored) — see tmdb-token.example.ts. */
import { TMDB_TOKEN as TOKEN } from '@/tmdb-token';

export async function tmdb<T = Record<string, unknown>>(path: string): Promise<T> {
  const res = await fetch(`https://api.themoviedb.org/3${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return (await res.json()) as T;
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
