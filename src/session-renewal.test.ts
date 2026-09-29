/**
 * Signed out a week after signing in, silently — 27 Sep 2026.
 *
 * Every token lived seven days and nothing renewed it, and when the server
 * refused one the app signed out without a word. These pin both halves of the
 * fix on the phone: a renewed token from `GET /v1/me` is kept, and a sign-out
 * the SERVER caused leaves a notice behind — while one the person chose does
 * not.
 */

const meta = new Map<string, string>();
jest.mock('./db', () => ({
  getMeta: (k: string) => meta.get(k) ?? null,
  setMeta: (k: string, v: string) => {
    meta.set(k, v);
  },
}));
jest.mock('./plus', () => ({ setPlusEntitled: () => {}, setServerPlus: () => {} }));
jest.mock('./server-url', () => ({ isCustomServer: () => false }));

let reply: Record<string, unknown> = {};
jest.mock('./api', () => ({
  ApiError: class extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  api: () => Promise.resolve(reply),
  setUnauthenticatedHandler: () => {},
}));

const stored: Record<string, string> = { 'community.token': 'old-token' };
jest.mock('expo-secure-store', () => ({
  getItemAsync: (k: string) => Promise.resolve(stored[k] ?? 'old-token'),
  setItemAsync: (k: string, v: string) => {
    stored[k] = v;
    return Promise.resolve();
  },
  deleteItemAsync: (k: string) => {
    delete stored[k];
    return Promise.resolve();
  },
}));
jest.mock('./analytics', () => ({ setAnalyticsConsent: () => {}, track: () => {} }));
jest.mock('./push', () => ({ unregisterPush: () => Promise.resolve() }));

meta.set('communityJoined', '1');
// An ACCOUNT, which is what `refreshSession` checks since accounts and
// membership were split — joined without one is no longer a state that exists.
meta.set('communityProfileId', 'p_me');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const session = require('./community-session') as typeof import('./community-session');

const tokenValues = () => Object.values(stored);

describe('session renewal', () => {
  it('keeps the fresh token the server hands back', async () => {
    reply = { handle: 'me', session: { token: 'fresh-token', expires_at: '2026-11-26T00:00:00Z' } };
    await session.refreshSession();
    expect(tokenValues()).toContain('fresh-token');
  });

  it('leaves the stored token alone when there is nothing new', async () => {
    const before = tokenValues();
    reply = { handle: 'me' };
    await session.refreshSession();
    expect(tokenValues()).toEqual(before);
  });
});

describe('the signed-out notice', () => {
  it('is left behind when the server ended the session', async () => {
    await session.signIn('t', 'p_me', 'me');
    session.joinCommunity(); // the module caches `joined`; this sets it again
    expect(session.isJoined()).toBe(true);
    await session.signOutLocally({ byServer: true });
    expect(meta.get('community.signedOutByServer')).toBe('1');
  });

  it('is NOT left behind when the person signed out themselves', async () => {
    meta.set('community.signedOutByServer', '');
    await session.signIn('t', 'p_me', 'me');
    session.joinCommunity();
    expect(session.isJoined()).toBe(true); // otherwise this would pass for the wrong reason
    await session.signOutLocally();
    expect(meta.get('community.signedOutByServer')).not.toBe('1');
  });

  it('is cleared by signing back in', async () => {
    meta.set('community.signedOutByServer', '1');
    await session.signIn('t', 'p_me', 'me');
    expect(meta.get('community.signedOutByServer')).toBe('');
  });
});

/**
 * The notice has to reach the people signed out BEFORE the flag existed —
 * the owner among them — or it misses the case that prompted it.
 */
describe('who sees "you\'re signed out"', () => {
  const reset = () => {
    for (const k of ['community.signedOutByServer', 'communityLastEmail', 'communityLastProvider', 'communitySeedOwner']) meta.set(k, '');
  };

  it('a phone that never joined: nobody', async () => {
    reset();
    await session.signIn('t', 'p_me', 'me');
    session.joinCommunity();
    await session.signOutLocally(); // leaves joined=false; nothing remembered
    reset();
    expect(session.showSignedOutNotice()).toBe(false);
  });

  it('a former member signed out before this existed: yes', () => {
    reset();
    meta.set('communityLastProvider', 'google');
    expect(session.showSignedOutNotice()).toBe(true);
  });

  it('somebody who closed it: no', () => {
    reset();
    meta.set('communityLastProvider', 'google');
    session.dismissSignedOutNotice();
    expect(session.showSignedOutNotice()).toBe(false);
  });

  it('never while signed in', async () => {
    reset();
    meta.set('community.signedOutByServer', '1');
    await session.signIn('t', 'p_me', 'me');
    session.joinCommunity();
    expect(session.showSignedOutNotice()).toBe(false);
  });
});

/**
 * The account/community split, Sep 2026. Signing in is for Plus, backup and
 * sync; joining is for being public. Neither may cost the other.
 */
describe('an account without the community', () => {
  it('is checked and renewed on launch even though it never joined', async () => {
    await session.signIn('t', 'p_me', 'me');
    await session.leaveCommunityKeepAccount();
    expect(session.isJoined()).toBe(false);
    reply = { handle: 'me', session: { token: 'renewed-for-non-member' } };
    await session.refreshSession();
    // Still signed in — the old `if (!joined)` wiped the profile id here.
    expect(session.hasAccount()).toBe(true);
    expect(Object.values(stored)).toContain('renewed-for-non-member');
  });

  it('leaving the community keeps the account', async () => {
    await session.signIn('t', 'p_me', 'me');
    session.joinCommunity();
    await session.leaveCommunityKeepAccount();
    expect(session.isJoined()).toBe(false);
    expect(session.hasAccount()).toBe(true);
    expect(session.showSignedOutNotice()).toBe(false);
  });
});
