/**
 * A DEVICE THAT DECLINED THE COMMUNITY MUST NOT CONTACT THIS SERVER.
 *
 * Not a preference — a sentence shipped in six languages on the About screen:
 *
 *   "Without the community the app makes network requests only to TheTVDB and
 *    TMDB, for artwork and show information — no account, no analytics, no
 *    tracking."
 *
 * THE BUG THIS EXISTS FOR. The search screen drew a Users tab for everybody.
 * Typing a handle into it called `searchUsers`, which read a token (null),
 * sent `GET /v1/users?q=…` anyway, and rendered somebody's whole public
 * profile — shelves, stats, totals — to a person who had said no. Found by
 * searching on a phone that was not signed in and getting a result.
 *
 * A read is not exempt from the promise. It hands over an IP, the handles
 * somebody was curious about, and when they were curious: a request pattern is
 * a profile, and "we only read" is the sentence every tracking company says.
 *
 * WHY THE GUARD IS IN THE MODULE and not only on the tab that had it wrong:
 * screens are added by anybody, and this function is what every route to a
 * people-search has to pass through. The tab was fixed too, because a control
 * that answers every search with "nobody" reads as broken.
 */

const meta = new Map<string, string>();
jest.mock('./db', () => ({
  getMeta: (k: string) => meta.get(k) ?? null,
  setMeta: (k: string, v: string) => {
    meta.set(k, v);
  },
}));

/** Every request the app tried to make, whether or not it was joined. */
let requested: string[] = [];
jest.mock('./api', () => ({
  ApiError: class extends Error {},
  api: (path: string) => {
    requested.push(path);
    return Promise.resolve({ items: [{ handle: 'somebody', display_name: 'Somebody' }] });
  },
  setUnauthenticatedHandler: () => {},
}));

let signedIn = false;
jest.mock('./community-session', () => ({
  isJoined: () => signedIn,
  getToken: () => Promise.resolve(signedIn ? 'token' : null),
  signOutLocally: () => Promise.resolve(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { searchUsers } = require('./community-profiles') as typeof import('./community-profiles');

beforeEach(() => {
  requested = [];
  meta.clear();
});

describe('searchUsers, on a device that never joined', () => {
  beforeEach(() => {
    signedIn = false;
  });

  it('makes NO request at all', async () => {
    await searchUsers('mahmoodbashar08');
    expect(requested).toEqual([]);
  });

  it('answers with nobody rather than an error', async () => {
    // The caller renders this list. An exception here would surface as a
    // broken screen, which is not what declining the community should look
    // like — it should look like the feature is simply not there.
    await expect(searchUsers('mahmoodbashar08')).resolves.toEqual([]);
  });

  it('is not fooled by a query that looks harmless', async () => {
    // The old code returned early only for an EMPTY query, so every other
    // shape of input reached the network.
    await searchUsers('@a');
    await searchUsers('   x   ');
    expect(requested).toEqual([]);
  });
});

describe('searchUsers, once somebody has joined', () => {
  beforeEach(() => {
    signedIn = true;
  });

  it('asks, because now they have agreed to', async () => {
    const found = await searchUsers('mahmoodbashar08');
    expect(requested).toEqual(['/v1/users?q=mahmoodbashar08']);
    expect(found).toHaveLength(1);
  });

  it('still costs nothing for an empty query', async () => {
    await searchUsers('   ');
    expect(requested).toEqual([]);
  });
});
