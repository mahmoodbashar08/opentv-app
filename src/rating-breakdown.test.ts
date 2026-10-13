import { ratingBreakdown, starPercents } from '@/pure';

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe('starPercents with halves (the five columns)', () => {
  it('puts a half under the star it rounds UP to', () => {
    // 1 = half a star → 1st; 5 = 2.5 → 3rd; 7 = 3.5 → 4th; 9 = 4.5 → 5th
    expect(starPercents({ '1': 1 }, 1, true)).toEqual([100, 0, 0, 0, 0]);
    expect(starPercents({ '5': 1 }, 1, true)).toEqual([0, 0, 100, 0, 0]);
    expect(starPercents({ '7': 1 }, 1, true)).toEqual([0, 0, 0, 100, 0]);
    expect(starPercents({ '9': 1 }, 1, true)).toEqual([0, 0, 0, 0, 100]);
  });

  it('always adds to 100 with every step in play', () => {
    for (const blob of [
      { '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1, '8': 1, '9': 1, '10': 1 },
      { '3': 1, '7': 1, '10': 1 },
      { '1': 7, '5': 3, '9': 13, '10': 2 },
    ]) {
      expect(sum(starPercents(blob, 99, true) ?? [])).toBe(100);
    }
  });
});

describe('ratingBreakdown (the average and the ten rows)', () => {
  it('averages the scores as given, not the rounded buckets', () => {
    // three 3.5s: 3.5/5, where the five buckets would say 4
    expect(ratingBreakdown({ '7': 3 })?.average).toBe(3.5);
    // 10, 10, 9 → 29/3/2 = 4.83 → 4.8
    expect(ratingBreakdown({ '10': 2, '9': 1 })?.average).toBe(4.8);
    expect(ratingBreakdown({ '10': 2, '9': 1 })?.count).toBe(3);
  });

  it('lists all ten steps, five stars first, zeroes included', () => {
    const b = ratingBreakdown({ '10': 1, '1': 1 });
    expect(b?.steps.map((r) => r.ten)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(b?.steps.map((r) => r.percent)).toEqual([50, 0, 0, 0, 0, 0, 0, 0, 0, 50]);
    expect(b?.steps[0]?.count).toBe(1);
  });

  it('rounds the rows to exactly 100', () => {
    const b = ratingBreakdown({ '10': 1, '7': 1, '3': 1 });
    expect(sum(b?.steps.map((r) => r.percent) ?? [])).toBe(100);
  });

  it('is null with nothing scored, and skips what is not a score', () => {
    expect(ratingBreakdown({})).toBeNull();
    expect(ratingBreakdown(null)).toBeNull();
    expect(ratingBreakdown('not json')).toBeNull();
    expect(ratingBreakdown({ '11': 4, '0': 2, x: 1, '10': -3 })).toBeNull();
    expect(ratingBreakdown('{"8":2}')?.average).toBe(4);
  });
});
