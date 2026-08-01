/**
 * A vote you just cast has to change the number you are looking at.
 *
 * This is guarded here because the failure is silent and the fix is invisible:
 * the percentage cache is SQLite, React cannot observe it, and every screen
 * reads it during render. Get any link in the chain wrong — the fold, the cache
 * key, the notify — and the app is not broken in any way a screenshot shows.
 * It just keeps yesterday's number until the screen is closed and reopened,
 * which reads to the user as "it doesn't count my choice".
 *
 * Three bugs lived in that chain, and each has a test below:
 *
 *  1. The reply was folded into the SEASON cache only, so rating a FILM — which
 *     has no season — updated nothing at all.
 *  2. The season fold was guarded on there already being a cache entry, so the
 *     FIRST vote on a season the phone had not fetched folded nothing.
 *  3. A null rollup (un-star your only rating, the row is deleted) returned
 *     early, leaving the percentage of a vote that no longer exists on screen.
 */
import { fetchTargetAggregate, postRating } from './community-ratings';

// The four modules `postRating` touches. Mocked rather than stubbed at the
// boundary so the test exercises the real folding logic and only the edges are
// fake.
const meta = new Map<string, string>();

jest.mock('./db', () => ({
  getMeta: (k: string) => meta.get(k) ?? null,
  setMeta: (k: string, v: string) => {
    meta.set(k, v);
  },
}));

jest.mock('./community-session', () => ({
  isJoined: () => true,
  getToken: () => Promise.resolve('token'),
  useJoined: () => true,
}));

let reply: unknown = null;
let sent: Record<string, unknown> | null = null;
let paths: string[] = [];
jest.mock('./api', () => ({
  api: (path: string, init?: { body?: Record<string, unknown> }) => {
    paths.push(path);
    sent = init?.body ?? null;
    return Promise.resolve(reply);
  },
}));

/** One rollup, as `shapeAggregate` sends it. */
const aggregate = (over: Record<string, unknown> = {}) => ({
  season: -1,
  episode: -1,
  vote_count: 3,
  score_sum: 24,
  emotion_counts: { shocked: 2 },
  score_counts: { '8': 3 },
  ...over,
});

/** `postRating` is fire-and-forget, so its work lands a microtask later. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  meta.clear();
  reply = null;
  sent = null;
  paths = [];
});

describe('postRating folds the reply into the cache the screen reads', () => {
  it('writes a FILM’s rollup — the bug that made rating a film do nothing', async () => {
    reply = { aggregate: aggregate() };

    postRating({
      source: 'title',
      key: 'toy-story-5|2026',
      season: null,
      episode: null,
      score: 8,
      emotions: ['shocked'],
    });
    await settle();

    // `agg:<source>:<key>` — the same key `useTargetAggregate` reads on the
    // film screen. A different key here is the same bug wearing a disguise.
    const raw = meta.get('agg:title:toy-story-5|2026');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).items[0].vote_count).toBe(3);
  });

  it('writes an EPISODE’s rollup with nothing cached yet', async () => {
    reply = { aggregate: aggregate({ season: 4, episode: 7 }) };

    postRating({ source: 'tvdb', key: '121361', season: 4, episode: 7, score: 10, emotions: undefined });
    await settle();

    const entry = JSON.parse(meta.get('agg:tvdb:121361:4') as string);
    expect(entry.items).toHaveLength(1);
    expect(entry.items[0].episode).toBe(7);
    // Stamped stale on purpose: this row is the truth we have, and the next
    // mount must still refetch the rest of the season.
    expect(entry.fetchedAt).toBe(0);
  });

  it('REPLACES that episode’s row and leaves the rest of the season alone', async () => {
    meta.set(
      'agg:tvdb:121361:4',
      JSON.stringify({
        fetchedAt: 1000,
        items: [aggregate({ season: 4, episode: 7, vote_count: 1 }), aggregate({ season: 4, episode: 8 })],
      }),
    );
    reply = { aggregate: aggregate({ season: 4, episode: 7, vote_count: 99 }) };

    postRating({ source: 'tvdb', key: '121361', season: 4, episode: 7, score: 10, emotions: undefined });
    await settle();

    const entry = JSON.parse(meta.get('agg:tvdb:121361:4') as string);
    expect(entry.items).toHaveLength(2);
    expect(entry.items.find((i: { episode: number }) => i.episode === 7).vote_count).toBe(99);
    expect(entry.items.find((i: { episode: number }) => i.episode === 8)).toBeTruthy();
    // A fold is not a fetch: the season is no fresher than it was.
    expect(entry.fetchedAt).toBe(1000);
  });

  it('DROPS the episode’s row when the server answers null — an un-rated vote', async () => {
    meta.set(
      'agg:tvdb:121361:4',
      JSON.stringify({ fetchedAt: 1000, items: [aggregate({ season: 4, episode: 7 })] }),
    );
    reply = { aggregate: null };

    postRating({ source: 'tvdb', key: '121361', season: 4, episode: 7, score: null, emotions: [] });
    await settle();

    const entry = JSON.parse(meta.get('agg:tvdb:121361:4') as string);
    expect(entry.items).toHaveLength(0);
  });

  it('clears a FILM’s entry when the server answers null', async () => {
    meta.set('agg:title:toy-story-5|2026', JSON.stringify({ fetchedAt: 1000, items: [aggregate()] }));
    reply = { aggregate: null };

    postRating({ source: 'title', key: 'toy-story-5|2026', season: null, episode: null, score: null, emotions: [] });
    await settle();

    // Empty string, not a stale rollup: `readTargetCache` reads it as a miss.
    expect(meta.get('agg:title:toy-story-5|2026')).toBe('');
  });

  it('sends the WHOLE emotion set, never a single legacy `emotion`', async () => {
    reply = { aggregate: aggregate() };

    postRating({
      source: 'title',
      key: 'x|2020',
      season: null,
      episode: null,
      score: null,
      emotions: ['shocked', 'thrilled'],
    });
    await settle();

    expect(sent).toMatchObject({ emotions: ['shocked', 'thrilled'] });
    expect(sent).not.toHaveProperty('emotion');
  });

  it('says nothing at all when the vote mentions neither a score nor feelings', async () => {
    postRating({ source: 'title', key: 'x|2020', season: null, episode: null, score: null, emotions: undefined });
    await settle();

    expect(sent).toBeNull();
    expect(meta.size).toBe(0);
  });
});

/**
 * The edge cache is right for readers and wrong for the person who just voted.
 *
 * `GET /v1/aggregates` is `max-age=300, stale-while-revalidate=3600`, so the
 * fetch after a vote can be answered with the copy cached BEFORE it — which
 * overwrites the correct rollup the POST folded in and puts the old number
 * back. Close the film, open it again, and the rating has reverted.
 */
describe('a fetch soon after your own vote skips every cache in between', () => {
  it('adds a buster once this device has voted on that target', async () => {
    reply = { aggregate: aggregate() };
    postRating({
      source: 'title',
      key: 'toy-story-5|2026',
      season: null,
      episode: null,
      score: 8,
      emotions: undefined,
    });
    await settle();

    paths = [];
    reply = { items: [] };
    await fetchTargetAggregate('title', 'toy-story-5|2026', true);
    expect(paths[0]).toContain('_v=');
  });

  it('leaves a target nobody here voted on shareable', async () => {
    reply = { items: [] };
    await fetchTargetAggregate('title', 'never-voted|2001', true);
    expect(paths[0]).not.toContain('_v=');
  });
});
