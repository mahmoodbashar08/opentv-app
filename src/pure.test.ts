import {
  foundCsvsMessage,
  listPlaceholderName,
  mergeCustomLists,
  olderThan,
  pickTvdbMovie,
  uniqueListName,
} from './pure';

describe('olderThan (update gate)', () => {
  it('compares dotted versions numerically, not lexically', () => {
    expect(olderThan('1.2', '1.10')).toBe(true); // the classic trap
    expect(olderThan('1.1.7', '1.1.9')).toBe(true);
    expect(olderThan('1.1.9', '1.1.9')).toBe(false); // equal is not older
    expect(olderThan('1.2.0', '1.1.9')).toBe(false);
    expect(olderThan('1.1.10', '1.1.9')).toBe(false); // 10 > 9
  });
});

describe('listPlaceholderName (private lists)', () => {
  it('formats a dated placeholder', () => {
    expect(listPlaceholderName('2024-12-15T00:00:00Z')).toBe('Untitled · Dec 2024');
  });
  it('falls back on a bad date', () => {
    expect(listPlaceholderName('not-a-date')).toBe('Untitled list');
  });
});

describe('uniqueListName', () => {
  it('disambiguates duplicates case-insensitively', () => {
    const used = new Set<string>();
    expect(uniqueListName('Untitled · Dec 2024', used)).toBe('Untitled · Dec 2024');
    expect(uniqueListName('Untitled · Dec 2024', used)).toBe('Untitled · Dec 2024 (2)');
    expect(uniqueListName('untitled · dec 2024', used)).toBe('untitled · dec 2024 (3)'); // (2) is taken too
  });
});

describe('mergeCustomLists (re-import safety)', () => {
  it('keeps user-created lists and drops tombstoned imported ones', () => {
    const imported = [{ name: 'Watchlist' }, { name: 'Avengers' }];
    const userLists = [{ name: 'My Faves', userCreated: true }];
    const tombstones = ['Avengers']; // user deleted the imported "Avengers"
    const out = mergeCustomLists(imported, userLists, tombstones);
    expect(out.map((l) => l.name)).toEqual(['My Faves', 'Watchlist']);
  });
  it('a user list shadows an imported list of the same name', () => {
    const imported = [{ name: 'Avengers' }];
    const userLists = [{ name: 'avengers', userCreated: true }]; // renamed/edited copy
    const out = mergeCustomLists(imported, userLists, []);
    expect(out).toHaveLength(1);
    expect(out[0].userCreated).toBe(true);
  });
});

describe('pickTvdbMovie (safe auto-match)', () => {
  const dune = { tvdb_id: '6187', name: 'Dune: Part One', year: '2021' };
  it('matches an exact name + year', () => {
    expect(pickTvdbMovie([dune, { name: 'Dune', year: '1984' }], 'Dune: Part One', '2021')).toBe(dune);
  });
  it('accepts a single exact-name hit when no year given', () => {
    expect(pickTvdbMovie([dune], 'dune part one')).toBe(dune); // punctuation-insensitive
  });
  it('refuses to guess when multiple exact names and no year-match', () => {
    const a = { name: 'Mother', year: '2009' };
    const b = { name: 'Mother', year: '2017' };
    expect(pickTvdbMovie([a, b], 'Mother')).toBeNull();
    expect(pickTvdbMovie([a, b], 'Mother', '1999')).toBeNull(); // no year matches
  });
  it('never falls back to an arbitrary first result', () => {
    expect(pickTvdbMovie([{ name: 'Something Else', year: '2020' }], 'Dune', '2021')).toBeNull();
  });
});

describe('foundCsvsMessage (import-0 diagnostics)', () => {
  it('lists found csv basenames and ignores __MACOSX', () => {
    const msg = foundCsvsMessage(['export/seen_episode.csv', '__MACOSX/._x.csv', 'notes.txt']);
    expect(msg).toBe('Files found: seen_episode.csv.');
  });
  it('reports when there are no csvs', () => {
    expect(foundCsvsMessage(['a.txt', 'b.json'])).toBe('No CSV files were found inside the ZIP.');
  });
});
