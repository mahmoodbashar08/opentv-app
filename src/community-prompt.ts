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
import { useSyncExternalStore } from 'react';

import { countSeedableComments, maybeReconcileFriends } from '@/community-seed';
import { isJoined } from '@/community-session';
import { getMeta, libraryOwner, setMeta } from '@/db';
import { shouldShowJoinPrompt } from '@/pure';

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
export function afterJoin(): void {
  if (countSeedableComments() > 0) {
    router.replace('/seed');
    return;
  }
  void maybeReconcileFriends();
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
