/**
 * OpenTV Plus — the entitlement, and the one gate every Plus feature calls.
 *
 * THE CONTRACT. Feature code asks two questions and nothing else:
 *
 *   isPlus()            — in event handlers and plain code
 *   usePlus()           — in render (Compiler-safe, see below)
 *   requirePlus('x')    — "let me through or show the paywall"; returns
 *                         whether to proceed
 *
 * The purchases module (RevenueCat) OWNS the answer: it calls
 * `setPlusEntitled` when the store says so, at launch, after a purchase and
 * after a restore. Everything else treats the entitlement as read-only. The
 * cached copy lives in the meta table so a bought app is Plus on a plane —
 * an entitlement that needs a network check to say yes would make the paid
 * tier less offline than the free one.
 *
 * REACT COMPILER: `isPlus()` in render is a render-time read of an external
 * store — the compiler will memoise it against its (empty) arguments and the
 * screen will not notice a purchase. `usePlus()` goes through
 * `useSyncExternalStore`, which the compiler understands, so a purchase
 * re-renders every subscribed screen the moment it lands. Handlers can use
 * either.
 */
import { router } from 'expo-router';
import { useSyncExternalStore } from 'react';

import { track } from '@/analytics';
import { getMeta, setMeta } from '@/db';

/** '1' when the store has said this person is Plus. Meta, so it survives offline.
 *  ALSO READ BY `theme.ts`, by the same literal, so that a custom accent stops
 *  being painted when the subscription ends. It cannot import this module: the
 *  accent is resolved at module load, long before anything here is configured. */
const PLUS_META_KEY = 'plusEntitled';

/**
 * WHETHER PLUS EXISTS IN THIS BUILD AT ALL.
 *
 * False until the tier can actually be bought — the Paid Applications
 * agreement, the store products and the RevenueCat keys are all outside this
 * repository, and a paywall that answers "not available" is worse than no
 * paywall. So 1.4.0 ships the paid features DARK: the code is here, the entry
 * points are not.
 *
 * They are hidden rather than unlocked on purpose. Shipping them free and
 * charging later takes something away from people who already had it, which is
 * the single most reliable way to make users angry — Trakt did exactly that
 * and it is still the top complaint about them.
 *
 * PER PLATFORM, because the stores are ready at different times. `purchases.ts`
 * picks its key by platform, so a build with only the iOS key filled in would
 * otherwise show every Plus entry point on Android and answer the paywall with
 * "not available" — on the platform that has most of the users. The flag has to
 * mean "can be bought HERE", not "exists somewhere".
 *
 * Flip a platform to true in the release where its products are live, and
 * nothing else needs to change.
 */
const PLUS_READY: Record<string, boolean> = {
  // The App Store products exist, priced and localised, and the Paid
  // Applications agreement is active — so the tier can be bought here and the
  // entry points are no longer hiding a screen nobody could reach.
  ios: true,
  // Play caught up on 28 Aug 2026: `opentv_plus` with both base plans active,
  // a service account RevenueCat can verify purchases with, and real-time
  // notifications connected. The Android key in `rc-keys.ts` is filled in, so
  // the paywall has products to show and a store that can take money.
  android: true,
};

/*
 * `process.env.EXPO_OS` AND NOT `Platform.OS`, which is the obvious way and
 * breaks the tests: this module is imported by code the unit suites reach, and
 * `jest.config.js` deliberately avoids the jest-expo preset, so a react-native
 * import here stops two suites from parsing at all. Expo substitutes EXPO_OS at
 * build time, so it costs no import. Undefined under Node, where the answer is
 * irrelevant.
 */
export const PLUS_AVAILABLE = PLUS_READY[process.env.EXPO_OS ?? ''] ?? false;

/**
 * Whether the one-time "Plus exists now" card has been seen.
 *
 * ONE-WAY, like `communityAsked` and for the same reason. A card that can
 * re-arm itself is a nag, and an advert that returns after being dismissed is
 * the thing people uninstall over. Stamped when it is SHOWN rather than when it
 * is answered, so a card killed by a swipe, a crash or the app being
 * backgrounded does not come back either.
 *
 * There is exactly one of these ever. Announcing the next feature is what a
 * release note is for.
 */
const PLUS_SEEN_KEY = 'plusAnnounced';

export function plusAnnouncementSeen(): boolean {
  return getMeta(PLUS_SEEN_KEY) === '1';
}

export function markPlusAnnounced(): void {
  setMeta(PLUS_SEEN_KEY, '1');
}

const listeners = new Set<() => void>();
/** Cached so getSnapshot is cheap and referentially stable between changes. */
let snapshot: boolean | null = null;

export function isPlus(): boolean {
  if (snapshot === null) snapshot = getMeta(PLUS_META_KEY) === '1';
  return snapshot;
}

/**
 * Called by the purchases module ONLY. Idempotent; notifies subscribers on
 * a real change so screens flip the moment a purchase or restore lands.
 */
export function setPlusEntitled(on: boolean): void {
  const was = isPlus();
  setMeta(PLUS_META_KEY, on ? '1' : '0');
  snapshot = on;
  if (was !== on) listeners.forEach((l) => l());
}

/** Render-safe subscription to the entitlement. */
export function usePlus(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    isPlus,
  );
}

/**
 * SHOULD THE PLUS SURFACES BE ON SCREEN AT ALL?
 *
 * `PLUS_AVAILABLE` hides the entry points while the tier cannot be bought, and
 * that is right for shipping and wrong for building: every paid screen -- the
 * themes, the layouts, Deep Stats, the advanced filter axes -- became
 * unreachable, so none of them could be looked at on a phone before release.
 * The door was shut behind the feature it guards.
 *
 * So: visible when the tier is buyable, OR when this device is already
 * entitled. That second half is safe in a release build for a reason worth
 * stating rather than trusting -- the entitlement is written by exactly two
 * callers, RevenueCat (which cannot grant anything while there is no product
 * to buy) and the developer switch in Settings (compiled out of release
 * builds). In a shipped 1.4.0 this is false for everybody, exactly as before.
 */
export function plusUiVisible(): boolean {
  return PLUS_AVAILABLE || isPlus();
}

/** Render-safe form. Same rule; goes through the store so a change re-renders. */
export function usePlusUi(): boolean {
  return PLUS_AVAILABLE || usePlus();
}

/**
 * The gate. `from` names the feature that asked — a control name, never
 * content, per the analytics rule — so the paywall knows what convinced
 * people and what never does.
 */
export function requirePlus(from: string): boolean {
  if (isPlus()) return true;
  // Nothing to offer: no paywall, no navigation, and the caller simply does
  // not proceed. Entry points are hidden in this build, so reaching here means
  // a deep link or a stale screen rather than a user who tapped something.
  if (!PLUS_AVAILABLE) return false;
  track('paywall_shown', { from });
  router.push(`/paywall?from=${encodeURIComponent(from)}`);
  return false;
}

/**
 * Publish caps — the free tier's only limits, and they are on the PROFILE,
 * never the device. Lists and favourites on the phone are unlimited forever;
 * what is capped is how many the free tier publishes to the public profile.
 * Anything already published when Plus shipped stays published (grandfathered
 * by the publisher, which caps NEW publishes only).
 *
 * ONE NUMBER, TWO NAMES. `pure.ts` has held these since the community shipped
 * — the publisher and both screens already read them — so they are re-exported
 * rather than restated. Two constants that must agree is a bug waiting for the
 * day somebody edits one.
 */
export {
  PROFILE_LIST_LIMIT as FREE_PUBLISHED_LISTS,
  PROFILE_FAVOURITE_LIMIT as FREE_PUBLISHED_FAVOURITES,
} from '@/pure';

/** What a free profile may publish, or no limit at all. */
export function publishCap(free: number): number {
  return isPlus() ? Infinity : free;
}
