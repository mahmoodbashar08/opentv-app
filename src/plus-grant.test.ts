/**
 * Plus given to somebody rather than bought by them.
 *
 * `plus_until` and the `is_plus` column are written by TWO things: the
 * RevenueCat webhook when a purchase lands, and a hand-written UPDATE when the
 * tier is a GIFT — a moderator, an early supporter, or an Android user on a
 * platform that cannot sell it for months yet. Only the first ever reached the
 * phone, so a granted account carried the badge on its public profile and had
 * its Plus-only writes accepted by the server while its own device went on
 * hiding every Plus screen.
 *
 * `refreshSession` is where it is read because that launch already asks
 * `GET /v1/me` — this costs a field, not a round trip.
 *
 * WHAT THESE TESTS ARE REALLY GUARDING is the asymmetry. The obvious edit —
 * `setPlusEntitled(me.is_plus === true)` — reads as tidier and hands the
 * server the power to switch Plus OFF. The webhook is not instant: buy on a
 * bad connection, relaunch before it lands, and the tier somebody has just
 * paid for vanishes. So the third test matters more than the first two.
 */

const meta = new Map<string, string>();
jest.mock('./db', () => ({
  getMeta: (k: string) => meta.get(k) ?? null,
  setMeta: (k: string, v: string) => {
    meta.set(k, v);
  },
}));

let entitled: boolean | null = null;
let told: boolean | null | undefined;
jest.mock('./plus', () => ({
  setPlusEntitled: (on: boolean) => {
    entitled = on;
  },
  setServerPlus: (on: boolean | null) => {
    told = on;
  },
}));

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

jest.mock('expo-secure-store', () => ({
  getItemAsync: () => Promise.resolve('token'),
  setItemAsync: () => Promise.resolve(),
  deleteItemAsync: () => Promise.resolve(),
}));

jest.mock('./analytics', () => ({ setAnalyticsConsent: () => {}, track: () => {} }));
jest.mock('./push', () => ({ unregisterPush: () => Promise.resolve() }));

/* BEFORE the require, not in `beforeEach`. `community-session` reads whether
   this device has joined ONCE, into a module-level `joined`, at import time —
   so a flag set afterwards is set too late and `refreshSession` returns
   without asking the server anything. */
meta.set('communityJoined', '1');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { refreshSession } = require('./community-session') as typeof import('./community-session');

beforeEach(() => {
  entitled = null;
  told = undefined;
});

describe('a Plus grant reaching the phone', () => {
  it('entitles a device whose profile the server says is Plus', async () => {
    reply = { handle: 'amanda', is_plus: true };
    await refreshSession();
    expect(entitled).toBe(true);
  });

  it('leaves a free account alone rather than entitling it', async () => {
    reply = { handle: 'amanda', is_plus: false };
    await refreshSession();
    expect(entitled).toBeNull();
  });

  it('NEVER turns Plus off, however loudly the server says false', async () => {
    /*
     * The one that stops a "tidier" rewrite. A device that bought Plus seconds
     * ago and relaunched before the webhook landed sees exactly this reply,
     * and must keep what it paid for. Revoking belongs to RevenueCat, which
     * reads the receipt rather than our database.
     */
    reply = { handle: 'amanda', is_plus: false };
    await refreshSession();
    expect(entitled).not.toBe(false);
  });

  it('an older server that sends no such field changes nothing', async () => {
    reply = { handle: 'amanda' };
    await refreshSession();
    expect(entitled).toBeNull();
  });
});

describe('telling purchases.ts what the server said', () => {
  /*
   * THE BUG THIS HALF EXISTS FOR, and it made the feature above useless.
   *
   * Launch order is: refreshSession, then initPurchases. `applyEntitlement`
   * set the flag from `entitlements.active` ALONE, and a gifted account has no
   * receipt — so the store answered "nothing bought", correctly, and wiped the
   * grant a second or two after this file had written it. The grant did not
   * survive a single launch, and nothing failed.
   *
   * So the answer has to be handed on, not just acted on.
   */
  it('records a yes, so the receipt cannot overrule it', async () => {
    reply = { handle: 'amanda', is_plus: true };
    await refreshSession();
    expect(told).toBe(true);
  });

  it('records a NO — which is how an expired grant is finally taken back', async () => {
    // Both sources must agree before Plus goes away. This is the half that
    // lets them: `plus_until` lapses, the server says false, the store says
    // false, and only then does the phone stop showing the tier.
    reply = { handle: 'amanda', is_plus: false };
    await refreshSession();
    expect(told).toBe(false);
  });

  it('says NOTHING when the server could not be reached', async () => {
    /*
     * Unknown must not read as no. A gifted subscriber opening the app on a
     * bad connection would otherwise lose the tier, because the store — the
     * only source left — has no receipt for a gift.
     */
    reply = Promise.reject(new Error('offline')) as never;
    await refreshSession();
    expect(told).toBeUndefined();
    expect(entitled).toBeNull();
  });
});
