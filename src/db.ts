/**
 * Local SQLite database — the app's source of truth (Phase 1).
 * On first launch it imports the bundled data generated from the TV Time
 * GDPR export (seed.json + records.json); afterwards all reads/writes go
 * through here. Metadata sync (Phase 2) will add episode catalogs.
 */
import * as SQLite from 'expo-sqlite';

import records from '@/data/records.json';
import { interestKey, parseInterest, disambiguatedMovieName, episodeKey, type MemoryEvent, mayFoldDuplicateShow, mergeCustomLists, movedListIndex, movieIdentityMatches, nextCharacterVote, renumberLists, resolveMovieRow, slug, watchRuntimeSeconds, type ArchiveCounts } from '@/pure';
import seed from '@/seed';

const db = SQLite.openDatabaseSync('ourtvtime.db');

db.execSync(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS shows (
    tvdbId INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    posterUrl TEXT,
    episodesSeen INTEGER NOT NULL DEFAULT 0,
    followed INTEGER NOT NULL DEFAULT 0,
    favorited INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    finished INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS watches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    showId INTEGER NOT NULL,
    season INTEGER NOT NULL,
    episode INTEGER NOT NULL,
    watchedAt TEXT NOT NULL,
    rewatch INTEGER NOT NULL DEFAULT 0,
    runtime INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_watches_show ON watches(showId, season, episode);
  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episodeId INTEGER,
    movie TEXT,
    value INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS emotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episodeId INTEGER,
    movie TEXT,
    value INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS episode_ratings (
    showId INTEGER NOT NULL,
    season INTEGER NOT NULL,
    episode INTEGER NOT NULL,
    stars INTEGER NOT NULL,
    PRIMARY KEY (showId, season, episode)
  );
  CREATE TABLE IF NOT EXISTS episode_emotions (
    showId INTEGER NOT NULL,
    season INTEGER NOT NULL,
    episode INTEGER NOT NULL,
    emotion INTEGER NOT NULL,
    PRIMARY KEY (showId, season, episode, emotion)
  );
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS movies (
    name TEXT PRIMARY KEY,
    originalName TEXT,
    poster TEXT,
    year TEXT,
    tmdbId INTEGER,
    stars INTEGER,
    watchedAt TEXT,
    runtime INTEGER,
    addedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    entity TEXT NOT NULL,
    text TEXT NOT NULL,
    date TEXT NOT NULL,
    likes INTEGER NOT NULL DEFAULT 0,
    replies INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    imageUrl TEXT,
    ratio REAL,
    imageTried INTEGER NOT NULL DEFAULT 0
  );
`);
// existing installs created the table before these columns existed
try {
  db.execSync('ALTER TABLE movies ADD COLUMN addedAt TEXT');
} catch {
  // column already there
}
try {
  db.execSync('ALTER TABLE shows ADD COLUMN addedAt TEXT');
} catch {
  // column already there
}
try {
  db.execSync('ALTER TABLE movies ADD COLUMN watchedOn TEXT');
} catch {
  // column already there
}
try {
  db.execSync('ALTER TABLE movies ADD COLUMN rewatchCount INTEGER');
} catch {
  // column already there
}
db.execSync(`
  CREATE TABLE IF NOT EXISTS episode_watched_on (
    showId INTEGER NOT NULL,
    season INTEGER NOT NULL,
    episode INTEGER NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (showId, season, episode)
  );
`);
db.execSync(`
  CREATE TABLE IF NOT EXISTS character_votes (
    showId INTEGER NOT NULL,
    season INTEGER NOT NULL,
    episode INTEGER NOT NULL,
    name TEXT,
    charId INTEGER,
    PRIMARY KEY (showId, season, episode)
  );
`);

try {
  // Set once we have ASKED TheTVDB about this row's `charId` and got a real
  // answer — either a name (written to `name`) or "no such character". A
  // failed request must leave this 0; see `backfillCharacterNames`.
  db.execSync('ALTER TABLE character_votes ADD COLUMN nameTried INTEGER NOT NULL DEFAULT 0');
} catch {
  // column already there
}

// A film's favourite. A SEPARATE TABLE and not a row in `character_votes`,
// because that table's primary key is `(showId, season, episode)` — three NOT
// NULL integers a film has none of, and inventing a pseudo-showId for films
// would collide with a real TheTVDB series id. Films are keyed by name
// everywhere else in this schema for exactly the same reason (`emotions.movie`,
// `movies.name`), so this follows the house rule rather than bending the other.
db.execSync(`
  CREATE TABLE IF NOT EXISTS movie_character_votes (
    movie TEXT PRIMARY KEY,
    name TEXT,
    charId INTEGER
  );
`);

// Exact backup change-detection: a counter bumped on ANY row change to a
// user-data table (insert/update/delete), so backupNow can skip precisely —
// even a symmetric edit that leaves row counts and sums unchanged still bumps
// it. `meta` is intentionally excluded: it's written constantly for non-user
// reasons (progress flags, cache markers) and would make the counter useless.
db.execSync(`
  CREATE TABLE IF NOT EXISTS _dirty (id INTEGER PRIMARY KEY CHECK (id = 0), n INTEGER NOT NULL DEFAULT 0);
  INSERT OR IGNORE INTO _dirty (id, n) VALUES (0, 0);
`);
for (const t of [
  'shows',
  'watches',
  'ratings',
  'emotions',
  'episode_ratings',
  'episode_emotions',
  'movies',
  'comments',
  'episode_watched_on',
  'character_votes',
  'movie_character_votes',
]) {
  for (const op of ['INSERT', 'UPDATE', 'DELETE'] as const) {
    db.execSync(
      `CREATE TRIGGER IF NOT EXISTS _dirty_${t}_${op.toLowerCase()} AFTER ${op} ON ${t} BEGIN UPDATE _dirty SET n = n + 1 WHERE id = 0; END;`,
    );
  }
}

/** A monotonic counter of user-data row changes — for exact backup skipping. */
export function libraryDirtyRev(): number {
  return db.getFirstSync<{ n: number }>('SELECT n FROM _dirty WHERE id = 0')?.n ?? 0;
}

try {
  db.execSync('ALTER TABLE movies ADD COLUMN favorited INTEGER NOT NULL DEFAULT 0');
} catch {
  // column already there
}
try {
  db.execSync('ALTER TABLE shows ADD COLUMN finished INTEGER NOT NULL DEFAULT 0');
} catch {
  // column already there
}
try {
  db.execSync('ALTER TABLE comments ADD COLUMN imageUrl TEXT');
} catch {
  // column already there
}
try {
  db.execSync('ALTER TABLE comments ADD COLUMN imageTried INTEGER NOT NULL DEFAULT 0');
} catch {
  // column already there
}
try {
  db.execSync('ALTER TABLE comments ADD COLUMN ratio REAL');
} catch {
  // column already there
}
// WHERE THE ROW CAME FROM: 'app' for one this phone posted to the community and
// kept a copy of, NULL for everything the TV Time import wrote. Only the second
// kind may be seeded — see `SEEDABLE_COMMENT_WHERE`. NULL is the right default
// for existing installs: every row already in this table predates in-app
// posting, so every one of them is archive.
try {
  db.execSync('ALTER TABLE comments ADD COLUMN origin TEXT');
} catch {
  // column already there
}
// TV Time keeps favorites in the user's own order — rank preserves it
try {
  db.execSync('ALTER TABLE shows ADD COLUMN favoriteRank INTEGER');
} catch {
  // column already there
}
try {
  db.execSync('ALTER TABLE movies ADD COLUMN favoriteRank INTEGER');
} catch {
  // column already there
}
// 1.2.0: both database ids live on the row. tvdbId is already the shows PK;
// this adds the optional TMDB id, which is enrichment-only now (rating,
// similar, providers) — NULL is a normal permanent state for a show TMDB
// never matched, not a defect.
try {
  db.execSync('ALTER TABLE shows ADD COLUMN tmdbId INTEGER');
} catch {
  // column already there
}
/*
 * THE SERVER'S OWN ID for a comment this app posted.
 *
 * A seeded comment is addressed by a hash of what it IS (author, target, date,
 * body) -- the same hash on both ends, so neither needs to store an id. A
 * comment written in the app is different: the server mints a `c_…` for it, and
 * no hash can reproduce that. Without this column, deleting such a comment from
 * the archive removed the local row and left the server's copy in the thread,
 * so `delete` meant different things on two screens.
 */
try {
  db.execSync('ALTER TABLE comments ADD COLUMN serverId TEXT');
} catch {
  // column already there
}
// Whether TheTVDB has been asked what this show is called. Only ever set on a
// definitive 404 — see `markShowNameTried`.
try {
  db.execSync('ALTER TABLE shows ADD COLUMN nameTried INTEGER NOT NULL DEFAULT 0');
} catch {
  // column already there
}
try {
  db.execSync('ALTER TABLE movies ADD COLUMN tvdbId INTEGER');
} catch {
  // column already there
}
// the real release date, so planned movies can split into out-now vs upcoming.
// `year` alone can't: a film dated this year may still be months away.
try {
  db.execSync('ALTER TABLE movies ADD COLUMN releaseDate TEXT');
} catch {
  // column already there
}
// the export gives a movie NAME and nothing else, so a generic title can only
// be resolved by inference. 1 = we picked a plausible candidate rather than a
// certain one, and the Review screen offers it for confirmation.
try {
  db.execSync('ALTER TABLE movies ADD COLUMN matchGuessed INTEGER NOT NULL DEFAULT 0');
} catch {
  // column already there
}
// 1 = the user added this film in-app rather than importing it. Shows carry the
// same intent via `addedAt`; without it the duplicate-cleaner that runs after
// every import could delete a film added from search, the movie twin of the
// Discover-added-show bug fixed in 1.2.0.
try {
  db.execSync('ALTER TABLE movies ADD COLUMN userAdded INTEGER NOT NULL DEFAULT 0');
} catch {
  // column already there
}
// 1 = TheTVDB has answered about this film's id, one way or the other. Set on a
// match AND on a definitive "no film by that name" / "too ambiguous to be sure",
// because both are answers that will not change. NEVER set from a failed
// request — see backfillMovieTvdbIds.
try {
  db.execSync('ALTER TABLE movies ADD COLUMN tvdbTried INTEGER NOT NULL DEFAULT 0');
} catch {
  // column already there
}

// ---- library ownership -------------------------------------------------------
// public builds never auto-seed: a virgin install starts with an empty
// library and the welcome screen offers Import / Start Fresh only
const ownerRow = db.getFirstSync<{ value: string }>("SELECT value FROM meta WHERE key = 'libraryOwner'")?.value;

// ---- top-up: your episode ratings + emotions from the GDPR export -----------
// version-gated via the meta table; bumping VOTES_VERSION wipes and re-imports
// (v2 fixed the 0-based star scale). If anything here fails, reads fall back
// to the bundled file directly, so votes still display.
const VOTES_VERSION = '3';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bundledVotes = require('@/data/episode-votes.json') as {
  ratings: { showId: number; season: number; episode: number; stars: number }[];
  emotions: { showId: number; season: number; episode: number; emotion: number }[];
};
let votesInDb = false;
try {
  const ver = db.getFirstSync<{ value: string }>("SELECT value FROM meta WHERE key = 'votesVersion'")?.value;
  // 'imported' = the importer owns these tables; 'fresh'/'imported' libraries never get seed data
  if (ver !== VOTES_VERSION && ver !== 'imported' && ownerRow === 'seed') {
    db.withTransactionSync(() => {
      db.runSync('DELETE FROM episode_ratings');
      db.runSync('DELETE FROM episode_emotions');
      for (const r of bundledVotes.ratings) {
        db.runSync('INSERT OR REPLACE INTO episode_ratings (showId, season, episode, stars) VALUES (?, ?, ?, ?)', [
          r.showId,
          r.season,
          r.episode,
          r.stars,
        ]);
      }
      for (const e of bundledVotes.emotions) {
        db.runSync('INSERT OR IGNORE INTO episode_emotions (showId, season, episode, emotion) VALUES (?, ?, ?, ?)', [
          e.showId,
          e.season,
          e.episode,
          e.emotion,
        ]);
      }
      db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('votesVersion', ?)", [VOTES_VERSION]);
    });
    console.log(`[votes] imported ${bundledVotes.ratings.length} ratings, ${bundledVotes.emotions.length} emotions`);
  }
  votesInDb = true;
} catch (err) {
  console.warn('[votes] import failed, reads will use the bundled file:', err);
}

// bundled-file index for the fallback path
const bundledStars = new Map<string, number>(
  bundledVotes.ratings.map((r) => [`${r.showId}-${r.season}-${r.episode}`, r.stars]),
);
const bundledEmotions = new Map<string, number[]>();
for (const e of bundledVotes.emotions) {
  const k = `${e.showId}-${e.season}-${e.episode}`;
  if (!bundledEmotions.has(k)) bundledEmotions.set(k, []);
  bundledEmotions.get(k)!.push(e.emotion);
}

// ---- movies into SQLite: the db is the source of truth, seed.json only seeds -
// v2 split the old combined list into truly-watched + the to-watch list
const MOVIES_VERSION = '3';
{
  const ver = db.getFirstSync<{ value: string }>("SELECT value FROM meta WHERE key = 'moviesVersion'")?.value;
  // 'imported' = the importer owns these tables; 'fresh'/'imported' libraries never get seed data
  if (ver !== MOVIES_VERSION && ver !== 'imported' && ownerRow === 'seed') {
    db.withTransactionSync(() => {
      db.runSync('DELETE FROM movies');
      for (const mv of seed.movies) {
        // export stored stars 0-based (0=BAD..4=WOW); normalize to 1-5,
        // drop the misfiled out-of-range vote rows
        const stars = mv.stars != null && mv.stars >= 0 && mv.stars <= 4 ? mv.stars + 1 : null;
        db.runSync(
          'INSERT OR REPLACE INTO movies (name, originalName, poster, year, tmdbId, stars, watchedAt, runtime) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [mv.name, mv.originalName ?? null, mv.poster ?? null, mv.year ?? null, mv.tmdbId ?? null, stars, mv.watchedAt ?? null, mv.runtime ?? null],
        );
      }
      for (const mv of seed.watchlist ?? []) {
        db.runSync(
          'INSERT OR IGNORE INTO movies (name, originalName, poster, year, tmdbId, stars, watchedAt, runtime, addedAt) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)',
          [mv.name, mv.originalName ?? null, mv.poster ?? null, mv.year ?? null, mv.tmdbId ?? null, null, mv.addedAt ?? null],
        );
      }
      db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('moviesVersion', ?)", [MOVIES_VERSION]);
    });
    console.log(`[movies] seeded ${seed.movies.length} watched + ${(seed.watchlist ?? []).length} planned`);
  }
}

// ---- keep posters fresh from bundled metadata (canonical TMDB artwork) ------
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const meta = require('@/data/metadata.json') as Record<string, { poster: string | null }>;
  db.withTransactionSync(() => {
    for (const [tvdbId, m] of Object.entries(meta)) {
      if (m.poster) {
        db.runSync('UPDATE shows SET posterUrl = ? WHERE tvdbId = ?', [m.poster, Number(tvdbId)]);
      }
    }
  });
  // re-apply user-chosen poster overrides so the bundled reset above never wins
  try {
    for (const r of db.getAllSync<{ key: string; value: string }>("SELECT key, value FROM meta WHERE key LIKE 'posterOverride:%'")) {
      db.runSync('UPDATE shows SET posterUrl = ? WHERE tvdbId = ?', [r.value, Number(r.key.split(':')[1])]);
    }
  } catch {}
}

// ---- queries -----------------------------------------------------------------

export type SeasonRow = { season: number; watched: number; lastWatchedAt: string };

/** Seasons of a show with real watched counts, from your import. */
export function getSeasons(showId: number): SeasonRow[] {
  return db.getAllSync<SeasonRow>(
    `SELECT season, COUNT(DISTINCT episode) AS watched, MAX(watchedAt) AS lastWatchedAt
     FROM watches WHERE showId = ? GROUP BY season ORDER BY season`,
    [showId],
  );
}

export type EpisodeWatch = {
  episode: number;
  watchedAt: string;
  rewatch: number;
  /** how many times it was rewatched beyond the first viewing — the episode
   *  list shows the number, not just that it happened */
  rewatches?: number;
};

/** Watched episodes of one season, in episode order. watchedAt is the FIRST
 * watch (rewatch rows keep their own dates — see getRewatchDates); showing
 * MAX would hide the original date behind the latest rewatch. */
export function getSeasonEpisodes(showId: number, season: number): EpisodeWatch[] {
  return db.getAllSync<EpisodeWatch>(
    `SELECT episode,
            COALESCE(MIN(CASE WHEN rewatch = 0 THEN watchedAt END), MIN(watchedAt)) AS watchedAt,
            MAX(rewatch) AS rewatch,
            SUM(CASE WHEN rewatch = 1 THEN 1 ELSE 0 END) AS rewatches
     FROM watches WHERE showId = ? AND season = ? GROUP BY episode ORDER BY episode`,
    [showId, season],
  );
}

/** Watch info for one episode, or null if unwatched. watchedAt = first watch. */
export function getWatch(showId: number, season: number, episode: number): EpisodeWatch | null {
  return (
    db.getFirstSync<EpisodeWatch>(
      `SELECT episode,
              COALESCE(MIN(CASE WHEN rewatch = 0 THEN watchedAt END), MIN(watchedAt)) AS watchedAt,
              MAX(rewatch) AS rewatch
       FROM watches WHERE showId = ? AND season = ? AND episode = ? GROUP BY episode`,
      [showId, season, episode],
    ) ?? null
  );
}

/** Every rewatch date of an episode, oldest first. */
export function getRewatchDates(showId: number, season: number, episode: number): string[] {
  return db
    .getAllSync<{ watchedAt: string }>(
      'SELECT watchedAt FROM watches WHERE showId = ? AND season = ? AND episode = ? AND rewatch = 1 ORDER BY watchedAt',
      [showId, season, episode],
    )
    .map((r) => r.watchedAt);
}

/** Recompute a show's episodesSeen from its actual watch rows. The raw import
 *  counter is written once and frozen, so without this an unmark can delete every
 *  row while the header and progress bar stay pinned at the old total — the exact
 *  "I unmark the season but nothing happens" report. `neverLower` protects a
 *  bulk-only show whose background fill is still pending (offline): marking a new
 *  episode must not shrink its inflated counter below the real rows before the
 *  fill has had a chance to materialise them. */
export function recountShow(showId: number, opts?: { neverLower?: boolean }): void {
  const rows =
    db.getFirstSync<{ n: number }>(
      `SELECT COUNT(DISTINCT season || '-' || episode) AS n FROM watches WHERE showId = ?`,
      [showId],
    )?.n ?? 0;
  db.runSync(
    opts?.neverLower
      ? 'UPDATE shows SET episodesSeen = MAX(episodesSeen, ?) WHERE tvdbId = ?'
      : 'UPDATE shows SET episodesSeen = ? WHERE tvdbId = ?',
    [rows, showId],
  );
}

/**
 * Episodes the user un-checked by hand.
 *
 * Every other correction survives a re-import: a deleted show is tombstoned, so
 * is a deleted movie, so is a renamed list. Un-checking an episode was the one
 * gap — the export still lists it, merge mode re-inserts anything it can't find
 * locally, and it came straight back. Worse silently, because a REPAIR_REV bump
 * re-imports the preserved ZIP with no user action at all.
 *
 * Keyed "showId-season-episode". Cleared the moment the user marks the same
 * episode again, so this only ever records a standing correction. A replace-mode
 * import wipes `meta` first, which clears the list — correct, since that is a
 * deliberate fresh start.
 */
export function unmarkedEpisodeKeys(): Set<string> {
  try {
    const raw = getMeta('unmarkedEpisodes');
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveUnmarkedEpisodes(keys: Set<string>): void {
  setMeta('unmarkedEpisodes', JSON.stringify([...keys]));
}

/** Forget the un-mark for one episode — the user marked it watched again. */
function clearUnmarkTombstone(showId: number, season: number, episode: number): void {
  const keys = unmarkedEpisodeKeys();
  if (keys.delete(episodeKey(showId, season, episode))) saveUnmarkedEpisodes(keys);
}

/** Mark an episode watched right now. */

/**
 * The show's name and poster from the metadata cache, for `markWatched`.
 *
 * A LOCAL READ RATHER THAN AN IMPORT. `db.ts` is imported by nearly every
 * module here; importing `metadata.ts` back into it invites a cycle for the
 * sake of two fields. The cache is a `meta` row, which this file already owns.
 */
function showMetaForTracking(tvdbId: number): { name: string; poster: string | null } | null {
  try {
    const raw = getMeta(`showMeta:${tvdbId}`);
    if (!raw) return null;
    const m = JSON.parse(raw) as { name?: string; poster?: string | null };
    return { name: m.name ?? '', poster: m.poster ?? null };
  } catch {
    return null;
  }
}

export function markWatched(showId: number, season: number, episode: number): void {
  /*
   * WATCHING SOMETHING PUTS IT IN YOUR LIBRARY.
   *
   * Reported from Discord: mark a whole season watched and the show still
   * offers "Add show", in search and on its own page. It was right, which is
   * the worst kind of wrong — `watches` rows were written and no `shows` row
   * ever was, so by every honest test the show was not in the library while its
   * entire season sat ticked.
   *
   * Here rather than in the four callers, because "is this in my library" is
   * one question and this is the act that changes the answer. INSERT OR IGNORE
   * inside, so a show already tracked is untouched and its `addedAt` is not
   * rewritten.
   *
   * The name comes from metadata when the app has it; when it does not,
   * `ensureShowTracked` falls back and the next metadata sync fills it in.
   * Requiring a name here would mean the fix worked only for shows the app had
   * already fetched, which is not the case that broke.
   */
  const meta = showMetaForTracking(showId);
  ensureShowTracked(showId, meta?.name ?? '', meta?.poster ?? null);
  db.runSync('INSERT INTO watches (showId, season, episode, watchedAt, rewatch) VALUES (?, ?, ?, ?, 0)', [
    showId,
    season,
    episode,
    new Date().toISOString().slice(0, 19).replace('T', ' '),
  ]);
  // marking it again withdraws the correction, so a re-import may restore it
  clearUnmarkTombstone(showId, season, episode);
  recountShow(showId, { neverLower: true });
}

/** Remove all watch records of an episode (un-check). */
export function unmarkWatched(showId: number, season: number, episode: number): void {
  db.runSync('DELETE FROM watches WHERE showId = ? AND season = ? AND episode = ?', [showId, season, episode]);
  // remember it, or the next import (including the silent self-repair) puts it
  // straight back — the user's correction has to outlive the export
  const keys = unmarkedEpisodeKeys();
  keys.add(episodeKey(showId, season, episode));
  saveUnmarkedEpisodes(keys);
  recountShow(showId);
}

/** How many times an episode was rewatched (beyond the first watch). */
export function getRewatchCount(showId: number, season: number, episode: number): number {
  return (
    db.getFirstSync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM watches WHERE showId = ? AND season = ? AND episode = ? AND rewatch = 1',
      [showId, season, episode],
    )?.n ?? 0
  );
}

/** Add a rewatch record ("+1 Rewatched"). */
export function markRewatched(showId: number, season: number, episode: number): void {
  db.runSync('INSERT INTO watches (showId, season, episode, watchedAt, rewatch) VALUES (?, ?, ?, ?, 1)', [
    showId,
    season,
    episode,
    new Date().toISOString().slice(0, 19).replace('T', ' '),
  ]);
}

/** Set of "season-episode" keys you've watched for one show. */
export function getWatchedSet(showId: number): Set<string> {
  const rows = db.getAllSync<{ season: number; episode: number }>(
    'SELECT DISTINCT season, episode FROM watches WHERE showId = ?',
    [showId],
  );
  return new Set(rows.map((r) => `${r.season}-${r.episode}`));
}

export type ShowProgress = {
  tvdbId: number;
  name: string;
  posterUrl: string | null;
  followed: number;
  archived: number; // TV Time "stopped watching"
  finished: number; // 1 = user manually marked the show complete
  episodesSeen: number;
  addedAt: string | null; // set when the show was added in-app (not via import)
  watched: number;
  lastWatchedAt: string | null;
  nextSeason: number;
  nextEpisode: number;
};

/** Per-show progress for the Watch Next screen: watch counts, last activity,
 *  and the next episode after the furthest one you watched. */
export function getShowProgress(): ShowProgress[] {
  const shows = db.getAllSync<{
    tvdbId: number;
    name: string;
    posterUrl: string | null;
    followed: number;
    archived: number;
    finished: number;
    episodesSeen: number;
    addedAt: string | null;
  }>('SELECT tvdbId, name, posterUrl, followed, archived, finished, episodesSeen, addedAt FROM shows');

  const agg = db.getAllSync<{
    showId: number;
    season: number;
    cnt: number;
    maxEp: number;
    last: string;
  }>(
    `SELECT showId, season, COUNT(DISTINCT episode) AS cnt, MAX(episode) AS maxEp, MAX(watchedAt) AS last
     FROM watches GROUP BY showId, season`,
  );

  const byShow = new Map<number, { watched: number; last: string; season: number; maxEp: number }>();
  for (const a of agg) {
    const cur = byShow.get(a.showId);
    if (!cur) {
      byShow.set(a.showId, { watched: a.cnt, last: a.last, season: a.season, maxEp: a.maxEp });
    } else {
      cur.watched += a.cnt;
      if (a.last > cur.last) cur.last = a.last;
      if (a.season > cur.season) {
        cur.season = a.season;
        cur.maxEp = a.maxEp;
      }
    }
  }

  return shows.map((s) => {
    const w = byShow.get(s.tvdbId);
    return {
      ...s,
      watched: w?.watched ?? 0,
      lastWatchedAt: w?.last ?? null,
      nextSeason: w?.season ?? 1,
      nextEpisode: (w?.maxEp ?? 0) + 1,
    };
  });
}

/**
 * The two per-show numbers the library filters need and `ShowProgress` has no
 * business carrying: the user's own average rating for a show, and every
 * calendar year they watched something in it.
 *
 * TWO GROUPED QUERIES for the whole library, not one per show. The Filters
 * sheet asks for this on open and the Shows grid on every focus, so a library
 * of a few thousand shows has to cost two indexed scans, not a few thousand
 * round trips.
 */
export type ShowFilterFacts = { stars: number | null; years: string[] };

export function getShowFilterFacts(): Map<number, ShowFilterFacts> {
  const out = new Map<number, ShowFilterFacts>();
  const at = (id: number): ShowFilterFacts => {
    let f = out.get(id);
    if (!f) {
      f = { stars: null, years: [] };
      out.set(id, f);
    }
    return f;
  };
  try {
    // rounded, because the axis is "shows I rated 4+" and an average of 3.6
    // is a 4-star show to the person who gave those ratings
    const rated = db.getAllSync<{ showId: number; avg: number }>(
      'SELECT showId, AVG(stars) AS avg FROM episode_ratings WHERE stars > 0 GROUP BY showId',
    );
    for (const r of rated) at(r.showId).stars = Math.round(r.avg);
  } catch {
    // no ratings table on this install - the axis just has no options
  }
  try {
    const years = db.getAllSync<{ showId: number; y: string }>(
      'SELECT DISTINCT showId, substr(watchedAt, 1, 4) AS y FROM watches WHERE watchedAt IS NOT NULL',
    );
    for (const r of years) if (/^\d{4}$/.test(r.y)) at(r.showId).years.push(r.y);
  } catch {}
  return out;
}

/** Your saved rating + emotions for one episode (from the import or in-app). */
export function getEpisodeVote(showId: number, season: number, episode: number): { stars: number | null; emotions: number[] } {
  const key = `${showId}-${season}-${episode}`;
  try {
    if (!votesInDb) throw new Error('votes not in db');
    const r = db.getFirstSync<{ stars: number }>(
      'SELECT stars FROM episode_ratings WHERE showId = ? AND season = ? AND episode = ?',
      [showId, season, episode],
    );
    const es = db.getAllSync<{ emotion: number }>(
      'SELECT emotion FROM episode_emotions WHERE showId = ? AND season = ? AND episode = ?',
      [showId, season, episode],
    );
    return { stars: r?.stars ?? null, emotions: es.map((e) => e.emotion) };
  } catch {
    // db unavailable — serve your imported votes straight from the bundle
    return { stars: bundledStars.get(key) ?? null, emotions: bundledEmotions.get(key) ?? [] };
  }
}

export function setEpisodeRating(showId: number, season: number, episode: number, stars: number): void {
  db.runSync('INSERT OR REPLACE INTO episode_ratings (showId, season, episode, stars) VALUES (?, ?, ?, ?)', [
    showId,
    season,
    episode,
    stars,
  ]);
}

/** Emotions are multi-select in TV Time — tapping toggles one on/off. */
export function toggleEpisodeEmotion(showId: number, season: number, episode: number, emotion: number): void {
  const exists = db.getFirstSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM episode_emotions WHERE showId = ? AND season = ? AND episode = ? AND emotion = ?',
    [showId, season, episode, emotion],
  );
  if ((exists?.n ?? 0) > 0) {
    db.runSync('DELETE FROM episode_emotions WHERE showId = ? AND season = ? AND episode = ? AND emotion = ?', [
      showId,
      season,
      episode,
      emotion,
    ]);
  } else {
    db.runSync('INSERT INTO episode_emotions (showId, season, episode, emotion) VALUES (?, ?, ?, ?)', [
      showId,
      season,
      episode,
      emotion,
    ]);
  }
}

/** Start tracking a show discovered in the feed/search. */
export function addShow(tvdbId: number, name: string, posterUrl: string | null): void {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  db.runSync(
    'INSERT OR IGNORE INTO shows (tvdbId, name, posterUrl, episodesSeen, followed, favorited, archived, addedAt) VALUES (?, ?, ?, 0, 1, 0, 0, ?)',
    [tvdbId, name, posterUrl, now],
  );
  // a new show may need metadata — let the offline pre-cache run again
  db.runSync('DELETE FROM meta WHERE key = ?', ['metaCacheComplete']);
}

/** Follow/unfollow without touching history — unfollowed shows stay in the
 * library but leave Up Next (and the widgets, which filter on followed). */
export function setFollowing(showId: number, followed: boolean): void {
  db.runSync('UPDATE shows SET followed = ? WHERE tvdbId = ?', [followed ? 1 : 0, showId]);
}

/**
 * Give every current favourite a number, in the order they are already shown.
 *
 * WHY IT HAS TO RUN BEFORE AN APPEND. `favoriteRank` was nullable and nothing
 * filled it on add, so a shelf can hold a mix: imported entries carrying TV
 * Time's order, and in-app ones carrying nothing. Unranked entries sort LAST
 * by the reader's `(favoriteRank IS NULL)` clause, so appending `MAX + 1` would
 * drop the new favourite ABOVE them — last by the numbers, mid-shelf on screen.
 *
 * A no-op once the shelf is fully numbered, which it is after the first add or
 * the first drag, so this costs one read on every subsequent call and nothing
 * more.
 */
function normaliseFavoriteRanks(table: 'shows' | 'movies', col: 'tvdbId' | 'name'): void {
  const gaps = db.getFirstSync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE favorited = 1 AND favoriteRank IS NULL`,
  );
  if (!gaps || gaps.n === 0) return;
  const rows = db.getAllSync<{ k: string | number }>(
    `SELECT ${col} AS k FROM ${table} WHERE favorited = 1 ORDER BY (favoriteRank IS NULL), favoriteRank, name`,
  );
  rows.forEach((r, i) => db.runSync(`UPDATE ${table} SET favoriteRank = ? WHERE ${col} = ?`, [i, r.k]));
}

/**
 * Mark a show as a favorite (shows in the Favorites row).
 *
 * A NEW FAVOURITE GOES TO THE FRONT, and dropping one forgets where it sat.
 * Neither used to touch `favoriteRank`, so where a newly hearted show landed
 * was decided by whatever number happened to be left on the row — an old import
 * position, or the slot it held the last time it was a favourite. The visible
 * half of that is a show appearing somewhere in the middle of a shelf you just
 * arranged; the other half is that the twenty published to a profile were not
 * the twenty the owner thought they had chosen.
 *
 * Front, not back, because a favourite is a thing you just decided you love —
 * it should be on the profile immediately, and with a twenty-poster cap a new
 * favourite appended to the end of a long shelf would be published nowhere.
 * Everything else shifts down one; drag from there.
 */
export function setShowFavorited(showId: number, favorited: boolean): void {
  if (favorited) {
    normaliseFavoriteRanks('shows', 'tvdbId');
    db.withTransactionSync(() => {
      db.runSync('UPDATE shows SET favoriteRank = favoriteRank + 1 WHERE favorited = 1');
      db.runSync('UPDATE shows SET favorited = 1, favoriteRank = 0 WHERE tvdbId = ?', [showId]);
    });
  } else {
    db.runSync('UPDATE shows SET favorited = 0, favoriteRank = NULL WHERE tvdbId = ?', [showId]);
  }
}

/** "Stopped watching" — archived shows leave Up Next/widgets and land in the
 * Stopped filter, keeping their history. Archiving also unfollows. */
export function setShowArchived(showId: number, archived: boolean): void {
  db.runSync('UPDATE shows SET archived = ?, followed = CASE WHEN ? THEN 0 ELSE followed END WHERE tvdbId = ?', [
    archived ? 1 : 0,
    archived ? 1 : 0,
    showId,
  ]);
}

/** Manually mark a show complete — for shows the app can't compute a total for
 * (offline / not on TMDB) or that the user just wants to force to "finished".
 * Purely a display flag; it never touches watch history. */
export function setShowFinished(showId: number, finished: boolean): void {
  db.runSync('UPDATE shows SET finished = ? WHERE tvdbId = ?', [finished ? 1 : 0, showId]);
}

/** TV Time keeps a deprecated duplicate entry for a show — an old TVDB id sits
 * next to the current one for the same series (e.g. "Once Upon A Time" #83882
 * with 0 watches beside "Once Upon a Time (2011)" #248835 with all the
 * history). The empty one shows "0 watched" for a show you finished; sometimes
 * the watches are even SPLIT across both ids. Fold each set into one: keep the
 * id with the most history, MOVE any watches/votes off the others onto it (never
 * deleting a watch), then drop the empties. Guarded by TMDB id so two genuinely
 * different shows that merely share a name are never merged. Returns # removed. */
/**
 * Promote TMDB ids out of the `showTmdbHint:` meta keys into the real column
 * added in 1.2.0. Idempotent — only fills rows that are still NULL, so it is a
 * cheap no-op on every launch after the first.
 */
export function backfillShowTmdbIds(): void {
  try {
    db.execSync(`
      UPDATE shows SET tmdbId = CAST(
        (SELECT value FROM meta WHERE key = 'showTmdbHint:' || shows.tvdbId) AS INTEGER)
      WHERE tmdbId IS NULL
        AND EXISTS (SELECT 1 FROM meta WHERE key = 'showTmdbHint:' || shows.tvdbId
                    AND value <> '')
    `);
  } catch {
    // a backfill hiccup must never block startup — retried next launch
  }
}

/**
 * Fold TV Time's two spellings of one film into a single row.
 *
 * `movies.name` is the primary key, so an import can leave BOTH
 * "Dune (2021)" (watched, originalName "Dune") and a bare "Dune" from the
 * watchlist. The grid listed the unwatched copy while opening it resolved via
 * `name = ? OR originalName = ?` to the watched one — so a film read "not
 * watched" outside and "watched" inside (reported by a tester).
 *
 * Merges into the row that carries real history, taking any field the winner
 * lacks from the loser. Refuses to fold two different years: "Dune (1984)" and
 * "Dune (2021)" are different films, the same trap the show deduper hit.
 *
 * Idempotent — a no-op once the library is clean.
 */
export function dedupeDuplicateMovies(): number {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { canFoldMovie, mayFoldDuplicateMovie, movieBaseName } = require('@/pure') as typeof import('@/pure');
  const movies = db.getAllSync<MovieRow>('SELECT * FROM movies');

  const groups = new Map<string, MovieRow[]>();
  for (const m of movies) {
    const k = movieBaseName(m.name);
    if (!k) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(m);
  }

  // a watched row outranks a rated one, which outranks one with artwork —
  // whatever holds the most user intent survives and absorbs the rest
  const rank = (m: MovieRow) =>
    (m.watchedAt ? 8 : 0) + (m.stars != null ? 4 : 0) + (m.favorited ? 2 : 0) + (m.poster ? 1 : 0);

  let removed = 0;
  db.withTransactionSync(() => {
    for (const grp of groups.values()) {
      if (grp.length < 2) continue;
      const sorted = [...grp].sort((a, b) => rank(b) - rank(a));
      const keep = sorted[0];
      for (const drop of sorted.slice(1)) {
        if (!canFoldMovie({ name: keep.name, year: keep.year }, { name: drop.name, year: drop.year })) continue;
        // title and year match, but a row holding history or added by hand is
        // not disposable — fold it only on proven identity
        if (
          !mayFoldDuplicateMovie(
            {
              watched: drop.watchedAt != null,
              rated: drop.stars != null,
              favorited: !!drop.favorited,
              userAdded: !!drop.userAdded,
              tmdbId: drop.tmdbId,
            },
            { tmdbId: keep.tmdbId },
          )
        )
          continue;
        db.runSync(
          `UPDATE movies SET
             watchedAt    = COALESCE(watchedAt, ?),
             stars        = COALESCE(stars, ?),
             poster       = COALESCE(poster, ?),
             year         = COALESCE(year, ?),
             tmdbId       = COALESCE(tmdbId, ?),
             runtime      = COALESCE(runtime, ?),
             addedAt      = COALESCE(addedAt, ?),
             originalName = COALESCE(originalName, ?),
             rewatchCount = COALESCE(rewatchCount, ?),
             favorited    = MAX(favorited, ?)
           WHERE name = ?`,
          [
            drop.watchedAt,
            drop.stars,
            drop.poster,
            drop.year,
            drop.tmdbId,
            drop.runtime,
            drop.addedAt,
            drop.originalName ?? drop.name,
            drop.rewatchCount ?? null,
            drop.favorited ? 1 : 0,
            keep.name,
          ],
        );
        db.runSync('DELETE FROM movies WHERE name = ?', [drop.name]);
        removed++;
      }
    }
  });
  return removed;
}

export function dedupeDuplicateShows(): number {
  // addedAt is the discriminator: addShow/ensureShowTracked stamp it, the
  // importer never does — so a non-null value means the user added this show
  // in the app rather than it arriving in an export.
  const shows = db.getAllSync<{
    tvdbId: number;
    name: string;
    episodesSeen: number;
    followed: number;
    favorited: number;
    addedAt: string | null;
    tmdbId: number | null;
  }>('SELECT tvdbId, name, episodesSeen, followed, favorited, addedAt, tmdbId FROM shows');
  const tmdbCol = new Map(shows.map((s) => [s.tvdbId, s.tmdbId]));
  const tmdbOf = (tvdbId: number): number | null => {
    // the real column first — 1.2.0 added it and backfillShowTmdbIds fills it,
    // but this guard was still reading only the old meta key and the cached
    // JSON, so it was blind to the very identity the release introduced
    const col = tmdbCol.get(tvdbId) ?? null;
    if (col) return col;
    const hint = Number(getMeta(`showTmdbHint:${tvdbId}`)) || null;
    if (hint) return hint;
    const m = getMeta(`showMeta:${tvdbId}`)?.match(/"tmdbId":\s*(\d+)/);
    return m ? Number(m[1]) : null;
  };
  const watchCount = (tvdbId: number): number =>
    db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM watches WHERE showId = ?', [tvdbId])?.n ?? 0;
  // base name = normalized, with a trailing "(YYYY)"/year stripped, so
  // "Once Upon A Time" and "Once Upon a Time (2011)" collapse to one key
  const base = (name: string) =>
    name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+\d{4}\s*$/, '').trim();

  const groups = new Map<string, typeof shows>();
  for (const s of shows) {
    const k = base(s.name);
    if (!k) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
  }

  let removed = 0;
  db.withTransactionSync(() => {
    for (const grp of groups.values()) {
      if (grp.length < 2) continue;
      // two DIFFERENT known TMDB ids in one name-group = genuinely different
      // shows (e.g. remakes) — never merge those
      const ids = new Set(grp.map((s) => tmdbOf(s.tvdbId)).filter((x): x is number => x != null));
      if (ids.size > 1) continue;
      const scored = grp.map((s) => ({ ...s, w: watchCount(s.tvdbId) }));
      // primary = the real one: most watches, then counter, then followed
      const rank = (s: { w: number; episodesSeen: number; followed: number }) => s.w * 1e6 + s.episodesSeen * 10 + s.followed;
      const primary = scored.reduce((a, b) => (rank(b) > rank(a) ? b : a));
      for (const s of scored) {
        if (s.tvdbId === primary.tvdbId) continue;
        // An entry with real watch history, OR one the user added in the app,
        // may only be folded when both TMDB identities are known (the ids-guard
        // above then proves they're the same show). With identity unknown a
        // same-name sibling is more likely a remake ("Avatar" 2005 animated vs
        // 2024 live-action) than a duplicate, and folding destroys it: the
        // overlap guard drops every episode the primary also watched, then the
        // row itself is deleted.
        //
        // The userAdded half matters because a show tracked from Discover has
        // NO watches yet, so the history test alone never covered it — and
        // since TheTVDB became primary its TMDB id is only fetched when the
        // show is opened, so one added-but-not-opened had no identity either.
        // Re-importing deleted it. Imported placeholders (no history, no user
        // intent) still fold freely, which is what this pass exists for.
        if (!mayFoldDuplicateShow({ watches: s.w, userAdded: !!s.addedAt, tmdbId: tmdbOf(s.tvdbId) }, { tmdbId: tmdbOf(primary.tvdbId) })) continue;
        // move watches the primary doesn't already have (watches has no unique
        // key — rewatches — so guard with NOT EXISTS to avoid dupe rows), then
        // drop any overlapping leftovers
        db.runSync(
          `UPDATE watches SET showId = ? WHERE showId = ? AND NOT EXISTS (
             SELECT 1 FROM watches w2 WHERE w2.showId = ? AND w2.season = watches.season AND w2.episode = watches.episode)`,
          [primary.tvdbId, s.tvdbId, primary.tvdbId],
        );
        db.runSync('DELETE FROM watches WHERE showId = ?', [s.tvdbId]);
        // votes/reactions/watched-on: unique per (show,season,episode) — OR
        // IGNORE keeps the primary's on collision, then drop the rest
        for (const t of ['episode_ratings', 'episode_emotions', 'episode_watched_on', 'character_votes']) {
          db.runSync(`UPDATE OR IGNORE ${t} SET showId = ? WHERE showId = ?`, [primary.tvdbId, s.tvdbId]);
          db.runSync(`DELETE FROM ${t} WHERE showId = ?`, [s.tvdbId]);
        }
        // favorite/finished flags carry over if the primary lacks them
        if (s.favorited && !primary.favorited) db.runSync('UPDATE shows SET favorited = 1 WHERE tvdbId = ?', [primary.tvdbId]);
        db.runSync('DELETE FROM shows WHERE tvdbId = ?', [s.tvdbId]);
        removed++;
      }
      recountShow(primary.tvdbId);
    }
  });
  return removed;
}

/** Re-key a show onto a different TVDB id, folding its history onto the target.
 *
 * TV Time often exports a show under a now-deprecated TheTVDB id (the entry was
 * later merged/renumbered upstream). Everything that resolves through TMDB —
 * search, Explore — uses the CURRENT id, so a show you already track appears
 * untracked there ("Add show") and tapping it would spawn a duplicate. When a
 * manual match reveals the current id, move the library row and all its history
 * onto it so ONE id is used everywhere.
 *
 * If a row already exists at the target it's a genuine duplicate → merge onto
 * it (never dropping a watch). Otherwise the PK and its children are re-keyed in
 * place. Stale per-show metadata is cleared so it re-resolves under the new id.
 * Returns the canonical id the caller should use from here on. */
export function remapShowId(fromId: number, toId: number): number {
  if (!Number.isFinite(fromId) || !Number.isFinite(toId) || fromId === toId) return fromId || toId;
  // matching/re-keying is an explicit "keep this show" — never let either id
  // stay on the deleted list, or a later import skips its watches
  undeleteShowIds(fromId, toId);
  db.withTransactionSync(() => {
    const src = db.getFirstSync<{ followed: number; favorited: number; finished: number }>(
      'SELECT followed, favorited, finished FROM shows WHERE tvdbId = ?',
      [fromId],
    );
    const dstExists =
      db.getFirstSync<{ tvdbId: number }>('SELECT tvdbId FROM shows WHERE tvdbId = ?', [toId]) != null;
    if (src && !dstExists) {
      // clear path: re-key the row and every child table straight across
      db.runSync('UPDATE shows SET tvdbId = ? WHERE tvdbId = ?', [toId, fromId]);
      for (const t of ['watches', 'episode_ratings', 'episode_emotions', 'episode_watched_on', 'character_votes']) {
        db.runSync(`UPDATE ${t} SET showId = ? WHERE showId = ?`, [toId, fromId]);
      }
    } else {
      // a row already sits at the target (merge), OR the source row is gone but
      // orphan history may still be filed under the old id (a "needs attention"
      // entry). Move any watch history/votes across either way. watches has no
      // unique key (rewatches), so guard with NOT EXISTS then drop the overlap;
      // per-episode tables are unique so OR IGNORE keeps the target's.
      db.runSync(
        `UPDATE watches SET showId = ? WHERE showId = ? AND NOT EXISTS (
           SELECT 1 FROM watches w2 WHERE w2.showId = ? AND w2.season = watches.season AND w2.episode = watches.episode)`,
        [toId, fromId, toId],
      );
      db.runSync('DELETE FROM watches WHERE showId = ?', [fromId]);
      for (const t of ['episode_ratings', 'episode_emotions', 'episode_watched_on', 'character_votes']) {
        db.runSync(`UPDATE OR IGNORE ${t} SET showId = ? WHERE showId = ?`, [toId, fromId]);
        db.runSync(`DELETE FROM ${t} WHERE showId = ?`, [fromId]);
      }
      if (src) {
        // carry follow/favorite/finished onto the survivor if it lacks them,
        // then drop the old row
        if (dstExists) {
          db.runSync(
            'UPDATE shows SET followed = MAX(followed, ?), favorited = MAX(favorited, ?), finished = MAX(finished, ?) WHERE tvdbId = ?',
            [src.followed, src.favorited, src.finished, toId],
          );
        }
        db.runSync('DELETE FROM shows WHERE tvdbId = ?', [fromId]);
      }
    }
    // tvdbRowIds is the exception to the sweep below: it holds the TheTVDB
    // episode id behind every watch row, which only an import can produce, and
    // the export round-trip writes them back. The watches themselves have just
    // moved to the new id, so their episode ids must move with them — deleting
    // the key silently cost a fix-matched show its ids. Anything the target
    // already knows wins, having been resolved under the id it now lives at.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { mergeTvdbRowIds } = require('@/pure') as typeof import('@/pure');
      const read = (id: number): Record<string, number> => {
        const raw = db.getFirstSync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [`tvdbRowIds:${id}`])?.value;
        return raw ? (JSON.parse(raw) as Record<string, number>) : {};
      };
      const merged = mergeTvdbRowIds(read(fromId), read(toId));
      if (Object.keys(merged).length > 0) {
        db.runSync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [`tvdbRowIds:${toId}`, JSON.stringify(merged)]);
      }
    } catch {
      // unparseable bookkeeping is not worth failing a match over
    }
    // drop stale per-show bookkeeping under the old id — the fresh match will
    // re-resolve metadata (and episode order) under the new id
    for (const k of [`epRemap:${fromId}`, `tvdbRowIds:${fromId}`, `showTmdbHint:${fromId}`, `showMeta:${fromId}`, `showMovieLink:${fromId}`, `posterOverride:${fromId}`, `backdropOverride:${fromId}`]) {
      db.runSync('DELETE FROM meta WHERE key = ?', [k]);
    }
    // breadcrumb so callers that key on the OLD id (the import "Needs attention"
    // list marks an item fixed by looking up showMeta:<oldId>) still recognise
    // it as resolved after the row moved to the new id
    db.runSync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [`showRemap:${fromId}`, String(toId)]);
  });
  recountShow(toId);
  return toId;
}

/** Make sure a show is in the library and tracked (followed). Used after a
 * manual match: a "needs attention" entry can lack a shows row entirely, so
 * caching metadata alone would leave it invisible in the profile and shown as
 * "Add show" in search. Creates the row if missing (never overwrites an
 * existing one), then recounts from whatever watch history is now under it. */
export function ensureShowTracked(tvdbId: number, name: string, posterUrl: string | null): void {
  if (!Number.isFinite(tvdbId) || tvdbId <= 0) return;
  // an explicit match means the user WANTS this show — if it was ever deleted,
  // clear that so the next import stops skipping it and its watches
  undeleteShowIds(tvdbId);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  db.runSync(
    'INSERT OR IGNORE INTO shows (tvdbId, name, posterUrl, episodesSeen, followed, favorited, archived, addedAt) VALUES (?, ?, ?, 0, 1, 0, 0, ?)',
    [tvdbId, name || String(tvdbId), posterUrl, now],
  );
  recountShow(tvdbId, { neverLower: true });
}

/** Rename a library show (used after a manual match resolves the real title). */
export function setShowName(tvdbId: number, name: string): void {
  if (!name.trim()) return;
  db.runSync('UPDATE shows SET name = ? WHERE tvdbId = ?', [name.trim(), tvdbId]);
}

/** Shows the user deleted on purpose. The importer skips these, or the silent
 * self-repair re-import would resurrect every deleted show from the preserved
 * export on the next repair revision. A replace-mode import wipes meta, which
 * clears the list — exactly right, since the user asked for a clean start. */
export function deletedShowIds(): Set<number> {
  try {
    const raw = getMeta('deletedShows');
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    return new Set();
  }
}

/** Remove ids from the deleted list — an explicit match/track un-deletes a
 * show, so a later import stops skipping it (and its watches). Returns true if
 * anything was actually on the list. */
export function undeleteShowIds(...ids: number[]): boolean {
  const set = deletedShowIds();
  let changed = false;
  for (const id of ids) if (set.delete(id)) changed = true;
  if (changed) setMeta('deletedShows', JSON.stringify([...set]));
  return changed;
}

/** Remove a show and every trace of its history, and remember the deletion so
 * repairs never bring it back. */
export function deleteShow(showId: number): void {
  db.withTransactionSync(() => {
    for (const t of ['watches', 'episode_ratings', 'episode_emotions', 'episode_watched_on', 'character_votes']) {
      db.runSync(`DELETE FROM ${t} WHERE showId = ?`, [showId]);
    }
    db.runSync('DELETE FROM shows WHERE tvdbId = ?', [showId]);
    // per-show bookkeeping goes too
    for (const k of [`epRemap:${showId}`, `tvdbRowIds:${showId}`, `showTmdbHint:${showId}`]) {
      db.runSync('DELETE FROM meta WHERE key = ?', [k]);
    }
    const dead = deletedShowIds();
    dead.add(showId);
    setMeta('deletedShows', JSON.stringify([...dead]));
    // the show itself is tombstoned now, so its per-episode un-marks are dead
    // weight — drop them rather than grow the list forever
    const unmarked = unmarkedEpisodeKeys();
    let changed = false;
    for (const k of [...unmarked]) {
      if (k.startsWith(`${showId}-`)) {
        unmarked.delete(k);
        changed = true;
      }
    }
    if (changed) saveUnmarkedEpisodes(unmarked);
  });
}

/**
 * Add a movie to the watchlist from the feed/search.
 *
 * `movies.name` is the primary key, so two different films that share a
 * title ("Amado" 2011 and 2022) collide on it. `INSERT OR IGNORE` used to
 * hit that collision silently — adding the second film did nothing, and the
 * user could never have both in their library, with no sign of why.
 *
 * When the title is already taken by a row we can PROVE is a different film
 * (both sides carry a tmdbId and they disagree), this gives the new one a
 * "(year)" suffix — the same rule `importer.ts` already applies to the exact
 * same primary-key collision on GDPR import, via `disambiguatedMovieName`.
 *
 * When the existing row has no tmdbId at all (an imported film, never
 * matched against TMDB) there is no proof either way, so this does NOT
 * disambiguate — the plain `OR IGNORE` collapses it, same as before. That is
 * also right when the ids agree: it is the same film added again.
 */
export function addMovieToWatchlist(
  name: string,
  poster: string | null,
  year: string | null,
  tmdbId: number | null,
  tvdbId: number | null = null,
): void {
  const base = name.trim();
  const existing = db.getFirstSync<{ name: string; originalName: string | null; tmdbId: number | null; year: string | null }>(
    'SELECT name, originalName, tmdbId, year FROM movies WHERE LOWER(name) = LOWER(?) OR LOWER(originalName) = LOWER(?)',
    [base, base],
  );
  // Same question the search tick asks: is this the film already held, or a
  // different one that happens to share its title? Ask it in ONE place so the
  // tick and the add can never disagree.
  //
  // The earlier version only separated films when BOTH carried a TMDB id, which
  // missed the common case entirely — TheTVDB is the primary catalogue for
  // movies and supplies no TMDB id, so "Amado" (2011) and "Amado" (2022) both
  // arrived with none and collapsed onto one row. The second was then
  // unaddable: name is a TEXT PRIMARY KEY, so INSERT OR IGNORE silently did
  // nothing.
  let finalName = base;
  if (existing && !movieIdentityMatches({ tmdbId, name: base, year }, existing)) {
    const taken = new Set(db.getAllSync<{ n: string }>('SELECT name AS n FROM movies').map((r) => r.n.toLowerCase()));
    finalName = disambiguatedMovieName(base, year, taken);
  }
  db.runSync(
    // `name` is the PRIMARY KEY and may have been suffixed to stay unique;
    // `originalName` keeps the film's REAL title. That distinction is what
    // makes the row findable again — a search result carries the true title
    // ("Amado"), never the suffixed one, so writing the suffix into BOTH
    // columns left the second film unreachable and tapping it opened the first.
    'INSERT OR IGNORE INTO movies (name, originalName, poster, year, tmdbId, tvdbId, stars, watchedAt, runtime, addedAt, userAdded) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, 1)',
    [finalName, base, poster, year, tmdbId, tvdbId, new Date().toISOString()],
  );
}

export type CommentRow = {
  /** The table's own rowid. Unique per row, unlike a key built from the
   *  content — see `getComments`. */
  id: number;
  type: string;
  entity: string;
  text: string;
  date: string;
  likes: number;
  replies: number;
  image: string | null; // downloaded local filename
  imageUrl: string | null; // original CDN link, for export round-trips
  /** The `c_…` the server minted, for a comment this app posted. Null for
   *  imports, which the server addresses by a hash of their content. */
  serverId?: string | null;
  ratio: number | null; // width/height from the export, for layout
};

/** The user's own comments (imported libraries; the seed keeps them bundled). */
/**
 * The user's own comments, newest first, each with its rowid.
 *
 * THE ROWID IS THERE BECAUSE CONTENT IS NOT UNIQUE. The screen used to key its
 * list on `entity|date|first-40-characters`, and two comments on one episode
 * written the same day collide on that — instantly so for image-only rows,
 * whose text is empty. React then drew one row for both, and the profile's
 * count (a plain `COUNT(*)`) disagreed with the list underneath it: five
 * comments, four on screen.
 *
 * The content key still exists and is still right for what it does — tombstones
 * survive a re-import, where rowids do not.
 */
export function getComments(): CommentRow[] {
  return db.getAllSync<CommentRow>(
    'SELECT rowid AS id, type, entity, text, date, likes, replies, image, imageUrl, ratio, serverId FROM comments ORDER BY date DESC',
  );
}

/**
 * Keep a comment written in the community on THIS PHONE too.
 *
 * A comment posted in the app used to live only on the server, while the local
 * archive held nothing but the TV Time import. The profile papered over the gap
 * by showing `max(local, server)` — so the count said five and the screen below
 * it drew four, and every comment written widened the gap by one.
 *
 * It also matters beyond the count. The archive is what the exporter writes back
 * out and what a re-import merges against; a comment the phone never learned
 * about is one the user cannot export, search, or read offline — which for an
 * app whose whole promise is "your data stays on your device" is the wrong way
 * round.
 *
 * Idempotent on `entity|date|text`, because a retried post and a later archive
 * sync must not leave two rows for one comment.
 */
/**
 * Hide an archived comment, by the same content key the archive screen uses.
 *
 * DELETE HAS TO MEAN THE SAME THING IN BOTH PLACES. Deleting in a thread
 * removed the server's copy and left the archive's, so a comment somebody had
 * just deleted was still on their own profile -- while deleting from the
 * profile removed both. One word, two behaviours, and the difference visible
 * on the screen they land on afterwards.
 *
 * A TOMBSTONE rather than a DELETE, matching what the archive screen already
 * does: the row may be recreated by a re-import of the original ZIP, and a
 * deletion that a later import silently undoes is worse than one that holds.
 */
export function tombstoneArchivedComment(key: string): void {
  try {
    const raw = getMeta('deletedComments');
    const set = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    if (set.has(key)) return;
    set.add(key);
    setMeta('deletedComments', JSON.stringify([...set]));
  } catch {
    // A malformed list is not worth failing a delete over: the server copy is
    // already gone, which is the half that other people can see.
  }
}

export function addOwnComment(row: {
  entity: string;
  text: string;
  date: string;
  type?: 'comment' | 'reply';
  /**
   * THE PICTURE, AS A FILE ON THIS PHONE.
   *
   * A comment posted with a photograph appeared in the archive as text alone,
   * because this only ever recorded words -- so somebody's own copy of what
   * they wrote was missing the half they had chosen from their library.
   *
   * The FILE rather than a server URL, for the same reason every imported
   * photograph is a file: the server serves nothing until a person approves
   * it, and an archive that goes blank while somebody waits for approval is
   * not an archive. It is also the only copy that survives the picture being
   * refused.
   */
  image?: string | null;
  /** The `c_…` the server minted. See the column's note in the schema block. */
  serverId?: string | null;
  /**
   * WRITTEN HERE, BY THIS PERSON, ON A PHONE WITH NO ACCOUNT.
   *
   * Marked `origin = 'local'` so it can be told apart from an IMPORTED archive
   * row, which also has no server id. The two look identical otherwise and must
   * not be treated the same: a rescued TV Time photograph uploads free — that
   * is the whole point of the rescue — while a picture written here is a Plus
   * feature and has to wait until the tier is bought.
   *
   * Deliberately NOT 'app': that means "the server already has this", and
   * claiming it for a comment written offline makes the row unseedable for
   * ever.
   */
  local?: boolean;
  /**
   * WHERE THE SERVER'S COPY OF THE PICTURE IS, for a comment this phone has no
   * file for -- one written on another device, or one whose local copy was
   * lost. Only ever OUR OWN address: the column also holds dead TV Time
   * CloudFront links from the export, and the archive tells them apart by
   * origin rather than by hoping.
   */
  imageUrl?: string | null;
}): void {
  // Compared on the DAY, not the timestamp: the archive stores the export's
  // `2026-06-24 12:00:00` and the server returns `2026-06-24T12:00:00.000Z`, so
  // an exact match called one comment two and inserted a second copy of it.
  // `entity` compared case-insensitively, for the same class of reason the date
  // is compared by day: the two writers of a row disagree about it. The app
  // resolves "Toy Story 5" from the library; the sync, running before that film
  // is there, falls back to the bare key and stores "toy story 5". Same comment,
  // and an `=` called them two.
  /*
   * THE SERVER'S ID IS THE KEY WHEN THERE IS ONE.
   *
   * Matching on entity, text and day is what an imported comment allows, and
   * it is wrong twice over for one written in the app: two captionless
   * comments about the same film on the same day look identical, and the
   * content lookup can return EITHER of them -- so the same comment could be
   * inserted again on the next sync, or updated on top of its neighbour.
   */
  if (row.serverId) {
    const byId = db.getFirstSync<{ id: number; image: string | null }>(
      'SELECT id, image FROM comments WHERE serverId = ? LIMIT 1',
      [row.serverId],
    );
    if (byId != null) {
      if (row.image && !byId.image) db.runSync('UPDATE comments SET image = ? WHERE id = ?', [row.image, byId.id]);
      if (row.imageUrl) db.runSync('UPDATE comments SET imageUrl = ? WHERE id = ?', [row.imageUrl, byId.id]);
      return;
    }
  }

  const existing = db.getFirstSync<{ id: number; image: string | null; serverId: string | null }>(
    'SELECT id, image, serverId FROM comments WHERE LOWER(entity) = LOWER(?) AND text = ? AND substr(replace(date, \'T\', \' \'), 1, 10) = ? LIMIT 1',
    [row.entity, row.text, row.date.replace('T', ' ').slice(0, 10)],
  );
  /*
   * A DIFFERENT SERVER ID IS A DIFFERENT COMMENT, whatever the content says.
   *
   * The guard above matches on entity, text and DAY, which is the only handle
   * an imported comment gives you. It breaks down completely on captionless
   * ones: post a photograph and then a GIF about the same film on the same
   * day, both with no words, and the second is indistinguishable from the
   * first -- so the GIF was dropped and never appeared in the archive at all.
   *
   * When both rows carry a server id, that id is the identity and the content
   * is just description.
   */
  if (existing != null && row.serverId && existing.serverId && existing.serverId !== row.serverId) {
    db.runSync(
      'INSERT INTO comments (type, entity, text, date, likes, replies, image, imageUrl, ratio, origin, serverId) VALUES (?, ?, ?, ?, 0, 0, ?, NULL, NULL, \'app\', ?)',
      [row.type ?? 'comment', row.entity, row.text, row.date, row.image ?? null, row.serverId],
    );
    if (row.imageUrl) db.runSync('UPDATE comments SET imageUrl = ? WHERE serverId = ?', [row.imageUrl, row.serverId]);
    return;
  }
  if (existing != null) {
    /*
     * A MATCH IS NOT A REASON TO DISCARD WHAT IS NEW.
     *
     * The guard exists so one comment does not become two rows, and it was
     * right about that. But it returned before looking at what it was
     * refusing: post "10/10" about the same film twice in one day, the second
     * time WITH a photograph, and the picture was dropped on the floor. The
     * archive kept the older, wordier-but-blank row and the author saw their
     * own comment without the picture they had just watched upload.
     *
     * So a picture fills a row that has none. Never the other way round: an
     * existing photograph is the one the user already has on this phone, and
     * replacing it with a newer path would be trading a file that exists for
     * one that might not.
     */
    if (row.image && !existing.image) {
      db.runSync('UPDATE comments SET image = ? WHERE id = ?', [row.image, existing.id]);
    }
    // Same reasoning for the id: a row that did not know its server copy can
    // learn about it, and one that already does keeps what it has.
    if (row.serverId && !existing.serverId) {
      db.runSync('UPDATE comments SET serverId = ? WHERE id = ?', [row.serverId, existing.id]);
    }
    if (row.imageUrl && !existing.image) {
      db.runSync('UPDATE comments SET imageUrl = ? WHERE id = ?', [row.imageUrl, existing.id]);
    }
    return;
  }
  db.runSync(
    /*
     * `origin = 'app'` MARKS IT AS ALREADY PUBLISHED. Without the mark the
     * seeder treats the row as archive and uploads it again, and the two copies
     * cannot merge because their ids are derived differently: the app's is a
     * server-minted `c_…` and the seeder's is an `imp_…` hash of the content.
     * That is exactly how one "Yes agree" became two.
     *
     * ONLY WHEN THERE IS A SERVER ID, and this used to be hardcoded. The note
     * here read "every caller of this function has just posted to the server",
     * which was true when it was written and stopped being true the moment a
     * composer existed for somebody who has NOT joined: their comment is on no
     * server at all, and marking it published makes it unseedable for ever —
     * they join, and the thing they wrote never goes anywhere.
     *
     * That is the third bug in a family this codebase has already paid for
     * twice: a stamp that records the SHAPE of an action rather than whether it
     * actually happened. `serverId` is the fact; `origin` should follow it, not
     * the caller's intentions.
     */
    'INSERT INTO comments (type, entity, text, date, likes, replies, image, imageUrl, ratio, origin, serverId) VALUES (?, ?, ?, ?, 0, 0, ?, ?, NULL, ?, ?)',
    [
      row.type ?? 'comment',
      row.entity,
      row.text,
      row.date,
      row.image ?? null,
      row.imageUrl ?? null,
      row.serverId ? 'app' : row.local ? 'local' : null,
      row.serverId ?? null,
    ],
  );
}

/**
 * Remove the duplicate archive rows an early own-comment sync wrote.
 *
 * WHAT IT IS CLEANING UP. That sync pulled every server comment down, including
 * the ones the phone had itself uploaded, and wrote them as new rows. They are
 * identifiable: it never had a picture to store (the server serves none yet),
 * never a source URL, and never a like count — the server's likes are not the
 * export's. So a bare row sitting on the same DAY as a richer row with the same
 * text is that sync's copy of it.
 *
 * MATCHED ON TEXT AND DAY, NOT `entity`. The two copies disagree there too: the
 * import stores TV Time's raw `Attack on Titan S4E0`, the sync stored the
 * display name `Attack on Titan · Unknown episode`. Partitioning on `entity`
 * looked right and matched nothing.
 *
 * CONSERVATIVE BY CONSTRUCTION. A row is only deleted when a SIBLING exists that
 * is strictly richer — has a picture, a URL, or likes. Two genuinely different
 * bare comments written the same day survive, because neither is richer than the
 * other and there is nothing to prefer.
 */
export function dedupeOwnComments(): number {
  const res = db.runSync(
    `DELETE FROM comments
      WHERE image IS NULL AND imageUrl IS NULL AND COALESCE(likes, 0) = 0
        AND EXISTS (
          SELECT 1 FROM comments b
           WHERE b.rowid <> comments.rowid
             AND b.text = comments.text
             AND substr(replace(b.date, 'T', ' '), 1, 10)
                 = substr(replace(comments.date, 'T', ' '), 1, 10)
             AND (b.image IS NOT NULL OR b.imageUrl IS NOT NULL OR COALESCE(b.likes, 0) > 0)
        )`,
  );
  return res.changes ?? 0;
}

/** The tombstones written when the user deletes one of their own comments. */
export function deletedCommentKeys(): string[] {
  try {
    return JSON.parse(getMeta('deletedComments') ?? '[]') as string[];
  } catch {
    return [];
  }
}

/**
 * How many of the user's comments are actually THERE.
 *
 * Deleting a comment does not delete the row — it writes a tombstone, so a
 * re-import cannot resurrect it. This used to be a plain `COUNT(*)`, which kept
 * counting the deleted ones: the profile said five, the screen below it drew
 * four, and both were reading the same table. Filtered in SQL with the same key
 * the list filters on, so the two cannot drift again.
 */
/**
 * The comments the archive screen actually draws — ONE definition of "visible".
 *
 * The count above that screen and the list inside it were separate
 * implementations of the same idea, and they disagreed three times in a row:
 * first on deleted rows, then on replies, then on the duplicates an early sync
 * wrote. Each fix corrected one of them and left the other to be found by the
 * owner. They read from here now, so a rule can only be written once.
 *
 * Costs a table read where the count was a `COUNT(*)`. A real archive is
 * hundreds of rows, and the screen below performs the same read regardless.
 */
export function getVisibleOwnComments(): CommentRow[] {
  const gone = new Set(deletedCommentKeys());
  return getComments().filter(
    (c) =>
      c.type !== 'reply' &&
      !gone.has(`${c.entity}|${c.date}|${c.text.slice(0, 40)}`),
  );
}

export function getCommentCount(): number {
  return getVisibleOwnComments().length;
}

/** Kept for the seeder, which counts rows rather than what a screen shows. */
export function getRawCommentCount(): number {
  const gone = deletedCommentKeys();
  // Replies are excluded, and the LIST excludes them for the same reason: a
  // reply on its own is half a conversation — what it answers lives on the
  // server and can never appear in an archive with no parent column. Shown, it
  // read as a stray "Yes" under a film with no sign of the question.
  if (gone.length === 0) {
    return db.getFirstSync<{ n: number }>("SELECT COUNT(*) AS n FROM comments WHERE type != 'reply'")?.n ?? 0;
  }
  const holes = gone.map(() => '?').join(',');
  return (
    db.getFirstSync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM comments
        WHERE type != 'reply'
          AND entity || '|' || date || '|' || substr(text, 1, 40) NOT IN (${holes})`,
      gone,
    )?.n ?? 0
  );
}

/** One comment, with the row id the community seeder resumes from. */
export type SeedableComment = { id: number; type: string; entity: string; text: string; date: string };

/**
 * How many own comments could be brought to the community.
 *
 * Text-only: an image-only row has nothing the server would accept (comments
 * there are text, by design), so counting it would promise the user a number
 * the result screen then has to walk back.
 */
export function countSeedableCommentRows(): number {
  return (
    db.getFirstSync<{ n: number }>(
      // Words OR a picture. TV Time let a comment be a photograph with no
      // caption, and counting only the ones with text under-reported the offer
      // and — worse — excluded them from the upload entirely.
      //
      // `imageUrl` and NOT `image`: the former is the export's own proof that
      // this comment WAS a picture, the latter is whether the file reached
      // this device before TV Time's CDN went dark. Keying on the file would
      // make a comment stop existing because its photograph could not be
      // downloaded — losing the post as well as the picture.
      `SELECT COUNT(*) AS n FROM comments WHERE ${SEEDABLE_COMMENT_WHERE}`,
    )?.n ?? 0
  );
}

/**
 * What may be uploaded, in ONE place — the count and the walk must agree, and
 * they only stayed in step by both restating the same SQL.
 *
 * WORDS OR A PICTURE. TV Time let a comment be a photograph with no caption,
 * and counting only the ones with text under-reported the offer and — worse —
 * excluded them from the upload entirely. `imageUrl` and NOT `image`: the
 * former is the export's own proof that this comment WAS a picture, the latter
 * is whether the file reached this device before TV Time's CDN went dark.
 *
 * AND NEVER A REPLY. The export carries no link to the comment a reply answers,
 * so one used to be uploaded as a top-level comment — the parent was somebody
 * else's row that was never in this database. That is how a profile came to
 * show four comments to a visitor while its owner's own tab showed two: the two
 * extra were replies, standing on the server as if they were posts, reading as
 * non-sequiturs and dragging a fragment of a stranger's thread with them.
 *
 * `type != 'reply'` is exactly the test `getVisibleOwnComments()` makes, so the
 * archive, the profile tab and the server now answer with one set.
 */
const SEEDABLE_COMMENT_WHERE = `type != 'reply' AND origin IS NOT 'app' AND (TRIM(text) <> '' OR (imageUrl IS NOT NULL AND TRIM(imageUrl) <> ''))`;

/**
 * Own comments in `id` order, after `afterId` — the order a cancelled seeding
 * resumes in. `id` rather than `date`: it is unique and immutable, so "everything
 * up to here is done" is a single number, whereas two comments sharing a
 * timestamp would either be re-sent or skipped forever.
 *
 * `SEEDABLE_COMMENT_WHERE` is shared with the count, so the number in the offer
 * and the number the run walks are the same number. An image-only comment is
 * neither promised nor reported as a failure — there is nothing in it the
 * community surface accepts.
 */
export function getSeedableComments(afterId: number): SeedableComment[] {
  return db.getAllSync<SeedableComment>(
    `SELECT id, type, entity, text, date, image, imageUrl FROM comments WHERE id > ? AND ${SEEDABLE_COMMENT_WHERE} ORDER BY id`,
    [afterId],
  );
}

/**
 * Forget that these comments were ever published — because the profile they
 * were published TO is not this account any more.
 *
 * `origin = 'app'` is a claim about the server, not about the row: it says "the
 * server already holds this, so seeding it would create a second copy that can
 * never merge, an `imp_…` hash beside a server-minted `c_…`". That reasoning is
 * exactly right while the account stays the same, and exactly wrong the moment
 * it does not. Join as somebody else — or be deleted by moderation and sign up
 * again — and the new profile holds nothing, so the mark is protecting against
 * a duplicate that cannot occur while guaranteeing the comment is never seen
 * again. Everything the user wrote inside OpenTV silently stops existing.
 *
 * Clearing the mark makes those rows ordinary archive rows, which is what they
 * now are: the only copy is the one on this phone. They upload through
 * `/v1/comments/import` like the rest and come back with `imported_at` set,
 * which is a small loss of provenance and the correct trade against losing the
 * comment. Replies are still not seedable and cannot be — the archive has no
 * link to what they answered, so they would arrive as top-level non-sequiturs.
 *
 * Called ONLY from the owner-change branch of `syncArchiveIfNeeded`. Anywhere
 * else this would reintroduce the duplicate it was written to prevent.
 */
export function clearPublishedCommentOrigin(): number {
  db.runSync("UPDATE comments SET origin = NULL WHERE origin IS 'app'");
  return db.getFirstSync<{ n: number }>('SELECT changes() AS n')?.n ?? 0;
}

/**
 * The comments that still have their PICTURE on this device.
 *
 * `image` is a filename in Documents, downloaded at import time while TV
 * Time's CDN was still answering. That CDN is gone, so these files are the only
 * copies of those photographs anywhere — see `backend/src/routes/images.ts`.
 *
 * The same columns as `getSeedableComments` and the same order, because the
 * upload sends the same identity fields the import sent: the server re-derives
 * the comment's id from them, and a different projection here would be a
 * different id there.
 *
 * `type != 'reply'` for that same reason — a reply's comment is no longer
 * uploaded, so its picture would be attaching itself to a row that does not
 * exist on the server.
 */
export function getSeedableCommentImages(
  afterId: number,
  /**
   * Whether pictures WRITTEN IN THE APP are included.
   *
   * The route this feeds, `/v1/comments/image`, is the bulk rescue one and has
   * no Plus check — correctly, because saving photographs from a dead CDN is
   * not a paid feature. A picture somebody attached in the app is, so it must
   * be held back here rather than being let through by the route that was
   * built for something else.
   *
   * An imported archive row and a locally written one are otherwise
   * indistinguishable — neither has a server id — which is why `origin` has a
   * third value at all.
   */
  includeLocal: boolean,
): (SeedableComment & { image: string })[] {
  return db.getAllSync<SeedableComment & { image: string }>(
    `SELECT id, type, entity, text, date, image FROM comments
      WHERE id > ? AND type != 'reply' AND image IS NOT NULL AND TRIM(image) <> ''
        ${includeLocal ? '' : "AND origin IS NOT 'local'"}
      ORDER BY id`,
    [afterId],
  );
}

// ---- the rest of the archive, for community seeding -------------------------
//
// Ratings, feelings and favourite characters, read RAW: no merging, no mapping,
// no star arithmetic. All of that is pure and lives in `pure.ts` where a test
// can reach it; this file's only job is to hand over the rows in a stable order
// so a cancelled run can resume from a cursor.
//
// ORDER MATTERS AND IS PART OF THE CONTRACT. The seeder's cursor is a sort key
// built from these same columns, so `ORDER BY` here and the comparator there
// must agree or a resumed run walks past rows it never sent.

/** One row of `episode_ratings`, in cursor order. */
export type SeedableEpisodeRating = { showId: number; season: number; episode: number; stars: number };

export function getSeedableEpisodeRatings(): SeedableEpisodeRating[] {
  return db.getAllSync<SeedableEpisodeRating>(
    'SELECT showId, season, episode, stars FROM episode_ratings ORDER BY showId, season, episode',
  );
}

/** One row of `episode_emotions` — several per episode is normal. */
export type SeedableEpisodeEmotion = { showId: number; season: number; episode: number; emotion: number };

export function getSeedableEpisodeEmotions(): SeedableEpisodeEmotion[] {
  return db.getAllSync<SeedableEpisodeEmotion>(
    'SELECT showId, season, episode, emotion FROM episode_emotions ORDER BY showId, season, episode, emotion',
  );
}

/**
 * Every film the user has voted on — a star, a feeling, or both.
 *
 * `year` comes along because a film is addressed by `slug|year` and nothing
 * else: `movies.name` is the local primary key, and the tmdbId is nullable, so
 * the title and the year ARE the identity. `originalName` is not consulted here
 * — `targetKey` is computed from the same `name` the film screen passes to
 * `postRating`, so a film rated in 2019 and a film rated today land on one
 * thread instead of two.
 */
export type SeedableMovieVote = { name: string; year: string | null; stars: number | null };

export function getSeedableMovieVotes(): SeedableMovieVote[] {
  return db.getAllSync<SeedableMovieVote>(
    `SELECT name, year, stars FROM movies
      WHERE stars IS NOT NULL OR name IN (SELECT movie FROM emotions WHERE movie IS NOT NULL)
      ORDER BY name`,
  );
}

/**
 * Film feelings, as grid indexes.
 *
 * The `emotions` table stores the RAW export value (28–39) for a film, unlike
 * `episode_emotions` which stores the grid index (0–11) directly. `- 28` is the
 * same normalisation `getMovieEmotions` does; anything landing outside 0–11 is
 * not one of the twelve and is dropped here rather than mapped to nothing later.
 */
export type SeedableMovieEmotion = { movie: string; emotion: number };

export function getSeedableMovieEmotions(): SeedableMovieEmotion[] {
  const rows = db.getAllSync<{ movie: string | null; value: number }>(
    'SELECT movie, value FROM emotions WHERE movie IS NOT NULL ORDER BY movie, value',
  );
  return rows
    .filter((r): r is { movie: string; value: number } => typeof r.movie === 'string')
    .map((r) => ({ movie: r.movie, emotion: r.value - 28 }))
    .filter((r) => r.emotion >= 0 && r.emotion <= 11);
}

/**
 * Every "who was your favourite?" vote, in cursor order.
 *
 * `name` is NULL for anything TV Time exported — their export kept only an
 * internal character id whose lookup died with their servers — so a large share
 * of these are unmappable by construction. They are still read and still
 * counted, because the honest report is "these existed and could not be
 * attributed", not a silently shorter list.
 */
export type SeedableCharacterVote = {
  showId: number;
  season: number;
  episode: number;
  name: string | null;
  charId: number | null;
};

export function getSeedableCharacterVotes(): SeedableCharacterVote[] {
  return db.getAllSync<SeedableCharacterVote>(
    'SELECT showId, season, episode, name, charId FROM character_votes ORDER BY showId, season, episode',
  );
}

/**
 * Every favourite still missing a name — the input to the TheTVDB backfill.
 *
 * A deliberately COARSE filter: SQL narrows to the nameless rows (usually a
 * handful, and the whole table is small), and the exact decision — has an id,
 * not already tried, each id once — is `characterIdsNeedingNames` in pure.ts,
 * where it can be tested without a database.
 */
export function getUnnamedCharacterVotes(): { name: string | null; charId: number | null; nameTried: number }[] {
  return db.getAllSync<{ name: string | null; charId: number | null; nameTried: number }>(
    "SELECT name, charId, nameTried FROM character_votes WHERE name IS NULL OR TRIM(name) = ''",
  );
}

/** Write a recovered name onto EVERY vote for that character, and record that
 *  the id has been answered so it is never asked again. */
export function setCharacterVoteName(charId: number, name: string): void {
  db.runSync('UPDATE character_votes SET name = ?, nameTried = 1 WHERE charId = ?', [name, charId]);
}

/** TheTVDB answered "no such character" — remember it, so a dead id (TV Time
 *  kept ids TheTVDB has since removed) costs one request in a lifetime rather
 *  than one per launch. Only ever called for a DEFINITIVE answer. */
export function markCharacterNameTried(charId: number): void {
  db.runSync('UPDATE character_votes SET nameTried = 1 WHERE charId = ?', [charId]);
}

/** A film's favourite. Its own table, its own key — see `movie_character_votes`. */
export function getSeedableMovieCharacterVotes(): { movie: string; name: string | null }[] {
  return db.getAllSync<{ movie: string; name: string | null }>(
    "SELECT movie, name FROM movie_character_votes WHERE name IS NOT NULL AND TRIM(name) <> '' ORDER BY movie",
  );
}

/**
 * How much of each seedable thing the library holds, right now.
 *
 * SIX `COUNT(*)`s AND NOTHING ELSE. This runs on every app open, before any
 * decision about whether to talk to the server at all, so it has to cost about
 * as much as reading a `meta` key. No rows are materialised, no mapping is done,
 * nothing is hashed — see `archiveFingerprint` in `pure.ts` for why counts are
 * deliberately enough.
 *
 * The filters mirror the seeder's own: a comment with no text is not seedable,
 * a film's feelings live in `emotions` keyed by title, and a film with only a
 * feeling and no star still counts through `movieEmotions`.
 */
export function archiveCounts(): ArchiveCounts {
  const one = (sql: string) => db.getFirstSync<{ n: number }>(sql)?.n ?? 0;
  return {
    comments: one(`SELECT COUNT(*) AS n FROM comments WHERE ${SEEDABLE_COMMENT_WHERE}`),
    episodeRatings: one('SELECT COUNT(*) AS n FROM episode_ratings'),
    episodeEmotions: one('SELECT COUNT(*) AS n FROM episode_emotions'),
    movieRatings: one('SELECT COUNT(*) AS n FROM movies WHERE stars IS NOT NULL'),
    movieEmotions: one('SELECT COUNT(*) AS n FROM emotions WHERE movie IS NOT NULL'),
    // SENDABLE votes, not all votes — mirrors `sendableCharacterVoteCount` in
    // pure.ts, which explains why. In short: the seeder drops a nameless vote,
    // so counting one would describe a row the server can never receive, and
    // recovering its name — which changes no COUNT — would never move this
    // fingerprint and so would never reach anybody.
    characterVotes: one("SELECT COUNT(*) AS n FROM character_votes WHERE name IS NOT NULL AND TRIM(name) <> ''"),
    // Films keep their favourites in their own table — `character_votes` is
    // keyed by three NOT NULL integers a film has none of. Left out of this
    // count, a favourite picked on a film would never move the fingerprint, so
    // a live post that failed while offline would have nothing to retry it.
    movieCharacterVotes: one('SELECT COUNT(*) AS n FROM movie_character_votes'),
  };
}

/** Every tracked show as (id, name) — the index a comment's entity is matched against. */
export function getShowNames(): { tvdbId: number; name: string }[] {
  return db.getAllSync<{ tvdbId: number; name: string }>('SELECT tvdbId, name FROM shows');
}

/**
 * Has this phone's owner watched the thing a comment is about?
 *
 * THE ONLY MACHINE THAT CAN ANSWER THIS IS THIS ONE. The server holds no watch
 * history by design, so "hide what would spoil me" cannot be a server-side
 * filter without first sending it everything it deliberately refuses to store.
 * Locally it is one indexed read, and the answer never leaves the device.
 *
 * SPECIFICITY MATTERS AND NARROWS DOWNWARD. A comment on S4E12 is safe only if
 * that episode has been seen; a comment on a season is judged by that season; a
 * comment on the show as a whole by whether the show has been started at all.
 * Judging an episode comment by "have you seen any of this show" would call a
 * finale discussion safe for somebody two episodes in.
 *
 * UNKNOWN COUNTS AS UNSEEN. A film that is not in the library, or a show that
 * is not tracked, has not been watched as far as this phone can tell — and the
 * cost of being wrong runs one way only: a needless curtain is a tap, a missing
 * one is the ending of something.
 */
export function hasWatchedTarget(
  source: string,
  key: string,
  season: number | null,
  episode: number | null,
): boolean {
  try {
    if (source === 'tvdb') {
      const tvdbId = Number(key);
      if (!Number.isFinite(tvdbId)) return false;
      if (season != null && episode != null) {
        return (
          (db.getFirstSync<{ n: number }>(
            'SELECT COUNT(*) AS n FROM watches WHERE tvdbId = ? AND season = ? AND episode = ?',
            [tvdbId, season, episode],
          )?.n ?? 0) > 0
        );
      }
      if (season != null) {
        return (
          (db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM watches WHERE tvdbId = ? AND season = ?', [
            tvdbId,
            season,
          ])?.n ?? 0) > 0
        );
      }
      return (
        (db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM watches WHERE tvdbId = ?', [tvdbId])?.n ?? 0) > 0
      );
    }
    // A film: `title:toy-story-5|2026`. The year is part of the identity but
    // not of the local key, so it is dropped before matching — the same split
    // `targetLabel` makes.
    const bare = key.split('|')[0] ?? '';
    if (bare.length === 0) return false;
    return getMovies().some((m) => slug(m.name) === bare && m.watchedAt != null);
  } catch {
    // An unreadable library is not a licence to show spoilers.
    return false;
  }
}

/** Favorite shows from the library itself (imported flag), in TV Time order. */
export function getFavoriteShows(): { tvdbId: number; name: string; posterUrl: string | null }[] {
  return db.getAllSync(
    'SELECT tvdbId, name, posterUrl FROM shows WHERE favorited = 1 ORDER BY (favoriteRank IS NULL), favoriteRank, name',
  );
}

/** Minimal show info (name + the in-app poster) for the share card. */
/**
 * Every show id in the library, live.
 *
 * FOR THE "PEOPLE ALSO WATCHED" TICKS, and it exists because the show screen
 * was asking `seed.shows` instead -- the BUNDLED seed, which public builds ship
 * EMPTY. So the tick was reading a file that is always empty for every real
 * user: it never lit up for a show they genuinely track, and it never went out
 * when they removed one. It only ever showed what had been added in that one
 * session, in memory, which is why it survived a removal and could not be
 * turned off.
 */
export function trackedShowIds(): Set<number> {
  return new Set(
    db.getAllSync<{ tvdbId: number }>('SELECT tvdbId FROM shows').map((r) => r.tvdbId),
  );
}

/** How much history a show carries. Read before offering to delete it: the
 *  difference between undoing an add made ten seconds ago and destroying six
 *  years of watches is this number, and nothing else. */
export function showWatchCount(tvdbId: number): number {
  return (
    db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM watches WHERE showId = ?', [tvdbId])?.n ?? 0
  );
}

export function getShowBrief(tvdbId: number): { name: string; poster: string | null } | null {
  const r = db.getFirstSync<{ name: string; posterUrl: string | null }>(
    'SELECT name, posterUrl FROM shows WHERE tvdbId = ?',
    [tvdbId],
  );
  return r ? { name: r.name, poster: r.posterUrl } : null;
}

/** Favorite movies from the library itself, in TV Time order. */
export function getFavoriteMovies(): { name: string; poster: string | null }[] {
  return db.getAllSync(
    'SELECT name, poster FROM movies WHERE favorited = 1 ORDER BY (favoriteRank IS NULL), favoriteRank, name',
  );
}

/**
 * Write the drag order of the favourites shelf.
 *
 * `favoriteRank` already existed and was only ever written by the importer,
 * carrying TV Time's order across — so the column was the user's order with no
 * way for the user to change it. This is that missing half.
 *
 * The rank is dense (0..n-1) and rewritten wholesale rather than patched,
 * because a partial write leaves gaps and a gap sorts unpredictably against
 * the `(favoriteRank IS NULL)` clause both readers use.
 *
 * Silently ignores a set that is not exactly the current favourites: a drag
 * that has lost or gained an entry means the screen was reading stale state,
 * and writing it would delete somebody's ordering to match a mistake.
 */
export function setFavoriteOrder(kind: 'show' | 'movie', orderedKeys: (string | number)[]): void {
  const table = kind === 'show' ? 'shows' : 'movies';
  const col = kind === 'show' ? 'tvdbId' : 'name';
  const current = db.getAllSync<{ k: string | number }>(
    `SELECT ${col} AS k FROM ${table} WHERE favorited = 1`,
  );
  if (current.length !== orderedKeys.length) return;
  const have = new Set(current.map((r) => String(r.k)));
  if (!orderedKeys.every((k) => have.has(String(k)))) return;

  db.withTransactionSync(() => {
    orderedKeys.forEach((k, i) => {
      db.runSync(`UPDATE ${table} SET favoriteRank = ? WHERE ${col} = ?`, [i, k]);
    });
  });
}

/** Who filled this library: the bundled seed, a real import, or a fresh start. */
export function libraryOwner(): 'seed' | 'imported' | 'fresh' {
  const v = getMeta('libraryOwner');
  return v === 'imported' || v === 'fresh' ? v : 'seed';
}

export function hasLibrary(): boolean {
  const n = db.getFirstSync<{ n: number }>('SELECT (SELECT COUNT(*) FROM shows) + (SELECT COUNT(*) FROM movies) AS n');
  return (n?.n ?? 0) > 0;
}

/** Erase everything — the fresh-start path. No undo. */
export function wipeAllData(): void {
  db.withTransactionSync(() => {
    for (const t of ['shows', 'watches', 'movies', 'episode_ratings', 'episode_emotions', 'episode_watched_on', 'character_votes', 'ratings', 'emotions', 'comments', 'meta']) {
      db.runSync(`DELETE FROM ${t}`);
    }
    // The pre-TheTVDB snapshot is a full copy of the old library — watches,
    // ratings, emotions, character votes — kept so the numbering migration can
    // be undone. It lived in its own table, so "erase everything" walked past
    // it and left the user's entire history on disk after they asked for it to
    // be gone. Dropped, matching what discarding the snapshot does.
    db.execSync('DROP TABLE IF EXISTS pre_tvdb_rows');
    db.runSync("INSERT OR REPLACE INTO meta (key, value) VALUES ('libraryOwner', 'fresh')");
  });
}

/** Everything the user owns, as one JSON-able object — the backup file. */
export function exportAll(): Record<string, unknown> {
  const table = (name: string) => db.getAllSync(`SELECT * FROM ${name}`);
  return {
    app: 'OpenTV',
    format: 1,
    exportedAt: new Date().toISOString(),
    shows: table('shows'),
    watches: table('watches'),
    movies: table('movies'),
    episodeRatings: table('episode_ratings'),
    episodeEmotions: table('episode_emotions'),
    ratings: table('ratings'),
    emotions: table('emotions'),
    meta: table('meta'),
  };
}

/** Small key/value store — onboarding flag, profile name, import versions. */
export function getMeta(key: string): string | null {
  return db.getFirstSync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db.runSync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
}

export type MovieRow = {
  name: string;
  originalName: string | null;
  poster: string | null;
  year: string | null;
  tmdbId: number | null;
  stars: number | null;
  watchedAt: string | null;
  runtime: number | null;
  addedAt: string | null;
  /** where the user watched it — 'Theater' | 'Other' | 'Unofficial' */
  watchedOn: string | null;
  rewatchCount: number | null;
  favorited: number;
  /** ISO date of first release, when known — drives the Upcoming tab */
  releaseDate: string | null;
  tvdbId: number | null;
  /** 1 = added in-app rather than imported; protects it from the deduper */
  userAdded: number;
};

/** The same rule as `setShowFavorited`: added goes first, removed forgets. */
export function setMovieFavorite(name: string, favorited: boolean): void {
  if (favorited) {
    normaliseFavoriteRanks('movies', 'name');
    db.withTransactionSync(() => {
      db.runSync('UPDATE movies SET favoriteRank = favoriteRank + 1 WHERE favorited = 1');
      db.runSync('UPDATE movies SET favorited = 1, favoriteRank = 0 WHERE name = ? OR originalName = ?', [name, name]);
    });
  } else {
    db.runSync('UPDATE movies SET favorited = 0, favoriteRank = NULL WHERE name = ? OR originalName = ?', [name, name]);
  }
}

/** All movies, most recently watched first, unwatched last. */
export function getMovies(): MovieRow[] {
  return db.getAllSync<MovieRow>(
    'SELECT * FROM movies ORDER BY watchedAt IS NULL, watchedAt DESC',
  );
}

export function getMovie(name: string): MovieRow | null {
  return (
    db.getFirstSync<MovieRow>('SELECT * FROM movies WHERE name = ? OR originalName = ?', [name, name]) ?? null
  );
}

/**
 * Resolve which library row a `/movie/[name]` route actually means, using
 * `resolveMovieRow` (see `pure.ts`) so the rule is identical wherever it's
 * applied. `name` alone is ambiguous the moment two different films share a
 * title — "Amado" (2011) and "Amado" (2022) can both exist as separate rows
 * since disambiguation landed, but a route only carries a title. `tmdbId` is
 * real identity, so when the caller has one (a tapped search/catalog result,
 * never a bare imported title) it decides, before name is even considered.
 *
 * Without a tmdbId this is exactly `getMovie(name)` — unchanged. The
 * overwhelming majority of rows come from a GDPR import and carry no tmdbId
 * at all, so name resolution must keep behaving exactly as it does today for
 * them; this only takes over once a tmdbId is actually supplied.
 */
export function getMovieForRoute(
  tmdbId: number | null,
  name: string,
  year?: string | null,
  tvdbId?: number | null,
): MovieRow | null {
  // No early exit on a missing tmdbId. That short-circuit was the bug: TheTVDB
  // supplies no TMDB id for movies, so the ordinary case fell through to a
  // name-only lookup and threw away the two things that actually tell two
  // same-titled films apart — the TheTVDB id and the release year.
  return resolveMovieRow({ tmdbId, tvdbId, name, year }, getMovies());
}

export function setMovieWatched(name: string, watched: boolean): void {
  db.runSync('UPDATE movies SET watchedAt = ?, rewatchCount = CASE WHEN ? THEN rewatchCount ELSE NULL END WHERE name = ? OR originalName = ?', [
    watched ? new Date().toISOString() : null,
    watched ? 1 : 0,
    name,
    name,
  ]);
}

/** Movies the user deleted on purpose. The importer skips these by name, or the
 *  silent self-repair (which does INSERT OR REPLACE) would resurrect them. */
export function deletedMovieNames(): Set<string> {
  try {
    const raw = getMeta('deletedMovies');
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Remove a movie entirely — from the watchlist or the watched list — with its
 *  ratings/emotions, and tombstone it so repairs never bring it back. */
export function deleteMovie(name: string): void {
  db.withTransactionSync(() => {
    const row = db.getFirstSync<{ name: string; originalName: string | null }>(
      'SELECT name, originalName FROM movies WHERE name = ? OR originalName = ?',
      [name, name],
    );
    db.runSync('DELETE FROM ratings WHERE movie = ?', [name]);
    db.runSync('DELETE FROM emotions WHERE movie = ?', [name]);
    db.runSync('DELETE FROM movies WHERE name = ? OR originalName = ?', [name, name]);
    const dead = deletedMovieNames();
    if (row?.name) dead.add(row.name);
    if (row?.originalName) dead.add(row.originalName);
    dead.add(name);
    setMeta('deletedMovies', JSON.stringify([...dead]));
  });
}

export function setMovieStars(name: string, stars: number): void {
  db.runSync('UPDATE movies SET stars = ? WHERE name = ? OR originalName = ?', [stars, name, name]);
}

/** "+1 Rewatched" for a movie. */
export function addMovieRewatch(name: string): void {
  db.runSync('UPDATE movies SET rewatchCount = COALESCE(rewatchCount, 0) + 1 WHERE name = ? OR originalName = ?', [
    name,
    name,
  ]);
}

/** "Where did you watch?" — persisted per movie, like the real app. */
export function setMovieWatchedOn(name: string, watchedOn: string | null): void {
  db.runSync('UPDATE movies SET watchedOn = ? WHERE name = ? OR originalName = ?', [watchedOn, name, name]);
}

/** "Where did you watch?" per episode — persisted, imported from TV Time. */
export function getEpisodeWatchedOn(showId: number, season: number, episode: number): string | null {
  return (
    db.getFirstSync<{ source: string }>(
      'SELECT source FROM episode_watched_on WHERE showId = ? AND season = ? AND episode = ?',
      [showId, season, episode],
    )?.source ?? null
  );
}

/**
 * "What interests you most about this show?" — the answer, kept.
 *
 * IT WAS NEVER SAVED. The poll wrote React state and nothing else, so every
 * answer lasted exactly as long as the screen did: pick one, close, come back,
 * gone. Reported from the outside before it was noticed from the inside, which
 * is what an unsaved control looks like — nothing is broken on screen, the tap
 * simply means nothing.
 *
 * IN `meta`, NOT A TABLE OF ITS OWN. One nullable answer per title is a
 * preference, not a record, and `meta` is what the rest of the app uses for
 * exactly that. Films are keyed by name because that is how this app keys them
 * — see the movie routes — and shows by TheTVDB id.
 *
 * ON-DEVICE ONLY, deliberately. This is a note about somebody's own taste and
 * the server has no column for it, in the same spirit as the watch history.
 */
export function getInterest(kind: 'show' | 'movie', id: string | number): number | null {
  return parseInterest(getMeta(interestKey(kind, id)));
}

/** `null` clears it — tapping the chosen answer again is how you unpick it. */
export function setInterest(kind: 'show' | 'movie', id: string | number, index: number | null): void {
  setMeta(interestKey(kind, id), index == null ? '' : String(index));
}

export function setEpisodeWatchedOn(showId: number, season: number, episode: number, source: string | null): void {
  if (source == null) {
    db.runSync('DELETE FROM episode_watched_on WHERE showId = ? AND season = ? AND episode = ?', [showId, season, episode]);
  } else {
    db.runSync('INSERT OR REPLACE INTO episode_watched_on (showId, season, episode, source) VALUES (?, ?, ?, ?)', [
      showId,
      season,
      episode,
      source,
    ]);
  }
}

/** "Who was your favorite?" — one character vote per episode, like TV Time.
 * name is NULL for TV Time-imported votes: the export kept only an internal
 * character id whose lookup died with their servers; the count still counts. */
export function getCharacterVote(showId: number, season: number, episode: number): { name: string | null } | null {
  return (
    db.getFirstSync<{ name: string | null }>(
      'SELECT name FROM character_votes WHERE showId = ? AND season = ? AND episode = ?',
      [showId, season, episode],
    ) ?? null
  );
}

/** Tap toggles: same character un-votes, another character re-votes. The rule
 *  itself is `nextCharacterVote` in pure.ts, so it can be tested without a
 *  database; this only applies it. Returns what the row now holds, so a caller
 *  never has to guess whether a tap selected or cleared. */
export function setCharacterVote(showId: number, season: number, episode: number, name: string): string | null {
  const next = nextCharacterVote(getCharacterVote(showId, season, episode)?.name ?? null, name);
  if (next === null) {
    db.runSync('DELETE FROM character_votes WHERE showId = ? AND season = ? AND episode = ?', [showId, season, episode]);
  } else {
    db.runSync('INSERT OR REPLACE INTO character_votes (showId, season, episode, name, charId) VALUES (?, ?, ?, ?, NULL)', [
      showId,
      season,
      episode,
      next,
    ]);
  }
  return next;
}

/** The same question, asked of a film. Keyed by the film's name, as every
 *  other per-film row in this schema is. */
export function getMovieCharacterVote(movie: string): { name: string | null } | null {
  return (
    db.getFirstSync<{ name: string | null }>('SELECT name FROM movie_character_votes WHERE movie = ?', [movie]) ?? null
  );
}

/** Tap toggles, exactly as the episode version does. */
export function setMovieCharacterVote(movie: string, name: string): string | null {
  const next = nextCharacterVote(getMovieCharacterVote(movie)?.name ?? null, name);
  if (next === null) {
    db.runSync('DELETE FROM movie_character_votes WHERE movie = ?', [movie]);
  } else {
    db.runSync('INSERT OR REPLACE INTO movie_character_votes (movie, name, charId) VALUES (?, ?, NULL)', [movie, next]);
  }
  return next;
}

/** Character-vote totals for the stats screen, live from the db. */
export function getCharacterVoteStats(): { total: number; shows: number; top: { show: string; name: string | null; count: number }[] } {
  const row = db.getFirstSync<{ total: number; shows: number }>(
    'SELECT COUNT(*) AS total, COUNT(DISTINCT showId) AS shows FROM character_votes',
  );
  const top = db.getAllSync<{ show: string; name: string | null; count: number }>(
    `SELECT s.name AS show, cv.name AS name, COUNT(*) AS count
     FROM character_votes cv JOIN shows s ON s.tvdbId = cv.showId
     GROUP BY cv.showId, cv.name ORDER BY count DESC, s.name LIMIT 10`,
  );
  return { total: row?.total ?? 0, shows: row?.shows ?? 0, top };
}

/** Manually link a movie to a database entry — the Fix match flow. Works for
 * unmatched imports and for correcting a wrong automatic match. */
export function setMovieMatch(name: string, tmdbId: number, poster: string | null, year: string | null): void {
  // COALESCE, not a plain assignment: a TMDB entry with no artwork would
  // otherwise erase the poster the movie already had — usually a good one
  // TheTVDB supplied — leaving a blank tile as the reward for matching.
  db.runSync(
    'UPDATE movies SET tmdbId = ?, poster = COALESCE(?, poster), year = COALESCE(?, year) WHERE name = ? OR originalName = ?',
    [tmdbId, poster, year, name, name],
  );
  db.runSync('DELETE FROM meta WHERE key = ?', [`tvdbMovieMiss:${name}`]);
}

/** A hand-picked TheTVDB match from Fix-match: force the poster (+ year), no
 *  tmdbId. Unlike setMoviePoster this overrides an existing (wrong) poster. */
export function setMovieMatchTvdb(name: string, poster: string | null, year: string | null): void {
  // tmdbId = 0 marks "matched via TheTVDB" (same sentinel shows use) — TheTVDB
  // has no TMDB id, but without SOMETHING non-null here the movie still counts
  // as unmatched everywhere (the import "fixed" check keys on tmdbId != null).
  // 0 is falsy, so the movie page's `if (!tmdbId)` fetch guards skip cleanly.
  db.runSync(
    'UPDATE movies SET tmdbId = 0, poster = COALESCE(?, poster), year = COALESCE(?, year) WHERE name = ? OR originalName = ?',
    [poster, year, name, name],
  );
  db.runSync('DELETE FROM meta WHERE key = ?', [`tvdbMovieMiss:${name}`]);
}

/** Watched/watchlist movies with no poster yet — the TheTVDB fallback fills these. */
/** Planned (unwatched) movies with no release date yet. Only the watchlist
 *  needs one — a watched film is out by definition — so this stays small
 *  even on a library of thousands. */
export function getPlannedMoviesMissingRelease(): { name: string; year: string | null; tvdbId: number | null }[] {
  return db.getAllSync<{ name: string; year: string | null; tvdbId: number | null }>(
    'SELECT name, year, tvdbId FROM movies WHERE watchedAt IS NULL AND releaseDate IS NULL',
  );
}

/** Record what a movie lookup found. releaseDate '' means "looked, none
 *  published" so the pass doesn't re-query it every launch. */
export function setMovieRelease(name: string, releaseDate: string, tvdbId: number | null): void {
  db.runSync('UPDATE movies SET releaseDate = ?, tvdbId = COALESCE(tvdbId, ?) WHERE name = ? OR originalName = ?', [
    releaseDate,
    tvdbId,
    name,
    name,
  ]);
}

/** Movies whose match was inferred from the watch date rather than known
 *  outright — the Review screen lists these so a wrong poster is a quick fix
 *  instead of a mystery. */
export function getGuessedMovies(): { name: string; year: string | null; poster: string | null }[] {
  try {
    return db.getAllSync<{ name: string; year: string | null; poster: string | null }>(
      'SELECT name, year, poster FROM movies WHERE matchGuessed = 1 ORDER BY name',
    );
  } catch {
    return [];
  }
}

/** Record that a movie's match was inferred rather than certain. */
export function markMovieGuessed(name: string): void {
  try {
    db.runSync('UPDATE movies SET matchGuessed = 1 WHERE name = ? OR originalName = ?', [name, name]);
  } catch {}
}

/** The user confirmed (or corrected) a guessed match — stop flagging it. */
export function clearMovieGuess(name: string): void {
  try {
    db.runSync('UPDATE movies SET matchGuessed = 0 WHERE name = ? OR originalName = ?', [name, name]);
  } catch {}
}

/** Films with no TheTVDB id yet — candidates for the id backfill. `tvdbTried`
 *  and `watchedAt` come along so the decision itself stays pure and testable
 *  (see `moviesNeedingTvdbMatch`). */
export function getMoviesMissingTvdbId(): {
  name: string;
  year: string | null;
  tvdbId: number | null;
  tmdbId: number | null;
  tvdbTried: number;
  watchedAt: string | null;
}[] {
  try {
    return db.getAllSync<{
      name: string;
      year: string | null;
      tvdbId: number | null;
      tmdbId: number | null;
      tvdbTried: number;
      watchedAt: string | null;
      // tmdbId comes along so the match can go by id rather than by name —
      // TheTVDB indexes TMDB ids, and an id never ties the way "Up" does.
    }>('SELECT name, year, tvdbId, tmdbId, tvdbTried, watchedAt FROM movies WHERE tvdbId IS NULL');
  } catch {
    return [];
  }
}

/** Record the film's TheTVDB id. Also stamps `tvdbTried`: the question has been
 *  answered, so no later launch need ask it again. COALESCE so a real id from a
 *  search tap or a community export is never overwritten by a search result. */
export function setMovieTvdbId(name: string, tvdbId: number): void {
  try {
    db.runSync('UPDATE movies SET tvdbId = COALESCE(tvdbId, ?), tvdbTried = 1 WHERE name = ? OR originalName = ?', [
      tvdbId,
      name,
      name,
    ]);
  } catch {}
}

/** TheTVDB answered and there is no id to store — stop asking on every launch. */
export function markMovieTvdbTried(name: string): void {
  try {
    db.runSync('UPDATE movies SET tvdbTried = 1 WHERE name = ? OR originalName = ?', [name, name]);
  } catch {}
}

/**
 * Re-open every unanswered film to a better matcher.
 *
 * `tvdbTried` means "TheTVDB was asked and the answer will not change on
 * re-asking" — true of the matcher that asked, and false the moment the
 * matcher improves. Films that failed on an ambiguous NAME ("Up" and "Up!"
 * normalise alike) can be resolved outright by TMDB id, and without this they
 * would carry a permanent no from a question that is no longer the one being
 * asked. Guarded by a revision in `movie-tvdb-match.ts` so it runs once.
 *
 * Only rows with no id: a film already matched is answered for good.
 */
export function clearMovieTvdbTried(): void {
  try {
    db.runSync('UPDATE movies SET tvdbTried = 0 WHERE tvdbId IS NULL');
  } catch {}
}

export function getMoviesMissingPoster(): { name: string; year: string | null; tvdbId: number | null }[] {
  return db.getAllSync<{ name: string; year: string | null; tvdbId: number | null }>(
    'SELECT name, year, tvdbId FROM movies WHERE poster IS NULL',
  );
}

/** Tracked shows with no poster (TMDB matched them but had no artwork, or they
 *  were never matched) — the TheTVDB pass fills these by tvdbId. */
/**
 * Every tracked show with no name — the input to the TheTVDB backfill.
 *
 * A show row can be created before anyone knows what it is called. The
 * importer writes whatever the export said, and an export can say nothing:
 * a favourite arrives as an id and a poster, and TV Time's own data was not
 * always complete. The row is then real, tracked, sometimes FAVOURITED, and
 * unnameable -- it sorted above "13 Reasons Why" in the add-to-list picker as
 * a blank line with a poster, which is how it was noticed.
 *
 * `nameTried` keeps a dead id from being asked about on every launch. TV Time
 * kept ids TheTVDB has since deleted -- 343931 is one, a 404 for ever -- and
 * the character-vote backfill learned the same lesson.
 */
export function getShowsMissingName(): { tvdbId: number }[] {
  return db.getAllSync<{ tvdbId: number }>(
    "SELECT tvdbId FROM shows WHERE (name IS NULL OR TRIM(name) = '') AND COALESCE(nameTried, 0) = 0",
  );
}

/** TheTVDB has no such series. Remember it, so a dead id costs one request in
 *  a lifetime rather than one per launch. Only for a DEFINITIVE 404. */
export function markShowNameTried(tvdbId: number): void {
  db.runSync('UPDATE shows SET nameTried = 1 WHERE tvdbId = ?', [tvdbId]);
}

export function getShowsMissingPoster(): { tvdbId: number }[] {
  return db.getAllSync<{ tvdbId: number }>("SELECT tvdbId FROM shows WHERE posterUrl IS NULL OR posterUrl = ''");
}

/** Every tracked show's tvdbId, most-likely-to-be-opened first (followed +
 *  not archived), so the offline pre-cache fills the important shows first. */
export function getAllShowIds(): number[] {
  return db
    .getAllSync<{ tvdbId: number }>('SELECT tvdbId FROM shows ORDER BY followed DESC, archived ASC')
    .map((r) => r.tvdbId);
}

/** Fill in a movie's poster (+ optional runtime, in seconds) without a tmdbId —
 *  used by the TheTVDB fallback for movies TMDB couldn't match. Only fills empty
 *  fields so a real TMDB match is never overwritten. */
export function setMoviePoster(name: string, poster: string | null, runtimeSeconds?: number | null): void {
  db.runSync(
    `UPDATE movies SET poster = COALESCE(poster, ?), runtime = COALESCE(runtime, ?)
     WHERE (name = ? OR originalName = ?) AND poster IS NULL`,
    [poster, runtimeSeconds ?? null, name, name],
  );
}

/**
 * A film's user-chosen poster and backdrop.
 *
 * KEYED BY NAME, not by an id, because that is what identifies a film here —
 * `movies` has no numeric primary key and a row may have no tmdbId or tvdbId at
 * all (a title typed in by hand, or one no catalogue matched). The show
 * equivalents key by tvdbId for the same reason in reverse.
 *
 * STORED IN `meta`, like the show overrides, so a metadata refresh cannot undo
 * a deliberate choice — the fetcher writes `movies.poster`, and this sits above
 * it. `movies` gains no column: an override belongs with the other overrides,
 * and it is read on the one screen that cares.
 */
export function movieArtKey(kind: 'poster' | 'backdrop', name: string): string {
  return `movie${kind === 'poster' ? 'Poster' : 'Backdrop'}Override:${name.trim().toLowerCase()}`;
}

export function setMoviePosterOverride(name: string, url: string | null): void {
  if (!url) return;
  setMeta(movieArtKey('poster', name), url);
  // Also written to the row, so every list, shelf and collage picks it up
  // without each of them having to know overrides exist.
  db.runSync('UPDATE movies SET poster = ? WHERE name = ? OR originalName = ?', [url, name, name]);
}

export function setMovieBackdropOverride(name: string, url: string | null): void {
  if (!url) return;
  setMeta(movieArtKey('backdrop', name), url);
}

/** The chosen backdrop for a film, or null. Synchronous, for render. */
export function movieBackdropOverride(name: string): string | null {
  return getMeta(movieArtKey('backdrop', name)) || null;
}

/** Poster update after a manual show match. */
export function setShowPoster(tvdbId: number, posterUrl: string | null): void {
  if (!posterUrl) return;
  db.runSync('UPDATE shows SET posterUrl = ? WHERE tvdbId = ?', [posterUrl, tvdbId]);
  // persist as an override so the bundled-poster reset on next launch keeps it
  db.runSync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [`posterOverride:${tvdbId}`, posterUrl]);
}

/** User-chosen backdrop for a show (Customize). Stored in meta so it survives
 * metadata refreshes; the show page prefers it over the metadata backdrop. */
export function setShowBackdrop(tvdbId: number, url: string | null): void {
  if (!url) return;
  db.runSync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [`backdropOverride:${tvdbId}`, url]);
}

export type CustomListItem = {
  kind: 'show' | 'movie';
  name: string;
  poster: string | null;
  tvdbId?: number;
  /** Films restored by `list-repair` carry whichever id the catalogue had.
   *  Without it every screen that opens the film has to search for it by
   *  name, draw a guess, and correct itself. */
  tmdbId?: number;
};
export type CustomList = {
  name: string;
  items: CustomListItem[];
  movieCount: number;
  /** full size of the list in TV Time, including entries whose names weren't in the export */
  totalCount?: number;
  /** raw TV Time uuids of unrecovered entries — kept so a future canonical map can resolve them */
  unresolved?: string[];
  /** true once the user created or edited this list — protects it from being
   *  overwritten by a re-import (see mergeImportedCustomLists) */
  userCreated?: boolean;
  /** The list's place in the profile's own order, re-stamped 0..n-1 on every
   *  write. Survives a re-import, which rebuilds the array — see
   *  `mergeCustomLists`. */
  order?: number;
  /**
   * "Hide from profile" — never published, never sent anywhere.
   *
   * The switch has existed on the create screen since lists shipped and did
   * nothing: it set React state and `submit()` dropped it. Harmless while
   * nothing published lists at all; a broken promise the moment something did.
   */
  hidden?: boolean;
  /**
   * A backdrop chosen from the list's own titles, drawn instead of the collage.
   * Plus — see `setListCover`. A full URL from TheTVDB or TMDB, exactly like
   * the profile cover, so nothing here needs downloading or hosting.
   */
  coverUrl?: string | null;
  /** Sorts above everything, under every sort. Plus — see `setListPinned`. */
  pinned?: boolean;
};

/** The custom lists imported from the TV Time export (shows + movies). */
export function getCustomLists(): CustomList[] {
  try {
    return JSON.parse(getMeta('customLists') ?? '[]') as CustomList[];
  } catch {
    return [];
  }
}

/**
 * Exported for `fillMissingListNames`, which repairs list entries whose show
 * name the export could not supply — it needs a WHOLE-ARRAY write, because
 * saving per item would rewrite this JSON once per show and race a user
 * editing a list while it ran.
 */
export function saveCustomLists(lists: CustomList[]): void {
  // Renumbered here rather than at each call site, so no path can write an
  // arrangement without one — a list with no `order` sorts to the end after the
  // next re-import, which would look like a row that quietly moved itself.
  setMeta('customLists', JSON.stringify(renumberLists(lists)));
}

// Tombstones: names of imported lists the user renamed or deleted. A silent
// re-import (REPAIR_REV) or a manual re-import rebuilds `customLists` from the
// original ZIP, so without this the user's list edits would come back from the
// dead. `mergeImportedCustomLists` honours these on every import.
function deletedImportedListNames(): string[] {
  try {
    return JSON.parse(getMeta('deletedImportedLists') ?? '[]') as string[];
  } catch {
    return [];
  }
}
function tombstoneImportedList(name: string): void {
  const set = new Set(deletedImportedListNames());
  set.add(name);
  setMeta('deletedImportedLists', JSON.stringify([...set]));
}

/** Merge freshly-imported lists with the user's edits so re-import stays
 *  merge-safe: drop imported lists the user deleted/renamed away, and keep the
 *  user's own created/edited lists. Called by the importer instead of a blind
 *  overwrite. */
export function mergeImportedCustomLists(imported: CustomList[]): CustomList[] {
  const userLists = getCustomLists().filter((l) => l.userCreated);
  return mergeCustomLists(imported, userLists, deletedImportedListNames());
}

/** Create a new empty list. Returns false on a blank or duplicate name. */
/**
 * Move a list one place up or down in the profile's own order.
 *
 * `customLists` has always BEEN the order — `createList` unshifts, so the newest
 * sits first — but nothing could change it, so an imported library arrived in
 * whatever order the export happened to list them and stayed that way forever.
 * A tester with a dozen imported lists put it plainly: "the lists aren't in the
 * order they were created, so it would be useful to rearrange them."
 *
 * One step at a time rather than a drag: these are full-width rows, and a
 * gesture that reorders them has to fight the scroll view it lives in.
 */
export function moveList(name: string, delta: -1 | 1): boolean {
  const lists = getCustomLists();
  const names = lists.map((l) => l.name);
  const j = movedListIndex(names, name, delta);
  if (j === -1) return false;
  const i = names.indexOf(name);
  const next = [...lists];
  [next[i], next[j]] = [next[j], next[i]];
  saveCustomLists(next);
  return true;
}

/**
 * Write the order of the LISTS themselves — what a drag on the Lists screen
 * commits. Not to be confused with `setListOrder` below, which orders the
 * titles inside one list; the tester who asked for this had to say "reorder the
 * lists, not the titles inside the lists" to be understood, and the two
 * functions deserve names that cannot make the same mistake.
 *
 * Names, not objects: the drag only ever moves rows around, so handing back the
 * order it produced cannot corrupt a list's contents. Anything the caller did
 * not name keeps its place at the end, so an arrangement made against a stale
 * screen cannot silently drop a list created since.
 */
export function setListsOrder(names: readonly string[]): void {
  const lists = getCustomLists();
  const byName = new Map(lists.map((l) => [l.name, l]));
  const ordered = names.map((n) => byName.get(n)).filter((l): l is CustomList => l != null);
  const rest = lists.filter((l) => !names.includes(l.name));
  saveCustomLists([...ordered, ...rest]);
}

export function createList(name: string, hidden = false): boolean {
  const n = name.trim();
  if (!n) return false;
  const lists = getCustomLists();
  if (lists.some((l) => l.name.toLowerCase() === n.toLowerCase())) return false;
  lists.unshift({ name: n, items: [], movieCount: 0, totalCount: 0, userCreated: true, hidden });
  saveCustomLists(lists);
  return true;
}

/** Show or hide a list on the public profile. Takes effect on the next publish. */
export function setListHidden(name: string, hidden: boolean): boolean {
  const lists = getCustomLists();
  const i = lists.findIndex((l) => l.name === name);
  if (i === -1) return false;
  lists[i] = { ...lists[i], hidden };
  saveCustomLists(lists);
  return true;
}

/**
 * Give a list its own artwork, or take it away with `null`.
 *
 * TOMBSTONED LIKE EVERY OTHER EDIT. A cover set on an imported list would be
 * rebuilt away by the next silent re-import (REPAIR_REV rebuilds `customLists`
 * from the original ZIP), so choosing one makes the list the user's — the same
 * rule a rename, a reorder and an add already follow.
 *
 * The gate lives at the call site, not here: `db.ts` stores what it is told.
 */
export function setListCover(name: string, coverUrl: string | null): boolean {
  const lists = getCustomLists();
  const i = lists.findIndex((l) => l.name === name);
  if (i === -1) return false;
  if (!lists[i].userCreated) tombstoneImportedList(name);
  lists[i] = { ...lists[i], coverUrl, userCreated: true };
  saveCustomLists(lists);
  return true;
}

/** Pin a list above the others, under every sort. Tombstoned for the same
 *  reason a cover is. */
export function setListPinned(name: string, pinned: boolean): boolean {
  const lists = getCustomLists();
  const i = lists.findIndex((l) => l.name === name);
  if (i === -1) return false;
  if (!lists[i].userCreated) tombstoneImportedList(name);
  lists[i] = { ...lists[i], pinned, userCreated: true };
  saveCustomLists(lists);
  return true;
}

/** Rename a list. Returns false on blank/duplicate name or missing list. An
 *  imported list becomes user-owned (+ tombstone) so re-import won't resurrect
 *  it under the old name. */
export function renameList(oldName: string, newName: string): boolean {
  const nn = newName.trim();
  if (!nn) return false;
  const lists = getCustomLists();
  const idx = lists.findIndex((l) => l.name === oldName);
  if (idx === -1) return false;
  if (lists.some((l, i) => i !== idx && l.name.toLowerCase() === nn.toLowerCase())) return false;
  const list = lists[idx];
  if (!list.userCreated) tombstoneImportedList(oldName);
  lists[idx] = { ...list, name: nn, userCreated: true };
  saveCustomLists(lists);
  return true;
}

/** Delete a list. An imported list is tombstoned so re-import won't bring it
 *  back. */
export function deleteList(name: string): void {
  const lists = getCustomLists();
  const target = lists.find((l) => l.name === name);
  if (target && !target.userCreated) tombstoneImportedList(name);
  saveCustomLists(lists.filter((l) => l.name !== name));
}

/** Replace a list's item order wholesale (drag-to-reorder commit). Marks the
 *  list user-owned (+ tombstone if imported) so the order survives re-import. */
export function setListOrder(listName: string, orderedItems: CustomListItem[]): void {
  const lists = getCustomLists();
  const idx = lists.findIndex((l) => l.name === listName);
  if (idx === -1) return;
  const list = lists[idx];
  if (orderedItems.length !== list.items.length) return; // guard against a lossy reorder
  if (!list.userCreated) tombstoneImportedList(listName);
  lists[idx] = { ...list, items: orderedItems, userCreated: true };
  saveCustomLists(lists);
}

/** Move an item within a list. Marks the list user-owned (+ tombstone if it was
 *  imported) so the custom order survives a re-import. */
export function moveListItem(listName: string, from: number, to: number): void {
  const lists = getCustomLists();
  const idx = lists.findIndex((l) => l.name === listName);
  if (idx === -1) return;
  const list = lists[idx];
  const items = [...list.items];
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return;
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  if (!list.userCreated) tombstoneImportedList(listName);
  lists[idx] = { ...list, items, userCreated: true };
  saveCustomLists(lists);
}

/** Add a show/movie to a list (no-op if already present). Marks the list
 *  user-owned (+ tombstone if imported) so re-import keeps the addition.
 *  Returns false if the list is missing or the item is already in it. */
export function addToList(listName: string, item: CustomListItem): boolean {
  const lists = getCustomLists();
  const idx = lists.findIndex((l) => l.name === listName);
  if (idx === -1) return false;
  const list = lists[idx];
  if (list.items.some((it) => it.kind === item.kind && it.name === item.name)) return false;
  const items = [...list.items, item];
  if (!list.userCreated) tombstoneImportedList(listName);
  lists[idx] = {
    ...list,
    items,
    movieCount: items.filter((it) => it.kind === 'movie').length,
    totalCount: items.length + (list.unresolved?.length ?? 0),
    userCreated: true,
  };
  saveCustomLists(lists);
  return true;
}

/** Remove one item from a list. The list becomes user-owned (+ tombstone if it
 *  was imported) so re-import won't refill the removed item. */
export function removeFromList(listName: string, itemName: string): void {
  const lists = getCustomLists();
  const idx = lists.findIndex((l) => l.name === listName);
  if (idx === -1) return;
  const list = lists[idx];
  const items = list.items.filter((it) => it.name !== itemName);
  if (items.length === list.items.length) return; // nothing removed
  if (!list.userCreated) tombstoneImportedList(listName);
  const removed = list.items.length - items.length;
  lists[idx] = {
    ...list,
    items,
    movieCount: items.filter((it) => it.kind === 'movie').length,
    totalCount: Math.max(items.length, (list.totalCount ?? list.items.length) - removed),
    userCreated: true,
  };
  saveCustomLists(lists);
}

/** Movie stats for the profile cards, live from the db. */
export function getMovieTotals(): { watched: number; minutes: number } {
  const row = db.getFirstSync<{ watched: number; seconds: number }>(
    `SELECT
       (SELECT COUNT(*) FROM movies WHERE watchedAt IS NOT NULL) AS watched,
       (SELECT COALESCE(SUM(runtime), 0) FROM movies WHERE watchedAt IS NOT NULL AND runtime > 0) AS seconds`,
  );
  // Same gap as the show clock (fixed in 1.1.8, but never applied to movies):
  // TV Time's export leaves many movie runtimes empty, and counting those as
  // zero undercounts movie time badly (a mostly-empty library read ~5 months
  // short). Fill each gap from the bundled movie metadata (MINUTES; this column
  // is SECONDS), else a ~100-min average.
  let fillMinutes = 0;
  try {
    // lazy require, mirroring getTotals — a top-level import would cycle
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { movieMeta } = require('@/movie-metadata') as typeof import('@/movie-metadata');
    const gaps = db.getAllSync<{ tmdbId: number | null; n: number }>(
      `SELECT tmdbId, COUNT(*) AS n FROM movies
       WHERE watchedAt IS NOT NULL AND (runtime IS NULL OR runtime <= 0) GROUP BY tmdbId`,
    );
    for (const g of gaps) fillMinutes += g.n * (movieMeta(g.tmdbId)?.runtime ?? 100);
  } catch {
    // metadata unavailable — better a short clock than a crashed profile
  }
  return { watched: row?.watched ?? 0, minutes: Math.round((row?.seconds ?? 0) / 60) + fillMinutes };
}

/** Saved emotions for a movie (raw export ids 28-39 → grid indexes 0-11). */
export function getMovieEmotions(name: string): number[] {
  const rows = db.getAllSync<{ value: number }>('SELECT value FROM emotions WHERE movie = ?', [name]);
  return rows.map((r) => r.value - 28).filter((v) => v >= 0 && v <= 11);
}

export function toggleMovieEmotion(name: string, emotion: number): void {
  const raw = emotion + 28;
  const exists = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM emotions WHERE movie = ? AND value = ?', [
    name,
    raw,
  ]);
  if ((exists?.n ?? 0) > 0) {
    db.runSync('DELETE FROM emotions WHERE movie = ? AND value = ?', [name, raw]);
  } else {
    db.runSync('INSERT INTO emotions (movie, value) VALUES (?, ?)', [name, raw]);
  }
}

export type HistoryRow = {
  showId: number;
  name: string;
  season: number;
  episode: number;
  watchedAt: string;
  rewatch: number;
};

/** Every episode watch event, newest first — the History screen's feed. */
export function getHistory(): HistoryRow[] {
  return db.getAllSync<HistoryRow>(
    `SELECT w.showId, s.name, w.season, w.episode, w.watchedAt, w.rewatch
     FROM watches w JOIN shows s ON s.tvdbId = w.showId
     ORDER BY w.watchedAt DESC, w.season DESC, w.episode DESC`,
  );
}

/** Totals for stats: episodes watched, shows tracked, minutes where known. */
export function getTotals(): { episodes: number; shows: number; minutes: number } {
  const row = db.getFirstSync<{ episodes: number; shows: number; seconds: number }>(
    `SELECT
       (SELECT COUNT(*) FROM (SELECT DISTINCT showId, season, episode FROM watches)) AS episodes,
       (SELECT COUNT(*) FROM shows) AS shows,
       (SELECT COALESCE(SUM(runtime), 0) FROM watches WHERE runtime > 0) AS seconds`,
  );
  // Episode COUNT is DISTINCT (showId, season, episode): an episode watched 8
  // times is one episode, matching TV Time. Time (below) still sums every watch
  // row, so rewatches DO add to the clock — only the episode tally is deduped.
  // TV Time exports only carry a per-episode runtime for some rows — in a real
  // library ~40% arrive empty. Counting those as zero made the clock read far
  // short of the truth (448h instead of 654h on a test library). Fill each gap
  // from its show's own runtime: metadata stores MINUTES, this column SECONDS.
  //
  // AND WHEN METADATA HAS NOT ARRIVED, FROM THE SHOW'S OWN WATCHES. Metadata is
  // fetched lazily and about half the bundled entries carry no runtime — Game
  // of Thrones among them — so a bare `?? 24` made every one of its episodes
  // count as 24 minutes until the show was opened, then leap to ~57 when the
  // fetch landed. The clock grew because a screen was opened. The rows that DO
  // carry a runtime describe the same episodes and do not move, so they are the
  // better guess. `watchRuntimeSeconds` holds that order for every caller.
  let fillMinutes = 0;
  try {
    // lazy require, mirroring metadata.ts — a top-level import would cycle
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { showMeta } = require('@/metadata') as typeof import('@/metadata');
    const averages = new Map(
      db
        .getAllSync<{ showId: number; avg: number }>(
          'SELECT showId, AVG(runtime) AS avg FROM watches WHERE runtime > 0 GROUP BY showId',
        )
        .map((r) => [r.showId, r.avg]),
    );
    const gaps = db.getAllSync<{ showId: number; n: number }>(
      'SELECT showId, COUNT(*) AS n FROM watches WHERE runtime IS NULL OR runtime <= 0 GROUP BY showId',
    );
    for (const g of gaps) {
      const secs = watchRuntimeSeconds(null, showMeta(g.showId)?.runtime, averages.get(g.showId));
      fillMinutes += (g.n * secs) / 60;
    }
    fillMinutes = Math.round(fillMinutes);
  } catch {
    // metadata unavailable — better a short clock than a crashed profile
  }
  return {
    episodes: row?.episodes ?? 0,
    shows: row?.shows ?? 0,
    minutes: Math.round((row?.seconds ?? 0) / 60) + fillMinutes,
  };
}

export default db;

/**
 * The shows and films this profile would PUBLISH, and the two totals beside
 * them — everything `publishProfile` sends and nothing else.
 *
 * SEPARATE FROM THE STATS ENGINE on purpose. `stats-calc.ts` computes charts,
 * streaks, per-week buckets and a dozen other things for the owner's own eyes;
 * a profile shelf needs a poster, a name and a flag. Reading the big engine to
 * publish two numbers would tie what leaves the phone to a module that exists
 * to draw graphs on it.
 */
export type PublishableTitle = {
  name: string;
  poster: string | null;
  favourite: boolean;
  rank: number | null;
  /** Shows only — TheTVDB's id, which is their identity everywhere. */
  tvdbId?: number;
  /** Films only — the year, so the CALLER can build `targetKey('title', …)`.
   *  That rule lives in pure.ts and must not be restated here. */
  year?: string | null;
};

export function getPublishableShows(): PublishableTitle[] {
  try {
    return db
      .getAllSync<{ tvdbId: number; name: string; posterUrl: string | null; favorited: number; favoriteRank: number | null }>(
        // Archived shows are deliberately included: a profile is what somebody
        // has watched, not what they are watching this week.
        'SELECT tvdbId, name, posterUrl, favorited, favoriteRank FROM shows ORDER BY (favoriteRank IS NULL), favoriteRank, name',
      )
      .map((r) => ({
        tvdbId: r.tvdbId,
        name: r.name,
        poster: r.posterUrl,
        favourite: r.favorited === 1,
        rank: r.favoriteRank,
      }));
  } catch {
    return [];
  }
}

export function getPublishableMovies(): PublishableTitle[] {
  try {
    return db
      .getAllSync<{ name: string; year: string | null; poster: string | null; favorited: number; favoriteRank: number | null }>(
        // WATCHED only. The watchlist is a plan, not a history, and publishing
        // it would tell everyone what somebody intends to do.
        `SELECT name, year, poster, favorited, favoriteRank FROM movies
          WHERE watchedAt IS NOT NULL
          ORDER BY (favoriteRank IS NULL), favoriteRank, name`,
      )
      .map((r) => ({
        name: r.name,
        poster: r.poster,
        favourite: r.favorited === 1,
        rank: r.favoriteRank,
        year: r.year,
      }));
  } catch {
    return [];
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   ONE ANSWER TO 'IS THIS IN MY LIBRARY?'
   ──────────────────────────────────────────────────────────────────────────── */

/** Anything a screen might be holding when it needs to ask. */
export type LibraryCandidate = {
  kind: 'show' | 'movie';
  name: string;
  tvdbId?: number | null;
  tmdbId?: number | null;
  year?: string | null;
};

/**
 * The single place that decides whether something is already tracked.
 *
 * IT USED TO BE FOUR PLACES AND THEY DISAGREED, which produced three separate
 * bug reports in one week:
 *
 *   search, shows      a string compare on the title — so somebody six seasons
 *                      into Reacher, One Piece, Bleach and Re:Zero was offered
 *                      'ADD SHOW' for all four, because the search source
 *                      spells those titles differently from the stored rows
 *   search, films      tmdbId + name + year, which was already correct
 *   the show page      tvdbId, also correct
 *   the '+' on Explore
 *   and Discover cards `useState(false)` — no check AT ALL. It read nothing,
 *                      started wrong on every mount, and only became a tick if
 *                      you tapped it in that session
 *
 * That last shape is the one already fixed once, in 1.4.0, on the "People also
 * watched" tick: a control that reflects the current visit rather than the
 * database. These were its siblings, and they were missed because the fix went
 * to the reported instance instead of to the shape.
 *
 * IDENTITY FIRST, NAME ONLY AS A FALLBACK. A title is a label, not a key: the
 * same show is spelled differently by different catalogues, and two different
 * films share one. The fallback exists because imported rows often carry no id
 * at all — the GDPR export never matched them against anything.
 */
export function inLibrary(item: LibraryCandidate): boolean {
  if (item.kind === 'show') {
    if (item.tvdbId != null) {
      const byId = db.getFirstSync<{ n: number }>(
        'SELECT 1 AS n FROM shows WHERE tvdbId = ?',
        [item.tvdbId],
      );
      if (byId) return true;
    }
    // A TMDB-only row has no TheTVDB id yet, so the title is the only evidence.
    return (
      db.getFirstSync<{ n: number }>(
        'SELECT 1 AS n FROM shows WHERE LOWER(name) = ?',
        [item.name.trim().toLowerCase()],
      ) != null
    );
  }

  // Films go through the identity matcher rather than a query, because the
  // rule is not expressible in one WHERE clause: ids win when both sides have
  // them, otherwise name AND year together, and never name alone.
  const rows = db.getAllSync<{
    name: string;
    originalName: string | null;
    tmdbId: number | null;
    year: string | null;
  }>('SELECT name, originalName, tmdbId, year FROM movies');
  return rows.some((m) =>
    movieIdentityMatches(
      {
        tmdbId: item.tmdbId ?? null,
        tvdbId: item.tvdbId,
        name: item.name,
        year: item.year,
      },
      m,
      // STRICT, because this decides what a TICK says. Adding is allowed to
      // guess "same film" to avoid duplicating something already held; a tick
      // is a claim about one specific row, and six results sharing a title
      // must not all claim to be the one in the library. That was the reported
      // bug: tapping + on the first Romance appeared to tick the last.
      { strict: true },
    ),
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   WHEN SOMETHING WAS WATCHED, CORRECTED
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Move an episode's FIRST watch to a different day.
 *
 * `markWatched` writes 'now', always, and until this existed nothing could
 * change it afterwards. Which is a hole in the one promise the app is built on:
 * 'it remembers the day you watched it' is the line on the store listing, in
 * the launch posts, and in an import that rescued nine years of somebody's
 * dates to the day. Then they watch three episodes on Friday, open the app on
 * Sunday, and the app writes Sunday -- quietly making the archive it rescued
 * less accurate than the export it came from.
 *
 * The FIRST watch, not the latest: `getSeasonEpisodes` and `getWatch` both
 * report `MIN(watchedAt)` where `rewatch = 0`, because a rewatch must never
 * hide the original date. Editing has to obey the same rule or the screens and
 * the data would describe different things.
 *
 * The clock time is kept from whatever row is being corrected. Somebody fixing
 * a DAY has said nothing about the hour, and inventing midnight would make an
 * evening's watching sort before that morning's.
 */
export function setEpisodeWatchDate(
  showId: number,
  season: number,
  episode: number,
  day: string,
): void {
  const row = db.getFirstSync<{ rowid: number; watchedAt: string }>(
    `SELECT rowid, watchedAt FROM watches
      WHERE showId = ? AND season = ? AND episode = ? AND rewatch = 0
      ORDER BY watchedAt LIMIT 1`,
    [showId, season, episode],
  );
  if (!row) return;
  const time = (row.watchedAt ?? '').slice(11, 19) || '12:00:00';
  db.runSync('UPDATE watches SET watchedAt = ? WHERE rowid = ?', [
    `${day} ${time}`,
    row.rowid,
  ]);
}

/** The same correction for a film. `movies.watchedAt` is a full ISO string. */
export function setMovieWatchDate(name: string, day: string): void {
  const row = db.getFirstSync<{ watchedAt: string | null }>(
    'SELECT watchedAt FROM movies WHERE name = ? OR originalName = ?',
    [name, name],
  );
  if (!row) return;
  const time = (row.watchedAt ?? '').slice(11, 19) || '12:00:00';
  db.runSync(
    'UPDATE movies SET watchedAt = ? WHERE name = ? OR originalName = ?',
    [`${day}T${time}`, name, name],
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   THE SMALL WIDGETS
   ────────────────────────────────────────────────────────────────────────────
   Everything here reads data the phone already holds and nothing on this
   screen has ever read back. `character_votes` has 1,496 rows on the server and
   is displayed nowhere; the oldest watch date is sitting in every import and is
   the one number that says how long somebody has been doing this.
   ──────────────────────────────────────────────────────────────────────────── */

/** The first thing this library ever recorded, as `YYYY-MM-DD`, or null. */
export function firstWatchDay(): string | null {
  const row = db.getFirstSync<{ d: string | null }>(
    "SELECT MIN(watchedAt) AS d FROM watches WHERE watchedAt IS NOT NULL AND watchedAt <> ''",
  );
  const d = row?.d ?? null;
  return d ? d.slice(0, 10) : null;
}

/**
 * The character voted for most often across the library, with their show.
 *
 * MOST OFTEN, not most recent: a favourite is who you kept choosing, and one
 * vote on a episode watched last night is not that. Ties break on the most
 * recent show so the answer at least moves when a library grows.
 */
export function topCharacter(): { name: string; show: string | null } | null {
  // GROUPED BY CHARACTER **AND SHOW**, which the first version was not — and it
  // is the kind of mistake SQLite lets you make silently. Grouping on the name
  // alone leaves `s.name` a bare column, so SQLite returns it from an ARBITRARY
  // row of the group: the app confidently announced "Eren Yeager — Stranger
  // Things", pairing a character from one show with the title of another.
  //
  // A character belongs to a show. The pair is the unit, so the pair is the
  // group.
  const row = db.getFirstSync<{ name: string; show: string | null; n: number }>(
    `SELECT cv.name AS name, s.name AS show, COUNT(*) AS n
       FROM character_votes cv
       LEFT JOIN shows s ON s.tvdbId = cv.showId
      WHERE cv.name IS NOT NULL AND cv.name <> ''
      GROUP BY LOWER(cv.name), cv.showId
      ORDER BY n DESC, cv.showId DESC
      LIMIT 1`,
  );
  return row ? { name: row.name, show: row.show } : null;
}

/**
 * Days in a row with at least one episode, counting back from today.
 *
 * TODAY OR YESTERDAY MAY START IT. Requiring today would show a broken streak
 * every morning to somebody who watches at night and has not opened the app
 * yet, which is a lie about them rather than about the data.
 */
export function watchStreak(): number {
  const days = db
    .getAllSync<{ d: string }>(
      "SELECT DISTINCT substr(watchedAt, 1, 10) AS d FROM watches WHERE watchedAt IS NOT NULL AND watchedAt <> '' ORDER BY d DESC LIMIT 400",
    )
    .map((r) => r.d);
  if (!days.length) return 0;

  const dayMs = 86_400_000;
  const midnight = (s: string) => new Date(`${s}T00:00:00`).getTime();
  const today = midnight(new Date().toISOString().slice(0, 10));
  const gap = Math.round((today - midnight(days[0])) / dayMs);
  if (gap > 1) return 0;

  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    if (Math.round((midnight(days[i - 1]) - midnight(days[i])) / dayMs) !== 1) break;
    streak++;
  }
  return streak;
}

// ── Widget queries ───────────────────────────────────────────────────────────
//
// One query each, all of it from tables the phone already has. Every one of
// these returns null / 0 when there is nothing to say, because a widget with
// nothing in it must COLLAPSE rather than print a zero: "has watched nothing"
// and "has never synced" are different sentences, and a grid of noughts is the
// worst first impression a new library can make.

/** Watches that carry a clock, not just a date. Imported rows are usually
 *  `YYYY-MM-DD HH:MM:SS`; some older ones are date-only and cannot answer a
 *  question about time of day, so they are excluded rather than counted as
 *  midnight — which would invent a spike at 00:00 for everybody. */
const TIMED_WATCHES = "watchedAt IS NOT NULL AND length(watchedAt) >= 13 AND substr(watchedAt, 12, 2) <> ''";

/**
 * The genre you watch most, weighted by EPISODES rather than by shows.
 *
 * Counting shows would let eight one-episode comedies outrank a decade of one
 * drama. Genres live in the cached `showMeta:<id>` blobs rather than a column,
 * so this reads them out and folds them together.
 */
export function topGenre(): { name: string; pct: number } | null {
  const seen = db.getAllSync<{ showId: number; n: number }>(
    'SELECT showId, COUNT(*) AS n FROM watches GROUP BY showId',
  );
  if (!seen.length) return null;
  const tally = new Map<string, number>();
  let total = 0;
  for (const row of seen) {
    const raw = getMeta(`showMeta:${row.showId}`);
    if (!raw) continue;
    let genres: string[] = [];
    try {
      genres = (JSON.parse(raw) as { genres?: string[] }).genres ?? [];
    } catch {
      continue;
    }
    // A show in three genres lends its episodes to all three; the percentage is
    // therefore of GENRE-EPISODES, not of episodes, which is why it is worked
    // out against `total` rather than the library size.
    for (const g of genres) {
      if (!g) continue;
      tally.set(g, (tally.get(g) ?? 0) + row.n);
      total += row.n;
    }
  }
  if (!total) return null;
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (!best) return null;
  return { name: best[0], pct: Math.round((best[1] / total) * 100) };
}

/** Episodes watched in a given calendar year, local time. */
export function episodesInYear(year: number): number {
  return (
    db.getFirstSync<{ n: number }>("SELECT COUNT(*) AS n FROM watches WHERE substr(watchedAt, 1, 4) = ?", [
      String(year),
    ])?.n ?? 0
  );
}

/** The most episodes ever watched in one day, and which day that was. */
export function longestBinge(): { n: number; day: string } | null {
  const row = db.getFirstSync<{ n: number; d: string }>(
    "SELECT COUNT(*) AS n, substr(watchedAt, 1, 10) AS d FROM watches" +
      " WHERE watchedAt IS NOT NULL AND watchedAt <> ''" +
      ' GROUP BY d ORDER BY n DESC, d DESC LIMIT 1',
  );
  return row && row.n > 1 ? { n: row.n, day: row.d } : null;
}

/** The hour of day with the most watches, 0–23, and its share. */
export function primeHour(): { hour: number; pct: number } | null {
  const rows = db.getAllSync<{ h: string; n: number }>(
    `SELECT substr(watchedAt, 12, 2) AS h, COUNT(*) AS n FROM watches WHERE ${TIMED_WATCHES} GROUP BY h`,
  );
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (total < 20) return null; // too little to claim a habit
  const best = rows.sort((a, b) => b.n - a.n)[0]!;
  return { hour: Number(best.h), pct: Math.round((best.n / total) * 100) };
}

/**
 * Shows you have actually finished — every episode watched — plus any you have
 * marked finished by hand.
 *
 * IT USED TO COUNT ONLY THE FLAG, and the flag is set in one place, by somebody
 * deliberately choosing "finished" on a show. Most people never do, so the
 * widget read zero on a library with a hundred completed series and looked
 * broken rather than empty. A number about somebody's watching should be true
 * without them maintaining it.
 *
 * `totalEpisodes` comes from the cached metadata and means episodes in numbered
 * seasons — specials excluded, which is the same denominator every progress bar
 * in the app already divides by. A show with no metadata yet cannot be judged
 * complete and simply is not counted: better to undercount quietly than to call
 * a show finished because nothing had told us how long it was.
 */
export function finishedShowCount(): number {
  const rows = db.getAllSync<{ tvdbId: number; seen: number; flag: number }>(
    'SELECT tvdbId, episodesSeen AS seen, finished AS flag FROM shows',
  );
  if (rows.length === 0) return 0;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { showMeta } = require('@/metadata') as typeof import('@/metadata');
  let n = 0;
  for (const r of rows) {
    if (r.flag === 1) {
      n += 1;
      continue;
    }
    const total = showMeta(r.tvdbId)?.totalEpisodes ?? 0;
    if (total > 0 && r.seen >= total) n += 1;
  }
  return n;
}

/** How many episodes carry a star rating, and the average of them. */
export function ratedSummary(): { n: number; avg: number } | null {
  const row = db.getFirstSync<{ n: number; a: number }>(
    'SELECT COUNT(*) AS n, AVG(stars) AS a FROM episode_ratings',
  );
  if (!row || row.n === 0) return null;
  return { n: row.n, avg: Math.round((row.a ?? 0) * 10) / 10 };
}

/** The oldest watch in the archive, with the show it belongs to. */
export function firstWatch(): { show: string; day: string } | null {
  const row = db.getFirstSync<{ name: string | null; d: string }>(
    'SELECT s.name AS name, w.watchedAt AS d FROM watches w LEFT JOIN shows s ON s.tvdbId = w.showId' +
      " WHERE w.watchedAt IS NOT NULL AND w.watchedAt <> '' ORDER BY w.watchedAt ASC LIMIT 1",
  );
  return row?.name ? { show: row.name, day: row.d.slice(0, 10) } : null;
}

/** Films on the watchlist — added, never watched. */
export function watchlistCount(): number {
  return db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM movies WHERE watchedAt IS NULL')?.n ?? 0;
}

/**
 * The emotions voted most often, as indices into the app's fixed emotion list.
 *
 * Both tables count: `episode_emotions` is the imported archive and `emotions`
 * is what the app itself writes. Reading only one of them showed a fraction of
 * somebody's votes back to them, which for a widget whose whole point is "you
 * have 1,496 of these and have never seen them" would be worse than nothing.
 */
export function topEmotions(limit = 3): { emotion: number; n: number }[] {
  return db.getAllSync<{ emotion: number; n: number }>(
    'SELECT emotion, COUNT(*) AS n FROM (' +
      ' SELECT emotion FROM episode_emotions UNION ALL SELECT value AS emotion FROM emotions WHERE episodeId IS NOT NULL' +
      ') GROUP BY emotion ORDER BY n DESC, emotion ASC LIMIT ?',
    [limit],
  );
}

/** Total emotion votes, so a breakdown can show shares rather than counts. */
export function emotionTotal(): number {
  return (
    db.getFirstSync<{ n: number }>(
      'SELECT (SELECT COUNT(*) FROM episode_emotions) + (SELECT COUNT(*) FROM emotions WHERE episodeId IS NOT NULL) AS n',
    )?.n ?? 0
  );
}

/** The highest-rated episodes, newest rating first among equals. */
export function topRatedEpisodes(limit = 4): {
  showId: number;
  show: string;
  poster: string | null;
  season: number;
  episode: number;
  stars: number;
}[] {
  return db.getAllSync<{
    showId: number;
    show: string;
    poster: string | null;
    season: number;
    episode: number;
    stars: number;
  }>(
    'SELECT r.showId AS showId, s.name AS show, s.posterUrl AS poster, r.season AS season,' +
      ' r.episode AS episode, r.stars AS stars FROM episode_ratings r' +
      ' JOIN shows s ON s.tvdbId = r.showId' +
      ' ORDER BY r.stars DESC, r.showId DESC, r.season DESC, r.episode DESC LIMIT ?',
    [limit],
  );
}

/**
 * Shows in progress: followed, not archived, not finished, most recently
 * watched first. The shelf a profile is actually about.
 */
export function nowWatching(limit = 4): { tvdbId: number; name: string; poster: string | null }[] {
  return db.getAllSync<{ tvdbId: number; name: string; poster: string | null }>(
    'SELECT s.tvdbId AS tvdbId, s.name AS name, s.posterUrl AS poster,' +
      ' (SELECT MAX(w.watchedAt) FROM watches w WHERE w.showId = s.tvdbId) AS last' +
      ' FROM shows s WHERE s.followed = 1 AND s.archived = 0 AND s.finished = 0 AND s.episodesSeen > 0' +
      ' ORDER BY last DESC LIMIT ?',
    [limit],
  );
}

/** The owner's saved profile arrangement, or null when they have never
 *  changed it. Stored as a preference, reconciled with the build by
 *  `normalise()` — see `profile-layout.ts`. */
export function getProfileLayout(): string | null {
  return getMeta('profileLayout');
}

export function setProfileLayout(json: string | null): void {
  setMeta('profileLayout', json ?? '');
}

/**
 * The artwork behind an Artwork widget.
 *
 * The widget stores `show:<tvdbId>` or `movie:<name>` rather than an image URL,
 * and the picture is looked up at draw time. A URL rots — TheTVDB and TMDB
 * reorganise, posters get replaced, and a widget that saved one would quietly
 * go blank months later with nothing to point at. An id does not rot, and it
 * also means the widget follows the artwork when somebody overrides a poster.
 */
export function artworkRef(ref: string): { uri: string; name: string } | null {
  if (ref.startsWith('show:')) {
    const row = db.getFirstSync<{ name: string; posterUrl: string | null }>(
      'SELECT name, posterUrl FROM shows WHERE tvdbId = ?',
      [Number(ref.slice(5))],
    );
    return row?.posterUrl ? { uri: row.posterUrl, name: row.name } : null;
  }
  if (ref.startsWith('movie:')) {
    const name = ref.slice(6);
    const row = db.getFirstSync<{ name: string; poster: string | null }>(
      'SELECT name, poster FROM movies WHERE name = ?',
      [name],
    );
    return row?.poster ? { uri: row.poster, name: row.name } : null;
  }
  return null;
}

/** Everything with a picture, for the Artwork picker. Watched first: a profile
 *  is decorated with what somebody has actually seen. */
export function artworkChoices(): { ref: string; name: string; uri: string }[] {
  const shows = db.getAllSync<{ tvdbId: number; name: string; posterUrl: string }>(
    "SELECT tvdbId, name, posterUrl FROM shows WHERE posterUrl IS NOT NULL AND posterUrl <> ''" +
      ' ORDER BY episodesSeen DESC, name ASC LIMIT 300',
  );
  const movies = db.getAllSync<{ name: string; poster: string }>(
    "SELECT name, poster FROM movies WHERE poster IS NOT NULL AND poster <> '' AND watchedAt IS NOT NULL" +
      ' ORDER BY watchedAt DESC LIMIT 300',
  );
  // A row with no name is a blank line with a picture on it — unpickable in a
  // list of names. `fillMissingShowNames` recovers the title on the next launch
  // with a network, so this hides a row for one launch rather than for ever.
  return [
    ...shows.filter((s) => s.name?.trim()).map((s) => ({ ref: `show:${s.tvdbId}`, name: s.name, uri: s.posterUrl })),
    ...movies.filter((m) => m.name?.trim()).map((m) => ({ ref: `movie:${m.name}`, name: m.name, uri: m.poster })),
  ];
}

/**
 * Everything by NAME, for pickers that only need a title.
 *
 * NOT `artworkChoices`, and the difference is the bug this exists for. That one
 * answers "what can decorate a profile", so it requires a picture and caps at
 * 300 — right for the artwork picker, where the poster IS the product. The GIF
 * search was using it to choose a SEARCH TERM, which meant a show was hidden
 * from it for having no poster stored, and a library past 300 titles simply
 * stopped. Neither has anything to do with whether GIPHY can find a GIF of it.
 *
 * SO: no poster requirement, no cap, and unwatched films included — a film on
 * the watchlist is still something somebody might want on their profile. The
 * poster still rides along when there is one, because the picker shows it.
 *
 * A row with no name is still dropped, here as there: a blank line with a
 * picture on it is unpickable in a list of names.
 */
export function titleChoices(): { ref: string; name: string; uri: string | null }[] {
  const shows = db.getAllSync<{ tvdbId: number; name: string; posterUrl: string | null }>(
    'SELECT tvdbId, name, posterUrl FROM shows ORDER BY episodesSeen DESC, name ASC',
  );
  const movies = db.getAllSync<{ name: string; poster: string | null }>(
    'SELECT name, poster FROM movies ORDER BY watchedAt IS NULL, watchedAt DESC, name ASC',
  );
  return [
    ...shows.filter((s) => s.name?.trim()).map((s) => ({ ref: `show:${s.tvdbId}`, name: s.name, uri: s.posterUrl })),
    ...movies.filter((m) => m.name?.trim()).map((m) => ({ ref: `movie:${m.name}`, name: m.name, uri: m.poster })),
  ];
}

/**
 * Everything that happened on this date in an earlier year.
 *
 * FOUR SMALL QUERIES, NOT ONE CLEVER ONE. They read different tables and mean
 * different things, and a UNION that flattened them would need the ranking in
 * SQL — where it cannot be tested. `pickMemory` in `pure.ts` decides; this only
 * gathers.
 *
 * `substr(watchedAt, 6, 5)` is the month and day of a 'YYYY-MM-DD HH:MM:SS'
 * stamp, which is what every writer in this file produces and what the importer
 * wrote for nine years of somebody's history. Comparing strings rather than
 * parsing dates is what keeps this cheap enough to run on every launch.
 *
 * The year bound is `< thisYear`, so today's own marks are never a memory.
 */
export function memoryEventsOn(today: Date): MemoryEvent[] {
  const monthDay = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const year = String(today.getFullYear());
  const out: MemoryEvent[] = [];

  // AN ENDING. `finished` is the show's own flag, and the last watch of it
  // landing on this day is what makes it "you finished Dark on this day"
  // rather than "you once watched Dark".
  for (const r of db.getAllSync<{ showId: number; show: string; last: string }>(
    `SELECT w.showId AS showId, s.name AS show, MAX(w.watchedAt) AS last
       FROM watches w JOIN shows s ON s.tvdbId = w.showId
      WHERE s.finished = 1
      GROUP BY w.showId
     HAVING substr(last, 6, 5) = ? AND substr(last, 1, 4) < ?`,
    [monthDay, year],
  )) {
    out.push({ kind: 'finale', year: Number(r.last.slice(0, 4)), showId: r.showId, show: r.show });
  }

  // A DAY THAT MEANT SOMETHING. Grouped by show as well as day, because "seven
  // episodes of The Wire" is a portrait and "seven episodes" is a number.
  for (const r of db.getAllSync<{ showId: number; show: string; y: string; n: number }>(
    `SELECT w.showId AS showId, s.name AS show, substr(w.watchedAt, 1, 4) AS y, COUNT(*) AS n
       FROM watches w JOIN shows s ON s.tvdbId = w.showId
      WHERE substr(w.watchedAt, 6, 5) = ? AND substr(w.watchedAt, 1, 4) < ?
      GROUP BY substr(w.watchedAt, 1, 10), w.showId
     HAVING n >= 5`,
    [monthDay, year],
  )) {
    out.push({ kind: 'binge', year: Number(r.y), showId: r.showId, show: r.show, count: r.n });
  }

  // THEIR OWN WORDS. `date` is stored both with a T and with a space depending
  // on which importer wrote it, so it is normalised before slicing — the same
  // `replace` the duplicate check already uses.
  for (const r of db.getAllSync<{ entity: string; text: string; d: string }>(
    `SELECT entity, text, replace(date, 'T', ' ') AS d
       FROM comments
      WHERE substr(replace(date, 'T', ' '), 6, 5) = ? AND substr(date, 1, 4) < ?
        AND length(trim(text)) > 0
      ORDER BY length(text) DESC
      LIMIT 1`,
    [monthDay, year],
  )) {
    out.push({
      kind: 'comment',
      year: Number(r.d.slice(0, 4)),
      // The trailing "S1E5" is how the archive keys an episode, not how anybody
      // refers to a show they watched.
      show: r.entity.replace(/\s+S\d+E\d+$/i, '').trim(),
      text: r.text.trim(),
    });
  }

  // AND THE FALLBACK, which only ever earns the card. One row: this is the
  // common case on a day with any history at all, and nothing ranks below it.
  for (const r of db.getAllSync<{ showId: number; show: string; season: number; episode: number; y: string }>(
    `SELECT w.showId AS showId, s.name AS show, w.season AS season, w.episode AS episode,
            substr(w.watchedAt, 1, 4) AS y
       FROM watches w JOIN shows s ON s.tvdbId = w.showId
      WHERE substr(w.watchedAt, 6, 5) = ? AND substr(w.watchedAt, 1, 4) < ?
      ORDER BY w.watchedAt ASC
      LIMIT 1`,
    [monthDay, year],
  )) {
    out.push({ kind: 'episode', year: Number(r.y), showId: r.showId, show: r.show, season: r.season, episode: r.episode });
  }

  return out;
}

/**
 * EVERY memory, not just today's — the archive behind the "On this day" strip.
 *
 * WHY IT IS A DIFFERENT QUERY AND NOT A LOOP. The obvious way to build this is
 * to call `memoryEventsOn` for 365 dates, which is 1,460 queries against a
 * table with tens of thousands of rows, on the main thread, to fill one screen.
 * These are the same three questions with the month-day filter removed and a
 * date ordering added, which the database answers in one pass each.
 *
 * NO EPISODE ROWS. The plain-episode kind exists so the strip always has
 * SOMETHING to say on a day with any history at all — it is a fallback, not a
 * memory. A list of every episode ever watched is the watch timeline, which
 * already exists and is a different screen; a memories list made mostly of
 * "you watched an episode" would bury the three kinds worth reading.
 *
 * SORTED IN JS, not SQL. Three result sets with different shapes cannot be
 * ordered by the database without a UNION that flattens away the types, and the
 * sort is over at most `limit * 3` rows.
 */
/** `poster` is carried on the row rather than looked up per item: a list of
 *  three hundred would otherwise be three hundred queries during scroll, and
 *  the join costs nothing here. Null for comments, which hold no show id — see
 *  `MemoryEvent`. */
export type DatedMemory = { at: string; event: MemoryEvent; poster: string | null };

export function memoryArchive(limit = 300): DatedMemory[] {
  const dated: DatedMemory[] = [];

  for (const r of db.getAllSync<{ showId: number; show: string; last: string; poster: string | null }>(
    `SELECT w.showId AS showId, s.name AS show, s.posterUrl AS poster, MAX(w.watchedAt) AS last
       FROM watches w JOIN shows s ON s.tvdbId = w.showId
      WHERE s.finished = 1
      GROUP BY w.showId
      ORDER BY last DESC
      LIMIT ?`,
    [limit],
  )) {
    dated.push({
      at: r.last,
      poster: r.poster,
      event: { kind: 'finale', year: Number(r.last.slice(0, 4)), showId: r.showId, show: r.show },
    });
  }

  for (const r of db.getAllSync<{ showId: number; show: string; d: string; n: number; poster: string | null }>(
    `SELECT w.showId AS showId, s.name AS show, s.posterUrl AS poster,
            substr(w.watchedAt, 1, 10) AS d, COUNT(*) AS n
       FROM watches w JOIN shows s ON s.tvdbId = w.showId
      GROUP BY substr(w.watchedAt, 1, 10), w.showId
     HAVING n >= 5
      ORDER BY d DESC
      LIMIT ?`,
    [limit],
  )) {
    dated.push({
      at: r.d,
      poster: r.poster,
      event: { kind: 'binge', year: Number(r.d.slice(0, 4)), showId: r.showId, show: r.show, count: r.n },
    });
  }

  for (const r of db.getAllSync<{ entity: string; text: string; d: string }>(
    `SELECT entity, text, replace(date, 'T', ' ') AS d
       FROM comments
      WHERE length(trim(text)) > 0
      ORDER BY d DESC
      LIMIT ?`,
    [limit],
  )) {
    dated.push({
      at: r.d,
      // NO POSTER, and no lookup to find one. `comments.entity` is a display
      // string, and matching it to a show by name is precisely the bug that
      // made search offer ADD SHOW for shows already tracked.
      poster: null,
      event: {
        kind: 'comment',
        year: Number(r.d.slice(0, 4)),
        // The trailing "S1E5" is how the archive keys an episode, not how
        // anybody refers to a show they watched.
        show: r.entity.replace(/\s+S\d+E\d+$/i, '').trim(),
        text: r.text.trim(),
      },
    });
  }

  // Newest first. String compare is date compare: every `at` here is an ISO
  // prefix, and the ones that carry a time still sort correctly against the
  // ones that do not, because a date is a prefix of its own timestamps.
  dated.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return dated.slice(0, limit);
}

/**
 * What each day FELT like, for the emotion calendar.
 *
 * The join nobody has ever made: `watches` knows when, `episode_emotions` knows
 * how it felt, and the two have sat in the same database since 1.0 without ever
 * meeting. 57,287 votes, read by no screen — people recorded how something felt
 * MORE often than they recorded how good it was, and ratings appear everywhere
 * while feelings appear nowhere.
 *
 * A REWATCH CARRIES THE ORIGINAL FEELING, because emotions are keyed by episode
 * and not by watch — there has only ever been one vote per episode. So watching
 * an old favourite again paints today with what it felt like the first time.
 * That is the only answer the data can give, and it is arguably the truer one.
 *
 * Whole days, bounded by the caller: a nine-year archive is not walked to draw
 * six months of squares.
 */
export function emotionDayCounts(fromDay: string, toDay: string): Map<string, Map<number, number>> {
  const rows = db.getAllSync<{ day: string; emotion: number; n: number }>(
    `SELECT substr(w.watchedAt, 1, 10) AS day, e.emotion AS emotion, COUNT(*) AS n
       FROM watches w
       JOIN episode_emotions e
         ON e.showId = w.showId AND e.season = w.season AND e.episode = w.episode
      WHERE w.watchedAt >= ? AND w.watchedAt < ?
      GROUP BY day, e.emotion`,
    [fromDay, toDay],
  );
  const out = new Map<string, Map<number, number>>();
  for (const r of rows) {
    let day = out.get(r.day);
    if (!day) {
      day = new Map<number, number>();
      out.set(r.day, day);
    }
    day.set(r.emotion, r.n);
  }
  return out;
}

/** Everything watched on one day, with whatever was felt about each episode. */
export function watchesOnDay(day: string): { showId: number; show: string; season: number; episode: number; emotions: number[] }[] {
  const rows = db.getAllSync<{ showId: number; show: string; season: number; episode: number }>(
    `SELECT w.showId AS showId, s.name AS show, w.season AS season, w.episode AS episode
       FROM watches w JOIN shows s ON s.tvdbId = w.showId
      WHERE substr(w.watchedAt, 1, 10) = ?
      ORDER BY w.watchedAt ASC`,
    [day],
  );
  return rows.map((r) => ({
    ...r,
    emotions: db
      .getAllSync<{ emotion: number }>(
        'SELECT emotion FROM episode_emotions WHERE showId = ? AND season = ? AND episode = ?',
        [r.showId, r.season, r.episode],
      )
      .map((e) => e.emotion),
  }));
}

/**
 * Everything in the library that can be put on a list.
 *
 * NOT `artworkChoices`, which is the neighbouring function and the obvious one
 * to reuse. That one exists to pick a PICTURE, so it requires a poster and caps
 * at 300 of each — both correct there and wrong here: a show with no artwork is
 * still a show somebody wants to suggest, and a list built from "the 300 most
 * watched" would quietly refuse the obscure film that is the whole reason to
 * make a shared list.
 *
 * The `ref` is the same shape either way (`show:<tvdbId>` / `movie:<name>`), so
 * whatever consumes one consumes the other.
 */
export function listAddChoices(): { ref: string; name: string; uri: string | null }[] {
  const shows = db.getAllSync<{ tvdbId: number; name: string; posterUrl: string | null }>(
    'SELECT tvdbId, name, posterUrl FROM shows ORDER BY name ASC',
  );
  const movies = db.getAllSync<{ name: string; poster: string | null }>(
    'SELECT name, poster FROM movies ORDER BY name ASC',
  );
  /*
   * A NAMELESS ROW IS NOT AN OFFER. Two of them sorted above "13 Reasons Why"
   * here — one with a poster, one an empty blue square — because an empty name
   * sorts before a digit. Picking one would have put an untitled entry on a
   * list other people read.
   *
   * Excluded rather than labelled with its id: `fillMissingShowNames` recovers
   * the real title on the next launch with a network, so this is what a row
   * looks like for one launch, not for ever. The ones it cannot recover are ids
   * TheTVDB has deleted, which nobody could identify either.
   */
  return [
    ...shows.filter((s) => s.name?.trim()).map((s) => ({ ref: `show:${s.tvdbId}`, name: s.name, uri: s.posterUrl })),
    ...movies.filter((m) => m.name?.trim()).map((m) => ({ ref: `movie:${m.name}`, name: m.name, uri: m.poster })),
  ];
}
