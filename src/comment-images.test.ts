/**
 * `seedCommentImages` — rescuing the photographs, over a fake database and a
 * fake network.
 *
 * WHY THIS PHASE GETS ITS OWN SUITE. Every other kind the seeder uploads still
 * exists in the user's ZIP and can be re-derived at any time. These files
 * cannot: the export stored a LINK, TV Time's CDN no longer resolves, and the
 * only copies left anywhere are the ones OpenTV downloaded to the phone while
 * it was still up. A bug that silently skips one destroys it the next time that
 * phone is wiped. So the assertions here are mostly about NOT giving up:
 *
 *  - one bad file must not strand the hundred behind it;
 *  - a lost connection must stop the run and keep its place, because the
 *    alternative is burning through every remaining image against a dead
 *    socket and marking them all done;
 *  - the cursor must advance over rows that are skipped, or a resumed run
 *    re-examines them for ever.
 *
 * `@/db`, `@/community-session` and `@/api` are mocked; every cursor, decision
 * and meta write below is the real module.
 */
const meta = new Map<string, string>();

/** Rows the fake `comments` table holds, in id order. */
let rows: { id: number; type: string; entity: string; text: string; date: string; image: string }[] = [];
/** One entry per upload attempt, so a test can assert what was sent. */
let uploads: { body: string; created_at: string; target_key: string }[] = [];
/** Comment bodies whose upload should fail, and with which code. */
let failWith = new Map<string, string>();

jest.mock('@/db', () => ({
  getMeta: (k: string) => meta.get(k) ?? null,
  setMeta: (k: string, v: string) => {
    meta.set(k, v);
  },
  getSeedableCommentImages: (after: number) => rows.filter((r) => r.id > after),
  getShowNames: () => [{ tvdbId: 1, name: 'Attack on Titan' }],
  getMovies: () => [],
  libraryOwner: () => 'imported',
}));

jest.mock('@/community-session', () => ({
  isJoined: () => true,
  getToken: async () => 'token',
}));

jest.mock('@/api', () => {
  class ApiError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    ApiError,
    api: async () => ({}),
    apiUpload: async (_path: string, form: FormData) => {
      const body = String(form.get('body'));
      uploads.push({
        body,
        created_at: String(form.get('created_at')),
        target_key: String(form.get('target_key')),
      });
      const code = failWith.get(body);
      if (code) throw new ApiError(code);
      // The one body the fake server claims to hold already, so the
      // "already stored" path has something to exercise.
      return { ok: true, stored: body !== 'already-there' };
    },
  };
});

// Below the mocks on purpose: the module reads `@/db` at import time.
// eslint-disable-next-line import/first
import { seedCommentImages } from './community-seed';

const PROGRESS = 'communitySeedImagesProgress';
const DONE = 'communitySeedImagesDone';

const row = (id: number, over: Partial<(typeof rows)[number]> = {}) => ({
  id,
  type: 'episode',
  entity: `Attack on Titan S1E${id}`,
  text: `comment ${id}`,
  date: '2019-04-02 10:00:00',
  image: `comment-img-bg-${id}.jpg`,
  ...over,
});

beforeEach(() => {
  meta.clear();
  uploads = [];
  failWith = new Map();
  rows = [row(1), row(2), row(3)];
});

describe('seedCommentImages', () => {
  it('uploads every picture and marks the phase done', async () => {
    const res = await seedCommentImages();

    expect(uploads.map((u) => u.body)).toEqual(['comment 1', 'comment 2', 'comment 3']);
    expect(res).toMatchObject({ imported: 3, skipped: 0, unmappable: 0, finished: true, error: null });
    expect(meta.get(DONE)).toBe('1');
  });

  it('sends the SAME identity fields the comment import sent', async () => {
    // The server re-derives the comment id by hashing these; a different
    // projection here is an image bound to nothing.
    await seedCommentImages();
    expect(uploads[0].target_key).toBe('1');
    expect(uploads[0].created_at).toBe('2019-04-02T10:00:00.000Z');
  });

  it('resumes from the cursor instead of re-sending what already went', async () => {
    meta.set(PROGRESS, JSON.stringify({ cursor: 2, imported: 2, skipped: 0, unmappable: 0 }));
    const res = await seedCommentImages();

    expect(uploads.map((u) => u.body)).toEqual(['comment 3']);
    // The totals accumulate across runs rather than describing the last leg.
    expect(res.imported).toBe(3);
  });

  it('skips a file type the server would refuse, without spending a request', async () => {
    rows = [row(1, { image: 'notes.pdf' }), row(2)];
    const res = await seedCommentImages();

    expect(uploads.map((u) => u.body)).toEqual(['comment 2']);
    expect(res).toMatchObject({ unmappable: 1, imported: 1, finished: true });
  });

  it('skips a comment whose target cannot be resolved — its picture has nothing to hang on', async () => {
    rows = [row(1, { entity: 'Some Show Nobody Tracks S1E1' }), row(2)];
    const res = await seedCommentImages();

    expect(uploads.map((u) => u.body)).toEqual(['comment 2']);
    expect(res.unmappable).toBe(1);
  });

  it('keeps going after ONE image fails — the rest are not its fault', async () => {
    failWith.set('comment 2', 'too_large');
    const res = await seedCommentImages();

    expect(uploads.map((u) => u.body)).toEqual(['comment 1', 'comment 2', 'comment 3']);
    expect(res).toMatchObject({ imported: 2, skipped: 1, finished: true });
  });

  it('counts an already-stored image as skipped rather than imported', async () => {
    // The server answers `stored: false` when the image is already in the
    // bucket — a re-run must not report it as new work.
    rows = [row(1, { text: 'already-there' })];
    const res = await seedCommentImages();

    expect(res).toMatchObject({ imported: 0, skipped: 1, finished: true });
  });

  it('STOPS on a lost connection and keeps its place', async () => {
    failWith.set('comment 2', 'network');
    const res = await seedCommentImages();

    // Image 3 is never attempted: the socket is gone and trying would only
    // mark it failed too.
    expect(uploads.map((u) => u.body)).toEqual(['comment 1', 'comment 2']);
    expect(res).toMatchObject({ finished: false, error: 'network' });
    expect(meta.get(DONE)).toBeUndefined();
    // Resumes at 2, not at the start.
    expect(JSON.parse(meta.get(PROGRESS)!).cursor).toBe(1);
  });

  it('finishes cleanly when there are no pictures at all', async () => {
    rows = [];
    const res = await seedCommentImages();

    expect(uploads).toEqual([]);
    expect(res).toMatchObject({ imported: 0, finished: true, error: null });
    expect(meta.get(DONE)).toBe('1');
  });

  it('uploads a PICTURE-ONLY comment — the two in the reference export have no words', async () => {
    rows = [row(1, { text: '' })];
    const res = await seedCommentImages();

    expect(uploads.map((u) => u.body)).toEqual(['']);
    expect(res).toMatchObject({ imported: 1, unmappable: 0, finished: true });
  });

  it('advances the cursor over skipped rows, so a resumed run does not re-examine them', async () => {
    rows = [row(1, { image: 'notes.pdf' }), row(2)];
    await seedCommentImages();
    expect(JSON.parse(meta.get(PROGRESS)!).cursor).toBe(2);
  });
});
