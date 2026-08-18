import { File, Paths } from 'expo-file-system';

import { getMeta, libraryOwner } from '@/db';

/**
 * True while the app runs on the bundled (developer's) seed data. Fresh and
 * imported libraries must never see seed-only content: profile photos,
 * comments, lists, favorites, badges artwork, social names.
 */
export const isSeedLibrary = (): boolean => libraryOwner() === 'seed';

/**
 * Avatar/cover downloaded during import (the importer saves them into the
 * app's documents before TV Time's CDN goes dark). Only the filename is
 * persisted — iOS moves the container path across app updates.
 */
export function profileImageUri(kind: 'avatar' | 'cover'): string | null {
  return documentFileUri(getMeta(`${kind}File`));
}

/**
 * The banner as it should currently be SEEN, which is not always the file that
 * is stored.
 *
 * A MOVING BANNER IS PLUS, so it stops moving when Plus stops — and the still
 * cover it replaced is kept beside it (`coverStillFile`) rather than deleted,
 * so a lapse is a fallback and not a loss. Subscribe again and the GIF returns.
 *
 * ONE FUNCTION, BECAUSE THIS RULE WAS WRITTEN TWICE AND ONLY ONE COPY KNEW
 * ABOUT PLUS. The profile fell back correctly while Edit Profile read the
 * stored file directly, so a lapsed subscriber saw artwork on their profile and
 * their old GIF the moment they opened the editor — the app disagreeing with
 * itself about what their banner is.
 *
 * `plus` is passed in rather than read here: callers subscribe with `usePlus()`
 * so the banner flips the moment a purchase or a lapse lands, and a value read
 * inside this function would not re-render anybody.
 */
export function visibleCoverUri(plus: boolean): string | null {
  if (plus) return profileImageUri('cover');
  const stored = getMeta('coverFile');
  const isGif = stored != null && stored.toLowerCase().endsWith('.gif');
  return documentFileUri(getMeta('coverStillFile')) ?? (isGif ? null : profileImageUri('cover'));
}

/** uri for a file saved in the app's documents (imported photos), or null. */
export function documentFileUri(name: string | null | undefined): string | null {
  if (!name) return null;
  try {
    const f = new File(Paths.document, name);
    return f.exists ? f.uri : null;
  } catch {
    return null;
  }
}
