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

export function setNotifyAsked(): void {
  notifyAsked = true;
  setMeta('notifyAsked', '1');
  notifySubs.forEach((s) => s());
}
