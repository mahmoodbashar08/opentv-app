/**
 * Export the library as a ZIP of CSVs in TV Time's own GDPR-export format —
 * all 57 files, same names, same columns. Files whose data lives on the phone
 * are filled; the rest (TV Time's server-side analytics: IPs, sessions, device
 * tokens…) ship header-only, since that data never existed here.
 * OpenTV's importer reads the result back losslessly.
 */
import { strToU8, zipSync } from 'fflate';

import { badges, social } from '@/bundled-data';
import seed from '@/seed';
import db, { getComments, getMeta } from '@/db';
import { exportRemapOf, tvdbRowIdsOf } from '@/episode-remap';
import { isSeedLibrary } from '@/library';
import { TVTIME_HEADERS } from '@/tvtime-headers';

type Cell = string | number | null | undefined;
type Row = Record<string, Cell>;

function csv(rows: Cell[][]): Uint8Array {
  const esc = (v: Cell) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return strToU8(rows.map((r) => r.map(esc).join(',')).join('\n') + '\n');
}

// rows are keyed by column name; the real header dictates order
function fileFor(name: string, rows: Row[]): Uint8Array {
  const header = TVTIME_HEADERS[name];
  return csv([header, ...rows.map((r) => header.map((h) => r[h]))]);
}

const commentKey = (c: { entity: string; date: string; text: string }) =>
  `${c.entity}|${c.date}|${c.text.slice(0, 40)}`;

export function buildTvTimeZip(): Uint8Array {
  const uid = getMeta('tvtimeUserId') ?? '0';
  const username = getMeta('username') ?? 'opentv-user';

  const shows = db.getAllSync<{ tvdbId: number; name: string; episodesSeen: number; followed: number; favorited: number; archived: number }>(
    'SELECT * FROM shows',
  );
  const nameOf = new Map(shows.map((s) => [s.tvdbId, s.name]));
  const watches = db.getAllSync<{ showId: number; season: number; episode: number; watchedAt: string; rewatch: number; runtime: number | null }>(
    'SELECT * FROM watches',
  );
  const movies = db.getAllSync<{ name: string; watchedAt: string | null; addedAt: string | null; runtime: number | null; favorited: number; rewatchCount: number | null }>(
    'SELECT * FROM movies',
  );
  const epRatings = db.getAllSync<{ showId: number; season: number; episode: number; stars: number }>('SELECT * FROM episode_ratings');
  const epWatchedOn = db.getAllSync<{ showId: number; season: number; episode: number; source: string }>('SELECT * FROM episode_watched_on');
  const epEmotions = db.getAllSync<{ showId: number; season: number; episode: number; emotion: number }>('SELECT * FROM episode_emotions');
  const charVotes = db.getAllSync<{ showId: number; season: number; episode: number; name: string | null; charId: number | null }>(
    'SELECT * FROM character_votes',
  );
  const movieStars = db.getAllSync<{ name: string; stars: number }>('SELECT name, stars FROM movies WHERE stars IS NOT NULL');
  const movieEmotions = db.getAllSync<{ movie: string; value: number }>('SELECT movie, value FROM emotions WHERE movie IS NOT NULL');

  let friends: string[] = [];
  try {
    friends = JSON.parse(getMeta('tvtimeFriends') ?? '[]') as string[];
  } catch {}

  // movies get stable uuids so the favorite-movies + custom lists can reference
  // them — the same file linkage TV Time's own export uses
  const movieUuid = new Map(movies.map((m, i) => [m.name, `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]));

  // rows the importer moved onto TMDB's numbering go back out in TV Time's
  // own (TVDB) numbering, with their original episode ids — a round-trip
  // export stays byte-compatible with the real thing
  const remapCache = new Map<number, ReturnType<typeof exportRemapOf>>();
  const rowIdsCache = new Map<number, Record<string, number>>();
  const tvtimePos = (showId: number, season: number, episode: number): { season: number; episode: number; epId: number | '' } => {
    let remap = remapCache.get(showId);
    if (!remap) remapCache.set(showId, (remap = exportRemapOf(showId)));
    let rowIds = rowIdsCache.get(showId);
    if (!rowIds) rowIdsCache.set(showId, (rowIds = tvdbRowIdsOf(showId)));
    const orig = remap.get(`${season}-${episode}`);
    const s = orig?.s ?? season;
    const e = orig?.e ?? episode;
    return { season: s, episode: e, epId: rowIds[`${s}-${e}`] ?? '' };
  };

  // favorites, photos, comments, badges; the seed library keeps them in the bundle
  const seedLib = isSeedLibrary();
  const favShowIds = seedLib
    ? seed.favoriteShows.map((f) => f.tvdbId)
    : db
        .getAllSync<{ tvdbId: number }>('SELECT tvdbId FROM shows WHERE favorited = 1 ORDER BY (favoriteRank IS NULL), favoriteRank, name')
        .map((r) => r.tvdbId);
  const favMovieNames = seedLib
    ? seed.favoriteMovies.items.map((m) => m.name).filter((n) => movieUuid.has(n))
    : db
        .getAllSync<{ name: string }>('SELECT name FROM movies WHERE favorited = 1 ORDER BY (favoriteRank IS NULL), favoriteRank, name')
        .map((r) => r.name);
  const avatarUrl = getMeta('avatarUrl') ?? '';
  const coverUrl = getMeta('coverUrl') ?? '';

  // comments, minus the ones deleted in-app; imported libraries keep theirs in the db
  let deletedComments = new Set<string>();
  try {
    deletedComments = new Set(JSON.parse(getMeta('deletedComments') ?? '[]') as string[]);
  } catch {}
  type ExportComment = { type: string; entity: string; text: string; date: string; likes?: number; replies?: number; imageUrl?: string | null };
  const allComments: ExportComment[] = seedLib ? seed.comments : getComments();
  const comments = allComments.filter((c) => !deletedComments.has(commentKey(c)));
  const movieNames = new Set(movies.map((m) => m.name));
  const epRe = /^(.*)\sS(\d+)E(\d+)$/;
  const episodeComments = comments.flatMap((c) => {
    const m = epRe.exec(c.entity);
    return m ? [{ ...c, show: m[1], season: Number(m[2]), episode: Number(m[3]) }] : [];
  });
  const flatComments = comments.filter((c) => !epRe.test(c.entity));

  // social names round-trip through the notifications file, the same place
  // TV Time's own export keeps them
  type Person = { id: string; name: string | null; image: string | null; imageUrl?: string | null };
  const metaPeople = (key: string): Person[] => {
    try {
      return JSON.parse(getMeta(key) ?? '[]') as Person[];
    } catch {
      return [];
    }
  };
  const followerPeople: Person[] = seedLib
    ? social.followers.map((f) => ({ id: f.id, name: f.name, image: null }))
    : metaPeople('tvtimeFollowers');
  const followingPeople: Person[] = seedLib ? [] : metaPeople('tvtimeFollowingNames');

  // per-show emotion tallies, recomputed from the vote rows
  const emotionCount = new Map<string, number>();
  for (const e of epEmotions) emotionCount.set(`${e.showId}:${e.emotion}`, (emotionCount.get(`${e.showId}:${e.emotion}`) ?? 0) + 1);

  const rows: Record<string, Row[]> = {
    'routing-prod-users.csv': [{ username, image_url: avatarUrl, user_id: uid }],
    'user_tv_show_data.csv': shows.map((s) => ({
      is_followed: s.followed,
      is_favorited: s.favorited || (favShowIds.includes(s.tvdbId) ? 1 : 0),
      nb_episodes_seen: s.episodesSeen,
      tv_show_name: s.name,
      user_id: uid,
      tv_show_id: s.tvdbId,
    })),
    'followed_tv_show.csv': shows.map((s) => ({
      active: s.followed,
      archived: s.archived,
      tv_show_name: s.name,
      user_id: uid,
      tv_show_id: s.tvdbId,
    })),
    'tracking-prod-records-v2.csv': watches.map((w) => {
      const p = tvtimePos(w.showId, w.season, w.episode);
      return {
        s_id: w.showId,
        series_name: nameOf.get(w.showId) ?? '',
        season_number: p.season,
        episode_number: p.episode,
        episode_id: p.epId,
        ep_id: p.epId,
        created_at: w.watchedAt,
        runtime: w.runtime,
        rewatch_count: w.rewatch,
        user_id: uid,
      };
    }),
    'tracking-prod-records.csv': movies.map((m) => ({
      type: m.watchedAt != null ? 'watch' : 'towatch',
      entity_type: 'movie',
      movie_name: m.name,
      created_at: m.watchedAt ?? m.addedAt ?? '',
      runtime: m.runtime,
      rewatch_count: m.rewatchCount ?? 0,
      uuid: movieUuid.get(m.name),
      user_id: uid,
    })),
    'watched_on_episode.csv': epWatchedOn.map((w) => {
      const p = tvtimePos(w.showId, w.season, w.episode);
      return {
        tv_show_name: nameOf.get(w.showId) ?? '',
        episode_season_number: p.season,
        episode_number: p.episode,
        episode_id: p.epId,
        watched_on_source_id: w.source === 'Computer' ? 3 : 0,
        user_id: uid,
      };
    }),
    'ratings-3-prod-episode_votes.csv': epRatings.map((r) => {
      const p = tvtimePos(r.showId, r.season, r.episode);
      return {
        // back to TV Time's 0..3 scale (our 2 "OK" rounds down to 1 GOOD)
        vote_key: `0-${uid}-${[0, 0, 1, 1, 2, 3][r.stars] ?? 3}`,
        series_name: nameOf.get(r.showId) ?? '',
        season_number: p.season,
        episode_number: p.episode,
        episode_id: p.epId,
        user_id: uid,
      };
    }),
    'emotions-3-prod-episode_votes.csv': epEmotions.map((e) => {
      const p = tvtimePos(e.showId, e.season, e.episode);
      return {
        vote_key: `0-${uid}-${e.emotion + 28}`,
        series_name: nameOf.get(e.showId) ?? '',
        season_number: p.season,
        episode_number: p.episode,
        episode_id: p.epId,
        user_id: uid,
      };
    }),
    'show_character_episode_vote.csv': charVotes.map((v) => {
      const p = tvtimePos(v.showId, v.season, v.episode);
      return {
        show_character_id: v.charId ?? '',
        tv_show_name: nameOf.get(v.showId) ?? '',
        episode_season_number: p.season,
        episode_number: p.episode,
        episode_id: p.epId,
        user_id: uid,
      };
    }),
    'ratings-live-votes.csv': movieStars.map((m) => ({
      // back to TV Time's 0..3 movie scale (our 2 "OK" rounds down to 1 GOOD)
      vote_key: `0-${uid}-${[0, 0, 1, 1, 2, 3][m.stars] ?? 3}`,
      episode_id: '0',
      movie_name: m.name,
      user_id: uid,
    })),
    'emotions-live-votes.csv': movieEmotions.map((e) => ({
      vote_key: `0-${uid}-${e.value}`,
      episode_id: '0',
      movie_name: e.movie,
      user_id: uid,
    })),
    'lists-prod-lists.csv': [
      {
        user_id: uid,
        type: 'list',
        is_public: 'false',
        s_key: 'favorite-series',
        ordering: '0',
        objects: `[${favShowIds.map((id) => `map[id:${id} type:series]`).join(' ')}]`,
      },
      {
        user_id: uid,
        type: 'list',
        is_public: 'false',
        s_key: 'favorite-movies',
        ordering: '0',
        objects: `[${favMovieNames.map((n) => `map[type:movie uuid:${movieUuid.get(n)}]`).join(' ')}]`,
      },
      // custom lists (seed: the avengers list); items resolve via the movie uuids
      ...(seedLib ? seed.lists : []).map((l, i) => ({
        user_id: uid,
        type: 'list',
        is_public: 'false',
        name: l.name,
        s_key: `custom-${i + 1}`,
        ordering: String(i + 1),
        objects: `[${l.items
          .filter((it) => movieUuid.has(it.name))
          .map((it) => `map[type:movie uuid:${movieUuid.get(it.name)}]`)
          .join(' ')}]`,
      })),
    ],
    'user_personal_data.csv': (
      [
        ['cover', coverUrl],
        ['country-code', getMeta('countryCode')],
        ['bio', getMeta('bio')],
        ['gender', getMeta('gender')],
        ['birth-year', getMeta('birthYear')],
      ] as const
    )
      .filter(([, v]) => v)
      .map(([k, v]) => ({ user_id: uid, name: k, value: v })),
    'friend.csv': friends.map((f) => ({ user_id: uid, friend_id: f, affinity: '0' })),
    'user_badge.csv': seedLib
      ? [...badges.app.filter((b) => b.unlocked), ...badges.watch].map((b) => ({
          user_id: uid,
          badge_id: b.id,
          created_at: b.date ?? '',
          updated_at: b.date ?? '',
        }))
      : [],
    'comments-prod-comments.csv': flatComments.map((c) => ({
      is_spoiler: 'false',
      type: c.type,
      created_at: c.date,
      reply_count: c.replies ?? 0,
      entity_type: movieNames.has(c.entity) ? 'movie' : 'series',
      movie_name: movieNames.has(c.entity) ? c.entity : '',
      series_name: movieNames.has(c.entity) ? '' : c.entity,
      like_count: c.likes ?? 0,
      text: c.text,
      image: c.imageUrl ? `map[url:${c.imageUrl}]` : '',
      user_id: uid,
    })),
    'episode_comment.csv': episodeComments.map((c) => ({
      tv_show_name: c.show,
      episode_season_number: c.season,
      episode_number: c.episode,
      comment: c.text,
      nb_likes: c.likes ?? 0,
      created_at: c.date,
      user_id: uid,
    })),
    'tv_show_user_emotion_count.csv': [...emotionCount.entries()].map(([key, count]) => {
      const [showId, emotion] = key.split(':').map(Number);
      return {
        tv_show_id: showId,
        tv_show_name: nameOf.get(showId) ?? '',
        emotion_id: emotion + 28,
        count,
        user_id: uid,
      };
    }),
    'notifications-prod-notifications.csv': [
      // follower events — our importer re-mines these on the way back in
      ...followerPeople.map((f) => ({
        user_id: uid,
        type: 'user-followed',
        url: `tvst://profile/${f.id}`,
        data: JSON.stringify({ 'loc-key': `${f.name ?? 'Someone'} followed you on TV Time`, url: `tvst://profile/${f.id}` }),
        image: f.imageUrl ?? '',
      })),
      // name-carrier rows for people you follow (ids alone live in friend.csv)
      ...followingPeople
        .filter((f) => f.name)
        .map((f) => ({
          user_id: uid,
          type: 'comment-liked',
          url: `tvst://profile/${f.id}`,
          data: JSON.stringify({ 'loc-key': `${f.name} liked your comment on TV Time`, url: `tvst://profile/${f.id}` }),
          image: f.imageUrl ?? '',
        })),
    ],
    'user_statistics.csv': [
      {
        nb_comments: comments.length,
        nb_likes: comments.reduce((n, c) => n + (c.likes ?? 0), 0),
        nb_friends: friends.length,
        nb_shows_followed: shows.filter((s) => s.followed).length,
        nb_episodes_watched: watches.length,
        user_id: uid,
      },
    ],
  };

  // every file from the real export, filled where we have the data
  const files: Record<string, Uint8Array> = {};
  for (const name of Object.keys(TVTIME_HEADERS)) files[name] = fileFor(name, rows[name] ?? []);

  // OpenTV-only sidecar: database links made in-app (import matching + Fix
  // match). TV Time's format has no columns for them, so without this a
  // restore would re-run matching and lose the user's manual fixes.
  const movieLinks = db.getAllSync<{ name: string; tmdbId: number | null; poster: string | null; year: string | null; watchedOn: string | null; stars: number | null; rewatchCount: number | null }>(
    'SELECT name, tmdbId, poster, year, watchedOn, stars, rewatchCount FROM movies WHERE tmdbId IS NOT NULL OR watchedOn IS NOT NULL OR stars IS NOT NULL OR rewatchCount IS NOT NULL',
  );
  const showLinks = db
    .getAllSync<{ tvdbId: number; posterUrl: string | null; addedAt: string | null; finished: number }>(
      'SELECT tvdbId, posterUrl, addedAt, finished FROM shows',
    )
    .map((s) => {
      // hint key first; older fixes only carry the id inside the cached
      // metadata blob — fish it out without parsing the whole thing
      let tmdbId = Number(getMeta(`showTmdbHint:${s.tvdbId}`)) || null;
      if (!tmdbId) {
        const m = getMeta(`showMeta:${s.tvdbId}`)?.match(/"tmdbId":\s*(\d+)/);
        if (m) tmdbId = Number(m[1]);
      }
      return {
        ...s,
        tmdbId,
        posterOverride: getMeta(`posterOverride:${s.tvdbId}`) ?? null,
        backdropOverride: getMeta(`backdropOverride:${s.tvdbId}`) ?? null,
      };
    });
  files['_opentv_extras.json'] = strToU8(
    JSON.stringify({ movies: movieLinks, shows: showLinks, epStars: epRatings, epWatchedOn, epCharVotes: charVotes }),
  );
  return zipSync(files, { level: 6 });
}
