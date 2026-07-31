/**
 * Leaving the community — the two ways out, and the line neither of them
 * crosses.
 *
 * THE LINE. Neither function in this file touches the local library. Not a
 * show, not a watch, not a rating, not an imported comment, not the preserved
 * ZIP. The only local state either of them writes is the `meta` allow-list in
 * `pure.ts` (`metaKeysClearedOnAccountDeletion`), every entry of which starts
 * with `community`, and `account.test.ts` fails if that ever stops being true.
 * That is not decoration: the whole product rests on the sentence "your
 * library stays on this phone", and a sentence like that is only worth
 * printing if something in the build enforces it.
 *
 * TWO DOORS, NOT ONE.
 *
 *   leaveCommunity()          — sign out here. No server call at all. The
 *                               account, the profile, the comments and the
 *                               follows all remain; signing in again returns
 *                               to exactly the same identity. This is the door
 *                               for "not on this phone" and for "not right
 *                               now".
 *
 *   deleteCommunityAccount()  — DELETE /v1/me. The identity rows go, so a
 *                               later sign-in creates a NEW profile; the
 *                               comments, likes, ratings, follows, blocks,
 *                               lists and notifications are deleted; the
 *                               profile row is scrubbed to a shell that
 *                               carries no personal data and is purged later.
 *                               This is Apple 5.1.1(v), and it is also just
 *                               the right thing to offer.
 *
 * THE ORDER MATTERS IN THE DELETE PATH. The server call goes first and its
 * failure is fatal to the whole operation. Signing out on a failed delete
 * would be the cruellest possible outcome: the account still exists, the
 * comments are still published, and the user has just been told it is gone and
 * no longer holds a token to try again with. So on any error we keep the
 * session exactly as it was and report the truth.
 */
import { ApiError, api } from '@/api';
import { resetCommunityPromptCache } from '@/community-prompt';
import { getToken, signOutLocally } from '@/community-session';
import { setMeta } from '@/db';
import { metaKeysClearedOnAccountDeletion } from '@/pure';

/**
 * Leave on this device. The account is untouched — this is `signOutLocally()`
 * and deliberately nothing more, wrapped only so the screen has one name for
 * the action and so this file documents both exits side by side.
 */
export async function leaveCommunity(): Promise<void> {
  await signOutLocally();
}

/**
 * Clear the community's `meta` flags.
 *
 * Only after a successful deletion, and only these keys. The join prompt is
 * one-way by design (`community-prompt.ts`), which is right for "not now" and
 * wrong for "I deleted my account and later changed my mind" — so a deletion
 * is the single event that re-arms it.
 *
 * `setMeta(k, '')` rather than a DELETE, because every reader in the app
 * compares against `'1'` or falls back on empty, and the writes therefore go
 * through the same path the rest of the app uses.
 */
function clearCommunityMeta(): void {
  for (const key of metaKeysClearedOnAccountDeletion()) setMeta(key, '');
  // The prompt module caches its three flags in module scope for render-time
  // reads, so the meta write above is invisible to it until it re-reads.
  resetCommunityPromptCache();
}

/**
 * Delete the community account, then sign out here.
 *
 * Throws `ApiError` — always `ApiError`, the same as every other call in the
 * app — and on any throw the local session is left intact. The caller shows
 * `communityErrorKey(e.code)` and the user is exactly where they started,
 * still able to try again.
 */
export async function deleteCommunityAccount(): Promise<void> {
  const token = await getToken();
  // No token is not "already deleted" — the account is alive on the server and
  // this device simply cannot prove who it is (a restored backup, a wiped
  // Keychain). Saying so is better than a silent local sign-out dressed up as
  // a deletion.
  if (!token) throw new ApiError('unauthenticated', 401, 'no stored session token');

  // 204, no body. `api()` resolves it as undefined; a failure throws.
  await api<void>('/v1/me', { method: 'DELETE', token });

  await signOutLocally();
  clearCommunityMeta();
}
