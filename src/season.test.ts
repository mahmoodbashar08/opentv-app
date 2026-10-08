const meta: Record<string, string> = {};
jest.mock('@/db', () => ({
  getMeta: (k: string) => meta[k] ?? null,
  setMeta: (k: string, v: string) => {
    meta[k] = v;
  },
}));

import { availableSeasons, currentDecoration, currentTheme, setDecoration, setSeasonalOn, setTheme, storeEvent } from '@/season';

beforeEach(() => {
  for (const k of Object.keys(meta)) delete meta[k];
});

describe('seasonal events', () => {
  it('shows nothing until the dashboard turns an event on', () => {
    storeEvent(null);
    expect(currentDecoration(false)).toBeNull();
    storeEvent('halloween');
    expect(currentDecoration(false)).toBe('🎃');
  });

  it('a free user loses the look when the event ends; Plus keeps every season', () => {
    storeEvent('halloween');
    setDecoration('👻');
    setTheme('halloween');
    // Picking another decoration is Plus: free falls back to the event's own.
    expect(currentDecoration(false)).toBe('🎃');
    expect(currentTheme(false)?.id).toBe('halloween');
    storeEvent(null);
    expect(currentDecoration(false)).toBeNull();
    expect(currentTheme(false)).toBeNull();
    expect(currentDecoration(true)).toBe('👻');
    expect(currentTheme(true)?.id).toBe('halloween');
    expect(availableSeasons(true).map((s) => s.id)).toEqual(['halloween', 'christmas']);
  });

  it('respects "none" and the master switch, and ignores unknown events', () => {
    storeEvent('christmas');
    setDecoration('');
    expect(currentDecoration(false)).toBeNull();
    setDecoration('🎁');
    setSeasonalOn(false);
    expect(currentDecoration(true)).toBeNull();
    setSeasonalOn(true);
    storeEvent('easter');
    expect(availableSeasons(false)).toEqual([]);
  });
});
