/**
 * The comment section — the community's words, as opposed to its numbers.
 *
 * TWO DIRECTIONS, TWO CONTRACTS, and the split is the whole design:
 *
 *   READS  never throw. `GET /v1/comments` is an OPEN endpoint — a thread is
 *          readable without an account, and that is the point rather than an
 *          oversight. A failed read resolves to an empty page; a screen that
 *          could crash on somebody else's server being down is not a tracker
 *          that works offline.
 *
 *   WRITES throw `ApiError`, always, and only `ApiError`. Every one of them is
 *          something a user did on purpose, so silence would be wrong: they
 *          need to be told, in their own language, from `code`. Never from the
 *          server's `message`, which is English and is for logs.
 *
 * THE BEARER ON A PUBLIC READ is deliberate. The endpoint answers anonymously,
 * but a token buys two things that cannot be reconstructed client-side: the
 * block filter, which runs in BOTH directions, and `liked_by_me`. Sending it
 * when we have it is what stops a blocked person's comments from appearing to
 * somebody who blocked them.
 *
 * There is no image path in this file, and there is not meant to be. Comments
 * here are text. Accepting a photograph from the public means CSAM scanning
 * before the first upload, not after, and that is a different piece of work
 * with a different bill attached.
 */
import { track } from '@/analytics';
import { ApiError, api } from '@/api';
import { getToken, isJoined, signOutLocally } from '@/community-session';
import { currentLocale } from '@/i18n';
import type { ReportReason } from '@/pure';

/** The author block on every comment, exactly as `shapeComment` returns it. */
export type CommentAuthor = {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_key: string | null;
};

/**
 * One comment, field for field from `shapeComment` in
 * `backend/src/routes/comments.ts`. Named as the server names them — snake
 * case and all — because the moment a client renames a wire field it owns a
 * translation layer nobody asked for, and a server change stops being a
 * compile error.
 */
export type Comment = {
  id: string;
  author: CommentAuthor;
  target_source: TargetSource;
  target_key: string;
  season: number | null;
  episode: number | null;
  body: string;
  /** The server sends 0 / 1. `spoilerHidden` in pure.ts takes either shape. */
  is_spoiler: number;
  lang: string | null;
  parent_id: string | null;
  /** Non-null when the comment was brought over from a TV Time export. */
  imported_at: string | null;
  like_count: number;
  liked_by_me: boolean;
  reply_count: number;
  created_at: string;
  edited_at: string | null;
};

export type TargetSource = 'tvdb' | 'tmdb' | 'title';

/**
 * A page of a thread. `next_cursor` is opaque — `base64url(created_at|id)`,
 * made by the server, parsed by the server. The app never builds one and never
 * reads inside one; it hands back what it was given.
 */
export type ThreadPage = { items: Comment[]; next_cursor: string | null };

const EMPTY: ThreadPage = { items: [], next_cursor: null };

/** `COMMENT_PAGE_DEFAULT` on the server. Anything over 50 is clamped there. */
export const THREAD_PAGE = 25;

export type ThreadTarget = {
  source: TargetSource;
  key: string;
  /** Omitted entirely for a show-level thread — see the note in `threadQuery`. */
  season?: number | null;
  episode?: number | null;
};

/**
 * The querystring for a thread read.
 *
 * SEASON AND EPISODE ARE OMITTED, NOT SENT AS NULL, for a show-level thread.
 * The server reads a missing param as -1 and matches on
 * `COALESCE(c.season, -1) = ?`, so an absent season addresses the rows whose
 * season IS NULL — the show's own thread. Sending `season=` would parse as
 * `Number('')` → 0, and quietly address season zero instead: a real season for
 * anything with specials, and an empty thread for everything else.
 */
function threadQuery(t: ThreadTarget, cursor: string | null, limit: number): string {
  const parts = [`source=${encodeURIComponent(t.source)}`, `key=${encodeURIComponent(t.key)}`];
  if (t.season != null) parts.push(`season=${t.season}`);
  if (t.episode != null) parts.push(`episode=${t.episode}`);
  if (cursor) parts.push(`cursor=${encodeURIComponent(cursor)}`);
  parts.push(`limit=${limit}`);
  return parts.join('&');
}

/**
 * The token, when there is one, for a read that works fine without it.
 *
 * `isJoined()` is checked first so a signed-out reader never touches the
 * Keychain at all — an async call, on the render path of a public screen, for
 * a value already known to be absent.
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
 * The token a WRITE requires, or a thrown `unauthenticated`.
 *
 * The UI is expected to have hidden the control already — a signed-out reader
 * is never shown a like button or a composer. This is the backstop for the
 * case `community-session.ts` documents: `meta` says joined, the Keychain
 * disagrees (a restored backup carries the database but not the Keychain), and
 * the honest answer is "sign in again", not a 401 from the server.
 */
async function writeToken(): Promise<string> {
  if (!isJoined()) throw new ApiError('unauthenticated', 0, 'not joined');
  const token = await getToken();
  if (!token) throw new ApiError('unauthenticated', 0, 'no stored token');
  return token;
}

/**
 * Every write goes through here. Two jobs, both of which would otherwise be
 * repeated six times:
 *
 *  1. A dead session is cleared ONCE, on the spot. The token cannot start
 *     working again, so retrying is pointless and the UI must fall back to the
 *     join prompt immediately.
 *  2. Anything thrown that is not an `ApiError` becomes one. Callers localise
 *     from `code`; a bare `TypeError` escaping into that path would have no
 *     string to show.
 */
async function write<T>(run: (token: string) => Promise<T>): Promise<T> {
  let token: string;
  try {
    token = await writeToken();
  } catch (e) {
    throw e instanceof ApiError ? e : new ApiError('unauthenticated', 0, 'no session');
  }

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

/** Anything the server did not send as a well-formed page reads as no page. */
function asPage(res: unknown): ThreadPage {
  if (!res || typeof res !== 'object') return EMPTY;
  const r = res as { items?: unknown; next_cursor?: unknown };
  return {
    items: Array.isArray(r.items) ? (r.items as Comment[]) : [],
    next_cursor: typeof r.next_cursor === 'string' && r.next_cursor.length > 0 ? r.next_cursor : null,
  };
}

/**
 * One page of a thread, newest first. Never rejects.
 *
 * An empty page and a failed request are deliberately indistinguishable to the
 * caller. Both mean "there is nothing more to show right now", both are
 * followed by the same pull-to-refresh, and a thread that renders an error
 * banner because a CDN hiccuped is worse than one that renders quietly.
 */
export async function fetchThread(
  args: ThreadTarget & { cursor?: string | null; limit?: number },
): Promise<ThreadPage> {
  try {
    const token = await readToken();
    const query = threadQuery(args, args.cursor ?? null, args.limit ?? THREAD_PAGE);
    return asPage(await api<unknown>(`/v1/comments?${query}`, { token }));
  } catch {
    // Offline, a timeout, a 400 from a target the server does not recognise,
    // an edge error page. The thread shows what it already has.
    return EMPTY;
  }
}

/**
 * The replies under one comment.
 *
 * A separate call on purpose: `reply_count` comes back on the top-level row,
 * but the replies themselves are only fetched when somebody expands them, so a
 * 200-reply argument never lands in one payload. The server ignores the target
 * params entirely when `parent_id` is present — a reply inherits its parent's
 * target — so none are sent.
 */
/**
 * ONE comment, by id — the permalink.
 *
 * `GET /v1/comments/:id` has existed on the server since the first cut and was
 * never called: a comment could only ever be read inside the thread it sits in,
 * so opening one on its own — the obvious gesture, and what a share link would
 * have to land on — had nowhere to go.
 *
 * Null rather than a throw for a comment that is gone, blocked, or written by a
 * deleted profile. All three are the same fact to the reader: it is not there.
 */
export async function fetchComment(id: string): Promise<Comment | null> {
  try {
    const token = await readToken();
    return await api<Comment>(`/v1/comments/${encodeURIComponent(id)}`, { token });
  } catch {
    return null;
  }
}

export async function fetchReplies(parentId: string, cursor?: string | null): Promise<ThreadPage> {
  try {
    const token = await readToken();
    const query = `parent_id=${encodeURIComponent(parentId)}${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
    }&limit=${THREAD_PAGE}`;
    return asPage(await api<unknown>(`/v1/comments?${query}`, { token }));
  } catch {
    return EMPTY;
  }
}

/**
 * Everything one person has written, newest first.
 *
 * The profile screen could print "2 comments" and had no way to show them —
 * `fetchThread` needs a target or a parent, and a profile is neither. For an
 * app whose first act is importing seven years of somebody's writing, a count
 * over an empty page is the wrong thing to have shipped.
 *
 * 403 for a private profile the viewer has not earned, and this returns the
 * empty page for it like every other failure: the screen above already knows
 * the profile is private and says so — repeating it as an error would be two
 * messages for one fact.
 */
export async function fetchProfileComments(handle: string, cursor?: string | null): Promise<ThreadPage> {
  try {
    const token = await readToken();
    const query = `limit=${THREAD_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    return asPage(await api<unknown>(`/v1/profiles/${encodeURIComponent(handle)}/comments?${query}`, { token }));
  } catch {
    return EMPTY;
  }
}

export type NewComment = {
  target: ThreadTarget;
  body: string;
  isSpoiler: boolean;
  /** Set for a reply. The target is then inherited from the parent, server-side. */
  parentId?: string | null;
};

/**
 * Post a comment or a reply. Resolves with the row as the thread will show it
 * — the server shapes POST and GET through the same function, so the optimistic
 * row can simply be replaced by this one rather than reconciled with it.
 *
 * `lang` is stamped from the app's CURRENT language, not guessed from the text
 * and not left to `Accept-Language`. The phone may be in English while the
 * person is writing Arabic, and the server explicitly refuses to guess.
 *
 * A reply sends no target at all. The server inherits the parent's, and ignores
 * anything sent alongside — a reply that landed on a different episode than the
 * comment it answers is a thread that can never be read back.
 */
export async function postComment(input: NewComment): Promise<Comment> {
  // WHETHER it was a reply and WHETHER it was marked a spoiler — both are
  // shape. The body, the show and the episode are content and stay out: a
  // comment's text is the user's writing, and its target is their watch
  // history. See the rule at the top of `analytics.ts`.
  const posted = await write((token) =>
    api<Comment>('/v1/comments', {
      method: 'POST',
      token,
      body: input.parentId
        ? {
            parent_id: input.parentId,
            body: input.body,
            is_spoiler: input.isSpoiler,
            lang: currentLocale(),
          }
        : {
            target_source: input.target.source,
            target_key: input.target.key,
            season: input.target.season ?? null,
            episode: input.target.episode ?? null,
            body: input.body,
            is_spoiler: input.isSpoiler,
            lang: currentLocale(),
          },
    }),
  );
  track('comment_post', {
    kind: input.parentId ? 'reply' : 'top_level',
    spoiler: input.isSpoiler ? 1 : 0,
  });
  return posted;
}

/**
 * Delete your own comment. 204, so nothing comes back.
 *
 * The server answers 403 for a comment that is not yours AND for one that does
 * not exist, on purpose — otherwise DELETE becomes an oracle for which ids are
 * real. The UI only ever offers this on your own rows, so a 403 here means the
 * row was already gone.
 */
export async function deleteComment(id: string): Promise<void> {
  await write((token) => api<void>(`/v1/comments/${encodeURIComponent(id)}`, { method: 'DELETE', token }));
  track('comment_delete');
}

/** What both like endpoints answer with: the authoritative count after the change. */
export type LikeResult = { liked: boolean; like_count: number };

export async function likeComment(id: string): Promise<LikeResult> {
  const res = await write((token) =>
    api<LikeResult>(`/v1/comments/${encodeURIComponent(id)}/like`, { method: 'POST', token }),
  );
  track('comment_like');
  return res;
}

export async function unlikeComment(id: string): Promise<LikeResult> {
  return write((token) =>
    api<LikeResult>(`/v1/comments/${encodeURIComponent(id)}/like`, { method: 'DELETE', token }),
  );
}

/**
 * File a report. The server answers 202 — FILED, NOT JUDGED — and the
 * confirmation the UI shows must say exactly that. The queue is a person.
 *
 * Reporting the same thing twice is also a 202 and is silently dropped, so the
 * UI never has to explain a duplicate to somebody doing the right thing.
 */
export async function reportComment(id: string, reason: ReportReason): Promise<void> {
  await report('comment', id, reason);
}

/**
 * Report a PROFILE. Same queue, same 202, same "filed, not judged" — the
 * server has taken `profile` as a target type since Step 3 and nothing in the
 * app had ever sent one, so a person could report a comment but not the
 * account posting them.
 */
export async function reportProfile(profileId: string, reason: ReportReason): Promise<void> {
  await report('profile', profileId, reason);
}

async function report(targetType: 'comment' | 'profile' | 'list', id: string, reason: ReportReason): Promise<void> {
  await write((token) =>
    api<void>('/v1/reports', {
      method: 'POST',
      token,
      body: { target_type: targetType, target_id: id, reason },
    }),
  );
}

/**
 * Block a profile. Both directions, immediately: they vanish from every thread
 * this account reads, and this account vanishes from theirs. Any follow edge
 * between the two is dropped in the same batch, both ways.
 *
 * The caller must refresh the thread afterwards — the rows are still on screen
 * until it does, and leaving them there is the one thing a block must not do.
 */
export async function blockProfile(profileId: string): Promise<void> {
  await write((token) => api<void>(`/v1/blocks/${encodeURIComponent(profileId)}`, { method: 'POST', token }));
}

/** Unblock. Does NOT restore the follows the block removed — re-following is a decision. */
export async function unblockProfile(profileId: string): Promise<void> {
  await write((token) =>
    api<void>(`/v1/blocks/${encodeURIComponent(profileId)}`, { method: 'DELETE', token }),
  );
}

/**
 * An avatar to render, or null for the letter placeholder.
 *
 * `avatar_key` is an R2 object key, and the R2 binding does not exist yet
 * (`backend/src/env.ts`: "avatars ship later, guarded everywhere it is
 * touched"). Until it does there is no base URL to join it to, and inventing
 * one would produce a screen full of broken images. A key that is already an
 * absolute URL is passed through, so the day avatars go live this function is
 * the only thing that changes.
 */
export function avatarUri(key: string | null | undefined): string | null {
  return typeof key === 'string' && /^https?:\/\//.test(key) ? key : null;
}
