import { isListSort, movedListIndex, sortLists, type ListSort } from '@/pure';

const L = (name: string, items = 0, totalCount?: number) => ({
  name,
  items: Array.from({ length: items }, (_, i) => i),
  ...(totalCount != null ? { totalCount } : {}),
});

describe('sortLists', () => {
  const lists = [L('Rewatch', 3), L('anime', 10, 40), L('Éire', 1)];

  it('custom leaves the stored order alone — it IS the user order', () => {
    expect(sortLists(lists, 'custom').map((l) => l.name)).toEqual(['Rewatch', 'anime', 'Éire']);
  });

  it('recent falls back to the stored order (nothing stores a timestamp)', () => {
    expect(sortLists(lists, 'recent').map((l) => l.name)).toEqual(['Rewatch', 'anime', 'Éire']);
  });

  it('az is case- and accent-aware, not code-point order', () => {
    // a raw `<` would put "Rewatch" before "anime" (uppercase sorts first) and
    // strand "Éire" after "z".
    expect(sortLists(lists, 'az').map((l) => l.name)).toEqual(['anime', 'Éire', 'Rewatch']);
  });

  it('size counts unresolved entries via totalCount, not just drawable posters', () => {
    expect(sortLists(lists, 'size').map((l) => l.name)).toEqual(['anime', 'Rewatch', 'Éire']);
  });

  it('never mutates the array it was handed', () => {
    const input = [L('b'), L('a')];
    sortLists(input, 'az');
    expect(input.map((l) => l.name)).toEqual(['b', 'a']);
  });
});

describe('movedListIndex', () => {
  const names = ['a', 'b', 'c'];

  it('moves within the list', () => {
    expect(movedListIndex(names, 'b', -1)).toBe(0);
    expect(movedListIndex(names, 'b', 1)).toBe(2);
  });

  it('refuses to move the first row up or the last row down', () => {
    expect(movedListIndex(names, 'a', -1)).toBe(-1);
    expect(movedListIndex(names, 'c', 1)).toBe(-1);
  });

  it('refuses an unknown name rather than reordering something else', () => {
    expect(movedListIndex(names, 'nope', 1)).toBe(-1);
  });
});

describe('isListSort', () => {
  it('accepts the four sorts and rejects anything else', () => {
    for (const s of ['custom', 'az', 'recent', 'size'] as ListSort[]) expect(isListSort(s)).toBe(true);
    expect(isListSort('sideways')).toBe(false);
    expect(isListSort(null)).toBe(false);
  });
});

import { mergeCustomLists, renumberLists } from '@/pure';

describe('an arrangement survives a re-import', () => {
  // The tester's exact shape: every list came from the export, none are
  // `userCreated`, and he has rearranged them by hand.
  const arranged = [
    { name: 'Comfort', order: 0 },
    { name: 'Anime', order: 1 },
    { name: 'Films', order: 2 },
  ];
  // The ZIP always emits them in its own order, which is not his.
  const fromZip = [{ name: 'Anime' }, { name: 'Films' }, { name: 'Comfort' }];

  it('keeps the placed order instead of the export order', () => {
    const merged = mergeCustomLists(fromZip, arranged, []);
    expect(merged.map((l) => l.name)).toEqual(['Comfort', 'Anime', 'Films']);
  });

  it('puts a list that has never been placed after the placed ones', () => {
    const merged = mergeCustomLists([...fromZip, { name: 'Brand New' }], arranged, []);
    expect(merged.map((l) => l.name)).toEqual(['Comfort', 'Anime', 'Films', 'Brand New']);
  });

  it('falls back to user-first when nothing has been placed yet', () => {
    const merged = mergeCustomLists(fromZip, [{ name: 'Mine' }], []);
    expect(merged.map((l) => l.name)).toEqual(['Mine', 'Anime', 'Films', 'Comfort']);
  });

  it('still honours tombstones', () => {
    const merged = mergeCustomLists(fromZip, arranged, ['Films']);
    expect(merged.map((l) => l.name)).toEqual(['Comfort', 'Anime', 'Films']);
  });
});

describe('renumberLists', () => {
  it('closes gaps left by a delete so numbers never drift', () => {
    const after = renumberLists([{ name: 'a', order: 0 }, { name: 'c', order: 2 }]);
    expect(after.map((l) => l.order)).toEqual([0, 1]);
  });

  it('stamps a list that arrived without a number', () => {
    expect(renumberLists([{ name: 'new' }, { name: 'old', order: 9 }])).toEqual([
      { name: 'new', order: 0 },
      { name: 'old', order: 1 },
    ]);
  });
});

import { orderImportedLists } from '@/pure';

describe('orderImportedLists', () => {
  it('uses TV Time ordering when the export actually populates it', () => {
    const out = orderImportedLists([
      { ordering: '2', createdAt: '2020-01-01' },
      { ordering: '1', createdAt: '2024-01-01' },
    ]);
    expect(out.map((l) => l.ordering)).toEqual(['1', '2']);
  });

  it('falls back to creation date when ordering is 0 on every row — the real export', () => {
    // Verified against two real exports: `ordering` is 0 or blank on all 16
    // lists in one and all 4 in the other. Sorting on it would be a no-op.
    const out = orderImportedLists([
      { ordering: '0', createdAt: '2026-01-24 23:22:05' },
      { ordering: '0', createdAt: '2023-04-29 18:57:26' },
      { ordering: '', createdAt: '2024-12-15 01:21:39' },
    ]);
    expect(out.map((l) => l.createdAt)).toEqual([
      '2023-04-29 18:57:26',
      '2024-12-15 01:21:39',
      '2026-01-24 23:22:05',
    ]);
  });

  it('sorts a dateless row last rather than to the top', () => {
    const out = orderImportedLists([
      { ordering: '0', createdAt: '' },
      { ordering: '0', createdAt: '2023-01-01' },
    ]);
    expect(out.map((l) => l.createdAt)).toEqual(['2023-01-01', '']);
  });

  it('is stable when everything ties', () => {
    const out = orderImportedLists([
      { ordering: '0', createdAt: '2023-01-01' },
      { ordering: '0', createdAt: '2023-01-01' },
    ]);
    expect(out).toHaveLength(2);
  });
});

import { archivedCommentKey } from '@/pure';

describe('archivedCommentKey', () => {
  // The profile counted every row while the list filtered deleted ones out, so
  // a deleted comment left the two disagreeing — 5 above, 4 below. Both sides
  // now derive the key here, so they cannot drift.
  const c = { entity: 'Riverdale S1E1', date: '2026-07-06 12:00:00', text: 'Comfort show. No notes.' };

  it('is stable for the same comment', () => {
    expect(archivedCommentKey(c)).toBe(archivedCommentKey({ ...c }));
  });

  it('separates two comments on the same title and date', () => {
    expect(archivedCommentKey(c)).not.toBe(archivedCommentKey({ ...c, text: 'Something else entirely' }));
  });

  it('matches the SQL the count filters with: entity|date|first 40 chars', () => {
    const long = { ...c, text: 'x'.repeat(60) };
    expect(archivedCommentKey(long)).toBe(`${c.entity}|${c.date}|${'x'.repeat(40)}`);
  });

  it('collides for two image-only rows on one title and date — known, and why the LIST keys on rowid', () => {
    const a = { entity: 'Riverdale S1E1', date: '2026-07-06 12:00:00', text: '' };
    const b = { ...a };
    expect(archivedCommentKey(a)).toBe(archivedCommentKey(b));
  });
});
