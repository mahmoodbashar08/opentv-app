/**
 * Getting a face and a banner onto the profile other people see.
 *
 * WHAT WAS WRONG. `edit-profile.tsx` wrote the avatar and the cover into local
 * `meta` and stopped there. Every server route already selected `avatar_key` and
 * every screen already knew how to draw it — but nothing on the phone had ever
 * written one, so a visitor got the letter placeholder and a bare header, and
 * the owner, looking at their own tab, could not see that anything was missing.
 *
 * THE TWO ARE NOT THE SAME KIND OF THING, and this file is the place that
 * difference shows up:
 *
 *  - the COVER is a URL. `cover-picker.tsx` offers the backdrops of shows and
 *    films already in the library, from TheTVDB and TMDB, and keeps the original
 *    address in `coverUrl`. Publishing it is sending that string. Nothing is
 *    uploaded, nothing is stored, and the server's allow-list means it can only
 *    ever be a catalogue image.
 *  - the AVATAR is a photograph out of the camera roll. It is a real upload of a
 *    real arbitrary image, served to everybody. See `backend/src/routes/avatars.ts`
 *    for what that costs and what still has to be built around it.
 *
 * FINGERPRINTED, like every other sync here. This runs on launch and on every
 * return from the background, and the overwhelmingly common case is that nothing
 * changed — which must cost zero requests.
 *
 * NOTHING HERE THROWS. A profile picture that arrives on the next launch is a
 * cosmetic delay; an error a user cannot act on is not.
 */
import { ApiError, api, apiUpload } from '@/api';
import { getToken, isJoined } from '@/community-session';
import { getMeta, setMeta } from '@/db';
import { documentFileUri } from '@/library';

const COVER_SENT_KEY = 'communityCoverSent';
const AVATAR_SENT_KEY = 'communityAvatarSent';

/** Cleared with the rest of the community's state on sign-out. */
export const APPEARANCE_META_KEYS = [COVER_SENT_KEY, AVATAR_SENT_KEY] as const;

/**
 * The cover, if it is not already the one the server has.
 *
 * An address the server refuses (400) is stamped as sent anyway: the picker can
 * only produce catalogue URLs, so a refusal means this phone holds something the
 * server will never take, and retrying it on every launch forever is the one
 * outcome worse than not having a cover.
 */
async function pushCover(token: string): Promise<void> {
  const url = getMeta('coverUrl');
  const sent = getMeta(COVER_SENT_KEY);
  if ((url ?? '') === (sent ?? '')) return;

  try {
    await api('/v1/me', { method: 'PATCH', token, body: { cover_url: url && url.length > 0 ? url : null } });
    setMeta(COVER_SENT_KEY, url ?? '');
  } catch (e) {
    if (e instanceof ApiError && e.code === 'invalid_body') setMeta(COVER_SENT_KEY, url ?? '');
  }
}

/**
 * The avatar, if the file behind it has changed.
 *
 * The stamp is the FILENAME, which `pickPhoto` makes unique per change — the
 * bytes are not hashed. Hashing a photograph on every launch to discover that
 * it is the same photograph is exactly the work a fingerprint exists to avoid.
 */
async function pushAvatar(token: string): Promise<void> {
  const file = getMeta('avatarFile');
  const sent = getMeta(AVATAR_SENT_KEY);
  if ((file ?? '') === (sent ?? '')) return;

  // Removed locally: take it off the server too, rather than leaving a face the
  // owner believes they have deleted.
  if (!file) {
    try {
      await api('/v1/me/avatar', { method: 'DELETE', token });
      setMeta(AVATAR_SENT_KEY, '');
    } catch {
      /* next launch */
    }
    return;
  }

  const uri = documentFileUri(file);
  // The meta key names a file that is no longer on disk. Nothing to send, and
  // nothing to be done about it — stamp it so it is not retried forever.
  if (!uri) {
    setMeta(AVATAR_SENT_KEY, file);
    return;
  }

  const form = new FormData();
  // The React Native `{ uri, name, type }` file shim — the same one the comment
  // image upload uses. A `File`/`Blob` built from a `file://` uri is not
  // supported by this runtime.
  form.append('image', { uri, name: file, type: mimeOf(file) } as unknown as Blob);

  try {
    await apiUpload<{ ok: boolean }>('/v1/me/avatar', form, token);
    setMeta(AVATAR_SENT_KEY, file);
  } catch (e) {
    // A photo the server will never accept — too big, or a type outside the
    // allow-list. Stamped, for the same reason the cover is.
    if (e instanceof ApiError && ['too_large', 'unsupported_type', 'invalid_body'].includes(e.code)) {
      setMeta(AVATAR_SENT_KEY, file);
    }
  }
}

function mimeOf(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

/** Both, in order, never awaited by anything a user is looking at. */
export async function syncAppearanceIfNeeded(): Promise<void> {
  if (!isJoined()) return;
  let token: string | null = null;
  try {
    token = await getToken();
  } catch {
    token = null;
  }
  if (!token) return;

  try {
    await pushCover(token);
  } catch {
    /* never fatal to the avatar */
  }
  try {
    await pushAvatar(token);
  } catch {
    /* next launch */
  }
}
