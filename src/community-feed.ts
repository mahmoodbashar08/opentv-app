/**
 * The friends feed — what the people you follow rated, felt, said and picked,
 * newest first, with everything you have not watched yet LOCKED (2.0.0,
 * DESIGN-community §1). Drawn by `components/feed-list.tsx` in the Explore
 * "Activity" pill; the decisions themselves are pure, in `feed-pure.ts`.
 *
 * THE LOCK IS DECIDED HERE, ON THE PHONE, against the phone's own `watches`
 * table (`hasWatchedTarget`). The request carries nothing about what this
 * person has watched and the server answers the same whatever it is — there
 * is no watch history on the server, and the feed is not a reason to start
 * one. Marking the episode watched and coming back unlocks the card on focus.
 *
 * NOTHING LEAVES THE PHONE FOR A NON-MEMBER. Every request is behind
 * `isJoined()`; an "account only" user, or somebody who never signed in, sends
 * nothing and sees the join card. Nothing runs at launch either: the feed is
 * fetched when the pill is opened, never from `_layout.tsx`.
 *
 * THE COST, ON BOTH SIDES. A focus inside 60 s of the last request reads the
 * cache and sends nothing (the `prefetchDue` idiom); pull-to-refresh is the
 * only thing that overrides it. Every refresh after the first is a DELTA —
 * `since` = the newest card held — against a hundred-card cache in `meta`, so
 * the server reads a handful of new rows instead of a friend-week of them.
 * The server's budget is written above `routes/feed.ts`.
 *
 * Reads never throw: a feed that cannot be fetched shows what it already had,
 * exactly as the comment threads do.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/api';
import { getToken, isJoined, useJoined } from '@/community-session';
import { resolveUnknownTargets, targetLabel } from '@/community-target';
import { getMeta, getMovies, hasWatchedTarget, onRemoteChange, setMeta } from '@/db';
import {
  FEED_THROTTLE_MS,
  asFeedPage,
  feedLocked,
  feedSince,
  mergeFeed,
  withoutActor,
  type FeedItem,
} from '@/feed-pure';
import { showMeta } from '@/metadata';
import { prefetchDue, slug } from '@/pure';

/** `{ fetchedAt, items, followsAnyone, more }` as JSON. Per account: cleared on sign-out. */
const CACHE_KEY = 'communityFeed';
/** When the last request went out — the 60 s throttle reads this. */
const AT_KEY = 'communityFeedAt';

type Cache = { fetchedAt: number; items: FeedItem[]; followsAnyone: boolean; more: boolean };

const EMPTY: Cache = { fetchedAt: 0, items: [], followsAnyone: true, more: false };

function readCache(): Cache {
  try {
    const raw = getMeta(CACHE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Cache>;
    const page = asFeedPage({ items: parsed.items, follows_anyone: parsed.followsAnyone });
    return {
      fetchedAt: typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : 0,
      items: page.items,
      followsAnyone: page.follows_anyone,
      more: parsed.more === true,
    };
  } catch {
    return EMPTY;
  }
}

function writeCache(c: Cache): void {
  try {
    setMeta(CACHE_KEY, JSON.stringify(c));
  } catch {
    // An unwritable cache is a cold fetch next time, never a failure.
  }
}

// ── listeners: the `onAggregates` pattern ───────────────────────────────────

const listeners = new Set<() => void>();
function emit(): void {
  listeners.forEach((fn) => fn());
}
function onFeed(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function fetchPage(query: string): Promise<ReturnType<typeof asFeedPage> | null> {
  if (!isJoined()) return null;
  try {
    const token = await getToken();
    if (!token) return null;
    return asFeedPage(await api<unknown>(`/v1/me/feed${query}`, { token }));
  } catch {
    // Offline, a timeout, a server that predates the route. Keep what we have.
    return null;
  }
}

/**
 * Bring the cache up to date. `force` is pull-to-refresh; anything else inside
 * the throttle window sends nothing.
 *
 * A DELTA THAT COMES BACK FULL REPLACES THE CACHE rather than merging into it:
 * a full page means there may be more new cards than it carried, and merging
 * would leave a silent hole between the newest page and the old cache. Starting
 * again from the newest page, with "load more" under it, has no hole.
 */
export async function refreshFeed(force = false): Promise<void> {
  if (!isJoined()) return;
  const now = Date.now();
  const last = Number(getMeta(AT_KEY) ?? '');
  if (!force && !prefetchDue(Number.isFinite(last) ? last : null, now, FEED_THROTTLE_MS)) return;
  // Stamped BEFORE the request, so two focuses in one second cannot both send.
  setMeta(AT_KEY, String(now));

  const cache = readCache();
  // A PULL STARTS AGAIN FROM THE TOP instead of asking for a delta. A delta can
  // only ADD cards, so a friend who turned "Show my reactions" off, a deleted
  // comment or a hidden one stayed in the cache until it aged out — found on
  // the simulator 14 Oct. The pull is a deliberate act and costs one cold page;
  // the throttled focus refresh stays a delta.
  const since = force ? null : feedSince(cache.items);
  const page = await fetchPage(since ? `?since=${encodeURIComponent(since)}` : '');
  if (!page) return;
  const gap = since != null && page.next_cursor != null;
  writeCache({
    fetchedAt: now,
    items: since == null || gap ? mergeFeed([], page.items) : mergeFeed(cache.items, page.items),
    followsAnyone: page.follows_anyone,
    more: since == null || gap ? page.next_cursor != null : cache.more,
  });
  emit();
}

/** The page under the oldest card held. Returned to the caller, which keeps it in state. */
export async function loadOlderFeed(oldest: string): Promise<{ items: FeedItem[]; more: boolean }> {
  const page = await fetchPage(`?before=${encodeURIComponent(oldest)}`);
  return page ? { items: page.items, more: page.next_cursor != null } : { items: [], more: true };
}

/** After a block or an unfollow: their cards go now, not when they age out of the cache. */
export function forgetFeedActor(actorId: string): void {
  const cache = readCache();
  writeCache({ ...cache, items: withoutActor(cache.items, actorId) });
  emit();
}

// ── what a card needs from this phone ───────────────────────────────────────

export type FeedCardModel = {
  item: FeedItem;
  locked: boolean;
  /** "The Bear S2E5", or "" while the name is on its way (never a bare id). */
  label: string;
  poster: string | null;
  /** The film's name in the library, for `movieRoute`. */
  filmName: string | null;
};

/**
 * Locks, names and posters, computed in a CALLBACK and held in state — never
 * a render-time SQLite read, which the React Compiler would memoise against
 * its arguments so that a card never unlocked (CLAUDE.md).
 *
 * `ponytail: one indexed COUNT per card plus targetLabel's library read, ≤100
 * cards per focus; batch the lookups if a large library makes the focus slow.`
 */
function decorate(items: readonly FeedItem[]): FeedCardModel[] {
  const films = items.some((i) => i.target_source === 'title') ? getMovies() : [];
  return items.map((item) => {
    let poster: string | null = null;
    let filmName: string | null = null;
    if (item.target_source === 'tvdb') {
      poster = showMeta(Number(item.target_key))?.poster ?? null;
    } else if (item.target_source === 'title') {
      const bare = item.target_key.split('|')[0] ?? '';
      const film = films.find((m) => slug(m.name) === bare);
      poster = film?.poster ?? null;
      filmName = film?.name ?? null;
    }
    return { item, locked: feedLocked(item, hasWatchedTarget), label: targetLabel(item), poster, filmName };
  });
}

export type FeedState = {
  cards: FeedCardModel[];
  /** False until the first read of the cache — the spinner. */
  ready: boolean;
  followsAnyone: boolean;
  more: boolean;
  refreshing: boolean;
  refresh: () => void;
  loadMore: () => void;
  /** After a block or an unfollow: every card by them goes, cached or scrolled-in. */
  forget: (actorId: string) => void;
};

/**
 * The feed for a screen. Re-reads (and so re-locks) on every focus, after
 * every refresh, and after a sync batch lands from another device — the three
 * moments the answer to "have I watched this" can have changed.
 */
export function useFeed(): FeedState {
  const joined = useJoined();
  const [cards, setCards] = useState<FeedCardModel[]>([]);
  const [ready, setReady] = useState(false);
  const [followsAnyone, setFollowsAnyone] = useState(true);
  const [more, setMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Older pages loaded by scrolling. In memory only: the cache is the newest
  // hundred and these are, by construction, older than that.
  const older = useRef<FeedItem[]>([]);
  const olderMore = useRef<boolean | null>(null);
  const loading = useRef(false);

  const reread = useCallback(() => {
    const cache = readCache();
    const items = mergeFeed(cache.items, older.current, Number.POSITIVE_INFINITY);
    setCards(decorate(items));
    setFollowsAnyone(cache.followsAnyone);
    setMore(olderMore.current ?? cache.more);
    setReady(true);
    // Names for shows this phone has never heard of; the cards re-render when
    // they land. Silent on failure — "S2E5" stands.
    void resolveUnknownTargets(items).then((filled) => {
      if (filled) setCards(decorate(items));
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!joined) return;
      reread();
      void refreshFeed().then(reread);
    }, [joined, reread]),
  );
  useEffect(() => onFeed(reread), [reread]);
  useEffect(() => onRemoteChange(reread), [reread]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    older.current = [];
    olderMore.current = null;
    void refreshFeed(true).finally(() => {
      setRefreshing(false);
      reread();
    });
  }, [reread]);

  const loadMore = useCallback(() => {
    if (loading.current) return;
    const cache = readCache();
    const all = mergeFeed(cache.items, older.current, Number.POSITIVE_INFINITY);
    const oldest = all[all.length - 1]?.created_at;
    if (oldest == null || (olderMore.current ?? cache.more) === false) return;
    loading.current = true;
    void loadOlderFeed(oldest)
      .then((page) => {
        older.current = mergeFeed(older.current, page.items, Number.POSITIVE_INFINITY);
        olderMore.current = page.more && page.items.length > 0;
        reread();
      })
      .finally(() => {
        loading.current = false;
      });
  }, [reread]);

  const forget = useCallback((actorId: string) => {
    older.current = withoutActor(older.current, actorId);
    forgetFeedActor(actorId);
  }, []);

  return { cards, ready, followsAnyone, more, refreshing, refresh, loadMore, forget };
}
