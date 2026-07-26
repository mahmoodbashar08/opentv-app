/**
 * On-device TV Time GDPR import: pick the export ZIP, parse its CSVs, and
 * fill SQLite — the same pipeline the build-time scripts ran, ported to run
 * on the phone. Posters resolve from TMDB during import; deep metadata
 * (episode titles, stills, cast) arrives lazily in later builds.
 */
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { strFromU8, unzipSync } from 'fflate';

import db, { dedupeDuplicateMovies, dedupeDuplicateShows, deletedMovieNames, deletedShowIds, getMeta, hasLibrary, libraryOwner, mergeImportedCustomLists, recountShow, setMeta, wipeAllData } from '@/db';
import { withImportLock } from '@/import-lock';
import { foundCsvsMessage, listPlaceholderName, uniqueListName } from '@/pure';
import { tmdb, pool } from '@/tmdb';

export type Progress = { phase: string; done: number; total: number; counts?: { shows: number; episodes: number; movies: number } };
/** total = rows in the export; added = new this import; existing = already in
 * the library (skipped, never duplicated); nameOnly = added but with no
 * database match — the item is in the library with its name and your history,
 * artwork/details pending */
export type CategoryStat = { total: number; added: number; existing: number; nameOnly: number };
/** id = the show's TVDB id, present on 'show' items so Fix match can target it */
export type NotImportedItem = { kind: 'show' | 'movie' | 'episodes' | 'ratings'; name: string; reason: string; id?: number };
export type ImportResult = {
  shows: number;
  episodes: number;
  movies: number;
  watchlist: number;
  username: string | null;
  /** true when imported on top of an existing library: nothing local was deleted, duplicates were skipped */
  merged: boolean;
  stats: {
    shows: CategoryStat;
    episodes: CategoryStat;
    moviesWatched: CategoryStat;
    watchlist: CategoryStat;
  };
  notImported: NotImportedItem[];
  /** TV Time duplicate placeholders (empty "(YEAR)" entries) merged into their
   *  real show — counted so the summary can explain the Total/In-app gap */
  foldedShows?: number;
  /** what the library holds after this import — import file + everything local */
  library: { shows: number; episodes: number; movies: number; watchlist: number };
};

// ---- tiny CSV parser (quoted fields, embedded commas/newlines) ---------------
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows;
  if (!header) return [];
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Pull a show's episode watches straight from the preserved original export and
 * insert any that are missing under the given ids. Targeted repair for when a
 * match reveals a show whose history never made it into the library — e.g. TV
 * Time split it across a "(2021)" placeholder and a watched "(2024)" entry, or
 * the show had been on the deleted list at import time so its rows were skipped.
 *
 * Reads only the two tracking CSVs, filters to the requested ids, and inserts
 * watches that aren't already there — no metadata, no network. Safe/idempotent:
 * re-running inserts nothing new. Returns how many rows it restored.
 */
export function restoreWatchesFromExport(tvdbIds: number[]): number {
  const ids = new Set(tvdbIds.filter((n) => Number.isFinite(n) && n > 0));
  if (ids.size === 0) return 0;
  let files: Record<string, Uint8Array>;
  try {
    const local = new File(Paths.document, 'tvtime-original.zip');
    if (!local.exists) return 0;
    files = unzipSync(b64ToBytes(local.base64Sync()));
  } catch {
    return 0; // no preserved export, or it couldn't be read/unzipped
  }
  const csv = (suffix: string): Record<string, string>[] => {
    const lo = suffix.toLowerCase();
    const key = Object.keys(files).find((k) => k.toLowerCase().endsWith(lo) && !k.includes('__MACOSX'));
    return key ? parseCsv(strFromU8(files[key])) : [];
  };
  type W = { showId: number; season: number; episode: number; watchedAt: string; rewatch: number; runtime: number | null };
  const watches: W[] = [];
  const seenKey = new Set<string>();
  for (const r of csv('tracking-prod-records-v2.csv')) {
    if (!r.s_id || !r.episode_number || !r.season_number || !ids.has(Number(r.s_id))) continue;
    const k = `${r.s_id}-${Number(r.season_number)}-${Number(r.episode_number)}`;
    if (seenKey.has(k)) continue;
    seenKey.add(k);
    watches.push({
      showId: Number(r.s_id),
      season: Number(r.season_number),
      episode: Number(r.episode_number),
      watchedAt: r.created_at || '',
      rewatch: Number(r.rewatch_count || 0) > 0 ? 1 : 0,
      runtime: r.runtime ? Number(r.runtime) : null,
    });
  }
  for (const r of csv('tracking-prod-records.csv')) {
    if (r.type !== 'watch' || r.entity_type !== 'episode' || !r.series_id || !r.episode_number || !r.season_number) continue;
    if (!ids.has(Number(r.series_id))) continue;
    const k = `${r.series_id}-${Number(r.season_number)}-${Number(r.episode_number)}`;
    if (seenKey.has(k)) continue;
    seenKey.add(k);
    watches.push({
      showId: Number(r.series_id),
      season: Number(r.season_number),
      episode: Number(r.episode_number),
      watchedAt: r.created_at || '',
      rewatch: 0,
      runtime: null,
    });
  }
  if (watches.length === 0) return 0;
  let restored = 0;
  db.withTransactionSync(() => {
    for (const w of watches) {
      const has = db.getFirstSync<{ x: number }>(
        'SELECT 1 AS x FROM watches WHERE showId = ? AND season = ? AND episode = ? LIMIT 1',
        [w.showId, w.season, w.episode],
      );
      if (has) continue;
      db.runSync('INSERT INTO watches (showId, season, episode, watchedAt, rewatch, runtime) VALUES (?, ?, ?, ?, ?, ?)', [
        w.showId,
        w.season,
        w.episode,
        w.watchedAt,
        w.rewatch,
        w.runtime,
      ]);
      restored++;
    }
  });
  for (const id of ids) recountShow(id, { neverLower: true });
  return restored;
}

// grab a CDN image into the app's documents; returns the saved filename.
// hard 15s timeout: a dead-but-hanging CDN link (TV Time's are dying) must
// never stall the import — it aborts and the letter/placeholder stands in
async function fetchToDocuments(url: string, name: string, timeoutMs = 15000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const dest = new File(Paths.document, name);
    if (dest.exists) dest.delete();
    dest.write(bytes);
    return name;
  } catch {
    return null; // CDN link dead or timed out — the letter avatar stands in
  } finally {
    clearTimeout(timer);
  }
}

// TV Time served profile covers from TheTVDB's retired CloudFront mirror,
// deleted along with the shutdown — but the same fanart still exists on
// TheTVDB's current CDN under the legacy banners path:
//   dg31sz3gwrwan.cloudfront.net/fanart/<seriesId>/<upload>-<n>-q80.jpg
//     → artworks.thetvdb.com/banners/fanart/original/<seriesId>-<n>.jpg
export function tvdbRescueUrl(url: string): string | null {
  const m = /^https?:\/\/dg31sz3gwrwan\.cloudfront\.net\/fanart\/(\d+)\/\d+-(\d+)(?:-q\d+)?\.(jpe?g|png)$/i.exec(url);
  return m ? `https://artworks.thetvdb.com/banners/fanart/original/${m[1]}-${m[2]}.${m[3]}` : null;
}

// the original link first, then the TheTVDB rewrite now that the original is dead
async function fetchCoverToDocuments(url: string, name: string): Promise<string | null> {
  const direct = await fetchToDocuments(url, name);
  if (direct) return direct;
  const rescue = tvdbRescueUrl(url);
  return rescue ? fetchToDocuments(rescue, name) : null;
}

/**
 * One-shot startup repair for libraries whose import ran after TV Time's CDN
 * died: the cover download failed then, but the rewrite above can still reach
 * it on TheTVDB — grab it onto the device while THAT CDN is still alive.
 * Costs at most one request per launch; bounded so a permanently-gone cover
 * (404 on both hosts) stops being retried.
 */
export async function recoverProfileCover(): Promise<void> {
  if (getMeta('coverFile')) return;
  const url = getMeta('coverUrl');
  if (!url) return;
  const tries = Number(getMeta('coverRescueTries') ?? '0') || 0;
  if (tries >= 5) return;
  setMeta('coverRescueTries', String(tries + 1));
  const saved = await fetchCoverToDocuments(url, `profile-cover-${Date.now()}.jpg`);
  if (saved) setMeta('coverFile', saved);
}

export async function pickAndImport(
  onProgress: (p: Progress) => void,
  mode: 'merge' | 'replace' = 'merge',
): Promise<ImportResult | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['application/zip', 'public.zip-archive', 'application/octet-stream', 'text/csv', 'application/json', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
  });
  if (picked.canceled || !picked.assets?.[0]) return null;

  onProgress({ phase: 'Reading export…', done: 0, total: 1 });
  const b64 = new File(picked.assets[0].uri).base64Sync();
  const bytes = b64ToBytes(b64);
  const isZip = bytes.length > 1 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  // prove the archive is readable BEFORE any wipe — a corrupt or wrong file
  // must never cost the user their library (unzipSync throws on garbage)
  if (isZip) unzipSync(bytes);

  // Stage the export on disk BEFORE importing, then run under the import lock so
  // a concurrent startup resume can't stomp the same staged file / flag.
  // importZipBytes commits in one final transaction, so an import cut short (iOS
  // suspends a backgrounded app after ~30s, or the user force-quits) writes
  // nothing — with the ZIP already staged and importPending set, the next launch
  // finishes the job itself instead of stranding the user. Staged under a temp
  // name so a wrong-file pick can't clobber a good preserved export from a
  // previous import; it's promoted to the real preserved copy only once the
  // import commits, and the flag clears only after the promote so a disk-full
  // promote leaves the flag + staged file for resume to retry.
  const result = await withImportLock(async () => {
    const staged = new File(Paths.document, 'tvtime-importing.zip');
    let stagedOk = false;
    try {
      if (staged.exists) staged.delete();
      staged.write(bytes);
      stagedOk = true;
    } catch {
      // out of disk — resume won't be possible for this run
    }
    // the replace wipe is destructive: never erase the library if we couldn't
    // even stage the export, or a disk-full pick would wipe it with no recovery
    if (mode === 'replace') {
      if (!stagedOk) throw new Error('Not enough storage to import safely. Free up some space and try again.');
      wipeAllData(); // wipes meta too — flag AFTER it
    }
    if (stagedOk) {
      setMeta('importResumeTries', '0');
      setMeta('importPending', '1');
    }

    const r = await importZipBytes(bytes, onProgress, picked.assets[0].name);

    // committed — promote the staged export to the preserved original (the
    // rebuilt backup ZIP loses TV Time's server-side files, and a future
    // backend will want the real thing), THEN clear the flag last: a failed
    // promote keeps the flag + staged file so resume finishes it next launch
    try {
      const orig = new File(Paths.document, 'tvtime-original.zip');
      if (orig.exists) orig.delete();
      orig.write(bytes);
      if (staged.exists) staged.delete();
      setMeta('importPending', '');
    } catch {
      // out of disk on the promote — DB import already committed; resume retries
    }
    return r;
  });

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ICloud = (require('../modules/icloud-drive') as typeof import('../modules/icloud-drive')).default;
    if (ICloud?.isAvailable()) await ICloud.writeFile('TV Time Original.zip', b64);
  } catch {
    // no iCloud in this build/session — the local copy above still stands
  }
  // libraries that predate zip preservation stamped the repair revision with
  // nothing to repair from — now that the original exists, run the one
  // repair that lives outside the importer (it's a no-op when already clean)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { migrateVoteScale } = require('@/migrations') as typeof import('@/migrations');
    await migrateVoteScale();
  } catch {
    // best-effort — the import itself already succeeded
  }
  // rescue any comment images beyond the in-import batch, in the background —
  // keeps import fast for power users (thousands of comment photos) while still
  // pulling every image local before TV Time's CDN goes dark
  void downloadPendingCommentImages();
  return result;
}

/**
 * Re-link comment images that already exist on the device but lost their DB
 * reference. The erase → re-import path keeps Documents while rebuilding every
 * row, and now that TV Time's CDN is dead the re-download can never refill
 * them — but the files from the earlier import are still right there.
 * In-import files are `comment-img-<stamp>-<i>.<ext>` where i is the row's
 * position among image-bearing comments (stable across imports of the same
 * export); the background fill uses `comment-img-bg-<id>.<ext>`. Match both,
 * preferring the exact id form, then the newest stamp.
 */
export function relinkOrphanedCommentImages(): void {
  try {
    const rows = db.getAllSync<{ id: number; imageUrl: string; image: string | null }>(
      "SELECT id, imageUrl, image FROM comments WHERE imageUrl IS NOT NULL AND imageUrl != '' ORDER BY id",
    );
    if (!rows.some((r) => !r.image)) return;
    const names = new Directory(Paths.document)
      .list()
      .map((e) => e.name)
      .filter((n) => n.startsWith('comment-img-'));
    rows.forEach((row, i) => {
      if (row.image) return;
      const ext = /\.(gif|png|webp)(\?|$)/i.exec(row.imageUrl)?.[1]?.toLowerCase() ?? 'jpg';
      const bg = `comment-img-bg-${row.id}.${ext}`;
      const pick = names.includes(bg)
        ? bg
        : (names.filter((n) => new RegExp(`^comment-img-\\d+-${i}\\.${ext}$`).test(n)).sort().pop() ?? null);
      if (pick) db.runSync('UPDATE comments SET image = ? WHERE id = ?', [pick, row.id]);
    });
  } catch {
    // listing failure must never block the network fill that follows
  }
}

let commentFillRunning = false;
/** Download comment images not grabbed during import (beyond the in-import
 * batch, or a run cut short) and store them locally. Each image is attempted
 * once — a dead CloudFront link sets imageTried so it's never retried forever.
 * Safe to call on launch and after every import. */
export async function downloadPendingCommentImages(): Promise<void> {
  if (commentFillRunning) return; // never two passes at once
  commentFillRunning = true;
  try {
    // free wins first: images already on the device from an earlier import
    relinkOrphanedCommentImages();
    const pending = db.getAllSync<{ id: number; imageUrl: string }>(
      "SELECT id, imageUrl FROM comments WHERE imageUrl IS NOT NULL AND imageUrl != '' AND (image IS NULL OR image = '') AND imageTried = 0",
    );
    if (pending.length === 0) return;
    await pool(
      pending,
      async (row) => {
        // keep the real extension — GIFs must stay .gif to animate
        const ext = /\.(gif|png|webp)(\?|$)/i.exec(row.imageUrl)?.[1]?.toLowerCase() ?? 'jpg';
        const saved = await fetchToDocuments(row.imageUrl, `comment-img-bg-${row.id}.${ext}`);
        // mark tried either way so a dead link isn't re-fetched every launch
        db.runSync('UPDATE comments SET image = COALESCE(?, image), imageTried = 1 WHERE id = ?', [saved, row.id]);
        return null;
      },
      6,
    );
  } finally {
    commentFillRunning = false;
  }
}

/** The whole import pipeline from raw ZIP bytes — shared by the file picker
 * and the iCloud restore path. Merges when a real library already exists:
 * local rows always win, export rows only fill gaps, nothing is deleted. */
export async function importZipBytes(zipBytes: Uint8Array, onProgress: (p: Progress) => void, singleFileName?: string): Promise<ImportResult> {
  // re-importing must never wipe what the user did since the first import;
  // only the bundled demo library gets replaced outright
  const merge = hasLibrary() && libraryOwner() !== 'seed';
  const notImported: NotImportedItem[] = [];
  
  let files: Record<string, Uint8Array>;
  const isZip = zipBytes.length > 1 && zipBytes[0] === 0x50 && zipBytes[1] === 0x4b;
  
  if (isZip) {
    files = unzipSync(zipBytes);

    // ---- unwrap nested ZIPs (double-zipped exports) --------------------------------
    // Some users' downloads arrive as a .zip containing another .zip with no CSVs
    // at the outer level. If we find zero CSVs but an inner .zip, unwrap it
    // automatically so the import just works instead of reporting "0 items".
    const outerKeys = Object.keys(files);
    const hasAnyCsv = outerKeys.some((k) => k.toLowerCase().endsWith('.csv') && !k.includes('__MACOSX'));
    if (!hasAnyCsv) {
      const innerZipKey = outerKeys.find((k) => k.toLowerCase().endsWith('.zip') && !k.includes('__MACOSX'));
      if (innerZipKey) {
        try {
          files = unzipSync(files[innerZipKey]);
        } catch {
          // inner zip was corrupt — fall through to the normal "0 items" error
        }
      }
    }
  } else if (singleFileName) {
    // raw file upload (e.g., a single csv or json from an alternative export)
    files = { [singleFileName]: zipBytes };
  } else {
    throw new Error("Unrecognized file format");
  }

  // OpenTV sidecar, present in our own backups/exports: database links made
  // in-app. Seeding them skips refetching and keeps the user's Fix match work.
  type Extras = {
    movies?: { name: string; tmdbId: number | null; poster: string | null; year: string | null; watchedOn?: string | null; stars?: number | null; rewatchCount?: number | null }[];
    epStars?: { showId: number; season: number; episode: number; stars: number }[];
    epWatchedOn?: { showId: number; season: number; episode: number; source: string }[];
    epCharVotes?: { showId: number; season: number; episode: number; name: string | null; charId: number | null }[];
    shows?: { tvdbId: number; tmdbId: number | null; posterUrl: string | null; addedAt: string | null; finished?: number; posterOverride?: string | null; backdropOverride?: string | null }[];
    profile?: { avatarFile?: string | null; coverFile?: string | null };
    commentImages?: { url: string; file: string }[];
    socialImages?: { url: string; file: string }[];
  };
  let extras: Extras = {};
  try {
    const raw = files['_opentv_extras.json'];
    if (raw) extras = JSON.parse(strFromU8(raw)) as Extras;
  } catch {
    // corrupt sidecar — proceed as a plain TV Time import
  }
  const extrasMovie = new Map((extras.movies ?? []).map((m) => [m.name, m]));

  // images bundled by our own exporter/backups (TV Time's CDN is dead, so
  // these files ARE the pictures now) — restore them to Documents up front so
  // the fetch stages below find them already present instead of re-trying
  // URLs that resolve to nothing
  for (const key of Object.keys(files)) {
    if (!key.startsWith('_opentv_images/')) continue;
    const name = key.slice('_opentv_images/'.length);
    if (!name || name.includes('/') || name.includes('..')) continue;
    try {
      const f = new File(Paths.document, name);
      if (!f.exists) f.write(files[key]);
    } catch {
      // out of disk or an unwritable name — the relink repair just won't find it
    }
  }
  // a bundled file only counts if it actually made it onto disk
  const bundledFile = (name: string | null | undefined): string | null => {
    if (!name) return null;
    try {
      return new File(Paths.document, name).exists ? name : null;
    } catch {
      return null;
    }
  };

  const csv = (suffix: string): Record<string, string>[] => {
    const lo = suffix.toLowerCase();
    const key = Object.keys(files).find((k) => k.toLowerCase().endsWith(lo) && !k.includes('__MACOSX'));
    return key ? parseCsv(strFromU8(files[key])) : [];
  };
  // exact filename first — "episode_comment" must never match
  // episode_comment_like.csv; loose match only as fallback for renamed files
  const csvLoose = (part: string): Record<string, string>[] => {
    const lo = part.toLowerCase();
    const keys = Object.keys(files).filter((k) => k.toLowerCase().endsWith('.csv') && !k.includes('__MACOSX'));
    const key =
      keys.find((k) => { const kl = k.toLowerCase(); return kl === `${lo}.csv` || kl.endsWith(`/${lo}.csv`); }) ??
      keys.find((k) => k.toLowerCase().includes(lo));
    return key ? parseCsv(strFromU8(files[key])) : [];
  };

  onProgress({ phase: 'Parsing your history…', done: 0, total: 1 });

  // ---- fallback for unofficial third-party exports ---------------------------
  // If the user exported via a browser extension (like Amanda), they won't have
  // the official GDPR files. They have 'tvtime-series.csv', 'tvtime-series-episodes.csv',
  // and 'tvtime-movies.csv'. We intercept these and map them to the GDPR schema
  // so the rest of the importer can process them seamlessly.
  let showRows = csv('user_tv_show_data.csv');
  let v2all = csv('tracking-prod-records-v2.csv');
  let v1 = csv('tracking-prod-records.csv');

  if (v2all.length === 0 && showRows.length === 0) {
    // match a community-export CSV by its basename tokens, tolerant of the date
    // suffix the extension appends (tvtime-series-2026-07-02.csv). `mustNot`
    // keeps the series file from also matching tvtime-series-EPISODES.
    const communityCsv = (must: string, mustNot?: string): Record<string, string>[] => {
      const key = Object.keys(files).find((k) => {
        if (k.includes('__MACOSX') || !k.toLowerCase().endsWith('.csv')) return false;
        const base = (k.split('/').pop() ?? '').toLowerCase();
        return base.includes(must) && (!mustNot || !base.includes(mustNot));
      });
      return key ? parseCsv(strFromU8(files[key])) : [];
    };
    const altSeries = communityCsv('tvtime-series', 'episodes'); // series, NOT the episodes file
    if (altSeries.length > 0) {
      showRows = altSeries.map((r) => ({
        tv_show_id: r.tvdb_id,
        tv_show_name: r.title,
        // "stopped"/"stopped_watching" → archived; everything else stays followed
        is_followed: '1',
        is_favorited: '0',
        archived: (r.status || '').toLowerCase().includes('stop') ? '1' : '0',
      }));
    }
    const altEpisodes = communityCsv('tvtime-series-episodes');
    if (altEpisodes.length > 0) {
      v2all = altEpisodes
        .filter((r) => r.is_watched?.toLowerCase() === 'true')
        .map((r) => ({
          s_id: r.series_tvdb_id,
          season_number: r.season,
          episode_number: r.episode,
          created_at: r.watched_at,
          rewatch_count: r.rewatch_count,
          series_name: r.title,
        }));
    }
    const altMovies = communityCsv('tvtime-movies');
    if (altMovies.length > 0) {
      // watched → a watch row; not-yet-watched → a watchlist (towatch) row, so
      // the user's movie watchlist survives too (was previously dropped)
      v1 = altMovies.map((r) => {
        const watched = r.is_watched?.toLowerCase() === 'true';
        return {
          type: watched ? 'watch' : 'towatch',
          entity_type: 'movie',
          movie_name: r.title,
          created_at: watched ? r.watched_at || r.created_at : r.created_at,
          // the extension puts the rewatch total inline on the watched row (GDPR
          // uses separate rewatch rows) — the movie builder reads it below
          rewatch_count: (watched && r.rewatch_count) || '0',
        };
      });
    }
  }

  // ---- shows + follow state --------------------------------------------------
  const archived = new Map(csv('followed_tv_show.csv').map((r) => [r.tv_show_id, r.archived === '1']));
  for (const r of showRows) {
    if (!r.tv_show_id && r.tv_show_name) {
      notImported.push({ kind: 'show', name: r.tv_show_name, reason: 'Export row has no TV Time show id' });
    }
  }
  // shows the user deleted on purpose stay deleted — without this, every
  // silent self-repair re-import would resurrect them from the preserved
  // export (replace mode wipes meta first, so a clean start imports everything)
  // ---- episode watches: v2 events + v1 legacy events ---------------------------
  // v2 has one row per watch event but misses the earliest era; v1 holds the
  // 2021-vintage watches that never made it across. Parsed here (before the
  // deleted-list filter) so a show's real history can veto a stale deletion.
  const dead = deletedShowIds();
  // a show you actually watched (the export still carries episode rows for it)
  // is real data — never let a stale "deleted" flag skip it and silently lose
  // that history. Revive any such id, and persist so it stops being skipped.
  {
    const watchedIds = new Set<number>();
    for (const r of v2all) if (r.s_id && r.episode_number && r.season_number) watchedIds.add(Number(r.s_id));
    for (const r of v1)
      if (r.type === 'watch' && r.entity_type === 'episode' && r.series_id && r.episode_number && r.season_number)
        watchedIds.add(Number(r.series_id));
    const revived = [...dead].filter((id) => watchedIds.has(id));
    if (revived.length) {
      for (const id of revived) dead.delete(id);
      setMeta('deletedShows', JSON.stringify([...dead]));
    }
  }
  const shows = showRows
    .filter((r) => r.tv_show_id && !dead.has(Number(r.tv_show_id)))
    .map((r) => ({
      tvdbId: Number(r.tv_show_id),
      name: r.tv_show_name,
      episodesSeen: Number(r.nb_episodes_seen || 0),
      followed: r.is_followed === '1',
      favorited: r.is_favorited === '1',
      // GDPR carries archived state in followed_tv_show.csv; the community export
      // carries it inline (mapped to r.archived) — honour whichever is present
      archived: archived.get(r.tv_show_id) ?? r.archived === '1',
    }));

  const watches = v2all
    .filter((r) => r.s_id && r.episode_number && r.season_number)
    .map((r) => ({
      showId: Number(r.s_id),
      season: Number(r.season_number),
      episode: Number(r.episode_number),
      watchedAt: r.created_at || '',
      rewatch: Number(r.rewatch_count || 0) > 0 ? 1 : 0,
      runtime: r.runtime ? Number(r.runtime) : null,
      episodeId: Number(r.episode_id) || null,
    }));
  {
    const inV2 = new Set(watches.map((w) => `${w.showId}-${w.season}-${w.episode}`));
    for (const r of v1) {
      if (r.type !== 'watch' || r.entity_type !== 'episode' || !r.series_id || !r.episode_number || !r.season_number) continue;
      const key = `${r.series_id}-${Number(r.season_number)}-${Number(r.episode_number)}`;
      if (inV2.has(key)) continue;
      inV2.add(key);
      watches.push({
        showId: Number(r.series_id),
        season: Number(r.season_number),
        episode: Number(r.episode_number),
        watchedAt: r.created_at || '',
        rewatch: 0,
        runtime: null,
        episodeId: Number(r.episode_id) || null,
      });
    }
  }
  // explicit-row snapshot BEFORE any rebuild fills — the counter correction
  // and the phantom retraction below both need to know what the export
  // actually contains, not what we synthesized
  const explicitKeys = new Map<number, Set<string>>();
  const firstWatchAt = new Map<number, string>();
  for (const w of watches) {
    if (!explicitKeys.has(w.showId)) explicitKeys.set(w.showId, new Set());
    explicitKeys.get(w.showId)!.add(`${w.season}-${w.episode}`);
    if (!firstWatchAt.has(w.showId) && w.watchedAt) firstWatchAt.set(w.showId, w.watchedAt);
  }
  // the moment each show was bulk-marked, from its v2 series row — also the
  // timestamp the ≤1.1.2 fill stamped on every row it invented
  const seriesDate = new Map<number, string>();
  for (const r of v2all) {
    if (r.s_id && !r.episode_number) seriesDate.set(Number(r.s_id), r.created_at || '');
  }

  // ---- movies: watched + watchlist from v1 tracking ---------------------------
  type Movie = { name: string; watchedAt: string | null; addedAt: string | null; runtime: number | null; rewatches: number };
  const movieMap = new Map<string, Movie>();
  for (const r of v1) {
    if (r.type !== 'watch' || !r.movie_name) continue;
    const cur = movieMap.get(r.movie_name);
    const at = r.created_at || '';
    if (!cur || (cur.watchedAt ?? '') < at) {
      movieMap.set(r.movie_name, {
        name: r.movie_name,
        watchedAt: at,
        addedAt: null,
        runtime: r.runtime ? Number(r.runtime) : (cur?.runtime ?? null),
        // GDPR carries rewatches in separate rows (folded in below); the
        // community export puts the total inline on the watch row — take either
        rewatches: Math.max(cur?.rewatches ?? 0, Number(r.rewatch_count || 0)),
      });
    }
  }
  // rewatches live in their own row types: 'rewatch' (one per event, with a
  // running count) and 'rewatch_count' (the total) — take the max seen
  for (const r of v1) {
    if ((r.type === 'rewatch' || r.type === 'rewatch_count') && r.movie_name) {
      const cur = movieMap.get(r.movie_name);
      if (cur) cur.rewatches = Math.max(cur.rewatches, Number(r.rewatch_count || 0));
    }
  }
  for (const r of v1) {
    if (r.type !== 'towatch' || !r.movie_name || movieMap.has(r.movie_name)) continue;
    movieMap.set(r.movie_name, { name: r.movie_name, watchedAt: null, addedAt: r.created_at || '', runtime: null, rewatches: 0 });
  }
  // movies the user deleted on purpose stay deleted (repair does INSERT OR
  // REPLACE, which would otherwise resurrect them); replace mode wipes meta,
  // so a clean start re-imports everything
  const deadMovies = deletedMovieNames();
  const movies = [...movieMap.values()].filter((m) => !deadMovies.has(m.name));

  // ---- episode + movie votes ---------------------------------------------------
  // TV Time rates on a 0..3 scale (BAD, GOOD, GREAT, WOW) for BOTH episodes
  // and movies — verified against real exports (no 4s among 150+ votes)
  const VOTE_TO_STARS: Record<number, number> = { 0: 1, 1: 3, 2: 4, 3: 5 };
  // ratings carry TWO id formats in the same file: the current 0..3 scale
  // and a legacy 26..30 five-level scale (28=GOOD, 29=GREAT — confirmed
  // against real votes). Emotion ids 28..39 exist ONLY in the emotions file;
  // the numeric overlap is coincidence, the id spaces are per-file.
  const LEGACY_TO_STARS: Record<number, number> = { 26: 1, 27: 2, 28: 3, 29: 4, 30: 5 };
  const ratingStars = (v: number): number | null => VOTE_TO_STARS[v] ?? LEGACY_TO_STARS[v] ?? null;
  const epRatings = csv('ratings-3-prod-episode_votes.csv')
    .map((r) => ({
      name: r.series_name,
      season: Number(r.season_number),
      episode: Number(r.episode_number),
      stars: ratingStars(Number((r.vote_key || '').split('-').pop())),
      epId: Number(r.episode_id) || null,
    }))
    .filter((r): r is typeof r & { stars: number } => !!r.name && r.stars != null);
  const epEmotions = csv('emotions-3-prod-episode_votes.csv')
    .map((r) => ({
      name: r.series_name,
      season: Number(r.season_number),
      episode: Number(r.episode_number),
      emotion: Number((r.vote_key || '').split('-').pop()) - 28,
      epId: Number(r.episode_id) || null,
    }))
    .filter((r) => r.name && r.emotion >= 0 && r.emotion <= 11);
  // "where did you watch" per episode — source id 3 is TV Time's Computer
  // bucket (confirmed against real usage); anything else lands on Other
  const epWatchedOn = csv('watched_on_episode.csv')
    .map((r) => ({
      name: r.tv_show_name,
      season: Number(r.episode_season_number),
      episode: Number(r.episode_number),
      src: Number(r.watched_on_source_id),
      epId: Number(r.episode_id) || null,
    }))
    .filter((r) => r.name && r.episode > 0 && Number.isFinite(r.src));

  // "who was your favorite?" votes — TV Time stored only its internal
  // character id, so the vote imports as a count (name stays unknown);
  // OpenTV's own backups carry the name in the sidecar instead
  const charVotes = csv('show_character_episode_vote.csv')
    .map((r) => ({
      name: r.tv_show_name,
      season: Number(r.episode_season_number),
      episode: Number(r.episode_number),
      charId: Number(r.show_character_id) || null,
      epId: Number(r.episode_id) || null,
    }))
    .filter((r) => r.name && r.episode > 0);

  const movieRatings = csv('ratings-live-votes.csv')
    .map((r) => ({ name: (r.movie_name || '').trim(), stars: ratingStars(Number((r.vote_key || '').split('-').pop())) }))
    .filter((r): r is typeof r & { stars: number } => !!r.name && r.stars != null);
  const movieEmotions = csv('emotions-live-votes.csv')
    .map((r) => ({ name: (r.movie_name || '').trim(), value: Number((r.vote_key || '').split('-').pop()) }))
    .filter((r) => r.name && r.value >= 28 && r.value <= 39);

  // ---- favorites: shows also live in the favorite-series list (with order),
  // movies only in favorite-movies as tracking uuids -----------------------------
  // uuid → movie name, from BOTH tracking eras — a list movie whose uuid only
  // appears in v2 would otherwise be dropped from the list
  const uuidToMovie = new Map<string, string>();
  for (const r of [...v1, ...v2all]) {
    if (r.uuid && r.movie_name && !uuidToMovie.has(r.uuid)) uuidToMovie.set(r.uuid, r.movie_name);
  }
  const listRows = csvLoose('lists-prod-lists');
  const rowText = (r: Record<string, string>) => Object.values(r).join(' ');
  const listRow = (key: string) => listRows.find((r) => Object.values(r).includes(key));
  const favMovieRow = listRow('favorite-movies');
  const favMovieNames = favMovieRow
    ? [...rowText(favMovieRow).matchAll(/uuid:([0-9a-f-]{36})/g)]
        .map((m) => uuidToMovie.get(m[1]))
        .filter((n): n is string => !!n)
    : [];
  const favSeriesRow = listRow('favorite-series');
  // [\s[] before "id:" keeps uuid:… fragments from matching
  const favShowIds = favSeriesRow
    ? [...rowText(favSeriesRow).matchAll(/[\s[]id:(\d+)/g)].map((m) => Number(m[1]))
    : [];

  // ---- profile + the TV Time ids that reconnect the social graph later ----------
  const userRow = csv('routing-prod-users.csv')[0];
  const username = userRow?.username ?? null;
  const tvtimeUserId = userRow?.user_id ?? null;
  const friendIds = csv('friend.csv')
    .map((r) => r.friend_id)
    .filter(Boolean);
  // votes reference shows by NAME only — match case/space-insensitively and
  // learn alias spellings from the tracking rows, or ratings silently vanish
  const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const byName = new Map(shows.map((s) => [nameKey(s.name), s.tvdbId]));
  for (const r of v2all) {
    if (r.s_id && r.series_name && !byName.has(nameKey(r.series_name))) {
      byName.set(nameKey(r.series_name), Number(r.s_id));
    }
  }

  // TheTVDB episode ids per (show, season, episode). Every row kind in the
  // export carries one, and the exporter writes them back out so a round-trip
  // export stays byte-compatible with TV Time's own.
  const rowIdsByShow = new Map<number, Record<string, number>>();
  const recordRowId = (showId: number | null | undefined, season: number, episode: number, epId: number | null) => {
    if (!showId || !epId) return;
    let ids = rowIdsByShow.get(showId);
    if (!ids) rowIdsByShow.set(showId, (ids = {}));
    ids[`${season}-${episode}`] ??= epId;
  };
  for (const w of watches) recordRowId(w.showId, w.season, w.episode, w.episodeId);
  for (const r of epRatings) recordRowId(byName.get(nameKey(r.name)), r.season, r.episode, r.epId);
  for (const e of epEmotions) recordRowId(byName.get(nameKey(e.name)), e.season, e.episode, e.epId);
  for (const w of epWatchedOn) recordRowId(byName.get(nameKey(w.name)), w.season, w.episode, w.epId);
  for (const v of charVotes) recordRowId(byName.get(nameKey(v.name)), v.season, v.episode, v.epId);

  // ---- personal info + profile photos (download now, before TV Time's CDN
  // goes dark); unique filenames because expo-image caches by uri ------------------
  const personal = csvLoose('user_personal_data');
  const pval = (k: string) => personal.find((r) => r.name === k)?.value?.trim() || null;
  const avatarUrl = userRow?.image_url || null;
  const coverUrl = pval('cover');
  const countryCode = pval('country-code');
  const bio = pval('bio');
  // gender + birthday live in the connected-account files, not personal_data
  const fbRow = csvLoose('user_facebook_data')[0];
  const socialRow = csvLoose('user_social_data')[0];
  const cap = (s: string | undefined | null) => (s ? s[0].toUpperCase() + s.slice(1) : null);
  const gender = pval('gender') ?? cap(fbRow?.gender) ?? cap(socialRow?.gender);
  const birthday = fbRow?.birthday || socialRow?.birthday || '';
  const birthYear = pval('birth-year') ?? (/^(\d{4})-/.exec(birthday)?.[1] ?? null);

  // ---- your own comments, from both comment systems -------------------------------
  // 'like' rows are likes you gave, not comments — skip them
  const imgUrlOf = (blob: string) => /url:(https?:\/\/[^\s\]]+)/.exec(blob || '')?.[1] ?? null;
  const imgRatioOf = (blob: string) => {
    const w = Number(/width:(\d+)/.exec(blob || '')?.[1]);
    const h = Number(/height:(\d+)/.exec(blob || '')?.[1]);
    return w > 0 && h > 0 ? w / h : null;
  };
  const commentRows = [
    ...csvLoose('comments-prod-comments')
      .filter((r) => (r.type === 'comment' || r.type === 'reply') && (r.movie_name || r.series_name))
      .filter((r) => (r.text || '').trim() || r.image)
      .map((r) => ({
        type: r.type,
        entity: (r.movie_name || r.series_name).trim(),
        text: (r.text || '').trim(),
        date: r.created_at || '',
        likes: Number(r.like_count || 0),
        replies: Number(r.reply_count || 0),
        imageUrl: imgUrlOf(r.image),
        ratio: imgRatioOf(r.image),
      })),
    ...(() => {
      // legacy episode comments: memes/photos live in meme.csv, joined by id
      const memes = csvLoose('meme');
      const memeUrlOf = (commentId: string) => {
        const m = memes.find((x) => x.episode_comment_id === commentId);
        if (!m) return null;
        return (
          [m.url, m.medium_url, m.gif_url, m.gif_medium_url, m.small_url].find((u) => u && u.startsWith('http')) ?? null
        );
      };
      return csvLoose('episode_comment')
        .filter((r) => r.tv_show_name)
        .map((r) => ({
          type: 'comment',
          entity: `${r.tv_show_name} S${Number(r.episode_season_number || 0)}E${Number(r.episode_number || 0)}`,
          text: ((r.comment || '').trim() || (r.extended_comment || '').trim()),
          date: r.created_at || '',
          likes: Number(r.nb_likes || 0),
          replies: 0,
          imageUrl: memeUrlOf(r.id),
          ratio: null,
        }))
        .filter((c) => c.text || c.imageUrl);
    })(),
  ];

  // ---- social graph: followers + names, mined from your notifications -------------
  // ("X followed you" events carry the name, profile id and avatar; the JSON
  // payload sits in the `data` column, and commenter ids hide in avatar urls)
  const notifications = csvLoose('notifications-prod-notifications');
  const blobOf = (r: Record<string, string>) => `${r.data || ''} ${r.objects || ''}`;
  const profileIdOf = (r: Record<string, string>) =>
    /profile\/(\d+)/.exec(`${r.url} ${blobOf(r)}`)?.[1] ?? /\/user\/(\d+)\//.exec(r.image || '')?.[1] ?? null;
  const nameFromLocKey = (r: Record<string, string>) =>
    /"loc-key":"(.+?) (followed|liked|commented|replied|mentioned|sent)/.exec(blobOf(r))?.[1]?.trim() || null;
  const idName = new Map<string, { name: string; imageUrl: string | null }>();
  const followers: { id: string; name: string; imageUrl: string | null }[] = [];
  for (const r of notifications) {
    const id = profileIdOf(r);
    const name = nameFromLocKey(r);
    if (!id || !name) continue;
    const imageUrl = (r.image || '').startsWith('http') ? r.image : null;
    if (!idName.has(id)) idName.set(id, { name, imageUrl });
    if ((r.type === 'user-followed' || r.type === 'user-followed-back') && !followers.some((f) => f.id === id)) {
      followers.push({ id, name, imageUrl });
    }
  }
  onProgress({ phase: 'Fetching your profile photos…', done: 0, total: 1 });
  const stamp = Date.now();
  // a copy bundled in the ZIP (our own backup/export) beats re-fetching a
  // URL the shutdown killed; a live URL still downloads fresh as before
  const bundledAvatar = bundledFile(extras.profile?.avatarFile);
  const bundledCover = bundledFile(extras.profile?.coverFile);
  const [avatarFile, coverFile] = await Promise.all([
    bundledAvatar
      ? Promise.resolve(bundledAvatar)
      : avatarUrl
        ? fetchToDocuments(avatarUrl, `profile-avatar-${stamp}.jpg`)
        : Promise.resolve(null),
    bundledCover
      ? Promise.resolve(bundledCover)
      : coverUrl
        ? fetchCoverToDocuments(coverUrl, `profile-cover-${stamp}.jpg`)
        : Promise.resolve(null),
  ]);

  // comment photos too — same reasoning, the CDN won't outlive the shutdown.
  // downloaded concurrently (was one-at-a-time — the single biggest import
  // stall); the index rides along so filenames stay unique without a counter
  const withImages = commentRows.filter((c) => c.imageUrl);
  const commentImages = new Map<string, string>();
  for (const m of extras.commentImages ?? []) {
    if (bundledFile(m.file)) commentImages.set(m.url, m.file);
  }
  const commentTargets = withImages
    .filter((c) => !commentImages.has(c.imageUrl!))
    .slice(0, 100)
    .map((c, i) => ({ c, i }));
  await pool(
    commentTargets,
    async ({ c, i }) => {
      // keep the real extension — GIFs must stay .gif to animate
      const ext = /\.(gif|png|webp)(\?|$)/i.exec(c.imageUrl!)?.[1]?.toLowerCase() ?? 'jpg';
      const saved = await fetchToDocuments(c.imageUrl!, `comment-img-${stamp}-${i}.${ext}`);
      if (saved) commentImages.set(c.imageUrl!, saved);
      return null;
    },
    8,
    (done) => onProgress({ phase: 'Saving your comment photos…', done, total: commentTargets.length }),
  );

  // friends' avatars as well — small files, big difference once the CDN dies
  const socialUrls = [
    ...new Set([...followers.map((f) => f.imageUrl), ...[...idName.values()].map((v) => v.imageUrl)].filter((u): u is string => !!u)),
  ];
  const socialImages = new Map<string, string>();
  for (const m of extras.socialImages ?? []) {
    if (bundledFile(m.file)) socialImages.set(m.url, m.file);
  }
  await pool(
    socialUrls
      .filter((url) => !socialImages.has(url))
      .slice(0, 60)
      .map((url, i) => ({ url, i })),
    async ({ url, i }) => {
      const saved = await fetchToDocuments(url, `social-img-${stamp}-${i}.jpg`);
      if (saved) socialImages.set(url, saved);
      return null;
    },
    8,
  );

  // the notification history itself — badge unlocks, follows, likes, comments
  const notificationFeed = notifications
    .map((r) => {
      const text = (r.text || '').trim() || (/"loc-key":"(.+?)"/.exec(blobOf(r))?.[1] ?? '');
      const time = Number(r.time || 0);
      const imageUrl = (r.image || '').startsWith('http') ? r.image : null;
      return {
        text,
        time,
        date: time ? new Date(time).toISOString().slice(0, 10) : '',
        image: imageUrl ? (socialImages.get(imageUrl) ?? imageUrl) : null,
      };
    })
    .filter((n) => n.text)
    .sort((a, b) => b.time - a.time)
    .slice(0, 100)
    .map(({ text, date, image }) => ({ text, date, image }));

  // ---- resolve artwork from TMDB, on the phone -----------------------------------
  let doneCount = 0;
  const report = (phase: string, total: number) => (done: number) =>
    onProgress({ phase, done, total });

  const showPosters = new Map<number, string>();
  const showTmdb = new Map<number, number>();
  // shows TMDB can't find but TheTVDB can (TV Time is TheTVDB-native, so its
  // tvdbId is a direct hit) — resolved here so they don't show as "needs
  // attention"; their episode lists fill from the launch metadata pre-cache
  const showTvdb = new Set<number>();
  // shows recovered by name (TVDB-id lookup failed) get their link persisted as
  // a hint so the runtime metadata fetch doesn't re-run the same failing lookup
  const showTmdbFromName = new Map<number, number>();
  // normalize titles for confident matching — case, accents, Arabic variants
  // and punctuation ignored (same rule the movie matcher uses)
  const normTitle = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f\u064b-\u0670]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  await pool(
    shows,
    async (s) => {
      const found = await tmdb<{ tv_results: { id: number; poster_path?: string }[] }>(
        `/find/${s.tvdbId}?external_source=tvdb_id`,
      );
      const hit = found.tv_results?.[0];
      if (hit?.id) {
        showTmdb.set(s.tvdbId, hit.id);
        if (hit.poster_path) showPosters.set(s.tvdbId, `https://image.tmdb.org/t/p/w342${hit.poster_path}`);
        return null;
      }
      // TV Time's old TheTVDB ids don't always map to TMDB's stored tvdb_id
      // (e.g. Prison Break, Reign) — fall back to a confident name match so
      // mainstream shows still get artwork and episodes instead of nothing.
      // A wrong poster is worse than none, so require an exact title match.
      try {
        // strip only fan-added noise suffixes that never distinguish a real
        // show — TV Time appends these ("Lego Elves webisodes"), TMDB doesn't.
        // Meaningful discriminators like "(US)" or "(2005)" are left intact.
        const query = s.name.replace(/\s+(webisodes?|minisodes?|shorts?|specials?|web series)$/i, '').trim();
        const res = await tmdb<{ results: { id: number; name?: string; original_name?: string; poster_path?: string; vote_count?: number }[] }>(
          `/search/tv?query=${encodeURIComponent(query)}`,
        );
        const want = normTitle(query);
        const exact = (res.results ?? []).filter((x) => normTitle(x.name || '') === want || normTitle(x.original_name || '') === want);
        const pick = exact.sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))[0];
        if (pick) {
          showTmdb.set(s.tvdbId, pick.id);
          showTmdbFromName.set(s.tvdbId, pick.id);
          if (pick.poster_path) showPosters.set(s.tvdbId, `https://image.tmdb.org/t/p/w342${pick.poster_path}`);
        }
      } catch {
        // search failed — the show still imports name-only, Fix Match available
      }
      // still no TMDB match → TheTVDB by tvdbId (a direct, reliable hit). Fills
      // the poster now; episode lists arrive via the launch metadata pre-cache.
      if (!showTmdb.has(s.tvdbId)) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { tvdbSeries } = require('@/tvdb') as typeof import('@/tvdb');
          const tv = await tvdbSeries(s.tvdbId);
          if (tv) {
            showTvdb.add(s.tvdbId);
            if (tv.image && !tv.image.includes('/images/missing/')) showPosters.set(s.tvdbId, tv.image);
          }
        } catch {
          // TheTVDB unreachable / no key — falls through to name-only
        }
      }
      return null;
    },
    10,
    (done) =>
      onProgress({
        phase: 'Finding show artwork…',
        done,
        total: shows.length,
        // live tallies for the import screen to count up
        counts: { shows: shows.length, episodes: watches.length, movies: movies.length },
      }),
  );
  // persist EVERY resolved TMDB link, not just name-recovered ones. Metadata
  // resolves through the hint, and — critically — dedupeDuplicateShows at the
  // end of this import reads these to tell same-named shows apart. Without
  // them a fresh import knows no identities, and its guard failed open: the
  // 2024 "Avatar" live-action (8 watches) was folded into the 2005 animated
  // (61 watches), its overlapping episodes dropped and its row deleted.
  for (const [tvdbId, tmdbId] of showTmdb) {
    db.runSync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [`showTmdbHint:${tvdbId}`, String(tmdbId)]);
  }
  // sidecar links fill what the lookup missed — a show the user fix-matched
  // stays matched across restores
  for (const ex of extras.movies ?? []) {
    if (ex.watchedOn) {
      db.runSync('UPDATE movies SET watchedOn = COALESCE(watchedOn, ?) WHERE name = ?', [ex.watchedOn, ex.name]);
    }
    if (ex.stars != null) {
      // exact OpenTV stars beat the lossy TV Time-format CSV approximation
      db.runSync(merge ? 'UPDATE movies SET stars = COALESCE(stars, ?) WHERE name = ?' : 'UPDATE movies SET stars = ? WHERE name = ?', [ex.stars, ex.name]);
    }
    if (ex.rewatchCount != null && ex.rewatchCount > 0) {
      db.runSync('UPDATE movies SET rewatchCount = ? WHERE name = ? AND COALESCE(rewatchCount, 0) < ?', [
        ex.rewatchCount,
        ex.name,
        ex.rewatchCount,
      ]);
    }
  }
  for (const ex of extras.epWatchedOn ?? []) {
    db.runSync(
      `INSERT OR ${merge ? 'IGNORE' : 'REPLACE'} INTO episode_watched_on (showId, season, episode, source) VALUES (?, ?, ?, ?)`,
      [ex.showId, ex.season, ex.episode, ex.source],
    );
  }
  for (const ex of extras.epStars ?? []) {
    // exact OpenTV stars beat the lossy TV Time-format CSV approximation
    db.runSync(
      merge
        ? 'UPDATE episode_ratings SET stars = ? WHERE showId = ? AND season = ? AND episode = ?'
        : 'INSERT OR REPLACE INTO episode_ratings (showId, season, episode, stars) VALUES (?, ?, ?, ?)',
      merge ? [ex.stars, ex.showId, ex.season, ex.episode] : [ex.showId, ex.season, ex.episode, ex.stars],
    );
  }
  for (const ex of extras.shows ?? []) {
    if (ex.tmdbId && !showTmdb.has(ex.tvdbId)) showTmdb.set(ex.tvdbId, ex.tmdbId);
    if (ex.posterUrl && !showPosters.has(ex.tvdbId)) showPosters.set(ex.tvdbId, ex.posterUrl);
  }
  // TV Time keeps a stale placeholder for shows announced years before release
  // (e.g. "Avatar: The Last Airbender (2021)") next to the real, watched entry
  // ("… (2024)"). The placeholder has 0 watches and no database match, so it
  // otherwise nags as "needs attention" forever and leaves an empty duplicate.
  // Fold it silently into the watched sibling that shares its base name.
  const baseNm = (name: string) =>
    name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+\d{4}\s*$/, '').trim();
  const watchedMatchedByBase = new Map<string, number>();
  for (const s of shows) {
    const watched = (explicitKeys.get(s.tvdbId)?.size ?? 0) > 0;
    if (watched && (showTmdb.has(s.tvdbId) || showTvdb.has(s.tvdbId))) watchedMatchedByBase.set(baseNm(s.name), s.tvdbId);
  }
  const foldedPlaceholders = new Set<number>();
  for (const s of shows) {
    if (showTmdb.has(s.tvdbId) || showTvdb.has(s.tvdbId)) continue;
    const sibling = watchedMatchedByBase.get(baseNm(s.name));
    const isYearPlaceholder = /\(\d{4}\)\s*$/.test(s.name);
    const noHistory = (explicitKeys.get(s.tvdbId)?.size ?? 0) === 0;
    if (isYearPlaceholder && noHistory && sibling && sibling !== s.tvdbId) {
      foldedPlaceholders.add(s.tvdbId);
      setMeta(`showRemap:${s.tvdbId}`, String(sibling)); // any stray link resolves to the real show
    }
  }

  // shows resolve by TVDB id — an exact lookup — so a miss means TMDB simply
  // doesn't know the show; it still imports with everything you logged
  for (const s of shows) {
    if (foldedPlaceholders.has(s.tvdbId)) continue; // known TV Time duplicate — not a real gap
    if (!showTmdb.has(s.tvdbId) && !showTvdb.has(s.tvdbId)) {
      notImported.push({ kind: 'show', name: s.name, reason: 'Not found on TMDB or TheTVDB — artwork and episode lists may be missing', id: s.tvdbId });
    }
  }

  // ---- bulk-marked shows: TV Time sometimes stored ONLY a count (plus at
  // most a stray row or two), not one row per episode — rebuild those so
  // history, progress and continue tracking work. Shows with a real row
  // history never get topped up: their counter surplus is rewatch/re-mark
  // inflation (verified: counts exceeding a show's real episode total), and
  // filling from it invents watches the user never made. The two clusters
  // are far apart in practice (1 row/84 seen vs 73 rows/87 seen).
  const bulkOnly = new Set<number>();
  // shows whose rebuild was attempted but produced nothing this run (offline,
  // no TMDB match): their previously-filled history must survive retraction,
  // and the repair revision must not be stamped as done
  const fillFailed = new Set<number>();
  {
    const gapShows = shows.filter((s) => {
      const rows = explicitKeys.get(s.tvdbId)?.size ?? 0;
      return rows <= 2 && s.episodesSeen >= rows + 8;
    });
    for (const s of gapShows) bulkOnly.add(s.tvdbId);
    let gapDone = 0;
    for (const s of gapShows) {
      onProgress({ phase: 'Restoring bulk-marked episodes…', done: gapDone++, total: gapShows.length });
      // season structure: bundled metadata when we have it, else one TMDB call
      let seasonCounts: [number, number][] = [];
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { showMeta } = require('@/metadata') as typeof import('@/metadata');
        const m = showMeta(s.tvdbId);
        if (m) seasonCounts = Object.entries(m.seasons).map(([n, v]) => [Number(n), v.count]);
      } catch {}
      if (seasonCounts.length === 0) {
        const tid = showTmdb.get(s.tvdbId);
        const missing = s.episodesSeen - (explicitKeys.get(s.tvdbId)?.size ?? 0);
        if (!tid) {
          fillFailed.add(s.tvdbId);
          notImported.push({ kind: 'episodes', name: s.name, reason: `${missing} bulk-marked episodes couldn't be rebuilt — no TMDB match` });
          continue;
        }
        try {
          const d = await tmdb<{ seasons?: { season_number: number; episode_count?: number }[] }>(`/tv/${tid}`);
          seasonCounts = (d.seasons ?? []).map((x) => [x.season_number, x.episode_count ?? 0]);
        } catch {
          fillFailed.add(s.tvdbId);
          notImported.push({ kind: 'episodes', name: s.name, reason: `${missing} bulk-marked episodes couldn't be rebuilt — TMDB lookup failed` });
          continue;
        }
      }
      seasonCounts.sort((a, b) => a[0] - b[0]);
      const have = new Set<string>(explicitKeys.get(s.tvdbId) ?? []);
      let need = s.episodesSeen - have.size;
      const fillDate = seriesDate.get(s.tvdbId) || firstWatchAt.get(s.tvdbId) || '';
      // fill regular seasons from the start (fill-previous semantics); never
      // specials — the counter counts regular episodes, and padding specials
      // marks content the user never touched
      for (const [season, count] of seasonCounts) {
        if (season < 1) continue;
        for (let epn = 1; epn <= count && need > 0; epn++) {
          if (have.has(`${season}-${epn}`)) continue;
          have.add(`${season}-${epn}`);
          watches.push({ showId: s.tvdbId, season, episode: epn, watchedAt: fillDate, rewatch: 0, runtime: null, episodeId: null });
          need--;
        }
        if (need <= 0) break;
      }
    }
  }

  type Resolved = { poster: string | null; year: string | null; tmdbId: number | null };
  const movieInfo = new Map<string, Resolved>();
  await pool(
    movies,
    async (m) => {
      // a link carried in the sidecar (earlier match or the user's Fix match)
      // beats searching again
      const ex = extrasMovie.get(m.name);
      if (ex?.tmdbId) {
        movieInfo.set(m.name, { poster: ex.poster, year: ex.year, tmdbId: ex.tmdbId });
        return null;
      }
      const res = await tmdb<{
        results: { title?: string; original_title?: string; poster_path?: string; release_date?: string; id: number; vote_count?: number }[];
      }>(`/search/movie?query=${encodeURIComponent(m.name)}`);
      // confident matches only — same title or original title once case,
      // accents, Arabic diacritics/letter variants and punctuation are
      // ignored. A wrong poster is worse than no poster: unmatched movies
      // still import bare and get reported
      const norm = (s: string) =>
        s
          .toLowerCase()
          .normalize('NFKD')
          .replace(/[\u0300-\u036f\u064b-\u0670]/g, '')
          .replace(/[أإآٱ]/g, 'ا')
          .replace(/ى/g, 'ي')
          .replace(/ة/g, 'ه')
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim();
      const want = norm(m.name);
      const exact = res.results.filter((x) => norm(x.title || '') === want || norm(x.original_title || '') === want);
      const pick = exact.sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))[0];
      if (pick) {
        movieInfo.set(m.name, {
          poster: pick.poster_path ? `https://image.tmdb.org/t/p/w342${pick.poster_path}` : null,
          year: (pick.release_date || '').slice(0, 4) || null,
          tmdbId: pick.id,
        });
      }
      // no confident TMDB match → TheTVDB (v4 covers movies), exact-name only so
      // it never attaches the wrong poster. No tmdbId, so it stays fix-matchable.
      if (!movieInfo.get(m.name)) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { tvdbFindMovie } = require('@/tvdb') as typeof import('@/tvdb');
          const tv = await tvdbFindMovie(m.name);
          if (tv?.image && !tv.image.includes('/images/missing/')) {
            movieInfo.set(m.name, { poster: tv.image, year: tv.year, tmdbId: null });
          }
        } catch {
          // TheTVDB unreachable / no key — falls through to name-only
        }
      }
      return null;
    },
    10,
    (done) => onProgress({ phase: 'Finding movie artwork…', done, total: movies.length }),
  );
  const unmatchedMovies = new Set<string>();
  for (const m of movies) {
    if (!movieInfo.get(m.name)) {
      unmatchedMovies.add(m.name);
      notImported.push({ kind: 'movie', name: m.name, reason: 'No confident match on TMDB or TheTVDB — artwork or year may be missing' });
    }
  }
  void doneCount;
  void report;

  // ---- custom lists the user made in TV Time (beyond favorites) --------------
  // each list row's `objects` holds {type:series id:…} and {type:movie uuid:…};
  // resolve them to names + posters so the Lists tab shows them like TV Time did
  const showById = new Map(shows.map((s) => [s.tvdbId, s.name]));
  type ListItem = { kind: 'show' | 'movie'; name: string; poster: string | null; tvdbId?: number };
  // TV Time only exports a name for *public* lists; private lists arrive nameless
  // (the name lived server-side and is gone). Don't drop them — their items are
  // intact — just give them an identifiable placeholder from the created date.
  const customLists = listRows
    .filter((r) => r.type === 'list' && r.s_key !== 'favorite-movies' && r.s_key !== 'favorite-series')
    .map((r) => {
      const items: ListItem[] = [];
      // uuids with no name anywhere in the export (movies listed but never
      // tracked/rated — TV Time kept their names server-side). Preserved so
      // the true list size shows and a future uuid→movie map can fill them in.
      const unresolved: string[] = [];
      let total = 0;
      for (const mm of (r.objects || '').matchAll(/map\[([^\]]*)\]/g)) {
        const body = mm[1];
        if (/type:series/.test(body)) {
          total++;
          const id = Number(/id:(\d+)/.exec(body)?.[1]);
          if (id && showById.has(id)) items.push({ kind: 'show', tvdbId: id, name: showById.get(id)!, poster: showPosters.get(id) ?? null });
        } else if (/type:movie/.test(body)) {
          total++;
          const uuid = /uuid:([0-9a-f-]{36})/.exec(body)?.[1];
          const nm = uuid ? uuidToMovie.get(uuid) : null;
          if (nm) items.push({ kind: 'movie', name: nm, poster: movieInfo.get(nm)?.poster ?? null });
          else if (uuid) unresolved.push(uuid);
        }
      }
      return {
        name: (r.name || '').trim() || listPlaceholderName(r.created_at || ''),
        items,
        movieCount: items.filter((i) => i.kind === 'movie').length,
        totalCount: total,
        unresolved,
      };
    })
    .filter((l) => l.totalCount > 0);
  // two private lists made the same month collide on the placeholder name, and
  // lists are keyed by name — disambiguate duplicates with a numeric suffix
  const seenListNames = new Set<string>();
  for (const l of customLists) l.name = uniqueListName(l.name, seenListNames);

  // ---- fail loudly instead of "imported 0" ----------------------------------------
  // If we parsed no shows, episodes AND movies, the ZIP had a layout we didn't
  // recognise (nested/renamed files, or a partial/wrong export) — every csv()
  // returned []. Reporting a cheerful "Import completed" with an empty library
  // is the worst outcome for a "bring your TV Time history" app, so surface a
  // real error naming what we actually found. import.tsx shows the message.
  if (shows.length === 0 && watches.length === 0 && movies.length === 0) {
    throw new Error(
      `We couldn't read any shows, episodes or movies from this file. Please make sure it's the full TV Time data export (the ZIP they email you), not a screenshot or a partial file. ${foundCsvsMessage(Object.keys(files))}`,
    );
  }

  // ---- write everything to SQLite, atomically -------------------------------------
  // merge mode: local rows always win, the export only fills gaps — importing
  // twice adds nothing twice, and nothing the user did in OpenTV is lost
  onProgress({ phase: 'Saving to your library…', done: 0, total: 1 });
  const added = { shows: 0, episodes: 0, moviesWatched: 0, watchlist: 0 };
  const existing = { shows: 0, episodes: 0, moviesWatched: 0, watchlist: 0 };
  const nameOnly = { shows: 0, moviesWatched: 0, watchlist: 0 };
  const unknownRatingShows = new Map<string, number>();
  db.withTransactionSync(() => {
    if (!merge) {
      db.runSync('DELETE FROM shows');
      db.runSync('DELETE FROM watches');
      db.runSync('DELETE FROM movies');
      db.runSync('DELETE FROM episode_ratings');
      db.runSync('DELETE FROM episode_emotions');
      db.runSync('DELETE FROM comments');
    }

    for (const s of shows) {
      // a folded TV Time year-placeholder is a known duplicate of a watched
      // entry — don't create an empty ghost row for it
      if (foldedPlaceholders.has(s.tvdbId)) continue;
      // rows are the truth when they exist; the raw counter is inflated by
      // rewatches/re-marks and would overstate progress forever. Bulk-only
      // shows are the exception: there the counter IS the record.
      const effectiveSeen = bulkOnly.has(s.tvdbId)
        ? s.episodesSeen
        : (explicitKeys.get(s.tvdbId)?.size ?? s.episodesSeen);
      const row = [s.tvdbId, s.name, showPosters.get(s.tvdbId) ?? null, effectiveSeen, s.followed ? 1 : 0, s.favorited ? 1 : 0, s.archived ? 1 : 0];
      if (merge) {
        const r = db.runSync(
          'INSERT OR IGNORE INTO shows (tvdbId, name, posterUrl, episodesSeen, followed, favorited, archived) VALUES (?, ?, ?, ?, ?, ?, ?)',
          row,
        );
        if (r.changes === 0) {
          existing.shows++;
          // local follow/favorite/archive state wins; only fill missing artwork
          // and correct the episode counter (older imports stored it inflated)
          const p = showPosters.get(s.tvdbId);
          if (p) db.runSync('UPDATE shows SET posterUrl = COALESCE(posterUrl, ?) WHERE tvdbId = ?', [p, s.tvdbId]);
          db.runSync('UPDATE shows SET episodesSeen = ? WHERE tvdbId = ?', [effectiveSeen, s.tvdbId]);
        } else {
          added.shows++;
          if (!showTmdb.has(s.tvdbId) && !showTvdb.has(s.tvdbId)) nameOnly.shows++;
        }
      } else {
        db.runSync(
          'INSERT OR REPLACE INTO shows (tvdbId, name, posterUrl, episodesSeen, followed, favorited, archived) VALUES (?, ?, ?, ?, ?, ?, ?)',
          row,
        );
        added.shows++;
        if (!showTmdb.has(s.tvdbId)) nameOnly.shows++;
      }
    }
    // export rows live in TVDB numbering; rows a previous remap pass moved
    // carry the same identity at their TMDB position — resolve through the
    // per-show remap record or every repair would re-insert moved episodes
    const remapInv = new Map<number, Map<string, string>>();
    const remappedPos = (showId: number, key: string): string | null => {
      let inv = remapInv.get(showId);
      if (!inv) {
        inv = new Map();
        try {
          const raw = db.getFirstSync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [`epRemap:${showId}`])?.value;
          if (raw) for (const [to, from] of Object.entries(JSON.parse(raw) as Record<string, string>)) inv.set(from, to);
        } catch {}
        remapInv.set(showId, inv);
      }
      return inv.get(key) ?? null;
    };
    for (const w of watches) {
      if (dead.has(w.showId)) continue; // deleted on purpose — stays deleted
      if (merge) {
        const moved = remappedPos(w.showId, `${w.season}-${w.episode}`);
        const [ms, me] = moved ? moved.split('-').map(Number) : [w.season, w.episode];
        const seen = db.getFirstSync<{ x: number }>(
          'SELECT 1 AS x FROM watches WHERE showId = ? AND ((season = ? AND episode = ?) OR (season = ? AND episode = ?)) LIMIT 1',
          [w.showId, w.season, w.episode, ms, me],
        );
        if (seen) {
          existing.episodes++;
          continue;
        }
      }
      db.runSync('INSERT INTO watches (showId, season, episode, watchedAt, rewatch, runtime) VALUES (?, ?, ?, ?, ?, ?)', [
        w.showId,
        w.season,
        w.episode,
        w.watchedAt,
        w.rewatch,
        w.runtime,
      ]);
      added.episodes++;
    }
    if (merge) {
      // retract what the ≤1.1.2 bulk fill invented: it topped shows up to the
      // inflated counter, stamping every synthetic row with the show's fill
      // timestamp. Any row carrying that stamp that is neither in the export
      // nor produced by this import's fill rules never happened — remove it.
      // Real check-ins made in-app can't collide: their timestamps are set at
      // the moment of tapping, long after the export's fill dates.
      const finalKeys = new Map<number, Set<string>>();
      for (const w of watches) {
        if (!finalKeys.has(w.showId)) finalKeys.set(w.showId, new Set());
        finalKeys.get(w.showId)!.add(`${w.season}-${w.episode}`);
      }
      for (const s of shows) {
        // a show whose rebuild produced nothing this run keeps its previous
        // fill — retracting it would erase real history over a network blip
        if (fillFailed.has(s.tvdbId)) continue;
        // the old fill's timestamp expression fell back from the v2 series
        // row's date to the first watch's date — check both stamps
        const stamps = [seriesDate.get(s.tvdbId), firstWatchAt.get(s.tvdbId)].filter((d): d is string => !!d);
        if (stamps.length === 0) continue;
        const keep = new Set(finalKeys.get(s.tvdbId) ?? []);
        // rows a previous remap pass moved onto TMDB numbering are real
        // watches under a different key — never retract them
        try {
          const remapRaw = db.getFirstSync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [`epRemap:${s.tvdbId}`])?.value;
          if (remapRaw) for (const k of Object.keys(JSON.parse(remapRaw) as Record<string, string>)) keep.add(k);
        } catch {}
        for (const fillDate of new Set(stamps)) {
          const suspects = db.getAllSync<{ id: number; season: number; episode: number }>(
            'SELECT id, season, episode FROM watches WHERE showId = ? AND watchedAt = ? AND rewatch = 0',
            [s.tvdbId, fillDate],
          );
          for (const row of suspects) {
            if (!keep.has(`${row.season}-${row.episode}`)) db.runSync('DELETE FROM watches WHERE id = ?', [row.id]);
          }
        }
      }
    }
    // the TVDB episode ids behind every imported row — the remap pass and
    // future exports both key off these
    for (const [sid, ids] of rowIdsByShow) {
      const key = `tvdbRowIds:${sid}`;
      const prevRaw = db.getFirstSync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])?.value;
      let prev: Record<string, number> = {};
      try {
        if (prevRaw) prev = JSON.parse(prevRaw) as Record<string, number>;
      } catch {}
      db.runSync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, JSON.stringify({ ...prev, ...ids })]);
    }
    for (const m of movies) {
      const bucket = m.watchedAt ? 'moviesWatched' : 'watchlist';
      const info = movieInfo.get(m.name);
      if (merge) {
        const cur = db.getFirstSync<{ watchedAt: string | null }>('SELECT watchedAt FROM movies WHERE name = ?', [m.name]);
        if (cur) {
          existing[bucket]++;
          // the export saying "watched" adds information; the reverse would
          // erase a watch the user logged here — never do that
          if (m.watchedAt && !cur.watchedAt) db.runSync('UPDATE movies SET watchedAt = ? WHERE name = ?', [m.watchedAt, m.name]);
          if (info) {
            db.runSync('UPDATE movies SET poster = COALESCE(poster, ?), year = COALESCE(year, ?), tmdbId = COALESCE(tmdbId, ?) WHERE name = ?', [
              info.poster,
              info.year,
              info.tmdbId,
              m.name,
            ]);
          }
          continue;
        }
      }
      db.runSync(
        'INSERT OR REPLACE INTO movies (name, originalName, poster, year, tmdbId, stars, watchedAt, runtime, addedAt, rewatchCount) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)',
        [m.name, m.name, info?.poster ?? null, info?.year ?? null, info?.tmdbId ?? null, m.watchedAt, m.runtime, m.addedAt, m.rewatches || null],
      );
      added[bucket]++;
      if (unmatchedMovies.has(m.name)) nameOnly[bucket]++;
    }
    // rewatch counts for movies that already existed — higher value wins
    for (const m of movies) {
      if (m.rewatches > 0) {
        db.runSync('UPDATE movies SET rewatchCount = ? WHERE name = ? AND COALESCE(rewatchCount, 0) < ?', [
          m.rewatches,
          m.name,
          m.rewatches,
        ]);
      }
    }
    for (const r of movieRatings) {
      // merge: a rating set in OpenTV outranks the old TV Time one
      db.runSync(merge ? 'UPDATE movies SET stars = ? WHERE name = ? AND stars IS NULL' : 'UPDATE movies SET stars = ? WHERE name = ?', [
        r.stars,
        r.name,
      ]);
    }
    for (const e of movieEmotions) {
      if (merge && db.getFirstSync<{ x: number }>('SELECT 1 AS x FROM emotions WHERE movie = ? AND value = ? LIMIT 1', [e.name, e.value])) continue;
      db.runSync('INSERT INTO emotions (movie, value) VALUES (?, ?)', [e.name, e.value]);
    }
    for (const r of epRatings) {
      const id = byName.get(nameKey(r.name));
      if (id == null) {
        unknownRatingShows.set(r.name, (unknownRatingShows.get(r.name) ?? 0) + 1);
        continue;
      }
      db.runSync(`INSERT OR ${merge ? 'IGNORE' : 'REPLACE'} INTO episode_ratings (showId, season, episode, stars) VALUES (?, ?, ?, ?)`, [
        id,
        r.season,
        r.episode,
        r.stars,
      ]);
    }
    for (const w of epWatchedOn) {
      const id = byName.get(nameKey(w.name));
      if (id == null) continue;
      db.runSync(
        `INSERT OR ${merge ? 'IGNORE' : 'REPLACE'} INTO episode_watched_on (showId, season, episode, source) VALUES (?, ?, ?, ?)`,
        [id, w.season, w.episode, w.src === 3 ? 'Computer' : 'Other'],
      );
    }
    for (const v of charVotes) {
      const id = byName.get(nameKey(v.name));
      if (id == null) continue;
      db.runSync(
        `INSERT OR ${merge ? 'IGNORE' : 'REPLACE'} INTO character_votes (showId, season, episode, name, charId) VALUES (?, ?, ?, NULL, ?)`,
        [id, v.season, v.episode, v.charId],
      );
    }
    for (const e of epEmotions) {
      const id = byName.get(nameKey(e.name));
      if (id == null) {
        unknownRatingShows.set(e.name, (unknownRatingShows.get(e.name) ?? 0) + 1);
        continue;
      }
      db.runSync('INSERT OR IGNORE INTO episode_emotions (showId, season, episode, emotion) VALUES (?, ?, ?, ?)', [
        id,
        e.season,
        e.episode,
        e.emotion,
      ]);
    }
    for (const c of commentRows) {
      if (
        merge &&
        db.getFirstSync<{ x: number }>('SELECT 1 AS x FROM comments WHERE entity = ? AND text = ? AND date = ? LIMIT 1', [c.entity, c.text, c.date])
      ) {
        continue;
      }
      db.runSync(
        'INSERT INTO comments (type, entity, text, date, likes, replies, image, imageUrl, ratio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [c.type, c.entity, c.text, c.date, c.likes, c.replies, c.imageUrl ? (commentImages.get(c.imageUrl) ?? null) : null, c.imageUrl, c.ratio],
      );
    }
    // followers (with names + avatars) and names for the people you follow,
    // both mined from the notifications file; image = local copy, imageUrl = original
    const person = (id: string, name: string | null, imageUrl: string | null) => ({
      id,
      name,
      image: imageUrl ? (socialImages.get(imageUrl) ?? null) : null,
      imageUrl,
    });
    db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('tvtimeFollowers', ?)", [
      JSON.stringify(followers.map((f) => person(f.id, f.name, f.imageUrl))),
    ]);
    db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('tvtimeFollowingNames', ?)", [
      JSON.stringify(friendIds.map((id) => person(id, idName.get(id)?.name ?? null, idName.get(id)?.imageUrl ?? null))),
    ]);
    db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('tvtimeNotifications', ?)", [
      JSON.stringify(notificationFeed),
    ]);
    // favorites arrive in the list's own order — rank keeps it on display
    favShowIds.forEach((id, i) => db.runSync('UPDATE shows SET favorited = 1, favoriteRank = ? WHERE tvdbId = ?', [i, id]));
    favMovieNames.forEach((name, i) => db.runSync('UPDATE movies SET favorited = 1, favoriteRank = ? WHERE name = ?', [i, name]));
    // merge keeps profile edits made in OpenTV; a first import takes the export's values
    const putProfile = (key: string, value: string) =>
      db.runSync(`INSERT OR ${merge ? 'IGNORE' : 'REPLACE'} INTO meta (key, value) VALUES (?, ?)`, [key, value]);
    if (avatarFile) putProfile('avatarFile', avatarFile);
    if (coverFile) putProfile('coverFile', coverFile);
    // original CDN links, so an export round-trips them
    if (avatarUrl) putProfile('avatarUrl', avatarUrl);
    if (coverUrl) putProfile('coverUrl', coverUrl);
    if (countryCode) putProfile('countryCode', countryCode);
    if (bio) putProfile('bio', bio);
    if (gender) putProfile('gender', gender);
    if (birthYear) putProfile('birthYear', birthYear);
    if (username) putProfile('username', username);
    // preserved for the future social backend: your old TV Time identity and
    // follow list reconnect automatically when those people join
    if (tvtimeUserId) db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('tvtimeUserId', ?)", [tvtimeUserId]);
    if (friendIds.length) {
      db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('tvtimeFriends', ?)", [JSON.stringify(friendIds)]);
    }
    // imported data replaces any bundled versions — mark them current
    db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('votesVersion', 'imported')");
    // your TV Time custom lists (shows + movies), shown on the Lists tab.
    // merge-safe: keep the user's created/renamed/deleted-list edits instead of
    // blindly overwriting, so a silent repair re-import never undoes them
    db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('customLists', ?)", [
      JSON.stringify(mergeImportedCustomLists(customLists)),
    ]);
    db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('moviesVersion', 'imported')");
    db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('libraryOwner', 'imported')");
    // freshly imported shows need metadata — let the offline pre-cache resume
    db.runSync("DELETE FROM meta WHERE key = 'metaCacheComplete'");
  });

  for (const [name, n] of unknownRatingShows) {
    notImported.push({ kind: 'ratings', name, reason: `${n} episode vote${n === 1 ? '' : 's'} for a show that isn't in the export's library` });
  }

  // sidecar leftovers that live outside the CSV data: the tvdb→tmdb link
  // hints (used by lazy metadata fetches) and in-app added dates
  for (const ex of extras.movies ?? []) {
    if (ex.watchedOn) {
      db.runSync('UPDATE movies SET watchedOn = COALESCE(watchedOn, ?) WHERE name = ?', [ex.watchedOn, ex.name]);
    }
    if (ex.stars != null) {
      // exact OpenTV stars beat the lossy TV Time-format CSV approximation
      db.runSync(merge ? 'UPDATE movies SET stars = COALESCE(stars, ?) WHERE name = ?' : 'UPDATE movies SET stars = ? WHERE name = ?', [ex.stars, ex.name]);
    }
    if (ex.rewatchCount != null && ex.rewatchCount > 0) {
      db.runSync('UPDATE movies SET rewatchCount = ? WHERE name = ? AND COALESCE(rewatchCount, 0) < ?', [
        ex.rewatchCount,
        ex.name,
        ex.rewatchCount,
      ]);
    }
  }
  for (const ex of extras.epWatchedOn ?? []) {
    db.runSync(
      `INSERT OR ${merge ? 'IGNORE' : 'REPLACE'} INTO episode_watched_on (showId, season, episode, source) VALUES (?, ?, ?, ?)`,
      [ex.showId, ex.season, ex.episode, ex.source],
    );
  }
  for (const ex of extras.epStars ?? []) {
    // exact OpenTV stars beat the lossy TV Time-format CSV approximation —
    // upsert so a rating whose CSV row was remapped elsewhere still lands
    db.runSync('INSERT OR REPLACE INTO episode_ratings (showId, season, episode, stars) VALUES (?, ?, ?, ?)', [
      ex.showId,
      ex.season,
      ex.episode,
      ex.stars,
    ]);
  }
  for (const ex of extras.epCharVotes ?? []) {
    // exact OpenTV votes (with character names) beat the id-only CSV rows
    db.runSync('INSERT OR REPLACE INTO character_votes (showId, season, episode, name, charId) VALUES (?, ?, ?, ?, ?)', [
      ex.showId,
      ex.season,
      ex.episode,
      ex.name,
      ex.charId,
    ]);
  }
  for (const ex of extras.shows ?? []) {
    if (ex.tmdbId) {
      db.runSync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [`showTmdbHint:${ex.tvdbId}`, String(ex.tmdbId)]);
    }
    if (ex.addedAt) db.runSync('UPDATE shows SET addedAt = COALESCE(addedAt, ?) WHERE tvdbId = ?', [ex.addedAt, ex.tvdbId]);
    // restore the manual "finished" mark (never unset — a backup only adds it back)
    if (ex.finished) db.runSync('UPDATE shows SET finished = 1 WHERE tvdbId = ?', [ex.tvdbId]);
    // restore the user's custom poster / backdrop (Customize) so a backup keeps them
    if (ex.posterOverride) {
      db.runSync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [`posterOverride:${ex.tvdbId}`, ex.posterOverride]);
      db.runSync('UPDATE shows SET posterUrl = ? WHERE tvdbId = ?', [ex.posterOverride, ex.tvdbId]);
    }
    if (ex.backdropOverride) {
      db.runSync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [`backdropOverride:${ex.tvdbId}`, ex.backdropOverride]);
    }
  }

  // fold TV Time's deprecated duplicate show entries into one (empty ghosts +
  // split watches) so a fresh import never shows "0 watched" copies — same pass
  // the startup repair runs, and idempotent when there's nothing to merge
  try {
    dedupeDuplicateShows();
    // and the two spellings of one film (watched "Dune (2021)" + watchlist "Dune")
    dedupeDuplicateMovies();
  } catch {
    // dedupe is best-effort — never fail an otherwise-good import over it
  }

  // a fresh import with the current importer IS the repair — stamp the
  // revision so startup self-repairs skip this install until the next bump.
  // NOT when a bulk rebuild failed: stamping would turn a network blip into
  // a permanently un-run repair, so leave it pending and retry on launch.
  if (fillFailed.size === 0) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { REPAIR_REV } = require('@/migrations') as typeof import('@/migrations');
    db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('repairRev', ?)", [REPAIR_REV]);
  }

  const moviesWatchedTotal = movies.filter((m) => m.watchedAt).length;
  const watchlistTotal = movies.filter((m) => !m.watchedAt).length;
  const libCount = (sql: string) => db.getFirstSync<{ n: number }>(sql)?.n ?? 0;
  return {
    library: {
      shows: libCount('SELECT COUNT(*) AS n FROM shows'),
      episodes: libCount('SELECT COUNT(*) AS n FROM watches'),
      movies: libCount('SELECT COUNT(*) AS n FROM movies WHERE watchedAt IS NOT NULL'),
      watchlist: libCount('SELECT COUNT(*) AS n FROM movies WHERE watchedAt IS NULL'),
    },
    shows: shows.length,
    episodes: watches.length,
    movies: moviesWatchedTotal,
    watchlist: watchlistTotal,
    username,
    merged: merge,
    foldedShows: foldedPlaceholders.size,
    stats: {
      shows: { total: shows.length, added: added.shows, existing: existing.shows, nameOnly: nameOnly.shows },
      episodes: { total: watches.length, added: added.episodes, existing: existing.episodes, nameOnly: 0 },
      moviesWatched: { total: moviesWatchedTotal, added: added.moviesWatched, existing: existing.moviesWatched, nameOnly: nameOnly.moviesWatched },
      watchlist: { total: watchlistTotal, added: added.watchlist, existing: existing.watchlist, nameOnly: nameOnly.watchlist },
    },
    notImported,
  };
}
