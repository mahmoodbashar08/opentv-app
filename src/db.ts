/**
 * Local SQLite database — the app's source of truth (Phase 1).
 * On first launch it imports the bundled data generated from the TV Time
 * GDPR export (seed.json + records.json); afterwards all reads/writes go
 * through here. Metadata sync (Phase 2) will add episode catalogs.
 */
import * as SQLite from 'expo-sqlite';

import records from '@/data/records.json';
import { disambiguatedMovieName, episodeKey, mayFoldDuplicateShow, mergeCustomLists, movedListIndex, movieIdentityMatches, nextCharacterVote, renumberLists, resolveMovieRow, slug, watchRuntimeSeconds, type ArchiveCounts } from '@/pure';
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
export function markWatched(showId: number, season: number, episode: number): void {
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
    'SELECT rowid AS id, type, entity, text, date, likes, replies, image, imageUrl, ratio FROM comments ORDER BY date DESC',
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
export function addOwnComment(row: {
  entity: string;
  text: string;
  date: string;
  type?: 'comment' | 'reply';
}): void {
  // Compared on the DAY, not the timestamp: the archive stores the export's
  // `2026-06-24 12:00:00` and the server returns `2026-06-24T12:00:00.000Z`, so
  // an exact match called one comment two and inserted a second copy of it.
  // `entity` compared case-insensitively, for the same class of reason the date
  // is compared by day: the two writers of a row disagree about it. The app
  // resolves "Toy Story 5" from the library; the sync, running before that film
  // is there, falls back to the bare key and stores "toy story 5". Same comment,
  // and an `=` called them two.
  const existing = db.getFirstSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM comments WHERE LOWER(entity) = LOWER(?) AND text = ? AND substr(replace(date, \'T\', \' \'), 1, 10) = ?',
    [row.entity, row.text, row.date.replace('T', ' ').slice(0, 10)],
  );
  if ((existing?.n ?? 0) > 0) return;
  db.runSync(
    // `origin = 'app'` MARKS IT AS ALREADY PUBLISHED. Every caller of this
    // function has just posted to the server and is keeping a local copy — so
    // the row is on the server before it is in this table. Without the mark the
    // seeder treats it as archive and uploads it again, and the two copies
    // cannot merge because their ids are derived differently: the app's is a
    // server-minted `c_…` and the seeder's is an `imp_…` hash of the content.
    // That is exactly how one "Yes agree" became two.
    'INSERT INTO comments (type, entity, text, date, likes, replies, image, imageUrl, ratio, origin) VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, NULL, \'app\')',
    [row.type ?? 'comment', row.entity, row.text, row.date],
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
export function getSeedableCommentImages(afterId: number): (SeedableComment & { image: string })[] {
  return db.getAllSync<SeedableComment & { image: string }>(
    `SELECT id, type, entity, text, date, image FROM comments
      WHERE id > ? AND type != 'reply' AND image IS NOT NULL AND TRIM(image) <> ''
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

export type CustomListItem = { kind: 'show' | 'movie'; name: string; poster: string | null; tvdbId?: number };
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

function saveCustomLists(lists: CustomList[]): void {
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
