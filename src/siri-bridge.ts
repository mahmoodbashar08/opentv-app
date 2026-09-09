/**
 * The two files Siri talks through, and why it is files rather than a call.
 *
 * An App Intent runs in its own process. It cannot reach this app's JavaScript,
 * cannot open the SQLite database safely while the app may also have it open,
 * and must answer the user in under a second. So the intent never writes to the
 * library: it reads a small INDEX to understand what was said, and appends a
 * REQUEST that the app applies the next time it runs.
 *
 * WHY NOT MARK IT IN SWIFT DIRECTLY. Marking an episode watched is not one
 * insert — it touches the watch rows, the show's counters, the widgets and the
 * community seed. That logic exists once, in TypeScript, and it has already
 * been broken once by a second copy of a counter. A deferred write that reuses
 * the real path is worth more than an instant write that reimplements it.
 *
 * WHAT THE USER HEARS is still immediate and still true: the intent knows which
 * episode it queued, because the index told it, so Siri says "Marked The
 * Bear S2E5" rather than a vague "done". The only thing that waits is the row.
 *
 * THE SAME APP GROUP THE WIDGETS USE, so there is one shared container and one
 * entitlement to keep working rather than two.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import db from '@/db';
import { markWatched } from '@/db';
import { showMeta } from '@/metadata';
import { upNextList } from '@/widget-data';

const APP_GROUP = 'group.com.insightfy.opentv';
const INDEX_FILE = 'siri-index.json';
const QUEUE_FILE = 'siri-queue.json';

/** One followed show, as Siri needs to recognise it when spoken. */
export type SiriShow = {
  id: number;
  name: string;
  /** The next unwatched aired episode, so "mark it watched" needs no lookup. */
  nextSeason: number | null;
  nextEpisode: number | null;
};

/** One thing the user asked for while the app was not running. */
export type SiriRequest = {
  kind: 'watched';
  showId: number;
  season: number;
  episode: number;
  /** When the user actually said it, not when the app got round to it. */
  at: string;
};

/** The shape `watches.watchedAt` is stored in: 'YYYY-MM-DD HH:MM:SS'. */
function sqlDate(iso: string): string | undefined {
  const t = Date.parse(iso);
  if (!isFinite(t)) return undefined; // unparseable — let markWatched use now
  return new Date(t).toISOString().slice(0, 19).replace('T', ' ');
}

function groupDir(): Directory | null {
  if (Platform.OS !== 'ios') return null;
  try {
    const dir = new Directory(Paths.appleSharedContainers?.[APP_GROUP] ?? '');
    return dir.exists ? dir : null;
  } catch {
    return null;
  }
}

/**
 * Publish what Siri is allowed to know: the names of followed shows and where
 * each one is up to. No watch history, no dates, no ratings — the index answers
 * "which show did they say" and nothing else.
 *
 * Written beside the widget payload and on the same schedule, because it goes
 * stale for the same reason and there is no sense having two.
 */
export function writeSiriIndex(): void {
  const group = groupDir();
  if (!group) return;
  try {
    const rows = db.getAllSync<{ tvdbId: number; name: string }>(
      'SELECT tvdbId, name FROM shows WHERE hidden IS NOT 1 ORDER BY name',
    );
    // The next-up list is already computed for the widgets; reuse it rather
    // than asking the database the same question a second way.
    const next = new Map(upNextList(200).map((e) => [e.showId, e]));
    const shows: SiriShow[] = rows
      .filter((r) => showMeta(r.tvdbId) != null)
      .map((r) => ({
        id: r.tvdbId,
        name: r.name,
        nextSeason: next.get(r.tvdbId)?.season ?? null,
        nextEpisode: next.get(r.tvdbId)?.episode ?? null,
      }));
    new File(group, INDEX_FILE).write(JSON.stringify({ updatedAt: new Date().toISOString(), shows }));
  } catch {
    // The index is a convenience for a feature that degrades to "open the app".
    // Never worth failing a sync over.
  }
}

/**
 * Apply anything Siri queued, oldest first, then clear the queue.
 *
 * IDEMPOTENT BY THE SAME ROUTE AS EVERY OTHER MARK. `markWatched` already
 * refuses to double-count an episode that is present, so a queue drained twice
 * — a crash between applying and clearing — costs nothing.
 *
 * Returns how many were applied, so the caller can decide whether anything on
 * screen needs to re-read.
 */
export async function drainSiriQueue(): Promise<number> {
  const group = groupDir();
  if (!group) return 0;
  const file = new File(group, QUEUE_FILE);
  let requests: SiriRequest[] = [];
  try {
    if (!file.exists) return 0;
    const raw = JSON.parse(await file.text()) as { requests?: SiriRequest[] };
    requests = Array.isArray(raw.requests) ? raw.requests : [];
  } catch {
    // A half-written file is not worth keeping; drop it and move on.
    try {
      file.delete();
    } catch {}
    return 0;
  }

  let applied = 0;
  for (const r of requests) {
    if (r?.kind !== 'watched') continue;
    if (typeof r.showId !== 'number' || typeof r.season !== 'number' || typeof r.episode !== 'number') continue;
    try {
      // THE DATE THEY SAID IT, not the date the app opened. Somebody who tells
      // Siri on Sunday and opens the app on Wednesday watched it on Sunday, and
      // every streak and calendar in this app reads that column.
      markWatched(r.showId, r.season, r.episode, sqlDate(r.at));
      applied++;
    } catch {
      // One bad request must not strand the rest of the queue.
    }
  }

  try {
    file.delete();
  } catch {}
  return applied;
}
