import { detectForeignSource, letterboxdRows, simklRows, traktRows } from '@/foreign-import';

/**
 * Real Letterboxd export headers, from their own documented format. The
 * mapping is tested against these rather than discovered on somebody's phone.
 */
const csv = (rows: string[][]) => rows;

describe('letterboxdRows', () => {
  it('takes the date the film was watched, not the day it was logged', () => {
    const out = letterboxdRows({
      'diary.csv': csv([
        ['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating', 'Rewatch', 'Tags', 'Watched Date'],
        ['2026-08-18', 'Arrival', '2016', 'https://boxd.it/x', '4.5', 'No', '', '2026-08-11'],
      ]),
    });
    expect(out.movieRows).toHaveLength(1);
    expect(out.movieRows[0].created_at).toBe('2026-08-11 12:00:00');
    expect(out.movieRows[0].movie_name).toBe('Arrival');
    expect(out.movieRows[0].movie_year).toBe('2016');
  });

  it('keeps a rewatch as a rewatch rather than a second film', () => {
    const out = letterboxdRows({
      'diary.csv': csv([
        ['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating', 'Rewatch', 'Tags', 'Watched Date'],
        ['2024-01-02', 'Heat', '1995', '', '5', 'No', '', '2024-01-02'],
        ['2026-02-03', 'Heat', '1995', '', '5', 'Yes', '', '2026-02-03'],
      ]),
    });
    expect(out.movieRows.map((r) => r.type)).toEqual(['watch', 'rewatch']);
  });

  it('does not lose films that predate the diary', () => {
    const out = letterboxdRows({
      'diary.csv': csv([['Date', 'Name', 'Year', 'Rewatch', 'Watched Date'], ['2026-01-01', 'Heat', '1995', 'No', '2026-01-01']]),
      'watched.csv': csv([
        ['Date', 'Name', 'Year', 'Letterboxd URI'],
        ['2019-05-05', 'Heat', '1995', ''],
        ['2019-05-06', 'Solaris', '1972', ''],
      ]),
    });
    // Heat is already in from the diary, with its real date; Solaris is not.
    expect(out.movieRows.filter((r) => r.movie_name === 'Heat')).toHaveLength(1);
    expect(out.movieRows.find((r) => r.movie_name === 'Solaris')?.type).toBe('watch');
  });

  it('carries the watchlist over instead of dropping it', () => {
    const out = letterboxdRows({
      'watchlist.csv': csv([['Date', 'Name', 'Year'], ['2026-03-01', 'Stalker', '1979']]),
    });
    expect(out.movieRows[0]).toMatchObject({ type: 'towatch', movie_name: 'Stalker' });
  });

  it('rounds a half star UP, never down', () => {
    const out = letterboxdRows({
      'ratings.csv': csv([
        ['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating'],
        ['2026-01-01', 'Arrival', '2016', '', '3.5'],
        ['2026-01-01', 'Heat', '1995', '', '5'],
        ['2026-01-01', 'Cats', '2019', '', '0.5'],
      ]),
    });
    // 3.5 must not become 3: that quietly makes somebody's opinion worse than
    // they gave it, on a screen where they would never notice.
    expect(out.movieRatings).toEqual([
      { name: 'Arrival', stars: 4 },
      { name: 'Heat', stars: 5 },
      { name: 'Cats', stars: 1 },
    ]);
  });

  it('brings no shows, because Letterboxd has none', () => {
    const out = letterboxdRows({ 'watched.csv': csv([['Date', 'Name', 'Year'], ['2026-01-01', 'Heat', '1995']]) });
    expect(out.showRows).toEqual([]);
    expect(out.episodeRows).toEqual([]);
  });

  it('survives an export with nothing in it', () => {
    expect(letterboxdRows({}).movieRows).toEqual([]);
    expect(letterboxdRows({ 'watched.csv': csv([]) }).movieRows).toEqual([]);
  });
});

describe('detectForeignSource', () => {
  it('recognises a Letterboxd export by what is inside it', () => {
    expect(detectForeignSource(['diary.csv', 'ratings.csv', 'watched.csv'])).toBe('letterboxd');
    expect(detectForeignSource(['letterboxd/diary.csv', 'letterboxd/ratings.csv'])).toBe('letterboxd');
  });

  it('is not fooled by the name of the ZIP or of a stray file', () => {
    expect(detectForeignSource(['user_tv_show_data.csv', 'ratings-live-votes.csv'])).toBeNull();
    expect(detectForeignSource(['letterboxd.csv'])).toBeNull();
  });
});

describe('traktRows', () => {
  const history = [
    {
      watched_at: '2026-01-02T21:00:00.000Z',
      type: 'episode',
      episode: { season: 1, number: 4 },
      show: { title: 'Dark', ids: { tvdb: 70523, tmdb: 70523 } },
    },
    { watched_at: '2026-01-03T20:00:00.000Z', type: 'movie', movie: { title: 'Heat', year: 1995, ids: { tmdb: 949 } } },
  ];

  it('keys shows by TheTVDB id, which is what this app already uses', () => {
    const out = traktRows({ history });
    expect(out.showRows).toEqual([
      { tv_show_id: '70523', tv_show_name: 'Dark', is_followed: '1', is_favorited: '0', archived: '0' },
    ]);
    expect(out.episodeRows[0]).toMatchObject({ s_id: '70523', season_number: '1', episode_number: '4' });
  });

  it('drops a show with no TheTVDB id rather than matching it by name', () => {
    const out = traktRows({
      history: [{ watched_at: 'x', episode: { season: 1, number: 1 }, show: { title: 'Dark', ids: { tmdb: 1 } } }],
    });
    expect(out.episodeRows).toEqual([]);
    expect(out.showRows).toEqual([]);
  });

  it('lists a show once however many episodes came from it', () => {
    const many = [1, 2, 3].map((n) => ({
      watched_at: 'x',
      episode: { season: 1, number: n },
      show: { title: 'Dark', ids: { tvdb: 70523 } },
    }));
    const out = traktRows({ history: many });
    expect(out.showRows).toHaveLength(1);
    expect(out.episodeRows).toHaveLength(3);
  });

  it('takes films, the watchlist and ratings', () => {
    const out = traktRows({
      history,
      watchlist: [{ type: 'movie', movie: { title: 'Stalker', year: 1979 }, listed_at: '2026-02-01' }],
      ratings: [{ type: 'movie', movie: { title: 'Heat' }, rating: 9 }],
    });
    expect(out.movieRows.find((r) => r.movie_name === 'Heat')).toMatchObject({ type: 'watch', movie_year: '1995' });
    expect(out.movieRows.find((r) => r.movie_name === 'Stalker')).toMatchObject({ type: 'towatch' });
    // 9 of 10 is 4.5 stars, and half a star always goes up.
    expect(out.movieRatings).toEqual([{ name: 'Heat', stars: 5 }]);
  });

  it('survives an empty payload', () => {
    expect(traktRows({})).toEqual({ showRows: [], episodeRows: [], movieRows: [], movieRatings: [] });
  });
});

describe('simklRows', () => {
  it('flattens seasons into one row per episode', () => {
    const out = simklRows({
      shows: [
        {
          title: 'Dark',
          ids: { tvdb: 70523 },
          last_watched_at: '2026-05-05',
          seasons: [{ number: 1, episodes: [{ number: 1, watched_at: '2026-01-01' }, { number: 2 }] }],
        },
      ],
    });
    expect(out.episodeRows).toHaveLength(2);
    expect(out.episodeRows[0].created_at).toBe('2026-01-01');
    // No date of its own: the show's last watch, rather than nothing at all.
    expect(out.episodeRows[1].created_at).toBe('2026-05-05');
  });

  it('reads plantowatch as the watchlist and everything else as watched', () => {
    const out = simklRows({
      movies: [
        { title: 'Heat', year: 1995, status: 'completed', watched_at: '2026-01-01', user_rating: 8 },
        { title: 'Stalker', year: 1979, status: 'plantowatch' },
      ],
    });
    expect(out.movieRows.find((r) => r.movie_name === 'Heat')?.type).toBe('watch');
    expect(out.movieRows.find((r) => r.movie_name === 'Stalker')?.type).toBe('towatch');
    expect(out.movieRatings).toEqual([{ name: 'Heat', stars: 4 }]);
  });

  it('survives a file that is not what anybody expected', () => {
    expect(simklRows(null).movieRows).toEqual([]);
    expect(simklRows({ shows: [{ title: 'x' }] }).episodeRows).toEqual([]);
  });
});
