/**
 * The daily puzzle's rules. Every judgement the screen draws from is here, so
 * a wrong streak or a wrong clue is a red test rather than a wrong share text
 * posted by a thousand people.
 */
import {
  BLUR,
  CLUES,
  MAX_TRIES,
  MIN_LIBRARY_POOL,
  NO_STREAK,
  PUZZLE_EPOCH,
  SKIP,
  blurFor,
  candidatePool,
  clueParts,
  cluesShown,
  daysBetween,
  filmId,
  freezeAvailable,
  hashDay,
  guess,
  isFilmId,
  isOver,
  liveStreak,
  misses,
  newGame,
  parseGame,
  parseHistory,
  parseId,
  parsePublicPuzzle,
  pickForDay,
  pickIndex,
  publicPuzzle,
  puzzleNumber,
  recentIds,
  resultOf,
  shareText,
  shiftDay,
  squares,
  streakAfterPlay,
  streakAtRisk,
  titleMatches,
  winLevel,
  withResult,
  type Clues,
  type Streak,
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
    expect(shareText(12, g, 7)).toBe('🎬 OpenTV #12 🟥🟥🟩 3/6 🔥 7');
    expect(shareText(12, g, 0)).toBe('🎬 OpenTV #12 🟥🟥🟩 3/6');
    let lost = newGame('2026-11-12', 81189);
    for (let i = 1; i <= 6; i++) lost = guess(lost, i);
    expect(shareText(12, lost, 3)).toBe('🎬 OpenTV #12 🟥🟥🟥🟥🟥🟥 X/6 🔥 3');
  });
});

describe('the streak', () => {
  const T = '2026-11-10';

  it('starts at one and grows by one a day', () => {
    const d1 = streakAfterPlay(NO_STREAK, '2026-11-08');
    expect(d1).toEqual({ n: 1, last: '2026-11-08', frozenOn: null });
    const d2 = streakAfterPlay(d1, '2026-11-09');
    expect(d2.n).toBe(2);
    // Finishing twice in a day is one day.
    expect(streakAfterPlay(d2, '2026-11-09')).toBe(d2);
  });

  it('spends the freeze on one missed day, and only once a week', () => {
    const s: Streak = { n: 5, last: '2026-11-08', frozenOn: null };
    const saved = streakAfterPlay(s, T); // 09 missed
    expect(saved.n).toBe(6);
    expect(saved.frozenOn).toBe('2026-11-09');
    // Another miss inside the same week: the freeze is spent, so it breaks.
    const again = streakAfterPlay(saved, '2026-11-12'); // 11 missed
    expect(again.n).toBe(1);
    expect(again.frozenOn).toBe('2026-11-09');
    // A week after the freeze was spent, it is back.
    const later: Streak = { n: 3, last: '2026-11-16', frozenOn: '2026-11-09' };
    expect(freezeAvailable(later, '2026-11-18')).toBe(true);
    expect(streakAfterPlay(later, '2026-11-18').n).toBe(4);
  });

  it('breaks on two missed days, freeze or no freeze', () => {
    const s: Streak = { n: 5, last: '2026-11-06', frozenOn: null };
    expect(streakAfterPlay(s, '2026-11-09').n).toBe(1);
  });

  it('is shown alive this morning, and dead once it really is', () => {
    expect(liveStreak({ n: 4, last: '2026-11-09', frozenOn: null }, T)).toBe(4);
    expect(liveStreak({ n: 4, last: T, frozenOn: null }, T)).toBe(4);
    // Yesterday missed, freeze available: still alive, playing today keeps it.
    expect(liveStreak({ n: 4, last: '2026-11-08', frozenOn: null }, T)).toBe(4);
    // Yesterday missed, freeze spent this week: gone.
    expect(liveStreak({ n: 4, last: '2026-11-08', frozenOn: '2026-11-05' }, T)).toBe(0);
    expect(liveStreak({ n: 4, last: '2026-11-07', frozenOn: null }, T)).toBe(0);
    expect(liveStreak(NO_STREAK, T)).toBe(0);
  });

  it('is "about to break" only when tonight would actually end it', () => {
    // Played yesterday, freeze in hand: a miss today costs the freeze, not the streak.
    expect(streakAtRisk({ n: 4, last: '2026-11-09', frozenOn: null }, T)).toBe(false);
    // Played yesterday, freeze spent this week: tonight ends it.
    expect(streakAtRisk({ n: 4, last: '2026-11-09', frozenOn: '2026-11-06' }, T)).toBe(true);
    // Freeze already covering yesterday: today is the last chance.
    expect(streakAtRisk({ n: 4, last: '2026-11-08', frozenOn: null }, T)).toBe(true);
    // Already played today, or nothing to lose: no reminder.
    expect(streakAtRisk({ n: 4, last: T, frozenOn: null }, T)).toBe(false);
    expect(streakAtRisk(NO_STREAK, T)).toBe(false);
    expect(streakAtRisk({ n: 4, last: '2026-11-01', frozenOn: null }, T)).toBe(false);
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
    expect(h).toHaveLength(400);
    expect(recentIds(h, 3)).toHaveLength(3);
  });

  it('colours a first-try win darkest and a loss grey', () => {
    expect(winLevel(win('2026-11-01', 1))).toBe(6);
    expect(winLevel(win('2026-11-01', 6))).toBe(1);
    let lost = newGame('2026-11-02', 1);
    for (let i = 1; i <= 6; i++) lost = guess(lost, 100 + i);
    expect(winLevel(resultOf(lost))).toBe(0);
  });

  it('publishes counts and colours for one month, never an id', () => {
    const h = [win('2026-10-30', 1, 81189), win('2026-11-02', 3, 70327), win('2026-11-05', 6, 121361)];
    const v = publicPuzzle(h, 7, '2026-11');
    expect(v).toEqual({ n: 7, days: [['2026-11-02', 4], ['2026-11-05', 1]] });
    expect(JSON.stringify(v)).not.toContain('70327');
  });

  it('reads a published value tolerantly', () => {
    expect(parsePublicPuzzle(null)).toBeNull();
    expect(parsePublicPuzzle('x')).toBeNull();
    expect(parsePublicPuzzle({})).toEqual({ n: 0, days: [] });
    expect(parsePublicPuzzle({ n: 3.7, days: [['2026-11-02', 9], ['bad', 1], [1, 2], ['2026-11-03', -1]] })).toEqual({
      n: 3,
      days: [
        ['2026-11-02', 6],
        ['2026-11-03', 0],
      ],
    });
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

  it('keeps an old history, adds film rows to it, and feeds both to the streak block', () => {
    const old = JSON.parse(
      '[{"d":"2026-11-01","id":81189,"tries":3,"won":true},{"d":"2026-11-02","id":73244,"tries":6,"won":false},{"bad":1}]',
    );
    const h = parseHistory(old);
    expect(h).toHaveLength(2);
    const after = withResult(h, { d: '2026-11-03', id: 'm:603', tries: 1, won: true });
    expect(recentIds(after)).toEqual([81189, 73244, 'm:603']);
    expect(parseHistory(JSON.parse(JSON.stringify(after)))).toEqual(after);
    // The public block is still counts and colours: no id of either kind.
    const pub = publicPuzzle(after, 3, '2026-11');
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
