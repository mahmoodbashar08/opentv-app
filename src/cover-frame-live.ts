/**
 * The banner frame WHILE IT IS BEING ADJUSTED. The adjuster is a see-through
 * layer over the real profile, and this is how the profile under it follows the
 * finger: the adjuster writes here, the Profile tab draws whatever is here in
 * place of the saved frame. Null when nobody is adjusting.
 */
import { useSyncExternalStore } from 'react';

import type { CoverFrame } from '@/pure';

let live: CoverFrame | null = null;
const subs = new Set<() => void>();

export function setLiveCoverFrame(f: CoverFrame | null): void {
  live = f;
  subs.forEach((s) => s());
}

export function useLiveCoverFrame(): CoverFrame | null {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => live,
  );
}

/**
 * Open the adjuster OVER THE PROFILE: Edit profile and the picker are closed
 * first, or the see-through layer would show them instead of the banner. The
 * push waits for the dismissal to land; issued at once, it is lost.
 */
export function openCoverAdjust(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { router } = require('expo-router') as typeof import('expo-router');
  router.dismissAll();
  setTimeout(() => router.push('/cover-adjust'), 400);
}
