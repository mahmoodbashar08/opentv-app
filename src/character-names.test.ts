/**
 * The favourite-character recovery.
 *
 * The owner's export holds seventeen favourites and not one character name —
 * only a `show_character_id`. They were written off as unsendable. They are
 * TheTVDB character ids, so they resolve, and this file pins the three things
 * that recovery depends on and that nothing else can catch:
 *
 *  1. WHICH ROWS ARE WORTH ASKING ABOUT. Ask about too few and votes stay lost;
 *     ask about the same dead id every launch and the app taxes TheTVDB for
 *     ever on a question already answered.
 *  2. A MISS IS REMEMBERED, A NETWORK FAILURE IS NOT. The asymmetry is the
 *     whole safety of the feature: one flight in aeroplane mode must not stamp
 *     `nameTried` across an entire history and destroy the chance of ever
 *     recovering it.
 *  3. FILLING A NAME MOVES THE FINGERPRINT. Without this the recovered names
 *     never leave the device — a backfill changes names, not row counts, and
 *     the sync only wakes for a changed fingerprint.
 *
 * The network itself is not tested; `tvdbCharacter` is mocked at its three
 * outcomes, which is the contract this module actually consumes.
 */
import { archiveFingerprint, characterIdsNeedingNames, sendableCharacterVoteCount, type ArchiveCounts } from './pure';

// ---------------------------------------------------------------------------
// 1. The pure decision
// ---------------------------------------------------------------------------

describe('characterIdsNeedingNames', () => {
  it('asks about a nameless vote that carries an id', () => {
    expect(characterIdsNeedingNames([{ name: null, charId: 65427983, nameTried: 0 }])).toEqual([65427983]);
  });

  it('leaves an already-named vote alone', () => {
    // The in-app poll writes the name directly; there is nothing to recover.
    expect(characterIdsNeedingNames([{ name: 'Eddie Munson', charId: 68699185, nameTried: 0 }])).toEqual([]);
  });

  it('treats a blank name as no name', () => {
    expect(characterIdsNeedingNames([{ name: '   ', charId: 42, nameTried: 0 }])).toEqual([42]);
  });

  it('skips a vote with no id — there is nothing to ask with', () => {
    // A favourite picked in-app: name, no id. Never a lookup.
    expect(characterIdsNeedingNames([{ name: null, charId: null, nameTried: 0 }])).toEqual([]);
    expect(characterIdsNeedingNames([{ name: null, charId: 0, nameTried: 0 }])).toEqual([]);
  });

  it('never re-asks an id already answered', () => {
    // 358674 is a real id from the owner's export that TheTVDB has deleted. It
    // will 404 for ever; asking again every launch is pure waste.
    expect(characterIdsNeedingNames([{ name: null, charId: 358674, nameTried: 1 }])).toEqual([]);
  });

  it('asks once for a character that is the favourite of several episodes', () => {
    // 65235959 (Howard Hamlin) is the favourite of two Better Call Saul
    // episodes in the export. That is one request, not two.
    const ids = characterIdsNeedingNames([
      { name: null, charId: 65235959, nameTried: 0 },
      { name: null, charId: 65235959, nameTried: 0 },
      { name: null, charId: 65235968, nameTried: 0 },
    ]);
    expect(ids).toEqual([65235959, 65235968]);
  });

  it('tolerates a missing nameTried (rows read before the column existed)', () => {
    expect(characterIdsNeedingNames([{ name: null, charId: 77 }])).toEqual([77]);
  });
});

// ---------------------------------------------------------------------------
// 2. What gets remembered
// ---------------------------------------------------------------------------

/** charId → name written. */
const named = new Map<number, string>();
/** ids stamped as answered-with-no-name. */
let tried: number[] = [];
/** What the fake TheTVDB says, per id. */
let answers = new Map<number, { status: 'ok'; character: { id: number; name: string } } | { status: 'gone' } | { status: 'failed' }>();

jest.mock('@/db', () => ({
  getUnnamedCharacterVotes: () => rows,
  setCharacterVoteName: (charId: number, name: string) => {
    named.set(charId, name);
    tried.push(charId);
  },
  markCharacterNameTried: (charId: number) => {
    tried.push(charId);
  },
}));

jest.mock('@/tvdb', () => ({
  tvdbCharacter: async (id: number) => answers.get(id) ?? { status: 'failed' },
}));

let rows: { name: string | null; charId: number | null; nameTried: number }[] = [];

describe('backfillCharacterNames', () => {
  beforeEach(() => {
    named.clear();
    tried = [];
    answers = new Map();
    rows = [];
  });

  const run = async () => {
    const { backfillCharacterNames } = await import('./character-name-fetch');
    await backfillCharacterNames();
  };

  it('writes a recovered name and marks the id answered', async () => {
    rows = [{ name: null, charId: 65427983, nameTried: 0 }];
    answers.set(65427983, { status: 'ok', character: { id: 65427983, name: 'Conan Edogawa' } });
    await run();
    expect(named.get(65427983)).toBe('Conan Edogawa');
  });

  it('a DEFINITIVE miss marks nameTried', async () => {
    // TheTVDB answered: no such character. That answer will never change.
    rows = [{ name: null, charId: 358674, nameTried: 0 }];
    answers.set(358674, { status: 'gone' });
    await run();
    expect(tried).toEqual([358674]);
    expect(named.size).toBe(0);
  });

  it('a NETWORK failure marks nothing at all', async () => {
    // The asymmetry the whole feature rests on. A failed request says nothing
    // about the record; stamping it would lose the name for ever because the
    // user happened to be offline.
    rows = [{ name: null, charId: 358674, nameTried: 0 }];
    answers.set(358674, { status: 'failed' });
    await run();
    expect(tried).toEqual([]);
    expect(named.size).toBe(0);
  });

  it('a whole batch failing offline leaves every row retryable', async () => {
    rows = [
      { name: null, charId: 1, nameTried: 0 },
      { name: null, charId: 2, nameTried: 0 },
      { name: null, charId: 3, nameTried: 0 },
    ];
    // no answers registered at all → every lookup 'failed'
    await run();
    expect(tried).toEqual([]);
  });

  it('a 200 with no usable name is a miss, not a name', async () => {
    rows = [{ name: null, charId: 9, nameTried: 0 }];
    answers.set(9, { status: 'ok', character: { id: 9, name: '  ' } });
    await run();
    expect(tried).toEqual([9]);
    expect(named.size).toBe(0);
  });

  it('does nothing, and asks nothing, once every id is answered', async () => {
    rows = [{ name: null, charId: 358674, nameTried: 1 }];
    await run();
    expect(tried).toEqual([]);
    expect(named.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. The mechanism that makes recovery reach the server
// ---------------------------------------------------------------------------

describe('the archive fingerprint counts SENDABLE character votes', () => {
  const counts = (characterVotes: number): ArchiveCounts => ({
    comments: 12,
    episodeRatings: 228,
    episodeEmotions: 128,
    movieRatings: 40,
    movieEmotions: 9,
    characterVotes,
    movieCharacterVotes: 0,
  });

  it('does not count a vote the seeder would drop', () => {
    // Seventeen imported votes, none with a name: the server would receive
    // exactly none of them, so the archive holds zero of this kind.
    const imported = Array.from({ length: 17 }, () => ({ name: null }));
    expect(sendableCharacterVoteCount(imported)).toBe(0);
  });

  it('ignores a blank name the same way the seeder does', () => {
    expect(sendableCharacterVoteCount([{ name: '' }, { name: '   ' }, { name: 'BMO' }])).toBe(1);
  });

  it('FILLING A NAME MOVES THE FINGERPRINT', () => {
    // The entire point. Backfilling changes names, never row counts — so under
    // a plain COUNT(*) the fingerprint is identical before and after, the sync
    // decides "nothing", and the recovered names never leave the phone.
    const before = Array.from({ length: 17 }, () => ({ name: null as string | null }));
    const after = before.map((r, i) => (i === 0 ? { name: 'Conan Edogawa' } : r));

    expect(after.length).toBe(before.length); // the row count is UNCHANGED
    expect(archiveFingerprint(counts(sendableCharacterVoteCount(before)))).not.toBe(
      archiveFingerprint(counts(sendableCharacterVoteCount(after))),
    );
  });

  it('recovering all sixteen resolvable votes moves it once more', () => {
    // Sixteen of the owner's seventeen rows resolve; 358674 is gone from
    // TheTVDB, so the last one stays unsendable and the count stops at 16.
    const partly = archiveFingerprint(counts(1));
    const fully = archiveFingerprint(counts(16));
    expect(partly).not.toBe(fully);
    expect(fully).toContain('.16.');
  });
});
