/**
 * Bringing the archive with you — the user's own TV Time comments, and the
 * friends they had there.
 *
 * TWO THINGS HAPPEN HERE AND THEY ARE NOT THE SAME KIND OF THING.
 *
 *   SEEDING is a publication. Words the user wrote in 2019, inside somebody
 *   else's app, become rows other people can read. That is a decision, so it is
 *   OFFERED — `seed.tsx` asks, in as many words, and nothing in this file runs
 *   until it is answered yes. It is never triggered by a launch, a migration or
 *   a repair.
 *
 *   RECONCILING is a lookup. It sends numeric ids the user already holds, in
 *   their own export, and gets back the handles of people who hold the matching
 *   id. No content, no titles, no history. Both sides get one notification, once.
 *   That needs no ceremony, so it runs on its own after joining.
 *
 * ONLY THE USER'S OWN COMMENTS ARE EVER SENT. The `comments` table holds
 * nothing else — the importer writes only rows the export attributes to the
 * exporter — and the bundled demo library is refused outright below, because
 * those comments belong to a persona, not to whoever is holding the phone.
 *
 * NOTHING HERE THROWS. Every entry point resolves with what it managed to do.
 * Partial success is the ordinary outcome of a network call on a phone, and the
 * screen reports it honestly rather than showing a tick it has not earned.
 */
import { ApiError, api, type ApiErrorCode } from '@/api';
import { getToken, isJoined } from '@/community-session';
import {
  countSeedableCommentRows,
  getMeta,
  getMovies,
  getSeedableComments,
  getShowNames,
  libraryOwner,
  setMeta,
} from '@/db';
import {
  chunk,
  localCommentToSeed,
  slug,
  targetKey,
  type SeedItem,
  type SeedTarget,
  type SeedTargetResolver,
  type SeedTotals,
} from '@/pure';

/** `IMPORT_MAX_ITEMS` on the server. More than this in one call is a 400 `too_large`. */
export const SEED_CHUNK = 200;

/** `RECONCILE_MAX_IDS` on the server. More than this in one call is a 400. */
export const RECONCILE_CHUNK = 500;

/** Where a cancelled run left off, and what it had achieved by then. */
const PROGRESS_KEY = 'communitySeedProgress';
/** Set once a run reaches the end of the table, so Settings can say so. */
const DONE_KEY = 'communitySeedDone';
/** The friend list a reconcile last ran against — see `maybeReconcileFriends`. */
const FRIENDS_FINGERPRINT_KEY = 'communityFriendsFingerprint';
/** The last matches, kept so the screen can show them without a second call. */
const FRIEND_MATCHES_KEY = 'communityFriendMatches';

// ── counting, before anything is offered ─────────────────────────────────────

/**
 * How many comments could be brought — the number in the offer's first line.
 *
 * Synchronous, because the offer is a decision made during render, and because
 * the rest of this app reads SQLite that way.
 *
 * ZERO FOR ANY LIBRARY THAT IS NOT AN IMPORT. The bundled demo library's
 * comments are a persona's, and a fresh library has none; publishing either
 * under a real account would be publishing something the user never wrote.
 */
export function countSeedableComments(): number {
  if (libraryOwner() !== 'imported') return 0;
  try {
    return countSeedableCommentRows();
  } catch {
    return 0;
  }
}

/** True once a seeding run has walked the whole table. */
export function seedingDone(): boolean {
  return getMeta(DONE_KEY) === '1';
}

// ── resolving a comment's entity to a thread ─────────────────────────────────

/**
 * The name → target index, built once per run.
 *
 * A comment's `entity` is a NAME and nothing else — TV Time's export carries no
 * id on a comment row — so the only way back to a thread is the library the
 * user still has. A show becomes its TheTVDB id; a film becomes `slug|year` via
 * `targetKey`, the shared identity rule the server computes identically.
 *
 * FILMS ARE ALWAYS `title`, never `tmdb`, even for the rows that carry a TMDB
 * id. Half the library would resolve one way and half the other, and the two
 * halves would be two different threads for the same film. One rule, one thread.
 *
 * Matching is case- and whitespace-insensitive because the two comment systems
 * in an export spell the same show differently often enough to matter.
 */
/** Marks a slug two different titles share — never resolved, never guessed. */
const AMBIGUOUS: SeedTarget = { source: 'title', key: '\u0000ambiguous' };

export function buildTargetResolver(): SeedTargetResolver {
  const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const index = new Map<string, SeedTarget>();
  // A SECOND index, keyed by slug. Exact-name matching alone is too brittle for
  // real data: the entity string in an imported comment is whatever TV Time
  // wrote at the time, and a title that has since been re-punctuated,
  // re-accented or had a "(US)"-style qualifier moved will miss by one
  // character and be silently dropped. `slug` folds case, diacritics and all
  // punctuation, so "Dune: Part Two", "Dune - Part Two" and "Dune Part Two"
  // land on the same key. Exact still wins; this only catches what it misses.
  const loose = new Map<string, SeedTarget>();
  const add = (name: string | null | undefined, target: SeedTarget) => {
    if (!name) return;
    if (!index.has(key(name))) index.set(key(name), target);
    const l = slug(name);
    // First writer wins, and an ambiguous slug is dropped rather than guessed:
    // two different titles folding together must not silently send a comment to
    // the wrong show's thread.
    if (l) {
      if (loose.has(l) && loose.get(l)!.key !== target.key) loose.set(l, AMBIGUOUS);
      else if (!loose.has(l)) loose.set(l, target);
    }
  };

  try {
    for (const s of getShowNames()) {
      if (s.name) add(s.name, { source: 'tvdb', key: String(s.tvdbId) });
    }
  } catch {
    // No shows readable — films may still resolve.
  }
  try {
    for (const m of getMovies()) {
      const target: SeedTarget = { source: 'title', key: targetKey('title', { title: m.name, year: m.year }) };
      // A show of the same name wins: the episode-suffixed comments are far
      // more numerous, and a film sharing a series' title is the rarer case.
      add(m.name, target);
      add(m.originalName, target);
    }
  } catch {
    // Same: a partial index seeds what it can and counts the rest as unmappable.
  }

  return (name: string) => {
    const exact = index.get(key(name));
    if (exact) return exact;
    const l = loose.get(slug(name));
    return l && l !== AMBIGUOUS ? l : null;
  };
}

// ── seeding ──────────────────────────────────────────────────────────────────

type Progress = SeedTotals & { cursor: number };

const NO_PROGRESS: Progress = { cursor: 0, imported: 0, skipped: 0, unmappable: 0 };

function readProgress(): Progress {
  try {
    const raw = getMeta(PROGRESS_KEY);
    if (!raw) return NO_PROGRESS;
    const p = JSON.parse(raw) as Partial<Progress>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    return { cursor: n(p.cursor), imported: n(p.imported), skipped: n(p.skipped), unmappable: n(p.unmappable) };
  } catch {
    return NO_PROGRESS;
  }
}

function writeProgress(p: Progress): void {
  try {
    setMeta(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    // A failed write costs a resumed run some re-sending, which the server's
    // content-derived id makes free. Never worth failing the seeding over.
  }
}

export type SeedProgress = { done: number; total: number };

export type SeedResult = SeedTotals & {
  /** False when the run stopped early — offline, a timeout, a dead session. */
  finished: boolean;
  /** Why it stopped, for the localised line under the summary. Null when it did not. */
  error: ApiErrorCode | null;
};

/**
 * Bring the comments over. Resolves; never rejects.
 *
 * RESUMABLE AND IDEMPOTENT, by two independent mechanisms, and both are needed:
 *
 *  - The SERVER derives each row's id from its content, so re-sending a chunk
 *    writes nothing and reports it as `skipped`. That is what makes a crash
 *    mid-run harmless.
 *  - The CURSOR in `meta` means a run that was cancelled at comment 3,000 of
 *    5,000 does not spend the next attempt re-uploading the first 3,000 to be
 *    told they are already there. Correctness comes from the server; the cursor
 *    only buys back the time.
 *
 * The totals accumulate ACROSS resumed runs, so the summary describes the whole
 * archive rather than the last leg of it.
 */
export async function seedComments(onProgress?: (p: SeedProgress) => void): Promise<SeedResult> {
  const stop = (p: Progress, error: ApiErrorCode | null): SeedResult => ({
    imported: p.imported,
    skipped: p.skipped,
    unmappable: p.unmappable,
    finished: false,
    error,
  });

  const progress = readProgress();

  if (!isJoined()) return stop(progress, 'unauthenticated');
  let token: string | null = null;
  try {
    token = await getToken();
  } catch {
    token = null;
  }
  if (!token) return stop(progress, 'unauthenticated');

  let rows: { id: number; type: string; entity: string; text: string; date: string }[];
  try {
    rows = getSeedableComments(progress.cursor);
  } catch {
    return stop(progress, 'unknown');
  }

  const resolve = buildTargetResolver();
  const total = rows.length;
  let done = 0;

  // Mapped up front: the whole point of the pure mapper is that everything
  // decided about WHAT gets uploaded happens before a single byte is sent, and
  // can be read back in one place. `id` rides along so the cursor can advance
  // past unmappable rows too — otherwise every resumed run would re-examine them.
  const mapped = rows.map((row) => ({ id: row.id, item: localCommentToSeed(row, resolve) }));

  const sendable = mapped.filter((m): m is { id: number; item: SeedItem } => m.item !== null);
  const unmappableRows = mapped.length - sendable.length;

  // Nothing to send: still record that the table was walked, so a second visit
  // to the screen does not re-offer work that cannot succeed.
  if (sendable.length === 0) {
    const finalP: Progress = {
      cursor: rows.length > 0 ? rows[rows.length - 1].id : progress.cursor,
      imported: progress.imported,
      skipped: progress.skipped,
      unmappable: progress.unmappable + unmappableRows,
    };
    writeProgress(finalP);
    setMeta(DONE_KEY, '1');
    onProgress?.({ done: total, total });
    return { ...finalP, finished: true, error: null };
  }

  const batches = chunk(sendable, SEED_CHUNK);
  const running: Progress = { ...progress };
  // Unmappable rows are counted as the batch that follows them lands, so a run
  // that stops halfway does not claim to have examined the whole table.
  let unmappableLeft = unmappableRows;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    let res: { imported?: unknown; skipped?: unknown };
    try {
      res = await api<{ imported?: unknown; skipped?: unknown }>('/v1/comments/import', {
        method: 'POST',
        token,
        body: { items: batch.map((b) => b.item) },
      });
    } catch (e) {
      writeProgress(running);
      return stop(running, e instanceof ApiError ? e.code : 'unknown');
    }

    const imported = typeof res?.imported === 'number' ? res.imported : 0;
    // `skipped` is the server's own arithmetic (`items.length - imported`) and
    // covers duplicates AND its validation rejects. Trusting its number rather
    // than recomputing keeps the two sides from disagreeing about a chunk.
    const skipped = typeof res?.skipped === 'number' ? res.skipped : batch.length - imported;

    running.imported += imported;
    running.skipped += skipped;
    // The last row this batch consumed — including any unmappable rows before
    // it, which is why the id comes from the row and not from a counter.
    running.cursor = batch[batch.length - 1].id;
    if (i === batches.length - 1) {
      running.unmappable += unmappableLeft;
      unmappableLeft = 0;
      if (rows.length > 0) running.cursor = rows[rows.length - 1].id;
    }
    writeProgress(running);

    done += batch.length;
    onProgress?.({ done: Math.min(done, total), total });
  }

  setMeta(DONE_KEY, '1');
  onProgress?.({ done: total, total });
  return { imported: running.imported, skipped: running.skipped, unmappable: running.unmappable, finished: true, error: null };
}

// ── reconnection ─────────────────────────────────────────────────────────────

/** A person the server found, exactly as `POST /v1/me/friends/reconcile` shapes them. */
export type FriendMatch = { handle: string; display_name: string | null; avatar_key: string | null };

/**
 * The friend ids the importer stored.
 *
 * `meta.tvtimeFriends` is a JSON array of the `friend_id` column of `friend.csv`,
 * written by `importer.ts` at the end of an import. They are strings there
 * because the CSV is strings; the server wants positive integers and rejects the
 * whole call over one bad element, so anything that is not one is dropped here.
 */
export function friendIds(): number[] {
  try {
    const raw = JSON.parse(getMeta('tvtimeFriends') ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    const ids = raw
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0);
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

/** The user's own numeric TV Time id, from `meta.tvtimeUserId`, or null. */
export function ownTvTimeId(): number | null {
  const n = Number(getMeta('tvtimeUserId') ?? '');
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The last matches, for a screen that wants them during render. */
export function lastFriendMatches(): FriendMatch[] {
  try {
    const raw = JSON.parse(getMeta(FRIEND_MATCHES_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? (raw as FriendMatch[]) : [];
  } catch {
    return [];
  }
}

/**
 * A cheap, stable stamp of "which friend list this was". Not a security hash —
 * its only job is to answer "has this changed since last time" without keeping
 * a second copy of the list.
 */
function fingerprint(own: number | null, ids: readonly number[]): string {
  let h = 2166136261;
  for (const id of ids) {
    h ^= id;
    h = Math.imul(h, 16777619);
  }
  return `${own ?? 0}:${ids.length}:${(h >>> 0).toString(36)}`;
}

/** One in-flight reconcile at a time — the join screen and `seed.tsx` both ask. */
let inFlight: Promise<FriendMatch[]> | null = null;

/**
 * Ask the server who else is here. Resolves with the matches; never rejects.
 *
 * `tvtime_user_id` rides on the FIRST chunk only. It is write-once server-side:
 * a second send changes nothing, and a mutable field there would let one account
 * point at id after id and harvest `friend_found` notifications from the whole
 * user base. Sending it once is enough and is all that is meant.
 *
 * Chunks are 500 ids, the server's cap, and matches accumulate across them.
 */
export async function reconcileFriends(): Promise<FriendMatch[]> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const ids = friendIds();
    const own = ownTvTimeId();
    if (!isJoined()) return [];
    // Nothing to say at all: no id of our own to claim and nobody to look for.
    if (ids.length === 0 && own === null) return [];

    let token: string | null = null;
    try {
      token = await getToken();
    } catch {
      token = null;
    }
    if (!token) return [];

    const batches = ids.length > 0 ? chunk(ids, RECONCILE_CHUNK) : [[]];
    const matched: FriendMatch[] = [];
    const seen = new Set<string>();
    let complete = true;

    for (let i = 0; i < batches.length; i++) {
      try {
        const res = await api<{ matched?: unknown }>('/v1/me/friends/reconcile', {
          method: 'POST',
          token,
          body: i === 0 && own !== null ? { tvtime_user_id: own, friend_ids: batches[i] } : { friend_ids: batches[i] },
        });
        const rows = Array.isArray(res?.matched) ? (res.matched as FriendMatch[]) : [];
        for (const r of rows) {
          if (r && typeof r.handle === 'string' && !seen.has(r.handle)) {
            seen.add(r.handle);
            matched.push(r);
          }
        }
      } catch {
        // One failed chunk does not invalidate the ones that worked; it only
        // means the fingerprint must NOT be stamped, so the next sign-in tries
        // the whole list again.
        complete = false;
      }
    }

    try {
      setMeta(FRIEND_MATCHES_KEY, JSON.stringify(matched));
      if (complete) setMeta(FRIENDS_FINGERPRINT_KEY, fingerprint(own, ids));
    } catch {
      // Not worth failing a successful reconcile over.
    }
    return matched;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Reconcile only if the friend list has changed since the last complete run.
 *
 * This is what stops the app polling. A friend who joins next year is found the
 * next time the user's own export changes — a re-import, a new friend — and
 * otherwise the server is left alone, because the answer cannot change from this
 * side. The notification the server writes on a match is the other half: the
 * person who joins later notifies everyone who already reconciled, both ways,
 * exactly once.
 */
export async function maybeReconcileFriends(): Promise<FriendMatch[]> {
  const ids = friendIds();
  const own = ownTvTimeId();
  if (ids.length === 0 && own === null) return [];
  if (getMeta(FRIENDS_FINGERPRINT_KEY) === fingerprint(own, ids)) return lastFriendMatches();
  return reconcileFriends();
}

/** Whether reconnection has anything to work with at all — no export, no ids. */
export function canReconcile(): boolean {
  return friendIds().length > 0 || ownTvTimeId() !== null;
}
