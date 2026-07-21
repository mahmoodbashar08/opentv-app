/**
 * Manual library export — the Android backup path (Android has no iCloud
 * auto-backup; that gap is filled by exporting the ZIP to the user's own
 * Drive/Files for now, with a real Google Drive module planned later).
 *
 * Two things this centralises:
 *  - Android-SAFE sharing. React Native's `Share.share({ url })` only attaches
 *    a file on iOS; on Android the file is dropped and the share is empty (the
 *    same trap already fixed for the profile card). expo-sharing hands the real
 *    file to the native sheet on both platforms.
 *  - A "back up your library" nudge that fires only when there's new,
 *    un-exported data — so it clears right after an export and never nags.
 */
import { Platform, Share } from 'react-native';

import db, { getMeta, hasLibrary, setMeta } from '@/db';

// cheap change signal: row counts, no ZIP build — safe to call on screen focus
function librarySig(): string {
  const n = (t: string) => db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n ?? 0;
  return `${n('watches')}:${n('comments')}:${n('movies')}:${n('shows')}`;
}

/** Android only: true when the library has changed since the last export (or
 * was never exported). iOS relies on iCloud auto-backup instead, so it's never
 * "overdue" here. */
export function manualBackupOverdue(): boolean {
  if (Platform.OS !== 'android' || !hasLibrary()) return false;
  return getMeta('lastExportSig') !== librarySig();
}

/** Timestamp of the last successful manual export, epoch ms. */
export function lastManualExportAt(): number | null {
  const v = getMeta('manualExportAt');
  return v ? Number(v) : null;
}

/**
 * Build the export ZIP — images bundled inside, so it's a complete,
 * server-independent copy — and hand it to the native share sheet. On success
 * records the export so the nudge clears. Returns false if the share sheet
 * isn't available (caller surfaces the error).
 */
export async function shareLibraryExport(): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildTvTimeZip } = require('@/exporter') as typeof import('@/exporter');
  const name = `opentv-export-${new Date().toISOString().slice(0, 10)}.zip`;
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.write(buildTvTimeZip());

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sharing = require('expo-sharing') as typeof import('expo-sharing');
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/zip',
      UTI: 'public.zip-archive',
      dialogTitle: 'Back up your OpenTV library',
    });
  } else {
    // sharing module absent (bare/Expo Go) — iOS still accepts a file url
    await Share.share({ url: file.uri });
  }
  setMeta('manualExportAt', String(Date.now()));
  setMeta('lastExportSig', librarySig());
  return true;
}
