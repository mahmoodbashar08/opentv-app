/**
 * Silent startup self-repairs, driven by the preserved original TV Time
 * export. Guarded by a REVISION, not a boolean: every time the importer gets
 * smarter, bump REPAIR_REV and every user's library re-heals on next launch —
 * merge mode makes re-running always safe. Nobody ever erases or re-imports
 * by hand.
 */
import { File, Paths } from 'expo-file-system';
import { strFromU8, unzipSync } from 'fflate';

import db, { dedupeDuplicateShows, getMeta, setMeta, hasLibrary, libraryOwner } from '@/db';
import { withImportLock } from '@/import-lock';

function b64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Ratings imported before 1.1.2 assumed a 0..4 scale, but TV Time rates on
 * 0..3 (BAD, GOOD, GREAT, WOW) for BOTH movies and episodes — so every
 * imported WOW showed as GREAT. Re-read the preserved original export and
 * correct each vote whose current value still equals exactly what the buggy
 * import wrote; anything the user re-rated by hand no longer matches and is
 * left alone.
 */
/** The user's untouched TV Time export: local copy first, then their iCloud.
 * null = not available right now (retry later); 'none' = provably absent. */
async function originalZipBytes(): Promise<Uint8Array | null | 'none'> {
  try {
    const local = new File(Paths.document, 'tvtime-original.zip');
    if (local.exists) return b64ToBytes(local.base64Sync());
  } catch {}
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ICloud = (require('../modules/icloud-drive') as typeof import('../modules/icloud-drive')).default;
    if (!ICloud) return 'none';
    if (!(await ICloud.isAvailableAsync())) return null;
    const info = await ICloud.fileInfo('TV Time Original.zip');
    if (!info.exists) return 'none';
    return b64ToBytes(await ICloud.readFile('TV Time Original.zip', 20000));
  } catch {
    return null;
  }
}

/** Bump this whenever the importer learns to recover more data.
 * rev 5: retract phantom episodes the ≤1.1.2 bulk fill invented from TV
 * Time's inflated nb_episodes_seen counter, correct the stored counter, and
 * remap TVDB-numbered rows onto TMDB's episode structure.
 * rev 6: import "who was your favorite?" character votes. */
export const REPAIR_REV = '10';

/** Whether a preserved original export exists anywhere, without reading it.
 * 'no' → the library predates preservation (1.1.0-era import) and silent
 * self-repair can't reach it — the UI offers one guided re-import instead. */
export async function hasOriginalZip(): Promise<'yes' | 'no' | 'unknown'> {
  try {
    const local = new File(Paths.document, 'tvtime-original.zip');
    if (local.exists) return 'yes';
  } catch {}
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ICloud = (require('../modules/icloud-drive') as typeof import('../modules/icloud-drive')).default;
    if (!ICloud) return 'no';
    if (!(await ICloud.isAvailableAsync())) return 'unknown';
    return (await ICloud.fileInfo('TV Time Original.zip')).exists ? 'yes' : 'no';
  } catch {
    return 'unknown';
  }
}

/** Run every pending self-repair, in order. Called once per app start.
 *  onPhase fires with a label while the (thread-blocking) re-import runs and
 *  null when it's done, so the UI can show a progress overlay instead of a
 *  frozen splash. */
export async function runStartupRepairs(onPhase?: (phase: string | null) => void): Promise<void> {
  if (getMeta('repairRev') === REPAIR_REV) return;
  const scaleDone = await migrateVoteScale();
  const reimportDone = await silentReimportRepair(onPhase);
  // fold TV Time's deprecated duplicate show entries (empty ghosts + split
  // watches) into one — idempotent, so it's a no-op once clean
  try {
    dedupeDuplicateShows();
  } catch {
    // never let a dedupe hiccup block the rest of startup
  }
  // only stamp the revision when both passes truly finished — a transient
  // failure (iCloud unreachable) retries on the next launch
  if (scaleDone && reimportDone) setMeta('repairRev', REPAIR_REV);
}

/**
 * Re-run the preserved original export through the importer, silently.
 * Merge mode never duplicates and never overwrites local changes — it only
 * fills what older importer versions dropped (cross-filed votes, watched-on
 * sources, ratings lost to name mismatches). The user never has to erase.
 */
export async function silentReimportRepair(onPhase?: (phase: string | null) => void): Promise<boolean> {
  if (!hasLibrary() || libraryOwner() !== 'imported') {
    // fresh-start and demo libraries have nothing to repair from
    return true;
  }
  const bytes = await originalZipBytes();
  if (bytes === null) return false; // not reachable — retry next launch
  if (bytes === 'none') return true;
  // under the shared import lock so this re-import can't run concurrently with a
  // user-initiated import (two importZipBytes racing could double-insert rows)
  return withImportLock(async () => {
    try {
      onPhase?.('Updating your library…');
      // let the overlay actually paint before the importer's synchronous
      // withTransactionSync monopolises the JS thread — without this yield the
      // block starts in the same frame and the splash looks frozen
      await new Promise((r) => setTimeout(r, 60));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { importZipBytes } = require('@/importer') as typeof import('@/importer');
      await importZipBytes(bytes, () => {});
      // the importer stamps the revision itself ONLY on a fully-successful
      // pass — treat a skipped stamp (bulk rebuild hit a network failure) as
      // "retry next launch", or the repair would count as done half-finished
      return getMeta('repairRev') === REPAIR_REV;
    } catch {
      // corrupt zip or transient failure — try again next launch
      return false;
    } finally {
      onPhase?.(null);
    }
  });
}

/**
 * Finish an import that was cut short. pickAndImport stages the export and sets
 * importPending BEFORE the (single-transaction) import runs, so if the app was
 * backgrounded or killed mid-run — writing nothing — this re-runs it from the
 * staged ZIP on the next launch, then promotes it to the preserved original.
 * importZipBytes auto-detects merge vs. fresh from the current library state,
 * so a first, merge, or replace import all recover correctly, and re-running is
 * idempotent if the import had in fact already committed before the flag cleared.
 */
export async function resumeInterruptedImport(): Promise<void> {
  if (getMeta('importPending') !== '1') return;
  // share the import lock with pickAndImport so the two never run at once over
  // the shared staged file / flag
  return withImportLock(async () => {
    if (getMeta('importPending') !== '1') return; // a queued user import already finished it
    let bytes: Uint8Array;
    try {
      const staged = new File(Paths.document, 'tvtime-importing.zip');
      if (!staged.exists) {
        // flag set but nothing staged (out-of-disk at stage time) — can't
        // resume, so stop re-checking every launch
        setMeta('importPending', '');
        return;
      }
      bytes = b64ToBytes(staged.base64Sync());
    } catch {
      return; // unreadable right now — retry next launch
    }
    // bound the retries: a persistently failing import or promote (e.g. the
    // device is out of storage) must not re-run the whole import every launch
    const tries = Number(getMeta('importResumeTries') ?? '0') || 0;
    if (tries >= 3) {
      setMeta('importPending', ''); // give up auto-resuming; staged file remains
      return;
    }
    setMeta('importResumeTries', String(tries + 1));
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { importZipBytes } = require('@/importer') as typeof import('@/importer');
      await importZipBytes(bytes, () => {});
      // committed — promote to the preserved original, THEN clear the flag last
      const orig = new File(Paths.document, 'tvtime-original.zip');
      if (orig.exists) orig.delete();
      orig.write(bytes);
      const staged = new File(Paths.document, 'tvtime-importing.zip');
      if (staged.exists) staged.delete();
      setMeta('importPending', '');
      setMeta('importResumeTries', '0');
    } catch {
      // transient failure — leave the flag set and retry on the next launch
    }
  });
}

export async function migrateVoteScale(): Promise<boolean> {
  const loaded = await originalZipBytes();
  if (loaded === null) return false; // iCloud not reachable right now — retry next launch
  if (loaded === 'none') return true; // no original anywhere — nothing to repair from
  const bytes = loaded;

  try {
    const files = unzipSync(bytes);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parseCsv } = require('@/importer') as typeof import('@/importer');
    const csvOf = (suffix: string): Record<string, string>[] => {
      const key = Object.keys(files).find((k) => k.endsWith(suffix) && !k.includes('__MACOSX'));
      return key ? parseCsv(strFromU8(files[key])) : [];
    };
    const CORRECT = [1, 3, 4, 5]; // TV Time 0..3 → our 1..5

    // movies: keyed by name
    for (const r of csvOf('ratings-live-votes.csv')) {
      const name = (r.movie_name || '').trim();
      const raw = Number((r.vote_key || '').split('-').pop());
      if (!name || !(raw >= 1 && raw <= 3)) continue; // raw 0 imported correctly
      const buggy = raw + 1; // what the old import stored
      db.runSync('UPDATE movies SET stars = ? WHERE (name = ? OR originalName = ?) AND stars = ?', [
        CORRECT[raw],
        name,
        name,
        buggy,
      ]);
    }

    // episodes: votes reference shows by name — rebuild the same name → id
    // map the importer uses (canonical names + tracking-row aliases)
    const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
    const byName = new Map<string, number>();
    for (const r of csvOf('user_tv_show_data.csv')) {
      if (r.tv_show_id && r.tv_show_name) byName.set(nameKey(r.tv_show_name), Number(r.tv_show_id));
    }
    for (const r of csvOf('tracking-prod-records-v2.csv')) {
      if (r.s_id && r.series_name && !byName.has(nameKey(r.series_name))) {
        byName.set(nameKey(r.series_name), Number(r.s_id));
      }
    }
    for (const r of csvOf('ratings-3-prod-episode_votes.csv')) {
      const id = r.series_name ? byName.get(nameKey(r.series_name)) : undefined;
      const raw = Number((r.vote_key || '').split('-').pop());
      if (id == null) continue;
      if (raw >= 1 && raw <= 3) {
        const buggy = raw + 1;
        db.runSync(
          'UPDATE episode_ratings SET stars = ? WHERE showId = ? AND season = ? AND episode = ? AND stars = ?',
          [CORRECT[raw], id, Number(r.season_number), Number(r.episode_number), buggy],
        );
      } else if (raw >= 26 && raw <= 30) {
        // a brief internal build mis-imported legacy ratings as emotions —
        // remove the artifact; the re-import restores any real emotion after
        db.runSync('DELETE FROM episode_emotions WHERE showId = ? AND season = ? AND episode = ? AND emotion = ?', [
          id,
          Number(r.season_number),
          Number(r.episode_number),
          raw - 28,
        ]);
      }
    }
    for (const r of csvOf('ratings-live-votes.csv')) {
      const name = (r.movie_name || '').trim();
      const raw = Number((r.vote_key || '').split('-').pop());
      if (name && raw >= 26 && raw <= 30) {
        db.runSync('DELETE FROM emotions WHERE movie = ? AND value = ?', [name, raw]);
      }
    }

    return true;
  } catch {
    // corrupt zip — don't loop on it forever
    return true;
  }
}
