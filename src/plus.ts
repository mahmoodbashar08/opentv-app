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

/** '1' when the store has said this person is Plus. Meta, so it survives offline. */
const PLUS_META_KEY = 'plusEntitled';

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
 * The gate. `from` names the feature that asked — a control name, never
 * content, per the analytics rule — so the paywall knows what convinced
 * people and what never does.
 */
export function requirePlus(from: string): boolean {
  if (isPlus()) return true;
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
