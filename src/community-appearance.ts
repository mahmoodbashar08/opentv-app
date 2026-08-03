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
import { File, Paths } from 'expo-file-system';

import { ApiError, api, apiUploadBytes } from '@/api';
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
/**
 * The hosts the server will take as a cover address. Restated here so the phone
 * can tell, WITHOUT a round trip, whether it holds something publishable — and
 * so a refusal is a bug rather than the normal path.
 */
const COVER_HOSTS = ['artworks.thetvdb.com', 'image.tmdb.org'];

function publishableCoverUrl(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^https:\/\/([^/]+)\//.exec(raw.trim());
  return m && COVER_HOSTS.includes(m[1]) ? raw.trim() : null;
}

/**
 * THE STAMP IS AN OPTIMISATION. THE SERVER IS THE TRUTH.
 *
 * A stamp can say "sent" for something that never arrived — a request that was
 * answered and then rolled back, a stamp written by the give-up branch below, a
 * database restored from a backup taken after a send that a later reinstall
 * undid. Whatever the cause, the result is identical and permanent: the phone
 * holds a picture, the server holds nothing, and the phone will never try
 * again because it believes it already did. That is exactly the state this
 * profile was stuck in, and no amount of relaunching could leave it.
 *
 * So when the stamp says there is nothing to do AND the phone actually holds a
 * picture, ask. One cheap authenticated GET, only in the suspicious case —
 * never on the common path where the stamp and the library agree that nothing
 * has changed.
 */
async function serverIsMissing(kind: 'cover' | 'avatar', token: string, want: string): Promise<boolean> {
  if (want === '') return false;
  try {
    const me = await api<{ cover_url?: string | null; avatar_key?: string | null }>('/v1/me', { token });
    return (kind === 'cover' ? me?.cover_url : me?.avatar_key) == null;
  } catch {
    // Cannot tell: trust the stamp rather than re-uploading on every launch.
    return false;
  }
}

async function pushCover(token: string): Promise<void> {
  const raw = getMeta('coverUrl');
  const url = publishableCoverUrl(raw);
  const file = getMeta('coverFile');
  // The stamp records WHAT was sent, so a cover that changes form — address
  // today, uploaded file tomorrow — is not mistaken for one already up.
  const want = url ?? (file ? `file:${file}` : '');
  if (want === (getMeta(COVER_SENT_KEY) ?? '') && !(await serverIsMissing('cover', token, want))) return;

  // NOTHING AT ALL: the cover was removed. Clear it rather than leaving a band
  // the owner believes they took down.
  if (want === '') {
    try {
      await api('/v1/me', { method: 'PATCH', token, body: { cover_url: null } });
      setMeta(COVER_SENT_KEY, '');
    } catch {
      /* next launch */
    }
    return;
  }

  // THE CHEAP PATH, and the one the picker produces: an address on a catalogue
  // CDN. Nothing is uploaded and nothing is stored.
  if (url) {
    try {
      await api('/v1/me', { method: 'PATCH', token, body: { cover_url: url } });
      setMeta(COVER_SENT_KEY, want);
      return;
    } catch (e) {
      // Fall through to the upload rather than giving up: the address being
      // unusable is exactly the case the upload exists for.
      if (!(e instanceof ApiError && e.code === 'invalid_body')) return;
    }
  }

  // THE FILE. Reached when the phone has a banner it cannot name: a TV Time
  // import whose CloudFront address died with the service, or a reinstall that
  // restored the image and lost the address. The owner is looking at a cover
  // that works; refusing to publish it because of a missing string would be the
  // app arguing with what is on the screen.
  if (!file) return;
  const uri = documentFileUri(file);
  if (!uri) {
    setMeta(COVER_SENT_KEY, want);
    return;
  }

  try {
    await uploadImage('/v1/me/cover', file, token);
    setMeta(COVER_SENT_KEY, want);
  } catch (e) {
    if (e instanceof ApiError && ['too_large', 'unsupported_type', 'invalid_body'].includes(e.code)) {
      setMeta(COVER_SENT_KEY, want);
    }
  }
}

/**
 * Read a file out of Documents and post its bytes.
 *
 * `File.bytes()` rather than a `FormData` shim — see `apiUploadBytes`. It also
 * means a missing or unreadable file throws HERE, where it is one `catch` away
 * from being retried, instead of disappearing into a native multipart encoder.
 */
async function uploadImage(path: string, name: string, token: string): Promise<void> {
  const bytes = await new File(Paths.document, name).bytes();
  await apiUploadBytes<{ ok: boolean }>(path, bytes, mimeOf(name), token);
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
  // Same self-healing check as the cover — see `serverIsMissing`.
  if ((file ?? '') === (sent ?? '') && !(await serverIsMissing('avatar', token, file ?? ''))) return;

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

  try {
    await uploadImage('/v1/me/avatar', file, token);
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

/**
 * A picture changed — get it up now rather than on the next launch.
 *
 * The same shape as `listsChanged()`, and here for the same reason: writing to
 * local meta and waiting for a foreground cycle means the owner sees their new
 * banner immediately and nobody else does, with nothing on screen to explain
 * the gap.
 */
export function appearanceChanged(): void {
  void syncAppearanceIfNeeded();
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
