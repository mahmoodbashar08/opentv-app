/**
 * Lists two people build together.
 *
 * THE ONE PART OF THIS APP WHERE THE SERVER HOLDS THE TRUTH, and it is worth
 * being blunt about that because everything else here works the other way. Your
 * library is on your phone; a shared list is not your library. Two people write
 * to it from two devices, so a local copy that thinks it is authoritative would
 * quietly overwrite whatever your friend added while you were on the train.
 *
 * WHICH MEANS THESE SCREENS FETCH, and that is allowed here for the same
 * reason: nothing on them is yours alone. No screen showing YOUR OWN shows,
 * films, history or stats gained a network dependency, and none may.
 *
 * READS THROW, like `community-profiles.ts` and unlike the comment feeds. A
 * shared list that fails silently is a list that looks empty, and "your friend
 * has added nothing" and "you are offline" are the two most different messages
 * this screen can send.
 */
import { ApiError, api } from '@/api';
import { getToken } from '@/community-session';

export type SharedListRow = {
  id: string;
  name: string;
  role: string;
  is_owner: boolean;
  members: number;
  items: number;
  last_activity: string | null;
  /**
   * Up to four posters, newest first — enough to draw the card and no more.
   *
   * The summary used to carry only `items`, a count, so every shelf drew a
   * shared list as a black rectangle with a name on it. Absent on an older
   * server, which is why it is optional and why every caller treats it as
   * possibly empty rather than assuming artwork exists.
   */
  posters?: string[];
};

export type SharedMember = {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_key: string | null;
  is_plus: boolean;
  role: string;
  is_me: boolean;
  /** How many of this list's items this person has ticked off. */
  watched: number;
};

export type SharedItem = {
  id: string;
  added_by: string | null;
  target_source: string;
  target_key: string;
  title: string | null;
  poster: string | null;
  created_at: string;
  watched_by: string[];
};

export type SharedListDetail = {
  id: string;
  name: string;
  is_owner: boolean;
  /** Null for everybody but the owner — the code lets a stranger in. */
  invite_code: string | null;
  /**
   * Whether the reader is IN this list.
   *
   * A visitor arriving from somebody's profile can read it and nothing more —
   * no adding, no ticking off, no invite code. Older servers do not send the
   * field; treating an absent value as `true` keeps every existing member's
   * screen exactly as it was.
   */
  is_member?: boolean;
  created_at: string;
  members: SharedMember[];
  items: SharedItem[];
};

async function token(): Promise<string> {
  const t = await getToken();
  if (!t) throw new ApiError('unauthenticated', 401, 'Not signed in.');
  return t;
}

export async function fetchSharedLists(): Promise<SharedListRow[]> {
  const r = await api<{ lists: SharedListRow[] }>('/v1/shared-lists', { token: await token() });
  return r.lists ?? [];
}

export async function fetchSharedList(id: string): Promise<SharedListDetail> {
  return api<SharedListDetail>(`/v1/shared-lists/${encodeURIComponent(id)}`, { token: await token() });
}

/**
 * Start one. Throws `plus_required` past the free allowance, which the caller
 * turns into the paywall rather than into an error alert — being told "no" and
 * being shown what it costs are different screens.
 */
export async function createSharedList(name: string): Promise<{ id: string; invite_code: string }> {
  return api<{ id: string; invite_code: string }>('/v1/shared-lists', {
    method: 'POST',
    token: await token(),
    body: { name },
  });
}

/** FREE, at every tier. See the note in `backend/src/routes/shared-lists.ts`. */
export async function joinSharedList(code: string): Promise<{ id: string; name: string; joined: boolean }> {
  return api<{ id: string; name: string; joined: boolean }>('/v1/shared-lists/join', {
    method: 'POST',
    token: await token(),
    // `invite_code`, which is what the route reads. Sending `code` meant the
    // server saw an absent field and answered "an invite code is required" —
    // so no code had ever worked, however carefully it was typed.
    body: { invite_code: code },
  });
}

export async function addSharedItem(
  listId: string,
  item: { source: 'tvdb' | 'movie'; key: string; title: string | null; poster: string | null },
): Promise<{ added: boolean }> {
  return api<{ added: boolean }>(`/v1/shared-lists/${encodeURIComponent(listId)}/items`, {
    method: 'POST',
    token: await token(),
    body: { target_source: item.source, target_key: item.key, title: item.title, poster: item.poster },
  });
}

export async function removeSharedItem(listId: string, itemId: string): Promise<void> {
  await api(`/v1/shared-lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
    token: await token(),
  });
}

export async function setSharedItemWatched(listId: string, itemId: string, watched: boolean): Promise<void> {
  await api(
    `/v1/shared-lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}/watched`,
    { method: watched ? 'POST' : 'DELETE', token: await token() },
  );
}

export async function renameSharedList(id: string, name: string): Promise<void> {
  await api(`/v1/shared-lists/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    token: await token(),
    body: { name },
  });
}

/** Kills every link already sent. The only way back from a forwarded invite. */
export async function rotateSharedInvite(id: string): Promise<string | null> {
  const r = await api<{ invite_code?: string }>(`/v1/shared-lists/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    token: await token(),
    body: { rotate_invite: true },
  });
  return r.invite_code ?? null;
}

/** The owner deletes; everybody else leaves. One call, because from the
 *  member's side both mean "this is off my screen now". */
export async function leaveOrDeleteSharedList(id: string): Promise<void> {
  await api(`/v1/shared-lists/${encodeURIComponent(id)}`, { method: 'DELETE', token: await token() });
}
