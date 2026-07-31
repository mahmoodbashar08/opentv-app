/**
 * Profiles, following, and the published lists that hang off a profile.
 *
 * THE READS ARE OPEN, AND THE BEARER STILL GOES OUT. `GET /v1/profiles/:handle`
 * mounts no `requireAuth`: a profile is a public page and a stranger may read
 * it. A token, when there is one, buys three things the app cannot work out for
 * itself — `followed_by_me`, the private-profile fields this viewer has earned,
 * and the block filter, which runs in BOTH directions. Sending it when we have
 * it is what stops somebody who blocked you from appearing in your search.
 *
 * READS THROW, unlike `community-comments.ts`, and the difference is
 * deliberate. A thread that fails quietly still shows a screen with a heading
 * on it. A profile that fails quietly shows nothing at all, and the user cannot
 * tell "this person does not exist" from "your train went into a tunnel" — two
 * answers that call for completely different reactions. So the profile screen
 * gets the `ApiError` and localises from its `code`.
 *
 * ONE 404 COVERS FOUR THINGS, by the server's design: no such handle, a
 * soft-deleted account, an account that blocked you, and an account you
 * blocked. They are indistinguishable on purpose — a 403 would confirm the
 * account exists, and "yes, they are still here, and yes, they blocked you" is
 * precisely the conversation a block is meant to end. The screen must therefore
 * say "not found" and nothing more inventive.
 */
import { ApiError, api } from '@/api';
import { getToken, isJoined, signOutLocally } from '@/community-session';
import { isHandleValid, visibleProfileFields, type ProfileCounts } from '@/pure';

/** The compact person block every list row carries, as the server shapes it. */
export type ProfileRef = {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_key: string | null;
};

/**
 * A public profile, field for field from `shapeProfile` in
 * `backend/src/routes/profiles.ts`. Snake case, as the wire has it — a client
 * that renames a wire field owns a translation layer nobody asked for.
 *
 * `counts` is NULL for a private profile a stranger is looking at. That is the
 * shell: handle, name and avatar survive so the person can still be found and
 * followed; bio, links and the four numbers do not.
 *
 * `is_plus` is a boolean and never a date — the server refuses to publish a
 * stranger's billing cycle.
 */
export type PublicProfile = {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_key: string | null;
  bio: string | null;
  is_private: boolean;
  links: unknown;
  is_plus: boolean;
  counts: ProfileCounts | null;
  followed_by_me: boolean;
  created_at: string;
};

/** One row of a followers/following page, from `shapeEdge`. */
export type ProfileEdge = ProfileRef & { followed_at: string };

/** A cursor-paged page of people. `next_cursor` is opaque and server-made. */
export type EdgePage = { items: ProfileEdge[]; next_cursor: string | null };

/** A published list, from `shapeList`. `item_count` counts rows, not seasons. */
export type PublishedList = {
  id: string;
  name: string;
  description: string | null;
  is_public: boolean;
  item_count: number;
  created_at: string;
};

/**
 * One entry in a list. `title` is DENORMALISED on the server precisely so that
 * rendering a list needs no metadata lookup — a list of films nobody on this
 * device has heard of still reads correctly, offline, first frame.
 */
export type ListItem = {
  position: number;
  target_source: string;
  target_key: string;
  title: string | null;
};

export type ListDetail = PublishedList & { owner: ProfileRef; items: ListItem[] };

const EMPTY_EDGES: EdgePage = { items: [], next_cursor: null };

/**
 * The token for a read that works without one.
 *
 * `isJoined()` first, so a signed-out reader never touches the Keychain — an
 * async call on the render path of a public screen, for a value already known
 * to be absent. Mirrors `readToken` in `community-comments.ts`; kept local
 * rather than shared because it is four lines and a cross-import between two
 * feature modules to save them is a worse trade than the repetition.
 */
async function readToken(): Promise<string | null> {
  if (!isJoined()) return null;
  try {
    return await getToken();
  } catch {
    return null;
  }
}

/**
 * Every write goes through here, exactly as the comment module's does: a dead
 * session is cleared ONCE on the spot (the token cannot start working again, so
 * retrying is pointless), and anything thrown that is not an `ApiError` becomes
 * one, because callers localise from `code` and a bare `TypeError` has no
 * string to show.
 */
async function write<T>(run: (token: string) => Promise<T>): Promise<T> {
  if (!isJoined()) throw new ApiError('unauthenticated', 0, 'not joined');
  let token: string | null;
  try {
    token = await getToken();
  } catch {
    token = null;
  }
  if (!token) throw new ApiError('unauthenticated', 0, 'no stored token');

  try {
    return await run(token);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.needsSignIn) void signOutLocally();
      throw e;
    }
    throw new ApiError('unknown', 0, e instanceof Error ? e.message : 'write failed');
  }
}

/** Anything that is not a well-formed page reads as an empty one. */
function asEdgePage(res: unknown): EdgePage {
  if (!res || typeof res !== 'object') return EMPTY_EDGES;
  const r = res as { items?: unknown; next_cursor?: unknown };
  return {
    items: Array.isArray(r.items) ? (r.items as ProfileEdge[]) : [],
    next_cursor: typeof r.next_cursor === 'string' && r.next_cursor.length > 0 ? r.next_cursor : null,
  };
}

/**
 * One profile. Throws `ApiError` — `not_found` for all four of the cases in the
 * header, `network` for a tunnel.
 *
 * The server has already applied the privacy rule; `visibleProfileFields` runs
 * again here so the value this function hands out is the same shape whether it
 * came from the wire or from anything that later caches it. On a fresh read it
 * is a no-op, which is what makes it safe to run unconditionally.
 */
export async function fetchProfile(handle: string): Promise<PublicProfile> {
  const token = await readToken();
  const raw = await api<PublicProfile>(`/v1/profiles/${encodeURIComponent(handle)}`, { token });
  return visibleProfileFields(raw, raw.followed_by_me, false);
}

/**
 * A page of somebody's followers.
 *
 * 403 `forbidden` for a private profile the viewer has not earned — a follower
 * list is part of the detail, not part of the shell. The caller shows the
 * private notice rather than an empty list, which would read as "nobody follows
 * this person".
 */
export async function fetchFollowers(handle: string, cursor?: string | null): Promise<EdgePage> {
  const token = await readToken();
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return asEdgePage(
    await api<unknown>(`/v1/profiles/${encodeURIComponent(handle)}/followers${query}`, { token }),
  );
}

/**
 * Who YOU follow — `GET /v1/me/following`, and there is no other.
 *
 * NOT A GAP IN THIS CLIENT: the server publishes a followers list for any
 * handle but a following list only for the authenticated user. Whose timeline
 * you read is a stronger signal than who reads yours, so it is not public, and
 * no `handle` parameter exists to pass.
 */
export async function fetchFollowing(cursor?: string | null): Promise<EdgePage> {
  return write(async (token) => {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return asEdgePage(await api<unknown>(`/v1/me/following${query}`, { token }));
  });
}

/**
 * Follow somebody. Idempotent on the server — a re-tapped button inserts
 * nothing and, importantly, notifies nobody a second time.
 *
 * 403 `blocked` when a block exists in EITHER direction. The UI cannot know
 * that in advance (a profile you blocked 404s, but one that blocked you also
 * 404s, so you never reach the button) and it is handled as an error rather
 * than pre-empted.
 */
export async function follow(profileId: string): Promise<void> {
  await write((token) =>
    api<{ following: boolean }>(`/v1/follows/${encodeURIComponent(profileId)}`, { method: 'POST', token }),
  );
}

/** Unfollow. 204, and unfollowing someone you do not follow is not an error. */
export async function unfollow(profileId: string): Promise<void> {
  await write((token) =>
    api<void>(`/v1/follows/${encodeURIComponent(profileId)}`, { method: 'DELETE', token }),
  );
}

/**
 * Somebody's PUBLIC lists — public even when you are the owner. The server is
 * explicit that this is the shop window; drafts are reached one id at a time.
 * 403 for a private profile, same rule as the follower list.
 */
export async function fetchProfileLists(handle: string): Promise<PublishedList[]> {
  const token = await readToken();
  const res = await api<{ items?: PublishedList[] }>(
    `/v1/profiles/${encodeURIComponent(handle)}/lists`,
    { token },
  );
  return Array.isArray(res?.items) ? res.items : [];
}

/**
 * One list and its items, ordered by position.
 *
 * Every refusal is the same 404 — a private list, a list of a deleted account,
 * a list of somebody who blocked you, and a list that never existed. The id
 * space must not become an oracle.
 */
export async function fetchList(id: string): Promise<ListDetail> {
  const token = await readToken();
  const res = await api<ListDetail>(`/v1/lists/${encodeURIComponent(id)}`, { token });
  return { ...res, items: Array.isArray(res?.items) ? res.items : [] };
}

/**
 * THERE IS NO USER-SEARCH ENDPOINT, and this is not an oversight on either
 * side. The Worker publishes `/v1/profiles/:handle` and nothing that takes a
 * query: no prefix search, no display-name match, no directory. Verified
 * against every route the server mounts (`backend/src/index.ts`).
 *
 * So this is an EXACT-HANDLE LOOKUP wearing a search-shaped coat. You type a
 * handle, you get that person or you get nothing. It returns an array of zero
 * or one so the screen renders a list either way, and so the day a real search
 * route lands, this function's body is the only thing that changes.
 *
 * The handle is validated locally first. `@sara` and `Sara ` both normalise to
 * `sara`; a query with a space or an accent in it cannot be a handle at all, so
 * it is answered with an empty result rather than a wasted round trip and a
 * 404 that would read to the user as "that person does not exist".
 *
 * Never throws. Unlike `fetchProfile`, a miss here is the ordinary case — a
 * half-typed handle is a miss on nearly every keystroke — and an empty list is
 * the honest rendering of it.
 */
export async function searchUsers(query: string): Promise<PublicProfile[]> {
  const valid = isHandleValid(query.replace(/^@+/, ''));
  if (!valid.ok) return [];
  try {
    return [await fetchProfile(valid.handle)];
  } catch {
    // 404 (absent, deleted, blocked in either direction) and a dead network are
    // deliberately the same empty answer here: the screen shows "no matches",
    // which is true in every one of those cases and leaks nothing in the first.
    return [];
  }
}

/** A title on somebody's shelf, as `GET /v1/profiles/:handle/published` sends it. */
export type PublishedTitle = {
  target_source: 'tvdb' | 'tmdb' | 'title';
  target_key: string;
  name: string | null;
  poster: string | null;
  favourite: boolean;
};

export type PublishedProfile = {
  stats: {
    episodes_watched: number;
    /** SHOW minutes. Films are `movie_minutes` — the profile draws a card each. */
    minutes_watched: number;
    movie_minutes: number;
    shows_count: number;
    movies_count: number;
    updated_at: string;
  } | null;
  shows: PublishedTitle[];
  movies: PublishedTitle[];
};

const NO_PUBLISHED: PublishedProfile = { stats: null, shows: [], movies: [] };

/**
 * What somebody has watched, as their profile publishes it.
 *
 * `stats` is NULL rather than zeroes for an account that has never synced —
 * "has watched nothing" and "has not published anything" are different
 * sentences and the screen shows different things for them.
 *
 * Every failure is the empty shape, not a throw: a profile whose shelves did
 * not load should render its name, its follow button and its comments, not an
 * error page. 403 (private) included — the screen above already knows the
 * profile is private and says so once.
 */
export async function fetchPublishedProfile(handle: string): Promise<PublishedProfile> {
  try {
    const token = await readToken();
    const res = await api<PublishedProfile>(`/v1/profiles/${encodeURIComponent(handle)}/published`, { token });
    return {
      stats: res?.stats ?? null,
      shows: Array.isArray(res?.shows) ? res.shows : [],
      movies: Array.isArray(res?.movies) ? res.movies : [],
    };
  } catch {
    return NO_PUBLISHED;
  }
}
