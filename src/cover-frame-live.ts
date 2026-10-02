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

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

/** The whole frame — for the banner image ONLY, which redraws on every move. */
export function useLiveCoverFrame(): CoverFrame | null {
  return useSyncExternalStore(subscribe, () => live);
}

/**
 * Only the live frame's size and background — for the PROFILE, which needs them
 * for the banner's height and the page behind it. A string, so a drag (x/y/zoom
 * only) does not re-render the whole profile on every move; resizing does,
 * because the page itself has to move.
 */
export function useLiveCoverShape(): string | null {
  return useSyncExternalStore(subscribe, () => (live == null ? null : `${live.size},${live.bg ? 1 : 0},${live.fade ? 1 : 0},${live.strength.toFixed(2)},${live.tint ?? ''}`));
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

/** The picture's width/height ratio, as the banner last drew it — the
 *  adjuster's drag maths needs it to move the picture with the finger. */
let liveRatio = 16 / 9;
export function setLiveCoverRatio(r: number): void {
  liveRatio = r;
}
export function liveCoverRatio(): number {
  return liveRatio;
}

/**
 * The theme changed while the profile was underneath something (the adjuster,
 * Theme colours). The tab only re-reads its theme on focus, which it never got,
 * so the new colours waited until the layer closed; this tells it at once.
 */
const themeSubs = new Set<() => void>();
export function profileThemeChanged(): void {
  themeSubs.forEach((s) => s());
}
/** Called when the theme changes; returns the unsubscribe, for an effect. */
export function onProfileThemeChanged(cb: () => void): () => void {
  themeSubs.add(cb);
  return () => {
    themeSubs.delete(cb);
  };
}
