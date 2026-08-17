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
import { track } from '@/analytics';
import { ApiError, api } from '@/api';
import { getToken, isJoined, signOutLocally } from '@/community-session';
import { getMeta, setMeta } from '@/db';
import { visibleProfileFields, type ProfileCounts } from '@/pure';

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
 * stranger's billing cycle. OPTIONAL, because a server that predates the field
 * simply does not send it, and the badge's rule is that absent means absent: no
 * chip, rather than a chip that says "not a supporter" about somebody the
 * server was never asked.
 */
export type PublicProfile = {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_key: string | null;
  /** The fanart backdrop the owner picked, straight from TheTVDB or TMDB. */
  cover_url: string | null;
  bio: string | null;
  /** The owner's published theme — a #RRGGBB every visitor renders, or absent. */
  theme_color?: string | null;
  /** How the owner's profile body is drawn: 'classic', 'cards', or absent. */
  theme_layout?: string | null;
  /**
   * The owner's arrangement, as the JSON string the server stores.
   *
   * Opaque on the wire and parsed here rather than by the server, which does
   * not know what a widget is and must not learn — see migration 0022. Null for
   * a profile that has never been arranged, and for one whose Plus has lapsed.
   */
  widgets?: string | null;
  is_private: boolean;
  links: unknown;
  is_plus?: boolean;
  counts: ProfileCounts | null;
  followed_by_me: boolean;
  /**
   * A request this viewer has SENT and nobody has answered. Distinct from
   * `followed_by_me` in the one way that matters: it grants nothing. Optional,
   * because a server that predates follow requests never sends it and absent
   * must read as "no request", not as one.
   */
  follow_requested_by_me?: boolean;
  /**
   * The sections the owner has switched off, by the keys in `PROFILE_SECTIONS`.
   * `null` means "nothing hidden"; absent means the same, from a server that
   * has never heard of the field.
   */
  hidden_sections?: string[] | null;
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
  /**
   * The owner's chosen artwork for this list (Plus), drawn instead of the
   * collage. server: the column does not exist yet — phones already SEND it on
   * `POST /v1/published/lists` (see `publishableLists`), so the day it is added
   * every list that has one is carried on the next publish. Optional until
   * then, and an absent cover is the collage this screen has always drawn.
   */
  cover_url?: string | null;
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
  /** Sent by the publishing phone. The server has no catalogue and cannot
   *  resolve an id to artwork, so without this a collage draws name cards. */
  poster: string | null;
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
 * Who YOU follow — `GET /v1/me/following`.
 *
 * Kept alongside `fetchProfileFollowing` rather than replaced by it: this one
 * is authenticated and needs no handle, which is what the Profile tab's own
 * list wants, and it is the only form that works before a handle is known.
 */
export async function fetchFollowing(cursor?: string | null): Promise<EdgePage> {
  return write(async (token) => {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return asEdgePage(await api<unknown>(`/v1/me/following${query}`, { token }));
  });
}

/**
 * Who SOMEBODY ELSE follows — `GET /v1/profiles/:handle/following`.
 *
 * The mirror of `fetchFollowers`, and it could not exist until the route did:
 * the server published a followers list for any handle and a following list
 * only for the authenticated user, so a profile's "following" count was a
 * number you could read and not open. Your own opened. Same band, same cell,
 * two behaviours.
 *
 * Same visibility as the followers list — 404 for absent, deleted or blocked;
 * 403 for a private profile you do not follow. Who somebody follows is exactly
 * as revealing as who follows them.
 */
export async function fetchProfileFollowing(handle: string, cursor?: string | null): Promise<EdgePage> {
  const token = await readToken();
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return asEdgePage(
    await api<unknown>(`/v1/profiles/${encodeURIComponent(handle)}/following${query}`, { token }),
  );
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
export type FollowResult = { following: boolean; requested: boolean };

export async function follow(profileId: string): Promise<FollowResult> {
  const res = await write((token) =>
    api<FollowResult>(`/v1/follows/${encodeURIComponent(profileId)}`, { method: 'POST', token }),
  );
  // AFTER the await, so a refused follow is not counted as one. `profileId` is
  // deliberately not sent: who follows whom is the social graph, and shipping
  // it to a third party is a different product from the one the join screen
  // describes. The count is what tells you the feature is used.
  //
  // A REQUEST IS NOT A FOLLOW and is counted as its own event: the two have
  // very different meanings for whether the feature works, and a private
  // account's pending asks would otherwise inflate the follow number.
  track(res?.requested === true ? 'follow_request' : 'follow');
  // A server that answers 204, or anything else without a body, is answering
  // the old contract: the follow landed and nothing is pending.
  return { following: res?.following ?? true, requested: res?.requested === true };
}

/** Unfollow, OR cancel a request you sent — one call for both, by the server's
 *  design: a pending row and a follow row are the same edge at two stages, and
 *  a client that had to know which it was would have to ask first. 204, and
 *  undoing something that was never done is not an error. */
export async function unfollow(profileId: string): Promise<void> {
  await write((token) =>
    api<void>(`/v1/follows/${encodeURIComponent(profileId)}`, { method: 'DELETE', token }),
  );
  track('unfollow');
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

/** One row of `GET /v1/users` — the SHELL only: no bio, no counts, no links.
 *  A search result is a row in a list, not a profile; everything else stays
 *  behind `GET /v1/profiles/:handle` and its privacy matrix. */
export type UserSearchResult = ProfileRef & { is_private: boolean };

/**
 * Search people by HANDLE.
 *
 * THIS USED TO BE AN EXACT-HANDLE LOOKUP wearing a search-shaped coat, and its
 * own comment said why: there was no search route on the server. There is —
 * `GET /v1/users?q=` — and this client simply never caught up with it. The cost
 * was invisible and total: typing "aman" found nobody, because nothing short of
 * the complete handle `amanda` was a match, so the Users tab looked broken to
 * anyone who did not already know exactly who they were looking for. Which is
 * the one case where you do not need to search.
 *
 * A PREFIX SEARCH, and the server means the prefix: "am" finds `amanda`,
 * "manda" finds nobody. Display names are deliberately not searched — they are
 * unvalidated free text, they are not indexed, and matching them would let
 * somebody find a private account by the name it chose for its friends.
 *
 * The leading `@` people type is stripped; the server lowercases and matches on
 * `handle_lower`, so case never matters.
 *
 * The token is optional and buys exactly one thing: accounts either side of a
 * block drop out. An anonymous search still works, because a handle is public.
 *
 * Never throws. A half-typed handle misses on nearly every keystroke, and an
 * empty list is the honest rendering of a miss, a block and a dead network
 * alike — the last of which leaks nothing by looking like the first.
 */
export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  const q = query.replace(/^@+/, '').trim();
  if (!q) return [];
  try {
    const token = await readToken();
    const res = await api<{ items?: UserSearchResult[] }>(`/v1/users?q=${encodeURIComponent(q)}`, {
      token,
    });
    return Array.isArray(res?.items) ? res.items : [];
  } catch {
    return [];
  }
}

/** A title on somebody's shelf, as `GET /v1/profiles/:handle/published` sends it. */
export type PublishedTitle = {
  /** Position among the FAVOURITES, which is not the main shelf's order. */
  fav_rank?: number | null;
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

/**
 * PUSH THE NAME PEOPLE SEE.
 *
 * `Profile → Edit` wrote to local meta and stopped there, so a name typed on
 * the phone never reached the profile anybody else looks at: every public
 * profile in the community showed a bare @handle, whatever its owner had
 * called themselves. The server has accepted `display_name` on `PATCH /v1/me`
 * since the beginning — nothing was sending it.
 *
 * FIRE AND FORGET, and silent on failure. This is called from a save that has
 * already succeeded locally; turning a flaky network into an error dialog
 * would make editing your own name feel breakable when the only copy that
 * matters is already written. The next edit, or the next sign-in, retries it.
 *
 * Not called at all when signed out: there is no profile to name yet, and the
 * value is pushed by `syncDisplayName` when one appears.
 */
/**
 * Publish the profile theme — the colour every visitor renders this profile in.
 *
 * Unlike `pushDisplayName` this one THROWS on failure, because it is called
 * from a screen with the user's finger still on the swatch: a theme that
 * silently failed to publish would look chosen on this phone and absent on
 * every other, forever, with nothing to retry it. The caller shows the error
 * (`plus_required` opens the paywall) and leaves the swatch unselected.
 */
export async function pushProfileTheme(color: string | null): Promise<void> {
  const token = await getToken();
  if (!token) return;
  await api('/v1/me', { method: 'PATCH', token, body: { theme_color: color } });
}

/**
 * The profile's arrangement, published.
 *
 * FINGERPRINTED, like every other publish on this file's siblings: a profile is
 * rearranged once and then opened a thousand times, and a PATCH on every focus
 * would be a thousand writes to say nothing changed. The fingerprint is the
 * published JSON itself — if what a visitor would see is identical, there is
 * nothing to send.
 *
 * Silent on failure. Unlike the privacy switch, an arrangement that did not
 * reach the server is a profile that looks slightly older to other people for
 * a few minutes, which is not worth an alert over somebody's evening.
 */
const WIDGETS_SENT_KEY = 'communityWidgetsSent';

export async function pushWidgets(json: string | null): Promise<void> {
  if (getMeta(WIDGETS_SENT_KEY) === (json ?? '')) return;
  const token = await getToken();
  if (!token) return;
  await api('/v1/me', { method: 'PATCH', token, body: { widgets: json } });
  setMeta(WIDGETS_SENT_KEY, json ?? '');
}

/**
 * PRIVATE, OR NOT. Throws, like the theme and for the same reason: this is
 * tapped with a finger on a switch, and a curtain that silently failed to close
 * is the one failure mode a privacy control must not have. The caller puts the
 * switch back where it was and says so.
 */
export async function pushPrivate(isPrivate: boolean): Promise<void> {
  const token = await getToken();
  if (!token) return;
  await api('/v1/me', { method: 'PATCH', token, body: { is_private: isPrivate } });
}

/**
 * The sections switched off, sent WHOLE — the server takes the array as the
 * complete truth rather than a delta, so there is no add/remove race between
 * two switches moved quickly. Throws, like `pushPrivate`.
 */
export async function pushHiddenSections(sections: readonly string[]): Promise<void> {
  const token = await getToken();
  if (!token) return;
  // An empty array rather than null: both mean "nothing hidden" to the server,
  // and sending the array keeps one shape on the wire.
  await api('/v1/me', { method: 'PATCH', token, body: { hidden_sections: [...sections] } });
}

/** Somebody waiting on an answer. The shell only — a request is a row, not a
 *  profile, and the profile behind it is one tap away. */
export type FollowRequest = ProfileRef & { is_plus?: boolean; created_at: string };

export type FollowRequestPage = { items: FollowRequest[]; next_cursor: string | null };

/**
 * Who has asked to follow you.
 *
 * NEVER THROWS, unlike the profile reads. This list is reached from a row that
 * already told the user there is something here; an error page in its place
 * would be worse than an empty one, and the empty one is retried on next focus.
 */
export async function fetchFollowRequests(cursor?: string | null): Promise<FollowRequestPage> {
  try {
    const token = await getToken();
    if (token == null) return { items: [], next_cursor: null };
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const res = await api<{ items?: FollowRequest[]; next_cursor?: string | null }>(
      `/v1/me/follow-requests${query}`,
      { token },
    );
    return {
      items: Array.isArray(res?.items) ? res.items : [],
      next_cursor: typeof res?.next_cursor === 'string' && res.next_cursor.length > 0 ? res.next_cursor : null,
    };
  } catch {
    return { items: [], next_cursor: null };
  }
}

/**
 * Accept or deny one. Throws — the row vanishes from the list optimistically,
 * so a silent failure would leave somebody believing they had answered when the
 * asker is still waiting.
 *
 * 404 means the row is already gone: they cancelled, or another device answered.
 * That is not an error the user needs an alert about, but it IS a reason to
 * refetch, so it is left to the caller to read the code.
 */
export async function answerFollowRequest(profileId: string, action: 'accept' | 'deny'): Promise<void> {
  await write((token) =>
    api<{ ok: true }>(`/v1/me/follow-requests/${encodeURIComponent(profileId)}`, {
      method: 'POST',
      token,
      body: { action },
    }),
  );
  track(action === 'accept' ? 'follow_request_accept' : 'follow_request_deny');
}

/** The other half of a theme. Throws like the colour, and for the same reason. */
export async function pushProfileLayout(layout: 'classic' | 'cards' | 'poster' | null): Promise<void> {
  const token = await getToken();
  if (!token) return;
  await api('/v1/me', { method: 'PATCH', token, body: { theme_layout: layout } });
}

export async function pushDisplayName(name: string | null): Promise<void> {
  if (!isJoined()) return;
  const token = await getToken();
  if (!token) return;
  const trimmed = (name ?? '').trim();
  try {
    await api('/v1/me', {
      method: 'PATCH',
      token,
      // Empty means "no name", which is a real state — the server takes null
      // for it and shows the handle alone.
      body: { display_name: trimmed.length > 0 ? trimmed.slice(0, 100) : null },
    });
  } catch {
    // Local copy stands. See the note above.
  }
}

/**
 * The catch-up, run once per sign-in.
 *
 * Somebody may have set their name months before the community existed — most
 * people did, since the import writes it — and that name has never been sent.
 * Sending it when an account appears is what makes those profiles arrive with
 * a name rather than blank.
 */
export async function syncDisplayName(): Promise<void> {
  // Lazy, like every other db read in this file's neighbours: a top-level
  // import of db.ts from a community module cycles through metadata.ts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getMeta } = require('@/db') as typeof import('@/db');
  const name = getMeta('username');
  if (name && name.trim().length > 0) await pushDisplayName(name);
}
