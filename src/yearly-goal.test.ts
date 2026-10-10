/**
 * The yearly goal's rules: ahead or behind by the day of the year, what a
 * stored or published goal may look like, and when the nudge may interrupt.
 * The I/O half of `yearly-goal.ts` is never called here — see its header.
 */
import {
  GOAL_NUDGE_GAP_MS,
  GOAL_NUDGE_HOUR,
  dayOfYear,
  daysInYear,
  elapsedDay,
  goalCells,
  goalNudgeAt,
  goalPace,
  hasGoal,
  mostBehind,
  parseGoal,
  parsePublishedGoal,
  serialiseGoal,
} from '@/yearly-goal';

describe('goalPace', () => {
  // 10 Oct 2026 is day 283 of 365: 52 films spread evenly puts 40 behind you.
  it('says ahead or behind by the day of the year, rounded', () => {
    expect(goalPace(52, 43, 283, 365)).toEqual({ expected: 40, delta: 3, pct: 43 / 52, reached: false });
    expect(goalPace(52, 38, 283, 365).delta).toBe(-2);
    expect(goalPace(52, 40, 283, 365).delta).toBe(0);
  });

  it('is reached at the target and the ring never passes full', () => {
    const p = goalPace(52, 61, 283, 365);
    expect(p.reached).toBe(true);
    expect(p.pct).toBe(1);
  });

  it('expects nothing on day zero (a goal for next year)', () => {
    expect(goalPace(52, 0, 0, 365)).toEqual({ expected: 0, delta: 0, pct: 0, reached: false });
  });

  it('expects the whole target on the last day', () => {
    expect(goalPace(52, 50, 365, 365)).toEqual({ expected: 52, delta: -2, pct: 50 / 52, reached: false });
  });
});

describe('the calendar', () => {
  it('counts 1 January as day 1 and leap years as 366', () => {
    expect(dayOfYear(new Date(2026, 0, 1, 0, 30))).toBe(1);
    expect(dayOfYear(new Date(2026, 9, 10, 12))).toBe(283);
    expect(dayOfYear(new Date(2024, 11, 31, 23, 59))).toBe(366);
    expect(daysInYear(2024)).toBe(366);
    expect(daysInYear(2026)).toBe(365);
    expect(daysInYear(2100)).toBe(365);
    expect(daysInYear(2000)).toBe(366);
  });

  it('treats a past year as fully elapsed and a future one as not started', () => {
    const now = new Date(2026, 9, 10);
    expect(elapsedDay(2025, now)).toBe(365);
    expect(elapsedDay(2026, now)).toBe(283);
    expect(elapsedDay(2027, now)).toBe(0);
  });
});

describe('stored targets', () => {
  it('round-trips, drops what is not a positive integer, and clears to an empty row', () => {
    expect(parseGoal(serialiseGoal({ films: 52, episodes: 500 }))).toEqual({ films: 52, episodes: 500 });
    expect(parseGoal(serialiseGoal({ films: 0, episodes: 12.7 }))).toEqual({ episodes: 12 });
    expect(serialiseGoal({ films: 0 })).toBe('');
    expect(serialiseGoal({})).toBe('');
    expect(parseGoal('')).toEqual({});
    expect(parseGoal(null)).toEqual({});
    expect(parseGoal('not json')).toEqual({});
    expect(parseGoal('{"films":"52","episodes":-3}')).toEqual({ films: 52 });
    expect(hasGoal({ films: 52 })).toBe(true);
    expect(hasGoal({ films: 0 })).toBe(false);
  });
});

describe('goalCells and mostBehind', () => {
  const now = new Date(2026, 9, 10);

  it('makes one cell per set target, in a fixed order', () => {
    const cells = goalCells({ episodes: 500, films: 52 }, { films: 38, episodes: 420 }, 2026, now);
    expect(cells.map((c) => c.kind)).toEqual(['films', 'episodes']);
    expect(cells[0]).toEqual({ kind: 'films', target: 52, done: 38, delta: -2, reached: false });
    // 500 * 283 / 365 = 387.7 → 388 due; 420 watched is 32 ahead
    expect(cells[1]).toEqual({ kind: 'episodes', target: 500, done: 420, delta: 32, reached: false });
  });

  it('names the kind furthest behind, and nothing when ahead or reached', () => {
    const cells = goalCells({ films: 52, episodes: 500 }, { films: 38, episodes: 300 }, 2026, now);
    expect(mostBehind(cells)).toEqual({ kind: 'episodes', by: 88 });
    expect(mostBehind(goalCells({ films: 52 }, { films: 43, episodes: 0 }, 2026, now))).toBeNull();
    // 60 films on day 283 of 365 would be "behind" on 100, but the goal is DONE
    expect(mostBehind(goalCells({ films: 52 }, { films: 52, episodes: 0 }, 2026, now))).toBeNull();
    expect(mostBehind([])).toBeNull();
  });
});

describe('parsePublishedGoal', () => {
  it('accepts counts and nothing else', () => {
    const ok = parsePublishedGoal({ year: 2026, cells: [{ kind: 'films', target: 52, done: 61, delta: 21 }] });
    expect(ok).toEqual({ year: 2026, cells: [{ kind: 'films', target: 52, done: 61, delta: 21, reached: true }] });
    expect(parsePublishedGoal(null)).toBeNull();
    expect(parsePublishedGoal({ year: '2026', cells: [] })).toBeNull();
    expect(parsePublishedGoal({ year: 2026, cells: [{ kind: 'books', target: 5, done: 1, delta: 0 }] })).toBeNull();
    expect(parsePublishedGoal({ year: 2026, cells: [{ kind: 'films', target: 0, done: 1, delta: 0 }] })).toBeNull();
    expect(parsePublishedGoal({ year: 2026, cells: [{ kind: 'films', target: 52, done: -1, delta: 0 }] })).toBeNull();
  });
});

describe('goalNudgeAt', () => {
  const morning = new Date(2026, 9, 10, 9, 0, 0);
  const night = new Date(2026, 9, 10, 22, 0, 0);
  const slot = (d: Date, days = 0) => {
    const at = new Date(d);
    at.setDate(at.getDate() + days);
    at.setHours(GOAL_NUDGE_HOUR, 0, 0, 0);
    return at.getTime();
  };

  it('never nudges when not behind', () => {
    expect(goalNudgeAt(false, morning, null)).toBeNull();
    expect(goalNudgeAt(false, morning, morning.getTime() - 30 * 86400000)).toBeNull();
  });

  it('books this evening, or tomorrow evening once it has passed', () => {
    expect(goalNudgeAt(true, morning, null)).toBe(slot(morning));
    expect(goalNudgeAt(true, night, null)).toBe(slot(night, 1));
  });

  it('is at most one a week', () => {
    expect(goalNudgeAt(true, morning, morning.getTime() - 3 * 86400000)).toBeNull();
    expect(goalNudgeAt(true, morning, morning.getTime() - GOAL_NUDGE_GAP_MS)).toBe(slot(morning));
  });

  it('re-books a slot that is still ahead rather than losing it to the next resync', () => {
    const booked = slot(morning, 1);
    expect(goalNudgeAt(true, morning, booked)).toBe(booked);
    expect(goalNudgeAt(false, morning, booked)).toBeNull();
  });
});
