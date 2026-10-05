import { addSearchHistory, removeSearchHistory, resolveMovieRow, SEARCH_HISTORY_MAX, type SearchHistoryEntry } from '@/pure';

const E = (kind: SearchHistoryEntry['kind'], value: string, label = value): SearchHistoryEntry => ({
  kind,
  label,
  value,
  at: '2026-08-03T00:00:00.000Z',
});

describe('addSearchHistory', () => {
  it('puts the newest first', () => {
    const h = addSearchHistory(addSearchHistory([], E('query', 'dune')), E('query', 'severance'));
    expect(h.map((x) => x.value)).toEqual(['severance', 'dune']);
  });

  it('moves a repeat to the front instead of duplicating it', () => {
    let h = addSearchHistory([], E('query', 'dune'));
    h = addSearchHistory(h, E('query', 'severance'));
    h = addSearchHistory(h, E('query', 'dune'));
    expect(h.map((x) => x.value)).toEqual(['dune', 'severance']);
  });

  it('keeps a film and a query of the same word apart', () => {
    // Two different things to want back — collapsing them loses one.
    let h = addSearchHistory([], E('query', 'dune'));
    h = addSearchHistory(h, E('movie', 'dune', 'Dune'));
    expect(h).toHaveLength(2);
  });

  it('caps the list so a search screen stays a search screen', () => {
    let h: SearchHistoryEntry[] = [];
    for (let i = 0; i < SEARCH_HISTORY_MAX + 5; i++) h = addSearchHistory(h, E('query', `q${i}`));
    expect(h).toHaveLength(SEARCH_HISTORY_MAX);
    expect(h[0].value).toBe(`q${SEARCH_HISTORY_MAX + 4}`);
  });

  it('refuses a blank label or value rather than storing an unopenable row', () => {
    expect(addSearchHistory([], E('query', '   ', '   '))).toEqual([]);
    expect(addSearchHistory([], { ...E('show', ''), label: 'Severance' })).toEqual([]);
  });

  it('trims the label it stores', () => {
    expect(addSearchHistory([], E('query', 'dune', '  dune  '))[0].label).toBe('dune');
  });
});

describe('removeSearchHistory', () => {
  it('drops one entry and leaves its namesake of another kind', () => {
    let h = addSearchHistory([], E('query', 'dune'));
    h = addSearchHistory(h, E('movie', 'dune', 'Dune'));
    const after = removeSearchHistory(h, 'query', 'dune');
    expect(after.map((x) => x.kind)).toEqual(['movie']);
  });

  it('is a no-op for something that was never there', () => {
    const h = addSearchHistory([], E('query', 'dune'));
    expect(removeSearchHistory(h, 'query', 'nope')).toHaveLength(1);
  });
});

/*
 * THE RECENT ROW THAT OPENED THE WRONG FILM.
 *
 * Two remembered films, one titled "Ghost in the Shell" and one titled
 * "THE GHOST IN THE SHELL" carrying the other as its original title. Tapping
 * the first opened the second, because the recent row pushed a NAME and
 * nothing else, and a name legitimately matches both rows -- so the first row
 * in the array won.
 */
describe('a remembered film reopens that film', () => {
  const ROWS = [
    { tmdbId: 1234, name: 'THE GHOST IN THE SHELL', originalName: 'Ghost in the Shell', year: '2017' },
    { tmdbId: 9323, name: 'Ghost in the Shell', originalName: null, year: '1995' },
  ];

  it('picks the wrong row on a bare name — which is why the entry carries ids', () => {
    expect(resolveMovieRow({ tmdbId: null, name: 'Ghost in the Shell' }, ROWS)?.tmdbId).toBe(1234);
  });

  it('picks the right row once the remembered id comes along', () => {
    expect(resolveMovieRow({ tmdbId: 9323, name: 'Ghost in the Shell' }, ROWS)?.tmdbId).toBe(9323);
  });

  it('keeps the identity through a round trip into history', () => {
    const h = addSearchHistory([], {
      kind: 'movie',
      label: 'Ghost in the Shell',
      value: 'Ghost in the Shell',
      tmdbId: 9323,
      year: '1995',
      at: '2026-09-23T00:00:00.000Z',
    });
    expect(resolveMovieRow({ tmdbId: h[0].tmdbId ?? null, name: h[0].value, year: h[0].year }, ROWS)?.tmdbId).toBe(9323);
  });
});
