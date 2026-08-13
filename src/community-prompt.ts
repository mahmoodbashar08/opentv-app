/**
 * Whether the app has offered the community yet, and what the user said.
 *
 * Three flags, all in `meta`, all one-way — nothing here is ever un-set by the
 * app. That is the point: an offer that can re-arm itself is a nag, and this
 * one is about an account, which is the last thing to pester anyone about.
 *
 *   communityAsked           — the join prompt has been SHOWN once. Stamped
 *                              when it appears, not when it is answered, so a
 *                              prompt killed by a swipe, a crash or the app
 *                              being backgrounded does not return.
 *   communityDeclined        — they tapped "Not now". Strictly stronger than
 *                              `asked`; kept separate because the Profile
 *                              banner's copy differs for someone who said no
 *                              and someone who was never asked.
 *   communityBannerDismissed — they closed the Profile banner. Then that is
 *                              the end of it; Settings → Account still has a
 *                              row, so joining stays reachable for good.
 *
 * Reactive via `useSyncExternalStore`, exactly like `session-store.ts`: the
 * Profile banner has to disappear the moment it is dismissed, and the decision
 * of whether to show it is read during render, not in an effect.
 */
import { router } from 'expo-router';
import { InteractionManager } from 'react-native';
import { useSyncExternalStore } from 'react';

import { maybePrefetchAggregates } from '@/community-prefetch';
import { pushDisplayName, syncDisplayName } from '@/community-profiles';
import { maybeReconcileFriends, seedEverything } from '@/community-seed';
import { getProfileId, getToken, isJoined, setHandle } from '@/community-session';
import { getMeta, libraryOwner, setMeta } from '@/db';
import { api } from '@/api';
import { logInPurchases } from '@/purchases';
import { registerForPush } from '@/push';
import { shouldShowJoinPrompt, suggestedHandle } from '@/pure';

const ASKED_KEY = 'communityAsked';
const DECLINED_KEY = 'communityDeclined';
const BANNER_KEY = 'communityBannerDismissed';

let asked = getMeta(ASKED_KEY) === '1';
let declined = getMeta(DECLINED_KEY) === '1';
let bannerDismissed = getMeta(BANNER_KEY) === '1';

const subs = new Set<() => void>();

function notify(): void {
  subs.forEach((s) => s());
}

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function communityAsked(): boolean {
  return asked;
}

export function communityDeclined(): boolean {
  return declined;
}

export function communityBannerDismissed(): boolean {
  return bannerDismissed;
}

/**
 * One snapshot object would be re-created on every read and break
 * `useSyncExternalStore`'s identity check (React would loop), so the three
 * flags are three separate hooks returning primitives.
 */
export function useCommunityAsked(): boolean {
  return useSyncExternalStore(subscribe, () => asked);
}

export function useCommunityDeclined(): boolean {
  return useSyncExternalStore(subscribe, () => declined);
}

export function useCommunityBannerDismissed(): boolean {
  return useSyncExternalStore(subscribe, () => bannerDismissed);
}

/** Stamped as the join prompt is presented. Idempotent. */
export function markCommunityAsked(): void {
  if (asked) return;
  asked = true;
  setMeta(ASKED_KEY, '1');
  notify();
}

/** "Not now". Also stamps `asked`, so declining can never leave it unset. */
export function markCommunityDeclined(): void {
  declined = true;
  asked = true;
  setMeta(DECLINED_KEY, '1');
  setMeta(ASKED_KEY, '1');
  notify();
}

/**
 * Re-read the three flags from `meta`, and tell the UI.
 *
 * The one caller is `community-account.ts`, after a successful account
 * deletion has cleared them. This module's flags are cached in module scope
 * because they are read during render, which means a write to `meta` from
 * outside is invisible until something re-reads — and someone who deleted
 * their account and later wants back in must be offered the door again rather
 * than having to find it in Settings.
 *
 * It is deliberately not a general "reset": it only reflects what `meta`
 * already says, so it cannot un-set a flag that is still stored.
 */
export function resetCommunityPromptCache(): void {
  asked = getMeta(ASKED_KEY) === '1';
  declined = getMeta(DECLINED_KEY) === '1';
  bannerDismissed = getMeta(BANNER_KEY) === '1';
  notify();
}

/** The X on the Profile banner. It does not come back. */
export function dismissCommunityBanner(): void {
  if (bannerDismissed) return;
  bannerDismissed = true;
  setMeta(BANNER_KEY, '1');
  notify();
}

/**
 * Show the join prompt if this is the one moment it is due, and return whether
 * it was shown.
 *
 * Called from two places, on purpose:
 *   - the end of an import, which is when the pitch actually lands ("find the
 *     friends you had on TV Time" means something to someone who has just
 *     watched their TV Time library arrive), and
 *   - the tab navigator mounting, which catches everyone who imported before
 *     this update ever existed.
 *
 * Calling it twice is harmless: `markCommunityAsked()` runs as the prompt is
 * presented, so the second call finds `asked` set and does nothing. That is
 * why the flag is stamped here rather than inside the screen — the guard and
 * the stamp have to be the same statement.
 */
/**
 * Where a successful join lands. Called from the join screen, and from the
 * handle screen for the accounts that had to pick one first.
 *
 * The seed OFFER is a screen because it is a decision — nothing is uploaded
 * until it is answered. Reconnection is not a decision and gets no screen: it
 * matches ids the user already holds and writes one notification on each side,
 * so when there is no archive to offer it simply runs, and the inbox is where
 * a match shows up.
 *
 * `replace`, not `push`: the join screen has done its job and must not sit
 * underneath, where a back gesture would offer to join an account that exists.
 */
/**
 * Take the TV Time name without asking, and only ask when it is gone.
 *
 * WHY NOT ASK. The name is already in the export the user imported — they typed
 * it years ago and have been using it ever since. Presenting it in a field and
 * requiring a tap to accept it is asking somebody to confirm their own name.
 * The screen exists for the case where it CANNOT simply be taken.
 *
 * FIRST COME, FIRST SERVED, which is what the database already enforces:
 * `handle_lower` is UNIQUE, so the second person importing an export with the
 * same name gets `handle_taken` and lands on the screen with it pre-filled.
 * That is the honest outcome — TV Time is shut down, so there is nothing left
 * to check a claim against, and whoever asks first is all anybody can know.
 *
 * SILENT ON EVERY FAILURE. A name with no usable ASCII form, no import at all,
 * an offline phone, a lost race — all of them mean "ask", and none of them is
 * worth an error message about a step the user did not know was happening.
 */
/**
 * IS THIS ACCOUNT STILL WEARING THE PLACEHOLDER?
 *
 * `user_p_…` is what the server names a profile at creation, meaning "no handle
 * chosen yet". Nobody is meant to keep one: it is not the name anybody knows
 * them by, and search matches handles, so a placeholder makes a person
 * unfindable by the people trying to find them.
 */
export function hasPlaceholderHandle(): boolean {
  return (getMeta('communityHandle') ?? '').startsWith('user_p_');
}

/**
 * THE RETRY, and why it has to exist.
 *
 * `claimImportedHandle` runs the moment an account is made — and for an email
 * sign-up that is BEFORE the address is confirmed, when `POST /v1/me/handle`
 * answers 403 `email_unverified`. The claim caught that and returned false, so
 * every email user was left on a placeholder. Apple and Google were unaffected,
 * being verified on arrival, which is why it survived testing.
 *
 * Nothing retried it, either: the claim only runs at sign-in, and since leaving
 * the community was removed there is no second sign-in to run it. So the wrong
 * name was permanent.
 *
 * Called on launch and after the email is confirmed. Cheap when there is
 * nothing to do — one string check, no request.
 */
export async function retryHandleClaim(): Promise<void> {
  if (!isJoined() || !hasPlaceholderHandle()) return;
  if (await claimImportedHandle()) return;
  /**
   * NO NAME COULD BE TAKEN — so ask, rather than leave them as `user_p_…`.
   *
   * Two ways to arrive here: the imported name is already somebody else's, or
   * there is no usable suggestion at all — which is every name written outside
   * the latin alphabet, since the slug rule reduces "محمود" to nothing.
   * Neither person can fix it themselves: nothing in Settings changes a handle,
   * and the screen that does is only reachable from a sign-in they can no
   * longer repeat.
   *
   * Deferred past the first interactions for the reason the confirm-email gate
   * documents: a push issued while the navigator is still settling its initial
   * route is made and then lost.
   */
  InteractionManager.runAfterInteractions(() => router.push('/handle'));
}

export async function claimImportedHandle(): Promise<boolean> {
  const wanted = suggestedHandle(getMeta('username'));
  if (!wanted) return false;
  try {
    const token = await getToken();
    await api('/v1/me/handle', { method: 'POST', body: { handle: wanted }, token });
    // The normalised form the server kept, which is what `wanted` already is —
    // `suggestedHandle` applies the same rules the server validates against.
    setHandle(wanted);
    // THE NAME AS WRITTEN, not the slug. `wanted` has been lowercased and had
    // its spaces turned into underscores to be a valid handle; the display name
    // has no such rules, so somebody imported as "Mahmood Bashar" gets
    // @mahmood_bashar and "Mahmood Bashar" underneath it, which is what TV Time
    // showed and what people recognise each other by.
    void pushDisplayName(getMeta('username'));
    return true;
  } catch {
    return false;
  }
}

export function afterJoin(): void {
  // THE CATCH-UP. Most people set a name — or had one imported — long before
  // the community existed, and it has never been sent. Pushing it the moment
  // an account appears is what stops the first hundred profiles arriving blank.
  void syncDisplayName();
  // ASKED HERE AND NOWHERE ELSE. iOS allows one permission prompt ever, so it
  // belongs at the moment the user has just chosen to be somewhere other people
  // can react to them — not on first launch, where the app is still a private
  // tracker and the question has no context. Silent on refusal: the in-app list
  // is where the notification actually lives.
  void registerForPush();
  // The archive uploads itself. Joining the community IS the consent — the join
  // screen says the community is where your comments and ratings go, and asking
  // a second time turns a decision the user already made into a chore. The
  // owner asked for this twice; the screen it replaces still exists at /seed,
  // reachable from Settings, for re-running it or watching it work.
  //
  // It runs in the background and reports nothing. Nothing about it can fail in
  // a way the user must act on: every request is idempotent, a partial run
  // resumes from its cursor next time, and the local library is never touched.
  // The archive first, THEN the percentages. Ordered rather than parallel
  // because the user's own votes are part of the numbers they are about to be
  // shown, and sweeping before the upload lands would cache a set of aggregates
  // that is missing them — for a whole day, thanks to the sweep window.
  void seedEverything().then(() => maybePrefetchAggregates());
  void maybeReconcileFriends();
  // Name this device's buyer to RevenueCat. Purchases work anonymously — the
  // whole paid tier does — but the server-side half (badge, lifted caps) can
  // only follow a purchase it can map to a profile, and a device that joined
  // after launch is still anonymous over there until this call.
  const profileId = getProfileId();
  if (profileId) logInPurchases(profileId);
  router.back();
}

export function offerCommunityIfDue(): boolean {
  const due = shouldShowJoinPrompt({
    hasImported: libraryOwner() === 'imported',
    joined: isJoined(),
    asked,
    declined,
  });
  if (!due) return false;
  markCommunityAsked();
  router.push('/join');
  return true;
}
