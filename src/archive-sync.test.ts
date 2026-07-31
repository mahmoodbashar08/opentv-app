/**
 * The guard over "the archive heals itself".
 *
 * The whole feature is two short strings compared on every app open, and the
 * cost of getting that comparison wrong is asymmetric and invisible:
 *
 *  - a wrong `nothing` means the user's ratings never reach the server and no
 *    screen anywhere says so, which is exactly the bug this replaced a button
 *    to fix;
 *  - a wrong `full` means every launch re-walks a seven-year archive, which the
 *    server dedupes but the free tier does not forgive.
 *
 * So the decision lives in a pure function and the whole matrix is asserted
 * here, alongside the fingerprint that feeds it.
 */
import {
  archiveFingerprint,
  decideArchiveSync,
  metaKeysClearedByArchiveReupload,
  type ArchiveCounts,
} from './pure';

const counts = (over: Partial<ArchiveCounts> = {}): ArchiveCounts => ({
  comments: 12,
  episodeRatings: 228,
  episodeEmotions: 128,
  movieRatings: 40,
  movieEmotions: 9,
  characterVotes: 61,
    movieCharacterVotes: 0,
  ...over,
});

describe('archiveFingerprint', () => {
  it('is stable for identical input', () => {
    expect(archiveFingerprint(counts())).toBe(archiveFingerprint(counts()));
    // Not merely equal by luck: the same object twice, and a fresh one, agree.
    const c = counts();
    expect(archiveFingerprint(c)).toBe(archiveFingerprint({ ...c }));
  });

  it('changes when ANY one count changes', () => {
    // Every field, one at a time. A fingerprint that dropped a field would
    // silently stop noticing that whole kind of row for ever — film feelings
    // were exactly the kind of thing that would go missing here.
    const base = archiveFingerprint(counts());
    for (const key of [
      'comments',
      'episodeRatings',
      'episodeEmotions',
      'movieRatings',
      'movieEmotions',
      'characterVotes',
    ] as const) {
      expect(archiveFingerprint(counts({ [key]: counts()[key] + 1 }))).not.toBe(base);
    }
  });

  it('does not collide when two counts swap places', () => {
    // Positional, not a sum: 5 comments and 9 ratings is not the same archive
    // as 9 comments and 5 ratings.
    expect(archiveFingerprint(counts({ comments: 5, episodeRatings: 9 }))).not.toBe(
      archiveFingerprint(counts({ comments: 9, episodeRatings: 5 })),
    );
  });

  it('is a short, cheap string — seven numbers and nothing else', () => {
    const fp = archiveFingerprint(counts());
    expect(typeof fp).toBe('string');
    expect(fp.split('.')).toHaveLength(7);
    expect(fp).toMatch(/^\d+(\.\d+)*$/);
    // Cheap by construction. A content hash of a big archive would be long;
    // this cannot be, because it only ever holds six integers.
    expect(fp.length).toBeLessThan(80);
  });

  it('folds nonsense to zero rather than producing NaN', () => {
    // `'NaN' === 'NaN'` would mean "nothing changed" for ever.
    const broken = archiveFingerprint({
      ...counts(),
      comments: Number.NaN,
      episodeRatings: -3,
      movieEmotions: Number.POSITIVE_INFINITY,
    });
    expect(broken).not.toContain('NaN');
    expect(broken.startsWith('0.0.')).toBe(true);
  });

  it('an empty archive is all zeroes', () => {
    expect(
      archiveFingerprint({
        comments: 0,
        episodeRatings: 0,
        episodeEmotions: 0,
        movieRatings: 0,
        movieEmotions: 0,
        characterVotes: 0,
    movieCharacterVotes: 0,
      }),
    ).toBe('0.0.0.0.0.0.0');
  });
});

describe('decideArchiveSync', () => {
  const current = { revision: 2, fingerprint: 'a' };

  it('does NOTHING when the revision and the fingerprint both match', () => {
    // The common case, and the one the free tier depends on: this answer is
    // what makes an ordinary launch cost zero requests.
    expect(decideArchiveSync({ revision: '2', fingerprint: 'a' }, current)).toBe('nothing');
  });

  it('goes FULL when the revision differs', () => {
    // The owner's case. Everything he seeded went up under revision 1 carrying
    // one feeling per title; revision 2 is the multi-emotion shape, so the
    // cursors have to be cleared and the archive re-walked.
    expect(decideArchiveSync({ revision: '1', fingerprint: 'a' }, current)).toBe('full');
    // Even when the fingerprint ALSO differs — a contract change outranks a
    // count change, because clearing the cursors covers both.
    expect(decideArchiveSync({ revision: '1', fingerprint: 'zzz' }, current)).toBe('full');
    // And a revision from the future (a downgrade, a restored backup) is not
    // trusted either: unrecognised means re-send.
    expect(decideArchiveSync({ revision: '9', fingerprint: 'a' }, current)).toBe('full');
  });

  it('goes INCREMENTAL when only the fingerprint differs', () => {
    // Rated three episodes last night. The cursors stay, so three rows go up —
    // not seven years of history.
    expect(decideArchiveSync({ revision: '2', fingerprint: 'b' }, current)).toBe('incremental');
  });

  it('goes FULL when nothing is stored at all', () => {
    expect(decideArchiveSync({ revision: null, fingerprint: null }, current)).toBe('full');
    expect(decideArchiveSync({ revision: null, fingerprint: 'a' }, current)).toBe('full');
    // A stored revision with no fingerprint cannot prove anything was covered.
    expect(decideArchiveSync({ revision: '2', fingerprint: null }, current)).toBe('full');
  });

  it("treats resetSeedProgress's empty strings as nothing stored", () => {
    // `resetSeedProgress` writes '' rather than deleting rows, and `getMeta`
    // hands that back as a string. Read as "synced under revision 0" it would
    // still come out `full`, but only by accident; asserted so it stays true.
    expect(decideArchiveSync({ revision: '', fingerprint: '' }, current)).toBe('full');
    expect(decideArchiveSync({ revision: '', fingerprint: 'a' }, current)).toBe('full');
  });

  it('never answers "nothing" on garbage', () => {
    // The failure that costs the user their archive silently. Anything that is
    // not an exact, recognised revision must fall to a re-send.
    for (const revision of ['', '  ', 'two', '2.5', 'NaN', 'null', '02x']) {
      expect(decideArchiveSync({ revision, fingerprint: 'a' }, current)).not.toBe('nothing');
    }
  });

  it("accepts '2' but not a value that merely coerces near it", () => {
    // `Number(' 2 ')` is 2 in JavaScript, which is fine — it is still the same
    // revision. `Number('2px')` is NaN, which must not be.
    expect(decideArchiveSync({ revision: ' 2 ', fingerprint: 'a' }, current)).toBe('nothing');
    expect(decideArchiveSync({ revision: '2px', fingerprint: 'a' }, current)).toBe('full');
  });
});

/**
 * The other half of the promise, restated from this side.
 *
 * `syncArchiveIfNeeded` calls `resetSeedProgress` on the revision path, so it
 * now runs UNATTENDED, on launch, without anyone tapping anything. What it
 * clears matters more than it did when a confirmation sheet stood in front of
 * it — hence this, alongside the sibling guard in `prefetch.test.ts` and
 * `account.test.ts`.
 */
describe('resetSeedProgress, now that a launch calls it', () => {
  const cleared = metaKeysClearedByArchiveReupload();

  it('clears the seed bookmarks and NOTHING that is not one', () => {
    expect([...cleared].sort()).toEqual(
      [
        'communitySeedProgress',
        'communitySeedDone',
        'communitySeedRatingsProgress',
        'communitySeedRatingsDone',
        'communitySeedCharactersProgress',
        'communitySeedCharactersDone',
        'communitySeedImagesProgress',
        'communitySeedImagesDone',
      ].sort(),
    );
  });

  it('never takes the TV Time export data with it', () => {
    // The trap: named after TV Time, read by the community layer, and NOT
    // community state. They came out of the user's own GDPR export and are
    // written back out by exporter.ts.
    expect(cleared).not.toContain('tvtimeUserId');
    expect(cleared).not.toContain('tvtimeFriends');
  });

  it('never takes a library or import key', () => {
    for (const key of ['libraryOwner', 'importPending', 'repairRev', 'customLists', 'unmarkedEpisodes']) {
      expect(cleared).not.toContain(key);
    }
  });

  it('never signs the user out — a silent launch must not log anyone out', () => {
    for (const key of ['communityJoined', 'communityProfileId', 'communityHandle']) {
      expect(cleared).not.toContain(key);
    }
  });

  it('does not clear the revision/fingerprint stamp it is called alongside', () => {
    // The full path is: clear the cursors, run, and stamp on success. If the
    // clear also wiped the stamp there would be no visible difference — but a
    // PARTIAL run would then be indistinguishable from a never-run one in a
    // way that hides which keys are whose. They are separate keys on purpose.
    expect(cleared).not.toContain('communitySeedRevision');
    expect(cleared).not.toContain('communitySeedFingerprint');
  });
});
