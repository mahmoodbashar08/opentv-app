/**
 * The library, kept on a server — the third destination after iCloud and Drive.
 *
 * WHY A THIRD ONE. iCloud covers iPhones, Drive covers Android, and neither
 * covers somebody moving between them or somebody who has signed into neither.
 * A decade of watch history that exists on exactly one device is one dropped
 * phone away from gone, and that is the whole reason this exists.
 *
 * TWO DESTINATIONS, ONE FILE, because the only thing that differs between them
 * is the four lines that put and get the bytes. Everything else — when to skip,
 * what to send, how to restore — is shared, and two copies of that logic would
 * eventually disagree about whether a library had changed.
 *
 *   'opentv'  our own server. Needs Plus, because it costs us storage.
 *   'webdav'  the user's own — Nextcloud, ownCloud, a Synology box. Costs us
 *             nothing and needs nothing, so it is not gated on anything.
 *
 * ⚠️ THIS IS THE ONE PLACE THE LIBRARY LEAVES THE PHONE, and it is opt-in, off
 * by default, and says so in the settings row. Nothing is uploaded until
 * somebody turns it on, and `disconnect()` deletes the copy rather than merely
 * forgetting about it.
 *
 * BACKUP, NOT SYNC. Two phones editing the same library would need conflict
 * resolution, and there is none here: the last device to back up wins. What
 * this buys is a new phone getting the old phone's library, which is the thing
 * people actually ask for.
 */
import * as SecureStore from 'expo-secure-store';

import db, { clearUnmarkedEpisodes, getMeta, hasLibrary, setMeta } from '@/db';
import { apiUploadBytes } from '@/api';
import { getToken } from '@/community-session';
import { withImportLock } from '@/import-lock';
import { basicAuth, davFileUrl as davUrl, utf8ToB64 } from '@/pure';
import { serverUrl } from '@/server-url';
import type { ImportResult, Progress } from '@/importer';

export type BackupDestination = 'opentv' | 'webdav';

/** One file in one place — never a directory listing, never a second key. */
const davFileUrl = (base: string): string => davUrl(base, FILE);

/** Same filename the other two clouds use, so the three are one thing. */
const FILE = 'OpenTV Backup.zip';

const DEST_KEY = 'cloudBackupTo';
const HASH_KEY = 'cloudBackupHash';
const SIG_KEY = 'cloudBackupSig';
const AT_KEY = 'cloudBackupAt';
/** The address is not a secret and the screen has to show it. */
const DAV_URL_KEY = 'cloudDavUrl';
/**
 * THE PASSWORD IS NOT IN `meta`. It is a credential to somebody else's server,
 * and `meta` lives in the database that gets exported, backed up and restored —
 * so a password there would ride along inside every ZIP this app produces,
 * including the one uploaded by this very feature. Keychain, exactly as
 * `jellyfin-sync.ts` does it.
 */
const DAV_CRED_KEY = 'opentv.cloud.dav';

export type BackupSummary = {
  updatedAt: number | null;
  username: string | null;
  shows: number | null;
  episodes: number | null;
  movies: number | null;
  size: number | null;
};

// ── what is turned on ────────────────────────────────────────────────────────

export function backupDestination(): BackupDestination | null {
  const v = getMeta(DEST_KEY);
  return v === 'opentv' || v === 'webdav' ? v : null;
}

export const serverBackupConnected = (): boolean => backupDestination() != null;

export function lastServerBackupAt(): number | null {
  const v = getMeta(AT_KEY);
  return v ? Number(v) : null;
}

/** Where it is going, for the settings row to name. Never the password. */
export function webdavAddress(): string | null {
  return getMeta(DAV_URL_KEY) || null;
}

type DavCreds = { url: string; user: string; pass: string };

async function davCreds(): Promise<DavCreds | null> {
  const url = getMeta(DAV_URL_KEY);
  if (!url) return null;
  try {
    const raw = await SecureStore.getItemAsync(DAV_CRED_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<DavCreds>;
    return typeof c.user === 'string' && typeof c.pass === 'string'
      ? { url, user: c.user, pass: c.pass }
      : null;
  } catch {
    return null;
  }
}


// ── connecting ───────────────────────────────────────────────────────────────

export type ConnectResult = 'ok' | 'unauthorised' | 'not-found' | 'failed';

/**
 * Point backup at our server. Nothing is verified here: the first real upload
 * is what discovers whether Plus is on, and it reports `plus_required` rather
 * than a vague failure.
 */
export function chooseOpenTvCloud(): void {
  setMeta(DEST_KEY, 'opentv');
  clearStamps();
}

/**
 * Point it at the user's own server, and PROVE IT WORKS BEFORE SAYING IT DOES.
 *
 * A settings row that says "connected" because a URL was typed is worse than
 * one that says nothing: the first anybody hears of a wrong password is the
 * day they need the backup. So this uploads the real file immediately — which
 * both tests the credentials and leaves a genuine backup behind, rather than
 * writing a probe file and deleting it.
 */
export async function connectWebdav(url: string, user: string, pass: string): Promise<ConnectResult> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return 'failed';

  /**
   * AN EMPTY LIBRARY NEVER REPLACES A BACKUP — the same rule `publishProfile`
   * keeps, and it was missing here, on the one path that is reached BECAUSE the
   * library is empty.
   *
   * "I use my own server" on the Restore screen sends a phone that has just
   * been reinstalled straight into this function. Uploading to prove the
   * credentials then wrote an empty ZIP over the backup the person had come to
   * recover — a decade destroyed in one tap, reported as "Backed up". Observed
   * on 19 Sep 2026: 4,788,365 bytes became 6,310.
   *
   * So when there is nothing to send, the credentials are proven by ASKING
   * instead of writing: HEAD the file, and if it is not there, HEAD the
   * collection so a wrong folder is still told apart from an empty one. The
   * stamps are deliberately not set, because nothing was uploaded and the first
   * real backup must still happen.
   */
  if (!hasLibrary()) {
    try {
      const res = await fetch(davFileUrl(trimmed), {
        method: 'HEAD',
        headers: { Authorization: basicAuth(user, pass) },
      });
      if (res.status === 401 || res.status === 403) return 'unauthorised';
      if (!res.ok) {
        // No backup there yet is normal for a new server; a missing collection
        // is not, and they are a different fix for the reader.
        const base = await fetch(trimmed, {
          method: 'HEAD',
          headers: { Authorization: basicAuth(user, pass) },
        });
        if (base.status === 401 || base.status === 403) return 'unauthorised';
        if (!base.ok) return 'not-found';
      }
    } catch {
      return 'failed';
    }
    await SecureStore.setItemAsync(DAV_CRED_KEY, JSON.stringify({ user, pass }));
    setMeta(DAV_URL_KEY, trimmed);
    setMeta(DEST_KEY, 'webdav');
    return 'ok';
  }

  // Built ONCE and reused for the stamp below. Two calls here meant building a
  // decade of history into a ZIP twice to connect once.
  const zip = buildZip();
  try {
    const res = await fetch(davFileUrl(trimmed), {
      method: 'PUT',
      headers: { Authorization: basicAuth(user, pass), 'Content-Type': 'application/zip' },
      body: zip.slice().buffer as ArrayBuffer,
    });
    if (res.status === 401 || res.status === 403) return 'unauthorised';
    // A collection that does not exist is the other predictable mistake, and
    // it is a different fix from a wrong password.
    if (res.status === 404 || res.status === 409) return 'not-found';
    if (!res.ok) return 'failed';
  } catch {
    return 'failed';
  }

  await SecureStore.setItemAsync(DAV_CRED_KEY, JSON.stringify({ user, pass }));
  setMeta(DAV_URL_KEY, trimmed);
  setMeta(DEST_KEY, 'webdav');
  stamp(zip);
  return 'ok';
}

/**
 * Stop, and TAKE THE COPY BACK OFF whatever was holding it.
 *
 * Turning this off has to mean the library is no longer on a server, not that
 * this phone stopped mentioning it. A delete that fails is not worth blocking
 * the disconnect — the local state is cleared either way, and the user can say
 * no more clearly than we can retry.
 */
export async function disconnectServerBackup(): Promise<void> {
  const dest = backupDestination();
  try {
    if (dest === 'opentv') {
      const token = await getToken();
      if (token) {
        await fetch(`${serverUrl()}/v1/backup`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } else if (dest === 'webdav') {
      const c = await davCreds();
      if (c) {
        await fetch(davFileUrl(c.url), {
          method: 'DELETE',
          headers: { Authorization: basicAuth(c.user, c.pass) },
        });
      }
    }
  } catch {
    // Offline, or the server said no. Disconnecting locally still has to work.
  }

  try {
    await SecureStore.deleteItemAsync(DAV_CRED_KEY);
  } catch {
    // Already gone.
  }
  setMeta(DEST_KEY, '');
  setMeta(DAV_URL_KEY, '');
  clearStamps();
}

// ── the three operations, shared by both destinations ────────────────────────

function buildZip(): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildTvTimeZip } = require('@/exporter') as typeof import('@/exporter');
  return buildTvTimeZip();
}

/** The counts, so a fresh install can be greeted by name without downloading a
 *  library to find out whose it is. */
function infoHeader(): string {
  const count = (table: string): number =>
    db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0;
  const json = JSON.stringify({
    username: getMeta('username'),
    shows: count('shows'),
    episodes: count('watches'),
    movies: count('movies'),
  });
  // UTF-8 before base64: a handle in Arabic makes `btoa` throw otherwise, and
  // the server decodes it the same way round.
  return utf8ToB64(json);
}

function clearStamps(): void {
  setMeta(HASH_KEY, '');
  setMeta(SIG_KEY, '');
  setMeta(AT_KEY, '');
}

function stamp(zip: Uint8Array): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { librarySignature, hashBytes } = require('@/backup') as typeof import('@/backup');
  setMeta(HASH_KEY, hashBytes(zip));
  setMeta(SIG_KEY, librarySignature());
  setMeta(AT_KEY, String(Date.now()));
}

export type BackupOutcome = 'done' | 'skipped' | 'unavailable' | 'plus-required' | 'failed';

/**
 * Send it up. THE SAME SKIP LOGIC AS THE OTHER TWO CLOUDS, and for the same
 * reason: this runs every time the app is backgrounded, and building a ZIP of a
 * decade of history on the JS thread is what made the app lag on resume.
 */
export async function serverBackupNow(force = false): Promise<BackupOutcome> {
  const dest = backupDestination();
  if (!dest || !hasLibrary()) return 'unavailable';

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { librarySignature, hashBytes } = require('@/backup') as typeof import('@/backup');
  const sig = librarySignature();
  if (!force && getMeta(SIG_KEY) === sig) return 'skipped';

  const zip = buildZip();
  const hash = hashBytes(zip);
  if (!force && getMeta(HASH_KEY) === hash) {
    // The signature moved but the bytes did not — record it so the ZIP is not
    // rebuilt again next time, and send nothing.
    setMeta(SIG_KEY, sig);
    return 'skipped';
  }

  try {
    if (dest === 'opentv') {
      const token = await getToken();
      if (!token) return 'unavailable';
      await apiUploadBytes('/v1/backup', zip, 'application/zip', token, {
        'X-OpenTV-Backup-Info': infoHeader(),
      });
    } else {
      const c = await davCreds();
      if (!c) return 'unavailable';
      const res = await fetch(davFileUrl(c.url), {
        method: 'PUT',
        headers: { Authorization: basicAuth(c.user, c.pass), 'Content-Type': 'application/zip' },
        body: zip.slice().buffer as ArrayBuffer,
      });
      if (!res.ok) return 'failed';
    }
  } catch (e) {
    // The one failure worth naming: Plus lapsed or was never on. Everything
    // else is "it didn't go through", which no user can act on differently.
    const code = (e as { code?: string })?.code;
    return code === 'plus_required' ? 'plus-required' : 'failed';
  }

  stamp(zip);
  return 'done';
}

/** What is up there, without downloading it — the question a fresh install
 *  asks before offering to restore anything. */
export async function findServerBackup(): Promise<BackupSummary | null> {
  const dest = backupDestination();
  if (!dest) return null;

  try {
    if (dest === 'opentv') {
      const token = await getToken();
      if (!token) return null;
      const res = await fetch(`${serverUrl()}/v1/backup/info`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const j = (await res.json()) as {
        exists?: boolean;
        size?: number;
        updatedAt?: string | null;
        username?: string | null;
        shows?: number | null;
        episodes?: number | null;
        movies?: number | null;
      };
      if (!j.exists) return null;
      return {
        updatedAt: j.updatedAt ? Date.parse(j.updatedAt) : null,
        username: j.username ?? null,
        shows: j.shows ?? null,
        episodes: j.episodes ?? null,
        movies: j.movies ?? null,
        size: j.size ?? null,
      };
    }

    const c = await davCreds();
    if (!c) return null;
    // HEAD, not PROPFIND: the question is whether one known file is there, and
    // a plain HEAD is answered by every WebDAV server and by a bare static host
    // besides. Counts are not available this way, and a date is enough.
    const res = await fetch(davFileUrl(c.url), {
      method: 'HEAD',
      headers: { Authorization: basicAuth(c.user, c.pass) },
    });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length'));
    const mod = res.headers.get('last-modified');
    return {
      updatedAt: mod ? Date.parse(mod) : null,
      username: null,
      shows: null,
      episodes: null,
      movies: null,
      size: isFinite(len) && len > 0 ? len : null,
    };
  } catch {
    return null;
  }
}

/** Pull it down and run it through the importer — the same path the iCloud
 *  restore, the Drive restore and a hand-made import all take. */
export async function restoreFromServerBackup(
  onProgress: (p: Progress) => void,
): Promise<ImportResult> {
  const dest = backupDestination();
  if (!dest) throw new Error('No cloud backup is connected');

  onProgress({ phase: 'Downloading your backup…', done: 0, total: 1 });

  let res: Response;
  if (dest === 'opentv') {
    const token = await getToken();
    if (!token) throw new Error('Not signed in');
    res = await fetch(`${serverUrl()}/v1/backup`, { headers: { Authorization: `Bearer ${token}` } });
  } else {
    const c = await davCreds();
    if (!c) throw new Error('Not connected');
    res = await fetch(davFileUrl(c.url), { headers: { Authorization: basicAuth(c.user, c.pass) } });
  }
  // THE STATUS RIDES ALONG. A 404 is an answer — there is nothing up there yet
  // — and a dropped connection is a question that was never asked. A caller
  // that cannot tell them apart will treat "the wifi was off" as "there is no
  // backup", which is how a device decides once, wrongly, and for ever.
  if (!res.ok) throw Object.assign(new Error(`No backup found (${res.status})`), { status: res.status });
  const zip = new Uint8Array(await res.arrayBuffer());

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { importZipBytes } = require('@/importer') as typeof import('@/importer');
  // THE COPY UP THERE WINS, tombstones included. An un-tick recorded here —
  // including one that arrived from another device through the relay — would
  // otherwise make the importer skip that episode silently, and a restore that
  // drops rows while reporting success is the worst answer a backup can give.
  clearUnmarkedEpisodes();
  const result = await withImportLock(() => importZipBytes(zip, onProgress));

  // What is local now came from the copy up there — nothing to send back until
  // the user changes something.
  stamp(zip);
  return result;
}
