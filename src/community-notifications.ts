/**
 * The inbox: who followed you, who liked what you wrote, who replied.
 *
 * The server has recorded these since the first cut and nothing on the phone
 * ever asked for them — there was no client for `/v1/notifications` at all. The
 * events were real and invisible.
 *
 * READS ONLY. Every notification is written by the handler that caused it, in
 * the same batch as the follow or the like. There is nothing here that creates
 * one, and nothing that should.
 *
 * The empty page on failure is the same trade the rest of the community client
 * makes: the bell also holds the TV Time archive, which is on this device and
 * always works, and a network error must not take that down with it.
 */
import { api } from '@/api';
import { getToken } from '@/community-session';

/** The kinds the server writes. `friend_found` comes from archive reconcile. */
export type NotificationKind =
  | 'follow'
  /** Somebody asked to follow a private account. Not a follow — nothing has
   *  been granted, and the row is an invitation to go and decide. */
  | 'follow_request'
  | 'like'
  | 'reply'
  | 'comment'
  | 'friend_found'
  | 'profile';

export type NotificationActor = {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_key: string | null;
};

export type Notification = {
  id: string;
  kind: string;
  /** Null when the actor deleted their account — `actor_id` is ON DELETE SET
   *  NULL, so the event outlives them and reads as "someone". */
  actor: NotificationActor | null;
  subject_type: string | null;
  subject_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationPage = { items: Notification[]; next_cursor: string | null };

const EMPTY: NotificationPage = { items: [], next_cursor: null };

function asPage(raw: unknown): NotificationPage {
  const o = (raw ?? {}) as { items?: unknown; next_cursor?: unknown };
  return {
    items: Array.isArray(o.items) ? (o.items as Notification[]) : [],
    next_cursor: typeof o.next_cursor === 'string' ? o.next_cursor : null,
  };
}

export async function fetchNotifications(cursor?: string | null): Promise<NotificationPage> {
  try {
    const token = await getToken();
    if (token == null) return EMPTY;
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return asPage(await api<unknown>(`/v1/notifications${query}`, { token }));
  } catch {
    return EMPTY;
  }
}

/**
 * Mark everything up to and including `upTo` as read.
 *
 * A WATERMARK, not a list of ids — the server's word for it. One request clears
 * the lot however many rows are behind it, and the timestamp to send is the
 * newest row on screen.
 */
export async function markNotificationsRead(upTo: string): Promise<void> {
  try {
    const token = await getToken();
    if (token == null) return;
    await api('/v1/notifications/read', { method: 'POST', body: { up_to: upTo }, token });
  } catch {
    // Unread is the safe direction to fail in: the row is still there and the
    // next open tries again.
  }
}

/** How many of a page are unread — what a badge would count. */
export function unreadCount(items: readonly Notification[]): number {
  return items.filter((n) => n.read_at == null).length;
}
