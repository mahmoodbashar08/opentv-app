/**
 * The friends feed's decisions, with no React Native, no SQLite and no network
 * in them, so jest can hold every one (`feed.test.ts`). The I/O half is
 * `community-feed.ts`; the cards are `components/feed-*.tsx`.
 *
 * A file of its own rather than more of `pure.ts`: eight thousand lines that
 * every 2.0.0 branch appends to is a merge conflict waiting for each of them.
 */
import type { LocaleKey } from '@/locales/keys';

export type FeedActor = {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_key: string | null;
  is_plus: boolean;
};

type FeedBase = {
  id: string;
  actor: FeedActor;
  target_source: 'tvdb' | 'tmdb' | 'title';
  target_key: string;
  season: number | null;
  episode: number | null;
  created_at: string;
};

/** One card, field for field as `backend/src/routes/feed.ts` sends it. */
export type FeedItem = FeedBase &
  (
    | { kind: 'rating'; score: number | null; emotions: string[] }
    | {
        kind: 'comment';
        comment_id: string;
        body: string;
        is_spoiler: number;
        is_reply: boolean;
        has_image: boolean;
      }
    | { kind: 'character'; character: string }
  );

export type FeedPage = { items: FeedItem[]; next_cursor: string | null; follows_anyone: boolean };

/** The phone keeps the newest hundred cards; a refresh asks only for what is newer. */
export const FEED_CACHE_MAX = 100;
/** A focus inside this of the last request reads the cache and sends nothing. */
export const FEED_THROTTLE_MS = 60_000;

const KINDS = new Set(['rating', 'comment', 'character']);
const SOURCES = new Set(['tvdb', 'tmdb', 'title']);

/**
 * Anything the server sent, as a page this build can draw.
 *
 * A KIND THIS BUILD DOES NOT KNOW IS DROPPED, not drawn blank: a later server
 * may add one, and an old phone must not show a card with a verb it has no
 * words for. A malformed body is an empty page, never a throw — the feed is
 * a read, and a read that fails shows what it already had.
 */
export function asFeedPage(res: unknown): FeedPage {
  if (!res || typeof res !== 'object') return { items: [], next_cursor: null, follows_anyone: true };
  const r = res as { items?: unknown; next_cursor?: unknown; follows_anyone?: unknown };
  const items = (Array.isArray(r.items) ? r.items : []).filter((i): i is FeedItem => {
    if (!i || typeof i !== 'object') return false;
    const x = i as Partial<FeedItem>;
    return (
      typeof x.id === 'string' &&
      typeof x.created_at === 'string' &&
      typeof x.target_key === 'string' &&
      SOURCES.has(x.target_source as string) &&
      KINDS.has(x.kind as string) &&
      !!x.actor &&
      typeof x.actor.handle === 'string'
    );
  });
  return {
    items,
    next_cursor: typeof r.next_cursor === 'string' && r.next_cursor.length > 0 ? r.next_cursor : null,
    // Absent means an older server that did not say; assume they follow
    // somebody, so the screen shows "nothing yet" rather than "find people".
    follows_anyone: r.follows_anyone !== false,
  };
}

/** Newest first; `id` breaks a tie so two merges always agree on the order. */
function newestFirst(a: FeedItem, b: FeedItem): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * A delta (or an older page) folded into the cache.
 *
 * BY ID, AND THE INCOMING COPY WINS: a card fetched again is the server's
 * newer word on it (a comment's body after an edit). Capped at
 * `FEED_CACHE_MAX` from the newest end, so the oldest fall off — they are
 * a "load more" away, and the cache is what makes every refresh a delta.
 */
export function mergeFeed(
  cached: readonly FeedItem[],
  incoming: readonly FeedItem[],
  cap: number = FEED_CACHE_MAX,
): FeedItem[] {
  const byId = new Map<string, FeedItem>();
  for (const it of cached) byId.set(it.id, it);
  for (const it of incoming) byId.set(it.id, it);
  return [...byId.values()].sort(newestFirst).slice(0, cap);
}

/**
 * Drop the cards a refresh can prove are gone: everything by somebody just
 * blocked or unfollowed. A delta cannot say "this was deleted", so without
 * this a blocked person's cards would sit in the cache until they aged out.
 */
export function withoutActor(items: readonly FeedItem[], actorId: string): FeedItem[] {
  return items.filter((i) => i.actor.id !== actorId);
}

/** `since` for a refresh: the newest card held. Null for an empty cache (a cold fetch). */
export function feedSince(items: readonly FeedItem[]): string | null {
  return items[0]?.created_at ?? null;
}

/**
 * THE SPOILER LOCK. A card is locked unless the reader has watched exactly
 * what it is about: an episode needs that episode, a season-level event any
 * episode of the season, a show-level one any episode, a film the film. A
 * reply carries its parent's target (the server inherits it), same rule.
 *
 * `watched` is `hasWatchedTarget` from db.ts, passed in so this stays pure; it
 * already answers all four shapes, and answers "not watched" when it cannot
 * read the library — an unreadable library is not a licence to spoil.
 */
export function feedLocked(
  item: Pick<FeedItem, 'target_source' | 'target_key' | 'season' | 'episode'>,
  watched: (source: string, key: string, season: number | null, episode: number | null) => boolean,
): boolean {
  return !watched(item.target_source, item.target_key, item.season, item.episode);
}

/**
 * The verb line. The verb is harmless and stays on a locked card; the content
 * is not and does not. A rating with no score is a feeling only, and says so.
 */
export function feedVerbKey(item: FeedItem): LocaleKey {
  switch (item.kind) {
    case 'rating':
      return item.score == null ? 'feed.felt' : 'feed.rated';
    case 'comment':
      return item.is_reply ? 'feed.replied' : 'feed.commented';
    case 'character':
      return 'feed.picked';
  }
}

/**
 * The server's 1–10 as the app's five stars, or null for a feeling-only vote.
 * `ponytail: whole stars; half-stars when the 2.0.0 half-star rating lands.`
 */
export function feedStars(score: number | null): number | null {
  if (score == null || !Number.isFinite(score)) return null;
  return Math.min(5, Math.max(1, Math.round(score / 2)));
}

/**
 * Where a tap goes.
 *
 * LOCKED → THE SHOW, NEVER THE EPISODE (D3): the episode page's still and its
 * title are the spoiler. Unlocked: a comment opens its permalink, an episode
 * its page, a show its page. Films go through `movieRoute` in the component,
 * which needs the library to find the name; this answers `null` for them, and
 * for TMDB targets, which this phone has no page for.
 */
export function feedRoute(item: FeedItem, locked: boolean): string | null {
  if (!locked && item.kind === 'comment') return `/comment/${encodeURIComponent(item.comment_id)}`;
  if (item.target_source !== 'tvdb') return null;
  const show = `/show/${item.target_key}`;
  if (locked || item.season == null || item.episode == null) return show;
  return `/episode/${item.target_key}-s${item.season}e${item.episode}`;
}
