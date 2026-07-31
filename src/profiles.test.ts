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
  UNREAD_BADGE_MAX,
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
