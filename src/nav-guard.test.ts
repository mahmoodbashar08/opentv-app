import { isDuplicatePush, navTransitionEnded } from '@/nav-guard';

describe('nav guard', () => {
  it('lets the first push through', () => {
    expect(isDuplicatePush('/movie/Heat', 1_000)).toBe(false);
  });

  it('swallows the same destination within the window, even after the screen has arrived', () => {
    isDuplicatePush('/movie/Alien', 10_000);
    navTransitionEnded();
    expect(isDuplicatePush('/movie/Alien', 10_120)).toBe(true);
    expect(isDuplicatePush('/movie/Alien', 10_699)).toBe(true);
  });

  it('allows the same destination again once the window has passed', () => {
    isDuplicatePush('/show/42', 20_000);
    navTransitionEnded();
    expect(isDuplicatePush('/show/42', 20_700)).toBe(false);
  });

  it('blocks a DIFFERENT destination while the first screen is still opening', () => {
    isDuplicatePush('/movie/A', 30_000);
    expect(isDuplicatePush('/movie/B', 30_010)).toBe(true);
    // the A -> B -> A double stack from fast taps on two rows
    expect(isDuplicatePush('/movie/A', 30_020)).toBe(true);
  });

  it('blocks taps that were queued behind a slow render, past the 700ms window', () => {
    isDuplicatePush('/episode/1-s1e1', 40_000);
    // the render held the JS thread for 900ms; the second tap is only seen now
    expect(isDuplicatePush('/episode/1-s1e1', 40_900)).toBe(true);
    expect(isDuplicatePush('/episode/1-s1e2', 40_910)).toBe(true);
  });

  it('opens the lock when the screen has arrived', () => {
    isDuplicatePush('/movie/A', 50_000);
    navTransitionEnded();
    expect(isDuplicatePush('/movie/B', 50_010)).toBe(false);
  });

  it('a closing transition does not open the lock', () => {
    isDuplicatePush('/movie/A', 60_000);
    navTransitionEnded(true);
    expect(isDuplicatePush('/movie/B', 60_010)).toBe(true);
  });

  it('releases on its own when no transition ever ends', () => {
    isDuplicatePush('/nowhere', 70_000);
    expect(isDuplicatePush('/movie/B', 71_499)).toBe(true);
    expect(isDuplicatePush('/movie/B', 71_500)).toBe(false);
  });

  it('treats a repeat after an intervening push as new', () => {
    isDuplicatePush('/movie/A', 80_000);
    navTransitionEnded();
    isDuplicatePush('/movie/B', 80_010);
    navTransitionEnded();
    expect(isDuplicatePush('/movie/A', 80_020)).toBe(false);
  });
});
