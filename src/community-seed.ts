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
import { File, Paths } from 'expo-file-system';

import { ApiError, api, apiUpload, type ApiErrorCode } from '@/api';
import { publishIfChanged } from '@/community-publish';
import { getToken, isJoined } from '@/community-session';
import {
  archiveCounts,
  countSeedableCommentRows,
  getMeta,
  getMovies,
  getSeedableCharacterVotes,
  getSeedableCommentImages,
  getSeedableComments,
  getSeedableEpisodeEmotions,
  getSeedableEpisodeRatings,
  getSeedableMovieEmotions,
  getSeedableMovieVotes,
  getShowNames,
  libraryOwner,
  setMeta,
  type SeedableComment,
} from '@/db';
import {
  archiveFingerprint,
  chunk,
  decideArchiveSync,
  localCharacterToSeed,
  localCommentToSeed,
  localRatingToSeed,
  mergeRatingAndEmotion,
  metaKeysClearedByArchiveReupload,
  slug,
  targetKey,
  type CharacterSeedItem,
  type LocalRatingRow,
  type RatingSeedItem,
  type SeedItem,
  type SeedTarget,
  type SeedTargetResolver,
  type SeedTotals,
} from '@/pure';

/** `IMPORT_MAX_ITEMS` on the server. More than this in one call is a 400 `too_large`. */
export const SEED_CHUNK = 200;

/**
 * `VOTE_IMPORT_MAX_ITEMS` on the server — the cap `POST /v1/ratings/import` and
 * `POST /v1/character-votes/import` both enforce. Larger is a 400 `too_large`,
 * and a 400 mid-run would strand a resumable job on a payload it will never be
 * able to send. Different from `SEED_CHUNK` because a vote is a handful of
 * numbers where a comment is a paragraph.
 */
export const VOTE_SEED_CHUNK = 500;

/** `RECONCILE_MAX_IDS` on the server. More than this in one call is a 400. */
export const RECONCILE_CHUNK = 500;

/** Where a cancelled run left off, and what it had achieved by then. */
const PROGRESS_KEY = 'communitySeedProgress';
/** Set once a run reaches the end of the table, so Settings can say so. */
const DONE_KEY = 'communitySeedDone';
/** The same pair for the votes, and for the favourites — each resumes alone. */
const RATINGS_PROGRESS_KEY = 'communitySeedRatingsProgress';
const RATINGS_DONE_KEY = 'communitySeedRatingsDone';
const CHARACTERS_PROGRESS_KEY = 'communitySeedCharactersProgress';
const CHARACTERS_DONE_KEY = 'communitySeedCharactersDone';
/**
 * THE CONTRACT REVISION OF WHAT WE UPLOAD. Bump this — by hand, in the same
 * commit that changes the shape — and EVERY client re-walks its whole archive
 * and re-sends it on its next launch. No button, no prompt, no user action.
 * That is the entire mechanism, and it is a constant rather than a flag because
 * a flag can only record "this was sent"; it can never record "this was sent in
 * a shape the server no longer stores".
 *
 * Revision 1 is everything seeded before commit d844861: those rows carry
 * exactly ONE feeling per title, because the server used to store one and the
 * old mapper kept the lowest-indexed one. It now stores a SET, so every one of
 * those rows is stale and no cursor, DONE flag or migration would ever revisit
 * it. Revision 2 is the multi-emotion shape — `emotions[]` on every vote — and
 * shipping it is what heals them.
 *
 * Revision 3 adds a KIND: the comment photographs (`seedCommentImages`). Every
 * archive stamped at revision 2 was stamped by a run for which "complete" did
 * not include a single image, and no cursor or done flag anywhere records the
 * difference — the exact hole this constant exists to fill. It matters more
 * here than for any previous bump, because those files exist nowhere else in
 * the world: TV Time's CDN is gone, and a phone that is never asked again keeps
 * the only copies until it is wiped.
 *
 * Revision 4 permits an EMPTY BODY carrying `has_image`. TV Time let a comment
 * be a photograph with no caption, and every layer here refused one: the count,
 * the seed query, the mapper and the server's validator. Archives stamped at
 * revision 3 were stamped by a run that could not send those rows and reported
 * success anyway — the fingerprint had already counted them, so the sync then
 * declared nothing owed and would never have looked again.
 *
 * Revision 6 re-opens them again: revision 5's run reached the upload and was
 * refused by the RUNTIME — the file part was built the old React Native way,
 * which this fetch does not accept — so it recorded a network failure per image
 * and moved on.
 *
 * Revision 5 re-opened the photographs. The run that stamped revision 4 carried
 * the picture-only COMMENTS up but not a single FILE, and stamped itself
 * complete regardless — so the sync declared nothing owed while the only
 * surviving copy of each image sat on the phone. Same class of hole as 3 and 4:
 * a flag that records "a run finished" and not "what that run was able to send".
 *
 * Revision 8 puts the "episode zero" comments BACK on their episode. Revision 7
 * rewrote them as show comments on the theory that a number no catalogue
 * carries cannot be an episode; that was wrong. They are comments about an
 * episode, TV Time says so in two files against a real episode id, and the
 * missing S4E0 is a gap in the catalogue rather than an error in the archive.
 *
 * BUMP IT WHEN, AND ONLY WHEN, THE PAYLOAD CHANGES MEANING: a new field the
 * server stores, a whole new artifact (as here), a field whose cardinality
 * changes (one → many), a changed identity/target rule. Do NOT bump it for a
 * bug fix on this side that sends the same rows, and never bump it casually:
 * every bump costs every user a full re-walk of their archive.
 */
export const SEED_REVISION = 8;

/** The revision the last fully successful run uploaded under. */
const REVISION_KEY = 'communitySeedRevision';
/** The archive fingerprint that run covered — see `archiveFingerprint`. */
const SYNC_FINGERPRINT_KEY = 'communitySeedFingerprint';
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

/**
 * Everything the archive could contribute, counted the way the run will walk it.
 *
 * These are POST-MAPPING numbers — what would actually be sent, not how many
 * rows the tables hold. A film with no title left to key on, a favourite whose
 * name TV Time never exported, a rating outside 1–5: none of them appear here,
 * because the offer's sentence and the progress bar's denominator have to be the
 * same number as each other and as reality. Promising "2,140 ratings" and then
 * moving 1,900 is the kind of small lie that makes a person distrust the rest.
 *
 * Synchronous, and it does real work — it builds the same mapped list the run
 * builds. That is a few SQLite reads and some arithmetic over a few thousand
 * rows, done once when the screen mounts, and it is the price of an honest
 * number.
 */
export type SeedableCounts = { comments: number; ratings: number; characters: number };

export function countSeedable(): SeedableCounts {
  return {
    comments: countSeedableComments(),
    ratings: seedableRatings().length,
    characters: seedableCharacters().length,
  };
}

/** Whether the offer has anything at all behind it — Settings asks before showing a row. */
export function hasAnythingToSeed(): boolean {
  const c = countSeedable();
  return c.comments + c.ratings + c.characters > 0;
}

/**
 * True once every kind has been walked to the end.
 *
 * Deliberately ALL three, so a user who seeded their comments before ratings and
 * favourites existed sees the Settings row stop saying "brought over" — because
 * it is no longer true. There is more of their archive to bring, and the row
 * saying so is the only way they would learn it.
 */
export function seedingDone(): boolean {
  return getMeta(DONE_KEY) === '1' && getMeta(RATINGS_DONE_KEY) === '1' && getMeta(CHARACTERS_DONE_KEY) === '1';
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

// ── the photographs ──────────────────────────────────────────────────────────

/** Where the image run left off, and whether it reached the end. */
const IMAGES_PROGRESS_KEY = 'communitySeedImagesProgress';
const IMAGES_DONE_KEY = 'communitySeedImagesDone';

/** The MIME type for a filename's extension — what the server's allow-list checks. */
function imageMime(filename: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return null;
  }
}

function readImageProgress(): Progress {
  try {
    const raw = getMeta(IMAGES_PROGRESS_KEY);
    if (!raw) return NO_PROGRESS;
    const p = JSON.parse(raw) as Partial<Progress>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    return { cursor: n(p.cursor), imported: n(p.imported), skipped: n(p.skipped), unmappable: n(p.unmappable) };
  } catch {
    return NO_PROGRESS;
  }
}

/**
 * Bring the comment PHOTOGRAPHS over, one request each.
 *
 * WHY THIS IS THE ONLY IRREPLACEABLE PHASE. Everything else this file uploads
 * still exists in the user's ZIP and can be re-derived at any time. These files
 * cannot: TV Time's export stored a LINK, that CDN's hostname no longer
 * resolves, and the only copies left anywhere are the ones OpenTV downloaded
 * onto this phone while it was still up. A reinstall destroys them. So this
 * runs last but matters most, and a failure here is worth retrying where a
 * failed rating is not.
 *
 * ONE AT A TIME, not batched, because each is a multipart body with a file in
 * it. That makes the cursor genuinely valuable rather than a nicety: a run
 * interrupted at image 40 of 200 resumes at 41.
 *
 * THE LOCAL COPY IS NEVER TOUCHED. Uploading is a backup, not a move — the app
 * keeps reading the file from Documents exactly as before, works offline
 * exactly as before, and a user who never joins the community keeps every
 * picture and sends nothing.
 *
 * A ROW THAT FAILS IS SKIPPED, NOT FATAL. One unreadable file, one type the
 * server refuses, one 404 for a comment that was never imported: none of those
 * says anything about the next image, and stopping the run on the first would
 * strand every photograph behind it. Only a network failure stops the run,
 * because that one DOES describe every request that would follow.
 */
export async function seedCommentImages(onProgress?: (p: SeedProgress) => void): Promise<SeedResult> {
  const progress = readImageProgress();
  const stop = (p: Progress, error: ApiErrorCode | null): SeedResult => ({ ...p, finished: false, error });

  if (!isJoined()) return stop(progress, 'unauthenticated');
  let token: string | null = null;
  try {
    token = await getToken();
  } catch {
    token = null;
  }
  if (!token) return stop(progress, 'unauthenticated');

  let rows: (SeedableComment & { image: string })[];
  try {
    rows = getSeedableCommentImages(progress.cursor);
  } catch {
    return stop(progress, 'unknown');
  }

  const resolve = buildTargetResolver();
  const running: Progress = { ...progress };
  const total = rows.length;
  let done = 0;

  for (const row of rows) {
    const item = localCommentToSeed(row, resolve);
    const mime = imageMime(row.image);
    // Unmappable: a comment whose target cannot be resolved was never uploaded
    // either, so its picture has nothing to hang on; a file with an extension
    // the server will refuse would spend a round trip to be told so.
    if (!item || !mime) {
      running.unmappable++;
      running.cursor = row.id;
      writeImageProgress(running);
      onProgress?.({ done: ++done, total });
      continue;
    }

    const form = new FormData();
    // expo-file-system's `File` DECLARES `implements Blob`, so it is appended
    // as itself. The obvious alternative — React Native's historic
    // `{ uri, name, type }` file shim — is refused outright by this runtime
    // ("Unsupported FormDataPart implementation") and was silently costing
    // every image an upload it reported as a network failure.
    form.append('image', new File(Paths.document, row.image), row.image);
    // The SAME six fields `/v1/comments/import` was given. The server hashes
    // them back into the comment's id; see `stableImportId`.
    form.append('target_source', item.target_source);
    form.append('target_key', item.target_key);
    if (item.season !== null) form.append('season', String(item.season));
    if (item.episode !== null) form.append('episode', String(item.episode));
    form.append('body', item.body);
    form.append('created_at', item.created_at);

    try {
      const res = await apiUpload<{ stored?: unknown }>('/v1/comments/image', form, token);
      if (res?.stored === true) running.imported++;
      else running.skipped++;
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'unknown';
      // Only a transport failure describes the requests that would follow it.
      // Everything else is about THIS file, so the run moves on.
      if (code === 'network' || code === 'unauthenticated' || code === 'rate_limited') {
        writeImageProgress(running);
        return stop(running, code);
      }
      running.skipped++;
    }

    running.cursor = row.id;
    writeImageProgress(running);
    onProgress?.({ done: ++done, total });
  }

  setMeta(IMAGES_DONE_KEY, '1');
  onProgress?.({ done: total, total });
  return { ...running, finished: true, error: null };
}

function writeImageProgress(p: Progress): void {
  try {
    setMeta(IMAGES_PROGRESS_KEY, JSON.stringify(p));
  } catch {
    // A lost cursor costs re-sending, which the server answers `stored: false`.
  }
}

// ── the votes: ratings, feelings and favourite characters ────────────────────
//
// The half that was missing. Seeding published the user's words and none of
// their numbers, so a library with two thousand rated episodes moved not one
// community percentage and every screen read 0% forever.
//
// The shape is the comment path's, deliberately: map everything first, chunk,
// post, bookmark, resume. Two things differ and both come from the data:
//
//  - THE CURSOR IS A SORT KEY, NOT A ROW ID. `episode_ratings`,
//    `character_votes` and `movies` have composite primary keys and no
//    autoincrement column, so "everything up to here is done" is a string built
//    from the same columns the SQL orders by. Rows added between runs sort into
//    place rather than shifting an ordinal and pushing a row past the bookmark
//    unsent.
//  - THE CHUNK IS 500, the votes endpoints' own cap.

/** Ten digits so a numeric component sorts as a number under a string compare. */
function pad10(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  return String(v).padStart(10, '0');
}

/** One mapped row: its cursor position, and what (if anything) it becomes. */
type KeyedRow<I> = { key: string; item: I | null };

type KeyedProgress = SeedTotals & { cursor: string };

const NO_KEYED_PROGRESS: KeyedProgress = { cursor: '', imported: 0, skipped: 0, unmappable: 0 };

function readKeyedProgress(metaKey: string): KeyedProgress {
  try {
    const raw = getMeta(metaKey);
    if (!raw) return NO_KEYED_PROGRESS;
    const p = JSON.parse(raw) as Partial<KeyedProgress>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    return {
      cursor: typeof p.cursor === 'string' ? p.cursor : '',
      imported: n(p.imported),
      skipped: n(p.skipped),
      unmappable: n(p.unmappable),
    };
  } catch {
    return NO_KEYED_PROGRESS;
  }
}

function writeKeyedProgress(metaKey: string, p: KeyedProgress): void {
  try {
    setMeta(metaKey, JSON.stringify(p));
  } catch {
    // A failed write costs a resumed run some re-sending, which the server's
    // derived id makes free. Never worth failing the seeding over.
  }
}

/**
 * The shared engine for the two vote kinds. Resolves; never rejects.
 *
 * `rows` hands back EVERY row, already sorted by key and already mapped — the
 * cursor filter happens here so the caller cannot forget it, and so the
 * unmappable rows before the bookmark are not recounted on every resume.
 */
async function runKeyedSeed<I>(
  progressKey: string,
  doneKey: string,
  endpoint: string,
  loadRows: () => KeyedRow<I>[],
  onProgress?: (p: SeedProgress) => void,
): Promise<SeedResult> {
  const stop = (p: KeyedProgress, error: ApiErrorCode | null): SeedResult => ({
    imported: p.imported,
    skipped: p.skipped,
    unmappable: p.unmappable,
    finished: false,
    error,
  });

  const progress = readKeyedProgress(progressKey);

  if (!isJoined()) return stop(progress, 'unauthenticated');
  let token: string | null = null;
  try {
    token = await getToken();
  } catch {
    token = null;
  }
  if (!token) return stop(progress, 'unauthenticated');

  let all: KeyedRow<I>[];
  try {
    all = loadRows();
  } catch {
    return stop(progress, 'unknown');
  }

  const rows = progress.cursor ? all.filter((r) => r.key > progress.cursor) : all;
  const total = rows.length;
  const sendable = rows.filter((r): r is { key: string; item: I } => r.item !== null);
  const unmappableRows = rows.length - sendable.length;

  // Nothing left to send: still bookmark the end, so a second visit does not
  // re-offer work that cannot succeed.
  if (sendable.length === 0) {
    const finalP: KeyedProgress = {
      cursor: rows.length > 0 ? rows[rows.length - 1].key : progress.cursor,
      imported: progress.imported,
      skipped: progress.skipped,
      unmappable: progress.unmappable + unmappableRows,
    };
    writeKeyedProgress(progressKey, finalP);
    try {
      setMeta(doneKey, '1');
    } catch {
      // see writeKeyedProgress
    }
    onProgress?.({ done: total, total });
    return { ...finalP, finished: true, error: null };
  }

  const batches = chunk(sendable, VOTE_SEED_CHUNK);
  const running: KeyedProgress = { ...progress };
  let unmappableLeft = unmappableRows;
  let done = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    let res: { imported?: unknown; skipped?: unknown };
    try {
      res = await api<{ imported?: unknown; skipped?: unknown }>(endpoint, {
        method: 'POST',
        token,
        body: { items: batch.map((b) => b.item) },
      });
    } catch (e) {
      writeKeyedProgress(progressKey, running);
      return stop(running, e instanceof ApiError ? e.code : 'unknown');
    }

    const imported = typeof res?.imported === 'number' ? res.imported : 0;
    // The server's own arithmetic, trusted rather than recomputed. For
    // favourites its `skipped` is mostly the per-episode → per-show collapse,
    // which is the endpoint working — see `seedSummary` for the wording that
    // keeps that from reading as failure.
    const skipped = typeof res?.skipped === 'number' ? res.skipped : batch.length - imported;

    running.imported += imported;
    running.skipped += skipped;
    running.cursor = batch[batch.length - 1].key;
    if (i === batches.length - 1) {
      running.unmappable += unmappableLeft;
      unmappableLeft = 0;
      if (rows.length > 0) running.cursor = rows[rows.length - 1].key;
    }
    writeKeyedProgress(progressKey, running);

    done += batch.length;
    onProgress?.({ done: Math.min(done, total), total });
  }

  try {
    setMeta(doneKey, '1');
  } catch {
    // see writeKeyedProgress
  }
  onProgress?.({ done: total, total });
  return {
    imported: running.imported,
    skipped: running.skipped,
    unmappable: running.unmappable,
    finished: true,
    error: null,
  };
}

/**
 * Ratings and feelings, merged and mapped, in cursor order.
 *
 * TWO LOCAL TABLES BECOME ONE VOTE. The app keeps a star in `episode_ratings`
 * and ANY NUMBER of feelings in `episode_emotions` (films: `movies.stars` and
 * the multi-select `emotions` table); the server's vote holds a score and a SET
 * of feelings. `mergeRatingAndEmotion` folds them and keeps ALL of the
 * feelings — it used to keep only the lowest-indexed one, matching what the
 * live vote path then sent, so an archive of seven years of double-tapped
 * episodes was seeded one feeling deep. Both ends now send the whole set, so an
 * archived vote and a re-tapped vote for the same episode still agree.
 *
 * FILMS ARE `title`, ALWAYS. `movies.name` is the local primary key and the
 * tmdbId is nullable, so a film's address is `slug|year` via the shared
 * `targetKey` — character for character what the film screen's `postRating`
 * sends and what the film's comment thread already uses. A film rated in 2019
 * and a film rated today land on ONE target; using tmdb for the rows that have
 * one would fork half the catalogue into a second, invisible thread.
 *
 * ZERO FOR THE BUNDLED DEMO LIBRARY. Its ratings are written into these very
 * tables at startup (see `bundledVotes` in db.ts), they belong to a persona, and
 * publishing them under a real account would publish something the user never
 * felt. A 'fresh' library IS included, unlike comments: a fresh user's stars are
 * their own, tapped by them, and there is no import for them to have come from.
 */
function seedableRatings(): KeyedRow<RatingSeedItem>[] {
  if (libraryOwner() === 'seed') return [];

  const rows: KeyedRow<RatingSeedItem>[] = [];
  try {
    const shows = new Set(getShowNames().map((s) => s.tvdbId));
    const resolve = (row: LocalRatingRow): SeedTarget | null => {
      if (row.kind === 'show') {
        const id = row.showId;
        // A vote for a show no longer in the library cannot be addressed: the
        // id may be a stale TheTVDB number the split-id migration re-keyed.
        if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || !shows.has(id)) return null;
        return { source: 'tvdb', key: targetKey('tvdb', { id }) };
      }
      const title = (row.title ?? '').trim();
      if (!title) return null;
      return { source: 'title', key: targetKey('title', { title, year: row.year }) };
    };

    // Episodes. Emotions are indexed first so the merge is one pass, and an
    // episode with a feeling but no star still becomes a vote.
    const episodeEmotions = getSeedableEpisodeEmotions();
    const emotionsByEpisode = new Map<string, { emotion: number }[]>();
    for (const e of episodeEmotions) {
      const k = `${e.showId}:${e.season}:${e.episode}`;
      const list = emotionsByEpisode.get(k);
      if (list) list.push({ emotion: e.emotion });
      else emotionsByEpisode.set(k, [{ emotion: e.emotion }]);
    }

    const starsByEpisode = new Map<string, number>();
    const episodeKeys: { showId: number; season: number; episode: number }[] = [];
    const seenEpisode = new Set<string>();
    const noteEpisode = (showId: number, season: number, episode: number) => {
      const k = `${showId}:${season}:${episode}`;
      if (seenEpisode.has(k)) return;
      seenEpisode.add(k);
      episodeKeys.push({ showId, season, episode });
    };
    for (const r of getSeedableEpisodeRatings()) {
      starsByEpisode.set(`${r.showId}:${r.season}:${r.episode}`, r.stars);
      noteEpisode(r.showId, r.season, r.episode);
    }
    for (const e of episodeEmotions) noteEpisode(e.showId, e.season, e.episode);

    for (const k of episodeKeys) {
      const id = `${k.showId}:${k.season}:${k.episode}`;
      const stars = starsByEpisode.get(id);
      const merged = mergeRatingAndEmotion(
        stars === undefined ? null : { stars },
        emotionsByEpisode.get(id) ?? [],
      );
      const row: LocalRatingRow = {
        kind: 'show',
        showId: k.showId,
        season: k.season,
        episode: k.episode,
        stars: merged.stars,
        emotions: merged.emotions,
      };
      rows.push({ key: `e:${pad10(k.showId)}:${pad10(k.season)}:${pad10(k.episode)}`, item: localRatingToSeed(row, resolve) });
    }

    // Films. `season` and `episode` are null: a film's vote addresses the film.
    const movieEmotions = new Map<string, { emotion: number }[]>();
    for (const e of getSeedableMovieEmotions()) {
      const list = movieEmotions.get(e.movie);
      if (list) list.push({ emotion: e.emotion });
      else movieEmotions.set(e.movie, [{ emotion: e.emotion }]);
    }
    for (const m of getSeedableMovieVotes()) {
      const merged = mergeRatingAndEmotion(
        m.stars === null ? null : { stars: m.stars },
        movieEmotions.get(m.name) ?? [],
      );
      const row: LocalRatingRow = {
        kind: 'movie',
        title: m.name,
        year: m.year,
        season: null,
        episode: null,
        stars: merged.stars,
        emotions: merged.emotions,
      };
      rows.push({ key: `m:${m.name}`, item: localRatingToSeed(row, resolve) });
    }
  } catch {
    // A partial list seeds what it can. Never a thrown error during render.
    return rows;
  }

  // 'e:' sorts before 'm:', so episodes go first and the cursor is total.
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return rows;
}

/**
 * Favourite characters, mapped, in cursor order.
 *
 * THE COUNT WILL LOOK WRONG AND IS NOT. The app has asked "who was your
 * favourite?" per EPISODE since 1.0; the server keeps one favourite per person
 * per SHOW. So a show with forty per-episode picks arrives as one accepted and
 * thirty-nine skipped, by design, on both sides. Everything is still sent — the
 * server decides which one wins, and it is the same answer whichever order they
 * arrive in — and the summary says in words what the number means.
 *
 * Names the server would refuse are dropped HERE rather than sent to earn a
 * skip: a rejected item still costs one of the 500 slots in a chunk. Most
 * dropped rows are TV Time's own, whose export kept only a character id and no
 * name at all.
 */
function seedableCharacters(): KeyedRow<CharacterSeedItem>[] {
  if (libraryOwner() === 'seed') return [];

  try {
    const shows = new Set(getShowNames().map((s) => s.tvdbId));
    return getSeedableCharacterVotes().map((v) => ({
      key: `${pad10(v.showId)}:${pad10(v.season)}:${pad10(v.episode)}`,
      item: localCharacterToSeed(v, (row) =>
        shows.has(row.showId) ? { source: 'tvdb', key: targetKey('tvdb', { id: row.showId }) } : null,
      ),
    }));
  } catch {
    return [];
  }
}

/** Bring the ratings and feelings over. Resolves; never rejects. */
export async function seedRatings(onProgress?: (p: SeedProgress) => void): Promise<SeedResult> {
  return runKeyedSeed(RATINGS_PROGRESS_KEY, RATINGS_DONE_KEY, '/v1/ratings/import', seedableRatings, onProgress);
}

/** Bring the favourite characters over. Resolves; never rejects. */
export async function seedCharacters(onProgress?: (p: SeedProgress) => void): Promise<SeedResult> {
  return runKeyedSeed(
    CHARACTERS_PROGRESS_KEY,
    CHARACTERS_DONE_KEY,
    '/v1/character-votes/import',
    seedableCharacters,
    onProgress,
  );
}

/** What a whole run achieved, kind by kind — the screen reports all four. */
export type SeedEverythingResult = {
  comments: SeedResult;
  ratings: SeedResult;
  characters: SeedResult;
  /** The rescued TV Time photographs. See `seedCommentImages`. */
  images: SeedResult;
  /** True only when all four walked to the end. */
  finished: boolean;
  /** The first thing that went wrong, for the line under the summary. */
  error: ApiErrorCode | null;
};

/**
 * The whole archive, in one act: comments, ratings, favourites, photographs.
 *
 * SEQUENTIAL, NOT PARALLEL. Three concurrent uploads on a phone's connection
 * finish no sooner and fail in three places at once, and each writes its own
 * bookmark — an interleaved failure would leave three half-cursors and a
 * progress bar that moves backwards.
 *
 * A KIND THAT FAILS DOES NOT STOP THE NEXT ONE. Offline is the ordinary reason
 * for a stop, and if the network is genuinely gone the other two cost one failed
 * request each and report it. If it was one bad chunk, the kinds after it still
 * get through, which is strictly more of the user's archive published than
 * abandoning the run would be. Each kind resumes from its own cursor, so
 * re-running finishes what was left rather than starting over.
 */
export async function seedEverything(onProgress?: (p: SeedProgress) => void): Promise<SeedEverythingResult> {
  const counts = countSeedable();
  const total = counts.comments + counts.ratings + counts.characters;
  // Taken BEFORE a byte is sent, and stamped only if all three kinds walk to the
  // end. Sampling it afterwards would capture a rating the user tapped DURING
  // the run — a row this run never saw — and stamp it as covered, so it would
  // never be sent at all.
  const fingerprintAtStart = currentArchiveFingerprint();

  let base = 0;
  let phaseTotal = 0;
  const forward = (p: SeedProgress) => {
    phaseTotal = p.total;
    // `total` is the offer's number; a resumed run walks fewer rows than that,
    // so the denominator is whichever is larger and the bar never exceeds 100%.
    onProgress?.({ done: base + p.done, total: Math.max(total, base + p.total) });
  };
  const advance = () => {
    base += phaseTotal;
    phaseTotal = 0;
  };

  const comments = await seedComments(forward);
  advance();
  const ratings = await seedRatings(forward);
  advance();
  const characters = await seedCharacters(forward);
  advance();
  // LAST, because it is the slowest and the only one that is not idempotent-by-
  // arithmetic — and first in importance, because these files exist nowhere else
  // in the world. Its failures never stop the run: `seedCommentImages` returns
  // what it managed, and `finished` below decides whether the archive is stamped.
  const images = await seedCommentImages(forward);
  advance();

  onProgress?.({ done: Math.max(base, total), total: Math.max(base, total) });

  const finished = comments.finished && ratings.finished && characters.finished && images.finished;

  // ALL FOUR, OR NEITHER STAMP. A partial run leaves both keys exactly as they
  // were, so the next launch reaches the same decision and tries again. Stamping
  // optimistically would turn one offline moment into a permanently half-uploaded
  // archive that nothing would ever revisit — which is the bug this whole
  // mechanism exists to end.
  //
  // Stamped HERE rather than only in `syncArchiveIfNeeded` so the run the seed
  // screen starts counts too: a user who has just watched their archive upload
  // should not have the next launch decide it was never done and send it again.
  if (finished && fingerprintAtStart) {
    try {
      setMeta(REVISION_KEY, String(SEED_REVISION));
      setMeta(SYNC_FINGERPRINT_KEY, fingerprintAtStart);
    } catch {
      // An unwritable stamp costs one redundant re-walk, which the server
      // dedupes. Never worth failing a successful upload over.
    }
  }

  return {
    comments,
    ratings,
    characters,
    images,
    finished,
    error: comments.error ?? ratings.error ?? characters.error,
  };
}

// ── healing itself, on open ──────────────────────────────────────────────────

/** The archive's current shape as one string. '' when the tables cannot be read. */
export function currentArchiveFingerprint(): string {
  try {
    return archiveFingerprint(archiveCounts());
  } catch {
    return '';
  }
}

/**
 * Bring whatever is missing, every time the app is opened. Resolves; never rejects.
 *
 * THIS REPLACES A BUTTON, and it had to. "Re-upload my archive" asked the user
 * to know something they cannot know: that a phase marked done under an older
 * build is never revisited, and that their votes therefore went up carrying one
 * feeling each. Nobody can see that from inside the app, so nobody would ever
 * tap it. The owner's words were: *I don't want to do the re-upload — when I
 * open the phone you check in the background that I uploaded them all, and if
 * not upload them again.*
 *
 * AN UNCHANGED LAUNCH COSTS ZERO REQUESTS, and that is a hard requirement, not
 * an optimisation — `backend/docs/PLAN.md` §4 sizes the whole free tier at a
 * handful of requests per user per day. Both halves of the comparison are local:
 * two `meta` reads and six `COUNT(*)`s. The steady state returns before a token
 * is even read, let alone a socket opened.
 *
 * THE THREE OUTCOMES, and why the middle one is not the same as the last:
 *
 *  - SAME REVISION, SAME FINGERPRINT → return. Nothing to say.
 *  - REVISION MOVED → every cursor and DONE flag is cleared, and the whole
 *    archive goes up again in the new shape. This is the contract-change path
 *    and the only one that re-walks history.
 *  - FINGERPRINT MOVED ONLY → run WITHOUT clearing anything. The cursors are
 *    intact, so each kind resumes from its bookmark and only the rows past it
 *    are sent. Someone who rated three episodes last night uploads three rows.
 *
 * FIRE AND FORGET. No UI, no spinner, no error. It is called after the first
 * frame is painted, and it is ordered BEFORE the aggregate prefetch so that the
 * percentages the user is about to be shown already include their own vote.
 */
export async function syncArchiveIfNeeded(): Promise<void> {
  try {
    // Not joined: there is nowhere to send anything, and seeding is a
    // publication that only a joined account has consented to.
    if (!isJoined()) return;

    const fingerprint = currentArchiveFingerprint();
    // Unreadable tables. Doing nothing is right: a run now would be deciding
    // what to publish from a database it could not read.
    if (!fingerprint) return;

    const action = decideArchiveSync(
      { revision: getMeta(REVISION_KEY), fingerprint: getMeta(SYNC_FINGERPRINT_KEY) },
      { revision: SEED_REVISION, fingerprint },
    );
    // The profile's shelves and totals are NOT part of the archive decision:
    // they change when an episode is watched, not when the archive's shape
    // does, and they are a replacement rather than a resumable walk. Their own
    // fingerprint decides, and it costs nothing when nothing has changed.
    void publishIfChanged();

    if (action === 'nothing') return;

    if (action === 'full') resetSeedProgress();

    // `seedEverything` stamps the revision and the fingerprint itself, and only
    // when all three kinds walked to the end.
    await seedEverything();
  } catch {
    // Nothing here is ever allowed to reach a launch. A failure means the next
    // open reaches the same decision and tries again.
  }
}

/**
 * Forget where every upload got to, so the next run walks the whole archive.
 *
 * WHY THIS IS NOT A "RESET" BUTTON IN THE DESTRUCTIVE SENSE. It deletes six
 * bookmarks and nothing else. No local row moves, no server row is removed, and
 * re-sending is safe by construction rather than by luck: `/v1/comments/import`
 * derives each row's id from its content, and both vote endpoints key on
 * (person, target). A re-sent row is written once and reported as `skipped`
 * every time after.
 *
 * WHY IT MATTERS RATHER THAN BEING MERELY HARMLESS. `runKeyedSeed` filters by a
 * saved cursor and stamps a DONE flag, and neither is ever revisited. So a phase
 * that finished under an older build is finished for ever, even where the
 * server would now accept more:
 *
 *  - Someone who seeded in the comment-only era carries `communitySeedDone` and
 *    has no ratings and no favourites on the server at all.
 *  - Someone who seeded before the multi-emotion contract has ratings carrying
 *    exactly ONE feeling each, because the old mapper kept the lowest-indexed
 *    one and dropped the rest. Every other face they ever tapped is missing.
 *
 * Neither is visible from inside the app. Walking the archive again is the only
 * repair, which is why this is offered in Settings and not left to a migration.
 *
 * The key list lives in `pure.ts` with a guard test over it, for the same reason
 * the account-deletion list does: `meta` is one flat table, and a loop written
 * in a hurry here would take `tvtimeFriends` with it.
 */
export function resetSeedProgress(): void {
  for (const key of metaKeysClearedByArchiveReupload()) {
    try {
      setMeta(key, '');
    } catch {
      // A key that will not clear costs this run the rows behind it, not the
      // run. `readProgress` and `readKeyedProgress` both read '' as no progress.
    }
  }
}

// ── reconnection ─────────────────────────────────────────────────────────────

/** A person the server found, exactly as `POST /v1/me/friends/reconcile` shapes them. */
export type FriendMatch = {
  handle: string;
  display_name: string | null;
  avatar_key: string | null;
  /**
   * WHICH friend this is — the id from the user's own export that this profile
   * answered to. Without it a matched handle cannot be tied to the person it
   * belongs to, and a merged follow list shows the same human twice: once as a
   * TV Time row carrying their old name and avatar, once as an OpenTV one.
   * Null only for a match stored before the server returned it.
   */
  tvtime_user_id?: number | null;
};

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
