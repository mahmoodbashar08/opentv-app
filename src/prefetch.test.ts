/**
 * The background sweep that puts the community's numbers on screen before the
 * user opens anything.
 *
 * THE GRAMMAR CASES ARE THE POINT. Every target this builds is handed to
 * `parseTargets` in `backend/src/pure.ts`, which returns null for the WHOLE
 * request if one of a hundred targets is malformed — so a single bad string
 * does not degrade one title's percentage, it silently blanks ninety-nine
 * others. The cases below are that parser's rules, restated from this side.
 */
import {
  PREFETCH_TARGET_CHUNK,
  buildPrefetchTargets,
  chunk,
  metaKeysClearedByArchiveReupload,
  prefetchDue,
  prefetchRemaining,
  targetKey,
  COMMUNITY_META_KEYS,
  LOCAL_ONLY_META_KEYS,
} from './pure';

const shows = new Set([100, 200]);
const none = { episodes: [], movies: [], knownShowIds: shows };

describe('buildPrefetchTargets', () => {
  it('spells an episode the way parseTargets reads it', () => {
    expect(
      buildPrefetchTargets({ ...none, episodes: [{ showId: 100, season: 2, episode: 7 }] }),
    ).toEqual(['tvdb:100:2:7']);
  });

  it('spells a film as title:<slug|year>, with no season or episode', () => {
    // Three colon-separated parts would be an episode; a film's remainder must
    // carry NO colon at all so the server reads it as the -1/-1 row — the same
    // row `postRating` writes with `season: null, episode: null`.
    const out = buildPrefetchTargets({ ...none, movies: [{ name: 'Dune: Part Two', year: '2024' }] });
    expect(out).toEqual([`title:${targetKey('title', { title: 'Dune: Part Two', year: '2024' })}`]);
    expect(out[0]).toBe('title:dune-part-two|2024');
    // The colon in the title must not have survived into the key, or the server
    // would try to read "part-two|2024" as a season/episode pair and reject the
    // entire request.
    expect(out[0].split(':')).toHaveLength(2);
  });

  it('keeps a pipe in a film key — parseTargets never looks at it', () => {
    const out = buildPrefetchTargets({ ...none, movies: [{ name: 'Heat', year: null }] });
    expect(out).toEqual(['title:heat|']);
  });

  it('reads the year out of a "(YYYY)" suffix, exactly as targetKey does', () => {
    // The film screen's own `postRating` files under this key. If the prefetch
    // computed a different one it would warm a cache nothing ever reads.
    expect(buildPrefetchTargets({ ...none, movies: [{ name: 'Drive (2011)', year: null }] })).toEqual([
      'title:drive|2011',
    ]);
  });

  it('season 0 and episode 0 are real targets, not falsy ones', () => {
    // Specials live in season 0. A truthiness check would drop every one of them.
    expect(buildPrefetchTargets({ ...none, episodes: [{ showId: 100, season: 0, episode: 0 }] })).toEqual([
      'tvdb:100:0:0',
    ]);
  });

  it('skips a rating whose show is no longer in the library', () => {
    // A stale TheTVDB id the split-id migration re-keyed. It can only come back
    // empty, and it would still cost one of the hundred slots in the chunk.
    expect(buildPrefetchTargets({ ...none, episodes: [{ showId: 999, season: 1, episode: 1 }] })).toEqual([]);
  });

  it('skips negative and fractional season or episode numbers', () => {
    // `parseTargets` matches /^\d+$/ on both. "-1" and "1.5" are rejects that
    // would take the other ninety-nine targets down with them.
    expect(
      buildPrefetchTargets({
        ...none,
        episodes: [
          { showId: 100, season: -1, episode: 1 },
          { showId: 100, season: 1, episode: -1 },
          { showId: 100, season: 1.5, episode: 1 },
        ],
      }),
    ).toEqual([]);
  });

  it('skips a film whose title slugs to nothing', () => {
    // `targetKey` yields the bare "|2011" — a stable key, but not one any vote
    // was ever filed under, because the screen had no title to show either.
    expect(buildPrefetchTargets({ ...none, movies: [{ name: '???', year: '2011' }] })).toEqual([]);
    expect(buildPrefetchTargets({ ...none, movies: [{ name: '   ', year: '2011' }] })).toEqual([]);
  });

  it('dedupes: an episode with both a star and a feeling is ONE target', () => {
    // The caller concatenates `episode_ratings` and `episode_emotions`, and an
    // episode that was rated AND double-tapped appears three times.
    expect(
      buildPrefetchTargets({
        ...none,
        episodes: [
          { showId: 100, season: 1, episode: 1 },
          { showId: 100, season: 1, episode: 1 },
          { showId: 100, season: 1, episode: 1 },
        ],
      }),
    ).toEqual(['tvdb:100:1:1']);
  });

  it('is sorted, because the resume cursor is a string comparison over it', () => {
    const out = buildPrefetchTargets({
      ...none,
      episodes: [
        { showId: 200, season: 1, episode: 1 },
        { showId: 100, season: 1, episode: 2 },
        { showId: 100, season: 1, episode: 1 },
      ],
      movies: [{ name: 'Heat', year: '1995' }],
    });
    expect(out).toEqual([...out].sort());
  });

  it('returns nothing for a library with nothing rated', () => {
    expect(buildPrefetchTargets(none)).toEqual([]);
  });
});

describe('chunking at the server cap', () => {
  it('caps at exactly 100 — MAX_TARGETS in backend/src/pure.ts', () => {
    expect(PREFETCH_TARGET_CHUNK).toBe(100);
  });

  it('splits 250 targets into 100 / 100 / 50', () => {
    const targets = buildPrefetchTargets({
      ...none,
      episodes: Array.from({ length: 250 }, (_, i) => ({ showId: 100, season: 1, episode: i })),
    });
    expect(targets).toHaveLength(250);
    const batches = chunk(targets, PREFETCH_TARGET_CHUNK);
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
  });

  it('never produces a batch the server would refuse', () => {
    const targets = Array.from({ length: 401 }, (_, i) => `tvdb:100:1:${i}`);
    for (const b of chunk(targets, PREFETCH_TARGET_CHUNK)) {
      expect(b.length).toBeGreaterThan(0);
      expect(b.length).toBeLessThanOrEqual(100);
    }
  });
});

describe('prefetchDue', () => {
  const WINDOW = 5 * 60 * 1000;
  const now = 1_700_000_000_000;

  it('is due when it has never run', () => {
    expect(prefetchDue(null, now, WINDOW)).toBe(true);
    expect(prefetchDue(undefined, now, WINDOW)).toBe(true);
    expect(prefetchDue(0, now, WINDOW)).toBe(true);
  });

  it('is not due inside the window', () => {
    expect(prefetchDue(now, now, WINDOW)).toBe(false);
    expect(prefetchDue(now - WINDOW + 1, now, WINDOW)).toBe(false);
  });

  it('is due once the window has passed — the boundary counts as due', () => {
    expect(prefetchDue(now - WINDOW, now, WINDOW)).toBe(true);
    expect(prefetchDue(now - WINDOW - 1, now, WINDOW)).toBe(true);
  });

  it('is due when the stamp is in the FUTURE', () => {
    // A restored backup or a corrected timezone can put the bookmark ahead of
    // the clock. Treating that as "recently run" would lock the sweep out until
    // the clock caught up — hours, for a manual timezone fix — and the user
    // would see no percentages anywhere with nothing to tell them why.
    expect(prefetchDue(now + 1, now, WINDOW)).toBe(true);
    expect(prefetchDue(now + 86_400_000, now, WINDOW)).toBe(true);
  });
});

describe('prefetchRemaining', () => {
  const targets = ['tvdb:100:1:1', 'tvdb:100:1:2', 'tvdb:100:1:3', 'tvdb:200:1:1'];

  it('starts from the top when there is no cursor', () => {
    expect(prefetchRemaining(targets, '')).toEqual(targets);
  });

  it('resumes strictly after the last target sent', () => {
    expect(prefetchRemaining(targets, 'tvdb:100:1:2')).toEqual(['tvdb:100:1:3', 'tvdb:200:1:1']);
  });

  it('advances across runs until nothing is left', () => {
    // The whole resume contract, walked: two targets per run, three runs.
    let cursor = '';
    const seen: string[] = [];
    for (let run = 0; run < 3; run++) {
      const batch = prefetchRemaining(targets, cursor).slice(0, 2);
      if (batch.length === 0) break;
      seen.push(...batch);
      cursor = batch[batch.length - 1];
    }
    expect(seen).toEqual(targets);
    expect(prefetchRemaining(targets, cursor)).toEqual([]);
  });

  it('does not skip a target that sorts in BEHIND the cursor', () => {
    // Why the cursor is a sort key and not an index: the user rates an older
    // episode between runs, and it lands before the bookmark. It is missed this
    // sweep — correctly, the bookmark means "everything below is done" — and
    // the changed fingerprint restarts the sweep, which is where it is caught.
    const later = [...targets, 'tvdb:100:1:0'].sort();
    expect(prefetchRemaining(later, 'tvdb:100:1:2')).toEqual(['tvdb:100:1:3', 'tvdb:200:1:1']);
    expect(prefetchRemaining(later, '')).toContain('tvdb:100:1:0');
  });

  it('returns a copy the caller cannot use to mutate the target list', () => {
    const out = prefetchRemaining(targets, '');
    out.push('nonsense');
    expect(targets).toHaveLength(4);
  });
});

/**
 * The guard over "re-upload my archive", shaped after `account.test.ts`.
 *
 * `meta` is one flat table. The seed bookmarks sit in it beside `tvtimeFriends`
 * and the import state, and a re-upload that generalised into a prefix scan or
 * a "clear everything community-ish" loop would take the user's TV Time friend
 * list — or their session — with it. Every assertion below exists because some
 * plausible future edit would otherwise do exactly that, silently.
 */
describe('metaKeysClearedByArchiveReupload', () => {
  const cleared = metaKeysClearedByArchiveReupload();

  it('clears something — an empty list would pass every other test here', () => {
    expect(cleared.length).toBeGreaterThan(0);
  });

  it('clears exactly the six seed bookmarks, by name', () => {
    expect([...cleared].sort()).toEqual(
      [
        'communitySeedProgress',
        'communitySeedDone',
        'communitySeedRatingsProgress',
        'communitySeedRatingsDone',
        'communitySeedCharactersProgress',
        'communitySeedCharactersDone',
      ].sort(),
    );
  });

  it('clears NO local library or import key', () => {
    const trespass = cleared.filter((k) => (LOCAL_ONLY_META_KEYS as readonly string[]).includes(k));
    expect(trespass).toEqual([]);
  });

  it('never clears the TV Time import data', () => {
    // The trap, called out by name: these are named after TV Time and are read
    // by the community layer, so they look like community state. They came out
    // of the user's own GDPR export and are written back out by exporter.ts.
    expect(cleared).not.toContain('tvtimeUserId');
    expect(cleared).not.toContain('tvtimeFriends');
    expect(cleared).not.toContain('tvtimeFollowers');
    expect(cleared).not.toContain('tvtimeFollowingNames');
    expect(cleared).not.toContain('tvtimeNotifications');
  });

  it('never signs the user out or re-arms the one-time join offer', () => {
    // Re-uploading is not leaving. A run that cleared `communityJoined` would
    // log the user out of the community for tapping "send it again", and one
    // that cleared `communityAsked` would re-open a prompt they answered.
    for (const key of [
      'communityJoined',
      'communityProfileId',
      'communityHandle',
      'communityAsked',
      'communityDeclined',
      'communityBannerDismissed',
      'communityFriendsFingerprint',
      'communityFriendMatches',
      'communityUnread',
    ]) {
      expect(cleared).not.toContain(key);
    }
  });

  it('clears only keys in the community namespace', () => {
    expect(cleared.filter((k) => !k.startsWith('communitySeed'))).toEqual([]);
  });

  it('is a subset of what an account deletion clears', () => {
    // The structural rule: a seed bookmark is community state, so deleting the
    // account must already take it. A key here that is missing there would be
    // one the deletion path leaks.
    const orphan = cleared.filter((k) => !(COMMUNITY_META_KEYS as readonly string[]).includes(k));
    expect(orphan).toEqual([]);
  });

  it('has no duplicates', () => {
    expect(new Set(cleared).size).toBe(cleared.length);
  });

  it('returns a fresh array the caller cannot use to mutate the constant', () => {
    const first = metaKeysClearedByArchiveReupload() as string[];
    first.push('tvtimeFriends');
    expect(metaKeysClearedByArchiveReupload()).not.toContain('tvtimeFriends');
  });
});
