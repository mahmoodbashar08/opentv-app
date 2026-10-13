/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { strFromU8, unzipSync } from 'fflate';

import { parseCsv } from './csv';

/** An unzipped export: path inside the ZIP → raw bytes. */
export type ExportFiles = Record<string, Uint8Array>;
export type Row = Record<string, string>;

const isZipBytes = (bytes: Uint8Array) => bytes.length > 1 && bytes[0] === 0x50 && bytes[1] === 0x4b;

/**
 * The export's files, from the ZIP TV Time emailed.
 *
 * DOUBLE-ZIPPED EXPORTS ARE UNWRAPPED. Some downloads arrive as a .zip holding
 * another .zip and no CSVs at the outer level; reading only the outer one
 * reports "0 items" for an export that is perfectly complete. When there is no
 * CSV outside but a ZIP inside, the inner one is what is returned. A corrupt
 * inner ZIP falls back to the outer files, so the caller's own "found nothing"
 * message still names what was there.
 *
 * Throws on bytes that are not a ZIP at all — call it BEFORE anything
 * destructive, and a wrong file costs nothing.
 */
export function unzipExport(bytes: Uint8Array): ExportFiles {
  let files = unzipSync(bytes);
  const outerKeys = Object.keys(files);
  const hasAnyCsv = outerKeys.some((k) => k.toLowerCase().endsWith('.csv') && !k.includes('__MACOSX'));
  if (!hasAnyCsv) {
    const innerZipKey = outerKeys.find((k) => k.toLowerCase().endsWith('.zip') && !k.includes('__MACOSX'));
    if (innerZipKey) {
      try {
        files = unzipSync(files[innerZipKey]);
      } catch {
        // inner zip was corrupt — fall through to the outer files
      }
    }
  }
  return files;
}

/**
 * Is this the TV Time GDPR export, rather than somebody else's library?
 *
 * By CONTENT, never by file name: people rename the ZIP. The official export is
 * a ZIP with these CSVs at some depth inside it; a nested ZIP counts, because
 * `unzipExport` unwraps those.
 */
export function isTvTimeExport(bytes: Uint8Array): boolean {
  if (!isZipBytes(bytes)) return false;
  const wanted = (names: string[]) =>
    names.some((k) => {
      const base = (k.split('/').pop() ?? '').toLowerCase();
      return (
        !k.includes('__MACOSX') &&
        (base === 'user_tv_show_data.csv' ||
          base.startsWith('tracking-prod-records') ||
          base.startsWith('comments-prod-comments'))
      );
    });
  try {
    const files = unzipSync(bytes);
    const names = Object.keys(files);
    if (wanted(names)) return true;
    const inner = names.find((k) => k.toLowerCase().endsWith('.zip') && !k.includes('__MACOSX'));
    return inner ? wanted(Object.keys(unzipSync(files[inner]))) : false;
  } catch {
    return false;
  }
}

/**
 * Three ways to find a CSV in the export, because the files are not where one
 * rule would put them.
 *
 * - `csv(suffix)` — the first file whose path ENDS with the name. The export
 *   nests its files in a folder named after the account, so a bare name never
 *   matches the full path.
 * - `csvLoose(part)` — the EXACT basename first, then any CSV whose path merely
 *   contains it. Exact first matters: "episode_comment" must never pick up
 *   `episode_comment_like.csv`, which is likes you gave, not comments. The
 *   loose fallback is for files a user (or their unzip tool) renamed.
 * - `communityCsv(must, mustNot)` — for the unofficial browser-extension
 *   export, whose names carry a date suffix (`tvtime-series-2026-07-02.csv`).
 *   `mustNot` keeps `tvtime-series` from also matching `tvtime-series-episodes`.
 *
 * All three skip macOS's `__MACOSX` resource forks, which sit next to every
 * file in a ZIP made on a Mac and parse as garbage. A missing file is `[]`,
 * never an error: every export generation is missing something.
 */
export function exportReader(files: ExportFiles) {
  const csv = (suffix: string): Row[] => {
    const lo = suffix.toLowerCase();
    const key = Object.keys(files).find((k) => k.toLowerCase().endsWith(lo) && !k.includes('__MACOSX'));
    return key ? parseCsv(strFromU8(files[key])) : [];
  };
  const csvLoose = (part: string): Row[] => {
    const lo = part.toLowerCase();
    const keys = Object.keys(files).filter((k) => k.toLowerCase().endsWith('.csv') && !k.includes('__MACOSX'));
    const key =
      keys.find((k) => { const kl = k.toLowerCase(); return kl === `${lo}.csv` || kl.endsWith(`/${lo}.csv`); }) ??
      keys.find((k) => k.toLowerCase().includes(lo));
    return key ? parseCsv(strFromU8(files[key])) : [];
  };
  const communityCsv = (must: string, mustNot?: string): Row[] => {
    const key = Object.keys(files).find((k) => {
      if (k.includes('__MACOSX') || !k.toLowerCase().endsWith('.csv')) return false;
      const base = (k.split('/').pop() ?? '').toLowerCase();
      return base.includes(must) && (!mustNot || !base.includes(mustNot));
    });
    return key ? parseCsv(strFromU8(files[key])) : [];
  };
  return { csv, csvLoose, communityCsv };
}

export type ExportReader = ReturnType<typeof exportReader>;
