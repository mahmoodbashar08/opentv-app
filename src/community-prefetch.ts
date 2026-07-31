/**
 * The numbers, before you open anything.
 *
 * THE COMPLAINT THIS FILE ANSWERS. `useSeasonAggregates` and `useTargetAggregate`
 * fetch one target — or one season — when a screen opens. That is the right
 * shape for a screen and the wrong shape for a LIBRARY: it means the community
 * percentages do not exist for a title until the user has opened that title, so
 * a shelf of two hundred rated shows shows nothing until it has been visited two
 * hundred times, one at a time. The owner's words were "I have to open one each
 * time", and he was describing the design working as written.
 *
 * WHAT THIS DOES INSTEAD. `GET /v1/aggregates` has always taken a LIST —
 * `?t=source:key[:season:episode]` repeated, up to a hundred, open,
 * unauthenticated and edge-cached for five minutes. So this walks the targets
 * the user has RATED, a hundred per request, and writes what comes back into the
 * SAME `meta` cache entries the two hooks already read. Not one screen changes.
 * They read SQLite during render, as everything in this app does, and the rows
 * are simply already there.
 *
 * FOUR RULES, ALL OF THEM ABOUT NOT BEING A NUISANCE.
 *
 *  - ONLY WHAT THEY RATED. Not the watch history. A seven-year archive is tens
 *    of thousands of episodes — hundreds of requests per user — and
 *    `backend/docs/PLAN.md` §4 sizes the entire free tier at about five requests
 *    per user per day. Ratings are the smaller set by an order of magnitude and
 *    they are the ones a percentage is drawn under.
 *
 *  - IT CONVERGES AND THEN STOPS. A completed sweep is fingerprinted against the
 *    set of targets it covered. Nothing rated, nothing changed, no requests —
 *    the steady-state cost of this file is zero, and the fingerprint check is
 *    local. That is the same idiom `maybeReconcileFriends` already uses, for the
 *    same reason: the answer cannot change from this side.
 *
 *  - A BUDGET PER RUN, AND A CURSOR. At most `MAX_REQUESTS_PER_RUN` calls before
 *    it puts the bookmark down and leaves. A big library finishes over several
 *    foregrounds instead of firing ninety requests at a phone that has just been
 *    unlocked, and a run cut short by backgrounding resumes rather than restarts.
 *
 *  - FIRE AND FORGET. Nothing here throws, nothing here blocks, nothing here is
 *    shown. A percentage the user did not ask for is not worth a spinner, an
 *    error or one frame of the first paint.
 *
 * WHAT THIS DELIBERATELY DOES NOT WARM: favourite-character counts.
 * `GET /v1/character-votes` takes `source` and `key`, ONE target per request —
 * it has no `t=` list form (see `backend/src/routes/characters.ts`). Warming
 * them here would therefore mean one request per show rather than one per
 * hundred, which is the exact cost this file exists to avoid, and it would blow
 * the whole free-tier budget sized in `backend/docs/PLAN.md` §4 on a number
 * that appears under a row most people never scroll to. `useCharacterVotes`
 * fetches one show when that show is opened, and caches it for the server's own
 * five minutes. If the endpoint ever grows a list form, this is where it goes.
 */
import { api } from '@/api';
import { isJoined } from '@/community-session';
import type { Aggregate } from '@/community-ratings';
import {
  getMeta,
  getSeedableEpisodeEmotions,
  getSeedableEpisodeRatings,
  getSeedableMovieVotes,
  getShowNames,
  setMeta,
} from '@/db';
import {
  PREFETCH_TARGET_CHUNK,
  buildPrefetchTargets,
  chunk,
  prefetchDue,
  prefetchRemaining,
} from '@/pure';

/** When the sweep last did anything, so it cannot run twice on one launch. */
const AT_KEY = 'communityPrefetchAt';
/** The last target string sent — an unfinished sweep resumes from here. */
const CURSOR_KEY = 'communityPrefetchCursor';
/** When the last COMPLETE sweep finished. */
const SWEPT_KEY = 'communityPrefetchSweptAt';
/** Which set of ratings that sweep covered. */
const FINGERPRINT_KEY = 'communityPrefetchFingerprint';

/**
 * The gap between runs of an UNFINISHED sweep. Five minutes is the server's own
 * `max-age`, so a run inside it would be answered from the edge cache anyway and
 * would tell the phone nothing it does not already hold.
 */
export const PREFETCH_RUN_WINDOW_MS = 5 * 60 * 1000;

/**
 * The gap before a COMPLETED sweep is redone from the top.
 *
 * A day, not five minutes, and the difference is the whole economics of the
 * feature. Percentages move slowly — a vote count that gains a few votes
 * overnight rounds to the same bar — so re-sweeping a whole library more often
 * than daily buys nothing and multiplies every user's request count by the
 * number of windows in a day.
 */
export const PREFETCH_SWEEP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Requests per run. Ten chunks is a thousand targets, which covers most
 * libraries in a single run and caps the worst one at ten calls per five-minute
 * window rather than "however many the archive happens to need, right now, all
 * at once".
 */
export const PREFETCH_MAX_REQUESTS_PER_RUN = 10;

/** One row of the LIST form, which carries the target back so it can be filed. */
type ListedAggregate = Aggregate & { target_source?: string; target_key?: string };

type CacheEntry = { fetchedAt: number; items: Aggregate[] };

function readEntry(key: string): CacheEntry | null {
  try {
    const raw = getMeta(key);
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

function writeEntry(key: string, entry: CacheEntry): void {
  try {
    setMeta(key, JSON.stringify(entry));
  } catch {
    // An unwritable cache is a miss next time. Never a failure.
  }
}

function stamp(key: string, value: string): void {
  try {
    setMeta(key, value);
  } catch {
    // As above: losing a bookmark costs a resumed sweep some re-asking, which
    // the edge cache makes nearly free, and is never worth an error.
  }
}

function readNumber(key: string): number | null {
  const n = Number(getMeta(key) ?? '');
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * A cheap, stable stamp of "which set of ratings this was". Not a security
 * hash — the same FNV-1a `community-seed.ts` uses for the friend list, and for
 * the same job: answer "has this changed" without keeping a second copy.
 */
function fingerprint(targets: readonly string[]): string {
  let h = 2166136261;
  for (const t of targets) {
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return `${targets.length}:${(h >>> 0).toString(36)}`;
}

/**
 * Every target the user could see a number for, read from the same tables the
 * archive upload reads.
 *
 * `getSeedableMovieVotes` already covers films with a feeling and no star (its
 * WHERE clause unions the `emotions` table), so there is no second film query.
 * Episodes need both tables: an episode with a face and no star is still a
 * rating, and still has a percentage under it.
 */
export function prefetchTargets(): string[] {
  try {
    const knownShowIds = new Set(getShowNames().map((s) => s.tvdbId));
    const episodes = [...getSeedableEpisodeRatings(), ...getSeedableEpisodeEmotions()].map((r) => ({
      showId: r.showId,
      season: r.season,
      episode: r.episode,
    }));
    return buildPrefetchTargets({ episodes, movies: getSeedableMovieVotes(), knownShowIds });
  } catch {
    // A partial or unreadable library prefetches nothing. Never throws: this is
    // called from a background effect with nobody waiting on it.
    return [];
  }
}

/**
 * File one returned row into the cache the screens already read.
 *
 * TWO CACHES, AND THE `fetchedAt` DIFFERS BETWEEN THEM ON PURPOSE.
 *
 *  - A FILM (or show-level) row is a COMPLETE answer for its key, so it is
 *    written with a real timestamp and the film screen shows it with no request
 *    at all for the next five minutes.
 *  - A SEASON entry is not. The prefetch may have filled three episodes of a
 *    twelve-episode season, and `readSeasonAggregates` hands the whole entry to
 *    the screen. Writing a fresh timestamp on a partial season would make
 *    `fetchSeasonAggregates` consider it current and skip the request that would
 *    have filled the other nine — trading the bug the owner reported for a
 *    quieter one. So a season entry the prefetch created carries `fetchedAt: 0`:
 *    present, therefore rendered on first paint; stale, therefore still
 *    refreshed the moment the screen opens. An entry a real season fetch already
 *    wrote keeps ITS timestamp and is merged into, never downgraded.
 */
function fileAggregate(row: ListedAggregate, now: number): void {
  const source = row.target_source;
  const key = row.target_key;
  if (!source || !key) return;

  if (source === 'tvdb' && row.season >= 0) {
    const cacheKey = `agg:tvdb:${key}:${row.season}`;
    const existing = readEntry(cacheKey);
    const items = (existing?.items ?? []).filter((i) => i.episode !== row.episode);
    items.push(stripTarget(row));
    writeEntry(cacheKey, { fetchedAt: existing?.fetchedAt ?? 0, items });
    return;
  }

  // The show/film level: season -1, episode -1. `targetCacheKey` in
  // community-ratings.ts is three colon-separated parts where the season key is
  // four, so the two namespaces cannot collide.
  writeEntry(`agg:${source}:${key}`, { fetchedAt: now, items: [stripTarget(row)] });
}

/** The target columns are addressing, not data — they do not belong in the cache. */
function stripTarget(row: ListedAggregate): Aggregate {
  return {
    season: row.season,
    episode: row.episode,
    vote_count: row.vote_count,
    score_sum: row.score_sum,
    emotion_counts: row.emotion_counts,
    score_counts: row.score_counts,
  };
}

/** One in-flight sweep. Foreground and a finished seed can both ask at once. */
let inFlight: Promise<void> | null = null;

/**
 * Run the sweep if it is due. Resolves; never rejects; reports nothing.
 *
 * Safe to call on every foreground and after every seed — the throttle and the
 * fingerprint are what make that true, not the caller's restraint.
 */
export function maybePrefetchAggregates(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = run().catch(() => undefined).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<void> {
  if (!isJoined()) return;

  const now = Date.now();
  if (!prefetchDue(readNumber(AT_KEY), now, PREFETCH_RUN_WINDOW_MS)) return;

  const targets = prefetchTargets();
  if (targets.length === 0) return;

  const cursor = getMeta(CURSOR_KEY) ?? '';
  const fp = fingerprint(targets);

  // No sweep in progress: only start one if something changed, or if the last
  // complete one has aged out. This is the branch that makes the steady-state
  // cost of the whole feature zero requests.
  if (!cursor) {
    const swept = readNumber(SWEPT_KEY);
    if (getMeta(FINGERPRINT_KEY) === fp && !prefetchDue(swept, now, PREFETCH_SWEEP_WINDOW_MS)) return;
  }

  // Stamped BEFORE the requests, not after. A run that dies mid-flight — the app
  // killed on backgrounding is the ordinary case — must not leave the throttle
  // unstamped and invite the next foreground to start again immediately.
  stamp(AT_KEY, String(now));

  const remaining = prefetchRemaining(targets, cursor);
  const batches = chunk(remaining, PREFETCH_TARGET_CHUNK).slice(0, PREFETCH_MAX_REQUESTS_PER_RUN);

  for (const batch of batches) {
    let res: { items?: ListedAggregate[] };
    try {
      const query = batch.map((t) => `t=${encodeURIComponent(t)}`).join('&');
      // No auth header. The endpoint is open by design, and a bearer token on
      // the one request the edge can answer for everybody at once would defeat
      // the cache it exists for.
      res = await api<{ items?: ListedAggregate[] }>(`/v1/aggregates?${query}`);
    } catch {
      // Offline, a timeout, an edge error page. The bookmark stands where the
      // last successful chunk left it and the next foreground picks it up.
      return;
    }

    const items = Array.isArray(res?.items) ? res.items : [];
    for (const item of items) {
      try {
        fileAggregate(item, Date.now());
      } catch {
        // One malformed row does not cost the other ninety-nine.
      }
    }
    stamp(CURSOR_KEY, batch[batch.length - 1]);
  }

  // The whole list walked: put the bookmark away and record what was covered, so
  // the next call can answer "nothing to do" without a single request.
  if (batches.length * PREFETCH_TARGET_CHUNK >= remaining.length) {
    stamp(CURSOR_KEY, '');
    stamp(SWEPT_KEY, String(now));
    stamp(FINGERPRINT_KEY, fp);
  }
}
