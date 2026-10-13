import {
  aheadBy,
  comparePositions,
  positionLabel,
  positionStamp,
  resolveTogetherShow,
  togetherSummary,
} from './together-pure';

const counts = { 1: 10, 2: 8, 3: 6 };

describe('positionLabel / positionStamp', () => {
  it('labels a cursor and leaves not-started to the caller', () => {
    expect(positionLabel({ season: 2, episode: 4 })).toBe('S2E4');
    expect(positionLabel(null)).toBeNull();
  });
  it('stamps nothing-watched as its own value, never as an empty string', () => {
    expect(positionStamp({ season: 2, episode: 4 })).toBe('2:4');
    expect(positionStamp(null)).toBe('none');
  });
});

describe('comparePositions', () => {
  it('sorts furthest first and not-started last', () => {
    const list = [null, { season: 1, episode: 9 }, { season: 2, episode: 1 }, { season: 2, episode: 3 }];
    expect(list.sort(comparePositions)).toEqual([
      { season: 2, episode: 3 },
      { season: 2, episode: 1 },
      { season: 1, episode: 9 },
      null,
    ]);
  });
});

describe('aheadBy', () => {
  it('needs no season lengths inside one season', () => {
    expect(aheadBy({ season: 2, episode: 4 }, { season: 2, episode: 3 }, {})).toBe(1);
    expect(aheadBy({ season: 2, episode: 1 }, { season: 2, episode: 3 }, {})).toBe(-2);
  });
  it('crosses seasons with their lengths', () => {
    // S3E1 = 10 + 8 + 1 = 19; S1E9 = 9
    expect(aheadBy({ season: 3, episode: 1 }, { season: 1, episode: 9 }, counts)).toBe(10);
  });
  it('counts not started as zero', () => {
    expect(aheadBy({ season: 1, episode: 3 }, null, {})).toBe(3);
    expect(aheadBy(null, { season: 2, episode: 1 }, counts)).toBe(-11);
    expect(aheadBy(null, null, {})).toBe(0);
  });
  it('refuses to guess across a season of unknown length', () => {
    expect(aheadBy({ season: 3, episode: 1 }, { season: 1, episode: 2 }, { 1: 10 })).toBeNull();
  });
});

describe('togetherSummary', () => {
  const me = (p: { season: number; episode: number } | null) => ({ name: 'me', isMe: true, position: p });
  it('is alone with nobody else in it', () => {
    expect(togetherSummary([me(null)], counts)).toEqual({ kind: 'alone' });
  });
  it('measures against the furthest friend', () => {
    const s = togetherSummary(
      [me({ season: 2, episode: 3 }), { name: 'Ali', isMe: false, position: { season: 2, episode: 4 } }, { name: 'Sara', isMe: false, position: null }],
      counts,
    );
    expect(s).toEqual({ kind: 'ahead', name: 'Ali', count: 1 });
  });
  it('says behind and level', () => {
    expect(togetherSummary([me({ season: 2, episode: 5 }), { name: 'Ali', isMe: false, position: { season: 2, episode: 4 } }], counts)).toEqual({
      kind: 'behind',
      name: 'Ali',
      count: 1,
    });
    expect(togetherSummary([me({ season: 2, episode: 4 }), { name: 'Ali', isMe: false, position: { season: 2, episode: 4 } }], counts)).toEqual({
      kind: 'level',
      name: 'Ali',
    });
  });
  it('falls back to the bare labels when lengths are unknown', () => {
    expect(togetherSummary([me({ season: 1, episode: 2 }), { name: 'Ali', isMe: false, position: { season: 3, episode: 1 } }], {})).toEqual({
      kind: 'labels',
      name: 'Ali',
      theirs: { season: 3, episode: 1 },
      mine: { season: 1, episode: 2 },
    });
  });
});

describe('resolveTogetherShow', () => {
  const lib = new Set([200]);
  const known = (id: number) => lib.has(id);
  it('uses the key when the library holds it', () => {
    expect(resolveTogetherShow(200, known, () => null)).toEqual({ kind: 'local', id: 200 });
  });
  it('follows a re-key breadcrumb', () => {
    expect(resolveTogetherShow(100, known, (id) => (id === 100 ? 200 : null))).toEqual({ kind: 'local', id: 200 });
  });
  it('is absent when never tracked', () => {
    expect(resolveTogetherShow(300, known, () => null)).toEqual({ kind: 'absent' });
  });
  it('is unreadable when the breadcrumb leads nowhere, and survives a loop', () => {
    expect(resolveTogetherShow(100, known, (id) => (id === 100 ? 150 : null))).toEqual({ kind: 'unreadable' });
    expect(resolveTogetherShow(1, known, (id) => (id === 1 ? 2 : 1))).toEqual({ kind: 'unreadable' });
  });
});
