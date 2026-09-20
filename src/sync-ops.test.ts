import { makeOp, opId, orderOps, parseOp, type Action } from '@/sync-ops';

/**
 * The decisions a device makes about another device's messages.
 *
 * What can be wrong here in a way nobody would notice until their library is:
 *
 *  1. TWO OPS IN THE SAME MILLISECOND COLLIDING. Ticking a season does this
 *     dozens of times; a clock-based id would drop all but one at the server's
 *     unique index, and the user would see most of a season not arrive.
 *  2. APPLY ORDER. `rate` then `unrate` leaves nothing; the other way round
 *     leaves a rating. Arrival order is not the order the person acted in.
 *  3. A NEWER BUILD'S VOCABULARY wedging an older phone. Skipping one op is
 *     right; refusing the batch would freeze that device for good.
 */

const round = (a: Action): Action | null => {
  const op = makeOp('phone', 1, a);
  return parseOp(op.kind, op.payload);
};

describe('op ids', () => {
  it('separate two ops made in the same millisecond', () => {
    const now = 1_700_000_000_000;
    const a = makeOp('phone', 1, { t: 'unwatch', show: 1, s: 1, e: 1 }, now);
    const b = makeOp('phone', 2, { t: 'unwatch', show: 1, s: 1, e: 2 }, now);
    expect(a.id).not.toBe(b.id);
  });

  it('separate two devices that both start counting at one', () => {
    expect(opId('phone', 1)).not.toBe(opId('tablet', 1));
  });
});

describe('round trip', () => {
  it.each<Action>([
    { t: 'watch', show: 72454, s: 2, e: 3, at: '2026-09-12 20:00:00' },
    { t: 'unwatch', show: 72454, s: 2, e: 3 },
    { t: 'rewatch', show: 72454, s: 2, e: 3 },
    { t: 'rate', show: 72454, s: 2, e: 3, stars: 9 },
    { t: 'unrate', show: 72454, s: 2, e: 3 },
    { t: 'showFlag', show: 72454, flag: 'archived', on: true },
    { t: 'showDelete', show: 72454 },
    { t: 'movieWatch', name: 'Dune', on: false },
    { t: 'movieStars', name: 'Dune', stars: 8 },
    { t: 'movieRewatch', name: 'Dune' },
    { t: 'movieDelete', name: 'Dune' },
    { t: 'movieAdd', name: 'Dune', poster: null, year: '2021', tmdbId: 438631 },
  ])('survives $t', (a) => {
    expect(round(a)).toEqual(a);
  });

  it('carries a non-Latin film title intact', () => {
    expect(round({ t: 'movieDelete', name: 'الرسالة' })).toEqual({ t: 'movieDelete', name: 'الرسالة' });
  });
});

describe('what is refused', () => {
  it('skips a kind this build has never heard of, rather than failing the batch', () => {
    expect(parseOp('listReorder', '{"name":"x"}')).toBeNull();
  });

  it('skips malformed payloads', () => {
    expect(parseOp('watch', 'not json')).toBeNull();
    expect(parseOp('watch', '[]')).toBeNull();
    expect(parseOp('watch', '{"show":1,"s":2}')).toBeNull();
  });

  it('refuses a zero rating, because an unrated episode is not a zero', () => {
    expect(parseOp('rate', '{"show":1,"s":1,"e":1,"stars":0}')).toBeNull();
    expect(parseOp('rate', '{"show":1,"s":1,"e":1,"stars":11}')).toBeNull();
  });

  it('refuses a flag it does not own', () => {
    expect(parseOp('showFlag', '{"show":1,"flag":"deleted","on":true}')).toBeNull();
  });

  it('refuses an empty film name, which would match every row or none', () => {
    expect(parseOp('movieDelete', '{"name":""}')).toBeNull();
  });
});

describe('apply order', () => {
  it('follows the device clock, not arrival at the server', () => {
    // The tablet pushed its afternoon while the phone was still offline with
    // its morning, so seq runs backwards against the clock.
    const ops = [
      { seq: 1, ts: 3000, kind: 'unrate', payload: '{"show":1,"s":1,"e":1}' },
      { seq: 2, ts: 1000, kind: 'rate', payload: '{"show":1,"s":1,"e":1,"stars":9}' },
    ];
    expect(orderOps(ops).map((o) => o.kind)).toEqual(['rate', 'unrate']);
  });

  it('breaks a tied clock with the sequence, so the result never depends on luck', () => {
    const ops = [
      { seq: 9, ts: 1000, kind: 'unrate', payload: '{}' },
      { seq: 4, ts: 1000, kind: 'rate', payload: '{}' },
    ];
    expect(orderOps(ops).map((o) => o.seq)).toEqual([4, 9]);
  });

  it('leaves the caller\u2019s array alone', () => {
    const ops = [{ seq: 2, ts: 2 }, { seq: 1, ts: 1 }];
    orderOps(ops);
    expect(ops[0].seq).toBe(2);
  });
});

describe('feelings and favourite characters', () => {
  it('carries the resulting state, not a toggle', () => {
    // A toggle applied twice is its own opposite, so two devices replaying the
    // same op would disagree about a thing they had both been told.
    expect(parseOp('emotion', '{"show":1,"s":2,"e":3,"emotion":7,"on":true}')).toEqual({
      t: 'emotion', show: 1, s: 2, e: 3, emotion: 7, on: true,
    });
    expect(parseOp('emotion', '{"show":1,"s":2,"e":3,"emotion":7,"on":false}')).toEqual({
      t: 'emotion', show: 1, s: 2, e: 3, emotion: 7, on: false,
    });
  });

  it('lets a favourite character be taken back', () => {
    expect(parseOp('charVote', '{"show":1,"s":2,"e":3,"name":"Finn"}')).toEqual({
      t: 'charVote', show: 1, s: 2, e: 3, name: 'Finn',
    });
    expect(parseOp('charVote', '{"show":1,"s":2,"e":3,"name":null}')).toEqual({
      t: 'charVote', show: 1, s: 2, e: 3, name: null,
    });
  });

  it('refuses an op that names no episode', () => {
    expect(parseOp('emotion', '{"emotion":7,"on":true}')).toBeNull();
    expect(parseOp('charVote', '{"name":"Finn"}')).toBeNull();
  });
});
