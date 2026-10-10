import { classifyForeignJson, cp1252, detectForeignSource, imdbRows, isImdbCsv, isLetterboxdImportCsv, letterboxdImportRows, letterboxdRows, serializdRecords, serializdRows, simklRows, traktRows } from '@/foreign-import';

/**
 * Real Letterboxd export headers, from their own documented format. The
 * mapping is tested against these rather than discovered on somebody's phone.
 */
/** What `parseCsv` hands back: the header row applied to each line. */
const csv = (rows: string[][]): Record<string, string>[] => {
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
};

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

  it('keeps a film whose diary holds only a rewatch (it was missing from the library)', () => {
    const out = letterboxdRows({
      'diary.csv': csv([
        ['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating', 'Rewatch', 'Tags', 'Watched Date'],
        ['2026-05-20', 'The Matrix', '1999', '', '4', 'Yes', '', '2026-05-19'],
      ]),
      'watched.csv': csv([
        ['Date', 'Name', 'Year', 'Letterboxd URI'],
        ['2026-05-20', 'The Matrix', '1999', ''],
      ]),
    });
    expect(out.movieRows.map((r) => r.type).sort()).toEqual(['rewatch', 'watch']);
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

describe('classifyForeignJson', () => {
  const show = { title: 'The Bear', year: 2022, ids: { tvdb: 409795 } };

  it('knows a Simkl backup by the lists inside it, not by a file name', () => {
    const found = classifyForeignJson([{ shows: [], movies: [{ movie: { title: 'Heat' } }] }]);
    expect(found?.source).toBe('simkl');
  });

  /**
   * A Trakt export is several files and which is which is knowable from what
   * the items carry — so a renamed download still lands in the right pile,
   * which is the whole reason not to read the name.
   */
  it('sorts Trakt’s arrays by what their items carry', () => {
    const found = classifyForeignJson([
      [{ watched_at: '2026-01-02T00:00:00Z', show, episode: { season: 1, number: 1 } }],
      [{ listed_at: '2026-01-03T00:00:00Z', movie: { title: 'Heat', ids: { tmdb: 949 } } }],
      [{ rated_at: '2026-01-04T00:00:00Z', rating: 8, movie: { title: 'Heat', ids: { tmdb: 949 } } }],
    ]);
    expect(found?.source).toBe('trakt');
    if (found?.source !== 'trakt') throw new Error('expected trakt');
    expect(found.payload.history).toHaveLength(1);
    expect(found.payload.watchlist).toHaveLength(1);
    expect(found.payload.ratings).toHaveLength(1);
  });

  it('ignores JSON that is nobody’s export', () => {
    expect(classifyForeignJson([{ hello: 'world' }, [1, 2, 3]])).toBeNull();
    expect(classifyForeignJson([])).toBeNull();
  });

  /** A ZIP named for one service holding another's backup imports as what it
   *  actually is — the same rule the CSV detector already keeps. */
  it('is not fooled by which file the shape arrived in', () => {
    const found = classifyForeignJson([
      [{ watched_at: '2026-01-02T00:00:00Z', show, episode: { season: 1, number: 1 } }],
      { shows: [{ show }] },
    ]);
    expect(found?.source).toBe('simkl');
  });
});


/**
 * IMDb, tested against BOTH header generations, because both are still in
 * people's downloads folders: the columns changed at the end of 2017 and the
 * encoding changed in 2018.
 *
 * Headers taken from IMDb's own export, not invented here:
 *   post-2017 ratings:  Const, Your Rating, Date Rated, Title, URL,
 *                       Title Type, IMDb Rating, Runtime (mins), Year,
 *                       Genres, Num Votes, Release Date, Directors
 *   watchlist/list:     Position, Const, Created, Modified, Description,
 *                       Title, Original Title, URL, Title Type, ...
 *   pre-2018 ratings:   position, const, created, modified, description,
 *                       Title, Title type, Directors, You rated, ...
 */
describe('imdb', () => {
  const RATINGS = [
    'Const,Your Rating,Date Rated,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors'.split(','),
    'tt0110912,9,2026-09-24,Pulp Fiction,https://www.imdb.com/title/tt0110912/,movie,8.9,154,1994,Crime,2200000,1994-10-14,Quentin Tarantino'.split(','),
  ];

  it('knows its own header row, and nobody else\'s', () => {
    expect(isImdbCsv(RATINGS[0])).toBe(true);
    expect(isImdbCsv(['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating'])).toBe(false);
    expect(isImdbCsv([])).toBe(false);
  });

  it('turns a rating into a dated watch and a star score', () => {
    const rows = imdbRows(csv(RATINGS));
    expect(rows.movieRows).toEqual([
      {
        type: 'watch',
        entity_type: 'movie',
        movie_name: 'Pulp Fiction',
        movie_year: '1994',
        created_at: '2026-09-24 12:00:00',
      },
    ]);
    // 9/10 halves to 4.5 and rounds to 5 — `starsFromTen`, same as everywhere.
    expect(rows.movieRatings).toEqual([{ name: 'Pulp Fiction', stars: 5 }]);
  });

  /** A rated film is treated as a watched film — IMDb has no watch history, so
   *  the score is the only evidence there is. */
  it('reads the pre-2018 columns too', () => {
    const rows = imdbRows(
      csv([
        'position,const,created,modified,description,Title,Title type,Directors,You rated,IMDb Rating'.split(','),
        '1,tt0108052,2015-03-02,2015-03-02,,Schindler\'s List,movie,Steven Spielberg,10,9.0'.split(','),
      ]),
    );
    expect(rows.movieRows[0]).toMatchObject({ type: 'watch', movie_name: "Schindler's List" });
    expect(rows.movieRatings).toEqual([{ name: "Schindler's List", stars: 5 }]);
  });

  /** No score means it was never watched — that is a watchlist row, and its
   *  only date is the day it went on the list. */
  it('reads an unrated row as a watchlist entry', () => {
    const rows = imdbRows(
      csv([
        'Position,Const,Created,Modified,Description,Title,Original Title,URL,Title Type,Your Rating,Date Rated'.split(','),
        '1,tt1375666,2026-02-11,2026-02-11,,Inception,Inception,https://imdb.com/,movie,,'.split(','),
      ]),
    );
    expect(rows.movieRows).toEqual([
      {
        type: 'towatch',
        entity_type: 'movie',
        movie_name: 'Inception',
        movie_year: '',
        created_at: '2026-02-11 12:00:00',
      },
    ]);
    expect(rows.movieRatings).toEqual([]);
  });

  /**
   * TELEVISION IS SKIPPED, and this is the honest limit rather than an
   * oversight. The export has no series column and no season or episode
   * number, so a rated episode is a row whose Title is the episode's own name
   * — there is nothing to hang a watch on. Importing those as films would put
   * "Ozymandias" in somebody's film library.
   */
  it('skips series and episodes rather than importing them as films', () => {
    const rows = imdbRows(
      csv([
        'Const,Your Rating,Date Rated,Title,Title Type,Year'.split(','),
        'tt0903747,10,2026-01-01,Breaking Bad,tvSeries,2008'.split(','),
        'tt2301451,10,2026-01-02,Ozymandias,tvEpisode,2013'.split(','),
        'tt0110912,8,2026-01-03,Pulp Fiction,movie,1994'.split(','),
      ]),
    );
    expect(rows.movieRows.map((r) => r.movie_name)).toEqual(['Pulp Fiction']);
    expect(rows.showRows).toEqual([]);
    expect(rows.episodeRows).toEqual([]);
  });

  /** TV movies and shorts ARE films — they are in a film library everywhere
   *  else, and IMDb is the only place that calls them something separate. */
  it('counts tvMovie and short as films', () => {
    const rows = imdbRows(
      csv([
        'Const,Your Rating,Date Rated,Title,Title Type,Year'.split(','),
        'tt0000001,7,2026-01-01,A TV Movie,tvMovie,1999'.split(','),
        'tt0000002,7,2026-01-01,A Short,short,1999'.split(','),
      ]),
    );
    expect(rows.movieRows).toHaveLength(2);
  });

  /** An unparseable date leaves the film with no date rather than today's:
   *  the archive is about the day, and inventing one is worse than a blank. */
  it('never invents a date it could not read', () => {
    const rows = imdbRows(
      csv([
        'Const,Your Rating,Date Rated,Title,Title Type,Year'.split(','),
        'tt0000003,7,sometime last year,A Film,movie,1999'.split(','),
      ]),
    );
    expect(rows.movieRows[0].created_at).toBe('');
  });

  it('reads the date shapes IMDb has actually used', () => {
    const at = (d: string) =>
      imdbRows(
        csv(['Const,Your Rating,Date Rated,Title,Title Type'.split(','), `tt1,7,${d},A Film,movie`.split(',')]),
      ).movieRows[0].created_at;
    expect(at('2026-09-24')).toBe('2026-09-24 12:00:00');
    expect(at('24 Sep 2026')).toBe('2026-09-24 12:00:00');
    expect(at('9/24/2026')).toBe('2026-09-24 12:00:00');
  });

  /**
   * THE ENCODING, which is the difference between importing `Amélie` and
   * importing a title that can never match TMDB. IMDb writes cp1252, where
   * `é` is one byte, 0xE9.
   */
  it('decodes windows-1252 titles', () => {
    expect(cp1252(new Uint8Array([0x41, 0x6d, 0xe9, 0x6c, 0x69, 0x65]))).toBe('Amélie');
    // The 0x80–0x9F block, which is where cp1252 and Latin-1 disagree.
    expect(cp1252(new Uint8Array([0x93, 0x92, 0x97]))).toBe('\u201c\u2019\u2014');
  });
});


/**
 * The Letterboxd IMPORT shape — one CSV, `Title`/`WatchedDate` — which is what
 * the JustWatch extension and most "get your list out of X" tools write.
 * Deliberately tested beside the EXPORT shape above, because reading one with
 * the other's keys is the failure this exists to prevent.
 */
describe('letterboxd import shape', () => {
  it('is told apart from IMDb and from Letterboxd’s own export', () => {
    expect(isLetterboxdImportCsv(['Title', 'Year', 'Rating', 'WatchedDate'])).toBe(true);
    expect(isLetterboxdImportCsv(['Title', 'Year', 'imdbID'])).toBe(true);
    // IMDb also has a Title; `Const` is what settles it.
    expect(isLetterboxdImportCsv(['Const', 'Title', 'Title Type', 'imdbID'])).toBe(false);
    // Letterboxd's own export uses Name, not Title — that goes to letterboxdRows.
    expect(isLetterboxdImportCsv(['Date', 'Name', 'Year', 'Rating'])).toBe(false);
    // A CSV that merely has a Title column is nobody's export.
    expect(isLetterboxdImportCsv(['Title', 'Notes'])).toBe(false);
  });

  it('reads a watched row with its date and score', () => {
    const rows = letterboxdImportRows(
      csv([
        'Title,Year,Rating,WatchedDate,imdbID,tmdbID'.split(','),
        'Parasite,2019,4.5,2026-03-04,tt6751668,496243'.split(','),
      ]),
    );
    expect(rows.movieRows).toEqual([
      {
        type: 'watch',
        entity_type: 'movie',
        movie_name: 'Parasite',
        movie_year: '2019',
        created_at: '2026-03-04 12:00:00',
      },
    ]);
    // 4.5 of 5 rounds UP — the same rule letterboxdRows keeps, for the same
    // reason: rounding down makes somebody's opinion worse than they said.
    expect(rows.movieRatings).toEqual([{ name: 'Parasite', stars: 5 }]);
  });

  /** Ten points beats five when a file carries both: 7/10 is unambiguous where
   *  3.5/5 makes the half-star decision all over again. */
  it('prefers Rating10 over Rating', () => {
    const rows = letterboxdImportRows(
      csv(['Title,Rating,Rating10,WatchedDate'.split(','), 'Heat,1,7,2026-01-01'.split(',')]),
    );
    expect(rows.movieRatings).toEqual([{ name: 'Heat', stars: 4 }]);
  });

  /** No date and no score is a watchlist row — this format has no "seen" flag,
   *  so what is in the row is the only evidence there is. */
  it('reads a bare title as a watchlist entry', () => {
    const rows = letterboxdImportRows(csv(['Title,Year,WatchedDate'.split(','), 'Dune,2021,'.split(',')]));
    expect(rows.movieRows).toEqual([
      { type: 'towatch', entity_type: 'movie', movie_name: 'Dune', movie_year: '2021', created_at: '' },
    ]);
    expect(rows.movieRatings).toEqual([]);
  });

  /** A score with no date still means watched — undated rather than dropped. */
  it('keeps a rated film that carries no date', () => {
    const rows = letterboxdImportRows(csv(['Title,Rating,WatchedDate'.split(','), 'Alien,5,'.split(',')]));
    expect(rows.movieRows[0]).toMatchObject({ type: 'watch', created_at: '' });
    expect(rows.movieRatings).toEqual([{ name: 'Alien', stars: 5 }]);
  });
});

/**
 * SERIALIZD, which has no export yet (Oct 2026) — so these fixtures are
 * Serializd's own API vocabulary as the one public tool, serializd_to_trakt,
 * reads it field for field: `showId` (a TMDB id), `dateAdded`, the five
 * account lists, `seasonNumber`, `episodeNumber`, `episodeLogs`. Not a file
 * anybody has downloaded. The first real export file replaces them.
 */
describe('serializd', () => {
  /** What the importer resolves TMDB ids to; `serializdRows` never looks anything up itself. */
  const link = new Map([
    [1396, { tvdbId: 81189, name: 'Breaking Bad' }],
    [60059, { tvdbId: 273181, name: 'Better Call Saul' }],
    [1399, { tvdbId: 121361, name: 'Game of Thrones' }],
  ]);

  /** The `context` the account endpoint answers: lists of season records,
   *  one of them carrying its season's episode logs. */
  const CONTEXT = {
    context: {
      watched: [
        {
          showId: 1396,
          seasonNumber: 1,
          dateAdded: '2023-10-01T03:41:43Z',
          episodeLogs: [
            { episodeNumber: 1, dateAdded: '2023-10-01T03:41:43Z' },
            { episodeNumber: 2, dateAdded: '2023-10-02T20:00:00Z', rating: 4.5, review: 'The RV.' },
          ],
        },
      ],
      currentlyWatching: [{ showId: 60059, dateAdded: '2026-01-05T10:00:00Z' }],
      droppedShows: [{ showId: 1399, dateAdded: '2024-02-02T00:00:00Z' }],
      watchlist: [{ showId: 60059, dateAdded: '2024-05-20T03:59:01Z' }],
    },
  };

  /** The flat record the script builds for every watched episode. */
  const FLAT = [
    { showId: 1396, showName: 'Breaking Bad', seasonNumber: 5, episodeNumber: 14, dateAdded: '2024-06-01T21:00:00Z' },
    { showId: 1396, showName: 'Breaking Bad', seasonNumber: 5, episodeNumber: 15, dateAdded: '2024-06-02T21:00:00Z' },
  ];

  it('flattens a context dump into records that know their list and inherit the show and season', () => {
    const recs = serializdRecords(CONTEXT);
    expect(recs.map((r) => [r.showId, r.season, r.episode, r.list])).toEqual([
      [1396, 1, null, 'watched'],
      [1396, 1, 1, 'watched'],
      [1396, 1, 2, 'watched'],
      [60059, null, null, 'currentlyWatching'],
      [1399, null, null, 'droppedShows'],
      [60059, null, null, 'watchlist'],
    ]);
    expect(recs[2]).toMatchObject({ rating: 4.5, review: 'The RV.', at: '2023-10-02T20:00:00Z' });
  });

  it('reads the flat record the script writes, ids as numbers or as digits', () => {
    const recs = serializdRecords([...FLAT, { showId: '60059', seasonNumber: '1', episodeNumber: '1', dateAdded: '2026-01-05T10:00:00Z' }]);
    expect(recs).toHaveLength(3);
    expect(recs[0]).toMatchObject({ showId: 1396, showName: 'Breaking Bad', season: 5, episode: 14 });
    expect(recs[2]).toMatchObject({ showId: 60059, season: 1, episode: 1 });
  });

  it('keys shows by TheTVDB id through the link, one row per show, and drops what the link cannot place', () => {
    const out = serializdRows(serializdRecords(CONTEXT), new Map([[1396, { tvdbId: 81189, name: 'Breaking Bad' }]]));
    expect(out.showRows).toEqual([
      { tv_show_id: '81189', tv_show_name: 'Breaking Bad', is_followed: '1', is_favorited: '0', archived: '0' },
    ]);
    expect(out.episodeRows).toEqual([
      { s_id: '81189', season_number: '1', episode_number: '1', created_at: '2023-10-01T03:41:43Z', series_name: 'Breaking Bad' },
      { s_id: '81189', season_number: '1', episode_number: '2', created_at: '2023-10-02T20:00:00Z', series_name: 'Breaking Bad' },
    ]);
    // Never by name: the two unlinked shows are simply absent, not guessed.
    expect(out.movieRows).toEqual([]);
  });

  it('names a show from the file first, and from the link when the file is silent', () => {
    const out = serializdRows(serializdRecords([...FLAT, { showId: 60059, dateAdded: '2026-01-05T10:00:00Z' }]), link);
    expect(out.showRows.map((r) => r.tv_show_name).sort()).toEqual(['Better Call Saul', 'Breaking Bad']);
  });

  it('archives a dropped show and keeps a watchlisted one followed with no episodes', () => {
    const out = serializdRows(serializdRecords(CONTEXT), link);
    const byId = Object.fromEntries(out.showRows.map((r) => [r.tv_show_id, r]));
    expect(byId['121361']).toMatchObject({ archived: '1', is_followed: '1' });
    expect(byId['273181']).toMatchObject({ archived: '0', is_followed: '1' });
    expect(out.episodeRows.filter((r) => r.s_id === '273181')).toEqual([]);
  });

  /** Episode scores only — a season or show score spread over its episodes
   *  would invent opinions nobody expressed. Half a star goes UP. */
  it('rounds a half star up, and ignores a score on a season', () => {
    const out = serializdRows(
      serializdRecords([
        { showId: 1396, seasonNumber: 1, dateAdded: 'x', rating: 5 },
        { showId: 1396, seasonNumber: 1, episodeNumber: 1, dateAdded: 'x', rating: 3.5 },
        { showId: 1396, seasonNumber: 1, episodeNumber: 2, dateAdded: 'x', rating: 0 },
      ]),
      link,
    );
    expect(out.episodeRatings).toEqual([{ name: 'Breaking Bad', season: 1, episode: 1, stars: 4 }]);
  });

  it('reads a file that counts to ten as a file that counts to ten', () => {
    const out = serializdRows(
      serializdRecords([
        { showId: 1396, seasonNumber: 1, episodeNumber: 1, dateAdded: 'x', rating: 7 },
        { showId: 1396, seasonNumber: 1, episodeNumber: 2, dateAdded: 'x', rating: 10 },
        { showId: 1396, seasonNumber: 1, episodeNumber: 3, dateAdded: 'x', rating: 4 },
      ]),
      link,
    );
    // 7 → 3.5 → 4; 10 → 5; and the 4 is a 4/10, which is 2 stars, not four.
    expect(out.episodeRatings?.map((r) => r.stars)).toEqual([4, 5, 2]);
  });

  it('turns reviews into comments: on the episode, or on the show with the season named', () => {
    const out = serializdRows(
      serializdRecords([
        { showId: 1396, seasonNumber: 1, episodeNumber: 2, dateAdded: '2023-10-02T20:00:00Z', review: 'The RV.' },
        { showId: 1396, seasonNumber: 2, dateAdded: '2023-11-01T20:00:00Z', reviewText: 'Fly.' },
        { showId: 1396, dateAdded: '2023-12-01T20:00:00Z', review: 'Best show.' },
      ]),
      link,
    );
    expect(out.comments).toEqual([
      { entity: 'Breaking Bad S1E2', text: 'The RV.', date: '2023-10-02T20:00:00Z' },
      { entity: 'Breaking Bad', text: 'S2: Fly.', date: '2023-11-01T20:00:00Z' },
      { entity: 'Breaking Bad', text: 'Best show.', date: '2023-12-01T20:00:00Z' },
    ]);
  });

  it('skips an episode it cannot place, and brings no films because Serializd has none', () => {
    const out = serializdRows(serializdRecords([{ showId: 1396, episodeNumber: 3, dateAdded: 'x' }]), link);
    expect(out.episodeRows).toEqual([]);
    expect(out.showRows).toHaveLength(1);
    expect(out.movieRows).toEqual([]);
    expect(serializdRows([], link)).toMatchObject({ showRows: [], episodeRows: [] });
  });

  describe('detection', () => {
    it('knows a Serializd file by its records, in either shape', () => {
      expect(classifyForeignJson([CONTEXT])?.source).toBe('serializd');
      expect(classifyForeignJson([FLAT])?.source).toBe('serializd');
      // Two files in one ZIP are one library.
      const found = classifyForeignJson([CONTEXT, FLAT]);
      if (found?.source !== 'serializd') throw new Error('expected serializd');
      expect(found.records).toHaveLength(8);
    });

    /** A ZIP named for Serializd holding somebody else's export imports as
     *  what it actually is — names mean nothing, the CSV rule, kept. The
     *  importer only reaches JSON once no TV Time CSV was found, so a
     *  serializd.zip holding a TV Time export never gets this far. */
    it('is not fooled by a name, nor by other JSON that carries a showId', () => {
      expect(detectForeignSource(['serializd.json'])).toBeNull();
      expect(detectForeignSource(['serializd/user_tv_show_data.csv'])).toBeNull();
      // OpenTV's own backup sidecar: `showId` there is a TheTVDB id on a rating
      // row, with no date and no list — reading it as Serializd would import
      // the wrong shows.
      const sidecar = { shows: [{ tvdbId: 81189, tmdbId: 1396, addedAt: '2026-01-01' }], epStars: [{ showId: 81189, season: 1, episode: 1, stars: 5 }] };
      expect(classifyForeignJson([sidecar])?.source).not.toBe('serializd');
      // Trakt and Simkl speak `show`/`ids`, never `showId`: still theirs.
      const trakt = [{ watched_at: '2026-01-02T00:00:00Z', show: { title: 'Dark', ids: { tvdb: 70523, tmdb: 70523 } }, episode: { season: 1, number: 1 } }];
      expect(classifyForeignJson([trakt])?.source).toBe('trakt');
      expect(classifyForeignJson([{ shows: [{ title: 'Dark', ids: { tmdb: 70523 } }] }])?.source).toBe('simkl');
    });
  });
});
