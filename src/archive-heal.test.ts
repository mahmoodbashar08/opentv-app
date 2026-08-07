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
  // Called on an owner change so app-posted comments become seedable again.
  clearPublishedCommentOrigin: () => 0,
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
    movieCharacterVotes: 0,
  }),
  countSeedableCommentRows: () => 0,
  getSeedableComments: () => [],
  // No comment carried a photograph in this fixture, which is the ordinary
  // case: the image phase walks nothing and reports finished.
  getSeedableCommentImages: () => [],
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

let profileId = 'p_owner';
jest.mock('@/community-session', () => ({
  isJoined: () => true,
  getToken: async () => 'token',
  // The archive stamps record WHOSE profile they describe, so the sync reads
  // the current profile id — see SYNC_OWNER_KEY in community-seed.ts.
  getProfileId: () => profileId,
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
const OWNER_KEY = 'communitySeedOwner';

/** A device that HAS synced: all three stamps, not two. The owner stamp is
 *  part of what "already synced" means now — a revision and a fingerprint
 *  alone no longer say which profile they were uploaded to. */
function stamped(revision: string, fingerprint: string): void {
  meta.set(REVISION_KEY, revision);
  meta.set(FINGERPRINT_KEY, fingerprint);
  meta.set(OWNER_KEY, profileId);
}

beforeEach(() => {
  meta.clear();
  calls = [];
  failing = new Set();
  profileId = 'p_owner';
});

describe('an unchanged launch', () => {
  it('costs ZERO requests', async () => {
    // The state a healthy phone is in every single morning: stamped under the
    // current revision, against the archive it still holds.
    stamped(String(SEED_REVISION), '0.2.1.0.0.0.0');

    await syncArchiveIfNeeded();

    expect(calls).toEqual([]);
  });

  it('is still zero on the tenth open of the day', async () => {
    stamped(String(SEED_REVISION), '0.2.1.0.0.0.0');
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
    expect(meta.get(FINGERPRINT_KEY)).toBe('0.2.1.0.0.0.0');
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
    stamped('1', '0.2.1.0.0.0.0');
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
    stamped(String(SEED_REVISION), '0.1.1.0.0.0');
    const cursor = JSON.stringify({ cursor: 'e:x', imported: 9, skipped: 0, unmappable: 0 });
    meta.set('communitySeedRatingsProgress', cursor);

    await syncArchiveIfNeeded();

    // Advanced by the run, never reset to the empty string.
    expect(meta.get('communitySeedRatingsProgress')).not.toBe('');
    expect(JSON.parse(meta.get('communitySeedRatingsProgress')!).imported).toBeGreaterThanOrEqual(9);
  });
});

describe('a profile that is not the one the stamps describe', () => {
  /**
   * The bug this exists to stop: the stamps recorded a SHAPE and never a
   * DESTINATION. Delete somebody's account server-side — which is what
   * moderation does, and which nothing on the phone is ever told about — and
   * they rejoin as a brand-new profile with a byte-identical archive. Revision
   * matched, fingerprint matched, answer `nothing`, and the new profile
   * received no comments, no ratings and no votes. Ever, because only watching
   * something changes the shape.
   */
  it('re-uploads everything when the owner changed', async () => {
    stamped(String(SEED_REVISION), '0.2.1.0.0.0.0');
    expect(calls).toEqual([]);

    profileId = 'p_somebody_else';
    await syncArchiveIfNeeded();

    expect(calls).toContain('/v1/ratings/import');
    expect(meta.get(OWNER_KEY)).toBe('p_somebody_else');
  });

  it('is silent again once the new owner is stamped', async () => {
    stamped(String(SEED_REVISION), '0.2.1.0.0.0.0');
    profileId = 'p_somebody_else';
    await syncArchiveIfNeeded();
    calls = [];

    // The re-walk must happen ONCE, not on every launch: `syncArchiveIfNeeded`
    // is called on every app open and the free tier is sized for zero requests
    // on an unchanged one.
    await syncArchiveIfNeeded();
    expect(calls).toEqual([]);
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
    stamped('1', 'old');
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
