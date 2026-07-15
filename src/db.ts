/**
 * Local SQLite database — the app's source of truth (Phase 1).
 * On first launch it imports the bundled data generated from the TV Time
 * GDPR export (seed.json + records.json); afterwards all reads/writes go
 * through here. Metadata sync (Phase 2) will add episode catalogs.
 */
import * as SQLite from 'expo-sqlite';

import records from '@/data/records.json';
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
    archived INTEGER NOT NULL DEFAULT 0
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
    ratio REAL
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
try {
  db.execSync('ALTER TABLE movies ADD COLUMN favorited INTEGER NOT NULL DEFAULT 0');
} catch {
  // column already there
}
try {
  db.execSync('ALTER TABLE comments ADD COLUMN imageUrl TEXT');
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

export type EpisodeWatch = { episode: number; watchedAt: string; rewatch: number };

/** Watched episodes of one season, in episode order. */
export function getSeasonEpisodes(showId: number, season: number): EpisodeWatch[] {
  return db.getAllSync<EpisodeWatch>(
    `SELECT episode, MAX(watchedAt) AS watchedAt, MAX(rewatch) AS rewatch
     FROM watches WHERE showId = ? AND season = ? GROUP BY episode ORDER BY episode`,
    [showId, season],
  );
}

/** Watch info for one episode, or null if unwatched. */
export function getWatch(showId: number, season: number, episode: number): EpisodeWatch | null {
  return (
    db.getFirstSync<EpisodeWatch>(
      `SELECT episode, MAX(watchedAt) AS watchedAt, MAX(rewatch) AS rewatch
       FROM watches WHERE showId = ? AND season = ? AND episode = ? GROUP BY episode`,
      [showId, season, episode],
    ) ?? null
  );
}

/** Mark an episode watched right now. */
export function markWatched(showId: number, season: number, episode: number): void {
  db.runSync('INSERT INTO watches (showId, season, episode, watchedAt, rewatch) VALUES (?, ?, ?, ?, 0)', [
    showId,
    season,
    episode,
    new Date().toISOString().slice(0, 19).replace('T', ' '),
  ]);
}

/** Remove all watch records of an episode (un-check). */
export function unmarkWatched(showId: number, season: number, episode: number): void {
  db.runSync('DELETE FROM watches WHERE showId = ? AND season = ? AND episode = ?', [showId, season, episode]);
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
    episodesSeen: number;
    addedAt: string | null;
  }>('SELECT tvdbId, name, posterUrl, followed, episodesSeen, addedAt FROM shows');

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
}

/** Add a movie to the watchlist from the feed/search. */
export function addMovieToWatchlist(name: string, poster: string | null, year: string | null, tmdbId: number | null): void {
  db.runSync(
    'INSERT OR IGNORE INTO movies (name, originalName, poster, year, tmdbId, stars, watchedAt, runtime, addedAt) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?)',
    [name, name, poster, year, tmdbId, new Date().toISOString()],
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

/** Favorite shows from the library itself (imported flag), in TV Time order. */
export function getFavoriteShows(): { tvdbId: number; name: string; posterUrl: string | null }[] {
  return db.getAllSync(
    'SELECT tvdbId, name, posterUrl FROM shows WHERE favorited = 1 ORDER BY (favoriteRank IS NULL), favoriteRank, name',
  );
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
    for (const t of ['shows', 'watches', 'movies', 'episode_ratings', 'episode_emotions', 'ratings', 'emotions', 'comments', 'meta']) {
      db.runSync(`DELETE FROM ${t}`);
    }
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
};

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

export function setMovieWatched(name: string, watched: boolean): void {
  db.runSync('UPDATE movies SET watchedAt = ?, rewatchCount = CASE WHEN ? THEN rewatchCount ELSE NULL END WHERE name = ? OR originalName = ?', [
    watched ? new Date().toISOString() : null,
    watched ? 1 : 0,
    name,
    name,
  ]);
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

/** Manually link a movie to a database entry — the Fix match flow. Works for
 * unmatched imports and for correcting a wrong automatic match. */
export function setMovieMatch(name: string, tmdbId: number, poster: string | null, year: string | null): void {
  db.runSync('UPDATE movies SET tmdbId = ?, poster = ?, year = ? WHERE name = ? OR originalName = ?', [
    tmdbId,
    poster,
    year,
    name,
    name,
  ]);
}

/** Poster update after a manual show match. */
export function setShowPoster(tvdbId: number, posterUrl: string | null): void {
  if (posterUrl) db.runSync('UPDATE shows SET posterUrl = ? WHERE tvdbId = ?', [posterUrl, tvdbId]);
}

/** Movie stats for the profile cards, live from the db. */
export function getMovieTotals(): { watched: number; minutes: number } {
  const row = db.getFirstSync<{ watched: number; seconds: number }>(
    `SELECT COUNT(*) AS watched, COALESCE(SUM(runtime), 0) AS seconds
     FROM movies WHERE watchedAt IS NOT NULL`,
  );
  return { watched: row?.watched ?? 0, minutes: Math.round((row?.seconds ?? 0) / 60) };
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
       (SELECT COUNT(*) FROM watches) AS episodes,
       (SELECT COUNT(*) FROM shows) AS shows,
       (SELECT COALESCE(SUM(runtime), 0) FROM watches) AS seconds`,
  );
  return {
    episodes: row?.episodes ?? 0,
    shows: row?.shows ?? 0,
    minutes: Math.round((row?.seconds ?? 0) / 60),
  };
}

export default db;
