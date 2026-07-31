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
