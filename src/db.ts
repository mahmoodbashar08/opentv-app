/**
 * Local SQLite database — the app's source of truth (Phase 1).
 * On first launch it imports the bundled data generated from the TV Time
 * GDPR export (seed.json + records.json); afterwards all reads/writes go
 * through here. Metadata sync (Phase 2) will add episode catalogs.
 */
import * as SQLite from 'expo-sqlite';

import records from '@/data/records.json';
import { disambiguatedMovieName, episodeKey, mayFoldDuplicateShow, mergeCustomLists, movieIdentityMatches, nextCharacterVote, resolveMovieRow, type ArchiveCounts } from '@/pure';
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

/** Mark a show as a favorite (shows in the Favorites row). */
export function setShowFavorited(showId: number, favorited: boolean): void {
  db.runSync('UPDATE shows SET favorited = ? WHERE tvdbId = ?', [favorited ? 1 : 0, showId]);
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
export function getComments(): CommentRow[] {
  return db.getAllSync<CommentRow>(
    'SELECT type, entity, text, date, likes, replies, image, imageUrl, ratio FROM comments ORDER BY date DESC',
  );
}

export function getCommentCount(): number {
  return db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM comments')?.n ?? 0;
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
    db.getFirstSync<{ n: number }>("SELECT COUNT(*) AS n FROM comments WHERE TRIM(text) <> ''")?.n ?? 0
  );
}

/**
 * Own comments in `id` order, after `afterId` — the order a cancelled seeding
 * resumes in. `id` rather than `date`: it is unique and immutable, so "everything
 * up to here is done" is a single number, whereas two comments sharing a
 * timestamp would either be re-sent or skipped forever.
 *
 * The same `TRIM(text) <> ''` filter as the count, so the number in the offer
 * and the number the run walks are the same number. An image-only comment is
 * neither promised nor reported as a failure — there is nothing in it the
 * community surface accepts.
 */
export function getSeedableComments(afterId: number): SeedableComment[] {
  return db.getAllSync<SeedableComment>(
    "SELECT id, type, entity, text, date FROM comments WHERE id > ? AND TRIM(text) <> '' ORDER BY id",
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
    comments: one("SELECT COUNT(*) AS n FROM comments WHERE TRIM(text) <> ''"),
    episodeRatings: one('SELECT COUNT(*) AS n FROM episode_ratings'),
    episodeEmotions: one('SELECT COUNT(*) AS n FROM episode_emotions'),
    movieRatings: one('SELECT COUNT(*) AS n FROM movies WHERE stars IS NOT NULL'),
    movieEmotions: one('SELECT COUNT(*) AS n FROM emotions WHERE movie IS NOT NULL'),
    characterVotes: one('SELECT COUNT(*) AS n FROM character_votes'),
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

export function setMovieFavorite(name: string, favorited: boolean): void {
  db.runSync('UPDATE movies SET favorited = ? WHERE name = ? OR originalName = ?', [favorited ? 1 : 0, name, name]);
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
  setMeta('customLists', JSON.stringify(lists));
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
export function createList(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  const lists = getCustomLists();
  if (lists.some((l) => l.name.toLowerCase() === n.toLowerCase())) return false;
  lists.unshift({ name: n, items: [], movieCount: 0, totalCount: 0, userCreated: true });
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
  let fillMinutes = 0;
  try {
    // lazy require, mirroring metadata.ts — a top-level import would cycle
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { showMeta } = require('@/metadata') as typeof import('@/metadata');
    const gaps = db.getAllSync<{ showId: number; n: number }>(
      'SELECT showId, COUNT(*) AS n FROM watches WHERE runtime IS NULL OR runtime <= 0 GROUP BY showId',
    );
    for (const g of gaps) fillMinutes += g.n * (showMeta(g.showId)?.runtime ?? 24);
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
