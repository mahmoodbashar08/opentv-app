/**
 * Simkl and Nuvio, the parsing and matching halves (CHANGELOG 2.0.0, item 15).
 *
 * The decision of what gets WRITTEN is `externalWatchesToApply`'s and is
 * pinned in `external-watches.test.ts`; these pin what reaches it — which
 * episodes, keyed how, dated when — and the one guess anywhere in the path,
 * the title match, which must stay narrow enough to be worth confirming.
 * The replies are shaped after api.simkl.org/api-reference/simkl/get-all-items
 * and nuvio.tv/docs/nuvio-public-api.md.
 */
import {
  nuvioContentRef,
  nuvioEpisodesFromRows,
  nuvioMaxEventId,
  simklShowsFromItems,
  simklTitleCandidate,
  watchStampFromIso,
} from './pure';

describe('watchStampFromIso', () => {
  it('writes the date the way markWatched stores it, in UTC', () => {
    expect(watchStampFromIso('2023-10-12T09:03:45Z')).toBe('2023-10-12 09:03:45');
    expect(watchStampFromIso('2023-10-12T11:03:45+02:00')).toBe('2023-10-12 09:03:45');
  });
  it('answers null for no date, so the caller falls back to now', () => {
    expect(watchStampFromIso('')).toBeNull();
    expect(watchStampFromIso(undefined)).toBeNull();
    expect(watchStampFromIso('yesterday-ish')).toBeNull();
  });
});

const showItem = (ids: Record<string, unknown>, seasons: unknown, extra: Record<string, unknown> = {}) => ({
  last_watched_at: '2024-05-01T20:00:00Z',
  status: 'watching',
  show: { title: 'Severance', year: 2022, ids },
  seasons,
  ...extra,
});

describe('simklShowsFromItems', () => {
  it('flattens seasons into episodes, keeping each one its own date', () => {
    const [s] = simklShowsFromItems(
      {
        shows: [
          showItem({ simkl: 1, tvdb: '371980', imdb: 'tt11280740' }, [
            { number: 1, episodes: [{ number: 1, watched_at: '2022-02-18T21:00:00Z' }, { number: 2 }] },
          ]),
        ],
      },
      'shows',
    );
    expect(s.tvdbId).toBe(371980);
    expect(s.imdb).toBe('tt11280740');
    expect(s.year).toBe(2022);
    expect(s.episodes).toEqual([
      { season: 1, episode: 1, watchedAt: '2022-02-18T21:00:00Z' },
      // No date of its own: the show's last_watched_at, as the file import does.
      { season: 1, episode: 2, watchedAt: '2024-05-01T20:00:00Z' },
    ]);
  });

  it('reads a TheTVDB SLUG as no id at all — "int / string" per the docs', () => {
    const [s] = simklShowsFromItems({ shows: [showItem({ simkl: 2, tvdb: 'the-walking-dead' }, [])] }, 'shows');
    expect(s.tvdbId).toBeNull();
  });

  it('accepts the id as a number too', () => {
    expect(simklShowsFromItems({ shows: [showItem({ simkl: 3, tvdb: 81189 }, [])] }, 'shows')[0].tvdbId).toBe(81189);
  });

  it('answers empty for an empty library, which Simkl sends as null', () => {
    expect(simklShowsFromItems(null, 'shows')).toEqual([]);
    expect(simklShowsFromItems({}, 'shows')).toEqual([]);
    expect(simklShowsFromItems({ shows: 'nope' }, 'shows')).toEqual([]);
  });

  it('drops a show with no Simkl id and an episode with no number', () => {
    const out = simklShowsFromItems(
      {
        shows: [
          showItem({ tvdb: '1' }, []),
          showItem({ simkl: 4, tvdb: '2' }, [{ number: 1, episodes: [{ number: null }, { number: 0 }, { number: 3 }] }]),
        ],
      },
      'shows',
    );
    expect(out).toHaveLength(1);
    expect(out[0].episodes.map((e) => e.episode)).toEqual([3]);
  });

  it("numbers anime by TheTVDB's mapping only, never Simkl's absolute numbering", () => {
    const [a] = simklShowsFromItems(
      {
        anime: [
          showItem({ simkl: 5, tvdb: '278626' }, [
            {
              number: 1,
              episodes: [
                { number: 13, tvdb: { season: 2, episode: 1 }, watched_at: '2015-01-06T13:43:26Z' },
                // Unmapped: skipped rather than ticked as S1E14.
                { number: 14 },
              ],
            },
          ]),
        ],
      },
      'anime',
    );
    expect(a.episodes).toEqual([{ season: 2, episode: 1, watchedAt: '2015-01-06T13:43:26Z' }]);
  });
});

describe('simklTitleCandidate', () => {
  const LIBRARY = [
    { tvdbId: 1, name: 'The Office (US)' },
    { tvdbId: 2, name: 'Shameless (2011)' },
    { tvdbId: 3, name: 'Shameless' },
    { tvdbId: 4, name: 'Pokémon' },
    { tvdbId: 5, name: 'Law & Order' },
    { tvdbId: 6, name: 'Doctor Who (2005)' },
  ];

  it('matches one tracked show by name, ignoring case, accents and punctuation', () => {
    expect(simklTitleCandidate('pokemon', null, LIBRARY)?.tvdbId).toBe(4);
    expect(simklTitleCandidate('Law and Order', null, LIBRARY)?.tvdbId).toBe(5);
  });

  it('tells two same-named shows apart only by the year in the library name', () => {
    expect(simklTitleCandidate('Shameless', 2011, LIBRARY)?.tvdbId).toBe(2);
    // No year to decide with: two candidates is no candidate.
    expect(simklTitleCandidate('Shameless', null, LIBRARY)).toBeNull();
  });

  it('refuses a single match whose year contradicts the one Simkl gave', () => {
    expect(simklTitleCandidate('Doctor Who', 1963, LIBRARY)).toBeNull();
    expect(simklTitleCandidate('Doctor Who', 2005, LIBRARY)?.tvdbId).toBe(6);
  });

  it('never offers a show that is merely similar', () => {
    expect(simklTitleCandidate('The Office', null, LIBRARY)).toBeNull();
    expect(simklTitleCandidate('', null, LIBRARY)).toBeNull();
  });
});

describe('Nuvio rows', () => {
  it('keeps series episodes, turns epoch milliseconds into ISO, and drops films', () => {
    const out = nuvioEpisodesFromRows([
      { content_id: 'tt0903747', content_type: 'series', season: 1, episode: 2, watched_at: 1711600000000 },
      { content_id: 'tmdb:550', content_type: 'movie', season: null, episode: null, watched_at: 1711600000000 },
    ]);
    expect(out).toEqual([{ contentId: 'tt0903747', season: 1, episode: 2, watchedAt: '2024-03-28T04:26:40.000Z' }]);
  });

  it('applies upserts from a delta and ignores deletes — this sync only ever adds', () => {
    const events = [
      { event_id: 7, operation: 'upsert', content_id: 'tmdb:1396', content_type: 'series', season: 1, episode: 1, watched_at: 1 },
      { event_id: 9, operation: 'delete', content_id: 'tmdb:1396', content_type: 'series', season: 1, episode: 2, watched_at: 1 },
    ];
    expect(nuvioEpisodesFromRows(events).map((e) => e.episode)).toEqual([1]);
    expect(nuvioMaxEventId(events, 3)).toBe(9);
    // An empty page never moves the cursor backwards.
    expect(nuvioMaxEventId([], 12)).toBe(12);
  });

  it('survives whatever a changed API sends instead of an array', () => {
    expect(nuvioEpisodesFromRows({ code: 'PGRST202' })).toEqual([]);
    expect(nuvioEpisodesFromRows(null)).toEqual([]);
    expect(nuvioEpisodesFromRows([null, { content_type: 'series' }])).toEqual([]);
    expect(nuvioMaxEventId('x', 5)).toBe(5);
  });

  it('reads IMDb and TMDB content ids, and nothing it cannot look up', () => {
    expect(nuvioContentRef('tt0903747')).toEqual({ imdb: 'tt0903747' });
    expect(nuvioContentRef('tmdb:1396')).toEqual({ tmdb: 1396 });
    expect(nuvioContentRef('kitsu:42')).toBeNull();
    expect(nuvioContentRef('tmdb:')).toBeNull();
  });
});
