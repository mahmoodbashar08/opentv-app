/**
 * The pure half of bringing the archive over: what becomes an upload, what is
 * refused, and what the user is told afterwards.
 *
 * Nothing here touches the network or SQLite — `localCommentToSeed` takes its
 * resolver as an argument precisely so the rules deciding WHAT gets published
 * can be pinned without either. The chunking and the summary are arithmetic,
 * and arithmetic that decides a sentence a user reads deserves a test.
 */
import { chunk, localCommentToSeed, seedSummary, seedTimestamp, slug, type SeedTarget } from './pure';

/** A stand-in library: one show, one film, and nothing else resolves. */
const resolve = (name: string): SeedTarget | null => {
  const key = name.trim().toLowerCase();
  if (key === 'attack on titan') return { source: 'tvdb', key: '267440' };
  if (key === 'dune') return { source: 'title', key: 'dune|2021' };
  return null;
};

describe('localCommentToSeed', () => {
  it('maps a show-level comment', () => {
    expect(
      localCommentToSeed(
        { type: 'comment', entity: 'Attack on Titan', text: 'best show ever', date: '2019-04-01 20:11:03' },
        resolve,
      ),
    ).toEqual({
      target_source: 'tvdb',
      target_key: '267440',
      season: null,
      episode: null,
      body: 'best show ever',
      created_at: '2019-04-01T20:11:03.000Z',
      lang: null,
    });
  });

  it('reads the season and episode out of the entity', () => {
    const item = localCommentToSeed(
      { type: 'comment', entity: 'Attack on Titan S4E28', text: 'that ending', date: '2021-04-05 02:00:00' },
      resolve,
    );
    expect(item).toMatchObject({ target_source: 'tvdb', target_key: '267440', season: 4, episode: 28 });
  });

  it('takes a season-only entity as the season thread', () => {
    expect(
      localCommentToSeed({ entity: 'Attack on Titan S3', text: 'strong season', date: '2019-06-01 10:00:00' }, resolve),
    ).toMatchObject({ season: 3, episode: null });
  });

  it('maps a film through the shared identity key', () => {
    expect(
      localCommentToSeed({ type: 'comment', entity: 'Dune', text: 'the sound design', date: '2021-10-30 18:22:00' }, resolve),
    ).toMatchObject({ target_source: 'title', target_key: 'dune|2021', season: null, episode: null });
  });

  it('keeps a reply, as a top-level comment — the export carries no parent', () => {
    expect(
      localCommentToSeed({ type: 'reply', entity: 'Dune', text: 'agreed', date: '2021-11-02 09:00:00' }, resolve),
    ).toMatchObject({ body: 'agreed', target_key: 'dune|2021' });
  });

  it('refuses a comment whose entity nothing in the library resolves', () => {
    expect(
      localCommentToSeed({ entity: 'A Show Deleted Since S1E2', text: 'hello', date: '2020-01-01 00:00:00' }, resolve),
    ).toBeNull();
  });

  it('refuses an empty body — an image-only comment has nothing to publish', () => {
    expect(localCommentToSeed({ entity: 'Dune', text: '   ', date: '2021-10-30 18:22:00' }, resolve)).toBeNull();
  });

  it('refuses a comment whose date cannot be read, rather than stamping now', () => {
    expect(localCommentToSeed({ entity: 'Dune', text: 'a thought', date: 'not a date' }, resolve)).toBeNull();
    expect(localCommentToSeed({ entity: 'Dune', text: 'a thought', date: '' }, resolve)).toBeNull();
  });

  it('trims the body it sends', () => {
    expect(
      localCommentToSeed({ entity: 'Dune', text: '  spice  ', date: '2021-10-30 18:22:00' }, resolve),
    ).toMatchObject({ body: 'spice' });
  });
});

describe('seedTimestamp', () => {
  it("turns TV Time's space form into real ISO, read as UTC", () => {
    expect(seedTimestamp('2019-04-01 20:11:03')).toBe('2019-04-01T20:11:03.000Z');
  });

  it('accepts a form with no seconds', () => {
    expect(seedTimestamp('2019-04-01 20:11')).toBe('2019-04-01T20:11:00.000Z');
  });

  it('passes real ISO through unchanged in meaning', () => {
    expect(seedTimestamp('2019-04-01T20:11:03Z')).toBe('2019-04-01T20:11:03.000Z');
  });

  it('answers null for anything unreadable', () => {
    expect(seedTimestamp('')).toBeNull();
    expect(seedTimestamp(null)).toBeNull();
    expect(seedTimestamp('yesterday')).toBeNull();
  });
});

describe('chunk', () => {
  it('is empty for an empty input', () => {
    expect(chunk([], 200)).toEqual([]);
  });

  it('splits an exact multiple evenly', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('leaves the remainder in a short final chunk', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('handles a size of one', () => {
    expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  it('never loops forever on a nonsense size', () => {
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
    expect(chunk([1, 2], -5)).toEqual([[1], [2]]);
  });

  it('keeps a 200-item batch whole and starts a second for the 201st', () => {
    const items = Array.from({ length: 201 }, (_, i) => i);
    const out = chunk(items, 200);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(200);
    expect(out[1]).toEqual([200]);
  });
});

describe('seedSummary', () => {
  it('reports a clean run as a clean run', () => {
    expect(seedSummary({ imported: 47, skipped: 0, unmappable: 0 })).toEqual({
      key: 'community.seed.resultAll',
      params: { count: 47 },
    });
  });

  it('reports a repeat run as "already there", not as a success', () => {
    expect(seedSummary({ imported: 0, skipped: 47, unmappable: 0 })).toEqual({
      key: 'community.seed.resultAlready',
      params: { count: 47 },
    });
  });

  it('reports every partial outcome with all three numbers', () => {
    expect(seedSummary({ imported: 44, skipped: 3, unmappable: 2 })).toEqual({
      key: 'community.seed.resultMixed',
      params: { imported: 44, skipped: 3, unmappable: 2 },
    });
  });

  it('counts unmappable comments even when everything sent succeeded', () => {
    expect(seedSummary({ imported: 44, skipped: 0, unmappable: 2 })).toEqual({
      key: 'community.seed.resultMixed',
      params: { imported: 44, skipped: 0, unmappable: 2 },
    });
  });

  it('says nothing happened when nothing happened', () => {
    expect(seedSummary({ imported: 0, skipped: 0, unmappable: 0 })).toEqual({
      key: 'community.seed.resultNone',
      params: {},
    });
  });

  it('is defensive about junk numbers rather than printing them', () => {
    expect(seedSummary({ imported: -3, skipped: 2.7, unmappable: 0 })).toEqual({
      key: 'community.seed.resultAlready',
      params: { count: 2 },
    });
  });
});

describe('buildTargetResolver — slug fallback (the "only 2 of 4 uploaded" bug)', () => {
  // Exact-name matching alone silently dropped comments whose entity string had
  // drifted by a character. These are the shapes that actually occur.
  const cases: [string, string, boolean][] = [
    ['Dune: Part Two', 'Dune Part Two', true],
    ['The Office (US)', 'The Office  (US)', true],
    ['Amélie', 'Amelie', true],
    ['Spider-Man: No Way Home', 'Spider Man No Way Home', true],
    ['مسلسل ما', 'مسلسل  ما', true],
    ['Dune', 'Arrival', false],
  ];
  it.each(cases)('%s vs %s → same slug: %s', (a, b, same) => {
    expect(slug(a) === slug(b)).toBe(same);
  });

  it('never folds an empty slug onto everything', () => {
    expect(slug('')).toBe('');
    expect(slug('!!!')).toBe('');
  });
});
