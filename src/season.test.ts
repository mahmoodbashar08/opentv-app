const meta: Record<string, string> = {};
jest.mock('@/db', () => ({
  getMeta: (k: string) => meta[k] ?? null,
  setMeta: (k: string, v: string) => {
    meta[k] = v;
  },
}));

import {
  applyPreset,
  availableSeasons,
  currentDecoration,
  currentLook,
  currentTheme,
  SEASONS,
  setDecoration,
  setPart,
  setSeasonalOn,
  setTheme,
  storeEvent,
} from '@/season';

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
    expect(availableSeasons(true).map((s) => s.id)).toEqual(['halloween', 'muertos', 'christmas', 'newyear', 'valentine', 'ramadan', 'awards']);
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

describe('seasonal looks', () => {
  it('free gets the event look only; Plus changes every part, a look at once or one part at a time', () => {
    storeEvent('halloween');
    const halloween = SEASONS[0]!;
    applyPreset(halloween, halloween.presets[2]!); // witch
    // Free: the event's own look whatever was stored.
    expect(currentLook(false)).toMatchObject({ ring: '#FF7A1A', companions: ['🦇', '👻'], effect: '🦇' });
    expect(currentDecoration(false)).toBe('🎃');
    // Plus: the witch, then one part changed on top of it.
    expect(currentLook(true)).toMatchObject({ ring: '#8B5CF6', companions: ['🐈‍⬛', '🌙'], glow: true });
    expect(currentDecoration(true)).toBe('🧹');
    setPart({ ring: '#22C55E', glow: false });
    expect(currentLook(true)).toMatchObject({ ring: '#22C55E', glow: false, companions: ['🐈‍⬛', '🌙'] });
    // A Halloween part never leaks into Christmas.
    setTheme('christmas');
    expect(currentLook(true)).toMatchObject({ ring: '#E11D48', effect: '❄️' });
  });

  it('every season is complete: its presets use only its own parts', () => {
    for (const s of SEASONS) {
      expect(s.presets).toHaveLength(4);
      for (const p of s.presets) {
        expect(s.decorations).toContain(p.deco);
        expect(s.rings).toContain(p.ring);
        expect(s.effects).toContain(p.effect);
        p.companions.forEach((c) => expect(s.companions).toContain(c));
      }
    }
  });
});
