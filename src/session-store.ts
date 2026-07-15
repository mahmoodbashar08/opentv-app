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
