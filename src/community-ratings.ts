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
import { useEffect, useMemo, useState } from 'react';

import { api } from '@/api';
import { getToken, isJoined, useJoined } from '@/community-session';
import { getMeta, setMeta } from '@/db';
import { EMOTION_NAMES, aggregateFresh, safeCharacterName, type EmotionName } from '@/pure';

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

/**
 * Screens currently showing a percentage.
 *
 * THE CACHE IS SQLITE, WHICH REACT CANNOT OBSERVE. Every hook here reads it
 * during render and re-renders only when its own effect tells it to — and an
 * effect keyed on `[joined, source, key]` does not run when the user votes,
 * because voting changes none of those. So a vote wrote a fresher number into
 * the cache and the screen went on showing the older one until it was closed
 * and opened again. That is the whole of "I have to reopen it to see my
 * rating", and of "it doesn't count my choice": the number on screen was from
 * before the vote, so of course it excluded it.
 *
 * `postRating` calls `notifyAggregates` after it folds the server's reply in;
 * every mounted hook re-reads. A Set of thunks rather than an event emitter —
 * there is one event and it carries nothing.
 */
const listeners = new Set<() => void>();

function notifyAggregates(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // one screen's re-render must not stop another's
    }
  }
}

/** Subscribe for the lifetime of a component; returns the unsubscribe. */
function onAggregates(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

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
 * Resolves with the season's map — from the network, or from a cache that was
 * still fresh — and null only when there is genuinely nothing to show (not
 * joined, or the request failed with nothing cached). Never rejects: every
 * caller of this is a background effect, and an unhandled rejection in one is a
 * redbox in development for a number nobody was waiting on.
 *
 * A FRESH CACHE RETURNS THE DATA, IT DOES NOT RETURN NULL. That distinction is
 * the whole of the "blank until the second visit" bug: the hooks below can only
 * tell React the SQLite-backed cache moved by re-rendering, and they used to
 * re-render only when this resolved non-null. A second effect run landing
 * inside the five-minute TTL — which is what a screen whose community key
 * settles a beat after first paint always produces — therefore wrote nothing,
 * said nothing, and left the empty first paint on screen.
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
  if (!force && cached && aggregateFresh(cached.fetchedAt, Date.now(), TTL_MS)) {
    return byEpisode(cached.items);
  }

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
    return cached ? byEpisode(cached.items) : null;
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
  const [tick, bump] = useState(0);

  // Re-read when a vote lands — see `listeners`. Without this the screen keeps
  // the pre-vote number until it is closed and reopened.
  useEffect(() => onAggregates(() => bump((n) => n + 1)), []);

  useEffect(() => {
    if (!joined || !showTvdbId) return;
    let alive = true;
    // Re-read WHATEVER the fetch decided — see `fetchSeasonAggregates`. The
    // render below reads SQLite, which React cannot observe, so this bump is
    // the only thing that can put a number that arrived after first paint on
    // the screen, and it must not be conditional on the fetch having been the
    // one to put it there.
    void fetchSeasonAggregates(showTvdbId, season).then(() => {
      if (alive) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [joined, showTvdbId, season]);

  // `tick` IS A DEPENDENCY, and that is the entire point of it.
  //
  // React Compiler is enabled (app.json → experiments.reactCompiler). It sees a
  // plain call with the arguments `(showTvdbId, season)` and caches the result
  // against them — so bumping a counter re-rendered the component and handed
  // back the very same memoised object, and the screen went on showing the
  // pre-vote number until it was unmounted and rebuilt. Naming `tick` in the
  // dependency list is what makes "something changed underneath us" a reason to
  // read SQLite again.
  return useMemo(() => {
    void tick; // read, so the linter agrees it is a dependency — it is
    return joined && showTvdbId ? readSeasonAggregates(showTvdbId, season) : {};
  }, [joined, showTvdbId, season, tick]);
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
  // Fresh cache → the CACHED ROW, not null. See `fetchSeasonAggregates`.
  if (!force && cached && aggregateFresh(cached.fetchedAt, Date.now(), TTL_MS)) {
    return cached.items[0] ?? null;
  }

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
    return cached?.items[0] ?? null;
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
  const [tick, bump] = useState(0);

  // Re-read when a vote lands — see `listeners`. Without this the screen keeps
  // the pre-vote number until it is closed and reopened.
  useEffect(() => onAggregates(() => bump((n) => n + 1)), []);

  useEffect(() => {
    if (!joined || !key) return;
    let alive = true;
    // Unconditional bump — the same reason as `useSeasonAggregates`, and it is
    // the film screen that proved it necessary: `key` is derived from a title
    // and a year that are not settled at first paint, so this effect is torn
    // down and re-run, and the re-run found a cache the first run had just
    // written and used to report nothing at all.
    void fetchTargetAggregate(source, key).then(() => {
      if (alive) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [joined, source, key]);

  // `tick` in the deps for the reason `useSeasonAggregates` gives at length:
  // React Compiler caches this read against its arguments, and a vote changes
  // neither of them.
  return useMemo(() => {
    void tick;
    return joined && key ? readTargetAggregate(source, key) : null;
  }, [joined, source, key, tick]);
}

export type RatingPost = {
  source: 'tvdb' | 'tmdb' | 'title';
  key: string;
  season: number | null;
  episode: number | null;
  /** 1–10, or null for an emotion-only vote. */
  score: number | null;
  /**
   * The person's WHOLE current selection for this target, which the server
   * REPLACES what it holds with (it diffs old against new).
   *
   *   `undefined` — say nothing about feelings; the stored set is left alone.
   *   `[]`        — clear them; the last face was un-tapped.
   *   `[a, b]`    — exactly these, however many.
   *
   * The legacy single `emotion` field is gone from this app. The server still
   * accepts it, and that is precisely why it must not be sent: it reads as a
   * one-member set and would silently delete every other feeling the person had.
   */
  emotions: CommunityEmotion[] | undefined;
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
 * A vote that mentions neither a score nor a set of feelings is not sent at
 * all: there is nothing in it to record. An EMPTY set is not that — `score:
 * null, emotions: []` is "I un-tapped my last face", which the server turns
 * into a real deletion of the feelings it holds, so it is sent. (It answers
 * `empty_vote` when there was nothing stored either; that 400 is correct and,
 * on a fire-and-forget call, invisible.)
 */
export function postRating(vote: RatingPost): void {
  if (!isJoined()) return;
  if (vote.score === null && vote.emotions === undefined) return;

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
          // Absent when undefined — `JSON.stringify` drops it — which is the
          // server's "leave the stored set alone". Never `emotion`.
          emotions: vote.emotions,
        },
      });
      // THE RESPONSE CARRIES THE UPDATED ROLLUP, already counting the vote
      // just cast. Folding it in is what puts the new percentage on the screen
      // the user is looking at, rather than five minutes later.
      const agg = res?.aggregate ?? null;

      // A NULL ROLLUP IS NEWS, NOT SILENCE. The server answers null when the
      // last thing it held for this target is gone — un-star your only rating
      // and the row is deleted — and returning early there left the screen
      // showing the percentage of a vote that no longer exists. So the cache
      // entry is dropped, which makes the next read a miss and the next fetch
      // authoritative, and the screens are told either way.
      if (vote.source === 'tvdb' && vote.season !== null) {
        const showTvdbId = Number(vote.key);
        if (Number.isFinite(showTvdbId)) {
          // WRITE EVEN WITH NOTHING CACHED. This used to be `if (cached)`, so
          // the very first vote on a season the phone had not fetched — opened
          // offline, or rated before the background fetch landed — folded
          // nothing and left the number stale until the screen was reopened.
          // A one-row entry stamped `0` is honest: it holds the truth we have
          // and is stale by definition, so the next mount refetches.
          const cached = readCache(showTvdbId, vote.season);
          const rest = (cached?.items ?? []).filter((i) => i.episode !== vote.episode);
          const items = agg ? [...rest, agg] : rest;
          writeCache(showTvdbId, vote.season, { fetchedAt: cached?.fetchedAt ?? 0, items });
        }
      } else if (!agg) {
        try {
          setMeta(targetCacheKey(vote.source, vote.key), '');
        } catch {
          // an unwritable cache is a miss next time, not a failure
        }
      } else {
        // A FILM, OR A SHOW AS A WHOLE — everything that is not an episode.
        // This branch did not exist: the reply was folded into the season
        // cache or thrown away, and a film has no season, so rating a film
        // updated nothing at all. The number then stayed as it was until the
        // five-minute TTL expired, which is exactly the "close it and open it
        // again" needed to see one's own vote counted.
        //
        // `fetchedAt: Date.now()` because this rollup came from the server
        // this instant and already includes the vote just cast.
        try {
          setMeta(
            targetCacheKey(vote.source, vote.key),
            JSON.stringify({ fetchedAt: Date.now(), items: [agg] }),
          );
        } catch {
          // an unwritable cache is a miss next time, not a failure
        }
      }
      // Whichever cache moved, the screens showing it must re-read now rather
      // than on their next mount.
      notifyAggregates();
    } catch {
      // Silent by contract. See the note above.
    }
  })();
}

// ── "Who was your favourite?" ────────────────────────────────────────────────
//
// The same two directions as the ratings above, with one asymmetry of its own:
// the app asks this question per EPISODE and the server answers it per SHOW.
// That is deliberate (see `backend/migrations/0003_character_votes.sql`) — a
// favourite-character percentage for S03E07 would spread a few thousand votes
// so thinly every bar would read 100%. The season and episode are sent as
// PROVENANCE and take no part in the server's uniqueness rule.
//
// WHY THE SERVER'S COUNTS ARE AT ZERO TODAY and this is not evidence of a bug:
// nearly every vote already in the local table came from a TV Time archive,
// which exported only an internal character id whose lookup died with their
// servers. Those rows have `name = NULL` and the rollup is keyed by the NAME,
// so they are unsendable and the seeder skips them. A vote cast in the app NOW
// carries a real name and counts. Nothing here invents a name for the rest.

/** One row of `GET /v1/character-votes`, as `shapeCharacterCounts` returns it. */
export type CharacterVoteCount = { character: string; votes: number };

/** The whole rollup for one target: the counts, and the number of PEOPLE. */
export type CharacterVotes = { items: CharacterVoteCount[]; total: number };

type CharacterCacheEntry = { fetchedAt: number } & CharacterVotes;

/** Matches `CACHE_CONTROL` in `backend/src/routes/characters.ts`: max-age=300. */
function characterCacheKey(source: RatingPost['source'], key: string): string {
  return `charvotes:${source}:${key}`;
}

/** Anything at all wrong with the stored blob reads as "no cache". */
function readCharacterCache(source: RatingPost['source'], key: string): CharacterCacheEntry | null {
  try {
    const raw = getMeta(characterCacheKey(source, key));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const e = parsed as { fetchedAt?: unknown; items?: unknown; total?: unknown };
    if (typeof e.fetchedAt !== 'number' || !Array.isArray(e.items)) return null;
    return {
      fetchedAt: e.fetchedAt,
      items: e.items as CharacterVoteCount[],
      total: typeof e.total === 'number' ? e.total : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Refresh one target's favourite counts, unless the cache is still fresh.
 *
 * `source=…&key=…`, singular: this endpoint has no list form, unlike
 * `GET /v1/aggregates`. That is the whole reason the launch prefetch does not
 * warm these — see the note in community-prefetch.ts.
 */
export async function fetchCharacterVotes(
  source: RatingPost['source'],
  key: string,
  force = false,
): Promise<CharacterVotes | null> {
  if (!isJoined() || !key) return null;

  const cached = readCharacterCache(source, key);
  // Fresh cache → the CACHED ROWS, not null. Same rule as `fetchTargetAggregate`.
  if (!force && cached && aggregateFresh(cached.fetchedAt, Date.now(), TTL_MS)) {
    return { items: cached.items, total: cached.total };
  }

  try {
    const res = await api<{ items?: CharacterVoteCount[]; total?: number }>(
      `/v1/character-votes?source=${encodeURIComponent(source)}&key=${encodeURIComponent(key)}`,
    );
    const out: CharacterVotes = {
      items: Array.isArray(res?.items) ? res.items : [],
      total: typeof res?.total === 'number' ? res.total : 0,
    };
    try {
      setMeta(characterCacheKey(source, key), JSON.stringify({ fetchedAt: Date.now(), ...out }));
    } catch {
      // an unwritable cache is a miss next time, not a failure
    }
    return out;
  } catch {
    return cached ? { items: cached.items, total: cached.total } : null;
  }
}

/** The cached rollup, synchronously, the way every other read in this app works. */
export function readCharacterVotes(source: RatingPost['source'], key: string): CharacterVotes | null {
  const entry = readCharacterCache(source, key);
  return entry ? { items: entry.items, total: entry.total } : null;
}

/**
 * Read from cache immediately, refresh behind the scenes. Mirrors
 * `useTargetAggregate` exactly — including the UNCONDITIONAL bump on settle,
 * which is not a detail. `key` on the film screen is derived from a title and a
 * year that are not settled at first paint, so this effect is torn down and
 * re-run; a bump guarded by "did anything change" means the re-run finds a
 * cache the first run had just written, decides nothing is new, and reports
 * nothing at all. That is the "it only shows on the second visit" bug.
 */
export function useCharacterVotes(
  source: RatingPost['source'],
  key: string | null | undefined,
): CharacterVotes | null {
  const joined = useJoined();
  const [tick, bump] = useState(0);

  // Re-read when a vote lands — see `listeners`. Without this the screen keeps
  // the pre-vote number until it is closed and reopened.
  useEffect(() => onAggregates(() => bump((n) => n + 1)), []);

  useEffect(() => {
    if (!joined || !key) return;
    let alive = true;
    void fetchCharacterVotes(source, key).then(() => {
      if (alive) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [joined, source, key]);

  // `tick` in the deps — see `useSeasonAggregates`.
  return useMemo(() => {
    void tick;
    return joined && key ? readCharacterVotes(source, key) : null;
  }, [joined, source, key, tick]);
}

export type CharacterVotePost = {
  source: RatingPost['source'];
  key: string;
  /** The character's NAME — the only half of the pair the server can render. */
  character: string;
  /** Provenance, not identity. Null for a film, which has neither. */
  season: number | null;
  episode: number | null;
};

/**
 * Send a favourite. Fire and forget, for every reason `postRating` gives: the
 * row is in SQLite and the tile is yellow before this is called, and the server
 * copy exists so other people can see a percentage. A missed vote costs one
 * increment on somebody else's bar and nothing of the user's.
 *
 * NAME VALIDATED FIRST, locally. The server interpolates the name into a JSON
 * path and refuses a `"` or a backslash; `safeCharacterName` mirrors that rule
 * so a doomed name costs no round trip. It also catches the null-named archive
 * rows, which can never be sent.
 *
 * CLEARING IS `clearCharacterVote`, not this. It used to be nothing at all, and
 * the two sides drifted: the phone showed no favourite while the server still
 * counted one, so re-opening a film showed a full bar beside an unhighlighted
 * face and a working feature looked broken.
 */
export function postCharacterVote(vote: CharacterVotePost): void {
  if (!isJoined()) return;
  const character = safeCharacterName(vote.character);
  if (!character || !vote.key) return;

  void (async () => {
    try {
      const token = await getToken();
      if (!token) return; // meta says joined, Keychain disagrees
      await api('/v1/character-votes', {
        method: 'POST',
        token,
        body: {
          target_source: vote.source,
          target_key: vote.key,
          character,
          season: vote.season,
          episode: vote.episode,
        },
      });
      // THE VOTE ENDPOINT RETURNS NO ROLLUP, so unlike `postRating` there is
      // nothing to fold in — the counts have to be asked for again. This used
      // to be left to the five-minute cache on the grounds that one bar moves
      // by a fraction of a percent; that is true of everybody else's bar and
      // false of the voter's own, which sits at the old number until the screen
      // is closed and reopened. `force` skips the freshness check, which would
      // otherwise return the very cache being replaced.
      await fetchCharacterVotes(vote.source, vote.key, true);
      notifyAggregates();
    } catch {
      // Silent by contract. See `postRating`.
    }
  })();
}

/**
 * Withdraw this person's favourite for one target.
 *
 * The mirror of `postCharacterVote` and silent for the same reasons: the local
 * row is already gone and the tile is already unlit, so a failure here costs
 * one stale increment on a bar and nothing of the user's. The next pick on the
 * same target moves that count anyway, and the nightly recount settles it.
 *
 * No character name is sent — the server knows which one this person voted for,
 * and asking the caller to remember it would be one more thing to get wrong.
 */
export function clearCharacterVote(source: RatingPost['source'], key: string): void {
  if (!isJoined() || !key) return;

  void (async () => {
    try {
      const token = await getToken();
      if (!token) return;
      await api('/v1/character-votes', {
        method: 'DELETE',
        token,
        body: { target_source: source, target_key: key },
      });
      // Same as casting one: the bar the voter is looking at is theirs, and it
      // must lose their vote now rather than in five minutes.
      await fetchCharacterVotes(source, key, true);
      notifyAggregates();
    } catch {
      // Silent by contract. See `postRating`.
    }
  })();
}
