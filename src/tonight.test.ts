import { fitsTime, pickTonight, score, type Ask, type Candidate } from '@/tonight';

/**
 * The three answers to "what should I watch tonight?".
 *
 * What can be wrong here in a way that quietly ruins the feature:
 *
 *  1. TIME TREATED AS A PREFERENCE. Told "twenty minutes", a two-hour film is
 *     not a lower-ranked answer, it is a wrong one — and the person stops
 *     trusting the screen after being wrong once.
 *  2. MOOD TREATED AS A FILTER. A personal library is small; filtering on
 *     genre returns nothing at all, which reads as a broken screen.
 *  3. NO VARIETY. Ranked purely by score, a library mid-way through one show
 *     answers with that show three times — the Watch Next screen with extra
 *     steps, and not a choice at all.
 *  4. UNKNOWN RUNTIME ASSUMED SHORT, which is guessing on the one question
 *     the person actually asked.
 */

const c = (over: Partial<Candidate> & { key: string }): Candidate => ({
  kind: 'movie',
  group: over.key,
  title: over.key,
  poster: null,
  minutes: 100,
  genres: [],
  lastWatchedDaysAgo: null,
  remaining: null,
  stars: null,
  available: false,
  ...over,
});

const ASK: Ask = { time: 'any', want: 'any', mood: 'any' };

describe('time is a filter, not a preference', () => {
  it('excludes a film that cannot fit the evening', () => {
    expect(fitsTime(130, 'short')).toBe(false);
    expect(fitsTime(130, 'medium')).toBe(false);
    expect(fitsTime(130, 'long')).toBe(true);
  });

  it('lets bands overlap, because an hour is an honest answer to both', () => {
    expect(fitsTime(60, 'medium')).toBe(true);
    expect(fitsTime(60, 'long')).toBe(true);
  });

  it('withholds an unknown length when being wrong is expensive', () => {
    expect(fitsTime(null, 'short')).toBe(false);
    expect(fitsTime(null, 'medium')).toBe(false);
    expect(fitsTime(null, 'long')).toBe(true);
    expect(fitsTime(null, 'any')).toBe(true);
  });

  it('drops a long film entirely rather than ranking it last', () => {
    const out = pickTonight([c({ key: 'epic', minutes: 180 }), c({ key: 'short', minutes: 22 })], {
      ...ASK,
      time: 'short',
    });
    expect(out.map((x) => x.key)).toEqual(['short']);
  });
});

describe('mood nudges and never excludes', () => {
  it('lifts a match above a non-match', () => {
    const funny = c({ key: 'a', genres: ['Comedy'] });
    const grim = c({ key: 'b', genres: ['Horror'] });
    expect(score(funny, { ...ASK, mood: 'funny' })).toBeGreaterThan(score(grim, { ...ASK, mood: 'funny' }));
  });

  it('still answers when nothing in the library matches the mood', () => {
    const out = pickTonight([c({ key: 'a', genres: ['Horror'] })], { ...ASK, mood: 'funny' });
    expect(out).toHaveLength(1);
  });
});

describe('finishing something wins', () => {
  it('puts two-episodes-left above a fresh start', () => {
    const nearlyDone = c({ key: 'bear', kind: 'finish', minutes: 30, remaining: 2 });
    const fresh = c({ key: 'new', kind: 'start', minutes: 30 });
    expect(score(nearlyDone, ASK)).toBeGreaterThan(score(fresh, ASK));
  });

  it('prefers the one with fewer left', () => {
    expect(score(c({ key: 'a', remaining: 1 }), ASK)).toBeGreaterThan(score(c({ key: 'b', remaining: 4 }), ASK));
  });

  it('does not reward a show with a whole season to go', () => {
    expect(score(c({ key: 'a', remaining: 20 }), ASK)).toBe(score(c({ key: 'b', remaining: null }), ASK));
  });
});

describe('what you were already holding', () => {
  it('beats what you abandoned three years ago', () => {
    const warm = c({ key: 'a', kind: 'continue', lastWatchedDaysAgo: 4 });
    const cold = c({ key: 'b', kind: 'continue', lastWatchedDaysAgo: 1200 });
    expect(score(warm, ASK)).toBeGreaterThan(score(cold, ASK));
  });

  it('counts your own rating, in both directions', () => {
    expect(score(c({ key: 'a', stars: 9 }), ASK)).toBeGreaterThan(score(c({ key: 'b', stars: 3 }), ASK));
  });
});

describe('three different decisions, not one show three times', () => {
  it('never offers the same show twice', () => {
    const eps = [1, 2, 3].map((n) =>
      c({ key: `sev-${n}`, group: 'sev', kind: 'continue', minutes: 50, lastWatchedDaysAgo: 2 }),
    );
    const out = pickTonight([...eps, c({ key: 'film', minutes: 100 })], ASK);
    expect(out.filter((x) => x.group === 'sev')).toHaveLength(1);
  });

  it('caps any one kind at two', () => {
    const films = [1, 2, 3, 4].map((n) => c({ key: `f${n}`, group: `f${n}`, kind: 'movie' }));
    const out = pickTonight(films, ASK);
    expect(out.filter((x) => x.kind === 'movie')).toHaveLength(2);
  });

  it('returns fewer than three rather than a wrong one', () => {
    expect(pickTonight([c({ key: 'only' })], ASK)).toHaveLength(1);
    expect(pickTonight([], ASK)).toHaveLength(0);
  });

  it('gives the same answer twice for the same library and question', () => {
    const lib = [c({ key: 'b' }), c({ key: 'a' }), c({ key: 'c' })];
    expect(pickTonight(lib, ASK)).toEqual(pickTonight([...lib].reverse(), ASK));
  });
});

describe('what you asked for', () => {
  it('"continue" excludes films and fresh starts', () => {
    const out = pickTonight(
      [c({ key: 'film', kind: 'movie' }), c({ key: 'sev', kind: 'continue' }), c({ key: 'new', kind: 'start' })],
      { ...ASK, want: 'continue' },
    );
    expect(out.map((x) => x.kind)).toEqual(['continue']);
  });

  it('"new" excludes what you are already part-way through', () => {
    const out = pickTonight([c({ key: 'sev', kind: 'continue' }), c({ key: 'film', kind: 'movie' })], {
      ...ASK,
      want: 'new',
    });
    expect(out.map((x) => x.key)).toEqual(['film']);
  });
});
