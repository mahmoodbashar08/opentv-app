/**
 * The friends feed's pure half (feed-pure.ts): the lock, the delta merge, the
 * verb, the route — and the relative time the cards print.
 */
import {
  FEED_CACHE_MAX,
  asFeedPage,
  feedLocked,
  feedRoute,
  feedSince,
  feedStars,
  feedVerbKey,
  mergeFeed,
  withoutActor,
  type FeedItem,
} from '@/feed-pure';
import { relativeTime } from '@/pure';

const actor = (id = 'p1') => ({ id, handle: id, display_name: null, avatar_key: null, is_plus: false });

function rating(id: string, at: string, over: Partial<FeedItem> = {}): FeedItem {
  return {
    id,
    kind: 'rating',
    actor: actor(),
    target_source: 'tvdb',
    target_key: '402551',
    season: 2,
    episode: 5,
    created_at: at,
    score: 8,
    emotions: ['shocked'],
    ...over,
  } as FeedItem;
}

const comment = (over: Partial<FeedItem> = {}): FeedItem =>
  ({
    ...rating('comment:c1', '2026-10-10T00:00:00.000Z'),
    kind: 'comment',
    comment_id: 'c1',
    body: 'what an ending',
    is_spoiler: 0,
    is_reply: false,
    has_image: false,
    ...over,
  }) as FeedItem;

describe('feedLocked — the spoiler lock asks exactly the event’s target', () => {
  const asked: unknown[][] = [];
  const watched = (yes: boolean) => (...args: unknown[]) => {
    asked.push(args);
    return yes;
  };

  beforeEach(() => {
    asked.length = 0;
  });

  it('locks what is not watched and unlocks what is', () => {
    expect(feedLocked(rating('a', 'x'), watched(false))).toBe(true);
    expect(feedLocked(rating('a', 'x'), watched(true))).toBe(false);
  });

  it('passes the episode, the season, the show and the film through unchanged', () => {
    feedLocked(rating('a', 'x'), watched(true));
    feedLocked(rating('a', 'x', { episode: null }), watched(true));
    feedLocked(rating('a', 'x', { season: null, episode: null }), watched(true));
    feedLocked(rating('a', 'x', { target_source: 'title', target_key: 'heat|1995', season: null, episode: null }), watched(true));
    expect(asked).toEqual([
      ['tvdb', '402551', 2, 5],
      ['tvdb', '402551', 2, null],
      ['tvdb', '402551', null, null],
      ['title', 'heat|1995', null, null],
    ]);
  });

  it('a reply is locked by its (inherited) target like anything else', () => {
    expect(feedLocked(comment({ is_reply: true } as Partial<FeedItem>), watched(false))).toBe(true);
  });
});

describe('mergeFeed — a delta folded into the cache', () => {
  const a = rating('a', '2026-10-10T10:00:00.000Z');
  const b = rating('b', '2026-10-10T11:00:00.000Z');
  const c = rating('c', '2026-10-10T12:00:00.000Z');

  it('puts the newest first and does not duplicate a card fetched twice', () => {
    const merged = mergeFeed([b, a], [c, b]);
    expect(merged.map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });

  it('lets the incoming copy win (the server’s newer word on a card)', () => {
    const edited = { ...b, score: 2 } as FeedItem;
    const merged = mergeFeed([b, a], [edited]);
    expect(merged.find((i) => i.id === 'b')).toBe(edited);
  });

  it(`caps at ${FEED_CACHE_MAX}, dropping the oldest`, () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      rating(`r${i}`, new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString()),
    );
    const merged = mergeFeed([], many);
    expect(merged).toHaveLength(FEED_CACHE_MAX);
    expect(merged[0]!.id).toBe('r149');
    expect(merged[merged.length - 1]!.id).toBe('r50');
  });

  it('orders a same-millisecond tie by id, so two merges agree', () => {
    const x = rating('x', '2026-10-10T10:00:00.000Z');
    const y = rating('y', '2026-10-10T10:00:00.000Z');
    expect(mergeFeed([y], [x]).map((i) => i.id)).toEqual(mergeFeed([x], [y]).map((i) => i.id));
  });

  it('since is the newest card held, null when there is none', () => {
    expect(feedSince(mergeFeed([a], [c]))).toBe(c.created_at);
    expect(feedSince([])).toBeNull();
  });

  it('withoutActor drops every card by a blocked or unfollowed person', () => {
    const other = rating('z', '2026-10-10T09:00:00.000Z', { actor: actor('p2') });
    expect(withoutActor([a, other, b], 'p1').map((i) => i.id)).toEqual(['z']);
  });
});

describe('asFeedPage — what the server sent, as something this build can draw', () => {
  it('drops a kind this build has no words for, and anything malformed', () => {
    const page = asFeedPage({
      items: [rating('a', 'x'), { ...rating('b', 'x'), kind: 'shelf' }, { id: 'c' }, null],
      next_cursor: '2026-10-10T00:00:00.000Z',
      follows_anyone: true,
    });
    expect(page.items.map((i) => i.id)).toEqual(['a']);
    expect(page.next_cursor).toBe('2026-10-10T00:00:00.000Z');
  });

  it('reads garbage as an empty page, and only an explicit false as "follows nobody"', () => {
    expect(asFeedPage('nope')).toEqual({ items: [], next_cursor: null, follows_anyone: true });
    expect(asFeedPage({ items: [] }).follows_anyone).toBe(true);
    expect(asFeedPage({ items: [], follows_anyone: false }).follows_anyone).toBe(false);
  });
});

describe('the card’s words and destination', () => {
  it('a rating with no score is a feeling, and says so', () => {
    expect(feedVerbKey(rating('a', 'x'))).toBe('feed.rated');
    expect(feedVerbKey(rating('a', 'x', { score: null } as Partial<FeedItem>))).toBe('feed.felt');
    expect(feedVerbKey(comment())).toBe('feed.commented');
    expect(feedVerbKey(comment({ is_reply: true } as Partial<FeedItem>))).toBe('feed.replied');
  });

  it('turns the server’s 1–10 into five stars, halves kept (2.0.0)', () => {
    expect(feedStars(10)).toBe(5);
    expect(feedStars(8)).toBe(4);
    expect(feedStars(7)).toBe(3.5);
    expect(feedStars(1)).toBe(0.5);
    expect(feedStars(0)).toBeNull();
    expect(feedStars(null)).toBeNull();
  });

  it('a LOCKED card opens the show, never the episode (D3) — not even a comment', () => {
    expect(feedRoute(rating('a', 'x'), true)).toBe('/show/402551');
    expect(feedRoute(comment(), true)).toBe('/show/402551');
  });

  it('an unlocked card opens the episode, the show, or the comment', () => {
    expect(feedRoute(rating('a', 'x'), false)).toBe('/episode/402551-s2e5');
    expect(feedRoute(rating('a', 'x', { episode: null }), false)).toBe('/show/402551');
    expect(feedRoute(comment(), false)).toBe('/comment/c1');
  });

  it('a film is routed by name in the component, so this answers null', () => {
    expect(feedRoute(rating('a', 'x', { target_source: 'title', target_key: 'heat|1995' }), false)).toBeNull();
  });
});

describe('relativeTime, as the cards print it', () => {
  const now = Date.parse('2026-10-13T12:00:00.000Z');
  it('counts back in the units a card shows', () => {
    expect(relativeTime('2026-10-13T11:59:30.000Z', now)).toEqual({ key: 'community.time.now', count: 0 });
    expect(relativeTime('2026-10-13T10:00:00.000Z', now)).toEqual({ key: 'community.time.hours', count: 2 });
    expect(relativeTime('2026-10-07T12:00:01.000Z', now)).toEqual({ key: 'community.time.days', count: 5 });
  });
  it('says nothing for a timestamp it cannot read', () => {
    expect(relativeTime('yesterday', now)).toBeNull();
  });
});
