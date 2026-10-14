/**
 * The daily puzzle's rules. Every judgement the screen draws from is here, so
 * a wrong streak or a wrong clue is a red test rather than a wrong share text
 * posted by a thousand people.
 */
import {
  BLUR,
  CLUES,
  MAX_TRIES,
  HISTORY_MAX,
  MIN_LIBRARY_POOL,
  REPEAT_DAYS,
  PUZZLE_EPOCH,
  SKIP,
  blurFor,
  archiveDays,
  candidatePool,
  CLOSE_LEVEL,
  EPISODE_STEPS,
  guessedId,
  isClose,
  libraryCandidates,
  markClose,
  showQualifies,
  clueParts,
  cluesShown,
  daysBetween,
  filmId,
  hashDay,
  guess,
  isFilmId,
  isOver,
  misses,
  newGame,
  parseGame,
  parseHistory,
  parseId,
  parsePinned,
  parsePublicPuzzle,
  pickAnswer,
  pickForDay,
  pickIndex,
  pickPicture,
  publicPuzzle,
  puzzleNumber,
  puzzleStats,
  resultOf,
  shareText,
  shiftDay,
  squares,
  titleMatches,
  usedPictures,
  winLevel,
  withPinned,
  withResult,
  type Pinned,
  type PuzzleId,
  type Clues,
} from '@/puzzle';

describe('days', () => {
  it('counts whole days, across a DST change and a year end', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-01-05', '2026-01-01')).toBe(-4);
    expect(shiftDay('2026-02-28', 1)).toBe('2026-03-01');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('numbers puzzles from the epoch, and never below 1', () => {
    expect(puzzleNumber(PUZZLE_EPOCH)).toBe(1);
    expect(puzzleNumber(shiftDay(PUZZLE_EPOCH, 11))).toBe(12);
    expect(puzzleNumber('2020-01-01')).toBe(1);
  });
});

describe('which show today', () => {
  it('is the same show however the ids arrive', () => {
    expect(pickForDay('2026-11-03', [5, 9, 2, 7])).toBe(pickForDay('2026-11-03', [7, 2, 9, 5]));
    expect(pickForDay('2026-11-03', [5, 9, 2, 7, 7, 5])).toBe(pickForDay('2026-11-03', [2, 5, 7, 9]));
  });

  it('changes from day to day over a month', () => {
    const ids = Array.from({ length: 50 }, (_, i) => 1000 + i);
    const picks = new Set(Array.from({ length: 30 }, (_, i) => pickForDay(shiftDay('2026-11-01', i), ids)));
    expect(picks.size).toBeGreaterThan(10);
  });

  it('avoids recent answers when it can, and not when it cannot', () => {
    for (let i = 0; i < 30; i++) {
      const day = shiftDay('2026-11-01', i);
      expect(pickForDay(day, [1, 2, 3, 4], [1, 2, 3])).toBe(4);
    }
    // Everything is recent: a tiny library still gets a puzzle.
    expect(pickForDay('2026-11-01', [1, 2], [1, 2])).not.toBeNull();
    expect(pickForDay('2026-11-01', [])).toBeNull();
  });

  it('picks a still in a different lane from the show', () => {
    expect(pickIndex('2026-11-01', 0)).toBe(0);
    for (let i = 0; i < 20; i++) {
      const idx = pickIndex(shiftDay('2026-11-01', i), 7);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(7);
    }
  });
});

describe('one game', () => {
  it('wins on the right id and stops taking guesses', () => {
    let g = newGame('2026-11-01', 81189);
    g = guess(g, 1);
    g = guess(g, SKIP);
    g = guess(g, 81189);
    expect(g.won).toBe(true);
    expect(isOver(g)).toBe(true);
    expect(guess(g, 2)).toBe(g);
    expect(squares(g)).toBe('🟥⬛🟩');
  });

  it('loses after six wrong tries', () => {
    let g = newGame('2026-11-01', 81189);
    for (let i = 1; i <= MAX_TRIES; i++) g = guess(g, i);
    expect(g.won).toBe(false);
    expect(isOver(g)).toBe(true);
    expect(g.guesses).toHaveLength(MAX_TRIES);
    expect(squares(g)).toBe('🟥🟥🟥🟥🟥🟥');
  });

  it('reveals one clue per miss, the first one free, all of them at the end', () => {
    let g = newGame('2026-11-01', 81189);
    expect(cluesShown(g)).toBe(1);
    expect(blurFor(g)).toBe(BLUR[0]);
    g = guess(g, 1);
    expect(misses(g)).toBe(1);
    expect(cluesShown(g)).toBe(2);
    expect(blurFor(g)).toBe(BLUR[1]);
    for (let i = 2; i <= 5; i++) g = guess(g, i);
    expect(cluesShown(g)).toBe(CLUES.length);
    expect(blurFor(g)).toBe(BLUR[5]);
    // The sixth try, right or wrong, ends it and the picture clears.
    const won = guess(g, 81189);
    expect(misses(won)).toBe(5);
    expect(blurFor(won)).toBe(0);
    expect(cluesShown(won)).toBe(CLUES.length);
    expect(blurFor(guess(g, 6))).toBe(0);
  });

  it('writes the grid people post', () => {
    let g = newGame('2026-11-12', 81189);
    g = guess(g, 1);
    g = guess(g, 2);
    g = guess(g, 81189);
    expect(shareText(12, g)).toBe('OpenTV #12 · 3/6\n🟥🟥🟩');
    let lost = newGame('2026-11-12', 81189);
    for (let i = 1; i <= 5; i++) lost = guess(lost, i);
    lost = guess(lost, SKIP);
    expect(shareText(12, lost)).toBe('OpenTV #12 · X/6\n🟥🟥🟥🟥🟥⬛');
  });
});

describe('history and the month of squares', () => {
  const win = (day: string, tries: number, id = 1): ReturnType<typeof resultOf> => {
    let g = newGame(day, id);
    for (let i = 1; i < tries; i++) g = guess(g, 100 + i);
    return resultOf(guess(g, id));
  };

  it('keeps one row per day, in order, capped', () => {
    let h = withResult([], win('2026-11-03', 2));
    h = withResult(h, win('2026-11-01', 1));
    h = withResult(h, win('2026-11-03', 5));
    expect(h.map((r) => `${r.d}:${r.tries}`)).toEqual(['2026-11-01:1', '2026-11-03:5']);
    for (let i = 0; i < 450; i++) h = withResult(h, win(shiftDay('2027-01-01', i), 1));
    expect(h).toHaveLength(452);
    for (let i = 450; i < HISTORY_MAX + 10; i++) h = withResult(h, win(shiftDay('2027-01-01', i), 1));
    expect(h).toHaveLength(HISTORY_MAX);
  });

  it('colours a first-try win as level 6 and a loss as 0', () => {
    expect(winLevel(win('2026-11-01', 1))).toBe(6);
    expect(winLevel(win('2026-11-01', 6))).toBe(1);
    let lost = newGame('2026-11-02', 1);
    for (let i = 1; i <= 6; i++) lost = guess(lost, 100 + i);
    expect(winLevel(resultOf(lost))).toBe(0);
  });

  it('publishes counts and colours for one month, never an id', () => {
    const h = [win('2026-10-30', 1, 81189), win('2026-11-02', 3, 70327), win('2026-11-05', 6, 121361)];
    const v = publicPuzzle(h, '2026-11');
    expect(v).toEqual({
      days: [
        ['2026-11-02', 4],
        ['2026-11-05', 1],
      ],
      stats: { played: 3, win: 100, avg: 3.3 },
    });
    expect(JSON.stringify(v)).not.toContain('70327');
    // No streak in what leaves the phone, under any name.
    expect(Object.keys(v).sort()).toEqual(['days', 'stats']);
  });

  it('reads a published value tolerantly', () => {
    expect(parsePublicPuzzle(null)).toBeNull();
    expect(parsePublicPuzzle('x')).toBeNull();
    expect(parsePublicPuzzle({})).toEqual({ days: [], stats: null });
    // A value from before 14 Oct: the streak is ignored, and there are no stats.
    // Levels clamp to -1 (a close loss) … 6.
    expect(parsePublicPuzzle({ n: 3.7, days: [['2026-11-02', 9], ['bad', 1], [1, 2], ['2026-11-03', -3]] })).toEqual({
      days: [
        ['2026-11-02', 6],
        ['2026-11-03', -1],
      ],
      stats: null,
    });
    expect(parsePublicPuzzle({ days: [], stats: { played: 12.4, win: 140, avg: 0.2 } })).toEqual({
      days: [],
      stats: { played: 12, win: 100, avg: 1 },
    });
    expect(parsePublicPuzzle({ days: [], stats: { played: 2, win: 50, avg: null } })?.stats).toEqual({ played: 2, win: 50, avg: null });
  });
});

describe('matching a typed title', () => {
  it('ignores case and accents, and matches nothing on an empty query', () => {
    expect(titleMatches('Pokémon', 'pokemon')).toBe(true);
    expect(titleMatches('La Casa de Papel', 'CASA DE')).toBe(true);
    expect(titleMatches('Dark', '')).toBe(false);
    expect(titleMatches('Dark', '   ')).toBe(false);
    expect(titleMatches('Dark', 'Severance')).toBe(false);
  });
});

// ── films (14 Oct) ──────────────────────────────────────────────────────────

describe('a film among the shows', () => {
  it('keys a film apart from every show', () => {
    expect(filmId(603, 'The Matrix')).toBe('m:603');
    expect(filmId(null, 'Paprika')).toBe('m:n:Paprika');
    // A film called "603" with no TMDB match is not TMDB's 603.
    expect(filmId(null, '603')).not.toBe(filmId(603, 'x'));
    expect(isFilmId('m:603')).toBe(true);
    expect(isFilmId(603)).toBe(false);
    // TheTVDB 603 and TMDB 603 are two different answers.
    expect(guess(newGame('2026-11-01', 603), 'm:603').won).toBe(false);
    expect(guess(newGame('2026-11-01', 'm:603'), 'm:603').won).toBe(true);
  });

  it('reads ids from either era and nothing else', () => {
    expect(parseId(81189)).toBe(81189);
    expect(parseId(SKIP)).toBe(SKIP);
    expect(parseId('m:603')).toBe('m:603');
    expect(parseId('m:n:Paprika')).toBe('m:n:Paprika');
    expect(parseId('81189')).toBeNull();
    expect(parseId('m:')).toBeNull();
    expect(parseId(-1)).toBeNull();
    expect(parseId(null)).toBeNull();
  });

  it('answers a show-only library exactly as before films existed', () => {
    // The old comparator, verbatim: a library with no watched film must pick
    // the same show it always would have.
    const old = (day: string, ids: number[]) => {
      const sorted = [...new Set(ids)].sort((a, b) => a - b);
      return sorted[hashDay(day) % sorted.length];
    };
    const ids = [81189, 121361, 305288, 73244, 279121];
    for (let i = 0; i < 30; i++) {
      const day = shiftDay('2026-11-01', i);
      expect(pickForDay(day, ids)).toBe(old(day, ids));
    }
  });

  it('picks from shows and films alike, whatever order they arrive in', () => {
    const a = [81189, 'm:603', 73244, 'm:n:Paprika', 'm:129'];
    const b = ['m:129', 73244, 'm:n:Paprika', 81189, 'm:603'];
    const picks = new Set<string | number>();
    for (let i = 0; i < 40; i++) {
      const day = shiftDay('2026-11-01', i);
      expect(pickForDay(day, a)).toBe(pickForDay(day, b));
      picks.add(pickForDay(day, a)!);
    }
    expect([...picks].some(isFilmId)).toBe(true);
    expect([...picks].some((p) => typeof p === 'number')).toBe(true);
    // Recently played films are avoided like shows.
    expect(pickForDay('2026-11-02', ['m:1', 'm:2', 5], ['m:1', 5])).toBe('m:2');
  });

  it('lets watched films count towards the library, and adds classics only below the floor', () => {
    const classics = [1, 2, 3];
    const small = [81189, 'm:603'];
    expect(candidatePool(small, classics)).toEqual([81189, 'm:603', 1, 2, 3]);
    const full = Array.from({ length: MIN_LIBRARY_POOL }, (_, i) => (i % 2 ? 1000 + i : `m:${i}`));
    expect(candidatePool(full, classics)).toEqual(full);
    // A library of films alone is still a library.
    const films = Array.from({ length: MIN_LIBRARY_POOL }, (_, i) => `m:${i}`);
    expect(candidatePool(films, classics)).toEqual(films);
  });
});

describe('saves from before films', () => {
  it('resumes a show game saved by the old build', () => {
    const old = JSON.parse('{"day":"2026-11-03","id":81189,"guesses":[121361,0],"won":false}');
    const g = parseGame(old, '2026-11-03');
    expect(g).toEqual({ day: '2026-11-03', id: 81189, guesses: [121361, SKIP], won: false });
    expect(squares(guess(g!, 81189))).toBe('🟥⬛🟩');
    // Yesterday's is not resumed; a broken one is not either.
    expect(parseGame(old, '2026-11-04')).toBeNull();
    expect(parseGame({ ...old, guesses: [true] }, '2026-11-03')).toBeNull();
    expect(parseGame('nope', '2026-11-03')).toBeNull();
  });

  it('round-trips a film game', () => {
    const g = guess(guess(newGame('2026-11-03', 'm:n:Paprika'), 81189), 'm:n:Paprika');
    expect(parseGame(JSON.parse(JSON.stringify(g)), '2026-11-03')).toEqual(g);
  });

  it('keeps an old history, adds film rows to it, and feeds both to the block', () => {
    const old = JSON.parse(
      '[{"d":"2026-11-01","id":81189,"tries":3,"won":true},{"d":"2026-11-02","id":73244,"tries":6,"won":false},{"bad":1}]',
    );
    const h = parseHistory(old);
    expect(h).toHaveLength(2);
    const after = withResult(h, { d: '2026-11-03', id: 'm:603', tries: 1, won: true });
    expect(after.map((r) => r.id)).toEqual([81189, 73244, 'm:603']);
    expect(parseHistory(JSON.parse(JSON.stringify(after)))).toEqual(after);
    // The public block is still counts and colours: no id of either kind.
    const pub = publicPuzzle(after, '2026-11');
    expect(pub.days).toEqual([
      ['2026-11-01', 4],
      ['2026-11-02', 0],
      ['2026-11-03', 6],
    ]);
    expect(JSON.stringify(pub)).not.toContain('603');
    expect(JSON.stringify(pub)).not.toContain('81189');
    expect(parseHistory('nope')).toEqual([]);
  });
});

describe('the clues for both kinds', () => {
  const show: Clues = {
    kind: 'show',
    year: '2008',
    genre: 'Drama',
    network: 'AMC',
    seasons: 5,
    director: null,
    runtime: null,
    actor: 'Bryan Cranston',
    character: 'Walter White',
  };
  const film: Clues = {
    kind: 'film',
    year: '2006',
    genre: 'Animation',
    network: null,
    seasons: null,
    director: 'Satoshi Kon',
    runtime: 90,
    actor: 'Megumi Hayashibara',
    character: 'Paprika',
  };

  it('unlocks the kind first, then genre, details, an actor, a character', () => {
    expect(CLUES).toEqual(['still', 'kindYear', 'genre', 'details', 'actor', 'character']);
  });

  it('says what a show is', () => {
    expect(clueParts('kindYear', show)).toEqual([['puzzleTitles.kindShow'], ['puzzle.clueYear', { year: '2008' }]]);
    expect(clueParts('genre', show)).toEqual([['puzzle.clueGenre', { genre: 'Drama' }]]);
    expect(clueParts('details', show)).toEqual([
      ['puzzle.clueNetwork', { network: 'AMC' }],
      ['show.seasonsCount', { count: 5 }],
    ]);
    expect(clueParts('actor', show)).toEqual([['puzzleTitles.actor', { name: 'Bryan Cranston' }]]);
    expect(clueParts('character', show)).toEqual([['puzzle.clueCharacter', { name: 'Walter White' }]]);
    expect(clueParts('still', show)).toEqual([]);
  });

  it('says what a film is', () => {
    expect(clueParts('kindYear', film)).toEqual([['puzzleTitles.kindFilm'], ['puzzleTitles.released', { year: '2006' }]]);
    expect(clueParts('details', film)).toEqual([
      ['puzzleTitles.director', { name: 'Satoshi Kon' }],
      ['puzzleTitles.runtime', { count: 90 }],
    ]);
    expect(clueParts('actor', film)).toEqual([['puzzleTitles.actor', { name: 'Megumi Hayashibara' }]]);
  });

  it('falls back to what exists and never to an empty piece', () => {
    const bare: Clues = { ...film, year: null, genre: null, director: null, actor: null, character: null };
    // The kind is always known.
    expect(clueParts('kindYear', bare)).toEqual([['puzzleTitles.kindFilm']]);
    // No director: the runtime alone.
    expect(clueParts('details', bare)).toEqual([['puzzleTitles.runtime', { count: 90 }]]);
    // Nothing at all: an empty row, which the screen words as "nothing known".
    expect(clueParts('details', { ...bare, runtime: null })).toEqual([]);
    expect(clueParts('actor', bare)).toEqual([]);
    expect(clueParts('details', { ...show, network: null })).toEqual([['show.seasonsCount', { count: 5 }]]);
  });
});

describe('the stats', () => {
  const r = (d: string, tries: number, won: boolean) => ({ d, id: 1, tries, won });

  it('counts played, win % and the average tries of the wins', () => {
    expect(puzzleStats([])).toEqual({ played: 0, win: 0, avg: null });
    expect(puzzleStats([r('2026-11-01', 6, false)])).toEqual({ played: 1, win: 0, avg: null });
    expect(puzzleStats([r('2026-11-01', 2, true), r('2026-11-02', 6, false), r('2026-11-03', 5, true)])).toEqual({
      played: 3,
      win: 67,
      avg: 3.5,
    });
  });
});

describe('never running out', () => {
  const START = '2026-11-01';
  const classics: number[] = Array.from({ length: 113 }, (_, i) => 900_000 + i);
  const fifteen: PuzzleId[] = [...Array.from({ length: 10 }, (_, i) => 100 + i), 'm:1', 'm:2', 'm:3', 'm:4', 'm:n:Paprika'];

  /** Days played in order, each pinned as `puzzle-data.ts` pins them. */
  function simulate(days: number, library: readonly PuzzleId[], cl: readonly PuzzleId[] = classics): Pinned[] {
    let pinned: Pinned[] = [];
    for (let i = 0; i < days; i++) {
      const d = shiftDay(START, i);
      const id = pickAnswer(d, library, cl, pinned);
      expect(id).not.toBeNull();
      pinned = withPinned(pinned, { d, id: id!, pic: null });
    }
    return pinned;
  }

  /** The smallest gap, in days, between two days with the same answer. */
  function minGap(pinned: readonly Pinned[]): number {
    const last = new Map<PuzzleId, string>();
    let gap = Infinity;
    for (const p of [...pinned].sort((a, b) => a.d.localeCompare(b.d))) {
      const prev = last.get(p.id);
      if (prev) gap = Math.min(gap, daysBetween(prev, p.d));
      last.set(p.id, p.d);
    }
    return gap;
  }

  it('never repeats an answer inside 60 days, over 400 days, with a 15-title library', () => {
    const pinned = simulate(400, fifteen);
    expect(pinned).toHaveLength(400);
    expect(minGap(pinned)).toBeGreaterThanOrEqual(REPEAT_DAYS);
    // The library is used, not just the classics: every one of its titles came up.
    const used = new Set(pinned.map((p) => p.id));
    for (const id of fifteen) expect(used.has(id)).toBe(true);
  });

  it('never repeats inside 60 days whatever the library does in between', () => {
    let pinned: Pinned[] = [];
    let library: PuzzleId[] = [...fifteen];
    for (let i = 0; i < 400; i++) {
      const d = shiftDay(START, i);
      // A title is added every ten days and one removed every twenty-five.
      if (i % 10 === 0) library = [...library, 5000 + i];
      if (i % 25 === 0) library = library.slice(1);
      pinned = withPinned(pinned, { d, id: pickAnswer(d, library, classics, pinned)!, pic: null });
    }
    expect(minGap(pinned)).toBeGreaterThanOrEqual(REPEAT_DAYS);
  });

  it('is deterministic: the same day, library and record give the same answer', () => {
    const a = simulate(120, fifteen);
    const b = simulate(120, [...fifteen].reverse());
    expect(a).toEqual(b);
    const pinned = a.slice(0, 80);
    expect(pickAnswer('2027-01-20', fifteen, classics, pinned)).toBe(pickAnswer('2027-01-20', fifteen, classics, pinned));
  });

  it('gives an archive day an answer unlike the days either side of it', () => {
    // Played every day but one; the hole is filled from the archive later.
    const all = simulate(200, fifteen);
    const hole = shiftDay(START, 100);
    const without = all.filter((p) => p.d !== hole);
    const id = pickAnswer(hole, fifteen, classics, without)!;
    const near = without.filter((p) => Math.abs(daysBetween(p.d, hole)) < REPEAT_DAYS).map((p) => p.id);
    expect(near).not.toContain(id);
    expect(minGap(withPinned(without, { d: hole, id, pic: null }))).toBeGreaterThanOrEqual(REPEAT_DAYS);
  });

  it('adds the classics below the floor, and plays classics only with nothing watched', () => {
    const small = [1, 2, 3];
    const picks = simulate(30, small).map((p) => p.id);
    expect(picks.some((id) => classics.includes(id as number))).toBe(true);
    expect(picks.filter((id) => small.includes(id as number)).length).toBeLessThanOrEqual(3);
    const none = simulate(400, []);
    expect(none.every((p) => classics.includes(p.id as number))).toBe(true);
    expect(minGap(none)).toBeGreaterThanOrEqual(REPEAT_DAYS);
    expect(MIN_LIBRARY_POOL).toBe(10);
  });

  it('repeats rather than go without when there is nothing fresh at all', () => {
    const pinned = simulate(3, [1, 2], []);
    expect(pinned.map((p) => p.id).every((id) => id === 1 || id === 2)).toBe(true);
    expect(pickAnswer(START, [], [], [])).toBeNull();
  });

  it('reads the pinned record tolerantly', () => {
    expect(parsePinned('x')).toEqual([]);
    expect(parsePinned([{ d: '2026-11-01', id: 5, pic: 'a' }, { d: 'bad', id: 1 }, { d: '2026-11-02', id: 'm:7' }, null])).toEqual([
      { d: '2026-11-01', id: 5, pic: 'a' },
      { d: '2026-11-02', id: 'm:7', pic: null },
    ]);
  });
});

describe('a returning title, a different picture', () => {
  it('avoids the pictures the title was already asked with', () => {
    const pinned: Pinned[] = [
      { d: '2026-11-01', id: 7, pic: 'still-a' },
      { d: '2027-01-05', id: 7, pic: 'still-b' },
      { d: '2027-01-06', id: 8, pic: 'still-c' },
    ];
    const used = usedPictures(pinned, 7, '2027-03-10');
    expect([...used].sort()).toEqual(['still-a', 'still-b']);
    for (let i = 0; i < 30; i++) {
      const pic = pickPicture(shiftDay('2027-03-10', i), [['still-a', 'still-b', 'still-c'], ['backdrop']], used);
      expect(pic).toBe('still-c');
    }
    // Every still used: the next group's picture.
    expect(pickPicture('2027-03-10', [['still-a', 'still-b'], ['', 'backdrop']], used)).toBe('backdrop');
  });

  it('reuses the best picture when every one is used, and returns null with none', () => {
    expect(pickPicture('2027-03-10', [['a'], [], ['b']], new Set(['a', 'b']))).toBe('a');
    expect(pickPicture('2027-03-10', [[], ['']], new Set())).toBeNull();
    // Its own day's picture does not count as used.
    expect(usedPictures([{ d: '2027-03-10', id: 7, pic: 'a' }], 7, '2027-03-10').size).toBe(0);
  });
});

describe('the archive', () => {
  it('runs from the later of the epoch and the first play to yesterday, newest first', () => {
    expect(archiveDays('2026-11-05', null)).toEqual([]);
    expect(archiveDays('2026-11-05', '2026-11-02')).toEqual(['2026-11-04', '2026-11-03', '2026-11-02']);
    // Played before the epoch (a test build): the archive still starts at #1.
    expect(archiveDays('2026-11-03', '2026-10-20')).toEqual(['2026-11-02', PUZZLE_EPOCH]);
    expect(archiveDays('2026-11-02', '2026-11-02')).toEqual([]);
  });
});

describe('fair candidates', () => {
  it('a show qualifies with four episodes, or half of what aired, whichever is easier', () => {
    expect(showQualifies({ id: 1, seen: 4, aired: 200 }, 4)).toBe(true);
    expect(showQualifies({ id: 1, seen: 3, aired: 200 }, 4)).toBe(false);
    // A two-part miniseries watched to the end, and half of a six-parter.
    expect(showQualifies({ id: 1, seen: 2, aired: 2 }, 4)).toBe(true);
    expect(showQualifies({ id: 1, seen: 3, aired: 6 }, 4)).toBe(true);
    expect(showQualifies({ id: 1, seen: 2, aired: 6 }, 4)).toBe(false);
    // Aired unknown: only the episode bar applies. Nothing watched never does.
    expect(showQualifies({ id: 1, seen: 3, aired: null }, 4)).toBe(false);
    expect(showQualifies({ id: 1, seen: 0, aired: 0 }, 1)).toBe(false);
  });

  it('a big library holds every show to four episodes', () => {
    const shows = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, seen: 10, aired: 100 }));
    const sampled = [{ id: 99, seen: 1, aired: 100 }];
    const r = libraryCandidates([...shows, ...sampled], []);
    expect(r.step).toBe(4);
    expect(r.ids).not.toContain(99);
  });

  it('a small library relaxes 4 → 3 → 2 → 1 before the classics join', () => {
    expect(EPISODE_STEPS).toEqual([4, 3, 2, 1]);
    // Eight shows on 3 episodes and two films: ten at the "3" step.
    const three = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, seen: 3, aired: 100 }));
    const r3 = libraryCandidates(three, ['m:1', 'm:2']);
    expect(r3.step).toBe(3);
    expect(r3.ids).toHaveLength(MIN_LIBRARY_POOL);
    // Add two-episode shows: still only ten at "3", so it stops there.
    const r3b = libraryCandidates([...three, { id: 50, seen: 2, aired: 100 }], ['m:1', 'm:2']);
    expect(r3b.step).toBe(3);
    expect(r3b.ids).not.toContain(50);
    // Nine on 2, one on 1: the "2" step has nine, the "1" step has ten.
    const two = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, seen: 2, aired: 100 }));
    expect(libraryCandidates(two, ['m:1']).step).toBe(2);
    const r1 = libraryCandidates([...two, { id: 77, seen: 1, aired: 100 }], []);
    expect(r1.step).toBe(1);
    expect(r1.ids).toContain(77);
  });

  it('a library still short at one episode is all of it, and the classics join', () => {
    const r = libraryCandidates([{ id: 5, seen: 1, aired: 100 }, { id: 6, seen: 0, aired: 10 }], ['m:9']);
    expect(r.step).toBe(1);
    expect(r.ids).toEqual([5, 'm:9']);
    expect(candidatePool(r.ids, [1000, 1001])).toEqual([5, 'm:9', 1000, 1001]);
  });
});

describe('right series, wrong part', () => {
  const answer = 'm:12445';
  const part1 = 'm:12444';

  it('a close guess is a distinct marker that still costs a try', () => {
    const g = guess(newGame('2026-11-02', answer), part1, true);
    expect(g.guesses).toEqual([`c:${part1}`]);
    expect(isClose(g.guesses[0])).toBe(true);
    expect(guessedId(g.guesses[0])).toBe(part1);
    expect(g.won).toBe(false);
    expect(misses(g)).toBe(1);
    expect(cluesShown(g)).toBe(2);
    expect(squares(g)).toBe('🟨');
  });

  it('is never set on the answer, a show or a skip', () => {
    expect(guess(newGame('2026-11-02', answer), answer, true).guesses).toEqual([answer]);
    expect(guess(newGame('2026-11-02', answer), 81189, true).guesses).toEqual([81189]);
    expect(guess(newGame('2026-11-02', answer), SKIP, true).guesses).toEqual([SKIP]);
  });

  it('can be marked after the fact, once, on a plain film miss only', () => {
    let g = guess(guess(newGame('2026-11-02', answer), part1), 81189);
    g = markClose(g, 0);
    expect(g.guesses).toEqual([`c:${part1}`, 81189]);
    expect(markClose(g, 0)).toBe(g);
    expect(markClose(g, 1)).toBe(g);
  });

  it('the share text, the history row, the level and the stats', () => {
    let g = newGame('2026-11-02', answer);
    for (const id of [81189, part1, answer]) g = guess(g, id, id === part1);
    expect(shareText(2, g)).toBe('OpenTV #2 · 3/6\n🟥🟨🟩');
    expect(resultOf(g)).toEqual({ d: '2026-11-02', id: answer, tries: 3, won: true, close: 1 });
    expect(puzzleStats([resultOf(g)]).avg).toBe(3);
    // A loss with a close guess is the yellow day; without one, the red.
    let lost = newGame('2026-11-03', answer);
    for (let i = 0; i < MAX_TRIES; i++) lost = guess(lost, i === 0 ? part1 : SKIP, i === 0);
    expect(winLevel(resultOf(lost))).toBe(CLOSE_LEVEL);
    expect(winLevel({ d: '2026-11-03', id: answer, tries: 6, won: false })).toBe(0);
    expect(publicPuzzle([resultOf(lost)], '2026-11').days).toEqual([['2026-11-03', CLOSE_LEVEL]]);
    expect(parsePublicPuzzle({ days: [['2026-11-03', -1], ['2026-11-04', -7]] })?.days).toEqual([
      ['2026-11-03', CLOSE_LEVEL],
      ['2026-11-04', CLOSE_LEVEL],
    ]);
  });

  it('round-trips through a save, and old saves read as they did', () => {
    const g = guess(newGame('2026-11-02', answer), part1, true);
    expect(parseGame(JSON.parse(JSON.stringify(g)), '2026-11-02')).toEqual(g);
    // A save from before 14 Oct: no marker anywhere, nothing changes.
    const old = { day: '2026-11-02', id: 81189, guesses: [121361, 0], won: false };
    expect(parseGame(old, '2026-11-02')).toEqual(old);
    // A marker on something that is not a film is not a save this build wrote.
    expect(parseGame({ ...old, guesses: ['c:81189'] }, '2026-11-02')).toBeNull();
    const rows = parseHistory([
      { d: '2026-11-01', id: 81189, tries: 3, won: true },
      { d: '2026-11-02', id: answer, tries: 6, won: false, close: 2 },
    ]);
    expect(rows[0]).toEqual({ d: '2026-11-01', id: 81189, tries: 3, won: true });
    expect(rows[1].close).toBe(2);
  });
});
