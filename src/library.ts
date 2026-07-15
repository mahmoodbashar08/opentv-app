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
