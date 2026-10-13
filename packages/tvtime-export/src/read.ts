/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * What the TV Time GDPR export SAYS, row by row, with no opinion about what to
 * do with it. Every function here takes parsed CSV rows (see `exportReader`)
 * and returns plain objects; nothing reads a database, a file or the network.
 *
 * Ids are TheTVDB's throughout: TV Time was built on TheTVDB, so a show's
 * `tv_show_id` / `s_id` / `series_id` is a TheTVDB series id and needs no
 * lookup. Films are the exception — see `readMovies` and the README.
 *
 * Dates are passed through exactly as the export wrote them (`2021-05-21
 * 12:25:23` in most files). Re-formatting them here would make a second import
 * of the same export disagree with the first.
 */
import type { ExportReader, Row } from './archive';

// ---- shows -------------------------------------------------------------------

export type ExportShow = {
  tvdbId: number;
  name: string;
  /** TV Time's own counter. NOT reliable — see the README before trusting it. */
  episodesSeen: number;
  followed: boolean;
  favorited: boolean;
  archived: boolean;
};

/**
 * Tracked shows, from `user_tv_show_data.csv`, with the archived flag joined in
 * from `followed_tv_show.csv` (the GDPR export keeps it there). A row that
 * carries its own `archived` column — the browser-extension export does — is
 * honoured when the second file has nothing to say. Rows with no id are left
 * out; a caller that wants to report them reads `showRows` itself.
 */
export function readShows(showRows: readonly Row[], followedRows: readonly Row[]): ExportShow[] {
  const archived = new Map(followedRows.map((r) => [r.tv_show_id, r.archived === '1']));
  return showRows
    .filter((r) => r.tv_show_id)
    .map((r) => ({
      tvdbId: Number(r.tv_show_id),
      name: r.tv_show_name,
      episodesSeen: Number(r.nb_episodes_seen || 0),
      followed: r.is_followed === '1',
      favorited: r.is_favorited === '1',
      archived: archived.get(r.tv_show_id) ?? r.archived === '1',
    }));
}

// ---- episode watches -----------------------------------------------------------

export type ExportEpisodeWatch = {
  showId: number;
  season: number;
  episode: number;
  watchedAt: string;
  /** 1 when TV Time recorded at least one rewatch of this episode. */
  rewatch: number;
  /** minutes, when the row carries one */
  runtime: number | null;
  /** TheTVDB's episode id, when the row carries one */
  episodeId: number | null;
};

/**
 * One watch per row of `tracking-prod-records-v2.csv`, the CURRENT tracking
 * file. A row with no season or episode number is a whole-series row (the
 * moment a show was bulk-marked) and is not an episode watch.
 */
export function readEpisodeWatches(v2Rows: readonly Row[]): ExportEpisodeWatch[] {
  return v2Rows
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
}

/**
 * Is this row of the LEGACY `tracking-prod-records.csv` an episode watch?
 *
 * The legacy file holds the 2021-era watches, and some of them never made it
 * into v2. It also holds watches TV Time's own migration deliberately dropped,
 * so whether to believe a legacy row is the caller's decision — the README
 * explains the rule this app uses.
 */
export function isV1EpisodeWatch(r: Row): boolean {
  return !!(r.type === 'watch' && r.entity_type === 'episode' && r.series_id && r.episode_number && r.season_number);
}

// ---- films -----------------------------------------------------------------

/**
 * A storage name for a film, disambiguated when two genuinely different films
 * share a title.
 *
 * A name is the only identity most of the export gives a film, so "Ghostbusters"
 * (1984) and "Ghostbusters" (2016) overwrite each other — five films were
 * silently lost from a real 546-film export that way. When the source tells us
 * they are different works (different ids), the later one takes a year suffix,
 * which is how TV Time itself disambiguates.
 */
export function disambiguatedMovieName(title: string, year: string | null | undefined, taken: Set<string>): string {
  const base = title.trim();
  if (!taken.has(base.toLowerCase())) return base;
  const y = (year ?? '').trim().slice(0, 4);
  if (/^\d{4}$/.test(y) && !taken.has(`${base} (${y})`.toLowerCase())) return `${base} (${y})`;
  for (let n = 2; n < 50; n++) {
    const alt = `${base} (${n})`;
    if (!taken.has(alt.toLowerCase())) return alt;
  }
  return base;
}

export type ExportMovie = {
  name: string;
  /** null for a film that is only on the watchlist */
  watchedAt: string | null;
  /** when it went on the watchlist; null for a watched film */
  addedAt: string | null;
  runtime: number | null;
  rewatches: number;
  tvdbId: number | null;
  year: string | null;
};

export type ExportMovies = {
  /** watched films first (latest watch wins), then the watchlist */
  movies: ExportMovie[];
  /** what the file held before any parsing narrowed it — for reporting gaps */
  audit: { watchRows: number; watchTitles: Set<string>; namelessWatchRows: number };
};

/**
 * Watched films and the watchlist, from the legacy tracking file (films never
 * moved to v2).
 *
 * Rewatches arrive in their own row types — 'rewatch' (one per event, with a
 * running count) and 'rewatch_count' (the total) — and the largest is taken.
 * The browser-extension export puts the total inline on the watch row instead;
 * either is read.
 *
 * A to-watch row for a film that also has a watch row is NOT a second film,
 * even when the watch was renamed by `disambiguatedMovieName` ("Dune" watched
 * becomes "Dune (2021)", and the raw "Dune" to-watch row must not re-add it).
 */
export function readMovies(v1Rows: readonly Row[]): ExportMovies {
  const movieMap = new Map<string, ExportMovie>();
  const watchTitles = new Set<string>();
  let watchRows = 0;
  let namelessWatchRows = 0;
  const movieIdOfName = new Map<string, number>();
  const takenMovieNames = new Set<string>();
  const nameFor = (title: string, tvdbId: number | null, year: string | null): string => {
    const known = movieIdOfName.get(title);
    if (tvdbId && known && known !== tvdbId) {
      const alt = disambiguatedMovieName(title, year, takenMovieNames);
      takenMovieNames.add(alt.toLowerCase());
      return alt;
    }
    takenMovieNames.add(title.toLowerCase());
    if (tvdbId && !known) movieIdOfName.set(title, tvdbId);
    return title;
  };
  for (const r of v1Rows) {
    if (r.type === 'watch' && r.entity_type === 'movie') {
      watchRows++;
      if (r.movie_name) watchTitles.add(r.movie_name);
      else namelessWatchRows++;
    }
    if (r.type !== 'watch' || !r.movie_name) continue;
    const key = nameFor(r.movie_name, Number(r.movie_tvdb_id) || null, r.movie_year || null);
    const cur = movieMap.get(key);
    const at = r.created_at || '';
    if (!cur || (cur.watchedAt ?? '') < at) {
      movieMap.set(key, {
        name: key,
        watchedAt: at,
        addedAt: null,
        tvdbId: Number(r.movie_tvdb_id) || cur?.tvdbId || null,
        year: r.movie_year || cur?.year || null,
        runtime: r.runtime ? Number(r.runtime) : (cur?.runtime ?? null),
        rewatches: Math.max(cur?.rewatches ?? 0, Number(r.rewatch_count || 0)),
      });
    }
  }
  for (const r of v1Rows) {
    if ((r.type === 'rewatch' || r.type === 'rewatch_count') && r.movie_name) {
      const cur = movieMap.get(r.movie_name);
      if (cur) cur.rewatches = Math.max(cur.rewatches, Number(r.rewatch_count || 0));
    }
  }
  for (const r of v1Rows) {
    if (r.type !== 'towatch' || !r.movie_name) continue;
    if (movieMap.has(r.movie_name) || takenMovieNames.has(r.movie_name.toLowerCase())) continue;
    movieMap.set(r.movie_name, {
      name: r.movie_name,
      watchedAt: null,
      addedAt: r.created_at || '',
      runtime: null,
      rewatches: 0,
      tvdbId: Number(r.movie_tvdb_id) || null,
      year: r.movie_year || null,
    });
  }
  return { movies: [...movieMap.values()], audit: { watchRows, watchTitles, namelessWatchRows } };
}

/**
 * Film uuid → film name, from BOTH tracking eras.
 *
 * Lists and favourites name a film by a uuid and nothing else, so this map is
 * the only way to put a title on one. A uuid that appears in no tracking row —
 * a film you listed but never watched or rated — is not in it, and cannot be
 * named from the export at all. See "The list uuid problem" in the README.
 */
export function movieNamesByUuid(...rowSets: readonly (readonly Row[])[]): Map<string, string> {
  const uuidToMovie = new Map<string, string>();
  for (const rows of rowSets) {
    for (const r of rows) {
      if (r.uuid && r.movie_name && !uuidToMovie.has(r.uuid)) uuidToMovie.set(r.uuid, r.movie_name);
    }
  }
  return uuidToMovie;
}

// ---- votes: ratings, emotions, where-watched, favourite characters -------------

/**
 * TV Time rates on a 0..3 scale (BAD, GOOD, GREAT, WOW) for BOTH episodes and
 * films — verified against real exports (no 4s among 150+ votes). The same
 * files also carry a legacy 26..30 five-level scale (28 = GOOD, 29 = GREAT).
 * Both are answered here as one to five stars.
 *
 * Emotion ids 28..39 exist ONLY in the emotions files; the overlap with the
 * legacy rating ids is coincidence, the id spaces are per-file.
 */
const VOTE_TO_STARS: Record<number, number> = { 0: 1, 1: 3, 2: 4, 3: 5 };
const LEGACY_TO_STARS: Record<number, number> = { 26: 1, 27: 2, 28: 3, 29: 4, 30: 5 };
export const ratingStars = (v: number): number | null => VOTE_TO_STARS[v] ?? LEGACY_TO_STARS[v] ?? null;

/** The number at the end of a `vote_key` ("…-episode-1234-2" → 2). */
export const voteValue = (voteKey: string | undefined): number => Number((voteKey || '').split('-').pop());

/**
 * EPISODE VOTES NAME THE SHOW, NOT ITS ID. Match `name` case- and
 * space-insensitively against the shows and the v2 tracking rows' `series_name`
 * (which teaches alias spellings), or ratings silently vanish.
 */
export type ExportEpisodeVote = { name: string; season: number; episode: number; epId: number | null };

export function readEpisodeRatings(rows: readonly Row[]): (ExportEpisodeVote & { stars: number })[] {
  return rows
    .map((r) => ({
      name: r.series_name,
      season: Number(r.season_number),
      episode: Number(r.episode_number),
      stars: ratingStars(voteValue(r.vote_key)),
      epId: Number(r.episode_id) || null,
    }))
    .filter((r): r is typeof r & { stars: number } => !!r.name && r.stars != null);
}

/** Episode emotions, 0..11 in the order of `EMOTIONS`. */
export function readEpisodeEmotions(rows: readonly Row[]): (ExportEpisodeVote & { emotion: number })[] {
  return rows
    .map((r) => ({
      name: r.series_name,
      season: Number(r.season_number),
      episode: Number(r.episode_number),
      emotion: voteValue(r.vote_key) - 28,
      epId: Number(r.episode_id) || null,
    }))
    .filter((r) => r.name && r.emotion >= 0 && r.emotion <= 11);
}

/** The twelve emotions, by index. Film emotions in the export are these + 28. */
export const EMOTIONS = [
  'shocked', 'frustrated', 'sad', 'reflective', 'touched', 'amused',
  'scared', 'bored', 'understood', 'thrilled', 'confused', 'tense',
] as const;

/**
 * "Where did you watch it", per episode. Source id 3 is TV Time's Computer
 * bucket (confirmed against real usage); the other ids were never identified.
 */
export function readEpisodeWatchedOn(rows: readonly Row[]): (ExportEpisodeVote & { src: number })[] {
  return rows
    .map((r) => ({
      name: r.tv_show_name,
      season: Number(r.episode_season_number),
      episode: Number(r.episode_number),
      src: Number(r.watched_on_source_id),
      epId: Number(r.episode_id) || null,
    }))
    .filter((r) => r.name && r.episode > 0 && Number.isFinite(r.src));
}

/**
 * "Who was your favourite?" votes. TV Time exported only its own internal
 * character id, so the character's NAME is not in the export.
 */
export function readCharacterVotes(rows: readonly Row[]): (ExportEpisodeVote & { charId: number | null })[] {
  return rows
    .map((r) => ({
      name: r.tv_show_name,
      season: Number(r.episode_season_number),
      episode: Number(r.episode_number),
      charId: Number(r.show_character_id) || null,
      epId: Number(r.episode_id) || null,
    }))
    .filter((r) => r.name && r.episode > 0);
}

/** Film ratings, by film name, one to five stars. */
export function readMovieRatings(rows: readonly Row[]): { name: string; stars: number }[] {
  return rows
    .map((r) => ({ name: (r.movie_name || '').trim(), stars: ratingStars(voteValue(r.vote_key)) }))
    .filter((r): r is typeof r & { stars: number } => !!r.name && r.stars != null);
}

/** Film emotions, by film name, as the raw 28..39 value (subtract 28 for `EMOTIONS`). */
export function readMovieEmotions(rows: readonly Row[]): { name: string; value: number }[] {
  return rows
    .map((r) => ({ name: (r.movie_name || '').trim(), value: voteValue(r.vote_key) }))
    .filter((r) => r.name && r.value >= 28 && r.value <= 39);
}

// ---- lists + favourites ----------------------------------------------------------

export type ListEntry = { kind: 'show'; tvdbId: number } | { kind: 'movie'; uuid: string | undefined };

/**
 * The entries of one `lists-prod-lists.csv` row, in order, from its `objects`
 * column — a Go-printed blob of `map[id:267440 type:series]` and
 * `map[type:movie uuid:d42b395b-…]`.
 *
 * A series carries a TheTVDB id (0 when the blob had none). A film carries a
 * uuid and NOTHING ELSE — no title, no id. `movieNamesByUuid` names the ones
 * you also tracked; the rest cannot be named from the export (see the README).
 * Note that a series entry has a `uuid:` field of its own, so a uuid must only
 * ever be read from an entry whose type is movie.
 */
export function listEntries(objects: string | undefined): ListEntry[] {
  const out: ListEntry[] = [];
  for (const mm of (objects || '').matchAll(/map\[([^\]]*)\]/g)) {
    const body = mm[1];
    if (/type:series/.test(body)) out.push({ kind: 'show', tvdbId: Number(/id:(\d+)/.exec(body)?.[1]) });
    else if (/type:movie/.test(body)) out.push({ kind: 'movie', uuid: /uuid:([0-9a-f-]{36})/.exec(body)?.[1] });
  }
  return out;
}

/**
 * Favourite shows and films, IN THE LIST'S OWN ORDER. They live in two special
 * rows of the lists file (`favorite-series`, `favorite-movies`) rather than in
 * a flag; films come as uuids, so only the ones `uuidToMovie` can name are
 * returned.
 */
export function readFavorites(listRows: readonly Row[], uuidToMovie: Map<string, string>): { showIds: number[]; movieNames: string[] } {
  const rowText = (r: Row) => Object.values(r).join(' ');
  const listRow = (key: string) => listRows.find((r) => Object.values(r).includes(key));
  const favMovieRow = listRow('favorite-movies');
  const movieNames = favMovieRow
    ? [...rowText(favMovieRow).matchAll(/uuid:([0-9a-f-]{36})/g)]
        .map((m) => uuidToMovie.get(m[1]))
        .filter((n): n is string => !!n)
    : [];
  const favSeriesRow = listRow('favorite-series');
  // [\s[] before "id:" keeps uuid:… fragments from matching
  const showIds = favSeriesRow ? [...rowText(favSeriesRow).matchAll(/[\s[]id:(\d+)/g)].map((m) => Number(m[1])) : [];
  return { showIds, movieNames };
}

// ---- profile ------------------------------------------------------------------

export type ExportProfile = {
  username: string | null;
  /** TV Time's own numeric user id */
  userId: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  countryCode: string | null;
  bio: string | null;
  gender: string | null;
  birthYear: string | null;
};

/**
 * The profile, from four files. Gender and birthday are not in the personal
 * data file for most people — they came from the account TV Time was signed
 * into with, so the Facebook and social-login files are read as fallbacks.
 *
 * The image URLs point at TV Time's CDN, which died with the shutdown. Cover
 * images were TheTVDB fanart; `tvdbRescueUrl` finds most of them again.
 */
export function readProfile(x: Pick<ExportReader, 'csv' | 'csvLoose'>): ExportProfile {
  const userRow = x.csv('routing-prod-users.csv')[0];
  const personal = x.csvLoose('user_personal_data');
  const pval = (k: string) => personal.find((r) => r.name === k)?.value?.trim() || null;
  const fbRow = x.csvLoose('user_facebook_data')[0];
  const socialRow = x.csvLoose('user_social_data')[0];
  const cap = (s: string | undefined | null) => (s ? s[0].toUpperCase() + s.slice(1) : null);
  const birthday = fbRow?.birthday || socialRow?.birthday || '';
  return {
    username: userRow?.username ?? null,
    userId: userRow?.user_id ?? null,
    avatarUrl: userRow?.image_url || null,
    coverUrl: pval('cover'),
    countryCode: pval('country-code'),
    bio: pval('bio'),
    gender: pval('gender') ?? cap(fbRow?.gender) ?? cap(socialRow?.gender),
    birthYear: pval('birth-year') ?? (/^(\d{4})-/.exec(birthday)?.[1] ?? null),
  };
}

/**
 * TV Time served profile covers from TheTVDB's retired CloudFront mirror,
 * deleted along with the shutdown — but the same fanart still exists on
 * TheTVDB's current CDN under the legacy banners path:
 *   dg31sz3gwrwan.cloudfront.net/fanart/<seriesId>/<upload>-<n>-q80.jpg
 *     → artworks.thetvdb.com/banners/fanart/original/<seriesId>-<n>.jpg
 */
export function tvdbRescueUrl(url: string): string | null {
  const m = /^https?:\/\/dg31sz3gwrwan\.cloudfront\.net\/fanart\/(\d+)\/\d+-(\d+)(?:-q\d+)?\.(jpe?g|png)$/i.exec(url);
  return m ? `https://artworks.thetvdb.com/banners/fanart/original/${m[1]}-${m[2]}.${m[3]}` : null;
}

export type TvTimeProvider = 'apple' | 'google' | 'facebook' | 'email';
export type TvTimeSignIn = { provider: TvTimeProvider | null; email: string | null };

/** TV Time's own placeholder for "this provider gave us nothing". */
const NO_EMAIL = '<no-email-set>';

/** The providers a successor app is likely to offer, best first. */
const USABLE: TvTimeProvider[] = ['apple', 'google', 'email'];

function cleanEmail(raw: string | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v || v === NO_EMAIL) return null;
  // Deliberately loose: this is a hint, and refusing to show somebody their own
  // address because of an unusual domain helps nobody. It only has to look like
  // an address rather than like a placeholder or an id.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v.toLowerCase() : null;
}

/**
 * How this person signed in to TV Time, from `auth-prod-login.csv` and the
 * `user.csv` row — a hint for which sign-in button to point them at.
 *
 * Prefers Apple, then Google, then email over Facebook (an account with both
 * Apple and Facebook is an Apple account for this purpose), and falls back to
 * whatever was there. The address is the best one found anywhere, because the
 * row naming the provider is often not the row carrying the email; Facebook
 * logins carry '<no-email-set>'.
 *
 * 'tvtime' in the provider column IS the email account — a real value in the
 * file, not a blank. A password hash alone is kept as a second signal.
 */
export function tvtimeSignIn(authRows: readonly Row[], userRow?: Row): TvTimeSignIn {
  const seen: TvTimeProvider[] = [];
  let email: string | null = null;
  for (const r of authRows) {
    const p = (r.provider ?? '').trim().toLowerCase();
    const provider: TvTimeProvider | null =
      p === 'apple' || p === 'google' || p === 'facebook'
        ? p
        : p === 'tvtime' || (r.password_hash ?? '').trim() !== ''
          ? 'email'
          : null;
    if (provider && !seen.includes(provider)) seen.push(provider);
    email ??= cleanEmail(r.email);
  }
  email ??= cleanEmail(userRow?.mail);
  const provider = USABLE.find((p) => seen.includes(p)) ?? seen[0] ?? null;
  return { provider, email };
}

/** TV Time ids of the people this account followed, from `friend.csv`. */
export function readFriendIds(rows: readonly Row[]): string[] {
  return rows.map((r) => r.friend_id).filter(Boolean);
}

// ---- comments ------------------------------------------------------------------

/**
 * A comment's text, with the export's own placeholders read as empty.
 *
 * SOME EXPORTS CARRY THE STRING "null" WHERE THE CAPTION SHOULD BE — a
 * serialisation artefact from TV Time's side, not something anybody typed.
 * Found in production: 29 of them across 8 people, every one imported and not
 * one written by hand. A photo-only comment is a real thing and stays one: this
 * returns empty, and the caller keeps the row when there is an image.
 */
export function commentText(raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  const low = v.toLowerCase();
  return low === 'null' || low === 'undefined' || low === '<nil>' ? '' : v;
}

export type ExportComment = {
  type: string;
  /** a film or show name, or "Show S1E2" for a legacy episode comment */
  entity: string;
  text: string;
  date: string;
  likes: number;
  replies: number;
  /** TV Time's CDN — dead since the shutdown */
  imageUrl: string | null;
  /** width / height of the picture, when the row says */
  ratio: number | null;
  /** TV Time's own comment uuid; null for the legacy file, which predates them */
  tvtimeUuid: string | null;
};

/**
 * Your own comments, from BOTH of TV Time's comment systems: the current
 * `comments-prod-comments.csv` (comments and replies; 'like' rows are likes you
 * gave and are skipped) and the legacy `episode_comment.csv`, whose pictures
 * and GIFs live in `meme.csv`, joined by comment id.
 *
 * A row with neither text nor a picture is not a comment and is dropped.
 */
export function readComments(x: Pick<ExportReader, 'csvLoose'>): ExportComment[] {
  const imgUrlOf = (blob: string) => /url:(https?:\/\/[^\s\]]+)/.exec(blob || '')?.[1] ?? null;
  const imgRatioOf = (blob: string) => {
    const w = Number(/width:(\d+)/.exec(blob || '')?.[1]);
    const h = Number(/height:(\d+)/.exec(blob || '')?.[1]);
    return w > 0 && h > 0 ? w / h : null;
  };
  const current = x
    .csvLoose('comments-prod-comments')
    .filter((r) => (r.type === 'comment' || r.type === 'reply') && (r.movie_name || r.series_name))
    .filter((r) => commentText(r.text) || r.image)
    .map((r) => ({
      type: r.type,
      entity: (r.movie_name || r.series_name).trim(),
      text: commentText(r.text),
      date: r.created_at || '',
      likes: Number(r.like_count || 0),
      replies: Number(r.reply_count || 0),
      imageUrl: imgUrlOf(r.image),
      ratio: imgRatioOf(r.image),
      // `comment_uuid` in every export seen; `uuid` is the same file's row id
      tvtimeUuid: (r.comment_uuid || r.uuid || '').trim() || null,
    }));
  const memes = x.csvLoose('meme');
  const memeUrlOf = (commentId: string) => {
    const m = memes.find((y) => y.episode_comment_id === commentId);
    if (!m) return null;
    return [m.url, m.medium_url, m.gif_url, m.gif_medium_url, m.small_url].find((u) => u && u.startsWith('http')) ?? null;
  };
  const legacy = x
    .csvLoose('episode_comment')
    .filter((r) => r.tv_show_name)
    .map((r) => ({
      type: 'comment',
      entity: `${r.tv_show_name} S${Number(r.episode_season_number || 0)}E${Number(r.episode_number || 0)}`,
      text: commentText(r.comment) || commentText(r.extended_comment),
      date: r.created_at || '',
      likes: Number(r.nb_likes || 0),
      replies: 0,
      imageUrl: memeUrlOf(r.id),
      ratio: null,
      tvtimeUuid: null,
    }))
    .filter((c) => c.text || c.imageUrl);
  return [...current, ...legacy];
}

// ---- notifications: who followed you, and the feed itself -----------------------

export type ExportPerson = { id: string; name: string; imageUrl: string | null };

/**
 * The social graph, mined from `notifications-prod-notifications.csv`, because
 * no other file names the people involved: `friend.csv` is bare ids. "X
 * followed you" events carry the name, the TV Time profile id and the avatar;
 * the JSON payload sits in the `data` column, and ids also hide in avatar URLs.
 *
 * - `people` — every id the notifications put a name to (first seen wins)
 * - `followers` — the people who followed you, once each
 * - `feed` — the newest 100 notifications with any text, newest first
 */
export function readNotifications(rows: readonly Row[]): {
  people: Map<string, { name: string; imageUrl: string | null }>;
  followers: ExportPerson[];
  feed: { text: string; date: string; imageUrl: string | null }[];
} {
  const blobOf = (r: Row) => `${r.data || ''} ${r.objects || ''}`;
  const profileIdOf = (r: Row) =>
    /profile\/(\d+)/.exec(`${r.url} ${blobOf(r)}`)?.[1] ?? /\/user\/(\d+)\//.exec(r.image || '')?.[1] ?? null;
  const nameFromLocKey = (r: Row) =>
    /"loc-key":"(.+?) (followed|liked|commented|replied|mentioned|sent)/.exec(blobOf(r))?.[1]?.trim() || null;
  const people = new Map<string, { name: string; imageUrl: string | null }>();
  const followers: ExportPerson[] = [];
  for (const r of rows) {
    const id = profileIdOf(r);
    const name = nameFromLocKey(r);
    if (!id || !name) continue;
    const imageUrl = (r.image || '').startsWith('http') ? r.image : null;
    if (!people.has(id)) people.set(id, { name, imageUrl });
    if ((r.type === 'user-followed' || r.type === 'user-followed-back') && !followers.some((f) => f.id === id)) {
      followers.push({ id, name, imageUrl });
    }
  }
  const feed = rows
    .map((r) => {
      const text = (r.text || '').trim() || (/"loc-key":"(.+?)"/.exec(blobOf(r))?.[1] ?? '');
      const time = Number(r.time || 0);
      return {
        text,
        time,
        date: time ? new Date(time).toISOString().slice(0, 10) : '',
        imageUrl: (r.image || '').startsWith('http') ? r.image : null,
      };
    })
    .filter((n) => n.text)
    .sort((a, b) => b.time - a.time)
    .slice(0, 100)
    .map(({ text, date, imageUrl }) => ({ text, date, imageUrl }));
  return { people, followers, feed };
}

// ---- the unofficial browser-extension export -----------------------------------

/**
 * Not every TV Time export is the GDPR one. A browser extension wrote
 * `tvtime-series-<date>.csv`, `tvtime-series-episodes-<date>.csv` and
 * `tvtime-movies-<date>.csv`; this maps them onto the GDPR files' columns so
 * every reader above takes them unchanged. Each pile is empty when its file is
 * absent.
 */
export function readCommunityExport(x: Pick<ExportReader, 'communityCsv'>): { showRows: Row[]; episodeRows: Row[]; movieRows: Row[] } {
  const showRows = x.communityCsv('tvtime-series', 'episodes').map((r) => ({
    tv_show_id: r.tvdb_id,
    tv_show_name: r.title,
    // "stopped"/"stopped_watching" → archived; everything else stays followed
    is_followed: '1',
    is_favorited: '0',
    archived: (r.status || '').toLowerCase().includes('stop') ? '1' : '0',
  }));
  const episodeRows = x
    .communityCsv('tvtime-series-episodes')
    .filter((r) => r.is_watched?.toLowerCase() === 'true')
    .map((r) => ({
      s_id: r.series_tvdb_id,
      season_number: r.season,
      episode_number: r.episode,
      created_at: r.watched_at,
      rewatch_count: r.rewatch_count,
      series_name: r.title,
    }));
  // watched → a watch row; not yet watched → a watchlist (towatch) row
  const movieRows = x.communityCsv('tvtime-movies').map((r) => {
    const watched = r.is_watched?.toLowerCase() === 'true';
    return {
      type: watched ? 'watch' : 'towatch',
      entity_type: 'movie',
      movie_name: r.title,
      // the extension knows exactly which film this is — every row in a real
      // export had both, and they spare the matcher a guess
      movie_tvdb_id: r.tvdb_id,
      movie_year: r.year,
      created_at: watched ? r.watched_at || r.created_at : r.created_at,
      // the total rides inline on the watched row (GDPR uses separate rows)
      rewatch_count: (watched && r.rewatch_count) || '0',
    };
  });
  return { showRows, episodeRows, movieRows };
}
