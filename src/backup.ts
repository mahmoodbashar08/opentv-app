/**
 * iCloud Drive backups. The library is written as the same TV Time-format
 * ZIP the exporter produces, into the app's iCloud container (visible in
 * Files → iCloud Drive → OpenTV) — the one copy that survives deleting the
 * app. A tiny info JSON rides along so the welcome screen can greet the
 * user by name without downloading the whole ZIP.
 */
import { AppState } from 'react-native';

import ICloud from '../modules/icloud-drive';
import db, { getMeta, libraryDirtyRev, setMeta, hasLibrary } from '@/db';
import { withImportLock } from '@/import-lock';
import { isOnboarded } from '@/session-store';

import type { ImportResult, Progress } from '@/importer';

export const BACKUP_ZIP = 'OpenTV Backup.zip';
const BACKUP_INFO = 'OpenTV Backup Info.json';

export type CloudBackup = {
  modifiedAt: number | null; // epoch ms
  username: string | null;
  shows: number | null;
  episodes: number | null;
  movies: number | null;
};

/** false only in a binary built without the native module (e.g. Expo Go). */
export const icloudSupported = (): boolean => ICloud != null;

/** signed into iCloud with iCloud Drive on? */
export const icloudAvailable = (): boolean => {
  try {
    return ICloud?.isAvailable() ?? false;
  } catch {
    return false;
  }
};

/** same check without touching the JS thread — use in tap handlers and
 * mount effects; the sync one can stall the whole app on a cold iCloud state */
export async function icloudAvailableAsync(): Promise<boolean> {
  try {
    return (await ICloud?.isAvailableAsync()) ?? false;
  } catch {
    return false;
  }
}

// ---- base64 helpers (Hermes has btoa/atob but no Buffer) ----------------------
function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return globalThis.btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// unicode-safe (usernames aren't always ascii)
const stringToB64 = (s: string): string => globalThis.btoa(unescape(encodeURIComponent(s)));
const b64ToString = (b: string): string => decodeURIComponent(escape(globalThis.atob(b)));

// fnv-1a — just enough to skip rewriting an unchanged backup
function hashBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * A cheap change-signature for the library — a handful of COUNT/SUM aggregates.
 * Building the export ZIP (which embeds every image file) and hashing it is the
 * expensive synchronous work that used to run on *every* app backgrounding and
 * blocked the JS thread into the next resume (buttons lagged, taps queued). We
 * now compute this first and skip all of that when nothing has changed.
 *
 * COUNTs catch adds/removes; the SUMs catch in-place edits that don't change a
 * row count — re-rating an already-rated episode, toggling favorite/follow/
 * archive/finished, re-rating a movie. A first-import or profile-name change is
 * still caught by the counts / the precise hash guard below.
 */
function librarySignature(): string {
  const one = (sql: string): number => db.getFirstSync<{ n: number }>(sql)?.n ?? 0;
  const parts = [
    `w=${one('SELECT COUNT(*) AS n FROM watches')}`,
    `c=${one('SELECT COUNT(*) AS n FROM comments')}`,
    `ee=${one('SELECT COUNT(*) AS n FROM episode_emotions')}`,
    `cv=${one('SELECT COUNT(*) AS n FROM character_votes')}`,
    // shows: count + toggle-sensitive flag sum
    `s=${one('SELECT COUNT(*) AS n FROM shows')}`,
    `sf=${one('SELECT COALESCE(SUM(favorited)+SUM(followed)+SUM(archived)+SUM(finished),0) AS n FROM shows')}`,
    // ratings: count + value-sensitive sum
    `er=${one('SELECT COUNT(*) AS n FROM episode_ratings')}`,
    `ers=${one('SELECT COALESCE(SUM(stars),0) AS n FROM episode_ratings')}`,
    // movies: count + favorite + star value
    `m=${one('SELECT COUNT(*) AS n FROM movies')}`,
    `mf=${one('SELECT COALESCE(SUM(favorited),0) AS n FROM movies')}`,
    `ms=${one('SELECT COALESCE(SUM(stars),0) AS n FROM movies')}`,
  ];
  // the display name lives in meta, not a counted table — fold it in; the dirty
  // counter makes this exact (catches in-place edits the counts/sums would miss)
  return parts.join('|') + `|u=${getMeta('username') ?? ''}` + `|d=${libraryDirtyRev()}`;
}

/** The backup waiting in this user's iCloud, if any — cheap enough for the
 * welcome screen. Info JSON is best-effort: a bare ZIP still counts. */
export async function findCloudBackup(): Promise<CloudBackup | null> {
  if (!ICloud || !(await icloudAvailableAsync())) return null;
  try {
    const info = await ICloud.fileInfo(BACKUP_ZIP);
    if (!info.exists) return null;
    let meta: Partial<Record<'username', string> & Record<'shows' | 'episodes' | 'movies', number>> = {};
    try {
      meta = JSON.parse(b64ToString(await ICloud.readFile(BACKUP_INFO, 10000)));
    } catch {
      // zip exists but its info file didn't download in time — greet anonymously
    }
    return {
      modifiedAt: info.modifiedAt,
      username: meta.username ?? null,
      shows: meta.shows ?? null,
      episodes: meta.episodes ?? null,
      movies: meta.movies ?? null,
    };
  } catch {
    return null;
  }
}

/** Build the export ZIP and push it to iCloud Drive. Skips the write when
 * nothing changed since the last backup (unless forced). */
export async function backupNow(force = false): Promise<'done' | 'skipped' | 'unavailable'> {
  if (!ICloud || !icloudAvailable() || !hasLibrary()) return 'unavailable';
  // FAST PATH — bail before the expensive ZIP build when nothing changed since
  // the last backup. This runs on every app-backgrounding; building + hashing
  // the whole library+images ZIP here is what blocked the JS thread and made
  // the app lag on the next resume. The cheap signature makes the common case
  // (switching apps without editing anything) essentially free.
  const sig = librarySignature();
  if (!force && getMeta('icloudBackupSig') === sig) return 'skipped';
  // lazy: keeps this module loadable in builds without the exporter's deps
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildTvTimeZip } = require('@/exporter') as typeof import('@/exporter');
  const zip = buildTvTimeZip();
  const hash = hashBytes(zip);
  if (!force && getMeta('icloudBackupHash') === hash) {
    // signature moved but bytes are identical — record the sig so we don't
    // rebuild the ZIP again next time, and skip the write
    setMeta('icloudBackupSig', sig);
    return 'skipped';
  }

  const count = (table: string): number =>
    db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0;
  const info = JSON.stringify({
    app: 'OpenTV',
    username: getMeta('username'),
    shows: count('shows'),
    episodes: count('watches'),
    movies: count('movies'),
    updatedAt: new Date().toISOString(),
  });

  await ICloud.writeFile(BACKUP_ZIP, bytesToB64(zip));
  await ICloud.writeFile(BACKUP_INFO, stringToB64(info));
  setMeta('icloudBackupHash', hash);
  setMeta('icloudBackupSig', sig);
  setMeta('icloudBackupAt', String(Date.now()));
  return 'done';
}

/** Download the ZIP from iCloud and run it through the importer. */
export async function restoreFromCloud(onProgress: (p: Progress) => void): Promise<ImportResult> {
  if (!ICloud) throw new Error('This build has no iCloud support');
  onProgress({ phase: 'Downloading your backup…', done: 0, total: 1 });
  const zip = b64ToBytes(await ICloud.readFile(BACKUP_ZIP, 60000));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { importZipBytes } = require('@/importer') as typeof import('@/importer');
  // under the shared import lock: a restore must not run concurrently with a
  // startup resume/repair or another import racing over the same tables
  const result = await withImportLock(() => importZipBytes(zip, onProgress));
  // what's local now round-trips from the cloud copy — no backup needed
  // until the user changes something
  setMeta('icloudBackupHash', hashBytes(zip));
  setMeta('icloudBackupSig', librarySignature());
  setMeta('icloudBackupAt', String(Date.now()));
  return result;
}

/** Timestamp of the last successful backup from this device, epoch ms. */
export function lastBackupAt(): number | null {
  const v = getMeta('icloudBackupAt');
  return v ? Number(v) : null;
}

// ---- auto-backup: whenever the app leaves the foreground ----------------------
let autoBackupStarted = false;
export function initAutoBackup(): void {
  if (autoBackupStarted) return;
  autoBackupStarted = true;
  AppState.addEventListener('change', (state) => {
    if (state !== 'background') return;
    if (!isOnboarded()) return;
    // hash check inside makes this a no-op when nothing changed
    void backupNow().catch(() => {});
  });
}
