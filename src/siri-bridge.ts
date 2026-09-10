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

import db, { markWatched } from '@/db';
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
  /**
   * The last episode actually ticked off, which is what "what episode am I on"
   * is really asking. "Up to S2E4, next is S2E5" is a sentence; "S2E5" alone
   * leaves the listener working out whether they have seen it.
   */
  lastSeason: number | null;
  lastEpisode: number | null;
};

/**
 * One film, as Siri needs it to answer "have I seen this".
 *
 * `watchedAt` is a DATE and not a boolean because the answer people want is
 * "yes, in March", not "yes". A null means it is in the library unwatched —
 * which is a different sentence again from a film that is not there at all.
 */
export type SiriMovie = {
  name: string;
  year: string | null;
  watchedAt: string | null;
  /**
   * The other names it answers to, filled by `alt-titles.ts`. `en` is the one
   * that matters: a library imported from TV Time may hold "La Tortue rouge"
   * while the person asking says "The Red Turtle", and Siri matches speech
   * against the name it is SHOWN, so that is the name to show.
   */
  en?: string;
  alt?: string[];
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

/**
 * EXACTLY AS `widget-sync.ts` DOES IT, and this was a real bug for a day:
 * `Paths.appleSharedContainers[group]` already IS a Directory. Wrapping it in
 * `new Directory(...)` produced something whose `exists` was false, so every
 * write here silently did nothing — and Siri, with no index to read, asked
 * "which film?" for ever and could never accept an answer.
 */
function groupDir(): Directory | null {
  if (Platform.OS !== 'ios') return null;
  try {
    return Paths.appleSharedContainers[APP_GROUP] ?? null;
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
      // `archived`, which is the column this schema actually has. The first
      // version filtered on a `hidden` column that does not exist, the query
      // threw, the catch below swallowed it, and the index was silently never
      // written — so Siri asked "which show?" and could never be answered.
      'SELECT tvdbId, name FROM shows WHERE archived = 0 ORDER BY name',
    );
    // The next-up list is already computed for the widgets; reuse it rather
    // than asking the database the same question a second way.
    const next = new Map(upNextList(200).map((e) => [e.showId, e]));
    /*
     * WHERE THEY ARE UP TO, in one query rather than one per show. The latest
     * watch by date, then by season and episode, because a night of catching up
     * writes several rows with the same timestamp and the highest episode is the
     * one they are actually on.
     */
    const last = new Map(
      db
        .getAllSync<{ showId: number; season: number; episode: number }>(
          // The furthest point reached, which is what "where am I" means — not
          // the most recent row, because a rewatch of episode one is not where
          // somebody is up to.
          `SELECT showId, MAX(season) AS season,
                  MAX(CASE WHEN season = (SELECT MAX(season) FROM watches y WHERE y.showId = w.showId)
                           THEN episode END) AS episode
             FROM watches w GROUP BY showId`,
        )
        .map((r) => [r.showId, r]),
    );
    const shows: SiriShow[] = rows
      .filter((r) => showMeta(r.tvdbId) != null)
      .map((r) => ({
        id: r.tvdbId,
        name: r.name,
        nextSeason: next.get(r.tvdbId)?.season ?? null,
        nextEpisode: next.get(r.tvdbId)?.episode ?? null,
        lastSeason: last.get(r.tvdbId)?.season ?? null,
        lastEpisode: last.get(r.tvdbId)?.episode ?? null,
      }));

    /*
     * FILMS, SO "HAVE I SEEN THIS" CAN BE ANSWERED.
     *
     * Name, year and one date. No ratings, no comments, no runtime — the index
     * answers which film was said and whether it has been seen, and there is no
     * reason for anything else to leave the database.
     *
     * Capped, because this file is read by an intent that must answer in under
     * a second, and a library of several thousand films is a megabyte of JSON
     * to parse before Siri has said a word. Watched first, most recent first:
     * a question about a film is overwhelmingly about a recent one.
     */
    const movieRows = db.getAllSync<{
      name: string;
      year: string | null;
      watchedAt: string | null;
      altTitles: string | null;
    }>(
      `SELECT name, year, watchedAt, altTitles FROM movies
        ORDER BY (watchedAt IS NULL), watchedAt DESC, name
        LIMIT 2000`,
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parseAltTitles } = require('@/alt-titles') as typeof import('@/alt-titles');
    const movies: SiriMovie[] = movieRows.map((m) => {
      const t = parseAltTitles(m.altTitles);
      const alt = [t.en, t.orig, t.loc].filter(
        (x): x is string => typeof x === 'string' && x.length > 0 && x !== m.name,
      );
      return { name: m.name, year: m.year, watchedAt: m.watchedAt, en: t.en, alt };
    });

    new File(group, INDEX_FILE).write(
      JSON.stringify({ updatedAt: new Date().toISOString(), shows, movies }),
    );
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
