import {
  airCountdown,
  foundCsvsMessage,
  hasValue,
  listPlaceholderName,
  mergeCustomLists,
  mergeEnrichment,
  olderThan,
  pickTvdbMovie,
  preferred,
  reversalMoves,
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

describe('hasValue (field-presence rule)', () => {
  it('treats null and undefined as absent', () => {
    expect(hasValue(null)).toBe(false);
    expect(hasValue(undefined)).toBe(false);
  });
  it('treats empty and whitespace strings as absent — TMDB returns "" not null', () => {
    expect(hasValue('')).toBe(false);
    expect(hasValue('   ')).toBe(false);
    expect(hasValue('Dune')).toBe(true);
  });
  it('treats empty arrays as absent', () => {
    expect(hasValue([])).toBe(false);
    expect(hasValue(['Drama'])).toBe(true);
  });
  it('treats 0 as present — a rating of 0 is a real value', () => {
    expect(hasValue(0)).toBe(true);
  });
});

describe('preferred (TMDB first, TheTVDB fallback)', () => {
  it('takes the primary when it has a value', () => {
    expect(preferred('TMDB overview', 'TVDB overview')).toBe('TMDB overview');
  });
  it('falls back when the primary is empty', () => {
    expect(preferred('', 'TVDB overview')).toBe('TVDB overview');
    expect(preferred(null, 'TVDB overview')).toBe('TVDB overview');
  });
  it('returns null when neither has a value', () => {
    expect(preferred(null, '')).toBe(null);
  });
});

describe('mergeEnrichment', () => {
  type Meta = { name: string | null; backdrop: string | null; genres: string[] };
  it('fills each field independently, not all-or-nothing', () => {
    const tmdb: Partial<Meta> = { name: 'Jujutsu Kaisen', backdrop: null, genres: [] };
    const tvdb: Partial<Meta> = { name: 'Jujutsu Kaisen (TVDB)', backdrop: '/tvdb.jpg', genres: ['Anime'] };
    expect(mergeEnrichment(tmdb, tvdb, ['name', 'backdrop', 'genres'])).toEqual({
      name: 'Jujutsu Kaisen',
      backdrop: '/tvdb.jpg',
      genres: ['Anime'],
    });
  });
  it('yields a complete record when TMDB has nothing at all', () => {
    const tvdb: Partial<Meta> = { name: 'Al Rowwad', backdrop: '/t.jpg', genres: ['Documentary'] };
    expect(mergeEnrichment({}, tvdb, ['name', 'backdrop', 'genres'])).toEqual(tvdb);
  });
  it('omits keys neither side has, rather than writing nulls', () => {
    expect(mergeEnrichment({}, {}, ['name'])).toEqual({});
  });
});

describe('reversalMoves (undo the TMDB remap)', () => {
  it('moves each row from its TMDB position back to its TheTVDB one', () => {
    expect(reversalMoves({ '1-26': '2-1', '1-27': '2-2' })).toEqual([
      { from: '1-26', to: '2-1' },
      { from: '1-27', to: '2-2' },
    ]);
  });
  it('skips entries that never actually moved', () => {
    expect(reversalMoves({ '3-4': '3-4' })).toEqual([]);
  });
  it('ignores malformed keys rather than producing NaN positions', () => {
    expect(reversalMoves({ bad: '2-1', '1-5': 'worse' })).toEqual([]);
  });
  it('returns nothing for an empty log', () => {
    expect(reversalMoves({})).toEqual([]);
  });
});

describe('airCountdown (unaired episodes)', () => {
  const now = Date.UTC(2026, 6, 26, 15, 0); // 26 Jul 2026, mid-afternoon

  it('returns null for an episode that already aired', () => {
    expect(airCountdown('2026-07-25', now)).toBe(null);
  });
  it('returns null for one airing earlier the same day — it is released', () => {
    expect(airCountdown('2026-07-26', now)).toBe(null);
  });
  it('names tomorrow rather than counting to 1', () => {
    expect(airCountdown('2026-07-27', now)).toBe('Tomorrow');
  });
  it('counts days within the month', () => {
    expect(airCountdown('2026-07-31', now)).toBe('in 5 days');
    expect(airCountdown('2026-08-20', now)).toBe('in 25 days');
  });
  it('switches to months, then years, so a 2028 premiere is not "in 700 days"', () => {
    expect(airCountdown('2026-10-26', now)).toBe('in 3 months');
    expect(airCountdown('2028-07-26', now)).toBe('in 2 years');
  });
  it('returns null for a missing or unparseable date', () => {
    expect(airCountdown(null, now)).toBe(null);
    expect(airCountdown('', now)).toBe(null);
    expect(airCountdown('TBA', now)).toBe(null);
  });
  it('accepts a full timestamp, not just a bare date', () => {
    expect(airCountdown('2026-07-28T20:00:00Z', now)).toBe('in 2 days');
  });
});
