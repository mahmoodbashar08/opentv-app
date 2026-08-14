/**
 * Google Drive backups — the Android half of what iCloud already does on iOS.
 *
 * WHY THIS EXISTS AT ALL. An iPhone writes the whole library, photos included,
 * to the user's own iCloud Drive, and a reinstall offers it straight back.
 * Android had nothing of the sort: a manual export the user has to remember,
 * plus Android's own Auto Backup, which is worse than nothing here because it
 * stops at 25 MB WITHOUT TELLING ANYBODY -- so a casual library is quietly
 * protected and a decade of history quietly is not, which is exactly backwards
 * for the people this app was built for.
 *
 * SIGNING IN HERE IS NOT JOINING THE COMMUNITY, and the separation is
 * deliberate rather than incidental. The app already signs in with Google for
 * accounts; if backup rode on that, "keep my library safe" would mean "publish
 * a profile", and the one promise this project cannot break is that the tracker
 * needs nobody. So the Drive permission is asked for on its own, with
 * `addScopes`, at the moment somebody turns backup on -- and a person who never
 * touches the community can still have their decade backed up.
 *
 * `drive.file` AND NOTHING WIDER. That scope grants access to files this app
 * itself created and to nothing else in the user's Drive: we cannot read their
 * documents, cannot list their folders, and cannot see another app's files. It
 * is also what keeps the backup VISIBLE -- `drive.appdata` would hide it in a
 * folder the user cannot open, and a backup you cannot see is one you cannot
 * trust. iCloud's copy sits in Files where anyone can find it; this one sits in
 * Drive the same way.
 *
 * The bytes are identical to the iCloud copy: the same TV Time-format ZIP the
 * exporter builds, images and all. One backup format, two clouds.
 */
import { Platform } from 'react-native';

import db, { getMeta, hasLibrary, setMeta } from '@/db';
import { withImportLock } from '@/import-lock';
import type { ImportResult, Progress } from '@/importer';

/** Same names as the iCloud copy, so the two are recognisably one thing. */
export const DRIVE_ZIP = 'OpenTV Backup.zip';
const DRIVE_INFO = 'OpenTV Backup Info.json';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const CONNECTED_KEY = 'driveBackupOn';
const HASH_KEY = 'driveBackupHash';
const SIG_KEY = 'driveBackupSig';
const AT_KEY = 'driveBackupAt';

export type DriveBackup = {
  modifiedAt: number | null;
  username: string | null;
  shows: number | null;
  episodes: number | null;
  movies: number | null;
};

/** Android only. iOS has iCloud, and offering both would be two answers to one
 *  question — see the note in `settings.tsx`. */
export const driveSupported = (): boolean => Platform.OS === 'android';

/** Has the user turned this on and granted the scope? A local flag, because the
 *  alternative is a network round trip on every settings render. */
export const driveConnected = (): boolean => getMeta(CONNECTED_KEY) === '1';

export function lastDriveBackupAt(): number | null {
  const v = getMeta(AT_KEY);
  return v ? Number(v) : null;
}

type GoogleModule = typeof import('@react-native-google-signin/google-signin');

function google(): GoogleModule {
  // Lazy, like `community-auth.ts`: keeps this module importable in a build
  // without the native package rather than exploding at import time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-google-signin/google-signin') as GoogleModule;
}

/**
 * An OAuth access token that carries the Drive scope, or null.
 *
 * NEVER PROMPTS. Called before every backup, including the silent one that runs
 * when the app goes to the background — a sign-in sheet appearing because
 * somebody switched apps would be indefensible. Connecting is `connectDrive()`,
 * which is only ever reached by a deliberate tap.
 */
async function accessToken(): Promise<string | null> {
  try {
    const { GoogleSignin } = google();
    const user = await GoogleSignin.signInSilently();
    if (!user) return null;
    const { accessToken: token } = await GoogleSignin.getTokens();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Ask for the Drive permission. The one call that may show a sheet.
 *
 * `addScopes` rather than a fresh `signIn`, so somebody already signed in for
 * the community is asked for the extra permission alone rather than made to
 * choose an account again — and somebody who has never signed in gets the
 * normal sign-in first, for backup only, joining nothing.
 */
export async function connectDrive(): Promise<boolean> {
  try {
    const { GoogleSignin } = google();
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }
    const current = await GoogleSignin.signInSilently().catch(() => null);
    if (!current) await GoogleSignin.signIn();
    await GoogleSignin.addScopes({ scopes: [DRIVE_SCOPE] });
    const token = await accessToken();
    if (!token) return false;
    setMeta(CONNECTED_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** Stop backing up. The files in Drive are the user's and are left alone —
 *  deleting somebody's backup because they switched a toggle off would be a
 *  remarkable thing for a backup feature to do. */
export function disconnectDrive(): void {
  setMeta(CONNECTED_KEY, '');
}

// ── the Drive REST calls ─────────────────────────────────────────────────────

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

type DriveFile = { id: string; name: string; modifiedTime?: string; size?: string };

/**
 * Find one of our files by name.
 *
 * Under `drive.file` this search only ever sees files this app created, which
 * is why searching by name alone is safe: there is no other app's
 * "OpenTV Backup.zip" in scope, and the user's own unrelated files are
 * invisible to us by construction.
 */
async function findFile(token: string, name: string): Promise<DriveFile | null> {
  const q = encodeURIComponent(`name='${name}' and trashed=false`);
  const res = await fetch(`${API}/files?q=${q}&fields=files(id,name,modifiedTime,size)&pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { files?: DriveFile[] };
  return body.files?.[0] ?? null;
}

/** Create or replace a file. Replace by id, so a backup never accumulates
 *  copies — the user should find one file in Drive, not forty. */
async function putFile(token: string, name: string, mime: string, bytes: Uint8Array): Promise<void> {
  const existing = await findFile(token, name);
  const body = bytes.slice().buffer as ArrayBuffer;

  if (existing) {
    const res = await fetch(`${UPLOAD}/files/${existing.id}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': mime },
      body,
    });
    if (!res.ok) throw new Error(`Drive update failed (${res.status})`);
    return;
  }

  // Create: metadata first so the file has its name, then the bytes. Two calls
  // rather than a multipart body, because assembling multipart by hand in
  // React Native means base64 and a copy of the whole ZIP in a string.
  const meta = await fetch(`${API}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: mime }),
  });
  if (!meta.ok) throw new Error(`Drive create failed (${meta.status})`);
  const { id } = (await meta.json()) as { id: string };

  const res = await fetch(`${UPLOAD}/files/${id}?uploadType=media`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': mime },
    body,
  });
  if (!res.ok) throw new Error(`Drive upload failed (${res.status})`);
}

async function getBytes(token: string, id: string): Promise<Uint8Array> {
  const res = await fetch(`${API}/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

// ── the same three operations iCloud offers ──────────────────────────────────

/** What is up there, for the welcome screen to offer by name and size. */
export async function findDriveBackup(): Promise<DriveBackup | null> {
  const token = await accessToken();
  if (!token) return null;
  const zip = await findFile(token, DRIVE_ZIP);
  if (!zip) return null;

  let info: Partial<DriveBackup> & { updatedAt?: string } = {};
  try {
    const infoFile = await findFile(token, DRIVE_INFO);
    if (infoFile) {
      const bytes = await getBytes(token, infoFile.id);
      info = JSON.parse(new TextDecoder().decode(bytes)) as typeof info;
    }
  } catch {
    // The ZIP is the backup; the info file is a convenience. A missing or
    // unreadable one must not hide a restore that would work.
  }

  return {
    modifiedAt: zip.modifiedTime ? Date.parse(zip.modifiedTime) : null,
    username: info.username ?? null,
    shows: info.shows ?? null,
    episodes: info.episodes ?? null,
    movies: info.movies ?? null,
  };
}

/**
 * Write the library up. Same skip logic as iCloud, and for the same reason:
 * this runs every time the app is backgrounded, and building a ZIP of a decade
 * of history on the JS thread is what made the app lag on resume.
 */
export async function driveBackupNow(force = false): Promise<'done' | 'skipped' | 'unavailable'> {
  if (!driveSupported() || !driveConnected() || !hasLibrary()) return 'unavailable';

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { librarySignature, hashBytes } = require('@/backup') as typeof import('@/backup');
  const sig = librarySignature();
  if (!force && getMeta(SIG_KEY) === sig) return 'skipped';

  const token = await accessToken();
  if (!token) return 'unavailable';

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildTvTimeZip } = require('@/exporter') as typeof import('@/exporter');
  const zip = buildTvTimeZip();
  const hash = hashBytes(zip);
  if (!force && getMeta(HASH_KEY) === hash) {
    setMeta(SIG_KEY, sig);
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

  await putFile(token, DRIVE_ZIP, 'application/zip', zip);
  await putFile(token, DRIVE_INFO, 'application/json', new TextEncoder().encode(info));

  setMeta(HASH_KEY, hash);
  setMeta(SIG_KEY, sig);
  setMeta(AT_KEY, String(Date.now()));
  return 'done';
}

/** Pull it back down and run it through the importer — the same path the
 *  iCloud restore and a hand-made import both take. */
export async function restoreFromDrive(onProgress: (p: Progress) => void): Promise<ImportResult> {
  const token = await accessToken();
  if (!token) throw new Error('Not connected to Google Drive');

  onProgress({ phase: 'Downloading your backup…', done: 0, total: 1 });
  const file = await findFile(token, DRIVE_ZIP);
  if (!file) throw new Error('No backup found in Google Drive');
  const zip = await getBytes(token, file.id);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { importZipBytes } = require('@/importer') as typeof import('@/importer');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { librarySignature, hashBytes } = require('@/backup') as typeof import('@/backup');

  const result = await withImportLock(() => importZipBytes(zip, onProgress));

  // What is local now came from the cloud copy — nothing to send back until the
  // user changes something.
  setMeta(HASH_KEY, hashBytes(zip));
  setMeta(SIG_KEY, librarySignature());
  setMeta(AT_KEY, String(Date.now()));
  return result;
}
