/**
 * Which ways a library can come over from another phone — the pure half of
 * `app/moving.tsx`, kept apart so it can be tested without a renderer.
 *
 * FOUR ANSWERS, IN THE ORDER THEY COST THE LEAST:
 *
 *   icloud / drive   the platform's own copy. Same kind of phone only: iCloud
 *                    lands on an iPhone, a Drive backup on an Android. Free and
 *                    already made, so it comes first when it applies at all.
 *   file             Backup → Export on the old phone, send the file, Import
 *                    here. Any → any, free, needs the old phone in hand.
 *   server           OpenTV Backup. Any → any, Plus. After the file on purpose:
 *                    the server copy is the Plus answer because it costs
 *                    storage, and this screen exists so the free way is FOUND,
 *                    not sold past (CHANGELOG 2.0.0, item 6).
 *   fresh            no backup — start over. Only before onboarding; a phone
 *                    that already has a library has nothing to start.
 */
export type Phone = 'iphone' | 'android';
export type MovingPath = 'icloud' | 'drive' | 'file' | 'server' | 'fresh';

export function movingPaths(here: Phone, old: Phone, opts: { onboarded: boolean; icloud: boolean }): MovingPath[] {
  // `icloud: false` is a build without the iCloud module (Expo Go): the step
  // would only ever say "nothing found", which is not true, just unknowable.
  const own: MovingPath | null = here !== old ? null : here === 'android' ? 'drive' : opts.icloud ? 'icloud' : null;
  return [...(own ? [own] : []), 'file', 'server', ...(opts.onboarded ? [] : (['fresh'] as const))];
}
