/**
 * The filter engine. A filter that silently drops a title is the worst bug
 * this feature can have, so the matcher gets the hardest look -- starting with
 * the property everything else rests on: nothing selected returns everything.
 */
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  filterOptions,
  isDefaultFilters,
  matchesFilters,
  normaliseFilterSet,
  parseFilterSet,
  parsePresets,
  runtimeBand,
  sameFilters,
  serialisePresets,
  toggleAxis,
  upsertPreset,
  type FilterPreset,
  type FilterSet,
  type TitleFacts,
} from './pure';

const facts = (over: Partial<TitleFacts> & { key: string }): TitleFacts => ({
  progress: 'watching',
  genres: [],
  network: null,
  decade: null,
  runtime: null,
  watchedYears: [],
  stars: null,
  ...over,
});

const set = (over: Partial<FilterSet> = {}): FilterSet => ({ ...DEFAULT_FILTERS, ...over });

const LIBRARY: TitleFacts[] = [
  facts({
    key: 'sopranos',
    progress: 'finished',
    genres: ['Drama', 'Crime'],
    network: 'HBO',
    decade: '1990s',
    runtime: 'long',
    watchedYears: ['2024', '2025'],
    stars: 5,
  }),
  facts({
    key: 'friends',
    progress: 'upToDate',
    genres: ['Comedy'],
    network: 'NBC',
    decade: '1990s',
    runtime: 'short',
    watchedYears: ['2025'],
    stars: 3,
  }),
  facts({
    key: 'severance',
    progress: 'watching',
    genres: ['Drama', 'Sci-Fi'],
    network: 'Apple TV+',
    decade: '2020s',
    runtime: 'standard',
    watchedYears: ['2026'],
    stars: null,
  }),
  facts({
    key: 'unknown',
    progress: 'notStarted',
    genres: [],
    network: null,
    decade: null,
    runtime: null,
    watchedYears: [],
    stars: null,
  }),
];

const kept = (s: FilterSet): string[] => LIBRARY.filter((f) => matchesFilters(f, s)).map((f) => f.key);

describe('matchesFilters', () => {
  /** THE property. Every other test is a narrowing of this one. */
  it('returns everything when nothing is selected', () => {
    expect(kept(DEFAULT_FILTERS)).toEqual(['sopranos', 'friends', 'severance', 'unknown']);
    for (const f of LIBRARY) expect(matchesFilters(f, DEFAULT_FILTERS)).toBe(true);
  });

  it('keeps a title with no metadata at all until an axis asks about it', () => {
    // the show with no genres/network/decade must not vanish from an unfiltered
    // library just because the metadata fetch has not happened yet
    expect(kept(set())).toContain('unknown');
    expect(kept(set({ genres: ['Drama'] }))).not.toContain('unknown');
  });

  it('ORs inside an axis', () => {
    expect(kept(set({ genres: ['Comedy', 'Sci-Fi'] }))).toEqual(['friends', 'severance']);
    expect(kept(set({ progress: ['finished', 'notStarted'] }))).toEqual(['sopranos', 'unknown']);
  });

  it('ANDs across axes', () => {
    expect(kept(set({ genres: ['Drama'], decades: ['1990s'] }))).toEqual(['sopranos']);
    expect(kept(set({ genres: ['Drama'], decades: ['1990s'], networks: ['NBC'] }))).toEqual([]);
  });

  it('matches a genre when the title carries any of the chosen ones', () => {
    expect(kept(set({ genres: ['Crime'] }))).toEqual(['sopranos']);
  });

  it('filters on network, decade, runtime band and watched year', () => {
    expect(kept(set({ networks: ['HBO', 'NBC'] }))).toEqual(['sopranos', 'friends']);
    expect(kept(set({ decades: ['2020s'] }))).toEqual(['severance']);
    expect(kept(set({ runtimes: ['short', 'long'] }))).toEqual(['sopranos', 'friends']);
    expect(kept(set({ years: ['2024'] }))).toEqual(['sopranos']);
    expect(kept(set({ years: ['2025'] }))).toEqual(['sopranos', 'friends']);
  });

  describe('your own rating', () => {
    it('null means the axis is off', () => {
      expect(kept(set({ rating: null })).length).toBe(4);
    });

    it('0 means unrated only', () => {
      expect(kept(set({ rating: 0 }))).toEqual(['severance', 'unknown']);
    });

    it('n means rated at least n, and never includes the unrated', () => {
      expect(kept(set({ rating: 3 }))).toEqual(['sopranos', 'friends']);
      expect(kept(set({ rating: 4 }))).toEqual(['sopranos']);
      expect(kept(set({ rating: 5 }))).toEqual(['sopranos']);
    });
  });

  it('sort alone never removes a title', () => {
    for (const sort of ['lastWatched', 'lastAdded', 'alpha'] as const) {
      expect(kept(set({ sort }))).toHaveLength(LIBRARY.length);
    }
  });

  it('never keeps a title an axis excludes, however many other axes agree', () => {
    // the trap this guards: an OR leaking across axes and letting a title back
    // in because it matched a different section
    expect(kept(set({ genres: ['Comedy'], networks: ['HBO'] }))).toEqual([]);
  });
});

describe('runtimeBand', () => {
  it('bands episodes on the half-hour / hour / prestige-hour split', () => {
    expect(runtimeBand(22, 'show')).toBe('short');
    expect(runtimeBand(25, 'show')).toBe('short');
    expect(runtimeBand(26, 'show')).toBe('standard');
    expect(runtimeBand(45, 'show')).toBe('standard');
    expect(runtimeBand(58, 'show')).toBe('long');
  });

  it('bands films on whether they fit in an evening', () => {
    expect(runtimeBand(89, 'movie')).toBe('short');
    expect(runtimeBand(90, 'movie')).toBe('standard');
    expect(runtimeBand(150, 'movie')).toBe('standard');
    expect(runtimeBand(151, 'movie')).toBe('long');
  });

  it('refuses to guess when there is no runtime', () => {
    expect(runtimeBand(null, 'show')).toBeNull();
    expect(runtimeBand(undefined, 'movie')).toBeNull();
    expect(runtimeBand(0, 'show')).toBeNull();
    expect(runtimeBand(-1, 'show')).toBeNull();
  });
});

describe('filterOptions', () => {
  const opts = (s: FilterSet = DEFAULT_FILTERS) => filterOptions(LIBRARY, s, 'show');

  it('offers only what the library actually has', () => {
    expect(opts().genres.map((o) => o.value).sort()).toEqual(['Comedy', 'Crime', 'Drama', 'Sci-Fi']);
    expect(opts().networks.map((o) => o.value)).toEqual(['Apple TV+', 'HBO', 'NBC']);
  });

  it('counts titles, so a two-genre show is counted under both', () => {
    const genres = new Map(opts().genres.map((o) => [o.value, o.count]));
    expect(genres.get('Drama')).toBe(2);
    expect(genres.get('Comedy')).toBe(1);
  });

  it('leaves an axis empty when nothing carries it, so the sheet can hide it', () => {
    const bare = [facts({ key: 'a' }), facts({ key: 'b' })];
    const o = filterOptions(bare, DEFAULT_FILTERS, 'show');
    expect(o.genres).toEqual([]);
    expect(o.networks).toEqual([]);
    expect(o.decades).toEqual([]);
    expect(o.years).toEqual([]);
    expect(o.runtimes).toEqual([]);
    expect(o.ratings).toEqual([{ value: 'unrated', count: 2 }]);
  });

  it('counts are faceted: other axes apply, this one does not', () => {
    // with Drama chosen, the genre counts still show what ADDING a genre gives
    const o = opts(set({ genres: ['Drama'] }));
    expect(new Map(o.genres.map((g) => [g.value, g.count])).get('Comedy')).toBe(1);
    // ...while the network counts are narrowed to the two Drama shows
    expect(o.networks.map((n) => n.value).sort()).toEqual(['Apple TV+', 'HBO']);
  });

  it('rating options are cumulative, and unrated is its own bucket', () => {
    const r = new Map(opts().ratings.map((o) => [o.value, o.count]));
    expect(r.get('unrated')).toBe(2);
    expect(r.get('3')).toBe(2); // 3 and 5
    expect(r.get('5')).toBe(1);
    expect(r.get('4')).toBe(1);
  });

  it('orders progress by the pipeline, not by count', () => {
    expect(opts().progress.map((o) => o.value)).toEqual(['watching', 'notStarted', 'upToDate', 'finished']);
  });

  it('orders years and decades newest first', () => {
    expect(opts().years.map((o) => o.value)).toEqual(['2026', '2025', '2024']);
    expect(opts().decades.map((o) => o.value)).toEqual(['2020s', '1990s']);
  });

  it('offers movie progress values on the movies sheet', () => {
    const films = [facts({ key: 'a', progress: 'watched' }), facts({ key: 'b', progress: 'notWatched' })];
    expect(filterOptions(films, DEFAULT_FILTERS, 'movie').progress.map((o) => o.value)).toEqual([
      'watched',
      'notWatched',
    ]);
  });

  it('every offered option leaves at least one title, and exactly its count', () => {
    // the promise the sheet makes: tapping a chip labelled 3 leaves 3
    const o = opts();
    for (const g of o.genres) expect(kept(set({ genres: [g.value] })).length).toBe(g.count);
    for (const n of o.networks) expect(kept(set({ networks: [n.value] })).length).toBe(n.count);
    for (const y of o.years) expect(kept(set({ years: [y.value] })).length).toBe(y.count);
  });
});

describe('toggleAxis / activeFilterCount', () => {
  it('adds then removes', () => {
    const one = toggleAxis(DEFAULT_FILTERS, 'genres', 'Drama');
    expect(one.genres).toEqual(['Drama']);
    expect(toggleAxis(one, 'genres', 'Drama').genres).toEqual([]);
  });

  it('never mutates the set it was given', () => {
    const before = set();
    toggleAxis(before, 'genres', 'Drama');
    expect(before.genres).toEqual([]);
  });

  it('counts the axes that are narrowing, sort excluded', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount(set({ sort: 'alpha' }))).toBe(0);
    expect(activeFilterCount(set({ genres: ['Drama'], years: ['2025'] }))).toBe(2);
    expect(activeFilterCount(set({ rating: 0 }))).toBe(1);
  });

  it('knows the untouched set, sort included', () => {
    expect(isDefaultFilters(DEFAULT_FILTERS)).toBe(true);
    expect(isDefaultFilters(set({ sort: 'alpha' }))).toBe(false);
    expect(isDefaultFilters(set({ rating: 0 }))).toBe(false);
  });

  it('compares two sets regardless of the order things were tapped in', () => {
    const a = set({ genres: ['Drama', 'Comedy'] });
    const b = set({ genres: ['Comedy', 'Drama'] });
    expect(sameFilters(a, b)).toBe(true);
    expect(sameFilters(a, set({ genres: ['Drama'] }))).toBe(false);
    expect(sameFilters(a, { ...a, sort: 'alpha' })).toBe(false);
  });
});

describe('reading filters back off disk', () => {
  it('round-trips', () => {
    const s = set({ genres: ['Drama'], rating: 4, runtimes: ['long'], sort: 'alpha' });
    expect(parseFilterSet(JSON.stringify(s))).toEqual(s);
  });

  it('falls back to the defaults rather than throwing', () => {
    // a corrupt meta row must not be able to make the library unopenable
    expect(parseFilterSet('not json')).toEqual(DEFAULT_FILTERS);
    expect(parseFilterSet(null)).toEqual(DEFAULT_FILTERS);
    expect(parseFilterSet('')).toEqual(DEFAULT_FILTERS);
    expect(normaliseFilterSet(42)).toEqual(DEFAULT_FILTERS);
  });

  it('drops values a newer build wrote and this one cannot honour', () => {
    const s = normaliseFilterSet({ sort: 'byVibes', rating: 9, runtimes: ['epic', 'long'], genres: ['Drama', 7] });
    expect(s.sort).toBe('lastWatched');
    expect(s.rating).toBeNull();
    expect(s.runtimes).toEqual(['long']);
    expect(s.genres).toEqual(['Drama']);
  });

  it('keeps "unrated only", which is rating 0 and not "no rating filter"', () => {
    expect(normaliseFilterSet({ rating: 0 }).rating).toBe(0);
  });
});

describe('presets', () => {
  const preset = (id: string, name: string): FilterPreset => ({
    id,
    name,
    kind: 'show',
    filters: set({ genres: ['Anime'] }),
  });

  it('round-trips through JSON', () => {
    const list = [preset('1', 'Comfort rewatches'), preset('2', 'Unfinished anime')];
    expect(parsePresets(serialisePresets(list))).toEqual(list);
  });

  it('survives junk without taking the sheet down with it', () => {
    expect(parsePresets(null)).toEqual([]);
    expect(parsePresets('{')).toEqual([]);
    expect(parsePresets('{"not":"an array"}')).toEqual([]);
    expect(parsePresets('[null, 3, {"id":"1"}, {"name":"  "}]')).toEqual([]);
  });

  it('repairs a preset whose filters are half-written', () => {
    const [p] = parsePresets('[{"id":"1","name":"Old","kind":"show"}]');
    expect(p.filters).toEqual(DEFAULT_FILTERS);
  });

  it('defaults an unknown kind to shows rather than dropping the preset', () => {
    expect(parsePresets('[{"id":"1","name":"X","kind":"podcast"}]')[0].kind).toBe('show');
  });

  it('upsert replaces in place, so renaming keeps its position', () => {
    const list = [preset('1', 'A'), preset('2', 'B')];
    const renamed = upsertPreset(list, { ...preset('1', 'A2') });
    expect(renamed.map((p) => p.name)).toEqual(['A2', 'B']);
    expect(upsertPreset(list, preset('3', 'C')).map((p) => p.name)).toEqual(['A', 'B', 'C']);
  });
});
