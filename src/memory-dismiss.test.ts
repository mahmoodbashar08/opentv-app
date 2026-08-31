/**
 * Putting today's memory away, and only today's.
 *
 * The card is a fact about today, so it does not disappear the moment it is
 * looked at — but once somebody has read it and opened the show, keeping it
 * there for the rest of the day is noise. What is stored is the DATE it was
 * dismissed, never a flag: tomorrow is a different memory and has to arrive by
 * itself, and a boolean would need something to clear it.
 */
import { localDayStamp, memoryDismissed } from './pure';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe('memoryDismissed', () => {
  it('hides the memory that was dismissed today', () => {
    expect(memoryDismissed('2026-08-31', at(2026, 8, 31))).toBe(true);
  });

  it('lets tomorrow through — a new day is a new memory', () => {
    // The whole point of storing a date rather than a flag.
    expect(memoryDismissed('2026-08-31', at(2026, 9, 1))).toBe(false);
  });

  it('shows the memory when nothing was ever dismissed', () => {
    expect(memoryDismissed(null, at(2026, 8, 31))).toBe(false);
    expect(memoryDismissed('', at(2026, 8, 31))).toBe(false);
  });

  it('ignores a stale stamp from last year', () => {
    expect(memoryDismissed('2025-08-31', at(2026, 8, 31))).toBe(false);
  });
});

describe('localDayStamp', () => {
  it('pads, so string comparison is date comparison', () => {
    // '2026-9-1' and '2026-09-01' are the same day and different strings, and
    // the comparison above is a string one.
    expect(localDayStamp(at(2026, 9, 1))).toBe('2026-09-01');
  });

  it('is the phone’s own day, not UTC’s', () => {
    /*
     * Late evening anywhere west of Greenwich is already tomorrow in UTC.
     * `toISOString().slice(0, 10)` would roll the memory over hours early and
     * hide a card the user never saw.
     */
    const lateEvening = new Date(2026, 7, 31, 23, 30);
    expect(localDayStamp(lateEvening)).toBe('2026-08-31');
  });
});
