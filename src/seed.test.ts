/**
 * The pure half of bringing the archive over: what becomes an upload, what is
 * refused, and what the user is told afterwards.
 *
 * Nothing here touches the network or SQLite — `localCommentToSeed` takes its
 * resolver as an argument precisely so the rules deciding WHAT gets published
 * can be pinned without either. The chunking and the summary are arithmetic,
 * and arithmetic that decides a sentence a user reads deserves a test.
 */
import {
  chunk,
  emotionNames,
  localCharacterToSeed,
  localCommentToSeed,
  localRatingToSeed,
  mergeRatingAndEmotion,
  seedSummary,
  seedTimestamp,
  slug,
  type LocalRatingRow,
  type SeedTarget,
} from './pure';

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

// ── ratings and feelings ─────────────────────────────────────────────────────

/** A stand-in library for votes: one show is present, everything else is not. */
const resolveRating = (row: LocalRatingRow): SeedTarget | null => {
  if (row.kind === 'show') return row.showId === 267440 ? { source: 'tvdb', key: '267440' } : null;
  const title = (row.title ?? '').trim();
  return title ? { source: 'title', key: 'dune|2021' } : null;
};

describe('localRatingToSeed', () => {
  const episode = (over: Partial<LocalRatingRow> = {}): LocalRatingRow => ({
    kind: 'show',
    showId: 267440,
    season: 4,
    episode: 28,
    stars: null,
    emotions: [],
    ...over,
  });

  it('doubles a local star into the server scale, exactly as the live vote does', () => {
    // The episode screen sends `(nextStars + 1) * 2` on a ZERO-BASED index, and
    // the row it writes is that index plus one. So the stored 1–5 doubles.
    const pairs: [number, number][] = [
      [1, 2],
      [2, 4],
      [3, 6],
      [4, 8],
      [5, 10],
    ];
    for (const [stars, score] of pairs) {
      expect(localRatingToSeed(episode({ stars }), resolveRating)).toMatchObject({ score });
    }
  });

  it('maps an episode rating with no feeling', () => {
    expect(localRatingToSeed(episode({ stars: 5 }), resolveRating)).toEqual({
      target_source: 'tvdb',
      target_key: '267440',
      season: 4,
      episode: 28,
      score: 10,
      emotions: [],
    });
  });

  it('maps a rating and a feeling together — the server takes one row for both', () => {
    expect(localRatingToSeed(episode({ stars: 4, emotions: [0] }), resolveRating)).toMatchObject({
      score: 8,
      emotions: ['shocked'],
    });
  });

  it('sends a feeling with no rating as a score-less vote', () => {
    expect(localRatingToSeed(episode({ stars: null, emotions: [9] }), resolveRating)).toMatchObject({
      score: null,
      emotions: ['thrilled'],
    });
  });

  it('sends EVERY selected feeling, not the first — the reported bug', () => {
    // Both tiles were yellow on the phone; only one of them ever left it.
    expect(localRatingToSeed(episode({ stars: null, emotions: [9, 0] }), resolveRating)).toMatchObject({
      score: null,
      emotions: ['shocked', 'thrilled'],
    });
  });

  it('maps a film through the shared identity key, with no season or episode', () => {
    expect(
      localRatingToSeed(
        { kind: 'movie', title: 'Dune', year: '2021', season: null, episode: null, stars: 3, emotions: [2] },
        resolveRating,
      ),
    ).toEqual({
      target_source: 'title',
      target_key: 'dune|2021',
      season: null,
      episode: null,
      score: 6,
      emotions: ['sad'],
    });
  });

  it('refuses a vote whose entity nothing in the library resolves', () => {
    expect(localRatingToSeed(episode({ showId: 999, stars: 5 }), resolveRating)).toBeNull();
    expect(
      localRatingToSeed(
        { kind: 'movie', title: '   ', year: null, season: null, episode: null, stars: 5, emotions: [] },
        resolveRating,
      ),
    ).toBeNull();
  });

  it('refuses a row that is neither a rating nor a feeling — the server calls that empty_vote', () => {
    expect(localRatingToSeed(episode(), resolveRating)).toBeNull();
  });

  it('refuses a star outside 1–5 rather than clamping it to a number nobody gave', () => {
    expect(localRatingToSeed(episode({ stars: 0 }), resolveRating)).toBeNull();
    expect(localRatingToSeed(episode({ stars: 6 }), resolveRating)).toBeNull();
    expect(localRatingToSeed(episode({ stars: 2.5 }), resolveRating)).toBeNull();
  });

  it('drops an emotion index outside the twelve, keeping the star', () => {
    expect(localRatingToSeed(episode({ stars: 3, emotions: [12] }), resolveRating)).toMatchObject({
      score: 6,
      emotions: [],
    });
  });

  it('refuses an episode with no season — it is not addressable', () => {
    expect(localRatingToSeed(episode({ season: null, stars: 5 }), resolveRating)).toBeNull();
  });

  it('keeps season 0 — specials are a real season', () => {
    expect(localRatingToSeed(episode({ season: 0, episode: 1, stars: 5 }), resolveRating)).toMatchObject({
      season: 0,
      episode: 1,
    });
  });
});

describe('emotionNames (the tiles both vote screens send)', () => {
  it('maps a whole multi-select to the server\'s names', () => {
    expect(emotionNames(new Set([0, 9]))).toEqual(['shocked', 'thrilled']);
  });

  it('is order-independent — the grid decides, not the tap order', () => {
    expect(emotionNames(new Set([9, 0]))).toEqual(emotionNames(new Set([0, 9])));
    expect(emotionNames([11, 2, 5])).toEqual(['sad', 'amused', 'tense']);
  });

  it('drops an index the allow-list has no name for', () => {
    // an unvalidated name becomes a JSON path in the aggregate upsert
    expect(emotionNames([12, 3, -1, 1.5, 99])).toEqual(['reflective']);
  });

  it('is [] for an empty or absent selection — "clear my feelings", not "say nothing"', () => {
    expect(emotionNames(new Set())).toEqual([]);
    expect(emotionNames(null)).toEqual([]);
    expect(emotionNames(undefined)).toEqual([]);
  });

  it('deduplicates, so a doubled index cannot become two selections', () => {
    expect(emotionNames([4, 4, 4])).toEqual(['touched']);
  });
});

describe('mergeRatingAndEmotion', () => {
  it('takes a rating with no feelings', () => {
    expect(mergeRatingAndEmotion({ stars: 4 }, [])).toEqual({ stars: 4, emotions: [] });
  });

  it('takes a feeling with no rating', () => {
    expect(mergeRatingAndEmotion(null, [{ emotion: 5 }])).toEqual({ stars: null, emotions: [5] });
  });

  it('takes both', () => {
    expect(mergeRatingAndEmotion({ stars: 2 }, [{ emotion: 7 }])).toEqual({ stars: 2, emotions: [7] });
  });

  it('keeps EVERY selected feeling — a multi-select row seeds the whole set', () => {
    // This used to keep index 2 and drop the other two, one feeling deep for
    // seven years of archive.
    expect(mergeRatingAndEmotion({ stars: 5 }, [{ emotion: 9 }, { emotion: 2 }, { emotion: 11 }])).toEqual({
      stars: 5,
      emotions: [2, 9, 11],
    });
  });

  it('is canonical: ascending and deduplicated, so re-seeding is a no-op', () => {
    expect(mergeRatingAndEmotion(null, [{ emotion: 11 }, { emotion: 0 }, { emotion: 11 }])).toEqual({
      stars: null,
      emotions: [0, 11],
    });
  });

  it('is empty for a row with nothing in it', () => {
    expect(mergeRatingAndEmotion(null, [])).toEqual({ stars: null, emotions: [] });
    expect(mergeRatingAndEmotion({ stars: null }, null)).toEqual({ stars: null, emotions: [] });
  });

  it('ignores a nonsense emotion index rather than choosing it', () => {
    expect(mergeRatingAndEmotion(null, [{ emotion: -1 }, { emotion: 3 }])).toEqual({ stars: null, emotions: [3] });
  });
});

// ── favourite characters ─────────────────────────────────────────────────────

describe('localCharacterToSeed', () => {
  const resolveChar = (row: { showId: number }): SeedTarget | null =>
    row.showId === 267440 ? { source: 'tvdb', key: '267440' } : null;

  const vote = (name: string | null, over: Record<string, unknown> = {}) => ({
    showId: 267440,
    season: 4,
    episode: 28,
    name,
    charId: null,
    ...over,
  });

  it('maps a named favourite, carrying the episode along as provenance', () => {
    expect(localCharacterToSeed(vote('Levi Ackerman', { charId: 811 }), resolveChar)).toEqual({
      target_source: 'tvdb',
      target_key: '267440',
      character: 'Levi Ackerman',
      character_id: 811,
      season: 4,
      episode: 28,
    });
  });

  it('trims the name it sends', () => {
    expect(localCharacterToSeed(vote('  Levi  '), resolveChar)).toMatchObject({ character: 'Levi' });
  });

  it('refuses an unnamed vote — TV Time exported an id whose lookup died with them', () => {
    expect(localCharacterToSeed(vote(null), resolveChar)).toBeNull();
    expect(localCharacterToSeed(vote('   '), resolveChar)).toBeNull();
  });

  it('refuses a name the server would reject, rather than spending a slot to be told 400', () => {
    // A `"` or a `\` could close the JSON path the rollup builds; a control
    // character survives the nightly recount as different bytes.
    expect(localCharacterToSeed(vote('Dr. "Bones" McCoy'), resolveChar)).toBeNull();
    expect(localCharacterToSeed(vote('back\\slash'), resolveChar)).toBeNull();
    expect(localCharacterToSeed(vote('new\nline'), resolveChar)).toBeNull();
    expect(localCharacterToSeed(vote('tab\there'), resolveChar)).toBeNull();
    expect(localCharacterToSeed(vote('del'), resolveChar)).toBeNull();
  });

  it('accepts the punctuation that is merely awkward — a dot is quoted, not injected', () => {
    expect(localCharacterToSeed(vote('Dr. House'), resolveChar)).toMatchObject({ character: 'Dr. House' });
    expect(localCharacterToSeed(vote("Eren's mother"), resolveChar)).toMatchObject({ character: "Eren's mother" });
    expect(localCharacterToSeed(vote('ليفاي'), resolveChar)).toMatchObject({ character: 'ليفاي' });
  });

  it("refuses a name past the server's limit of 100 code points", () => {
    expect(localCharacterToSeed(vote('x'.repeat(100)), resolveChar)).not.toBeNull();
    expect(localCharacterToSeed(vote('x'.repeat(101)), resolveChar)).toBeNull();
  });

  it('refuses a vote for a show the library no longer holds', () => {
    expect(localCharacterToSeed(vote('Levi', { showId: 1 }), resolveChar)).toBeNull();
  });
});

describe('seedSummary — ratings', () => {
  it('reports a clean run', () => {
    expect(seedSummary({ imported: 2140, skipped: 0, unmappable: 0 }, 'ratings')).toEqual({
      key: 'community.seed.ratingsAll',
      params: { count: 2140 },
    });
  });

  it('reports a repeat run as "already there"', () => {
    expect(seedSummary({ imported: 0, skipped: 2140, unmappable: 0 }, 'ratings')).toEqual({
      key: 'community.seed.ratingsAlready',
      params: { count: 2140 },
    });
  });

  it('reports a partial run with all three numbers', () => {
    expect(seedSummary({ imported: 2000, skipped: 100, unmappable: 40 }, 'ratings')).toEqual({
      key: 'community.seed.ratingsMixed',
      params: { imported: 2000, skipped: 100, unmappable: 40 },
    });
  });

  it('says nothing happened when nothing happened', () => {
    expect(seedSummary({ imported: 0, skipped: 0, unmappable: 0 }, 'ratings')).toEqual({
      key: 'community.seed.ratingsNone',
      params: {},
    });
  });
});

describe('seedSummary — favourite characters and the per-show collapse', () => {
  // THE CASE THIS EXISTS FOR. The app asks per episode, the server keeps one per
  // show, so a show with forty picks imports as 1 accepted and 39 skipped. That
  // is the endpoint working. The summary must reach for the wording that says
  // the extra picks were FOLDED IN, never the one that reads as a failure.
  it('sends a mostly-skipped run to the wording that explains the collapse', () => {
    expect(seedSummary({ imported: 31, skipped: 409, unmappable: 0 }, 'characters')).toEqual({
      key: 'community.seed.charactersMixed',
      params: { imported: 31, skipped: 409, unmappable: 0 },
    });
  });

  it('uses the collapse wording for a second run too, not a failure sentence', () => {
    expect(seedSummary({ imported: 0, skipped: 440, unmappable: 0 }, 'characters')).toEqual({
      key: 'community.seed.charactersAlready',
      params: { count: 440 },
    });
  });

  it('reports one favourite per show with nothing left over as a clean run', () => {
    expect(seedSummary({ imported: 31, skipped: 0, unmappable: 0 }, 'characters')).toEqual({
      key: 'community.seed.charactersAll',
      params: { count: 31 },
    });
  });

  it('counts the unnamed TV Time votes as unmappable, not as skipped', () => {
    expect(seedSummary({ imported: 31, skipped: 409, unmappable: 1200 }, 'characters')).toEqual({
      key: 'community.seed.charactersMixed',
      params: { imported: 31, skipped: 409, unmappable: 1200 },
    });
  });

  it('says nothing happened when nothing happened', () => {
    expect(seedSummary({ imported: 0, skipped: 0, unmappable: 0 }, 'characters')).toEqual({
      key: 'community.seed.charactersNone',
      params: {},
    });
  });

  it('still defaults to the comment wording when no kind is named', () => {
    expect(seedSummary({ imported: 47, skipped: 0, unmappable: 0 })).toEqual({
      key: 'community.seed.resultAll',
      params: { count: 47 },
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
