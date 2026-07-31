/**
 * The missing TheTVDB id on imported films.
 *
 * The favourite-character poll on the film screen showed the performer's
 * present-day headshot instead of the character. Everything downstream of the
 * id — `tvdbMovieDetail`'s `charPhoto` step, `characterFace`, `castForPoll`,
 * `artworkUrl` — was already right. The id itself was never there: the
 * importer reads `movie_tvdb_id`, a column no file in TV Time's GDPR export
 * contains, so `movies.tvdbId` was null for every imported film and the whole
 * TheTVDB path was skipped.
 *
 * This pins the three things the backfill depends on:
 *
 *  1. WHICH FILMS ARE WORTH ASKING ABOUT. Ask about too few and films stay
 *     characterless; re-ask an answered title every launch and the app taxes
 *     TheTVDB for ever on a settled question.
 *  2. A MISS IS REMEMBERED, A NETWORK FAILURE IS NOT. One flight in aeroplane
 *     mode must not stamp `tvdbTried` across a 546-film library and give up on
 *     all of it.
 *  3. A GUESS IS NOT STORED. The poll is the only consumer of this id, and a
 *     wrong id shows another film's characters as if they were this one's.
 *
 * The network is not tested; `tvdbMatchMovie` is mocked at its three outcomes,
 * which is the contract this module actually consumes.
 */
import { moviesNeedingTvdbMatch } from './pure';

// ---------------------------------------------------------------------------
// 1. The pure decision
// ---------------------------------------------------------------------------

describe('moviesNeedingTvdbMatch', () => {
  it('asks about an imported film that has no id', () => {
    expect(
      moviesNeedingTvdbMatch([{ name: 'The Shawshank Redemption', year: '1994', tvdbId: null, tvdbTried: 0 }]),
    ).toEqual([{ name: 'The Shawshank Redemption', year: 1994 }]);
  });

  it('leaves a film that already has an id alone', () => {
    // From a search tap, a community-export import, or the release-date pass.
    expect(moviesNeedingTvdbMatch([{ name: 'Dune', year: '2021', tvdbId: 190, tvdbTried: 0 }])).toEqual([]);
  });

  it('never re-asks a film already answered', () => {
    // Plenty of films genuinely are not on TheTVDB. Asking again every launch
    // is pure waste — this is the whole reason for the tvdbTried column.
    expect(moviesNeedingTvdbMatch([{ name: 'Some Short Film', year: null, tvdbId: null, tvdbTried: 1 }])).toEqual([]);
  });

  it('falls back to the WATCH year when the film has no stored year', () => {
    // The year is what makes a generic title resolvable at all: a film cannot
    // predate its own release. See pickMovieMatch.
    expect(
      moviesNeedingTvdbMatch([{ name: 'Scream', year: null, tvdbId: null, tvdbTried: 0, watchedAt: '2023-04-11' }]),
    ).toEqual([{ name: 'Scream', year: 2023 }]);
  });

  it('prefers the stored release year over the watch year', () => {
    expect(
      moviesNeedingTvdbMatch([{ name: 'Scream', year: '1996', tvdbId: null, tvdbTried: 0, watchedAt: '2023-04-11' }]),
    ).toEqual([{ name: 'Scream', year: 1996 }]);
  });

  it('asks with no year rather than not at all', () => {
    expect(moviesNeedingTvdbMatch([{ name: 'Heat', year: null, tvdbId: null, tvdbTried: 0 }])).toEqual([
      { name: 'Heat', year: null },
    ]);
  });

  it('tolerates a missing tvdbTried (rows read before the column existed)', () => {
    expect(moviesNeedingTvdbMatch([{ name: 'Heat', year: '1995', tvdbId: null }])).toEqual([
      { name: 'Heat', year: 1995 },
    ]);
  });

  it('asks once per title', () => {
    expect(
      moviesNeedingTvdbMatch([
        { name: 'Heat', year: '1995', tvdbId: null, tvdbTried: 0 },
        { name: 'Heat', year: '1995', tvdbId: null, tvdbTried: 0 },
      ]),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. What gets remembered
// ---------------------------------------------------------------------------

/** name → id written. */
const stored = new Map<string, number>();
/** names stamped as answered-with-no-id. */
let tried: string[] = [];
/** What the fake TheTVDB says, per title. */
let answers = new Map<
  string,
  { status: 'ok'; tvdbId: number; guessed: boolean } | { status: 'none' } | { status: 'failed' }
>();
let rows: { name: string; year: string | null; tvdbId: number | null; tvdbTried: number }[] = [];

jest.mock('@/db', () => ({
  getMoviesMissingTvdbId: () => rows,
  setMovieTvdbId: (name: string, tvdbId: number) => {
    stored.set(name, tvdbId);
    tried.push(name);
  },
  markMovieTvdbTried: (name: string) => {
    tried.push(name);
  },
}));

jest.mock('@/tvdb', () => ({
  tvdbMatchMovie: async (name: string) => answers.get(name) ?? { status: 'failed' },
}));

describe('backfillMovieTvdbIds', () => {
  beforeEach(() => {
    stored.clear();
    tried = [];
    answers = new Map();
    rows = [];
  });

  const run = async () => {
    const { backfillMovieTvdbIds } = await import('./movie-tvdb-match');
    await backfillMovieTvdbIds();
  };

  it('stores a CONFIDENT match — the id the poll needs', async () => {
    rows = [{ name: 'The Shawshank Redemption', year: '1994', tvdbId: null, tvdbTried: 0 }];
    answers.set('The Shawshank Redemption', { status: 'ok', tvdbId: 190, guessed: false });
    await run();
    expect(stored.get('The Shawshank Redemption')).toBe(190);
  });

  it('a DEFINITIVE miss marks tvdbTried and stores nothing', async () => {
    // TheTVDB answered: no film by that name. That answer will never change.
    rows = [{ name: 'A Home Video', year: null, tvdbId: null, tvdbTried: 0 }];
    answers.set('A Home Video', { status: 'none' });
    await run();
    expect(tried).toEqual(['A Home Video']);
    expect(stored.size).toBe(0);
  });

  it('a NETWORK failure marks nothing at all', async () => {
    // The asymmetry the whole feature rests on.
    rows = [{ name: 'The Shawshank Redemption', year: '1994', tvdbId: null, tvdbTried: 0 }];
    answers.set('The Shawshank Redemption', { status: 'failed' });
    await run();
    expect(tried).toEqual([]);
    expect(stored.size).toBe(0);
  });

  it('a whole batch failing offline leaves every film retryable', async () => {
    rows = [
      { name: 'Heat', year: null, tvdbId: null, tvdbTried: 0 },
      { name: 'Dune', year: null, tvdbId: null, tvdbTried: 0 },
      { name: 'Scream', year: null, tvdbId: null, tvdbTried: 0 },
    ];
    // no answers registered at all → every lookup 'failed'
    await run();
    expect(tried).toEqual([]);
    expect(stored.size).toBe(0);
  });

  it('a GUESSED match is NOT stored — but is remembered', async () => {
    // pickMovieMatch had several exact-name hits and broke the tie by
    // inference. The poll is the only consumer of this id, so storing a guess
    // means showing another film's characters as if they were this one's —
    // worse than showing none. tvdbTried is still set: TheTVDB answered, and
    // re-asking returns the same ambiguity next launch.
    rows = [{ name: 'Frozen', year: null, tvdbId: null, tvdbTried: 0 }];
    answers.set('Frozen', { status: 'ok', tvdbId: 12345, guessed: true });
    await run();
    expect(stored.size).toBe(0);
    expect(tried).toEqual(['Frozen']);
  });

  it('does nothing, and asks nothing, once every film is answered', async () => {
    rows = [{ name: 'A Home Video', year: null, tvdbId: null, tvdbTried: 1 }];
    await run();
    expect(tried).toEqual([]);
    expect(stored.size).toBe(0);
  });
});
