import {
  calendarMonth,
  deviceWatchRegion,
  recentDayOptions,
  validWatchRegion,
  watchOptions,
  secondaryAccent,
  dominantAccent,
  pickBiography,
  personLife,
  personCredits,
  airCountdown,
  wrappedToOffer,
  collagePosters,
  periodBounds,
  periodOptions,
  wrappedSlides,
  wrappedTooQuiet,
  WRAPPED_MIN_ITEMS,
  WRAPPED_MIN_RATINGS,
  busyDayCount,
  heatLevel,
  halfEnd,
  monthColumns,
  monthsGrid,
  shiftMonth,
  dominantAccent,
  mixHex,
  annualSavingPercent,
  suggestedHandle,
  watchRuntimeSeconds,
  detailPaneLayout,
  disambiguatedMovieName,
  effectiveEpisodesSeen,
  gridGeometry,
  gridHeight,
  splitLineY,
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
  movieMatchState,
  nextPage,
  pickMovieMatch,
  posterLabel,
  swipeDirection,
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
  mergeSearchFallback,
  mergeTvdbRowIds,
  missingSearchKinds,
  movieBaseName,
  movieIdentityMatches,
  movieRoute,
  movieYearOf,
  aggregateFresh,
  communityScore,
  needsDirectionChange,
  nextAtTop,
  olderThan,
  preferred,
  resolveMovieRow,
  reversalMoves,
  shouldResync,
  slug,
  targetKey,
  topEmotion,
  starPercents,
  emotionPercents,
  characterPercents,
  localCommentToSeed,
  isOrphanedReply,
  localPictureIndex,
  pictureKeyOf,
  publishableStats,
  titlesForPublish,
  PROFILE_FAVOURITE_LIMIT,
  PROFILE_LIST_LIMIT,
  mergedFollowTotal,
  mergeFollowList,
  reconnectBannerCount,
  unmatchedArchiveFriends,
  mergeCastForPoll,
  orderPollCast,
  pollLabel,
  characterFace,
  nextCharacterVote,
  uniqueListName,
  bingeReport,
  ratingPersonality,
  watchTimeShape,
  contrarianScore,
  CONTRARIAN_MIN_TITLES,
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
  it('counts tomorrow as 1 — the badge is a number, not a word', () => {
    expect(airCountdown('2026-07-27', now)).toEqual({ key: 'airIn.days', count: 1 });
  });
  it('counts days, which the locale renders as a bare number', () => {
    expect(airCountdown('2026-07-31', now)).toEqual({ key: 'airIn.days', count: 5 });
    expect(airCountdown('2026-08-20', now)).toEqual({ key: 'airIn.days', count: 25 });
  });
  it('stays in days past a month — "58" beats "in 2 months" at that range', () => {
    expect(airCountdown('2026-09-22', now)).toEqual({ key: 'airIn.days', count: 58 });
  });
  it('switches to months, then years, so a 2028 premiere is not "731"', () => {
    expect(airCountdown('2026-12-26', now)).toEqual({ key: 'airIn.months', count: 5 });
    expect(airCountdown('2028-07-26', now)).toEqual({ key: 'airIn.years', count: 2 });
  });
  it('never formats a sentence itself — six locales own the wording', () => {
    // The regression this guards is the function returning `in 2 years` and a
    // <Text> rendering it verbatim in Arabic. A key + count cannot do that.
    for (const d of ['2026-07-27', '2026-08-20', '2026-12-26', '2028-07-26']) {
      const r = airCountdown(d, now);
      expect(typeof r).not.toBe('string');
      expect(r!.key).toMatch(/^airIn\.(days|months|years)$/);
      expect(Number.isInteger(r!.count)).toBe(true);
    }
  });
  it('returns null for a missing or unparseable date', () => {
    expect(airCountdown(null, now)).toBe(null);
    expect(airCountdown('', now)).toBe(null);
    expect(airCountdown('TBA', now)).toBe(null);
  });
  it('accepts a full timestamp, not just a bare date', () => {
    expect(airCountdown('2026-07-28T20:00:00Z', now)).toEqual({ key: 'airIn.days', count: 2 });
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

describe('movieMatchState', () => {
  it('reports a movie that was never matched', () => {
    expect(movieMatchState(null)).toBe('unmatched');
    expect(movieMatchState(undefined)).toBe('unmatched');
  });

  it('reads the TheTVDB sentinel as matched, not as unmatched', () => {
    // the bug: 0 is falsy, so `!tmdbId` treated a hand-picked TheTVDB match
    // as "never matched" — picking one changed nothing on screen
    expect(movieMatchState(0)).toBe('tvdb');
  });

  it('reports a real TMDB id as fully matched', () => {
    expect(movieMatchState(1249289)).toBe('tmdb');
  });

  it('counts a TheTVDB id as matched even with no TMDB id at all', () => {
    // A film identified on TheTVDB — by a search result, or by the movie
    // screen's unambiguous by-name lookup — has a poster, a year and a
    // runtime on screen. Calling that "we couldn't identify this movie" is the
    // app denying knowledge of a film it is actively rendering.
    expect(movieMatchState(null, 148021)).toBe('tvdb');
    expect(movieMatchState(undefined, 148021)).toBe('tvdb');
  });

  it('is still unmatched when neither catalogue has anything', () => {
    expect(movieMatchState(null, null)).toBe('unmatched');
    expect(movieMatchState(null, undefined)).toBe('unmatched');
  });
});

describe('movieRoute (carrying poster/year hints into the movie detail route)', () => {
  it('builds a bare route when nothing extra is known', () => {
    expect(movieRoute('Amado')).toBe('/movie/Amado');
    expect(movieRoute('Amado', {})).toBe('/movie/Amado');
  });

  it('adds tmdbId, poster and year when all are supplied', () => {
    expect(movieRoute('Amado', { tmdbId: 12345, poster: 'https://img/p.jpg', year: '2022' })).toBe(
      '/movie/Amado?tmdbId=12345&poster=https%3A%2F%2Fimg%2Fp.jpg&year=2022',
    );
  });

  it('percent-encodes the name itself, same as before', () => {
    expect(movieRoute('Léon: The Professional')).toBe('/movie/L%C3%A9on%3A%20The%20Professional');
  });

  it('omits a hint that is null, undefined, or an empty string', () => {
    expect(movieRoute('Amado', { tmdbId: null, poster: null, year: null })).toBe('/movie/Amado');
    expect(movieRoute('Amado', { poster: '' })).toBe('/movie/Amado');
  });

  it('keeps a real tmdbId of 0 — TheTVDB sentinel, not "missing" (see movieMatchState)', () => {
    expect(movieRoute('Amado', { tmdbId: 0 })).toBe('/movie/Amado?tmdbId=0');
  });

  it('reduces a messy "year • genre" sub-line to just the 4-digit year', () => {
    expect(movieRoute('Amado', { year: '2022 • Drama, Thriller' })).toBe('/movie/Amado?year=2022');
  });

  it('drops a year hint with no usable 4-digit year', () => {
    expect(movieRoute('Amado', { year: 'Drama, Thriller' })).toBe('/movie/Amado');
  });
});

describe('nextPage (RTL episode pager: gesture-driven index, not scroll geometry)', () => {
  it('steps forward', () => {
    expect(nextPage(2, 10, 1)).toBe(3);
  });

  it('steps back', () => {
    expect(nextPage(2, 10, -1)).toBe(1);
  });

  it('clamps at the last page', () => {
    expect(nextPage(9, 10, 1)).toBe(9);
  });

  it('clamps at the first page', () => {
    expect(nextPage(0, 10, -1)).toBe(0);
  });

  it('a single-page list never moves, either direction', () => {
    expect(nextPage(0, 1, 1)).toBe(0);
    expect(nextPage(0, 1, -1)).toBe(0);
  });

  it('an empty list has no page to be on — stays at 0 rather than throwing', () => {
    expect(nextPage(0, 0, 1)).toBe(0);
    expect(nextPage(0, 0, -1)).toBe(0);
  });
});

describe('swipeDirection (released drag -> pager step, or none)', () => {
  const W = 390; // a typical phone width
  const LTR = false;
  const RTL = true;

  it('a firm drag past a third of the page steps forward (physical left swipe)', () => {
    expect(swipeDirection(-150, 0, W, LTR)).toBe(1);
  });

  it('a firm drag past a third of the page steps back (physical right swipe)', () => {
    expect(swipeDirection(150, 0, W, LTR)).toBe(-1);
  });

  it('a fast flick counts even with little travel', () => {
    expect(swipeDirection(-20, -600, W, LTR)).toBe(1);
    expect(swipeDirection(20, 600, W, LTR)).toBe(-1);
  });

  it('a short, slow drag springs back — no step', () => {
    expect(swipeDirection(-40, -100, W, LTR)).toBe(0);
    expect(swipeDirection(40, 100, W, LTR)).toBe(0);
  });

  it('no drag at all is not a step', () => {
    expect(swipeDirection(0, 0, W, LTR)).toBe(0);
  });

  // Arabic reads right-to-left, so the gesture mirrors with the pages:
  // the finger movement that advances in English goes back in Arabic.
  it('mirrors under RTL: dragging RIGHT steps forward', () => {
    expect(swipeDirection(150, 0, W, RTL)).toBe(1);
    expect(swipeDirection(20, 600, W, RTL)).toBe(1);
  });

  it('mirrors under RTL: dragging LEFT steps back', () => {
    expect(swipeDirection(-150, 0, W, RTL)).toBe(-1);
    expect(swipeDirection(-20, -600, W, RTL)).toBe(-1);
  });

  it('a non-step stays a non-step under RTL — nothing to mirror', () => {
    expect(swipeDirection(-40, -100, W, RTL)).toBe(0);
    expect(swipeDirection(0, 0, W, RTL)).toBe(0);
  });

  it('RTL is the exact inverse of LTR for every stepping input', () => {
    for (const [tx, vx] of [[-150, 0], [150, 0], [-20, -600], [20, 600]] as const) {
      const ltr = swipeDirection(tx, vx, W, LTR);
      const rtl = swipeDirection(tx, vx, W, RTL);
      expect(rtl).toBe(-ltr);
    }
  });
});

describe('needsDirectionChange (startup RTL: does native direction match the resolved locale)', () => {
  it('already RTL for an RTL locale — no-op', () => {
    expect(needsDirectionChange(true, true)).toBe(false);
  });

  it('already LTR for an LTR locale — no-op (the normal English launch)', () => {
    expect(needsDirectionChange(false, false)).toBe(false);
  });

  it('RTL locale but native is still LTR — needs to flip to RTL', () => {
    expect(needsDirectionChange(true, false)).toBe(true);
  });

  it('LTR locale but native is still RTL — needs to flip to LTR', () => {
    expect(needsDirectionChange(false, true)).toBe(true);
  });
});

describe('movieIdentityMatches (search tick vs. two films sharing a title)', () => {
  it('matches on tmdbId when both sides have one', () => {
    expect(movieIdentityMatches({ tmdbId: 703451, name: 'Amado' }, { tmdbId: 703451, name: 'Amado' })).toBe(true);
  });

  it('does NOT match same name, different tmdbId — the reported bug', () => {
    // "Amado" (2022) is in the library; the 2011 "Amado" search result must
    // not tick, even though the title is identical
    expect(movieIdentityMatches({ tmdbId: 111222, name: 'Amado' }, { tmdbId: 703451, name: 'Amado' })).toBe(false);
  });

  it('falls back to name when the library row has no tmdbId', () => {
    // imported films (TV Time's GDPR export) routinely carry no tmdbId —
    // it is the best identity evidence available for them
    expect(movieIdentityMatches({ tmdbId: 703451, name: 'Amado' }, { tmdbId: null, name: 'Amado' })).toBe(true);
  });

  it('falls back to name, and checks originalName too, when neither side has a tmdbId', () => {
    expect(movieIdentityMatches({ tmdbId: null, name: 'Dune' }, { tmdbId: null, name: 'Dune (2021)', originalName: 'Dune' })).toBe(
      true,
    );
    expect(movieIdentityMatches({ tmdbId: null, name: 'Amado' }, { tmdbId: null, name: 'Amado (2011)' })).toBe(false);
  });

  it('treats the TheTVDB sentinel 0 as "no tmdbId", not as a real id', () => {
    // two rows both carrying the hand-match sentinel are not thereby proven
    // to be the same film — see movieMatchState
    expect(movieIdentityMatches({ tmdbId: 0, name: 'Amado' }, { tmdbId: 0, name: 'Amado' })).toBe(true); // falls back to name, which matches
    expect(movieIdentityMatches({ tmdbId: 0, name: 'Amado' }, { tmdbId: 0, name: 'Different' })).toBe(false);
  });
});

describe('resolveMovieRow (movie route identity: which library row is this?)', () => {
  const amado2011 = { tmdbId: 111222, name: 'Amado' };
  const amado2022 = { tmdbId: 703451, name: 'Amado (2022)' };

  it('tmdbId supplied, matches one row — that row wins even though another shares the name', () => {
    expect(resolveMovieRow({ tmdbId: 703451, name: 'Amado' }, [amado2011, amado2022])).toBe(amado2022);
    expect(resolveMovieRow({ tmdbId: 111222, name: 'Amado' }, [amado2011, amado2022])).toBe(amado2011);
  });

  it('tmdbId supplied, no row carries that id — falls back to a name match', () => {
    // this is the known, deliberately-unfixed collapse case: an imported row
    // with no tmdbId of its own can't be disproven by a real tmdbId, so a
    // brand new film sharing its title still resolves onto it. Falling back
    // (rather than returning null) matches what `movieIdentityMatches` and
    // `addMovieToWatchlist` already do for this exact case, so the route and
    // the write path never disagree about which row "no better evidence"
    // means.
    const imported = { tmdbId: null, name: 'Amado' };
    expect(resolveMovieRow({ tmdbId: 999999, name: 'Amado' }, [imported])).toBe(imported);
  });

  it('tmdbId supplied, no row matches by id OR name — nothing to resolve to', () => {
    expect(resolveMovieRow({ tmdbId: 999999, name: 'Brand New Film' }, [amado2011, amado2022])).toBeNull();
  });

  it('no tmdbId supplied, one name match — resolves by name, same as getMovie() today', () => {
    const dune = { tmdbId: null, name: 'Dune (2021)', originalName: 'Dune' };
    expect(resolveMovieRow({ tmdbId: null, name: 'Dune' }, [amado2011, dune])).toBe(dune);
  });

  it('no tmdbId supplied, two rows both answer to the name — first candidate wins, not a guess about which film it is', () => {
    // without a tmdbId there is no way to tell these apart — TEXT PRIMARY KEY
    // on `name` means this can only happen via originalName overlap, and
    // `getMovie()`'s own unordered SQL scan is just as arbitrary about which
    // one it returns today. Picking the first of the given candidates keeps
    // that pre-existing ambiguity deterministic rather than pretending this
    // function can disambiguate what the data itself does not.
    const rowA = { tmdbId: null, name: 'Amado (2011)', originalName: 'Amado' };
    const rowB = { tmdbId: null, name: 'Amado (2022)', originalName: 'Amado' };
    expect(resolveMovieRow({ tmdbId: null, name: 'Amado' }, [rowA, rowB])).toBe(rowA);
    expect(resolveMovieRow({ tmdbId: null, name: 'Amado' }, [rowB, rowA])).toBe(rowB);
  });

  it('tmdbId = 0 (the TheTVDB sentinel) is never treated as a real id, on either side', () => {
    // a candidate tmdbId of 0 must not short-circuit into an id compare —
    // it falls through to name, exactly like movieIdentityMatches
    const tvdbMatched = { tmdbId: 0, name: 'Amado' };
    expect(resolveMovieRow({ tmdbId: 0, name: 'Amado' }, [tvdbMatched, amado2022])).toBe(tvdbMatched);
    // and a row carrying the sentinel must not be picked as an "id match"
    // for some unrelated real tmdbId that happens to also be falsy-adjacent
    expect(resolveMovieRow({ tmdbId: 703451, name: 'Something Else' }, [tvdbMatched])).toBeNull();
  });
});

describe('movieIdentityMatches — the year decides when no TMDB id exists', () => {
  // TheTVDB is the primary catalogue for movies and gives no TMDB id at all,
  // so this is the normal path, not an edge case.
  it('two films sharing a title but not a year are DIFFERENT films', () => {
    expect(
      movieIdentityMatches({ tmdbId: null, name: 'Amado', year: '2022' }, { tmdbId: null, name: 'Amado', year: '2011' }),
    ).toBe(false);
  });

  it('same title and same year is the same film', () => {
    expect(
      movieIdentityMatches({ tmdbId: null, name: 'Amado', year: '2011' }, { tmdbId: null, name: 'Amado', year: '2011' }),
    ).toBe(true);
  });

  it('a real TMDB id on both sides still wins over the year', () => {
    expect(
      movieIdentityMatches(
        { tmdbId: 703451, name: 'Amado', year: '2022' },
        { tmdbId: 703451, name: 'Amado', year: '2011' },
      ),
    ).toBe(true);
  });

  it('falls back to the same film when a year is missing — better than duplicating what is already held', () => {
    expect(
      movieIdentityMatches({ tmdbId: null, name: 'Amado', year: null }, { tmdbId: null, name: 'Amado', year: '2011' }),
    ).toBe(true);
  });

  it('a different title is never the same film, whatever the years', () => {
    expect(
      movieIdentityMatches({ tmdbId: null, name: 'Amadeo', year: '2011' }, { tmdbId: null, name: 'Amado', year: '2011' }),
    ).toBe(false);
  });

  it('a full date is read as its year, not compared as a string', () => {
    expect(
      movieIdentityMatches(
        { tmdbId: null, name: 'Amado', year: '2011-03-04' },
        { tmdbId: null, name: 'Amado', year: '2011' },
      ),
    ).toBe(true);
  });
});

describe('resolveMovieRow — two films sharing a title, neither with a TMDB id', () => {
  // TheTVDB gives movies no TMDB id, so this is the ordinary case for anything
  // added from search. Dropping the year here is what made tapping "Amado"
  // (2011) open "Amado" (2022): both fell to a name compare and the first row
  // in the list won.
  const rows = [
    { tmdbId: null, name: 'Amado', originalName: 'Amado', year: '2022' },
    { tmdbId: null, name: 'Amado (2011)', originalName: 'Amado', year: '2011' },
  ];

  it('opens the 2011 film when the 2011 film was tapped', () => {
    expect(resolveMovieRow({ tmdbId: null, name: 'Amado', year: '2011' }, rows)?.year).toBe('2011');
  });

  it('opens the 2022 film when the 2022 film was tapped', () => {
    expect(resolveMovieRow({ tmdbId: null, name: 'Amado', year: '2022' }, rows)?.year).toBe('2022');
  });

  it('with no year to go on, still resolves to something rather than nothing', () => {
    expect(resolveMovieRow({ tmdbId: null, name: 'Amado' }, rows)).not.toBeNull();
  });

  it('a real TMDB id still wins outright over any year', () => {
    const withId = [{ tmdbId: 703451, name: 'Amado', originalName: 'Amado', year: '2022' }, ...rows];
    expect(resolveMovieRow({ tmdbId: 703451, name: 'Amado', year: '2011' }, withId)?.tmdbId).toBe(703451);
  });
});

describe('movieMatchState — TheTVDB counts as matched', () => {
  it('a film added from a TheTVDB search result is matched, not unknown', () => {
    // The reported bug: this returned 'unmatched', so a yellow "not matched to
    // the movie database" banner sat above a screen full of TheTVDB data.
    expect(movieMatchState(null, 113)).toBe('tvdb');
  });

  it('the legacy Fix-match sentinel still reads as TheTVDB', () => {
    expect(movieMatchState(0, null)).toBe('tvdb');
  });

  it('a real TMDB id still wins', () => {
    expect(movieMatchState(603, 113)).toBe('tmdb');
  });

  it('no id from either catalogue is genuinely unmatched', () => {
    expect(movieMatchState(null, null)).toBe('unmatched');
    expect(movieMatchState(undefined)).toBe('unmatched');
  });
});

describe('missingSearchKinds / mergeSearchFallback — per-kind TMDB fallback in search', () => {
  it('TheTVDB has both kinds: nothing is missing, TMDB is never asked', () => {
    const tvdb = [
      { kind: 'movie' as const, title: 'Amadeo', sub: '2023' },
      { kind: 'tv' as const, title: 'Amadeus', sub: '2025' },
    ];
    expect(missingSearchKinds(tvdb)).toEqual([]);
  });

  it('TheTVDB has films only: series is reported missing so TMDB is asked for it', () => {
    const tvdb = [{ kind: 'movie' as const, title: 'Amadeo', sub: '2023' }];
    expect(missingSearchKinds(tvdb)).toEqual(['tv']);
  });

  it('TheTVDB has nothing: both kinds are missing (the current full-fallback case)', () => {
    expect(missingSearchKinds([])).toEqual(['tv', 'movie']);
  });

  it('appends the TMDB supplement after TheTVDB\'s rows, in order', () => {
    const tvdb = [{ kind: 'movie' as const, title: 'Amadeo', sub: '2023' }];
    const tmdbSeries = [{ kind: 'tv' as const, title: 'Amadeo', sub: '2026' }];
    expect(mergeSearchFallback(tvdb, tmdbSeries)).toEqual([...tvdb, ...tmdbSeries]);
  });

  it('a title present in both catalogues (same kind, title and year) appears only once', () => {
    const tvdb = [{ kind: 'tv' as const, title: 'Amadeus', sub: '2 seasons • 2025' }];
    const tmdb = [
      { kind: 'tv' as const, title: 'Amadeus', sub: '2025' }, // duplicate — dropped
      { kind: 'tv' as const, title: 'Amadeo', sub: '2026' }, // genuinely different — kept
    ];
    expect(mergeSearchFallback(tvdb, tmdb)).toEqual([
      { kind: 'tv', title: 'Amadeus', sub: '2 seasons • 2025' },
      { kind: 'tv', title: 'Amadeo', sub: '2026' },
    ]);
  });
});

describe('shouldResync', () => {
  const GAP = 10 * 60 * 1000;
  const now = 1_700_000_000_000;

  it('runs when it has never run', () => {
    expect(shouldResync(null, now, GAP)).toBe(true);
    expect(shouldResync(undefined, now, GAP)).toBe(true);
    expect(shouldResync(0, now, GAP)).toBe(true);
    expect(shouldResync(NaN, now, GAP)).toBe(true);
  });

  it('skips a second run inside the gap — the app-switch case', () => {
    expect(shouldResync(now - 1000, now, GAP)).toBe(false);
    expect(shouldResync(now, now, GAP)).toBe(false);
    expect(shouldResync(now - (GAP - 1), now, GAP)).toBe(false);
  });

  it('runs again once the gap has passed', () => {
    expect(shouldResync(now - GAP, now, GAP)).toBe(true);
    expect(shouldResync(now - GAP * 5, now, GAP)).toBe(true);
  });

  it('runs when the stamp is in the future, rather than blocking until the clock catches up', () => {
    expect(shouldResync(now + GAP * 100, now, GAP)).toBe(true);
  });
});

/**
 * The vector table from backend/docs/IMPLEMENTATION.md, "The shared identity
 * rule". The same eleven rows exist against `targetKey` in
 * backend/test/pure.test.ts: if the two sides ever disagree, the phone and the
 * server address different threads for the same film.
 */
describe('targetKey — the shared identity vectors', () => {
  // The two Amado rows are the whole point: the films that collided in 1.2.1
  // because the app compared names alone. Different years, different keys.
  it('Amado 2011', () => expect(targetKey('title', { title: 'Amado', year: '2011' })).toBe('amado|2011'));
  it('Amado 2022', () => expect(targetKey('title', { title: 'Amado', year: '2022' })).toBe('amado|2022'));

  it('Amélie 2001 — diacritics fold', () =>
    expect(targetKey('title', { title: 'Amélie', year: '2001' })).toBe('amelie|2001'));
  it('Amélie, no year', () => expect(targetKey('title', { title: 'Amélie' })).toBe('amelie|'));

  // Arabic must survive: an ASCII-only class would empty these and collapse
  // the whole Arabic catalogue into a single thread.
  it('Arabic title, no year', () => expect(targetKey('title', { title: 'مسلسل ما' })).toBe('مسلسل-ما|'));
  it('Arabic title with harakat 2019', () =>
    expect(targetKey('title', { title: 'مُسَلْسَل ما', year: '2019' })).toBe('مسلسل-ما|2019'));

  it('Spider-Man: No Way Home 2021', () =>
    expect(targetKey('title', { title: 'Spider-Man: No Way Home', year: '2021' })).toBe(
      'spider-man-no-way-home|2021',
    ));
  it('WALL·E 2008', () => expect(targetKey('title', { title: 'WALL·E', year: '2008' })).toBe('wall-e|2008'));

  /**
   * THE TRAP, pinned. A full release date in the year column must keep
   * `movieYear()`'s `.slice(0, 4)`. Built on the app's own `movieYearOf` —
   * which tests the column with a bare /^\d{4}$/ and does not slice — this row
   * would fall through to the title suffix, find none, and yield `dune|`,
   * while the server said `dune|2021`. Two threads, forever, silently.
   */
  it('  Dune   with a full date column', () =>
    expect(targetKey('title', { title: '  Dune  ', year: '2021-10-22' })).toBe('dune|2021'));
  it('Dune (1984) — year read off the title suffix', () =>
    expect(targetKey('title', { title: 'Dune (1984)' })).toBe('dune|1984'));

  it('a show is just its id', () => expect(targetKey('tvdb', { id: 121361 })).toBe('121361'));
});

describe('targetKey — edges', () => {
  /**
   * An empty (or entirely punctuation) title. `slug('')` is `''`, so the key
   * is the bare separator. Asserted identically on the backend side.
   */
  it('empty title → the bare separator', () => {
    expect(targetKey('title', { title: '' })).toBe('|');
    expect(targetKey('title', {})).toBe('|');
    expect(targetKey('title', { title: '', year: '2011' })).toBe('|2011');
    expect(targetKey('title', { title: '!!!' })).toBe('|');
  });

  it('tmdb source stringifies its id', () => expect(targetKey('tmdb', { id: '438631' })).toBe('438631'));
});

describe('slug', () => {
  it('is idempotent on an already-slugged string', () => {
    const once = slug('Spider-Man: No Way Home');
    expect(once).toBe('spider-man-no-way-home');
    expect(slug(once)).toBe(once);
    expect(slug(slug(once))).toBe(once);
  });

  it('collapses runs of non-alphanumerics into one hyphen and trims them', () => {
    expect(slug('  —Hello,   World!!  ')).toBe('hello-world');
  });

  it('is empty for a string with no letters or numbers', () => {
    expect(slug('')).toBe('');
    expect(slug('   ')).toBe('');
  });
});

// ── community ratings ────────────────────────────────────────────────────────

describe('aggregateFresh', () => {
  const TTL = 5 * 60 * 1000;
  const now = 1_700_000_000_000;

  it('is fresh inside the TTL', () => {
    expect(aggregateFresh(now, now, TTL)).toBe(true);
    expect(aggregateFresh(now - TTL + 1, now, TTL)).toBe(true);
  });

  it('is stale exactly at the TTL — max-age=300 means good for 300, not 301', () => {
    expect(aggregateFresh(now - TTL, now, TTL)).toBe(false);
  });

  it('is stale past the TTL', () => {
    expect(aggregateFresh(now - TTL - 1, now, TTL)).toBe(false);
    expect(aggregateFresh(now - 86_400_000, now, TTL)).toBe(false);
  });

  it('treats a future timestamp as stale, not fresh-forever', () => {
    // A restored backup or a corrected clock; refetching once is cheap, being
    // frozen until the clock catches up is not.
    expect(aggregateFresh(now + 1, now, TTL)).toBe(false);
    expect(aggregateFresh(now + 86_400_000, now, TTL)).toBe(false);
  });

  it('has nothing to be fresh about when there is no timestamp', () => {
    expect(aggregateFresh(null, now, TTL)).toBe(false);
    expect(aggregateFresh(undefined, now, TTL)).toBe(false);
    expect(aggregateFresh(0, now, TTL)).toBe(false);
    expect(aggregateFresh(Number.NaN, now, TTL)).toBe(false);
  });
});

describe('communityScore', () => {
  it('is null when nobody has voted', () => {
    expect(communityScore(0, 0)).toBeNull();
    expect(communityScore(-1, 10)).toBeNull();
  });

  it('averages the votes cast, to one decimal', () => {
    expect(communityScore(1, 8)).toBe(8);
    expect(communityScore(4, 34)).toBe(8.5);
    expect(communityScore(3, 25)).toBe(8.3); // 8.333… rounds down
    expect(communityScore(3, 26)).toBe(8.7); // 8.666… rounds up
  });

  it('lets emotion-only votes drag the average down — the documented reading', () => {
    // Four people scored a 10 each; one reacted with an emotion and no score.
    // vote_count counts PEOPLE, so the divisor is 5 and the answer is 8, not
    // 10. There is no scored_count in the schema to divide by instead; see the
    // note on communityScore. Do not "fix" this.
    expect(communityScore(5, 40)).toBe(8);
    // Every vote emotion-only: a true zero, which the UI hides rather than
    // presenting as a verdict.
    expect(communityScore(7, 0)).toBe(0);
  });
});

describe('topEmotion', () => {
  it('is null for nothing at all', () => {
    expect(topEmotion(null)).toBeNull();
    expect(topEmotion(undefined)).toBeNull();
    expect(topEmotion({})).toBeNull();
    expect(topEmotion('{}')).toBeNull();
    expect(topEmotion('')).toBeNull();
  });

  it('reads the parsed object the API returns', () => {
    expect(topEmotion({ scared: 62, sad: 38 })).toEqual({ emotion: 'scared', percent: 62 });
  });

  it('reads a raw JSON string just as happily', () => {
    expect(topEmotion('{"love":3,"fun":1}')).toEqual({ emotion: 'love', percent: 75 });
  });

  it('is a flat 100% when only one emotion was cast', () => {
    expect(topEmotion({ wow: 9 })).toEqual({ emotion: 'wow', percent: 100 });
  });

  it('breaks ties alphabetically so the label never flickers', () => {
    expect(topEmotion({ scared: 40, angry: 40 })).toEqual({ emotion: 'angry', percent: 50 });
    // ...whichever order the blob happens to arrive in
    expect(topEmotion({ angry: 40, scared: 40 })).toEqual({ emotion: 'angry', percent: 50 });
    expect(topEmotion({ wow: 5, fun: 5, sad: 5 })).toEqual({ emotion: 'fun', percent: 33 });
  });

  it('returns null rather than throwing on malformed or hostile input', () => {
    expect(topEmotion('{"love":')).toBeNull();
    expect(topEmotion('not json at all')).toBeNull();
    expect(topEmotion('[1,2,3]')).toBeNull();
    expect(topEmotion([{ love: 1 }])).toBeNull();
    expect(topEmotion(42)).toBeNull();
  });

  it('ignores zero, negative and non-numeric counts', () => {
    expect(topEmotion({ love: 0, fun: 0 })).toBeNull();
    expect(topEmotion({ love: -3, fun: 2 })).toEqual({ emotion: 'fun', percent: 100 });
    expect(topEmotion({ love: 'lots', fun: 2 })).toEqual({ emotion: 'fun', percent: 100 });
  });
});

describe('starPercents (the column under the stars)', () => {
  it('divides by the SCORED votes, not by vote_count', () => {
    // Two people voted; only one gave a star, the other only tapped a feeling.
    // The star column is a distribution of the ratings GIVEN, so the
    // emotion-only voter must not dilute it into summing to 50.
    expect(starPercents({ '10': 1 }, 2)).toEqual([0, 0, 0, 0, 100]);
    const split = starPercents({ '2': 1, '10': 1 }, 7);
    expect(split).toEqual([50, 0, 0, 0, 50]);
    expect((split ?? []).reduce((x, y) => x + y, 0)).toBe(100);
  });

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  it('has nothing to say without data', () => {
    expect(starPercents({}, 0)).toBeNull();
    expect(starPercents({}, 5)).toBeNull();
    expect(starPercents(null, 5)).toBeNull();
    expect(starPercents(undefined, 5)).toBeNull();
    // a blob with counts but a rollup that says nobody voted: the count wins,
    // because that is the figure the screen gates on
    expect(starPercents({ '10': 4 }, 0)).toBeNull();
    expect(starPercents({ '10': 4 }, -3)).toBeNull();
    expect(starPercents({ '10': 0, '2': 0 }, 5)).toBeNull();
  });

  it('reads buckets 2/4/6/8/10 as one to five stars', () => {
    expect(starPercents({ '2': 1 }, 1)).toEqual([100, 0, 0, 0, 0]);
    expect(starPercents({ '4': 1 }, 1)).toEqual([0, 100, 0, 0, 0]);
    expect(starPercents({ '6': 1 }, 1)).toEqual([0, 0, 100, 0, 0]);
    expect(starPercents({ '8': 1 }, 1)).toEqual([0, 0, 0, 100, 0]);
    expect(starPercents({ '10': 1 }, 1)).toEqual([0, 0, 0, 0, 100]);
  });

  it('puts every vote on one star when that is where they all went', () => {
    expect(starPercents({ '10': 5 }, 5)).toEqual([0, 0, 0, 0, 100]);
  });

  it('sums to exactly 100 where naive rounding would read 101', () => {
    // three equal shares: Math.round each gives 33+33+33 = 99
    const thirds = starPercents({ '2': 1, '6': 1, '10': 1 }, 3);
    expect(sum(thirds!)).toBe(100);
    expect(thirds).toEqual([34, 0, 33, 0, 33]);

    // 1/1/1/1/2 over six: Math.round each gives 17+17+17+17+33 = 101
    const sixths = starPercents({ '2': 1, '4': 1, '6': 1, '8': 1, '10': 2 }, 6);
    expect(sum(sixths!)).toBe(100);
    expect(sixths).toEqual([17, 17, 17, 16, 33]);

    // the design's own episode
    const design = starPercents({ '6': 5, '8': 13, '10': 82 }, 100);
    expect(design).toEqual([0, 0, 5, 13, 82]);
    expect(sum(design!)).toBe(100);
  });

  it('always sums to 100, whatever the split', () => {
    for (let a = 0; a <= 7; a++) {
      for (let b = 0; b <= 7; b++) {
        for (let c = 0; c <= 7; c++) {
          if (a + b + c === 0) continue;
          const p = starPercents({ '2': a, '6': b, '10': c }, a + b + c);
          expect(sum(p!)).toBe(100);
        }
      }
    }
  });

  it('ignores buckets outside the valid set rather than throwing', () => {
    // a half-star build sending odd scores must not skew the five columns
    expect(starPercents({ '10': 1, '9': 99, '7': 5, '0': 3 }, 108)).toEqual([0, 0, 0, 0, 100]);
    expect(starPercents({ '2': 1, '3': 1 }, 2)).toEqual([100, 0, 0, 0, 0]);
  });

  it('ignores zero, negative and non-numeric counts', () => {
    expect(starPercents({ '2': -5, '10': 2 }, 2)).toEqual([0, 0, 0, 0, 100]);
    expect(starPercents({ '2': 'lots', '10': 2 }, 2)).toEqual([0, 0, 0, 0, 100]);
    expect(starPercents({ '2': Number.NaN, '10': 2 }, 2)).toEqual([0, 0, 0, 0, 100]);
  });

  it('accepts the JSON string a cache round-trip can hand back', () => {
    expect(starPercents('{"10":3,"8":1}', 4)).toEqual([0, 0, 0, 25, 75]);
  });

  it('returns null rather than throwing on malformed or hostile input', () => {
    expect(starPercents('{"10":', 4)).toBeNull();
    expect(starPercents('not json at all', 4)).toBeNull();
    expect(starPercents('[1,2,3]', 4)).toBeNull();
    expect(starPercents([{ '10': 1 }], 4)).toBeNull();
    expect(starPercents(42, 4)).toBeNull();
    expect(starPercents({ '10': 1 }, Number.NaN)).toBeNull();
  });
});

describe('emotionPercents (the figure under each tile)', () => {
  const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

  it('is empty, never null, when there is nothing to show', () => {
    expect(emotionPercents({})).toEqual({});
    expect(emotionPercents(null)).toEqual({});
    expect(emotionPercents(undefined)).toEqual({});
    expect(emotionPercents({ shocked: 0, sad: 0 })).toEqual({});
  });

  it('divides by the SELECTIONS, so one person picking two feelings is 50/50', () => {
    // The reported bug, exactly: `emotion_counts` counts selections and
    // `vote_count` counts people, so a single voter who tapped both tiles is
    // {shocked:1, thrilled:1} against a vote_count of 1. Over the vote count
    // that reads 100% and 100%; over the selections it reads what it means.
    expect(emotionPercents({ shocked: 1, thrilled: 1 })).toEqual({ shocked: 50, thrilled: 50 });
  });

  it('gives a lone emotion the whole hundred', () => {
    expect(emotionPercents({ shocked: 7 })).toEqual({ shocked: 100 });
  });

  it('does not consult vote_count at all — a drifted rollup still renders', () => {
    // `counter_repair` runs nightly; until it does, a count and its blob can
    // disagree. The counts are what the figures are made of.
    expect(emotionPercents({ shocked: 3 })).toEqual({ shocked: 100 });
  });

  it('splits ties without losing a point', () => {
    expect(emotionPercents({ scared: 40, angry: 40 })).toEqual({ angry: 50, scared: 50 });
    // three equal ways: someone must get 34, and it is the same one every time
    const thirds = emotionPercents({ wow: 5, fun: 5, sad: 5 });
    expect(sum(thirds)).toBe(100);
    expect(thirds).toEqual({ fun: 34, sad: 33, wow: 33 });
    // ...whichever order the blob happens to arrive in
    expect(emotionPercents({ sad: 5, wow: 5, fun: 5 })).toEqual(thirds);
  });

  it('sums to 100 when every vote carries an emotion', () => {
    const m = emotionPercents({ shocked: 43, reflective: 1, sad: 31, amused: 25 });
    expect(sum(m)).toBe(100);
    expect(m).toEqual({ shocked: 43, reflective: 1, sad: 31, amused: 25 });
  });

  it('sums to 100 for awkward splits too', () => {
    for (let a = 1; a <= 9; a++) {
      for (let b = 1; b <= 9; b++) {
        for (let c = 1; c <= 9; c++) {
          expect(sum(emotionPercents({ a, b, c }))).toBe(100);
        }
      }
    }
  });

  it('keeps an unknown emotion in the denominator', () => {
    // a newer client's emotion has no tile here, but dropping it would inflate
    // every figure that does have one
    expect(emotionPercents({ shocked: 1, brandnew: 1 })).toEqual({ brandnew: 50, shocked: 50 });
  });

  it('ignores zero, negative and non-numeric counts', () => {
    expect(emotionPercents({ shocked: -3, sad: 2 })).toEqual({ shocked: 0, sad: 100 });
    expect(emotionPercents({ shocked: 'lots', sad: 2 })).toEqual({ shocked: 0, sad: 100 });
  });

  it('accepts the JSON string a cache round-trip can hand back', () => {
    expect(emotionPercents('{"sad":1,"shocked":3}')).toEqual({ sad: 25, shocked: 75 });
  });

  it('returns {} rather than throwing on malformed or hostile input', () => {
    expect(emotionPercents('{"sad":')).toEqual({});
    expect(emotionPercents('not json at all')).toEqual({});
    expect(emotionPercents('[1,2,3]')).toEqual({});
    expect(emotionPercents([{ sad: 1 }])).toEqual({});
    expect(emotionPercents(42)).toEqual({});
    expect(emotionPercents(Number.NaN)).toEqual({});
  });
});

describe('characterPercents (the figure under each face in the favourite poll)', () => {
  const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
  const items = (o: Record<string, number>) =>
    Object.entries(o).map(([character, votes]) => ({ character, votes }));

  it('is empty, never null, when nobody has voted', () => {
    expect(characterPercents([], 0)).toEqual({});
    expect(characterPercents([])).toEqual({});
    // the shape the screen must render as NOTHING — no zeroes, no placeholder
    expect(characterPercents(items({ Michael: 0 }), 0)).toEqual({});
  });

  it('gives a lone favourite the whole hundred', () => {
    expect(characterPercents(items({ Michael: 7 }), 7)).toEqual({ Michael: 100 });
  });

  it('splits ties without losing a point, in a stable order', () => {
    expect(characterPercents(items({ Dwight: 4, Jim: 4 }), 8)).toEqual({ Dwight: 50, Jim: 50 });
    const thirds = characterPercents(items({ Pam: 5, Jim: 5, Dwight: 5 }), 15);
    expect(sum(thirds)).toBe(100);
    // sorted by name before the tie-break, so the blob's key order cannot move it
    expect(characterPercents(items({ Jim: 5, Dwight: 5, Pam: 5 }), 15)).toEqual(thirds);
  });

  it('sums to 100 for every awkward split', () => {
    for (let a = 1; a <= 9; a++) {
      for (let b = 1; b <= 9; b++) {
        for (let c = 1; c <= 9; c++) {
          expect(sum(characterPercents(items({ a, b, c }), a + b + c))).toBe(100);
        }
      }
    }
  });

  it('divides by the votes it was given, not by a drifted `total`', () => {
    // The rollup is maintained on write and recounted nightly; between those
    // two a `total` can disagree with its counts. The counts are what the
    // figures are made of, so they still add up.
    const m = characterPercents(items({ Jim: 3, Pam: 1 }), 99);
    expect(m).toEqual({ Jim: 75, Pam: 25 });
    expect(sum(m)).toBe(100);
  });

  it('believes a server that says nobody has voted', () => {
    expect(characterPercents(items({ Jim: 3 }), 0)).toEqual({});
    expect(characterPercents(items({ Jim: 3 }), -1)).toEqual({});
  });

  it('folds a repeated name instead of drawing it twice', () => {
    expect(characterPercents([{ character: 'Jim', votes: 1 }, { character: 'Jim', votes: 3 }], 4)).toEqual({
      Jim: 100,
    });
  });

  it('returns {} rather than throwing on malformed or hostile input', () => {
    expect(characterPercents(null)).toEqual({});
    expect(characterPercents(undefined)).toEqual({});
    expect(characterPercents('not an array')).toEqual({});
    expect(characterPercents(42)).toEqual({});
    expect(characterPercents({ Jim: 3 })).toEqual({});
    expect(characterPercents([null, 'Jim', 7, []])).toEqual({});
    expect(characterPercents([{ character: '', votes: 3 }])).toEqual({});
    expect(characterPercents([{ character: 'Jim' }])).toEqual({});
    expect(characterPercents([{ character: 'Jim', votes: 'lots' }])).toEqual({});
    expect(characterPercents([{ character: 'Jim', votes: Number.NaN }])).toEqual({});
    expect(characterPercents([{ character: 'Jim', votes: -4 }])).toEqual({});
  });

  it('ignores the bad rows and still totals the good ones', () => {
    expect(characterPercents([{ character: 'Jim', votes: 1 }, null, { character: 'Pam', votes: 1 }], 2)).toEqual({
      Jim: 50,
      Pam: 50,
    });
  });
});

describe('characterFace (the character, not the performer)', () => {
  it('prefers the character image when there is one', () => {
    expect(characterFace({ photo: 'actor.jpg', charPhoto: 'character.jpg' })).toBe('character.jpg');
  });

  it('falls back to the performer when the work has no character art', () => {
    // TMDB-sourced cast is exactly this: a `profile_path` headshot and nothing
    // else. Better a face than an empty tile.
    expect(characterFace({ photo: 'actor.jpg', charPhoto: null })).toBe('actor.jpg');
    expect(characterFace({ photo: 'actor.jpg' })).toBe('actor.jpg');
  });

  it('is null when there is neither', () => {
    expect(characterFace({ photo: null, charPhoto: null })).toBeNull();
    expect(characterFace({})).toBeNull();
    expect(characterFace(null)).toBeNull();
    expect(characterFace(undefined)).toBeNull();
  });

  it('treats an empty or blank URL as absent, not as an image', () => {
    // `artworkUrl` returns '' for a missing path; rendering that is a broken tile
    expect(characterFace({ photo: 'actor.jpg', charPhoto: '' })).toBe('actor.jpg');
    expect(characterFace({ photo: 'actor.jpg', charPhoto: '   ' })).toBe('actor.jpg');
    expect(characterFace({ photo: '', charPhoto: '' })).toBeNull();
  });

  it('ignores a non-string where a URL should be', () => {
    expect(characterFace({ photo: 'actor.jpg', charPhoto: 7 as unknown as string })).toBe('actor.jpg');
  });

  it('falls back per entry, not per film', () => {
    // Shawshank on TheTVDB: Andy and Red have character art, Warden Norton does
    // not. The warden shows Bob Gunton; the other two must still show the film.
    const cast = [
      { name: 'Tim Robbins', photo: 'robbins.jpg', charPhoto: 'andy.jpg' },
      { name: 'Morgan Freeman', photo: 'freeman.jpg', charPhoto: 'red.jpg' },
      { name: 'Bob Gunton', photo: 'gunton.jpg', charPhoto: null },
    ];
    expect(cast.map(characterFace)).toEqual(['andy.jpg', 'red.jpg', 'gunton.jpg']);
  });
});

describe('localCommentToSeed and picture-only comments', () => {
  const resolve = () => ({ source: 'tvdb' as const, key: '1' });
  const base = { entity: 'Attack on Titan S4E28', text: '', date: '2022-01-08 00:51:40' };

  it('keeps a comment that is a photograph with no caption', () => {
    const item = localCommentToSeed({ ...base, image: 'comment-img-bg-3.jpg' }, resolve);
    expect(item).toMatchObject({ body: '', has_image: true });
  });

  it('keeps it even when the file never downloaded — the CDN died mid-import', () => {
    // `imageUrl` is the export's own proof the post WAS a picture. Losing the
    // photograph must not also lose the comment.
    const item = localCommentToSeed({ ...base, imageUrl: 'https://dead.cdn/x.jpg' }, resolve);
    expect(item).toMatchObject({ body: '', has_image: true });
  });

  it('still drops a comment with neither words nor a picture', () => {
    expect(localCommentToSeed({ ...base }, resolve)).toBeNull();
    expect(localCommentToSeed({ ...base, image: '  ', imageUrl: '' }, resolve)).toBeNull();
  });

  it('does not claim an image on an ordinary comment', () => {
    const item = localCommentToSeed({ ...base, text: '10/10' }, resolve);
    expect(item).toMatchObject({ body: '10/10' });
    expect(item).not.toHaveProperty('has_image');
  });
});

describe('pollLabel', () => {
  it('strips the (voice) suffix TheTVDB puts on an animated cast', () => {
    expect(pollLabel({ character: 'Woody (voice)' })).toBe('Woody');
    expect(pollLabel({ character: 'Buzz Lightyear (VOICE)' })).toBe('Buzz Lightyear');
  });

  it('falls back to the performer, and is empty when there is neither', () => {
    expect(pollLabel({ name: 'Tim Robbins' })).toBe('Tim Robbins');
    expect(pollLabel({})).toBe('');
  });

  it('does not strip a bracket that is part of the name', () => {
    expect(pollLabel({ character: 'The Voice' })).toBe('The Voice');
    expect(pollLabel({ character: 'Woody (voice) II' })).toBe('Woody (voice) II');
  });
});

describe('orderPollCast (most-voted first)', () => {
  const cast = [
    { character: 'Brooks' },
    { character: 'Andy' },
    { character: 'Red' },
    { character: 'Woody (voice)' },
  ];

  it('puts the community favourite first', () => {
    const ordered = orderPollCast(cast, { Andy: 60, Red: 30, Brooks: 10 });
    expect(ordered.map((c) => c.character)).toEqual(['Andy', 'Red', 'Brooks', 'Woody (voice)']);
  });

  it('looks votes up by the SAME label the tile shows', () => {
    // Stored as "Woody", displayed as "Woody" — the suffix must not hide it.
    expect(orderPollCast(cast, { Woody: 99 })[0].character).toBe('Woody (voice)');
  });

  it('leaves the catalogues’ order alone where nobody has voted', () => {
    expect(orderPollCast(cast, {}).map((c) => c.character)).toEqual(cast.map((c) => c.character));
  });

  it('is stable, so an unvoted row does not reshuffle on every refetch', () => {
    const once = orderPollCast(cast, { Andy: 100 }).map((c) => c.character);
    const twice = orderPollCast(orderPollCast(cast, { Andy: 100 }), { Andy: 100 }).map((c) => c.character);
    expect(twice).toEqual(once);
  });

  it('does not mutate the caller’s array', () => {
    const input = [...cast];
    orderPollCast(input, { Red: 90 });
    expect(input).toEqual(cast);
  });
});

describe('mergeCastForPoll (both catalogues, merged per person)', () => {
  const andyTvdb = { name: 'Tim Robbins', character: 'Andy Dufresne', photo: 'robbins.jpg', charPhoto: 'andy.jpg' };
  const andyTmdb = { name: 'Tim Robbins', character: 'Andy Dufresne', photo: 'robbins-tmdb.jpg', charPhoto: null };

  it('keeps TheTVDB character art — the whole reason the poll prefers it', () => {
    expect(mergeCastForPoll([andyTvdb], [andyTmdb])[0].charPhoto).toBe('andy.jpg');
  });

  it('does not let TMDB overwrite a field TheTVDB already has', () => {
    expect(mergeCastForPoll([andyTvdb], [andyTmdb])[0].photo).toBe('robbins.jpg');
  });

  it('fills a hole TheTVDB left, instead of rendering a blank tile', () => {
    // TheTVDB's film records are thin: a character with no headshot at all.
    const thin = { name: null, character: 'Andy Dufresne', photo: '', charPhoto: null };
    const [merged] = mergeCastForPoll([thin], [andyTmdb]);
    expect(merged.photo).toBe('robbins-tmdb.jpg');
    expect(merged.name).toBe('Tim Robbins');
  });

  it('appends people TheTVDB never listed rather than dropping them', () => {
    const red = { name: 'Morgan Freeman', character: 'Ellis Boyd Redding', photo: 'freeman.jpg', charPhoto: null };
    const merged = mergeCastForPoll([andyTvdb], [andyTmdb, red]);
    expect(merged.map((c) => c.character)).toEqual(['Andy Dufresne', 'Ellis Boyd Redding']);
  });

  it('matches on the role regardless of spacing, case or accents', () => {
    const loose = { name: null, character: '  ANDY   DUFRESNE ', photo: 'x.jpg', charPhoto: null };
    expect(mergeCastForPoll([andyTvdb], [loose])).toHaveLength(1);
  });

  it('falls back to the performer when no record has a role, and merges the same person once', () => {
    // A role-less list survives the crew cut whole, so the performer key is
    // what decides who is who.
    const a = { name: 'Andrew Stanton', character: null, photo: '', charPhoto: null };
    const b = { name: 'andrew  stanton', character: null, photo: 'stanton.jpg', charPhoto: null };
    const c = { name: 'Pete Docter', character: null, photo: 'docter.jpg', charPhoto: null };
    const merged = mergeCastForPoll([a], [b, c]);
    expect(merged).toHaveLength(2);
    expect(merged[0].photo).toBe('stanton.jpg'); // the hole filled from the other source
  });

  it('never keys a performer onto a character who shares the name', () => {
    const person = { name: 'Woody Harrelson', character: null, photo: 'w.jpg', charPhoto: null };
    const role = { name: 'Tom Hanks', character: 'Woody', photo: 't.jpg', charPhoto: null };
    // `p:` and `c:` are different namespaces, so these never merge — the crew
    // cut then removes the role-less one, leaving the character.
    expect(mergeCastForPoll([person], [role]).map((c) => c.name)).toEqual(['Tom Hanks']);
  });

  it('drops crew — TheTVDB files directors in the character list with no role', () => {
    // Toy Story 5 opened its poll with two portraits of Andrew Stanton.
    const crew = { name: 'Andrew Stanton', character: null, photo: 'stanton.jpg', charPhoto: null };
    expect(mergeCastForPoll([crew, andyTvdb], [andyTmdb]).map((c) => c.name)).toEqual(['Tim Robbins']);
  });

  it('keeps crew when nothing has a role — an empty poll is worse than a wrong one', () => {
    const crew = [{ name: 'Andrew Stanton', character: null, photo: 'stanton.jpg', charPhoto: null }];
    expect(mergeCastForPoll(crew, [])).toEqual(crew);
  });

  it('offers only pictured characters once there are enough of them', () => {
    // Shawshank: 3 of 36 have character art. Those three are the poll.
    const pictured = ['Andy', 'Red', 'Hadley'].map((n) => ({
      name: `${n} actor`,
      character: n,
      photo: 'now.jpg',
      charPhoto: `${n}.jpg`,
    }));
    const bare = ['Brooks', 'Bogs'].map((n) => ({ name: `${n} actor`, character: n, photo: 'now.jpg', charPhoto: null }));
    expect(mergeCastForPoll([...pictured, ...bare], []).map((c) => c.character)).toEqual(['Andy', 'Red', 'Hadley']);
  });

  it('keeps everyone when too few are pictured to make a poll', () => {
    const one = { name: 'A actor', character: 'A', photo: 'now.jpg', charPhoto: 'a.jpg' };
    const bare = ['B', 'C'].map((n) => ({ name: `${n} actor`, character: n, photo: 'now.jpg', charPhoto: null }));
    expect(mergeCastForPoll([one, ...bare], [])).toHaveLength(3);
  });

  it('uses either source alone when the other is missing', () => {
    // an untracked or unmatched film may have no TheTVDB id at all
    expect(mergeCastForPoll(null, [andyTmdb])).toEqual([andyTmdb]);
    expect(mergeCastForPoll([], [andyTmdb])).toEqual([andyTmdb]);
    expect(mergeCastForPoll([andyTvdb], null)).toEqual([andyTvdb]);
    expect(mergeCastForPoll([andyTvdb], [])).toEqual([andyTvdb]);
  });

  it('is empty when neither has one, so the poll simply does not render', () => {
    expect(mergeCastForPoll(null, null)).toEqual([]);
    expect(mergeCastForPoll([], [])).toEqual([]);
    expect(mergeCastForPoll(undefined, undefined)).toEqual([]);
  });

  it('does not mutate either input', () => {
    const tvdb = [{ ...andyTvdb }];
    const tmdb = [{ ...andyTmdb }];
    mergeCastForPoll(tvdb, tmdb);
    expect(tvdb).toEqual([andyTvdb]);
    expect(tmdb).toEqual([andyTmdb]);
  });
});

describe('nextCharacterVote (tap to pick, tap again to clear)', () => {
  it('picks when there was nothing picked', () => {
    expect(nextCharacterVote(null, 'Jim')).toBe('Jim');
    expect(nextCharacterVote(undefined, 'Jim')).toBe('Jim');
  });

  it('clears when the current favourite is tapped again', () => {
    expect(nextCharacterVote('Jim', 'Jim')).toBeNull();
  });

  it('replaces when somebody else is tapped', () => {
    expect(nextCharacterVote('Jim', 'Pam')).toBe('Pam');
  });

  it('is case- and space-sensitive: two spellings are two characters', () => {
    expect(nextCharacterVote('Jim', 'jim')).toBe('jim');
    expect(nextCharacterVote('Jim', 'Jim ')).toBe('Jim ');
  });
});

describe('mergeFollowList (TV Time friends and OpenTV follows are one list)', () => {
  const archive = [
    { id: '52613783', name: 'AEnderDragonA', image: 'a.jpg' },
    { id: '53635487', name: 'tawfek', imageUrl: 'https://dead/x.jpg' },
    { id: '12137674', name: null },
  ];

  it('keeps a friend who joined as ONE row, carrying their handle', () => {
    const rows = mergeFollowList(
      archive,
      [{ handle: 'tawfek_', display_name: 'Tawfek', avatar_key: 'av/t.jpg' }],
      [{ handle: 'tawfek_', tvtime_user_id: 53635487 }],
      'Member',
    );
    expect(rows).toHaveLength(3);
    const t = rows.find((r) => r.handle === 'tawfek_')!;
    expect(t.onOpenTV).toBe(true);
    // The name they use NOW wins over the one the export remembered.
    expect(t.name).toBe('Tawfek');
  });

  it('marks a friend who has not joined, so the row can offer an invite', () => {
    const rows = mergeFollowList(archive, [], [], 'Member');
    expect(rows.every((r) => !r.onOpenTV)).toBe(true);
    expect(rows.map((r) => r.name)).toEqual(['AEnderDragonA', 'tawfek', 'Member']);
  });

  it('dedupes by TV TIME ID, never by name', () => {
    // This export really does contain both "Sarah" and "sarah".
    const two = [
      { id: '61219384', name: 'Sarah' },
      { id: '63756975', name: 'sarah' },
    ];
    const rows = mergeFollowList(two, [], [], 'Member');
    expect(rows).toHaveLength(2);
  });

  it('appends people met on OpenTV who were never TV Time friends', () => {
    const rows = mergeFollowList(archive, [{ handle: 'newcomer' }], [], 'Member');
    expect(rows).toHaveLength(4);
    // Archive order first: a name known for years outranks a handle just met.
    expect(rows[3].handle).toBe('newcomer');
  });

  it('does not claim a handle whose match carries no id', () => {
    // A match stored before the server returned tvtime_user_id.
    const rows = mergeFollowList(archive, [{ handle: 'tawfek_' }], [{ handle: 'tawfek_' }], 'Member');
    expect(rows).toHaveLength(4);
  });

  it('falls back to the handle when nobody has a display name', () => {
    const rows = mergeFollowList([], [{ handle: 'solo', display_name: null }], [], 'Member');
    expect(rows[0].name).toBe('@solo');
  });

  it('is empty for an empty archive and an empty community', () => {
    expect(mergeFollowList([], [], [], 'Member')).toEqual([]);
  });
});

describe('mergedFollowTotal', () => {
  const archive = [{ id: '1' }, { id: '2' }, { id: '3' }];

  it('counts a friend who joined once, not twice', () => {
    // 3 in the archive, 1 of whom is among the server's 2.
    expect(mergedFollowTotal(archive, [{ tvtime_user_id: 2 }], 2)).toBe(4);
  });

  it('is the archive plus everybody met here when none overlap', () => {
    expect(mergedFollowTotal(archive, [], 2)).toBe(5);
  });

  it('is the server count alone for a library with no archive', () => {
    expect(mergedFollowTotal([], [{ tvtime_user_id: 2 }], 7)).toBe(7);
  });

  it('is the archive alone before anybody has joined', () => {
    expect(mergedFollowTotal(archive, [], 0)).toBe(3);
  });

  it('never subtracts more than the server counted', () => {
    // A stale match: someone matched once and has since deleted their account.
    expect(mergedFollowTotal(archive, [{ tvtime_user_id: 1 }, { tvtime_user_id: 2 }], 0)).toBe(3);
  });

  it('ignores a match with no id — it cannot be tied to an archive row', () => {
    expect(mergedFollowTotal(archive, [{ tvtime_user_id: null }], 1)).toBe(4);
  });
});

describe('unmatchedArchiveFriends (who is still not here)', () => {
  const archive = [{ id: '1', name: 'Sara' }, { id: '2', name: 'sarah' }, { id: '3', name: 'Omar' }];

  it('drops the friends who have joined', () => {
    expect(unmatchedArchiveFriends(archive, [{ tvtime_user_id: 2 }]).map((f) => f.id)).toEqual(['1', '3']);
  });

  it('is everybody when nobody has joined', () => {
    expect(unmatchedArchiveFriends(archive, [])).toHaveLength(3);
  });

  it('keeps a friend when the match carries no tvtime id — it claims nobody', () => {
    expect(unmatchedArchiveFriends(archive, [{ tvtime_user_id: null }])).toHaveLength(3);
  });

  it('is empty when everyone is already here', () => {
    expect(
      unmatchedArchiveFriends(archive, [{ tvtime_user_id: 1 }, { tvtime_user_id: 2 }, { tvtime_user_id: 3 }]),
    ).toEqual([]);
  });
});

describe('reconnectBannerCount', () => {
  it('offers the banner when nothing has been dismissed', () => {
    expect(reconnectBannerCount(3, null)).toBe(3);
  });

  it('stays quiet for a set already dismissed', () => {
    expect(reconnectBannerCount(3, '3')).toBe(0);
  });

  it('speaks again when a fourth friend arrives', () => {
    expect(reconnectBannerCount(4, '3')).toBe(4);
  });

  it('says nothing when there are no matches at all', () => {
    expect(reconnectBannerCount(0, null)).toBe(0);
  });

  it('treats junk in the meta key as never dismissed', () => {
    expect(reconnectBannerCount(2, 'yes')).toBe(2);
  });
});

describe('localPictureIndex (the server stores pictures and serves none)', () => {
  const gif = { text: '', date: '2022-01-08 00:51:40', image: 'aot.gif', ratio: 0.71 };
  const words = { text: '10/10', date: '2026-06-24 12:00:00', image: 'toy.jpg' };

  it('finds the file for a picture-only comment the server returned bodyless', () => {
    const index = localPictureIndex([gif, words]);
    const hit = index.get(pictureKeyOf({ body: '', created_at: '2022-01-08T00:51:40.000Z' }));
    expect(hit?.image).toBe('aot.gif');
  });

  it('matches a comment that has words too', () => {
    const index = localPictureIndex([gif, words]);
    expect(index.get(pictureKeyOf({ body: '10/10', created_at: '2026-06-24T12:00:00.000Z' }))?.image).toBe('toy.jpg');
  });

  it('misses a comment written on another device, rather than guessing', () => {
    const index = localPictureIndex([gif]);
    expect(index.get(pictureKeyOf({ body: 'typed here', created_at: '2026-07-31T10:00:00.000Z' }))).toBeUndefined();
  });

  it('skips a row whose date cannot be read', () => {
    expect(localPictureIndex([{ text: '', date: 'whenever', image: 'x.gif' }]).size).toBe(0);
  });

  it('keeps the FIRST of two identical rows', () => {
    const index = localPictureIndex([gif, { ...gif, image: 'later.gif' }]);
    expect(index.get(pictureKeyOf({ body: '', created_at: '2022-01-08T00:51:40.000Z' }))?.image).toBe('aot.gif');
  });
});

describe('localCommentToSeed and TV Time’s episode zero', () => {
  const resolve = () => ({ source: 'tvdb' as const, key: '267440' });
  const at = { text: '', image: 'aot.gif', date: '2022-01-08 00:51:40' };

  it('KEEPS episode zero — it is a comment about an episode', () => {
    // TV Time really does record S4E0, in two files, against a real
    // episode_id. TheTVDB has no such episode, so no page lists it — but a gap
    // in the catalogue does not make the archive wrong, and rewriting the row
    // as a show comment discards the one thing it says about itself.
    const item = localCommentToSeed({ ...at, entity: 'Attack on Titan S4E0' }, resolve);
    expect(item).toMatchObject({ season: 4, episode: 0 });
  });

  it('leaves a real episode alone', () => {
    expect(localCommentToSeed({ ...at, entity: 'Attack on Titan S4E28' }, resolve)).toMatchObject({
      season: 4,
      episode: 28,
    });
  });

  it('leaves a season comment alone — that thread is reachable', () => {
    expect(localCommentToSeed({ ...at, entity: 'Attack on Titan S4' }, resolve)).toMatchObject({
      season: 4,
      episode: null,
    });
  });
});

describe('isOrphanedReply', () => {
  it('flags an imported reply whose original was never in the export', () => {
    // TV Time exported the user's own comments only, so the parent — somebody
    // else's words — is nowhere and cannot be imported by anybody.
    expect(isOrphanedReply({ type: 'reply' }, null)).toBe(true);
  });

  it('leaves an ordinary comment alone', () => {
    expect(isOrphanedReply({ type: 'comment' }, null)).toBe(false);
  });

  it('leaves a reply that DOES have its parent here alone', () => {
    expect(isOrphanedReply({ type: 'reply' }, 'imp_abc')).toBe(false);
  });

  it('says nothing about a comment this phone never imported', () => {
    expect(isOrphanedReply(undefined, null)).toBe(false);
  });
});

/**
 * The profile caps. These are numbers a product decision depends on, and the
 * decision was to set them BEFORE the community shipped — a cap added later
 * takes a shelf away from somebody who already has it. Pinned so a later edit
 * has to be deliberate rather than incidental.
 */
/**
 * The split grid — the rule between "on your profile" and "not". The maths has
 * to be an exact inverse in both directions or a drag lands a poster somewhere
 * the user did not aim, silently reordering their shelf.
 */
describe('split grid geometry', () => {
  // 3 columns, the phone case, where 20 does NOT divide evenly
  const geo = gridGeometry(390, 12, 3);
  const split = { at: 20, gapH: 44 };

  it('pads the published section to whole rows so the rule is straight', () => {
    // 20 items over 3 columns is 6 full rows + 2 — the section gets 7 rows,
    // its last row half empty, and everything below starts under the rule.
    const first = slotPosition(20, geo, split);
    expect(first.x).toBe(0);
    expect(first.y).toBeCloseTo(7 * geo.slotH + 44);
  });

  it('leaves the section above the rule untouched', () => {
    expect(slotPosition(0, geo, split)).toEqual(slotPosition(0, geo));
    expect(slotPosition(19, geo, split)).toEqual(slotPosition(19, geo));
  });

  it('round-trips: a slot position maps back to its own slot', () => {
    for (const order of [0, 1, 5, 18, 19, 20, 21, 25]) {
      const p = slotPosition(order, geo, split);
      expect(slotAt(p.x, p.y, 26, geo, split)).toBe(order);
    }
  });

  it('never lets a drop cross the rule by accident', () => {
    // just above the rule → last published slot; just below → first unpublished
    const above = slotAt(0, 7 * geo.slotH + 44 / 2 - 1, 26, geo, split);
    const below = slotAt(0, 7 * geo.slotH + 44 / 2 + 1, 26, geo, split);
    expect(above).toBeLessThan(20);
    expect(below).toBeGreaterThanOrEqual(20);
  });

  it('counts the gap in the total height', () => {
    expect(gridHeight(26, geo, split)).toBeCloseTo(7 * geo.slotH + 44 + 2 * geo.slotH);
    // no split, or nothing past it, and it is an ordinary grid again
    expect(gridHeight(26, geo)).toBeCloseTo(9 * geo.slotH);
    expect(gridHeight(15, geo, split)).toBeCloseTo(5 * geo.slotH);
  });

  it('puts the rule in the middle of the gap', () => {
    expect(splitLineY(geo, split)).toBeCloseTo(7 * geo.slotH + 22);
  });

  it('is exact at a column count that divides evenly too', () => {
    const wide = gridGeometry(1100, 12, 3); // more columns on a tablet
    const p = slotPosition(split.at, wide, split);
    expect(slotAt(p.x, p.y, 26, wide, split)).toBe(split.at);
  });
});

describe('profile caps', () => {
  it('shows twenty favourites and ten lists', () => {
    expect(PROFILE_FAVOURITE_LIMIT).toBe(20);
    expect(PROFILE_LIST_LIMIT).toBe(10);
  });

  it('caps by the owner drag order, not by recency', () => {
    // What `shelfShows` does: take the favourites in favoriteRank order, keep
    // the first N. The 21st is still a favourite on the device; it is simply
    // not one the profile shows.
    const favourites = Array.from({ length: 25 }, (_, i) => ({ tvdbId: 100 + i }));
    const published = favourites.slice(0, PROFILE_FAVOURITE_LIMIT);
    expect(published).toHaveLength(20);
    expect(published[0].tvdbId).toBe(100);
    expect(published.at(-1)?.tvdbId).toBe(119);
    expect(published.some((f) => f.tvdbId === 120)).toBe(false);
  });
});

describe('titlesForPublish (a shelf tile and a thread must point at the same thing)', () => {
  it('keys a show by its TheTVDB id', () => {
    const out = titlesForPublish([{ name: 'Attack on Titan', poster: 'a.jpg', favourite: true, rank: 0, tvdbId: 267440 }], 'show');
    expect(out[0]).toMatchObject({ target_source: 'tvdb', target_key: '267440', favourite: true });
  });

  it('keys a film exactly as its comments and ratings are keyed', () => {
    const out = titlesForPublish([{ name: 'Toy Story 5', poster: null, favourite: false, rank: null, year: '2026' }], 'movie');
    // Same rule as targetKey('title', …) — not a second spelling of it.
    expect(out[0]).toMatchObject({ target_source: 'title', target_key: 'toy-story-5|2026' });
  });

  it('drops a show with no id and a film with no name', () => {
    expect(titlesForPublish([{ name: 'No Id', poster: null, favourite: false, rank: null }], 'show')).toEqual([]);
    expect(titlesForPublish([{ name: '   ', poster: null, favourite: false, rank: null, year: '2020' }], 'movie')).toEqual([]);
  });

  it('drops a film whose name slugs to nothing, rather than sharing one key', () => {
    // "…" has no letters or digits: every such film would land on `|2020`,
    // colliding with each other AND with other profiles' unnameable films.
    expect(titlesForPublish([{ name: '…', poster: null, favourite: false, rank: null, year: '2020' }], 'movie')).toEqual([]);
  });

  it('keeps the owner’s order and their hearts', () => {
    const out = titlesForPublish(
      [
        { name: 'A', poster: null, favourite: true, rank: 0, tvdbId: 1 },
        { name: 'B', poster: null, favourite: false, rank: null, tvdbId: 2 },
      ],
      'show',
    );
    expect(out.map((t) => [t.favourite, t.rank])).toEqual([[true, 0], [false, null]]);
  });
});

describe('publishableStats', () => {
  it('keeps show and film minutes APART — the profile draws a card for each', () => {
    // And takes them as MINUTES: dividing by sixty here is what published
    // "1 day" for 3,385 episodes, since both getters already convert.
    expect(publishableStats({ episodes: 1105, showMinutes: 26_000, movieMinutes: 4_000 })).toEqual({
      episodes_watched: 1105,
      minutes_watched: 26_000,
      movie_minutes: 4_000,
    });
  });

  it('is zero rather than negative or NaN', () => {
    expect(publishableStats({ episodes: -5, showMinutes: Number.NaN, movieMinutes: -1 })).toEqual({
      episodes_watched: 0,
      minutes_watched: 0,
      movie_minutes: 0,
    });
  });
});

describe('watchRuntimeSeconds', () => {
  it('uses the row\'s own runtime when it has one', () => {
    expect(watchRuntimeSeconds(3420, 24)).toBe(3420);
  });

  it('falls back to the show metadata, in minutes', () => {
    expect(watchRuntimeSeconds(null, 57)).toBe(57 * 60);
  });

  /**
   * THE REGRESSION. Metadata is fetched lazily and half the bundled entries
   * carry no runtime, so Game of Thrones counted 24m an episode until the show
   * was opened — then jumped to ~57m. The show's own watches already knew.
   */
  it('prefers the show\'s own average to the 24-minute constant', () => {
    expect(watchRuntimeSeconds(null, null, 57 * 60)).toBe(57 * 60);
    expect(watchRuntimeSeconds(null, undefined, 57 * 60)).toBe(57 * 60);
  });

  it('takes the constant only when nothing else is known', () => {
    expect(watchRuntimeSeconds(null, null)).toBe(24 * 60);
    expect(watchRuntimeSeconds(0, 0, 0)).toBe(24 * 60);
  });
});

describe('suggestedHandle across writing systems', () => {
  it('keeps a latin name, slugging spaces and punctuation', () => {
    expect(suggestedHandle('Mahmood Bashar')).toBe('mahmood_bashar');
    expect(suggestedHandle('snailrider07')).toBe('snailrider07');
  });

  /**
   * The app ships in Arabic and a good part of its users write their names in
   * it. The slug rule keeps [a-z0-9_] and turns everything else into an
   * underscore, so an Arabic name reduced to nothing — or, worse, to the digits
   * that happened to be in it, which was then claimed silently on their behalf.
   */
  it('refuses a suggestion that no longer resembles the name', () => {
    expect(suggestedHandle('محمود')).toBeNull();
    expect(suggestedHandle('محمود بشار')).toBeNull();
    expect(suggestedHandle('محمود123')).toBeNull();
    expect(suggestedHandle('東京')).toBeNull();
  });

  it('takes the latin part when there is one', () => {
    expect(suggestedHandle('mahmood محمود')).toBe('mahmood');
  });
});

describe('bingeReport', () => {
  it('has nothing to say about an empty history', () => {
    expect(bingeReport([])).toEqual({
      biggestDay: 0,
      biggestDayDate: '',
      longestStreak: 0,
      activeDays: 0,
      perActiveDay: 0,
    });
  });

  it('finds the biggest day, the streak and the average', () => {
    const days = [
      '2026-01-01', '2026-01-01', '2026-01-01',
      '2026-01-02',
      '2026-01-03', '2026-01-03',
      // gap
      '2026-01-09',
    ];
    expect(bingeReport(days)).toEqual({
      biggestDay: 3,
      biggestDayDate: '2026-01-01',
      longestStreak: 3,
      activeDays: 4,
      perActiveDay: 1.8,
    });
  });

  it('reads a full timestamp as its calendar day', () => {
    expect(bingeReport(['2026-01-01 22:00:00', '2026-01-01 23:30:00']).biggestDay).toBe(2);
  });

  /** A month boundary is where naive day arithmetic breaks the streak. */
  it('counts across a month and a year boundary', () => {
    expect(bingeReport(['2025-12-30', '2025-12-31', '2026-01-01']).longestStreak).toBe(3);
  });
});

describe('ratingPersonality', () => {
  const counts = (one: number, two: number, three: number, four: number, five: number) => [one, two, three, four, five];

  it('says nothing until there are enough ratings', () => {
    expect(ratingPersonality(counts(0, 0, 0, 0, 0)).label).toBe('unrated');
    expect(ratingPersonality(counts(0, 0, 0, 2, 2)).label).toBe('unrated');
  });

  /** The mean of 1s and 5s is 3, which "balanced" would describe backwards. */
  it('calls a 1s-and-5s rater all-or-nothing, not balanced', () => {
    const p = ratingPersonality(counts(10, 0, 0, 0, 10));
    expect(p.mean).toBe(3);
    expect(p.label).toBe('allOrNothing');
  });

  it('calls a high mean generous and a low one tough', () => {
    expect(ratingPersonality(counts(0, 0, 0, 2, 20)).label).toBe('generous');
    expect(ratingPersonality(counts(20, 4, 0, 0, 0)).label).toBe('tough');
  });

  it('separates a narrow rater from a merely middling one', () => {
    expect(ratingPersonality(counts(0, 0, 0, 20, 0)).label).toBe('consistent');
    expect(ratingPersonality(counts(0, 4, 8, 8, 4)).label).toBe('balanced');
  });
});

describe('watchTimeShape', () => {
  it('refuses to draw a clock when the times are all import midnights', () => {
    const s = watchTimeShape(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-05 21:00:00']);
    expect(s.midnightShare).toBe(0.75);
    expect(s.clockIsReal).toBe(false);
    expect(s.hours[0]).toBe(3);
    expect(s.hours[21]).toBe(1);
  });

  it('draws the clock once real times outnumber the midnights', () => {
    const s = watchTimeShape(['2026-01-01', '2026-01-02 20:15:00', '2026-01-03 21:00:00']);
    expect(s.clockIsReal).toBe(true);
  });

  it('puts Monday first and Sunday last', () => {
    // 2026-01-05 is a Monday, 2026-01-11 the Sunday after
    const s = watchTimeShape(['2026-01-05', '2026-01-11']);
    expect(s.weekdays[0]).toBe(1);
    expect(s.weekdays[6]).toBe(1);
  });

  it('ignores a row with no parseable date', () => {
    expect(watchTimeShape(['', 'nonsense']).hours.every((h) => h === 0)).toBe(true);
  });
});

describe('contrarianScore', () => {
  it('withholds a number until there are enough overlapping titles', () => {
    expect(contrarianScore([1, 2, 3, 4])).toBeNull();
    expect(contrarianScore(new Array(CONTRARIAN_MIN_TITLES).fill(0))).toBe(0);
  });

  /** Signed deltas would cancel; somebody who disagrees in both directions is
   *  not "typical". */
  it('does not let opposite disagreements cancel out', () => {
    expect(contrarianScore([2, -2, 2, -2, 2])).toBe(50);
  });

  it('caps at 100 however far apart the opinions are', () => {
    expect(contrarianScore([9, 9, 9, 9, 9])).toBe(100);
  });
});

describe('annualSavingPercent', () => {
  it('computes the saving from the two real prices', () => {
    expect(annualSavingPercent(1.99, 14.99)).toBe(37);
    expect(annualSavingPercent(1.99, 19.99)).toBe(16);
  });

  it('says nothing rather than something false', () => {
    // an annual plan that costs MORE than twelve months has no saving to claim
    expect(annualSavingPercent(1.99, 29.99)).toBeNull();
    expect(annualSavingPercent(1.99, 23.88)).toBeNull(); // exactly 12×, 0%
    expect(annualSavingPercent(undefined, 14.99)).toBeNull();
    expect(annualSavingPercent(1.99, undefined)).toBeNull();
    expect(annualSavingPercent(0, 14.99)).toBeNull();
  });
});

describe('dominantAccent — the colour a show hands its theme', () => {
  /** Build RGBA pixels from repeated [r,g,b] triples. */
  const px = (...rgb: [number, number, number][]) => {
    const out = new Uint8Array(rgb.length * 4);
    rgb.forEach(([r, g, b], i) => {
      out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255;
    });
    return out;
  };

  it('finds the vivid colour and ignores the dark ground around it', () => {
    // A Matrix-ish frame: mostly near-black, some vivid green.
    const green: [number, number, number] = [40, 220, 90];
    const dark: [number, number, number] = [8, 10, 8];
    const img = px(dark, dark, dark, dark, dark, dark, green, green, dark, dark);
    const hex = dominantAccent(img, 1)!;
    expect(hex).not.toBeNull();
    // Green must dominate the result, whatever the exact shade.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it('says null for a greyscale poster rather than inventing a colour', () => {
    const img = px([20, 20, 20], [128, 128, 128], [230, 230, 230], [60, 60, 60]);
    expect(dominantAccent(img, 1)).toBeNull();
  });

  it('lifts a dark accent into a shade that reads on black, keeping the hue', () => {
    const img = px([60, 20, 90], [60, 20, 90], [55, 18, 85]); // deep purple
    const hex = dominantAccent(img, 1)!;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect(Math.max(r, g, b)).toBeGreaterThanOrEqual(Math.round(0.72 * 255) - 1);
    expect(b).toBeGreaterThan(g); // still purple: blue over green
    expect(r).toBeGreaterThan(g);
  });
});

describe('mixHex', () => {
  it('blends toward the second colour by t', () => {
    expect(mixHex('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mixHex('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });

  it('clamps t into 0..1', () => {
    expect(mixHex('#102030', '#FFFFFF', -1)).toBe('#102030');
  });
});

describe('halfEnd — fixed halves of the calendar', () => {
  it('puts the first half of the year in June and the second in December', () => {
    expect(halfEnd('2026-01')).toBe('2026-06');
    expect(halfEnd('2026-06')).toBe('2026-06');
    expect(halfEnd('2026-07')).toBe('2026-12');
    expect(halfEnd('2026-12')).toBe('2026-12');
  });

  it('stays aligned when stepped by six months, in both directions', () => {
    expect(shiftMonth(halfEnd('2026-08'), -6)).toBe('2026-06');
    expect(shiftMonth('2026-06', -6)).toBe('2025-12');
    expect(shiftMonth('2025-12', 6)).toBe('2026-06');
  });
});

describe('monthsGrid — whole months, never a floating window', () => {
  it('starts on the 1st and ends on the last day, with gaps around them', () => {
    const g = monthsGrid('2026-08', 3, new Map());
    const cells = g.flat().filter((c): c is { date: string; count: number } => c !== null);
    expect(cells[0]!.date).toBe('2026-06-01');
    expect(cells.at(-1)!.date).toBe('2026-08-31');
    // June + July + August, and nothing else.
    expect(cells).toHaveLength(30 + 31 + 31);
    expect(g.every((w) => w.length === 7)).toBe(true);
  });

  it('pads the edges rather than borrowing the neighbouring months', () => {
    const g = monthsGrid('2026-08', 1, new Map());
    // 1 August 2026 is a Saturday, so the first column is six gaps then the 1st.
    expect(g[0]!.slice(0, 6).every((c) => c === null)).toBe(true);
    expect(g[0]![6]!.date).toBe('2026-08-01');
  });

  it('knows February, leap year and all', () => {
    expect(monthsGrid('2024-02', 1, new Map()).flat().filter(Boolean)).toHaveLength(29);
    expect(monthsGrid('2026-02', 1, new Map()).flat().filter(Boolean)).toHaveLength(28);
  });

  it('puts counts on their own days', () => {
    const g = monthsGrid('2026-08', 6, new Map([['2026-05-04', 7]]));
    const cell = g.flat().find((c) => c?.date === '2026-05-04');
    expect(cell!.count).toBe(7);
    expect(g.flat().filter((c) => c && c.count > 0)).toHaveLength(1);
  });

  it('returns nothing for a month it cannot read', () => {
    expect(monthsGrid('nonsense', 6, new Map())).toEqual([]);
  });
});

describe('monthColumns — the labels over the grid', () => {
  it('marks the first column holding a day of each month', () => {
    const labels = monthColumns(monthsGrid('2026-08', 3, new Map()));
    expect(labels.map((l) => l.month)).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('never repeats a month', () => {
    const labels = monthColumns(monthsGrid('2026-08', 6, new Map()));
    expect(new Set(labels.map((l) => l.month)).size).toBe(labels.length);
  });
});

describe('heatLevel / busyDayCount', () => {
  it('gives an empty day nothing and a busy day the darkest shade', () => {
    expect(heatLevel(0, 8)).toBe(0);
    expect(heatLevel(8, 8)).toBe(4);
    expect(heatLevel(99, 8)).toBe(4);
  });

  it('spreads ordinary days across the middle shades', () => {
    expect(heatLevel(1, 8)).toBe(1);
    expect(heatLevel(3, 8)).toBe(2);
    expect(heatLevel(5, 8)).toBe(3);
  });

  /** One binge must not flatten a year of ordinary evenings into pale grey. */
  it('scales against a busy day, not the busiest ever', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 50; i++) counts.set(`2026-01-${String(i + 1).padStart(2, '0')}`, 2);
    counts.set('2026-03-01', 40); // the one binge
    const busy = busyDayCount(counts);
    expect(busy).toBeLessThan(40);
    // An ordinary two-episode evening still registers.
    expect(heatLevel(2, busy)).toBeGreaterThan(0);
  });

  it('never lets a single episode read as a heavy day', () => {
    expect(busyDayCount(new Map([['2026-01-01', 1]]))).toBe(2);
    expect(busyDayCount(new Map())).toBe(2);
  });
});

describe('Wrapped periods', () => {
  it('bounds a month, a leap February and a year', () => {
    expect(periodBounds('2026-07')).toEqual({ key: '2026-07', kind: 'month', start: '2026-07-01', end: '2026-07-31' });
    expect(periodBounds('2024-02')?.end).toBe('2024-02-29');
    expect(periodBounds('2026')).toEqual({ key: '2026', kind: 'year', start: '2026-01-01', end: '2026-12-31' });
  });

  /** A deep link is user input: a bad period must produce nothing, not a range. */
  it('refuses anything that is not a real period', () => {
    for (const bad of ['2026-13', '2026-00', '20260', 'july', '', '2026-7']) {
      expect(periodBounds(bad)).toBeNull();
    }
  });

  it('offers completed months and finished years only', () => {
    const opts = periodOptions('2026-08-14', [2026, 2025, 2024], 3);
    expect(opts).toEqual(['2026-07', '2026-06', '2026-05', '2025', '2024']);
    expect(opts).not.toContain('2026-08'); // the month still running
    expect(opts).not.toContain('2026'); // the year still running
  });

  it('walks back over a year boundary', () => {
    expect(periodOptions('2026-01-09', [], 2)).toEqual(['2025-12', '2025-11']);
  });
});

describe('Wrapped honesty', () => {
  const shape = {
    episodes: 0,
    films: 0,
    minutes: 0,
    topShows: [] as { name: string; minutes: number; episodes: number }[],
    topGenres: [] as { name: string; minutes: number }[],
    biggestDay: { date: '', count: 0 },
    longestStreak: 0,
    activeDays: 0,
    posters: [] as string[],
    newShows: 0,
    continuedShows: 0,
    averageRating: null as number | null,
    ratedCount: 0,
  };

  /** The owner's own August 2025 holds ONE watch. */
  it('calls a one-watch month too quiet to recap', () => {
    expect(wrappedTooQuiet({ episodes: 1, films: 0 })).toBe(true);
    expect(wrappedTooQuiet({ episodes: 0, films: 0 })).toBe(true);
    expect(wrappedTooQuiet({ episodes: 2, films: WRAPPED_MIN_ITEMS - 2 })).toBe(false);
  });

  it('drops every slide it has no data for, and keeps the closing one', () => {
    const slides = wrappedSlides({ ...shape, episodes: 3, minutes: 0 });
    expect(slides).toEqual(['opening', 'counts', 'collage']);
  });

  /** "Your biggest day: 1 episode" and "longest streak: 1 day" are true and
   *  worthless — a quiet month must not be padded with them. */
  it('will not dress a single quiet evening up as a record', () => {
    const slides = wrappedSlides({
      ...shape,
      episodes: 3,
      minutes: 70,
      biggestDay: { date: '2025-08-02', count: 1 },
      longestStreak: 1,
      activeDays: 1,
    });
    expect(slides).not.toContain('biggestDay');
    expect(slides).not.toContain('streak');
    expect(slides).toContain('time');
  });

  it('shows the full run when the period earned it', () => {
    expect(
      wrappedSlides({
        episodes: 60,
        films: 4,
        minutes: 2000,
        topShows: [
          { name: 'Severance', minutes: 400, episodes: 9 },
          { name: 'The Bear', minutes: 300, episodes: 8 },
          { name: 'Slow Horses', minutes: 200, episodes: 6 },
        ],
        topGenres: [
          { name: 'Drama', minutes: 900 },
          { name: 'Comedy', minutes: 400 },
        ],
        biggestDay: { date: '2026-07-11', count: 7 },
        longestStreak: 5,
        activeDays: 18,
        posters: ['a', 'b', 'c'],
        newShows: 4,
        continuedShows: 6,
        averageRating: 4.2,
        ratedCount: 11,
      }),
    ).toEqual([
      'opening',
      'time',
      'counts',
      'newVsContinued',
      'topShow',
      'topShows',
      'topGenre',
      'topGenres',
      'biggestDay',
      'streak',
      'ratingCard',
      'collage',
    ]);
  });

  /** "7 new and 0 you stayed with" is the counts card's sub-line with extra
   *  ceremony, and "0 new shows" reads as a scolding. Both sides or neither. */
  it('only contrasts new against continued when there is a contrast', () => {
    expect(wrappedSlides({ ...shape, episodes: 5, newShows: 3, continuedShows: 0 })).not.toContain(
      'newVsContinued',
    );
    expect(wrappedSlides({ ...shape, episodes: 5, newShows: 0, continuedShows: 3 })).not.toContain(
      'newVsContinued',
    );
    expect(wrappedSlides({ ...shape, episodes: 5, newShows: 1, continuedShows: 1 })).toContain(
      'newVsContinued',
    );
  });

  /** The runners-up card names the 2nd and the 3rd. With two shows in the
   *  period there is only a 2nd, and a list of one is the slide before it. */
  it('names the runners-up only when there are two of them', () => {
    const shows = [
      { name: 'A', minutes: 3, episodes: 3 },
      { name: 'B', minutes: 2, episodes: 2 },
      { name: 'C', minutes: 1, episodes: 1 },
    ];
    expect(wrappedSlides({ ...shape, episodes: 6, topShows: shows.slice(0, 2) })).not.toContain('topShows');
    expect(wrappedSlides({ ...shape, episodes: 6, topShows: shows })).toContain('topShows');
  });

  /** "Mostly comedy, but never far from horror" needs a horror. */
  it('drops the genre pair when there is only one genre', () => {
    const one = [{ name: 'Comedy', minutes: 90 }];
    expect(wrappedSlides({ ...shape, episodes: 4, topGenres: one })).not.toContain('topGenres');
    expect(wrappedSlides({ ...shape, episodes: 4, topGenres: [...one, { name: 'Horror', minutes: 40 }] })).toContain(
      'topGenres',
    );
  });

  /** A films-only month has no shows and no genres, and must not be padded
   *  with either card. */
  it('gives a films-only month no show or genre cards at all', () => {
    const slides = wrappedSlides({ ...shape, films: 5, minutes: 500, activeDays: 3, longestStreak: 2 });
    for (const id of ['topShow', 'topShows', 'topGenre', 'topGenres', 'newVsContinued'] as const) {
      expect(slides).not.toContain(id);
    }
  });

  /** An average of two ratings is a mood, not a disposition — and somebody
   *  who never rates must never meet the card. */
  it('withholds the verdict card until the average means something', () => {
    expect(wrappedSlides({ ...shape, episodes: 9, averageRating: null, ratedCount: 0 })).not.toContain(
      'ratingCard',
    );
    expect(
      wrappedSlides({ ...shape, episodes: 9, averageRating: 5, ratedCount: WRAPPED_MIN_RATINGS - 1 }),
    ).not.toContain('ratingCard');
    expect(
      wrappedSlides({ ...shape, episodes: 9, averageRating: 4.4, ratedCount: WRAPPED_MIN_RATINGS }),
    ).toContain('ratingCard');
  });

  it('keeps the collage last whatever the period filled', () => {
    const quiet = wrappedSlides({ ...shape, episodes: 3 });
    expect(quiet[quiet.length - 1]).toBe('collage');
  });
});

describe('collagePosters', () => {
  it('drops blanks and repeats, and caps the grid', () => {
    expect(collagePosters(['a', null, 'a', undefined, 'b', ''])).toEqual(['a', 'b']);
    expect(collagePosters(['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b']);
    expect(collagePosters([])).toEqual([]);
  });
});

describe('wrappedToOffer — the monthly nudge', () => {
  it('offers last month once the new one starts', () => {
    expect(wrappedToOffer('2026-08-01', '')).toBe('2026-07');
    expect(wrappedToOffer('2026-01-01', '')).toBe('2025-12');
  });

  /** A prompt that lives for one day is missed by everyone who did not open
   *  the app that day — and July is just as finished on the 4th. */
  it('keeps offering after the 1st, until it is answered', () => {
    expect(wrappedToOffer('2026-08-04', '')).toBe('2026-07');
    expect(wrappedToOffer('2026-08-28', '')).toBe('2026-07');
  });

  it('says nothing once that month has been dealt with', () => {
    expect(wrappedToOffer('2026-08-04', '2026-07')).toBeNull();
  });

  it('re-arms for the next month', () => {
    expect(wrappedToOffer('2026-09-01', '2026-07')).toBe('2026-08');
  });

  it('stays quiet when a later month was somehow already answered', () => {
    expect(wrappedToOffer('2026-08-04', '2026-09')).toBeNull();
  });
});

describe('pickBiography', () => {
  const bios = [
    { language: 'spa', biography: 'Biografía en español' },
    { language: 'eng', biography: 'An English biography' },
    { language: 'ara', biography: 'نبذة بالعربية' },
  ];

  it('prefers the reader’s own language', () => {
    expect(pickBiography(bios, 'ar')).toBe('نبذة بالعربية');
    expect(pickBiography(bios, 'es')).toBe('Biografía en español');
  });

  /** pt-BR is two letters against TheTVDB's three-letter `por`. */
  it('matches a regional locale to its language', () => {
    expect(pickBiography([{ language: 'por', biography: 'Uma biografia' }], 'pt-BR')).toBe('Uma biografia');
  });

  it('falls back to English, then to anything with text', () => {
    expect(pickBiography(bios, 'it')).toBe('An English biography');
    expect(pickBiography([{ language: 'deu', biography: 'Eine Biografie' }], 'it')).toBe('Eine Biografie');
  });

  it('ignores entries that are empty or blank', () => {
    expect(pickBiography([{ language: 'eng', biography: '   ' }], 'en')).toBeNull();
    expect(pickBiography([], 'en')).toBeNull();
  });
});

describe('personLife', () => {
  it('gives a range only when both years are known', () => {
    expect(personLife({ birth: '1961-01-17', death: '2014-08-11' })).toBe('1961 – 2014');
    expect(personLife({ birth: '1961-01-17' })).toBe('1961');
  });

  /** "– 2014" reads as a rendering fault, not as a fact. */
  it('never prints a dangling dash', () => {
    expect(personLife({ death: '2014-08-11' })).toBe('2014');
    expect(personLife({})).toBeNull();
  });
});

describe('personCredits', () => {
  it('names a series once however many roles it holds', () => {
    const out = personCredits([
      { name: 'Finn', seriesId: 1, series: { id: 1, name: 'Adventure Time', year: '2010' } },
      { name: 'Fern', seriesId: 1, series: { id: 1, name: 'Adventure Time', year: '2010' } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.role).toBe('Finn');
  });

  it('keeps films apart from series with the same id', () => {
    const out = personCredits([
      { name: 'A', seriesId: 7, series: { id: 7, name: 'A Series', year: '2001' } },
      { name: 'B', movieId: 7, movie: { id: 7, name: 'A Film', year: '2002' } },
    ]);
    expect(out.map((c) => c.kind)).toEqual(['movie', 'series']);
  });

  it('puts the newest first and the undated last', () => {
    const out = personCredits([
      { seriesId: 1, series: { id: 1, name: 'Old', year: '1999' } },
      { seriesId: 2, series: { id: 2, name: 'Undated' } },
      { seriesId: 3, series: { id: 3, name: 'New', year: '2024' } },
    ]);
    expect(out.map((c) => c.name)).toEqual(['New', 'Old', 'Undated']);
  });

  it('drops a credit with no title or no id rather than drawing a blank row', () => {
    expect(personCredits([{ name: 'Someone', seriesId: 5, series: { id: 5, name: '  ' } }])).toEqual([]);
    expect(personCredits([{ name: 'Someone' }])).toEqual([]);
  });
});

describe('secondaryAccent', () => {
  /** Build an RGBA buffer from a list of colours, repeated `each` times. */
  const pixels = (colours: [number, number, number][], each = 400) => {
    const out = new Uint8Array(colours.length * each * 4);
    let i = 0;
    for (const [r, g, b] of colours) {
      for (let n = 0; n < each; n += 1) {
        out[i++] = r; out[i++] = g; out[i++] = b; out[i++] = 255;
      }
    }
    return out;
  };

  it('finds the other colour in a two-colour picture', () => {
    // mostly amber, a real amount of teal
    const rgba = pixels([[230, 170, 40]], 900);
    const teal = pixels([[30, 170, 180]], 400);
    const both = new Uint8Array(rgba.length + teal.length);
    both.set(rgba); both.set(teal, rgba.length);

    expect(dominantAccent(both, 1)).toMatch(/^#[0-9A-F]{6}$/);
    const second = secondaryAccent(both, 1);
    expect(second).toMatch(/^#[0-9A-F]{6}$/);
    // it is the teal, not another shade of the amber
    const [, r, g, b] = /^#(..)(..)(..)$/.exec(second!)!;
    expect(parseInt(b!, 16)).toBeGreaterThan(parseInt(r!, 16));
    void g;
  });

  /** A poster that is all one colour should theme as one colour, not have a
   *  partner invented for it. */
  it('returns null when the picture really is one hue', () => {
    expect(secondaryAccent(pixels([[230, 170, 40], [240, 185, 60], [210, 150, 30]], 500), 1)).toBeNull();
  });

  it('ignores a stray highlight too small to be part of the palette', () => {
    const big = pixels([[230, 170, 40]], 5000);
    const speck = pixels([[30, 170, 180]], 20);
    const both = new Uint8Array(big.length + speck.length);
    both.set(big); both.set(speck, big.length);
    expect(secondaryAccent(both, 1)).toBeNull();
  });

  it('says nothing about a grey image', () => {
    expect(secondaryAccent(pixels([[120, 120, 120], [60, 60, 60]], 500), 1)).toBeNull();
  });
});

describe('recentDayOptions', () => {
  it('offers seven days, newest first, ending a week ago', () => {
    const out = recentDayOptions(new Date(2026, 7, 16)); // 16 Aug 2026, local
    expect(out).toHaveLength(7);
    expect(out[0]).toEqual({ day: '2026-08-16', offset: 0 });
    expect(out[6]).toEqual({ day: '2026-08-10', offset: 6 });
  });

  it('crosses a month boundary backwards', () => {
    const out = recentDayOptions(new Date(2026, 8, 2)); // 2 Sep
    expect(out.map((o) => o.day)).toContain('2026-08-31');
    expect(out[6].day).toBe('2026-08-27');
  });

  // Why toISOString() is not used: late in the evening east of Greenwich it
  // rolls the date forward, and an app about accurate dates must never offer
  // somebody tomorrow.
  it('uses the local day, not UTC', () => {
    expect(recentDayOptions(new Date(2026, 7, 16, 23, 30))[0].day).toBe('2026-08-16');
  });
});

describe('where to watch', () => {
  it('takes the region from the phone, not a default', () => {
    expect(deviceWatchRegion([{ regionCode: 'IQ' }])).toBe('IQ');
    expect(deviceWatchRegion([{ regionCode: null }, { regionCode: 'gb' }])).toBe('GB');
  });

  // The old behaviour, kept only for a phone that reports no region at all —
  // which is what everybody used to get whether they were American or not.
  it('falls back to US only when the phone offers nothing', () => {
    expect(deviceWatchRegion([])).toBe('US');
    expect(deviceWatchRegion([{ regionCode: 'XYZ' }])).toBe('US');
  });

  it('refuses anything that is not a two-letter code', () => {
    expect(validWatchRegion('iq')).toBe('IQ');
    expect(validWatchRegion('IRQ')).toBeNull();
    expect(validWatchRegion(undefined)).toBeNull();
    // Passing junk to TMDB queries `results.undefined`, which answers with
    // silence and looks exactly like a title nobody streams.
    expect(validWatchRegion('')).toBeNull();
  });

  it('reads every way to watch, not just subscription', () => {
    const out = watchOptions({
      flatrate: [{ provider_name: 'Netflix', logo_path: '/n.png' }],
      rent: [{ provider_name: 'Apple TV', logo_path: '/a.png' }],
      ads: [{ provider_name: 'Tubi', logo_path: null }],
    });
    expect(out.map((o) => o.name)).toEqual(['Netflix', 'Tubi', 'Apple TV']);
    expect(out[0].kind).toBe('flatrate');
  });

  it('keeps the best kind when a provider offers several', () => {
    const out = watchOptions({
      rent: [{ provider_name: 'Prime Video' }],
      flatrate: [{ provider_name: 'Prime Video' }],
      buy: [{ provider_name: 'Prime Video' }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('flatrate');
  });

  it('is empty rather than throwing when a region has no block', () => {
    expect(watchOptions(null)).toEqual([]);
    expect(watchOptions(undefined)).toEqual([]);
  });
});

describe('movieIdentityMatches — the same question, two callers', () => {
  const held = { tmdbId: null, name: 'Romance', year: null };

  // Adding: a false NO duplicates something already in the library.
  it('adding treats a yearless pair as the same film', () => {
    expect(movieIdentityMatches({ tmdbId: null, name: 'Romance', year: null }, held)).toBe(true);
  });

  // Displaying: a false YES is the reported bug — six Romances, one held, and
  // every yearless result claimed to be it, so tapping + on the first appeared
  // to tick the last.
  it('displaying refuses a yearless pair', () => {
    expect(movieIdentityMatches({ tmdbId: null, name: 'Romance', year: null }, held, { strict: true })).toBe(false);
  });

  it('real evidence still wins under strict', () => {
    expect(
      movieIdentityMatches({ tmdbId: 42, name: 'Romance', year: null }, { tmdbId: 42, name: 'Anything' }, { strict: true }),
    ).toBe(true);
    expect(
      movieIdentityMatches(
        { tmdbId: null, name: 'Romance', year: '2008' },
        { tmdbId: null, name: 'Romance', year: '2008-04-01' },
        { strict: true },
      ),
    ).toBe(true);
  });

  it('and different years are still different films either way', () => {
    const a = { tmdbId: null, name: 'Amado', year: '2011' };
    const b = { tmdbId: null, name: 'Amado', year: '2022' };
    expect(movieIdentityMatches(a, b)).toBe(false);
    expect(movieIdentityMatches(a, b, { strict: true })).toBe(false);
  });
});

describe('calendarMonth', () => {
  it('pads to whole weeks so the columns line up', () => {
    const weeks = calendarMonth('2026-08');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
  });

  it('starts the month on the right weekday', () => {
    // 1 August 2026 is a Saturday, so six leading blanks.
    const first = calendarMonth('2026-08')[0];
    expect(first.slice(0, 6).every((d) => d === null)).toBe(true);
    expect(first[6]).toBe('2026-08-01');
  });

  it('handles February in a leap year', () => {
    expect(calendarMonth('2028-02').flat().filter(Boolean)).toHaveLength(29);
    expect(calendarMonth('2026-02').flat().filter(Boolean)).toHaveLength(28);
  });

  it('is empty rather than throwing on nonsense', () => {
    expect(calendarMonth('')).toEqual([]);
    expect(calendarMonth('2026-13')).toEqual([]);
  });
});

describe('profile layout', () => {
  const { normalise, defaultLayout, nextSpan, parseLayout, availableToAdd, LOCKED } =
    require('@/profile-layout') as typeof import('@/profile-layout');

  it('gives the default arrangement when nothing is stored', () => {
    expect(normalise(null, ['shows'])[0]!.id).toBe(LOCKED);
    expect(normalise([], []).length).toBe(defaultLayout([]).length);
  });

  it('keeps the order the owner chose', () => {
    const stored = [
      { id: 'streak', span: '1x1' as const },
      { id: 'banners', span: '2x1' as const },
    ];
    const out = normalise(stored, []);
    expect(out.slice(0, 2).map((p) => p.id)).toEqual(['streak', 'banners']);
  });

  it('drops widgets this build no longer has, and duplicates', () => {
    const out = normalise(
      [
        { id: 'gone-widget', span: '1x1' as const },
        { id: 'streak', span: '1x1' as const },
        { id: 'streak', span: '1x1' as const },
      ],
      [],
    );
    expect(out.filter((p) => p.id === 'streak')).toHaveLength(1);
    expect(out.some((p) => p.id === 'gone-widget')).toBe(false);
  });

  it('clamps a size the widget cannot be', () => {
    // `streak` is 1x1 only; a stored 2x2 must not survive
    const out = normalise([{ id: 'streak', span: '2x2' as const }], []);
    expect(out.find((p) => p.id === 'streak')!.span).toBe('1x1');
  });

  it('puts the banner back when a stored layout has lost it', () => {
    const out = normalise([{ id: 'streak', span: '1x1' as const }], []);
    expect(out[0]!.id).toBe(LOCKED);
  });

  it('appends widgets the stored layout never saw, before `extra`', () => {
    const out = normalise(
      [
        { id: 'banners', span: '2x1' as const },
        { id: 'extra', span: '2x1' as const },
      ],
      [],
    );
    expect(out[out.length - 1]!.id).toBe('extra');
    expect(out.some((p) => p.id === 'streak')).toBe(true);
  });

  it('offers removed widgets back to the picker', () => {
    const out = normalise([{ id: 'banners', span: '2x1' as const }], []);
    const trimmed = out.filter((p) => p.id !== 'streak');
    expect(availableToAdd(trimmed, [])).toContain('streak');
  });

  it('cycles sizes, and wraps', () => {
    expect(nextSpan('genre', '1x1')).toBe('2x1');
    expect(nextSpan('genre', '2x1')).toBe('1x1');
    expect(nextSpan('streak', '1x1')).toBe('1x1');
  });

  it('treats a corrupt stored value as no preference', () => {
    expect(parseLayout('not json')).toBeNull();
    expect(parseLayout('{}')).toBeNull();
    expect(parseLayout('[{"id":"streak","span":"nonsense"}]')).toEqual([{ id: 'streak', span: '1x1' }]);
  });
});
