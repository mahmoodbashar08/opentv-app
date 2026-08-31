/**
 * The startup repair may not ask for ever.
 *
 * THE BUG: `originalZipBytes()` answered `null` — "not available right now,
 * retry later" — for a device that has no preserved export and no iCloud. That
 * condition never changes, so the repair never stamped its revision, and
 * "Updating episode data…" greeted the user on every single launch. It is what
 * a fresh simulator does and what every user with iCloud Drive off was getting.
 */
import { zipLookupVerdict } from './pure';

describe('zipLookupVerdict', () => {
  it('uses the export when it is there', () => {
    expect(zipLookupVerdict('ok', 0)).toEqual({ verdict: 'ok', misses: 0 });
  });

  it('is definite when the export is provably absent', () => {
    // Nothing to repair from, and nothing to wait for either.
    expect(zipLookupVerdict('absent', 0)).toEqual({ verdict: 'none', misses: 0 });
  });

  it('retries the first time it cannot reach it — one offline launch is ordinary', () => {
    expect(zipLookupVerdict('unavailable', 0).verdict).toBe('retry');
    expect(zipLookupVerdict('unavailable', 1).verdict).toBe('retry');
  });

  it('gives up on the third, so the overlay cannot be permanent', () => {
    expect(zipLookupVerdict('unavailable', 2)).toEqual({ verdict: 'none', misses: 3 });
  });

  it('stays given up once the budget is spent', () => {
    expect(zipLookupVerdict('unavailable', 9).verdict).toBe('none');
  });

  it('clears the count on success, so a later outage gets the whole budget', () => {
    // Otherwise two bad launches years apart would add up to a give-up.
    expect(zipLookupVerdict('ok', 2).misses).toBe(0);
  });
});
