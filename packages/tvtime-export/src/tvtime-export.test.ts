/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * The package's own tests, on small exports written here in the shapes the real
 * files take. They stand alone — no app, no database, no real export on disk —
 * so they run wherever the package is copied to.
 *
 * Every case is a rule a real export taught; the comment says which.
 */
import { strToU8, zipSync } from 'fflate';

import {
  exportReader,
  isTvTimeExport,
  isV1EpisodeWatch,
  listEntries,
  movieNamesByUuid,
  parseCsv,
  ratingStars,
  readComments,
  readCommunityExport,
  readEpisodeEmotions,
  readEpisodeRatings,
  readEpisodeWatches,
  readFavorites,
  readMovieEmotions,
  readMovies,
  readNotifications,
  readProfile,
  readShows,
  tvdbRescueUrl,
  tvtimeSignIn,
  unzipExport,
  type ExportFiles,
} from './index';

const files = (byName: Record<string, string>): ExportFiles =>
  Object.fromEntries(Object.entries(byName).map(([k, v]) => [k, strToU8(v)]));

describe('parseCsv', () => {
  it('reads quoted commas, quoted newlines, doubled quotes and CRLF', () => {
    const rows = parseCsv('a,b\r\n"x, y","line1\nline2"\r\n"say ""hi""",\r\n');
    expect(rows).toEqual([
      { a: 'x, y', b: 'line1\nline2' },
      { a: 'say "hi"', b: '' },
    ]);
  });

  it('pads a short row instead of shifting columns', () => {
    expect(parseCsv('a,b,c\n1')).toEqual([{ a: '1', b: '', c: '' }]);
  });
});

describe('exportReader', () => {
  it('finds files inside the account folder, and never in __MACOSX', () => {
    const { csv } = exportReader(
      files({
        '__MACOSX/acct/._user_tv_show_data.csv': 'garbage',
        'acct/user_tv_show_data.csv': 'tv_show_id,tv_show_name\n1,One',
      }),
    );
    expect(csv('user_tv_show_data.csv')).toEqual([{ tv_show_id: '1', tv_show_name: 'One' }]);
    expect(csv('missing.csv')).toEqual([]);
  });

  // "episode_comment" must never pick up the likes you gave
  it('csvLoose prefers the exact basename over a longer one that contains it', () => {
    const { csvLoose } = exportReader(
      files({
        'acct/episode_comment_like.csv': 'id\nlike',
        'acct/episode_comment.csv': 'id\ncomment',
      }),
    );
    expect(csvLoose('episode_comment')).toEqual([{ id: 'comment' }]);
  });
});

describe('unzipExport / isTvTimeExport', () => {
  const inner = zipSync({ 'acct/user_tv_show_data.csv': strToU8('tv_show_id\n1') });

  // some downloads arrive as a ZIP holding the ZIP
  it('unwraps a double-zipped export', () => {
    const outer = zipSync({ 'export.zip': inner });
    expect(Object.keys(unzipExport(outer))).toEqual(['acct/user_tv_show_data.csv']);
    expect(isTvTimeExport(outer)).toBe(true);
  });

  it('knows somebody else’s ZIP, and bytes that are not a ZIP at all', () => {
    expect(isTvTimeExport(zipSync({ 'ratings.csv': strToU8('Const,Your Rating') }))).toBe(false);
    expect(isTvTimeExport(strToU8('tv_show_id\n1'))).toBe(false);
    expect(() => unzipExport(strToU8('not a zip'))).toThrow();
  });
});

describe('shows and episodes', () => {
  it('joins the archived flag from followed_tv_show.csv, and skips rows with no id', () => {
    const shows = readShows(
      parseCsv('tv_show_id,tv_show_name,nb_episodes_seen,is_followed,is_favorited\n10,Ten,4,1,0\n,Nameless,0,1,0'),
      parseCsv('tv_show_id,archived\n10,1'),
    );
    expect(shows).toEqual([{ tvdbId: 10, name: 'Ten', episodesSeen: 4, followed: true, favorited: false, archived: true }]);
  });

  it('reads v2 episode rows, and leaves the whole-series bulk-mark row out', () => {
    const w = readEpisodeWatches(
      parseCsv(
        's_id,season_number,episode_number,created_at,rewatch_count,runtime,episode_id\n' +
          '10,1,2,2021-05-21 12:25:23,2,42,999\n' +
          '10,,,2021-05-01 00:00:00,0,,',
      ),
    );
    expect(w).toEqual([
      { showId: 10, season: 1, episode: 2, watchedAt: '2021-05-21 12:25:23', rewatch: 1, runtime: 42, episodeId: 999 },
    ]);
  });

  it('tells a legacy episode watch from a film or a counter row', () => {
    expect(isV1EpisodeWatch({ type: 'watch', entity_type: 'episode', series_id: '1', season_number: '1', episode_number: '1' })).toBe(true);
    expect(isV1EpisodeWatch({ type: 'watch', entity_type: 'movie', movie_name: 'Heat' })).toBe(false);
    expect(isV1EpisodeWatch({ type: 'count-watch-episode-series', series_id: '1' })).toBe(false);
  });
});

describe('readMovies', () => {
  // five films vanished from a real 546-film export before this
  it('keeps two different films that share a title apart', () => {
    const { movies } = readMovies(
      parseCsv(
        'type,entity_type,movie_name,movie_tvdb_id,movie_year,created_at\n' +
          'watch,movie,Ghostbusters,1,1984,2020-01-01\n' +
          'watch,movie,Ghostbusters,2,2016,2020-02-01',
      ),
    );
    expect(movies.map((m) => m.name)).toEqual(['Ghostbusters', 'Ghostbusters (2016)']);
  });

  // a watched film reappeared in a tester's watch list
  it('never re-adds a watched film from the export’s own to-watch row', () => {
    const { movies } = readMovies(
      parseCsv(
        'type,entity_type,movie_name,movie_tvdb_id,movie_year,created_at,rewatch_count\n' +
          'watch,movie,Dune,1,1984,2020-01-01,\n' +
          'watch,movie,Dune,2,2021,2022-01-01,\n' +
          'towatch,movie,Dune,,,2019-01-01,\n' +
          'rewatch_count,movie,Dune,,,,3\n' +
          'towatch,movie,Heat,,,2019-01-01,',
      ),
    );
    expect(movies.map((m) => [m.name, m.watchedAt, m.rewatches])).toEqual([
      ['Dune', '2020-01-01', 3],
      ['Dune (2021)', '2022-01-01', 0],
      ['Heat', null, 0],
    ]);
  });

  it('counts what the file held, nameless rows included', () => {
    const { audit } = readMovies(parseCsv('type,entity_type,movie_name\nwatch,movie,Heat\nwatch,movie,Heat\nwatch,movie,'));
    expect([audit.watchRows, audit.watchTitles.size, audit.namelessWatchRows]).toEqual([3, 1, 1]);
  });
});

describe('votes', () => {
  it('reads both rating scales as stars, and nothing else', () => {
    expect([0, 1, 2, 3].map(ratingStars)).toEqual([1, 3, 4, 5]);
    expect([26, 27, 28, 29, 30].map(ratingStars)).toEqual([1, 2, 3, 4, 5]);
    expect(ratingStars(4)).toBeNull();
  });

  it('reads an episode rating from the tail of its vote key', () => {
    const r = readEpisodeRatings(
      parseCsv('series_name,season_number,episode_number,vote_key,episode_id\nDark,1,1,episode-123-3,55\nDark,1,2,episode-124-9,56'),
    );
    expect(r).toEqual([{ name: 'Dark', season: 1, episode: 1, stars: 5, epId: 55 }]);
  });

  it('numbers emotions 0..11 for episodes and keeps films on 28..39', () => {
    const ep = readEpisodeEmotions(parseCsv('series_name,season_number,episode_number,vote_key\nDark,1,1,e-28\nDark,1,2,e-40'));
    expect(ep.map((e) => e.emotion)).toEqual([0]);
    const film = readMovieEmotions(parseCsv('movie_name,vote_key\n Heat ,m-39\nHeat,m-2'));
    expect(film).toEqual([{ name: 'Heat', value: 39 }]);
  });
});

describe('lists and favourites', () => {
  // a series entry carries a uuid of its own; reading uuids without checking
  // the type collected 26 show uuids from one real list and offered them as films
  it('takes a film’s uuid, and never a series’', () => {
    const entries = listEntries(
      'map[id:267440 type:series uuid:11111111-1111-1111-1111-111111111111] map[type:movie uuid:d42b395b-0000-4000-8000-000000000001]',
    );
    expect(entries).toEqual([
      { kind: 'show', tvdbId: 267440 },
      { kind: 'movie', uuid: 'd42b395b-0000-4000-8000-000000000001' },
    ]);
  });

  it('names a film only when a tracking row carries its uuid', () => {
    const names = movieNamesByUuid(parseCsv('uuid,movie_name\nd42b395b-0000-4000-8000-000000000001,Heat'));
    const fav = readFavorites(
      parseCsv(
        's_key,objects\n' +
          'favorite-movies,map[type:movie uuid:d42b395b-0000-4000-8000-000000000001] map[type:movie uuid:d42b395b-0000-4000-8000-000000000002]\n' +
          'favorite-series,map[id:5 type:series uuid:d42b395b-0000-4000-8000-000000000003] map[id:7 type:series]',
      ),
      names,
    );
    expect(fav).toEqual({ showIds: [5, 7], movieNames: ['Heat'] });
  });
});

describe('profile, comments and notifications', () => {
  it('falls back to the sign-in files for gender and birth year', () => {
    const p = readProfile(
      exportReader(
        files({
          'acct/routing-prod-users.csv': 'username,user_id,image_url\nnoddy,42,https://cdn/a.jpg',
          'acct/user_personal_data.csv': 'name,value\nbio, hi \ncountry-code,GB',
          'acct/user_facebook_data.csv': 'gender,birthday\nfemale,1990-04-01',
        }),
      ),
    );
    expect(p).toEqual({
      username: 'noddy', userId: '42', avatarUrl: 'https://cdn/a.jpg', coverUrl: null,
      countryCode: 'GB', bio: 'hi', gender: 'Female', birthYear: '1990',
    });
  });

  // 29 comments across 8 people had the caption "null"
  it('reads a "null" caption as empty, keeps a photo-only comment, and joins legacy memes', () => {
    const c = readComments(
      exportReader(
        files({
          'acct/comments-prod-comments.csv':
            'type,movie_name,series_name,text,image,created_at,comment_uuid\n' +
            'comment,Heat,,null,map[url:https://cdn/x.gif width:200 height:100],2021-01-01,u1\n' +
            'comment,Heat,,null,,2021-01-02,u2\n' +
            'like,Heat,,nice,,2021-01-03,u3',
          'acct/episode_comment.csv': 'id,tv_show_name,episode_season_number,episode_number,comment,created_at\n7,Dark,1,2,,2019-01-01',
          'acct/meme.csv': 'episode_comment_id,url,gif_url\n7,,https://cdn/m.gif',
        }),
      ),
    );
    expect(c.map((x) => [x.entity, x.text, x.imageUrl, x.ratio, x.tvtimeUuid])).toEqual([
      ['Heat', '', 'https://cdn/x.gif', 2, 'u1'],
      ['Dark S1E2', '', 'https://cdn/m.gif', null, null],
    ]);
  });

  it('finds followers once each, and keeps the newest notifications first', () => {
    const n = readNotifications(
      parseCsv(
        'type,url,image,text,time,data\n' +
          'user-followed,https://tvtime/profile/9,https://cdn/9.jpg,,1000,"{""loc-key"":""Sam followed you""}"\n' +
          'user-followed-back,https://tvtime/profile/9,,,3000,"{""loc-key"":""Sam followed you""}"\n' +
          'badge,,,Badge unlocked,2000,',
      ),
    );
    expect(n.followers).toEqual([{ id: '9', name: 'Sam', imageUrl: 'https://cdn/9.jpg' }]);
    expect(n.feed.map((f) => f.text)).toEqual(['Sam followed you', 'Badge unlocked', 'Sam followed you']);
  });

  it('suggests the sign-in a successor app can offer, with the best address', () => {
    expect(
      tvtimeSignIn(parseCsv('provider,email\nfacebook,<no-email-set>\napple,Me@Example.com'), { mail: '' }),
    ).toEqual({ provider: 'apple', email: 'me@example.com' });
  });

  it('rewrites a dead TV Time cover URL to TheTVDB’s current CDN', () => {
    expect(tvdbRescueUrl('https://dg31sz3gwrwan.cloudfront.net/fanart/81189/1234-3-q80.jpg')).toBe(
      'https://artworks.thetvdb.com/banners/fanart/original/81189-3.jpg',
    );
    expect(tvdbRescueUrl('https://example.com/x.jpg')).toBeNull();
  });
});

describe('readCommunityExport', () => {
  it('maps the browser-extension files onto the GDPR columns', () => {
    const c = readCommunityExport(
      exportReader(
        files({
          'tvtime-series-2026-07-02.csv': 'tvdb_id,title,status\n10,Ten,stopped_watching',
          'tvtime-series-episodes-2026-07-02.csv':
            'series_tvdb_id,title,season,episode,is_watched,watched_at\n10,Ten,1,1,true,2021-01-01\n10,Ten,1,2,false,',
          'tvtime-movies-2026-07-02.csv': 'tvdb_id,title,year,is_watched,watched_at,created_at,rewatch_count\n5,Heat,1995,false,,2020-01-01,',
        }),
      ),
    );
    expect(readShows(c.showRows, [])[0].archived).toBe(true);
    expect(readEpisodeWatches(c.episodeRows).map((w) => `${w.season}x${w.episode}`)).toEqual(['1x1']);
    expect(readMovies(c.movieRows).movies).toEqual([
      { name: 'Heat', watchedAt: null, addedAt: '2020-01-01', runtime: null, rewatches: 0, tvdbId: 5, year: '1995' },
    ]);
  });
});
