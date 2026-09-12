import { franchiseRows, nextUp, progress, type Held, type Part } from '@/franchise';

/**
 * A film's series, ticked against the library.
 *
 * What can be wrong here in a way nobody would notice:
 *
 *  1. MATCHING ON NAME ALONE. Two films share a title and the catalogue tells
 *     them apart only by id; ticking the wrong one is invisible.
 *  2. UNDATED ENTRIES SORTING FIRST. An empty string sorts before every real
 *     date, which puts an unannounced sequel at the head of the series.
 *  3. COUNTING WHAT IS NOT OUT YET, which means a series you have completely
 *     watched can never say so.
 */

const p = (tmdbId: number, title: string, release: string): Part => ({ tmdbId, title, poster: null, release });

const MCU: Part[] = [
  p(1726, 'Iron Man', '2008-05-02'),
  p(1724, 'The Incredible Hulk', '2008-06-13'),
  p(10138, 'Iron Man 2', '2010-05-07'),
];

describe('order', () => {
  it('is release order, regardless of how TMDB listed them', () => {
    const rows = franchiseRows([...MCU].reverse(), [], '2026-09-12');
    expect(rows.map((r) => r.title)).toEqual(['Iron Man', 'The Incredible Hulk', 'Iron Man 2']);
  });

  it('puts an undated sequel last, not first', () => {
    const rows = franchiseRows([p(9, 'Untitled Sequel', ''), ...MCU], [], '2026-09-12');
    expect(rows[rows.length - 1]!.title).toBe('Untitled Sequel');
  });
});

describe('matching', () => {
  it('prefers the TMDB id over the name', () => {
    const lib: Held[] = [
      { name: 'Iron Man (2011)', tmdbId: 1726, watched: true },
      { name: 'Iron Man', tmdbId: 99999, watched: false },
    ];
    const row = franchiseRows(MCU, lib, '2026-09-12')[0]!;
    expect(row.libraryName).toBe('Iron Man (2011)');
    expect(row.watched).toBe(true);
  });

  it('falls back to the name, ignoring case and stray spacing', () => {
    const rows = franchiseRows(MCU, [{ name: '  iron   man ', tmdbId: null, watched: true }], '2026-09-12');
    expect(rows[0]!.watched).toBe(true);
  });

  it('leaves a film the library never had unticked and unheld', () => {
    const rows = franchiseRows(MCU, [], '2026-09-12');
    expect(rows.every((r) => !r.held && !r.watched && r.libraryName === null)).toBe(true);
  });
});

describe('the count', () => {
  it('ignores what is not out yet, so a finished series can say so', () => {
    const rows = franchiseRows([...MCU, p(9, 'Iron Man 4', '2028-01-01')],
      MCU.map((x) => ({ name: x.title, tmdbId: x.tmdbId, watched: true })), '2026-09-12');
    expect(progress(rows)).toEqual({ watched: 3, total: 3 });
  });

  it('counts only what is watched, not what is merely owned', () => {
    const rows = franchiseRows(MCU, [{ name: 'Iron Man', tmdbId: 1726, watched: false }], '2026-09-12');
    expect(progress(rows)).toEqual({ watched: 0, total: 3 });
    expect(rows[0]!.held).toBe(true);
  });
});

describe('next up', () => {
  it('is the first released one not watched', () => {
    const rows = franchiseRows(MCU, [{ name: 'Iron Man', tmdbId: 1726, watched: true }], '2026-09-12');
    expect(nextUp(rows)!.title).toBe('The Incredible Hulk');
  });

  it('is nothing once the released ones are done', () => {
    const rows = franchiseRows(MCU, MCU.map((x) => ({ name: x.title, tmdbId: x.tmdbId, watched: true })), '2026-09-12');
    expect(nextUp(rows)).toBeNull();
  });
});
