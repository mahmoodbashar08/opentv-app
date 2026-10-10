/**
 * The daily puzzle's rules. Every judgement the screen draws from is here, so
 * a wrong streak or a wrong clue is a red test rather than a wrong share text
 * posted by a thousand people.
 */
import {
  BLUR,
  CLUES,
  MAX_TRIES,
  NO_STREAK,
  PUZZLE_EPOCH,
  SKIP,
  blurFor,
  cluesShown,
  daysBetween,
  freezeAvailable,
  guess,
  isOver,
  liveStreak,
  misses,
  newGame,
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
