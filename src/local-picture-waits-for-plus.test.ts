/**
 * A PICTURE WRITTEN IN THE APP WAITS FOR PLUS. A RESCUED ONE DOES NOT.
 *
 * Two kinds of comment photograph live in the same table and look identical:
 * neither has a server id, both are a filename in Documents.
 *
 *   - RESCUED from the TV Time export. Uploading it is not a paid feature and
 *     never will be — that CDN is gone, the copy on the phone is the last one
 *     anywhere, and the whole point of the rescue is that it survives.
 *   - WRITTEN HERE, on the local composer. Pictures on comments are OpenTV
 *     Plus, so this one must not travel until the tier is bought.
 *
 * The route they share, `/v1/comments/image`, is the bulk rescue one and has NO
 * Plus check on the server — correctly. So the holding back has to happen on
 * the phone, which is the only place that knows which kind a row is. That is
 * the entire reason `origin` has a third value.
 *
 * AND THE PART THAT IS EASY TO GET WRONG. Skipping a row still advances the
 * seeder's cursor past it and still stamps the run finished. Buy Plus a minute
 * later and those pictures sit behind a cursor that never returns — unsent for
 * ever, with nothing reporting a problem. So gaining Plus reopens the run.
 * That is this codebase's oldest bug shape, and it has now been paid for four
 * times: progress recorded without the condition it was made under.
 */

const meta = new Map<string, string>();
jest.mock('./db', () => ({
  getMeta: (k: string) => meta.get(k) ?? null,
  setMeta: (k: string, v: string) => {
    meta.set(k, v);
  },
}));
jest.mock('./analytics', () => ({ track: () => {} }));
jest.mock('expo-router', () => ({ router: { push: () => {} } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setPlusEntitled, isPlus } = require('./plus') as typeof import('./plus');

const PROGRESS = 'communitySeedImagesProgress';
const DONE = 'communitySeedImagesDone';

beforeEach(() => {
  meta.clear();
  setPlusEntitled(false);
});

describe('buying Plus reopens the picture run', () => {
  it('clears a finished run, so skipped pictures are walked again', () => {
    // The state a device is in after joining WITHOUT Plus: every locally
    // written picture was held back, the cursor moved past them anyway, and
    // the run declared itself done.
    meta.set(PROGRESS, JSON.stringify({ cursor: 900, imported: 0, skipped: 4 }));
    meta.set(DONE, '1');

    setPlusEntitled(true);

    expect(meta.get(DONE)).toBe('');
    expect(meta.get(PROGRESS)).toBe('');
  });

  it('does not reopen it when Plus was already on', () => {
    setPlusEntitled(true);
    meta.set(PROGRESS, JSON.stringify({ cursor: 900 }));
    meta.set(DONE, '1');

    // A launch that re-confirms the same entitlement must not throw away a
    // cursor mid-run: re-walking two hundred pictures on every open is a bill
    // the user pays in bandwidth for nothing.
    setPlusEntitled(true);

    expect(meta.get(DONE)).toBe('1');
  });

  it('does NOT reopen it when Plus goes away', () => {
    setPlusEntitled(true);
    meta.set(PROGRESS, JSON.stringify({ cursor: 900 }));
    meta.set(DONE, '1');

    setPlusEntitled(false);

    // Losing the tier stops new uploads. It is not a reason to re-send
    // everything already sent, and the entitlement is off so the run would
    // skip the local ones regardless.
    expect(meta.get(DONE)).toBe('1');
  });

  it('leaves the entitlement itself correct either way', () => {
    setPlusEntitled(true);
    expect(isPlus()).toBe(true);
    setPlusEntitled(false);
    expect(isPlus()).toBe(false);
  });
});
