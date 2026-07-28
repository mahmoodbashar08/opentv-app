import {
  airCountdown,
  disambiguatedMovieName,
  effectiveEpisodesSeen,
  episodeKey,
  mayFoldDuplicateShow,
  pickMovieMatch,
  v1WatchIsStale,
  shouldBulkFill,
  artworkUrl,
  canFoldMovie,
  foundCsvsMessage,
  hasValue,
  listPlaceholderName,
  mergeCustomLists,
  mergeEnrichment,
  movieBaseName,
  movieYearOf,
  olderThan,
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

describe('movieBaseName', () => {
  it('strips a trailing year and normalises', () => {
    expect(movieBaseName('Dune (2021)')).toBe('dune');
    expect(movieBaseName('  Dune  ')).toBe('dune');
    expect(movieBaseName('The  Batman')).toBe('the batman');
  });
  it('leaves a year that is part of the real title alone', () => {
    expect(movieBaseName('2001: A Space Odyssey')).toBe('2001: a space odyssey');
    expect(movieBaseName('Blade Runner 2049')).toBe('blade runner 2049');
  });
});

describe('movieYearOf', () => {
  it('prefers the stored column', () => {
    expect(movieYearOf('Dune', '2021')).toBe('2021');
  });
  it('falls back to the title suffix', () => {
    expect(movieYearOf('Dune (2021)', null)).toBe('2021');
    expect(movieYearOf('Dune (2021)', '  ')).toBe('2021');
  });
  it('returns null when neither says', () => {
    expect(movieYearOf('Dune', null)).toBe(null);
    expect(movieYearOf('Blade Runner 2049', null)).toBe(null);
  });
});

describe('canFoldMovie (duplicate watched/watchlist rows)', () => {
  it('folds the bare watchlist copy into the imported watched one', () => {
    expect(canFoldMovie({ name: 'Dune (2021)', year: '2021' }, { name: 'Dune', year: null })).toBe(true);
  });
  it('NEVER folds two different years — remakes are different films', () => {
    expect(canFoldMovie({ name: 'Dune (1984)' }, { name: 'Dune (2021)' })).toBe(false);
    expect(canFoldMovie({ name: 'Dune', year: '1984' }, { name: 'Dune', year: '2021' })).toBe(false);
  });
  it('folds identical years', () => {
    expect(canFoldMovie({ name: 'Dune (2021)' }, { name: 'Dune', year: '2021' })).toBe(true);
  });
  it('refuses unrelated titles', () => {
    expect(canFoldMovie({ name: 'Dune (2021)' }, { name: 'Arrival (2016)' })).toBe(false);
  });
});

describe('artworkUrl (TheTVDB image paths)', () => {
  it('adds the host to a relative path', () => {
    // the /eng translated endpoints return paths, not URLs — losing the host
    // is why every episode still rendered blank
    expect(artworkUrl('/banners/v4/episode/8414132/screencap/62517d9a946fe.jpg')).toBe(
      'https://artworks.thetvdb.com/banners/v4/episode/8414132/screencap/62517d9a946fe.jpg',
    );
  });
  it('leaves an absolute URL alone', () => {
    const abs = 'https://artworks.thetvdb.com/banners/v4/series/377543/posters/x.jpg';
    expect(artworkUrl(abs)).toBe(abs);
  });
  it('leaves a TMDB URL alone', () => {
    const t = 'https://image.tmdb.org/t/p/w500/abc.jpg';
    expect(artworkUrl(t)).toBe(t);
  });
  it('passes through null and empty', () => {
    expect(artworkUrl(null)).toBe(null);
    expect(artworkUrl('')).toBe(null);
    expect(artworkUrl(undefined)).toBe(null);
  });
  it('handles a path with no leading slash', () => {
    expect(artworkUrl('banners/v4/x.jpg')).toBe('https://artworks.thetvdb.com/banners/v4/x.jpg');
  });
});

describe('shouldBulkFill (never fabricate watch history)', () => {
  it('refuses when the export\'s own watch count matches the rows it listed', () => {
    // Haikyu!!: 1 real row, count-watch 1, nb_episodes_seen 84 — the counter
    // is lying and filling from it invented 83 episodes
    expect(shouldBulkFill(1, 84, 1)).toBe(false);
    // Madan Senki Ryukendo: same shape, 51 invented
    expect(shouldBulkFill(1, 52, 1)).toBe(false);
  });

  it('still rebuilds a genuine bulk-mark, where the counter is corroborated', () => {
    // TV Time recorded the marking but not the individual episodes
    expect(shouldBulkFill(1, 84, 84)).toBe(true);
    expect(shouldBulkFill(0, 40, 40)).toBe(true);
  });

  it('rebuilds when there is no cross-check at all', () => {
    expect(shouldBulkFill(1, 84, null)).toBe(true);
    expect(shouldBulkFill(0, 30, undefined)).toBe(true);
  });

  it('never touches a show with a real row history', () => {
    // 64 rows against a counter of 66 — the surplus is rewatch inflation
    expect(shouldBulkFill(64, 66, 16)).toBe(false);
    expect(shouldBulkFill(3, 500, null)).toBe(false);
  });

  it('ignores a counter that is barely above the rows', () => {
    // too small a gap to be a bulk mark; likely a rewatch or a stray
    expect(shouldBulkFill(1, 5, null)).toBe(false);
    expect(shouldBulkFill(0, 7, null)).toBe(false);
    expect(shouldBulkFill(0, 8, null)).toBe(true); // the documented threshold
  });
});

describe('v1WatchIsStale (legacy tracking file)', () => {
  it('drops a v1 row for a show TV Time left out of v2', () => {
    // Haikyu!!: one 2021 fill-previous row, nothing in v2's 1,095 rows
    expect(v1WatchIsStale(false, true)).toBe(true);
  });
  it('keeps v1 rows for a show that also appears in v2', () => {
    expect(v1WatchIsStale(true, true)).toBe(false);
  });
  it('trusts v1 completely when the export has no v2 episodes at all', () => {
    // an old export, or one TV Time never migrated — v1 is the only record
    expect(v1WatchIsStale(false, false)).toBe(false);
    expect(v1WatchIsStale(true, false)).toBe(false);
  });
});

describe('pickMovieMatch (movie titles with no year)', () => {
  const superman = [
    { name: 'Superman', year: '1978' },
    { name: 'Superman', year: '2025' },
    { name: 'Superman', year: '1948' },
    { name: 'Batman', year: '1989' },
  ];

  it('takes an unambiguous exact match without guessing', () => {
    expect(pickMovieMatch([{ name: 'Top Gun: Maverick', year: '2022' }], 'Top Gun: Maverick', 2023))
      .toEqual({ hit: { name: 'Top Gun: Maverick', year: '2022' }, guessed: false });
  });

  it('uses the watch date to break a tie, and admits it guessed', () => {
    const r = pickMovieMatch(superman, 'Superman', 2025);
    expect(r?.hit.year).toBe('2025');
    expect(r?.guessed).toBe(true);
  });

  it('never picks a film released after it was watched', () => {
    const r = pickMovieMatch(superman, 'Superman', 1980);
    expect(r?.hit.year).toBe('1978'); // not 2025
  });

  it('does not call it a guess when the date leaves exactly one', () => {
    const r = pickMovieMatch(superman, 'Superman', 1950);
    expect(r).toEqual({ hit: { name: 'Superman', year: '1948' }, guessed: false });
  });

  it('ignores near-misses — only exact titles are candidates', () => {
    expect(pickMovieMatch([{ name: 'Superman Returns', year: '2006' }], 'Superman', 2020)).toBe(null);
  });

  it('still answers when no watch date is known', () => {
    const r = pickMovieMatch(superman, 'Superman', null);
    expect(r?.hit.year).toBe('2025');
    expect(r?.guessed).toBe(true);
  });

  it('falls back to the newest when every candidate postdates the watch', () => {
    const r = pickMovieMatch(superman, 'Superman', 1900);
    expect(r?.guessed).toBe(true);
    expect(r?.hit.year).toBe('2025');
  });

  it('matches ignoring punctuation and case', () => {
    const r = pickMovieMatch([{ name: "The King's Man", year: '2021' }], 'the kings man', 2022);
    expect(r?.guessed).toBe(false);
  });
});

describe('disambiguatedMovieName (same title, different films)', () => {
  it('leaves a unique title alone', () => {
    expect(disambiguatedMovieName('Novocaine', '2025', new Set())).toBe('Novocaine');
  });
  it('adds the year when the title is already taken', () => {
    // Ghostbusters 1984 and 2016 are different films; the PK made them one
    expect(disambiguatedMovieName('Ghostbusters', '2016', new Set(['ghostbusters']))).toBe('Ghostbusters (2016)');
  });
  it('falls back to a counter when even the year collides', () => {
    expect(disambiguatedMovieName('Air', '2023', new Set(['air', 'air (2023)']))).toBe('Air (2)');
  });
  it('handles a missing year', () => {
    expect(disambiguatedMovieName('Road House', null, new Set(['road house']))).toBe('Road House (2)');
  });
  it('compares case-insensitively, like the table does', () => {
    expect(disambiguatedMovieName('Superman', '2025', new Set(['SUPERMAN'.toLowerCase()]))).toBe('Superman (2025)');
  });
});

describe('mayFoldDuplicateShow (the duplicate cleaner\'s licence to delete)', () => {
  const known = { tmdbId: 1399 };
  const unknown = { tmdbId: null };

  it('folds an imported placeholder — no history, no user intent', () => {
    expect(mayFoldDuplicateShow({ watches: 0, userAdded: false, tmdbId: null }, unknown)).toBe(true);
  });

  it('refuses to fold real watch history when either identity is unknown', () => {
    expect(mayFoldDuplicateShow({ watches: 40, userAdded: false, tmdbId: null }, known)).toBe(false);
    expect(mayFoldDuplicateShow({ watches: 40, userAdded: false, tmdbId: 1399 }, unknown)).toBe(false);
  });

  it('folds real history once BOTH identities are known', () => {
    // the caller has already proved the ids are equal by this point
    expect(mayFoldDuplicateShow({ watches: 40, userAdded: false, tmdbId: 1399 }, known)).toBe(true);
  });

  it('protects a show the user added in-app, even with nothing watched yet', () => {
    // the case 1.2.0 missed: tracked from Discover, never opened, so no TMDB id
    // has been fetched — the next import folded it into its same-named sibling
    expect(mayFoldDuplicateShow({ watches: 0, userAdded: true, tmdbId: null }, known)).toBe(false);
  });

  it('still protects a user-added show when the PRIMARY has no identity', () => {
    expect(mayFoldDuplicateShow({ watches: 0, userAdded: true, tmdbId: 1399 }, unknown)).toBe(false);
  });

  it('folds a user-added show once both identities are known', () => {
    expect(mayFoldDuplicateShow({ watches: 0, userAdded: true, tmdbId: 1399 }, known)).toBe(true);
  });

  it('treats tmdbId 0 — the "matched via TheTVDB" sentinel — as no identity', () => {
    // 0 means "matched, but TheTVDB has no TMDB id". Two entries both at 0 are
    // not thereby the same show, so it must not license a delete.
    expect(mayFoldDuplicateShow({ watches: 5, userAdded: false, tmdbId: 0 }, known)).toBe(false);
    expect(mayFoldDuplicateShow({ watches: 0, userAdded: true, tmdbId: 0 }, known)).toBe(false);
    expect(mayFoldDuplicateShow({ watches: 5, userAdded: false, tmdbId: 1399 }, { tmdbId: 0 })).toBe(false);
  });
});

describe('episodeKey (un-mark tombstones)', () => {
  it('is stable across the writer and the importer that honours it', () => {
    expect(episodeKey(72454, 25, 10)).toBe('72454-25-10');
  });

  it('does not collide across shows or seasons', () => {
    expect(episodeKey(1, 12, 3)).not.toBe(episodeKey(1, 1, 23));
    expect(episodeKey(11, 2, 3)).not.toBe(episodeKey(1, 12, 3));
  });
});

describe('effectiveEpisodesSeen (never store a counter the import refused)', () => {
  it('uses the rows when there are rows', () => {
    expect(effectiveEpisodesSeen(24, 31, false)).toBe(24);
  });

  it('stores ZERO for a show whose records list nothing — not the counter', () => {
    // Haikyu!!: counter says 84, the export lists no episodes. Storing 84 made
    // progressOf read MAX(0, 84) and render it fully watched.
    expect(effectiveEpisodesSeen(0, 84, false)).toBe(0);
  });

  it('keeps the counter for a bulk-only show, where the counter IS the record', () => {
    expect(effectiveEpisodesSeen(0, 52, true)).toBe(52);
  });

  it('never returns more than the rows for a normal show, however big the counter', () => {
    expect(effectiveEpisodesSeen(1, 999, false)).toBe(1);
  });
});
