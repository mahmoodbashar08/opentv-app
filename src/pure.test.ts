import {
  airCountdown,
  detailPaneLayout,
  disambiguatedMovieName,
  effectiveEpisodesSeen,
  gridGeometry,
  TABLET_MIN_W,
  reflow,
  slotAt,
  shouldAskForNotifications,
  shouldDismissOnPull,
  slotPosition,
  topBanner,
  episodeKey,
  matchStillsByTitle,
  mayFoldDuplicateMovie,
  mayFoldDuplicateShow,
  pickMovieMatch,
  posterLabel,
  v1WatchIsStale,
  shouldBulkFill,
  artworkUrl,
  canFoldMovie,
  clampToGrid,
  foundCsvsMessage,
  hasValue,
  listPlaceholderName,
  mergeCustomLists,
  mergeEnrichment,
  mergeTvdbRowIds,
  movieBaseName,
  movieYearOf,
  nextAtTop,
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

describe('gridGeometry (the reorder grid must follow the viewport)', () => {
  // (16, 3) is poster-picker's own pad/gap (its GAP is 10, but this suite
  // predates that split and keeps 3 for these general-shape checks); (12, 3)
  // is what every other production grid actually calls gridGeometry with —
  // all six of all-shows, all-movies, favorites, lists, movies tab and the
  // Shows tab grid view use space.md (12) with a 3pt gap.
  const PAIRS = [
    { PAD: 16, GAP: 3 },
    { PAD: 12, GAP: 3 },
  ];

  it.each(PAIRS)('keeps 3 columns on every phone in portrait — the layout it shipped with (PAD=$PAD)', ({ PAD, GAP }) => {
    for (const w of [320, 375, 390, 393, 430]) {
      expect(gridGeometry(w, PAD, GAP).cols).toBe(3);
    }
  });

  it.each(PAIRS)('gives a landscape iPad far more columns than a phone (PAD=$PAD)', ({ PAD, GAP }) => {
    // the whole point: 4 huge posters where a tablet wants ten
    expect(gridGeometry(1366, PAD, GAP).cols).toBeGreaterThanOrEqual(9);
  });

  it.each(PAIRS)('never drops below 3 columns, however narrow (PAD=$PAD)', ({ PAD, GAP }) => {
    expect(gridGeometry(200, PAD, GAP).cols).toBe(3);
  });

  it.each(PAIRS)('fills the width exactly: cells + gaps + padding === viewport (PAD=$PAD)', ({ PAD, GAP }) => {
    for (const w of [390, 1024, 1366]) {
      const g = gridGeometry(w, PAD, GAP);
      const used = g.cellW * g.cols + GAP * (g.cols - 1) + PAD * 2;
      expect(used).toBeCloseTo(w, 5);
    }
  });

  it.each(PAIRS)('keeps posters at the 2:3 aspect ratio (PAD=$PAD)', ({ PAD, GAP }) => {
    const g = gridGeometry(1024, PAD, GAP);
    expect(g.cellH).toBeCloseTo(g.cellW * 1.5, 5);
  });
});

describe('slotPosition / slotAt (drag maths — a wrong slot silently reorders a list)', () => {
  const geo = gridGeometry(390, 16, 3);

  it('places the first slot at the origin', () => {
    expect(slotPosition(0, geo)).toEqual({ x: 0, y: 0 });
  });

  it('wraps to the next row after the last column', () => {
    expect(slotPosition(geo.cols, geo)).toEqual({ x: 0, y: geo.slotH });
  });

  it('round-trips every slot back to itself', () => {
    for (let i = 0; i < 12; i++) {
      const p = slotPosition(i, geo);
      expect(slotAt(p.x, p.y, 12, geo)).toBe(i);
    }
  });

  it('round-trips under a landscape geometry too', () => {
    const wide = gridGeometry(1366, 16, 3);
    for (let i = 0; i < 30; i++) {
      const p = slotPosition(i, wide);
      expect(slotAt(p.x, p.y, 30, wide)).toBe(i);
    }
  });

  it('clamps a drag past the last item instead of inventing a slot', () => {
    expect(slotAt(9999, 9999, 5, geo)).toBe(4);
    expect(slotAt(-9999, -9999, 5, geo)).toBe(0);
  });
});

describe('reflow (a reorder, not a swap)', () => {
  const order = { a: 0, b: 1, c: 2, d: 3 };

  it('moves an item down and shuffles the passed-over items up', () => {
    expect(reflow(order, 0, 2)).toEqual({ a: 2, b: 0, c: 1, d: 3 });
  });

  it('moves an item up and shuffles the passed-over items down', () => {
    expect(reflow(order, 3, 1)).toEqual({ a: 0, b: 2, c: 3, d: 1 });
  });

  it('is a no-op when the slot has not changed', () => {
    expect(reflow(order, 2, 2)).toEqual(order);
  });

  it('always yields a permutation — never two items in one slot', () => {
    const out = reflow(order, 1, 3);
    expect(new Set(Object.values(out)).size).toBe(4);
  });
});

describe('mayFoldDuplicateMovie (the cleaner must not eat a film the user added)', () => {
  const imported = { watched: false, rated: false, favorited: false, userAdded: false, tmdbId: null };

  it('folds a bare imported placeholder — the case it exists for', () => {
    expect(mayFoldDuplicateMovie(imported, { tmdbId: null })).toBe(true);
  });

  it('protects a film the user added in-app, even with no history yet', () => {
    // added from search, never opened, so no tmdbId resolved — exactly the
    // shape the show-side guard was added for in 1.2.0
    expect(mayFoldDuplicateMovie({ ...imported, userAdded: true }, { tmdbId: null })).toBe(false);
  });

  it('protects a watched film', () => {
    expect(mayFoldDuplicateMovie({ ...imported, watched: true }, { tmdbId: 603 })).toBe(false);
  });

  it('protects a rated or favourited film', () => {
    expect(mayFoldDuplicateMovie({ ...imported, rated: true }, { tmdbId: 603 })).toBe(false);
    expect(mayFoldDuplicateMovie({ ...imported, favorited: true }, { tmdbId: 603 })).toBe(false);
  });

  it('folds a protected film only when BOTH identities are known', () => {
    const cand = { ...imported, userAdded: true, tmdbId: 603 };
    expect(mayFoldDuplicateMovie(cand, { tmdbId: 603 })).toBe(true);
    expect(mayFoldDuplicateMovie(cand, { tmdbId: null })).toBe(false);
    expect(mayFoldDuplicateMovie({ ...cand, tmdbId: null }, { tmdbId: 603 })).toBe(false);
  });

  it('treats the 0 sentinel as UNKNOWN, not as a matching identity', () => {
    // 0 = "matched via TheTVDB, no TMDB id" — two rows carrying it are not
    // thereby the same film, the same trap the show guard documents
    expect(mayFoldDuplicateMovie({ ...imported, watched: true, tmdbId: 0 }, { tmdbId: 0 })).toBe(false);
  });
});

describe('mergeTvdbRowIds (re-keying a show must not cost its episode ids)', () => {
  it('carries the old ids across when the target has none', () => {
    expect(mergeTvdbRowIds({ '1-1': 900, '1-2': 901 }, {})).toEqual({ '1-1': 900, '1-2': 901 });
  });

  it('lets the target win, since those were resolved under the current id', () => {
    expect(mergeTvdbRowIds({ '1-1': 900 }, { '1-1': 111 })).toEqual({ '1-1': 111 });
  });

  it('keeps episodes only the old id knew about', () => {
    expect(mergeTvdbRowIds({ '1-1': 900, '2-5': 950 }, { '1-1': 111 })).toEqual({ '1-1': 111, '2-5': 950 });
  });

  it('is empty only when both sides are', () => {
    expect(mergeTvdbRowIds({}, {})).toEqual({});
  });
});

describe('gridGeometry tablet breakpoint', () => {
  // as above: (16, 3) plus the (12, 3) every production grid but
  // poster-picker actually calls this with. Both pairs happen to land on the
  // same column counts at these particular widths (verified by hand, not
  // assumed) — the breakpoint's shape doesn't depend on which one you use.
  const PAIRS = [
    { PAD: 16, GAP: 3 },
    { PAD: 12, GAP: 3 },
  ];

  it.each(PAIRS)('leaves every phone width at 3 columns (PAD=$PAD)', ({ PAD, GAP }) => {
    for (const w of [320, 375, 390, 393, 430]) {
      expect(gridGeometry(w, PAD, GAP).cols).toBe(3);
    }
  });

  it.each(PAIRS)('uses the tablet target at and above the breakpoint (PAD=$PAD)', ({ PAD, GAP }) => {
    // 744 = iPad mini portrait: 5 columns of ~140pt, not 6 of ~118pt
    expect(gridGeometry(744, PAD, GAP).cols).toBe(5);
    expect(gridGeometry(1194, PAD, GAP).cols).toBe(8); // iPad 11" landscape
    expect(gridGeometry(1366, PAD, GAP).cols).toBe(9); // iPad 13" landscape
  });

  it.each(PAIRS)('keeps the phone target just below the breakpoint (PAD=$PAD)', ({ PAD, GAP }) => {
    expect(gridGeometry(TABLET_MIN_W - 1, PAD, GAP).cols).toBe(6);
  });

  it.each(PAIRS)('grows the column count monotonically within each regime (PAD=$PAD)', ({ PAD, GAP }) => {
    for (const [lo, hi] of [
      [300, TABLET_MIN_W - 1],
      [TABLET_MIN_W, 1400],
    ]) {
      let prev = 0;
      for (let w = lo; w <= hi; w += 1) {
        const { cols } = gridGeometry(w, PAD, GAP);
        expect(cols).toBeGreaterThanOrEqual(prev);
        prev = cols;
      }
    }
  });

  it.each(PAIRS)('gives up at most one column at the breakpoint (PAD=$PAD)', ({ PAD, GAP }) => {
    // Raising the target size at a breakpoint always costs columns — that is
    // arithmetic. The bound is what matters, and it is what ruled out a 150pt
    // target: 150 falls 6 -> 4 with the cell lurching 109pt -> 165pt, where
    // 140 falls 6 -> 5 and grows the cell a fifth.
    const below = gridGeometry(TABLET_MIN_W - 1, PAD, GAP);
    const above = gridGeometry(TABLET_MIN_W, PAD, GAP);
    expect(below.cols - above.cols).toBeLessThanOrEqual(1);
    expect(above.cellW / below.cellW).toBeLessThan(1.25);
  });

  it.each(PAIRS)('still fills the width exactly at tablet sizes (PAD=$PAD)', ({ PAD, GAP }) => {
    for (const w of [744, 1194, 1366]) {
      const g = gridGeometry(w, PAD, GAP);
      expect(g.cellW * g.cols + GAP * (g.cols - 1) + PAD * 2).toBeCloseTo(w, 5);
    }
  });
});

describe('clampToGrid (a dragged tile must stay inside the grid)', () => {
  // 8 items at 9 columns is ONE row — the shape that broke on a landscape iPad.
  // Letting the tile travel below the only row made slotAt read row 1, which
  // clamps to the last slot; wandering out there flipped the target back and
  // forth and each flip reflowed the whole range, permuting untouched items.
  const geo = gridGeometry(1366, 12, 3);

  it('leaves a position inside the grid untouched', () => {
    const p = slotPosition(3, geo);
    expect(clampToGrid(p.x, p.y, 8, geo)).toEqual(p);
  });

  it('stops the tile below the last row of a one-row grid', () => {
    const { y } = clampToGrid(0, 5000, 8, geo);
    expect(y).toBe(0); // 8 items over 9 columns = a single row, so y can only be 0
  });

  it('stops the tile past the last column', () => {
    const { x } = clampToGrid(99999, 0, 8, geo);
    expect(x).toBeCloseTo(slotPosition(7, geo).x, 5);
  });

  it('never returns a negative position', () => {
    expect(clampToGrid(-500, -500, 8, geo)).toEqual({ x: 0, y: 0 });
  });

  it('allows the full height of a multi-row grid', () => {
    const { y } = clampToGrid(0, 99999, 30, geo); // 30 items over 9 cols = 4 rows
    expect(y).toBeCloseTo(3 * geo.slotH, 5);
  });

  it('keeps every in-grid slot resolving to itself after clamping', () => {
    for (let i = 0; i < 8; i++) {
      const p = slotPosition(i, geo);
      const c = clampToGrid(p.x, p.y, 8, geo);
      expect(slotAt(c.x, c.y, 8, geo)).toBe(i);
    }
  });
});

describe('shouldAskForNotifications (the opt-in shows exactly once)', () => {
  it('shows after onboarding when the user has never been asked', () => {
    expect(shouldAskForNotifications({ onboarded: true, asked: false, enabled: false })).toBe(true);
  });

  it('never shows before onboarding finishes', () => {
    expect(shouldAskForNotifications({ onboarded: false, asked: false, enabled: false })).toBe(false);
  });

  it('never shows twice — "Not now" is still an answer', () => {
    expect(shouldAskForNotifications({ onboarded: true, asked: true, enabled: false })).toBe(false);
  });

  it('does not ask someone who already turned notifications on', () => {
    // e.g. enabled from Settings before this screen ever existed, on upgrade
    expect(shouldAskForNotifications({ onboarded: true, asked: false, enabled: true })).toBe(false);
  });
});

describe('topBanner (Profile shows one banner, not a stack of three)', () => {
  const none = { cloudOff: false, backupOverdue: false, notificationsOff: false };

  it('shows nothing when nothing is wrong', () => {
    expect(topBanner(none)).toBe(null);
  });

  it('puts losing your library above missing an episode', () => {
    expect(topBanner({ cloudOff: true, backupOverdue: true, notificationsOff: true })).toBe('cloud');
  });

  it('falls through to the manual backup nudge when iCloud is fine', () => {
    expect(topBanner({ ...none, backupOverdue: true, notificationsOff: true })).toBe('backup');
  });

  it('shows notifications only when no backup problem outranks it', () => {
    expect(topBanner({ ...none, notificationsOff: true })).toBe('notifications');
  });
});

describe('posterLabel (VoiceOver could not navigate the library at all)', () => {
  it('reads the title when there is nothing else to say', () => {
    expect(posterLabel('Breaking Bad', {})).toBe('Breaking Bad');
  });

  it('speaks progress as a percentage, not a fraction of a bar', () => {
    expect(posterLabel('Breaking Bad', { progress: 0.45 })).toBe('Breaking Bad, 45% watched');
  });

  it('rounds progress to whole percent', () => {
    expect(posterLabel('Dune', { progress: 0.666 })).toBe('Dune, 67% watched');
  });

  it('says nothing watched rather than 0%', () => {
    expect(posterLabel('Silo', { progress: 0 })).toBe('Silo, not started');
  });

  it('says finished rather than 100%', () => {
    expect(posterLabel('Chernobyl', { progress: 1 })).toBe('Chernobyl, finished');
  });

  it('falls back to the status word when there is no progress', () => {
    expect(posterLabel('Silo', { status: 'upToDate' })).toBe('Silo, up to date');
    expect(posterLabel('Lost', { status: 'stopped' })).toBe('Lost, stopped');
    expect(posterLabel('Heidi', { status: 'watching' })).toBe('Heidi, watching');
  });

  it('ignores the none status, which means "no badge shown"', () => {
    expect(posterLabel('Dune', { status: 'none' })).toBe('Dune');
  });

  it('prefers progress over status when both are present', () => {
    expect(posterLabel('Silo', { progress: 0.5, status: 'watching' })).toBe('Silo, 50% watched');
  });
});

describe('detailPaneLayout (detail beside the list, not on top of it)', () => {
  it('fills the screen on a phone, exactly as before', () => {
    for (const w of [390, 430, 440]) {
      expect(detailPaneLayout(w)).toEqual({ paned: false, width: w });
    }
  });

  it('fills the screen in a narrow iPad window too', () => {
    // 511pt half-window: a 60% pane would be 307pt, narrower than a phone
    expect(detailPaneLayout(511).paned).toBe(false);
    expect(detailPaneLayout(899).paned).toBe(false);
  });

  it('splits once there is room for both halves to be usable', () => {
    const l = detailPaneLayout(900);
    expect(l.paned).toBe(true);
    expect(l.width).toBe(540); // 60%
  });

  it('leaves the list at least a phone-width of room', () => {
    for (const w of [900, 1024, 1194, 1376]) {
      const { width } = detailPaneLayout(w);
      expect(w - width).toBeGreaterThanOrEqual(360);
    }
  });

  it('gives the detail pane more room than the list', () => {
    // the detail is the denser side — episode rows, descriptions, controls
    for (const w of [900, 1376]) {
      const { width } = detailPaneLayout(w);
      expect(width).toBeGreaterThan(w - width);
    }
  });

  it('never exceeds the screen', () => {
    for (const w of [390, 900, 1376]) {
      expect(detailPaneLayout(w).width).toBeLessThanOrEqual(w);
    }
  });
});

describe('nextAtTop (scrolling back up must not dismiss the page)', () => {
  it('arms the dismiss gesture when the list rests at the top', () => {
    expect(nextAtTop(false, true, false)).toBe(true);
  });

  it('disarms as soon as the list leaves the top, even mid-scroll', () => {
    expect(nextAtTop(true, false, true)).toBe(false);
  });

  it('does NOT arm while a scroll is still in flight', () => {
    // the bug: flicking back up re-armed the gesture the instant the top was
    // reached, and the finger was already travelling downwards — so the page
    // dismissed instead of settling
    expect(nextAtTop(false, true, true)).toBe(false);
  });

  it('arms once that scroll finally settles at the top', () => {
    expect(nextAtTop(false, true, false)).toBe(true);
  });

  it('leaves an already-armed gesture alone at the top', () => {
    expect(nextAtTop(true, true, false)).toBe(true);
    expect(nextAtTop(true, true, true)).toBe(true);
  });
});

describe('matchStillsByTitle (borrow TMDB images without trusting its numbering)', () => {
  const tvdb = {
    '1-1': { title: 'Noddy Loses Sixpence', still: null },
    '1-11': { title: 'Noddy and the Broken Bicycle', still: null },
    '2-1': { title: 'Already Has One', still: 'keep-me.jpg' },
    '3-1': { title: null, still: null },
  };

  it('matches on title, never on episode number or air date', () => {
    // real data: TheTVDB schedules this show daily and TMDB weekly, so the
    // same date lands on different episodes. Titles are identical in both.
    const tmdb = [
      { title: 'Noddy and the Broken Bicycle', still: 'bike.jpg' },
      { title: 'Noddy Loses Sixpence', still: 'sixpence.jpg' },
    ];
    expect(matchStillsByTitle(tvdb, tmdb)).toEqual({ '1-1': 'sixpence.jpg', '1-11': 'bike.jpg' });
  });

  it('ignores case and surrounding punctuation', () => {
    expect(matchStillsByTitle(tvdb, [{ title: '  noddy loses SIXPENCE! ', still: 'a.jpg' }])).toEqual({
      '1-1': 'a.jpg',
    });
  });

  it('never overwrites a still TheTVDB already provided', () => {
    expect(matchStillsByTitle(tvdb, [{ title: 'Already Has One', still: 'other.jpg' }])).toEqual({});
  });

  it('skips episodes with no title rather than guessing', () => {
    expect(matchStillsByTitle(tvdb, [{ title: null, still: 'x.jpg' }])).toEqual({});
  });

  it('refuses a title TMDB lists twice — ambiguous is not a match', () => {
    const dupes = [
      { title: 'Noddy Loses Sixpence', still: 'a.jpg' },
      { title: 'Noddy Loses Sixpence', still: 'b.jpg' },
    ];
    expect(matchStillsByTitle(tvdb, dupes)).toEqual({});
  });

  it('ignores TMDB entries that carry no image', () => {
    expect(matchStillsByTitle(tvdb, [{ title: 'Noddy Loses Sixpence', still: null }])).toEqual({});
  });
});

describe('shouldDismissOnPull (pull PAST the top, the way TV Time does it)', () => {
  it('ignores ordinary scrolling, however far down', () => {
    expect(shouldDismissOnPull(400, true)).toBe(false);
    expect(shouldDismissOnPull(0, true)).toBe(false);
  });

  it('ignores merely reaching the top — that is where the old bug lived', () => {
    // arriving at the top is not a request to leave; the header has just
    // finished expanding and the finger is still travelling
    expect(shouldDismissOnPull(0, true)).toBe(false);
    expect(shouldDismissOnPull(-4, true)).toBe(false);
  });

  it('dismisses once the user keeps pulling past the top', () => {
    expect(shouldDismissOnPull(-120, true)).toBe(true);
  });

  it('needs a real pull, not a flick that merely bounces', () => {
    // momentum overshoot after the finger has lifted must never dismiss
    expect(shouldDismissOnPull(-400, false)).toBe(false);
  });

  it('has a threshold deliberately past a casual rubber-band', () => {
    expect(shouldDismissOnPull(-60, true)).toBe(false);
    expect(shouldDismissOnPull(-100, true)).toBe(true);
  });
});
