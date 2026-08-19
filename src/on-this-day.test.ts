/**
 * The rules that decide whether a memory may interrupt somebody.
 *
 * `memoryNotificationAt` is the whole of rule 2 and rule 3 — not every day, and
 * evening rather than morning — so it is tested rather than trusted.
 */
import { memoryNotificationAt, type MemoryEvent } from '@/pure';

const finale: MemoryEvent = { kind: 'finale', year: 2024, showId: 1, show: 'Dark' };
const episode: MemoryEvent = { kind: 'episode', year: 2021, showId: 4, show: 'Fringe', season: 1, episode: 2 };
const morning = new Date(2026, 7, 18, 9, 0, 0);
const night = new Date(2026, 7, 18, 23, 30, 0);

describe('memoryNotificationAt', () => {
  it('says nothing on a day with no memory', () => {
    expect(memoryNotificationAt(null, morning, null)).toBeNull();
  });

  it('never interrupts for a single episode', () => {
    expect(memoryNotificationAt(episode, morning, null)).toBeNull();
  });

  it('delivers in the evening, not when the app happened to be opened', () => {
    const at = memoryNotificationAt(finale, morning, null);
    expect(at).not.toBeNull();
    expect(new Date(at!).getHours()).toBe(21);
  });

  it('lets the day go rather than firing after the evening has passed', () => {
    expect(memoryNotificationAt(finale, night, null)).toBeNull();
  });

  it('sends once however many times the app is opened', () => {
    expect(memoryNotificationAt(finale, morning, '2026-08-18')).toBeNull();
    expect(memoryNotificationAt(finale, morning, '2026-08-17')).not.toBeNull();
  });
});
