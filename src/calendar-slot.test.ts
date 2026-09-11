/**
 * Where an airing sits in the day.
 *
 * The module around this reaches for expo-calendar and cannot be loaded here,
 * so the arithmetic is exported and tested on its own — which is the half that
 * can be wrong without anybody noticing: a wrong hour in a diary looks exactly
 * as authoritative as a right one.
 */
import { slot, type Airing } from '@/calendar-slot';

const ep = (over: Partial<Airing> = {}): Airing => ({
  key: '121361-1-1',
  title: 'Game of Thrones · S01E01',
  date: '2026-10-20',
  startsAt: '21:00',
  minutes: 60,
  ...over,
});

describe('slot', () => {
  it('times an episode at the show’s own hour', () => {
    const { start, end, allDay } = slot(ep(), new Map());
    expect(allDay).toBe(false);
    expect(start.getHours()).toBe(21);
    expect(end.getTime() - start.getTime()).toBe(60 * 60000);
  });

  /** A start without a length, or a length without a start, is a guess dressed
   *  as a fact — so neither is used. */
  it('falls back to a whole day when either half is missing', () => {
    expect(slot(ep({ startsAt: null }), new Map()).allDay).toBe(true);
    expect(slot(ep({ minutes: null }), new Map()).allDay).toBe(true);
    expect(slot(ep({ startsAt: 'tbd' }), new Map()).allDay).toBe(true);
    expect(slot(ep({ minutes: 0 }), new Map()).allDay).toBe(true);
  });

  it('lays a season dropped in one go back to back', () => {
    const cursor = new Map<string, number>();
    const a = slot(ep({ key: '121361-1-1', minutes: 60 }), cursor);
    const b = slot(ep({ key: '121361-1-2', minutes: 45 }), cursor);
    const c = slot(ep({ key: '121361-1-3', minutes: 30 }), cursor);
    expect(b.start.getTime()).toBe(a.end.getTime());
    expect(c.start.getTime()).toBe(b.end.getTime());
    expect(c.end.getTime() - c.start.getTime()).toBe(30 * 60000);
  });

  it('keeps two shows on the same evening out of each other’s way', () => {
    const cursor = new Map<string, number>();
    const mine = slot(ep({ key: '121361-1-1' }), cursor);
    const other = slot(ep({ key: '409795-1-1' }), cursor);
    // Different shows share an hour rather than queueing: they are on
    // different channels, and the reader is the one who decides.
    expect(other.start.getTime()).toBe(mine.start.getTime());
  });

  it('starts the next day’s episode at the hour again, not after yesterday', () => {
    const cursor = new Map<string, number>();
    slot(ep({ date: '2026-10-20' }), cursor);
    const tomorrow = slot(ep({ key: '121361-1-2', date: '2026-10-21' }), cursor);
    expect(tomorrow.start.getHours()).toBe(21);
  });

  it('lets a marathon run past midnight rather than truncating it', () => {
    const cursor = new Map<string, number>();
    let last = slot(ep({ key: '121361-1-1', startsAt: '23:00', minutes: 90 }), cursor);
    last = slot(ep({ key: '121361-1-2', startsAt: '23:00', minutes: 90 }), cursor);
    expect(last.end.getDate()).toBe(21);
  });
});
