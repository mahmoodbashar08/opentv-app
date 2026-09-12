import { daysBetween, onTrack, planFor, plans, type Behind } from '@/catch-up';

/**
 * "Can I catch up before the new season?"
 *
 * What can be wrong here in a way that makes the feature worse than nothing:
 *
 *  1. ROUNDING THE PACE DOWN. A plan needing 1.4 episodes a week that says
 *     "one a week" misses the premiere — and the person only finds out on the
 *     day, having followed the plan exactly.
 *  2. SORTING BY PREMIERE DATE, which reads as obvious and is backwards: a
 *     premiere in three days with one episode left is calm, one in six weeks
 *     with forty left is the emergency.
 *  3. PROMISING THE IMPOSSIBLE. Told to watch nine episodes a day, somebody
 *     stops believing every other number this app shows them.
 *  4. A PLAN THAT RECALCULATES DAILY can never be fallen behind on, which
 *     makes the follow-up meaningless.
 */

const b = (over: Partial<Behind> = {}): Behind => ({
  showId: 1,
  showName: 'The Last of Us',
  poster: null,
  remaining: 9,
  minutes: 540,
  premiere: '2026-10-18',
  season: 3,
  lastWatchedDaysAgo: 40,
  ...over,
});

describe('the pace', () => {
  it('rounds up, so the plan finishes early rather than late', () => {
    // 9 episodes, 63 days = exactly 9 weeks = 1.0/week. Ten would need 1.11.
    expect(planFor(b({ remaining: 10 }), '2026-08-16')!.perWeek).toBe(2);
  });

  it('says how early, so the slack is visible rather than hidden', () => {
    const p = planFor(b({ remaining: 9 }), '2026-09-12')!;
    expect(p.daysLeft).toBe(36);
    expect(p.perWeek).toBe(2); // 9 / (36/7) = 1.75 -> 2
    expect(p.spareDays).toBeGreaterThan(0);
  });

  it('never asks for less than one a week', () => {
    expect(planFor(b({ remaining: 1 }), '2026-01-01')!.perWeek).toBe(1);
  });

  it('marks a pace nobody can keep instead of pretending', () => {
    const p = planFor(b({ remaining: 60 }), '2026-10-11')!; // 60 in a week
    expect(p.tight).toBe(true);
    expect(p.perWeek).toBeGreaterThan(7);
  });
});

describe('when there is no plan to make', () => {
  it('returns nothing once the premiere has passed', () => {
    expect(planFor(b(), '2026-10-19')).toBeNull();
    expect(planFor(b(), '2026-10-18')).toBeNull(); // today is not a plan
  });

  it('returns nothing when there is nothing to catch up on', () => {
    expect(planFor(b({ remaining: 0 }), '2026-09-12')).toBeNull();
  });
});

describe('which one is urgent', () => {
  it('ranks by pace, not by which premiere comes first', () => {
    const calm = b({ showId: 1, showName: 'Calm', remaining: 1, premiere: '2026-09-15' });
    const panic = b({ showId: 2, showName: 'Panic', remaining: 40, premiere: '2026-10-24' });
    expect(plans([calm, panic], '2026-09-12').map((p) => p.showName)).toEqual(['Panic', 'Calm']);
  });

  it('drops the ones with no plan', () => {
    expect(plans([b({ remaining: 0 }), b({ showId: 2 })], '2026-09-12')).toHaveLength(1);
  });
});

describe('keeping up', () => {
  it('is fine at the start of the first week', () => {
    const p = planFor(b(), '2026-09-12')!;
    expect(onTrack(p, 0, 3).ok).toBe(true);
  });

  it('says how many to watch to get back on the pace it originally set', () => {
    const p = planFor(b({ remaining: 9 }), '2026-09-12')!; // 2 a week
    // Two weeks in, nothing watched: four were due.
    expect(onTrack(p, 0, 14)).toEqual({ behindBy: 4, ok: false });
    // Two watched: still two short.
    expect(onTrack(p, 2, 14)).toEqual({ behindBy: 2, ok: false });
    // Ahead of it.
    expect(onTrack(p, 6, 14)).toEqual({ behindBy: 0, ok: true });
  });
});

describe('dates', () => {
  it('counts whole days and survives a month boundary', () => {
    expect(daysBetween('2026-09-12', '2026-10-18')).toBe(36);
    expect(daysBetween('2026-10-18', '2026-09-12')).toBe(-36);
  });

  it('answers zero for nonsense rather than throwing', () => {
    expect(daysBetween('', '2026-10-18')).toBe(0);
  });
});
