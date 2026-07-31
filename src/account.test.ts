/**
 * The guard over the promise.
 *
 * OpenTV tells its users, on the confirmation sheet for the most destructive
 * button in the app: *your library, watch history and imported data stay on
 * this phone; only your community presence is removed.* This file is what
 * makes that sentence enforceable rather than aspirational.
 *
 * `meta` is one flat table. The community flags and the imported library's own
 * bookkeeping live in it side by side, so the deletion path clears an explicit
 * allow-list and never a pattern, a prefix scan or a "everything we wrote".
 * Every assertion below exists because some plausible future edit — adding a
 * key, generalising the loop, "tidying up" the friend fingerprint — would
 * otherwise start deleting a user's TV Time friend list on account deletion
 * and nothing would notice.
 */
import {
  COMMUNITY_META_KEYS,
  COMMUNITY_OFFER_META_KEYS,
  COMMUNITY_SESSION_META_KEYS,
  COMMUNITY_SIGN_OUT_META_KEYS,
  LOCAL_ONLY_META_KEYS,
  metaKeysClearedOnAccountDeletion,
  metaKeysClearedOnSignOut,
} from './pure';

describe('metaKeysClearedOnAccountDeletion', () => {
  const cleared = metaKeysClearedOnAccountDeletion();

  it('clears something — an empty list would pass every other test here', () => {
    expect(cleared.length).toBeGreaterThan(0);
  });

  it('clears NO local library or import key', () => {
    // The assertion the whole feature rests on. Named intersection rather than
    // a boolean, so a failure says WHICH key crossed the line.
    const trespass = cleared.filter((k) => (LOCAL_ONLY_META_KEYS as readonly string[]).includes(k));
    expect(trespass).toEqual([]);
  });

  it('never clears the TV Time import data the community layer merely reads', () => {
    // Called out separately from the list above because these two are the
    // trap: they are named after TV Time and are sent by friend
    // reconciliation, so they look like community state. They came out of the
    // user's own GDPR export and are written back out by exporter.ts.
    expect(cleared).not.toContain('tvtimeUserId');
    expect(cleared).not.toContain('tvtimeFriends');
    expect(cleared).not.toContain('tvtimeFollowers');
    expect(cleared).not.toContain('tvtimeFollowingNames');
    expect(cleared).not.toContain('tvtimeNotifications');
  });

  it('clears only keys in the community namespace', () => {
    // The structural rule behind the two tests above: if a key does not begin
    // with `community`, the deletion path has no business touching it. This is
    // what catches a key that is added to the list before anyone thinks to add
    // it to LOCAL_ONLY_META_KEYS.
    const foreign = cleared.filter((k) => !k.startsWith('community'));
    expect(foreign).toEqual([]);
  });

  it('clears the session, the one-time offer, the seed bookmark and the badge', () => {
    // The positive half. A deletion that left `communityJoined` set would show
    // community UI for an account that no longer exists; one that left
    // `communityAsked` set would silently deny a returning user the join
    // prompt for ever.
    for (const key of [
      'communityJoined',
      'communityProfileId',
      'communityHandle',
      'communityAsked',
      'communityDeclined',
      'communityBannerDismissed',
      'communitySeedProgress',
      'communitySeedDone',
      'communityFriendsFingerprint',
      'communityFriendMatches',
      'communityUnread',
    ]) {
      expect(cleared).toContain(key);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(cleared).size).toBe(cleared.length);
  });

  it('returns a fresh array the caller cannot use to mutate the constant', () => {
    const first = metaKeysClearedOnAccountDeletion() as string[];
    first.push('tvtimeFriends');
    expect(metaKeysClearedOnAccountDeletion()).not.toContain('tvtimeFriends');
    expect(metaKeysClearedOnAccountDeletion()).toEqual([...COMMUNITY_META_KEYS]);
  });
});

describe('the two key lists', () => {
  it('do not overlap', () => {
    const both = (COMMUNITY_META_KEYS as readonly string[]).filter((k) =>
      (LOCAL_ONLY_META_KEYS as readonly string[]).includes(k),
    );
    expect(both).toEqual([]);
  });

  it('list local keys that are genuinely local — none is in the community namespace', () => {
    const misfiled = (LOCAL_ONLY_META_KEYS as readonly string[]).filter((k) => k.startsWith('community'));
    expect(misfiled).toEqual([]);
  });
});

describe('metaKeysClearedOnSignOut', () => {
  const cleared = metaKeysClearedOnSignOut();

  it('touches no local key', () => {
    const stolen = cleared.filter((k) => (LOCAL_ONLY_META_KEYS as readonly string[]).includes(k));
    expect(stolen).toEqual([]);
  });

  it('is a subset of what a deletion clears — leaving can never remove more than deleting', () => {
    const extra = cleared.filter((k) => !(COMMUNITY_META_KEYS as readonly string[]).includes(k));
    expect(extra).toEqual([]);
  });

  it('clears the seed bookmarks and the archive fingerprint, so a re-join uploads again', () => {
    for (const key of [
      'communitySeedDone',
      'communitySeedRatingsDone',
      'communitySeedCharactersDone',
      'communitySeedRevision',
      'communitySeedFingerprint',
    ]) {
      expect(cleared).toContain(key);
    }
  });

  it('keeps the one-time join offer answered — leaving is not a reason to re-ask', () => {
    for (const key of COMMUNITY_OFFER_META_KEYS) expect(cleared).not.toContain(key);
  });

  it('has no duplicates', () => {
    expect(new Set(cleared).size).toBe(cleared.length);
  });

  it('returns a fresh array the caller cannot use to mutate the constant', () => {
    (metaKeysClearedOnSignOut() as string[]).push('tvtimeFriends');
    expect(metaKeysClearedOnSignOut()).toEqual([...COMMUNITY_SIGN_OUT_META_KEYS]);
  });
});

describe('the three community sets', () => {
  // The real point of this file's newest guard: a key added to the deletion
  // list has to be classified as session, offer or account-scoped. Anything
  // left unclassified fails here rather than being silently kept across a
  // sign-out, which is exactly the bug that made this set necessary.
  it('partition COMMUNITY_META_KEYS exactly, with no key left unclassified', () => {
    const classified = [
      ...COMMUNITY_SESSION_META_KEYS,
      ...COMMUNITY_OFFER_META_KEYS,
      ...COMMUNITY_SIGN_OUT_META_KEYS,
    ] as readonly string[];
    expect([...classified].sort()).toEqual([...(COMMUNITY_META_KEYS as readonly string[])].sort());
    expect(new Set(classified).size).toBe(classified.length);
  });
});
