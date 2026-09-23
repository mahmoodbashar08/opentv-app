import { isDuplicatePush } from '@/nav-guard';

describe('nav guard', () => {
  it('lets the first push through', () => {
    expect(isDuplicatePush('/movie/Heat', 1_000)).toBe(false);
  });

  it('swallows the same destination within the window', () => {
    isDuplicatePush('/movie/Alien', 10_000);
    expect(isDuplicatePush('/movie/Alien', 10_120)).toBe(true);
    expect(isDuplicatePush('/movie/Alien', 10_699)).toBe(true);
  });

  it('allows the same destination again once the window has passed', () => {
    isDuplicatePush('/show/42', 20_000);
    expect(isDuplicatePush('/show/42', 20_700)).toBe(false);
  });

  it('never blocks a different destination', () => {
    isDuplicatePush('/movie/A', 30_000);
    expect(isDuplicatePush('/movie/B', 30_010)).toBe(false);
    expect(isDuplicatePush('/movie/C', 30_020)).toBe(false);
  });

  it('treats a repeat after an intervening push as new', () => {
    isDuplicatePush('/movie/A', 40_000);
    isDuplicatePush('/movie/B', 40_010);
    expect(isDuplicatePush('/movie/A', 40_020)).toBe(false);
  });
});
