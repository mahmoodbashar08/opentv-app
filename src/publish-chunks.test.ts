import { PUBLISH_CHUNK, publishChunks } from '@/pure';

/**
 * 250 was the most titles that fit in one request, and because one request was
 * the whole protocol it quietly became the longest a shelf could be. These are
 * the properties that make a second request safe.
 */
describe('splitting a shelf into requests', () => {
  const shelf = (n: number) => Array.from({ length: n }, (_, i) => i);

  it('sends one request for a shelf that fits', () => {
    expect(publishChunks(shelf(3))).toEqual([[0, 1, 2]]);
  });

  it('still sends one request for an empty shelf', () => {
    // Publishing REPLACES, so an empty send is how a shelf is emptied. No
    // groups would leave the old one standing for ever.
    expect(publishChunks([])).toEqual([[]]);
  });

  it('splits a long shelf without losing or reordering anything', () => {
    const all = shelf(PUBLISH_CHUNK * 2 + 7);
    const groups = publishChunks(all);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.length)).toEqual([PUBLISH_CHUNK, PUBLISH_CHUNK, 7]);
    // The order IS the shelf — most recently watched first — so a chunk
    // boundary must not disturb it.
    expect(groups.flat()).toEqual(all);
  });

  it('never exceeds what one request carries', () => {
    for (const g of publishChunks(shelf(1001))) expect(g.length).toBeLessThanOrEqual(PUBLISH_CHUNK);
  });
});
