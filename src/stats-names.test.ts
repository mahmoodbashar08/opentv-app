/**
 * The stats cards name a show from the LIBRARY ROW first and DROP what nothing
 * can name — never print its id. On 9 Oct "Most voted rating per show" read
 * `9900004` on an iPad: the title was in the `shows` table all along, and the
 * card only ever asked the bundled metadata and the demo seed. `showNameForStats`
 * holds the rule; this checks every card is actually wired through it.
 */
import { registerShowMeta, type ShowMeta } from '@/metadata';
import { computeCrowdCompare, computeDeepStats, computeShowStats } from '@/stats-calc';

jest.mock('@/db', () => {
  // Four shows, one per case: a title only the library row knows; a title only
  // the cached metadata knows (registered below); a row named by its own id,
  // which is what `ensureShowTracked` writes when it has nothing better; and
  // nothing anywhere.
  const watches = [
    { showId: 9900004, watchedAt: '2026-03-01 20:00:00', runtime: 1500 },
    { showId: 9900004, watchedAt: '2026-03-01 21:00:00', runtime: 1500 },
    { showId: 9900004, watchedAt: '2026-03-01 22:00:00', runtime: 1500 },
    { showId: 900101, watchedAt: '2026-03-02 20:00:00', runtime: 2700 },
    { showId: 900101, watchedAt: '2026-03-02 21:00:00', runtime: 2700 },
    { showId: 7777, watchedAt: '2026-03-03 20:00:00', runtime: 1500 },
    { showId: 8888, watchedAt: '2026-03-04 20:00:00', runtime: 1500 },
  ];
  const ratings = [
    { showId: 9900004, stars: 5, at: '2026-03-01 20:00:00' },
    { showId: 9900004, stars: 5, at: '2026-03-01 21:00:00' },
    { showId: 900101, stars: 4, at: '2026-03-02 20:00:00' },
    { showId: 7777, stars: 3, at: '2026-03-03 20:00:00' },
    { showId: 8888, stars: 2, at: '2026-03-04 20:00:00' },
  ];
  const shows = [
    { tvdbId: 9900004, name: 'Hidden Gem' },
    { tvdbId: 900101, name: '' },
    { tvdbId: 7777, name: '7777' },
  ];
  const getAllSync = (sql: string) => {
    if (sql.includes('FROM watches ORDER BY watchedAt')) return watches;
    if (sql.startsWith('SELECT showId, stars FROM episode_ratings')) return ratings;
    if (sql.includes('r.stars AS stars')) return ratings; // the dated join
    if (sql.includes('SELECT tvdbId FROM shows')) return shows.map((s) => ({ tvdbId: s.tvdbId }));
    return [];
  };
  return {
    __esModule: true,
    default: { getAllSync, getFirstSync: () => null },
    getShowNames: () => shows,
    getTotals: () => ({ episodes: watches.length, shows: shows.length, minutes: 0 }),
    getMovieTotals: () => ({ watched: 0, minutes: 0 }),
    getMovies: () => [],
    getComments: () => [],
    getCharacterVoteStats: () => ({ total: 0, shows: 0, top: [] }),
    getMeta: () => null,
  };
});
jest.mock('@/library', () => ({ isSeedLibrary: () => false }));

const meta = (over: Partial<ShowMeta>): ShowMeta =>
  ({ tmdbId: 0, fetchedAt: Date.now(), name: null, seasons: {}, episodes: {}, ...over }) as ShowMeta;

beforeAll(() => {
  registerShowMeta(900101, meta({ name: 'Breaking Bad', rating: 9 }));
  // a crowd score and no name: the row must go, not print 7777
  registerShowMeta(7777, meta({ rating: 8 }));
});

describe('Stats → Shows', () => {
  const s = computeShowStats();
  it('most voted rating names the show from the library row and drops the unnameable', () => {
    expect(s.mostVoted.map((v) => v.name)).toEqual(['Hidden Gem']);
    expect(s.mostVoted[0]).toMatchObject({ label: 'Wow', count: 2 });
  });
  it('marathons and badges use the same names', () => {
    expect(s.marathons.map((m) => m.name)).toEqual(['Hidden Gem']);
    expect(s.badges.map((b) => b.show)).toEqual(['Hidden Gem']);
  });
});

describe('Deep Stats', () => {
  it('top shows: library row, then cached metadata, then nothing', () => {
    // by time watched: 2 × 45 min ahead of 3 × 25
    expect(computeDeepStats(null).topShows.map((x) => x.name)).toEqual(['Breaking Bad', 'Hidden Gem']);
  });
  it('you vs the crowd drops a show the metadata can score but not name', () => {
    expect(computeCrowdCompare(null).rows.map((r) => r.name)).toEqual(['Breaking Bad']);
  });
});
