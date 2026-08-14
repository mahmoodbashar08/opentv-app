/**
 * The pure half of Phase 5: the privacy matrix, what a notification says, and
 * the badge on the bell.
 *
 * `visibleProfileFields` is tested against the SAME four cases the server's own
 * version is, for the reason the handle tests give: two implementations of one
 * rule only stay identical if both are held to the same evidence. A divergence
 * here does not merely look wrong — it renders a bio the server has decided
 * this viewer may not read.
 *
 * Nothing here touches the network. `fetchProfile` and friends are thin wrappers
 * over `api()`, which has its own tests; what is worth pinning is the logic that
 * decides what a user is shown, and that is all in `pure.ts`.
 */
import {
  NOTIFICATION_KINDS,
  PROFILE_SECTIONS,
  UNREAD_BADGE_MAX,
  followPillState,
  nextPillState,
  parseHiddenSections,
  pillFromFollowResult,
  pillUndoes,
  sectionHidden,
  withSectionHidden,
  notificationText,
  unreadBadge,
  visibleProfileFields,
  type ProfileCounts,
} from '@/pure';

const counts: ProfileCounts = { followers: 12, following: 34, comments: 56, lists: 7 };

/** A profile with everything filled in, so any stripping is visible. */
function profile(isPrivate: boolean) {
  return {
    handle: 'sara',
    is_private: isPrivate,
    bio: 'watching everything twice',
    links: { site: 'https://example.test' },
    counts,
  };
}

describe('visibleProfileFields', () => {
  it('shows a public profile in full to a stranger', () => {
    const seen = visibleProfileFields(profile(false), false, false);
    expect(seen.bio).toBe('watching everything twice');
    expect(seen.links).toEqual({ site: 'https://example.test' });
    expect(seen.counts).toEqual(counts);
  });

  it('shows a private profile in full to its owner', () => {
    const seen = visibleProfileFields(profile(true), false, true);
    expect(seen.bio).toBe('watching everything twice');
    expect(seen.counts).toEqual(counts);
  });

  it('shows a private profile in full to an accepted follower', () => {
    const seen = visibleProfileFields(profile(true), true, false);
    expect(seen.bio).toBe('watching everything twice');
    expect(seen.counts).toEqual(counts);
  });

  it('strips bio, links and counts from a private profile for a stranger', () => {
    const seen = visibleProfileFields(profile(true), false, false);
    expect(seen.bio).toBeNull();
    expect(seen.links).toBeNull();
    expect(seen.counts).toBeNull();
  });

  it('keeps the shell of a private profile — you cannot follow who you cannot find', () => {
    const seen = visibleProfileFields(profile(true), false, false);
    expect(seen.handle).toBe('sara');
    expect(seen.is_private).toBe(true);
  });

  it('never mutates the profile it was given', () => {
    const original = profile(true);
    visibleProfileFields(original, false, false);
    expect(original.bio).toBe('watching everything twice');
    expect(original.counts).toEqual(counts);
  });
});

describe('notificationText', () => {
  it('names the actor in a complete sentence, one key per kind', () => {
    expect(notificationText('reply', 'sara')).toEqual({
      key: 'community.notifications.reply',
      params: { handle: 'sara' },
    });
    expect(notificationText('like', 'sara')).toEqual({
      key: 'community.notifications.like',
      params: { handle: 'sara' },
    });
    expect(notificationText('follow', 'sara')).toEqual({
      key: 'community.notifications.follow',
      params: { handle: 'sara' },
    });
    expect(notificationText('friend_found', 'sara')).toEqual({
      key: 'community.notifications.friendFound',
      params: { handle: 'sara' },
    });
  });

  it('has a separate key for a deleted actor rather than a substituted word', () => {
    // `actor_id` is ON DELETE SET NULL, so the row outlives the account. A
    // translated "someone" dropped into the named sentence would put a noun
    // where a proper name goes — several of these languages inflect that
    // differently — so each anonymous case is its own written sentence.
    expect(notificationText('reply', null)).toEqual({
      key: 'community.notifications.replyAnon',
      params: {},
    });
    expect(notificationText('like', null)).toEqual({
      key: 'community.notifications.likeAnon',
      params: {},
    });
    expect(notificationText('follow', undefined)).toEqual({
      key: 'community.notifications.followAnon',
      params: {},
    });
    expect(notificationText('friend_found', '')).toEqual({
      key: 'community.notifications.friendFoundAnon',
      params: {},
    });
  });

  it('never names a moderator', () => {
    // Deliberate: a moderation notice says what happened, not who decided it.
    expect(notificationText('moderation', 'admin')).toEqual({
      key: 'community.notifications.moderation',
      params: {},
    });
    expect(notificationText('moderation', null)).toEqual({
      key: 'community.notifications.moderation',
      params: {},
    });
  });

  it('falls back safely for a kind this client has never heard of', () => {
    // A server that grows a sixth kind must not leave old clients rendering
    // blank rows for real activity.
    expect(notificationText('mention', 'sara')).toEqual({
      key: 'community.notifications.unknown',
      params: {},
    });
    expect(notificationText('', null).key).toBe('community.notifications.unknown');
  });

  it('answers every kind the server can write', () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(notificationText(kind, 'sara').key).not.toBe('community.notifications.unknown');
    }
  });
});

describe('unreadBadge', () => {
  it('shows nothing at all for zero', () => {
    expect(unreadBadge(0)).toBe('');
  });

  it('counts exactly up to the cap', () => {
    expect(unreadBadge(1)).toBe('1');
    expect(unreadBadge(99)).toBe('99');
    expect(unreadBadge(UNREAD_BADGE_MAX)).toBe('99');
  });

  it('says "lots" past the cap', () => {
    expect(unreadBadge(100)).toBe('99+');
    expect(unreadBadge(1000)).toBe('99+');
  });

  it('treats a nonsense count as no badge rather than a red dot promising nothing', () => {
    expect(unreadBadge(-1)).toBe('');
    expect(unreadBadge(Number.NaN)).toBe('');
    // Infinity is not a count anybody has; it is a parse that went wrong, and
    // "99+" would dress it up as real activity.
    expect(unreadBadge(Number.POSITIVE_INFINITY)).toBe('');
  });
});

/**
 * PRIVATE ACCOUNTS: the pill, and what a profile is allowed to withhold.
 *
 * The pill is four states rather than a boolean, and every bug this pair of
 * functions can have is a bug that either promises access nobody granted or
 * offers a tap that cannot succeed. Both are worth a test each.
 */
describe('followPillState', () => {
  it('is Follow / Following for a public profile, as it always was', () => {
    expect(followPillState(false, false, false)).toBe('follow');
    expect(followPillState(true, false, false)).toBe('following');
  });

  it('asks rather than follows on a private profile', () => {
    expect(followPillState(false, false, true)).toBe('request');
    expect(followPillState(false, true, true)).toBe('requested');
  });

  it('says Following, not Requested, while both rows briefly exist', () => {
    // The server clears the pending row when it accepts; between the accept
    // and the next fetch a profile can carry both. "Following" is the half of
    // that overlap which is true, and the one that grants what it promises.
    expect(followPillState(true, true, true)).toBe('following');
  });

  it('draws a private profile you already follow exactly like a public one', () => {
    expect(followPillState(true, false, true)).toBe('following');
  });
});

describe('nextPillState', () => {
  it('takes the two off states to their matching on state', () => {
    expect(nextPillState('follow', false)).toBe('following');
    expect(nextPillState('request', true)).toBe('requested');
  });

  it('cancels a request back to Request, never to Follow', () => {
    // Landing on "Follow" would invite a tap that cannot do what it says: the
    // account is still private and the POST would open another request.
    expect(nextPillState('requested', true)).toBe('request');
    expect(nextPillState('following', true)).toBe('request');
  });

  it('unfollows a public profile back to Follow', () => {
    expect(nextPillState('following', false)).toBe('follow');
  });
});

describe('pillUndoes', () => {
  it('is true for exactly the two states a tap takes back', () => {
    expect(pillUndoes('following')).toBe(true);
    expect(pillUndoes('requested')).toBe(true);
    expect(pillUndoes('follow')).toBe(false);
    expect(pillUndoes('request')).toBe(false);
  });
});

describe('pillFromFollowResult', () => {
  it('believes the server over the guess, in both directions', () => {
    // Went private since the screen loaded: the tap was a follow and the
    // answer is a request.
    expect(pillFromFollowResult({ following: false, requested: true }, false)).toBe('requested');
    // Went public: the tap was a request and the answer is a follow.
    expect(pillFromFollowResult({ following: true, requested: false }, true)).toBe('following');
  });

  it('reads a bodiless answer as neither, matching the profile privacy', () => {
    expect(pillFromFollowResult({}, false)).toBe('follow');
    expect(pillFromFollowResult({}, true)).toBe('request');
  });
});

describe('sectionHidden', () => {
  it('shows everything when the server has no opinion', () => {
    // null from a server that has the field, undefined from one that predates
    // it. A section nobody hid is a section that shows — never the reverse,
    // which would blank a profile against its owner's wishes.
    for (const s of PROFILE_SECTIONS) {
      expect(sectionHidden(null, s)).toBe(false);
      expect(sectionHidden(undefined, s)).toBe(false);
      expect(sectionHidden([], s)).toBe(false);
    }
  });

  it('hides only what is named', () => {
    expect(sectionHidden(['stats', 'comments'], 'stats')).toBe(true);
    expect(sectionHidden(['stats', 'comments'], 'comments')).toBe(true);
    expect(sectionHidden(['stats', 'comments'], 'lists')).toBe(false);
  });

  it('never trusts a non-array — a broken value shows, it does not hide', () => {
    expect(sectionHidden('stats' as unknown as string[], 'stats')).toBe(false);
  });
});

describe('withSectionHidden', () => {
  it('adds and removes one section without disturbing the others', () => {
    expect(withSectionHidden(['stats'], 'lists', true)).toEqual(['stats', 'lists']);
    expect(withSectionHidden(['stats', 'lists'], 'stats', false)).toEqual(['lists']);
  });

  it('keeps the canonical order whatever order the switches were moved in', () => {
    const a = withSectionHidden(withSectionHidden([], 'comments', true), 'stats', true);
    const b = withSectionHidden(withSectionHidden([], 'stats', true), 'comments', true);
    expect(a).toEqual(b);
    expect(a).toEqual(['stats', 'comments']);
  });

  it('drops a key this build does not know, rather than carrying it forward', () => {
    // A section a later build added and this one cannot draw a switch for
    // would otherwise be hidden for ever, with nothing able to turn it back on.
    expect(withSectionHidden(['stats', 'holograms'], 'lists', true)).toEqual(['stats', 'lists']);
  });

  it('is a no-op when the switch is already where it is being put', () => {
    expect(withSectionHidden(['stats'], 'stats', true)).toEqual(['stats']);
    expect(withSectionHidden([], 'stats', false)).toEqual([]);
  });
});

describe('parseHiddenSections', () => {
  it('reads back what was written', () => {
    expect(parseHiddenSections(JSON.stringify(['stats', 'lists']))).toEqual(['stats', 'lists']);
  });

  it('treats an absent, empty or corrupt value as nothing hidden', () => {
    // Failing the other way would blank somebody's profile because a meta row
    // got mangled — a bug that looks exactly like the app losing their library.
    expect(parseHiddenSections(null)).toEqual([]);
    expect(parseHiddenSections('')).toEqual([]);
    expect(parseHiddenSections('{oops')).toEqual([]);
    expect(parseHiddenSections('"stats"')).toEqual([]);
  });

  it('ignores entries that are not sections', () => {
    expect(parseHiddenSections('["stats","holograms",7]')).toEqual(['stats']);
  });
});
