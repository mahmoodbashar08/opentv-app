import { describe, expect, it } from '@jest/globals';

import { COMMSUNI_ELIGIBLE_WHERE } from '@/commsuni-scope';

/**
 * WHAT MAY BE SENT TO CommsUni.
 *
 * The backfill guide draws one hard line: comments that originated in this app
 * may go, comments imported from TV Time may not, because the archive already
 * holds those and a second copy can never merge with the first. It also says
 * what to do if you cannot tell them apart — stop, and ask the operator.
 *
 * The clause is asserted as a STRING rather than exercised against SQLite
 * because `db.ts` needs expo-sqlite, which this suite mocks. That is a real
 * limit: this proves the rule is written down, not that SQLite agrees. What it
 * does catch is the change that would actually hurt — somebody switching the
 * test back to `origin`, which looks equivalent and is not.
 */
describe('CommsUni eligibility', () => {
  it('keys on tvtimeUuid, not on origin', () => {
    // `origin` is cleared to NULL for every 'app' row when the account
    // changes (`clearPublishedCommentOrigin`), which from then on makes a
    // comment typed in OpenTV indistinguishable from a TV Time import.
    // Backfilling on it would either re-send somebody else's archived comment
    // under this user's name, or silently drop everything they wrote before
    // they switched accounts.
    expect(COMMSUNI_ELIGIBLE_WHERE).toContain('tvtimeUuid IS NULL');
    expect(COMMSUNI_ELIGIBLE_WHERE).not.toContain('origin');
  });

  it('excludes replies and empty text', () => {
    // Replies have their own route and their own ordering rule (a reply's
    // createdAt must not precede its parent's), so they are not part of the
    // comment count a consent prompt describes.
    expect(COMMSUNI_ELIGIBLE_WHERE).toContain("type != 'reply'");
    expect(COMMSUNI_ELIGIBLE_WHERE).toContain("TRIM(text) <> ''");
  });
});
