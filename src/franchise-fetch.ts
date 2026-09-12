/**
 * Asking TMDB what series a film belongs to, once.
 *
 * TWO CALLS, THEN NEVER AGAIN. `/movie/{id}` says whether the film is part of a
 * collection; `/collection/{id}` lists the collection. A series gains a film
 * every few years, so the answer is cached in `meta` and only re-asked after a
 * month — a band that refetched on every open would spend a person's battery
 * to tell them the same nine films.
 *
 * ABSENCE IS CACHED TOO. Most films belong to no collection at all, and
 * without recording that, every open of every standalone film would make two
 * requests to be told "no" again.
 */
import { getMeta, setMeta } from '@/db';
import type { Part } from '@/franchise';
import { tmdb } from '@/tmdb';

const IMG = 'https://image.tmdb.org/t/p';
const MONTH = 30 * 86400000;

export type Franchise = { id: number; name: string; parts: Part[] };

type Cached = { at: number; f: Franchise | null };

const keyFor = (tmdbId: number): string => `franchise:${tmdbId}`;

function read(tmdbId: number): Cached | null {
  try {
    const raw = getMeta(keyFor(tmdbId));
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch {
    return null;
  }
}

/** What is already known, with no network at all — so a screen can draw
 *  immediately and fill in later rather than flashing an empty band. */
export function cachedFranchise(tmdbId: number | null | undefined): Franchise | null {
  if (tmdbId == null) return null;
  return read(tmdbId)?.f ?? null;
}

export async function fetchFranchise(tmdbId: number): Promise<Franchise | null> {
  const have = read(tmdbId);
  if (have && Date.now() - have.at < MONTH) return have.f;

  try {
    const d = await tmdb<{ belongs_to_collection?: { id?: number } | null }>(`/movie/${tmdbId}`);
    const id = d.belongs_to_collection?.id;
    if (!id) {
      setMeta(keyFor(tmdbId), JSON.stringify({ at: Date.now(), f: null } satisfies Cached));
      return null;
    }

    const c = await tmdb<{
      name?: string;
      parts?: { id?: number; title?: string; poster_path?: string | null; release_date?: string }[];
    }>(`/collection/${id}`);

    const f: Franchise = {
      id,
      name: c.name ?? '',
      parts: (c.parts ?? [])
        .filter((x): x is { id: number; title: string; poster_path?: string | null; release_date?: string } =>
          typeof x.id === 'number' && typeof x.title === 'string',
        )
        .map((x) => ({
          tmdbId: x.id,
          title: x.title,
          poster: x.poster_path ? `${IMG}/w342${x.poster_path}` : null,
          release: x.release_date ?? '',
        })),
    };
    // A "collection" of one is the film you are already looking at.
    const keep = f.parts.length >= 2 ? f : null;
    setMeta(keyFor(tmdbId), JSON.stringify({ at: Date.now(), f: keep } satisfies Cached));
    return keep;
  } catch {
    // Offline, or TMDB having a day. Nothing is cached, so the next open asks
    // again rather than remembering a failure as an answer.
    return null;
  }
}
