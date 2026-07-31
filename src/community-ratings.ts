/**
 * What everyone else thought — the numbers half of the community.
 *
 * Two directions, and they are deliberately asymmetric:
 *
 *   READ  `GET /v1/aggregates` — open, unauthenticated, edge-cached. One call
 *         per season, cached in `meta` for the same 5 minutes the server's
 *         `Cache-Control` advertises, so swiping through a season costs one
 *         request rather than one per episode.
 *
 *   WRITE `POST /v1/ratings` — fire and forget. The local rating is already
 *         written and is the source of truth; the server copy is a bonus. A
 *         failure here is never retried, never surfaced, never allowed to
 *         reach a screen. If every call in this file failed forever the
 *         tracker would keep working and the user would not be told, because
 *         there is nothing they could do and nothing of theirs was lost.
 *
 * Not joined → nothing at all. No request, no cache write, no placeholder.
 */
import { useEffect, useState } from 'react';

import { api } from '@/api';
import { getToken, isJoined, useJoined } from '@/community-session';
import { getMeta, setMeta } from '@/db';
import { EMOTION_NAMES, aggregateFresh, type EmotionName } from '@/pure';

/** The server's allow-list, mirrored from `backend/src/pure.ts` (`EMOTIONS`).
 *
 *  Not decoration: the server interpolates an emotion name into a JSON path in
 *  the aggregate upsert, so anything outside this list is rejected at the
 *  border. Sending one would earn a silent 400 on a fire-and-forget call — the
 *  worst kind of bug, because nothing would ever say so.
 *
 *  It LIVES in `pure.ts` now and is re-exported here under its original name.
 *  The archive seeder needs the same twelve, in the same order, to turn a local
 *  emotion INDEX into a name; two copies of an order-sensitive list is how a
 *  seeded "shocked" quietly becomes somebody else's "frustrated". One list, in
 *  the file the tests can reach, with both callers pointing at it. */
export const COMMUNITY_EMOTIONS = EMOTION_NAMES;
export type CommunityEmotion = EmotionName;

export function isCommunityEmotion(v: string): v is CommunityEmotion {
  return (COMMUNITY_EMOTIONS as readonly string[]).includes(v);
}

/** One row of `GET /v1/aggregates`, exactly as `shapeAggregate` returns it. */
export type Aggregate = {
  season: number;
  episode: number;
  vote_count: number;
  /** Raw on purpose — see `communityScore` in pure.ts for why. */
  score_sum: number;
  emotion_counts: Record<string, number>;
  /** The distribution behind the mean, keyed "2".."10" — what the design's
   *  column under the stars is actually made of. Optional because a cache
   *  entry written before this field existed will not carry it, and because
   *  the server sends `{}` for rows the nightly recount has not backfilled;
   *  `starPercents` reads either as "no data" without a special case. */
  score_counts?: Record<string, number>;
};

/** A season's aggregates, keyed by episode number. */
export type SeasonAggregates = Record<number, Aggregate>;

type CacheEntry = { fetchedAt: number; items: Aggregate[] };

/** Matches `CACHE_CONTROL` in `backend/src/routes/ratings.ts`: max-age=300. */
const TTL_MS = 5 * 60 * 1000;

function cacheKey(showTvdbId: number, season: number): string {
  return `agg:tvdb:${showTvdbId}:${season}`;
}

function byEpisode(items: readonly Aggregate[]): SeasonAggregates {
  const out: SeasonAggregates = {};
  for (const it of items) out[it.episode] = it;
  return out;
}

/** Anything at all wrong with the stored blob reads as "no cache". */
function readCache(showTvdbId: number, season: number): CacheEntry | null {
  try {
    const raw = getMeta(cacheKey(showTvdbId, season));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const e = parsed as { fetchedAt?: unknown; items?: unknown };
    if (typeof e.fetchedAt !== 'number' || !Array.isArray(e.items)) return null;
    return { fetchedAt: e.fetchedAt, items: e.items as Aggregate[] };
  } catch {
    // Corrupt JSON, or the database is momentarily unavailable. Either way the
    // honest answer is "nothing cached" — never a thrown error mid-render.
    return null;
  }
}

function writeCache(showTvdbId: number, season: number, entry: CacheEntry): void {
  try {
    setMeta(cacheKey(showTvdbId, season), JSON.stringify(entry));
  } catch {
    // A cache that cannot be written is a cache miss next time. Not a failure.
  }
}

/**
 * The cached season, synchronously, for use during render — the way every
 * other screen in this app reads its state. Empty when there is nothing
 * cached, stale or otherwise: staleness decides whether to REFETCH, not
 * whether to show. Showing a four-hour-old vote count beats showing a blank
 * while a request flies.
 */
export function readSeasonAggregates(showTvdbId: number, season: number): SeasonAggregates {
  const entry = readCache(showTvdbId, season);
  return entry ? byEpisode(entry.items) : {};
}

/**
 * Refresh a season from the server, unless the cache is still fresh.
 *
 * Resolves with the new map, or null when nothing changed (fresh cache, not
 * joined, request failed). Never rejects: every caller of this is a background
 * effect, and an unhandled rejection in one is a redbox in development for a
 * number nobody was waiting on.
 *
 * No auth header. The endpoint is open by design — a percentage is public, and
 * a bearer token on the one request the edge can answer for everybody at once
 * would defeat the cache it was built for.
 */
export async function fetchSeasonAggregates(
  showTvdbId: number,
  season: number,
  force = false,
): Promise<SeasonAggregates | null> {
  if (!isJoined()) return null;

  const cached = readCache(showTvdbId, season);
  if (!force && aggregateFresh(cached?.fetchedAt, Date.now(), TTL_MS)) return null;

  try {
    const res = await api<{ items?: Aggregate[] }>(
      `/v1/aggregates?source=tvdb&key=${encodeURIComponent(String(showTvdbId))}&season=${season}`,
    );
    const items = Array.isArray(res?.items) ? res.items : [];
    writeCache(showTvdbId, season, { fetchedAt: Date.now(), items });
    return byEpisode(items);
  } catch {
    // Offline, timeout, a 500, an edge error page. The cached numbers stand and
    // the user is told nothing — they did not ask for this request.
    return null;
  }
}

/**
 * The whole season, read from cache immediately and refreshed behind the
 * scenes. One request per season per five minutes, issued when the episode
 * screen opens, so paging between episodes costs nothing.
 *
 * Returns an empty map when not joined, which is what makes "render nothing
 * when not joined" fall out of the data rather than out of a branch in the UI.
 */
export function useSeasonAggregates(showTvdbId: number | undefined, season: number): SeasonAggregates {
  const joined = useJoined();
  // Nothing is held in state: the cache is SQLite and SQLite is read during
  // render everywhere else in this app. The counter exists only to say "the
  // background refresh landed, read it again" — the same shape as `bumpMeta`
  // in the episode screen. Keeping a copy in state would be a second source of
  // truth for the same rows, and would need a synchronous setState inside the
  // effect to stay level with it.
  const [, bump] = useState(0);

  useEffect(() => {
    if (!joined || !showTvdbId) return;
    let alive = true;
    void fetchSeasonAggregates(showTvdbId, season).then((fresh) => {
      if (alive && fresh) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [joined, showTvdbId, season]);

  return joined && showTvdbId ? readSeasonAggregates(showTvdbId, season) : {};
}

// ── one target, for the screens that are not a season ────────────────────────

/** A film's own rollup, cached under its own key. Three colon-separated parts
 *  where the season cache has four, so the two namespaces cannot collide. */
function targetCacheKey(source: RatingPost['source'], key: string): string {
  return `agg:${source}:${key}`;
}

function readTargetCache(source: RatingPost['source'], key: string): CacheEntry | null {
  try {
    const raw = getMeta(targetCacheKey(source, key));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const e = parsed as { fetchedAt?: unknown; items?: unknown };
    if (typeof e.fetchedAt !== 'number' || !Array.isArray(e.items)) return null;
    return { fetchedAt: e.fetchedAt, items: e.items as Aggregate[] };
  } catch {
    return null;
  }
}

/**
 * One target's rollup, via the `t=` list form: `t=title:<key>`.
 *
 * A film has no season to batch by, so the season URL would be a lie here —
 * `source=title&key=…` with no season means season -1, which is right, but the
 * list form is the shape the server documents for "a mixed screen, e.g. a
 * watchlist of films" and it is the one that will still work when the films tab
 * asks for twenty at once. Season and episode are omitted, which `parseTargets`
 * reads as the film's own row (-1/-1) — the same row `postRating` writes to
 * with `season: null, episode: null`.
 *
 * Same five-minute TTL as the season cache, for the same reason: it is the
 * `max-age` the server itself advertises.
 */
export async function fetchTargetAggregate(
  source: RatingPost['source'],
  key: string,
  force = false,
): Promise<Aggregate | null> {
  if (!isJoined() || !key) return null;

  const cached = readTargetCache(source, key);
  if (!force && aggregateFresh(cached?.fetchedAt, Date.now(), TTL_MS)) return null;

  try {
    const res = await api<{ items?: Aggregate[] }>(
      `/v1/aggregates?t=${encodeURIComponent(`${source}:${key}`)}`,
    );
    const items = Array.isArray(res?.items) ? res.items : [];
    try {
      setMeta(targetCacheKey(source, key), JSON.stringify({ fetchedAt: Date.now(), items }));
    } catch {
      // an unwritable cache is a miss next time, not a failure
    }
    return items[0] ?? null;
  } catch {
    return null;
  }
}

/** The cached rollup, synchronously, the way every other read in this app works. */
export function readTargetAggregate(source: RatingPost['source'], key: string): Aggregate | null {
  const entry = readTargetCache(source, key);
  return entry?.items[0] ?? null;
}

/** Read from cache immediately, refresh behind the scenes. Mirrors
 *  `useSeasonAggregates` exactly — see the note there on why nothing is held
 *  in state. Returns null when not joined, which is what makes the film screen
 *  look untouched for someone who never joined. */
export function useTargetAggregate(
  source: RatingPost['source'],
  key: string | null | undefined,
): Aggregate | null {
  const joined = useJoined();
  const [, bump] = useState(0);

  useEffect(() => {
    if (!joined || !key) return;
    let alive = true;
    void fetchTargetAggregate(source, key).then((fresh) => {
      if (alive && fresh) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [joined, source, key]);

  return joined && key ? readTargetAggregate(source, key) : null;
}

export type RatingPost = {
  source: 'tvdb' | 'tmdb' | 'title';
  key: string;
  season: number | null;
  episode: number | null;
  /** 1–10, or null for an emotion-only vote. */
  score: number | null;
  emotion: CommunityEmotion | null;
};

/**
 * Send a vote. Returns nothing, throws nothing, tells nobody.
 *
 * WHY FIRE AND FORGET, AND WHY IT IS NOT LAZINESS. The user tapped a star;
 * the star is filled and the row is in SQLite before this function is called.
 * The server copy exists so *other people* can see the number. Blocking a tap
 * on a network round trip, or raising an alert when it fails, would make the
 * community's plumbing the user's problem in exchange for nothing they can
 * act on. A missed vote costs one increment on somebody else's percentage.
 *
 * NO RETRY LOOP either. The next tap on this episode sends the whole current
 * state again — the endpoint is an upsert keyed on (person, target), not an
 * append — so the natural repair is the user's next interaction, not a queue
 * this module would have to own, persist and drain.
 *
 * A vote with neither a score nor an emotion is not sent at all: the server
 * rejects it as `empty_vote`, correctly, because clearing a vote is a delete
 * and deleting is not this endpoint's job.
 */
export function postRating(vote: RatingPost): void {
  if (!isJoined()) return;
  if (vote.score === null && vote.emotion === null) return;

  void (async () => {
    try {
      const token = await getToken();
      if (!token) return; // meta says joined, Keychain disagrees — nothing to prove it with
      const res = await api<{ aggregate?: Aggregate | null }>('/v1/ratings', {
        method: 'POST',
        token,
        body: {
          target_source: vote.source,
          target_key: vote.key,
          season: vote.season,
          episode: vote.episode,
          score: vote.score,
          emotion: vote.emotion,
        },
      });
      // The response carries the updated rollup. Folding it into the cache
      // means the user's own vote is counted the next time they open the
      // episode instead of waiting out the five-minute TTL. Purely a bonus:
      // if this is missing, the number is simply five minutes behind.
      const agg = res?.aggregate;
      if (agg && vote.source === 'tvdb' && vote.season !== null) {
        const showTvdbId = Number(vote.key);
        if (Number.isFinite(showTvdbId)) {
          const cached = readCache(showTvdbId, vote.season);
          if (cached) {
            const items = cached.items.filter((i) => i.episode !== agg.episode);
            items.push(agg);
            writeCache(showTvdbId, vote.season, { fetchedAt: cached.fetchedAt, items });
          }
        }
      }
    } catch {
      // Silent by contract. See the note above.
    }
  })();
}
