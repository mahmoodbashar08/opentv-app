/**
 * Bring everything this phone's owner has written in the community back ONTO
 * the phone.
 *
 * WHY IT EXISTS. Comments written in the app went to the server and nowhere
 * else, while the local archive held only the TV Time import. The profile hid
 * the gap by showing `max(local, server)`, so the count said five and the list
 * under it drew four — and a reply was invisible twice over: missing from the
 * archive, and not counted against the comment it answered.
 *
 * `addOwnComment` now keeps new writes locally, but that does nothing for what
 * was posted before it existed. This walks the owner's own server comments once
 * and fills them in.
 *
 * REPLY COUNTS COME FROM THE SERVER, not from counting rows here. The archive
 * has no parent column — TV Time's export had none either — so a local reply
 * knows it is one but not what it answered. The server does know, and its
 * `reply_count` is the number the card should show.
 *
 * SAFE TO RUN REPEATEDLY. `addOwnComment` is idempotent on entity+date+text, and
 * the counter is written rather than incremented, so a second pass changes
 * nothing. It fails silently: this is a nicety on top of a local archive that is
 * already complete for imported rows, and an error here must never be the reason
 * a screen does not open.
 */
import { fetchProfileComments } from '@/community-comments';
import { getHandle } from '@/community-session';
import { targetLabel } from '@/community-target';
import db, { addOwnComment, dedupeOwnComments, getMeta, setMeta } from '@/db';

/** Bumped to re-run the walk after a change to what it writes. */
const SYNC_REV = '3';
const REV_KEY = 'ownCommentsSyncRev';

/** How many pages to walk in one run — a seven-year archive is thousands of
 *  rows, and the point is to fill gaps, not to hold the app open. */
const MAX_PAGES = 20;

export async function syncOwnComments(): Promise<number> {
  const handle = getHandle();
  if (handle == null) return 0;

  // Clean up after the earlier revision of this sync before adding anything.
  dedupeOwnComments();

  let written = 0;
  let cursor: string | null = null;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetchProfileComments(handle, cursor);
      if (res.items.length === 0) break;

      for (const c of res.items) {
        // ONLY WHAT WAS WRITTEN IN THE APP. `imported_at` is set exactly for the
        // comments the phone uploaded from its own TV Time archive, so those are
        // already here — and re-adding them duplicated every one: the archive
        // stores the export's `2026-06-24 12:00:00`, the server returns ISO, and
        // the two never matched as "the same comment".
        if (c.imported_at != null) continue;
        const entity = targetLabel(c);
        addOwnComment({
          entity,
          text: c.body,
          date: c.created_at,
          type: c.parent_id != null ? 'reply' : 'comment',
        });
        written++;
        // The server's count is authoritative — the archive cannot derive it.
        if (c.reply_count > 0) {
          db.runSync('UPDATE comments SET replies = ? WHERE entity = ? AND date = ? AND text = ?', [
            c.reply_count,
            entity,
            c.created_at,
            c.body,
          ]);
        }
      }

      cursor = res.next_cursor;
      if (cursor == null) break;
    }
    setMeta(REV_KEY, SYNC_REV);
  } catch {
    // Leave the revision unset so the next launch tries again.
  }
  return written;
}

/** Run once per revision. The caller does not await it. */
export function syncOwnCommentsIfNeeded(): void {
  if (getMeta(REV_KEY) === SYNC_REV) return;
  void syncOwnComments();
}
