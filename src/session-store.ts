import { router } from 'expo-router';
import { useSyncExternalStore } from 'react';

import { getMeta, setMeta } from '@/db';

/** Reactive onboarding flag — backs the protected routes in the root layout. */
let onboarded = getMeta('onboarded') === '1';
const subs = new Set<() => void>();

export function useOnboarded(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => onboarded,
  );
}

export function isOnboarded(): boolean {
  return onboarded;
}

export function setOnboarded(value: boolean): void {
  onboarded = value;
  setMeta('onboarded', value ? '1' : '');
  subs.forEach((s) => s());
}

/** Reactive twin of `onboarded` for the one-time notification ask.
 *
 *  It has to be reactive for the same reason: the root layout only registers
 *  the tab navigator once the ask is answered, so answering it must re-render
 *  the layout. A plain `getMeta` read would leave the app on a screen that has
 *  just replaced itself with a route that does not exist yet. */
let notifyAsked = getMeta('notifyAsked') === '1';
const notifySubs = new Set<() => void>();

export function useNotifyAsked(): boolean {
  return useSyncExternalStore(
    (cb) => {
      notifySubs.add(cb);
      return () => notifySubs.delete(cb);
    },
    () => notifyAsked,
  );
}

/** Where to go when onboarding finishes: the one-time notification ask if it
 *  is still pending, otherwise straight into the app. Kept here so all four
 *  paths out of onboarding (import summary x2, Start Fresh, profile setup)
 *  agree without each having to know the rule. */
export function postOnboardingRoute(): '/notify-optin' | '/movies' {
  return notifyAsked ? '/movies' : '/notify-optin';
}

/**
 * LEAVE ONBOARDING — flip the flag, then go, in that order and NOT in the same
 * tick.
 *
 * Every route past onboarding lives inside a `<Stack.Protected>` whose guard is
 * computed from `onboarded`, so the destination DOES NOT EXIST YET at the
 * moment the flag flips: `setOnboarded` notifies its subscribers, but the root
 * layout has not re-rendered, so `/notify-optin` is still unregistered and a
 * `router.replace` to it is dropped on the floor. The user was left wherever
 * the guards happened to land them — which is why pressing LET'S GO appeared
 * to do nothing, and why the screen it should have shown turned up on the next
 * launch instead, when the flag was already true at module load.
 *
 * One frame is all it needs. The same deferral, for the same reason, is why
 * `(tabs)/_layout` waits before offering the community.
 *
 * Four call sites did this by hand — the import summary, "already on this
 * device", Start Fresh and profile setup — so the fix belongs here rather than
 * in the one that was noticed.
 */
export function leaveOnboarding(then?: (route: '/notify-optin' | '/movies') => void): void {
  setOnboarded(true);
  const next = postOnboardingRoute();
  requestAnimationFrame(() => {
    router.replace(next);
    then?.(next);
  });
}

export function setNotifyAsked(): void {
  notifyAsked = true;
  setMeta('notifyAsked', '1');
  notifySubs.forEach((s) => s());
}
