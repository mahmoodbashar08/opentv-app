/**
 * `syncArchiveIfNeeded` end to end, over a fake database and a fake network.
 *
 * The pure decision is pinned in `archive-sync.test.ts`. This file pins the two
 * things that decision cannot express on its own, and that a reader has to
 * trust for the feature to be worth shipping:
 *
 *  1. AN UNCHANGED LAUNCH MAKES NO REQUEST AT ALL. Not a cheap request, not a
 *     cached one — none. `backend/docs/PLAN.md` §4 sizes the whole free tier at
 *     a handful of requests per user per day, and this runs on every open.
 *  2. A PARTIAL RUN STAMPS NOTHING. The stamp is the app's only record that the
 *     archive is up to date; writing it after a run that stopped halfway would
 *     make the missing half permanently invisible, which is precisely the bug
 *     the DONE flag caused and this replaced.
 *
 * `@/db`, `@/community-session` and `@/api` are mocked because the real ones
 * reach for expo-sqlite, expo-secure-store and a socket. Everything else —
 * every cursor, every decision, every meta write — is the real module.
 */
const meta = new Map<string, string>();

/** Every endpoint the run called, in order. Length 0 is the point of test 1. */
let calls: string[] = [];
/** Endpoints that should throw, to simulate a phone losing its connection. */
let failing = new Set<string>();

jest.mock('@/db', () => ({
  getMeta: (k: string) => meta.get(k) ?? null,
  setMeta: (k: string, v: string) => {
    meta.set(k, v);
  },
  archiveCounts: () => ({
    comments: 0,
    episodeRatings: 2,
    episodeEmotions: 1,
    movieRatings: 0,
    movieEmotions: 0,
    characterVotes: 0,
  }),
  countSeedableCommentRows: () => 0,
  getSeedableComments: () => [],
  getSeedableEpisodeRatings: () => [
    { showId: 1, season: 1, episode: 1, stars: 5 },
    { showId: 1, season: 1, episode: 2, stars: 4 },
  ],
  getSeedableEpisodeEmotions: () => [{ showId: 1, season: 1, episode: 1, emotion: 3 }],
  getSeedableMovieVotes: () => [],
  getSeedableMovieEmotions: () => [],
  getSeedableCharacterVotes: () => [],
  getShowNames: () => [{ tvdbId: 1, name: 'Attack on Titan' }],
  getMovies: () => [],
  libraryOwner: () => 'imported',
}));

jest.mock('@/community-session', () => ({
  isJoined: () => true,
  getToken: async () => 'token',
}));

jest.mock('@/api', () => {
  class ApiError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    ApiError,
    api: async (path: string) => {
      calls.push(path);
      if (failing.has(path)) throw new ApiError('offline');
      return { imported: 1, skipped: 0 };
    },
  };
});

// Below the mocks on purpose: the module under test reads `@/db` at import
// time, so the fakes have to be registered before it is pulled in.
// eslint-disable-next-line import/first
import { SEED_REVISION, syncArchiveIfNeeded } from './community-seed';

const REVISION_KEY = 'communitySeedRevision';
const FINGERPRINT_KEY = 'communitySeedFingerprint';

beforeEach(() => {
  meta.clear();
  calls = [];
  failing = new Set();
});

describe('an unchanged launch', () => {
  it('costs ZERO requests', async () => {
    // The state a healthy phone is in every single morning: stamped under the
    // current revision, against the archive it still holds.
    meta.set(REVISION_KEY, String(SEED_REVISION));
    meta.set(FINGERPRINT_KEY, '0.2.1.0.0.0');

    await syncArchiveIfNeeded();

    expect(calls).toEqual([]);
  });

  it('is still zero on the tenth open of the day', async () => {
    meta.set(REVISION_KEY, String(SEED_REVISION));
    meta.set(FINGERPRINT_KEY, '0.2.1.0.0.0');
    for (let i = 0; i < 10; i++) await syncArchiveIfNeeded();
    expect(calls).toEqual([]);
  });
});

describe('a launch that owes something', () => {
  it('uploads and then stamps the revision and the fingerprint', async () => {
    // Nothing stored: the first launch after this feature ships, and the state
    // every pre-revision-2 install is in.
    await syncArchiveIfNeeded();

    expect(calls.length).toBeGreaterThan(0);
    expect(calls).toContain('/v1/ratings/import');
    expect(meta.get(REVISION_KEY)).toBe(String(SEED_REVISION));
    expect(meta.get(FINGERPRINT_KEY)).toBe('0.2.1.0.0.0');
  });

  it('is silent again on the very next launch', async () => {
    await syncArchiveIfNeeded();
    const first = calls.length;
    calls = [];
    await syncArchiveIfNeeded();
    expect(first).toBeGreaterThan(0);
    expect(calls).toEqual([]);
  });

  it('clears the cursors when the stored revision is older', async () => {
    // The owner's state. Seeded to completion under revision 1 — every phase
    // done, every cursor at the end — so nothing would ever be sent again
    // without this. The stale rows carry one feeling each.
    meta.set(REVISION_KEY, '1');
    meta.set(FINGERPRINT_KEY, '0.2.1.0.0.0');
    meta.set('communitySeedRatingsDone', '1');
    meta.set('communitySeedRatingsProgress', JSON.stringify({ cursor: 'zzz', imported: 228, skipped: 0, unmappable: 0 }));

    await syncArchiveIfNeeded();

    // The cursor was cleared, so the walk started from the top and the ratings
    // went up again — this time with `emotions[]` on every vote.
    expect(calls).toContain('/v1/ratings/import');
    expect(meta.get(REVISION_KEY)).toBe(String(SEED_REVISION));
  });

  it('does NOT clear the cursors when only the fingerprint moved', async () => {
    // Same contract, three new ratings. The bookmarks stay, so the run sends
    // what is past them instead of re-walking seven years.
    meta.set(REVISION_KEY, String(SEED_REVISION));
    meta.set(FINGERPRINT_KEY, '0.1.1.0.0.0');
    const cursor = JSON.stringify({ cursor: 'e:x', imported: 9, skipped: 0, unmappable: 0 });
    meta.set('communitySeedRatingsProgress', cursor);

    await syncArchiveIfNeeded();

    // Advanced by the run, never reset to the empty string.
    expect(meta.get('communitySeedRatingsProgress')).not.toBe('');
    expect(JSON.parse(meta.get('communitySeedRatingsProgress')!).imported).toBeGreaterThanOrEqual(9);
  });
});

describe('a run that stops halfway', () => {
  it('stamps NEITHER the revision nor the fingerprint', async () => {
    failing.add('/v1/ratings/import');

    await syncArchiveIfNeeded();

    expect(meta.get(REVISION_KEY)).toBeUndefined();
    expect(meta.get(FINGERPRINT_KEY)).toBeUndefined();
  });

  it('leaves an older stamp exactly as it was, rather than half-advancing it', async () => {
    meta.set(REVISION_KEY, '1');
    meta.set(FINGERPRINT_KEY, 'old');
    failing.add('/v1/ratings/import');

    await syncArchiveIfNeeded();

    expect(meta.get(REVISION_KEY)).toBe('1');
    expect(meta.get(FINGERPRINT_KEY)).toBe('old');
  });

  it('so the NEXT launch tries again', async () => {
    failing.add('/v1/ratings/import');
    await syncArchiveIfNeeded();
    calls = [];

    failing = new Set();
    await syncArchiveIfNeeded();

    expect(calls).toContain('/v1/ratings/import');
    expect(meta.get(REVISION_KEY)).toBe(String(SEED_REVISION));
  });

  it('never throws — a launch is not allowed to fail over this', async () => {
    failing.add('/v1/ratings/import');
    failing.add('/v1/comments/import');
    failing.add('/v1/character-votes/import');
    await expect(syncArchiveIfNeeded()).resolves.toBeUndefined();
  });
});
