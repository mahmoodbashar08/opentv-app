/**
 * The inbox.
 *
 * NOTHING HERE WRITES A NOTIFICATION, on either side of the wire. Every row was
 * written by the handler that caused it — a reply, a like, a follow, a friend
 * reconnection — in the same batch as the thing itself, never by a job. This
 * module reads them back and marks them read, and that is all it does.
 *
 * READS NEVER THROW. The inbox is a screen the user opened out of curiosity;
 * a failed page is an empty page and a pull-to-refresh, not an error banner.
 * That is the same contract `community-comments.ts` gives a thread, and for the
 * same reason: neither screen has anything the user can act on when it fails.
 *
 * THE BADGE IS CACHED IN `meta`, synchronously readable, because the Profile
 * tab renders the bell during the first frame and cannot await a round trip to
 * decide whether to draw a dot. The cached number is a claim about a screen,
 * never a claim about the database: it is refreshed from `GET /v1/me` whenever
 * the tab regains focus, and set to zero the moment the inbox is opened, which
 * is exactly when the watermark below makes that true on the server too.
 */
import { ApiError, api } from '@/api';
import { getToken, isJoined, signOutLocally } from '@/community-session';
import { getMeta, setMeta } from '@/db';

/** The actor block, or null — see `Notification.actor`. */
export type NotificationActor = {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_key: string | null;
};

/**
 * One notification, field for field from `shape` in
 * `backend/src/routes/notifications.ts`.
 *
 * `kind` is typed as a bare string ON PURPOSE, not as the `NotificationKind`
 * union. A server that grows a sixth kind must not make this client's parse
 * lie about what arrived; `notificationText` in pure.ts takes the string and
 * maps an unrecognised one to a safe fallback sentence.
 *
 * `actor` is null when the account that caused this has since been deleted —
 * `actor_id` is `ON DELETE SET NULL`, so the notification outlives its actor.
 * The row still renders, because the like really did happen.
 *
 * For `reply` and `like`, `subject_id` is a COMMENT id. See the note on
 * navigation in `app/notifications.tsx`: there is no endpoint that turns one
 * back into a thread.
 */
export type Notification = {
  id: string;
  kind: string;
  actor: NotificationActor | null;
  subject_type: string | null;
  subject_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationPage = { items: Notification[]; next_cursor: string | null };

const EMPTY: NotificationPage = { items: [], next_cursor: null };

/** The cached unread count. Namespaced like every other community meta key. */
const UNREAD_KEY = 'communityUnread';

/** Anything that is not a well-formed page reads as an empty one. */
function asPage(res: unknown): NotificationPage {
  if (!res || typeof res !== 'object') return EMPTY;
  const r = res as { items?: unknown; next_cursor?: unknown };
  return {
    items: Array.isArray(r.items) ? (r.items as Notification[]) : [],
    next_cursor: typeof r.next_cursor === 'string' && r.next_cursor.length > 0 ? r.next_cursor : null,
  };
}

/**
 * The token, or null. The inbox is authenticated — unlike a thread there is no
 * anonymous reading of somebody's notifications — so a missing token is simply
 * an empty inbox rather than an error to surface.
 */
async function token(): Promise<string | null> {
  if (!isJoined()) return null;
  try {
    return await getToken();
  } catch {
    return null;
  }
}

/** A dead session, cleared once. The token cannot start working again. */
function noteDeadSession(e: unknown): void {
  if (e instanceof ApiError && e.needsSignIn) void signOutLocally();
}

/**
 * One page, newest first. Never rejects; a failure is an empty page.
 *
 * The cursor is opaque — `base64url(created_at|id)`, made by the server and
 * parsed by the server. The pair is the sort key because a friend reconcile
 * writes a burst of rows inside one second and a timestamp alone is not a total
 * order over them.
 */
export async function fetchNotifications(cursor?: string | null): Promise<NotificationPage> {
  const auth = await token();
  if (!auth) return EMPTY;
  try {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return asPage(await api<unknown>(`/v1/notifications${query}`, { token: auth }));
  } catch (e) {
    noteDeadSession(e);
    return EMPTY;
  }
}

/**
 * Mark everything up to and including `upTo` as read — a WATERMARK, not a list
 * of ids, so the badge clears in ONE request no matter how many rows sit behind
 * it. `upTo` is the `created_at` of the newest row the client has seen; the
 * server's comparison is `<=`, so passing that exact timestamp does include it.
 *
 * Resolves with how many rows changed, or 0 when the call failed. Never
 * rejects: the user did not ask for this request — it is the side effect of
 * opening a screen — and there is nothing for them to do about a failure
 * except open the screen again, which retries it.
 *
 * The local badge is zeroed regardless. The alternative is a screen the user is
 * looking at, showing rows they have plainly read, under a red dot that will
 * not go away; the next `GET /v1/me` corrects it if the server disagreed.
 */
export async function markRead(upTo: string): Promise<number> {
  setUnreadCount(0);
  const auth = await token();
  if (!auth) return 0;
  try {
    const res = await api<{ marked?: number }>('/v1/notifications/read', {
      method: 'POST',
      token: auth,
      body: { up_to: upTo },
    });
    return typeof res?.marked === 'number' ? res.marked : 0;
  } catch (e) {
    noteDeadSession(e);
    return 0;
  }
}

/** The cached unread count, synchronously, for rendering the badge. */
export function readUnreadCount(): number {
  const raw = getMeta(UNREAD_KEY);
  const n = raw === null ? 0 : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Write the cache. Clamped at zero — a negative badge is not a thing. */
export function setUnreadCount(n: number): void {
  try {
    setMeta(UNREAD_KEY, String(Number.isFinite(n) && n > 0 ? Math.floor(n) : 0));
  } catch {
    // A cache that cannot be written is a stale badge, not a failure.
  }
}

/**
 * Refresh the badge from `GET /v1/me`, which carries `unread_notifications`
 * alongside the profile.
 *
 * ONE ENDPOINT, NOT A COUNT ENDPOINT: the server deliberately publishes no
 * `/notifications/count`, because the same query that authenticates you can
 * carry the number for free. Resolves with the new count, or null when nothing
 * was learned (not joined, offline, dead token) — null means "leave whatever
 * the badge is showing alone" rather than "zero".
 */
export async function refreshUnreadCount(): Promise<number | null> {
  const auth = await token();
  if (!auth) return null;
  try {
    const me = await api<{ unread_notifications?: number }>('/v1/me', { token: auth });
    const n = typeof me?.unread_notifications === 'number' ? me.unread_notifications : 0;
    setUnreadCount(n);
    return n;
  } catch (e) {
    noteDeadSession(e);
    return null;
  }
}
