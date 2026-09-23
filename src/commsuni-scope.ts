/**
 * WHAT MAY GO TO CommsUni, in one clause, in a file with no imports.
 *
 * It lives apart from `db.ts` so it can be tested: `db.ts` pulls in
 * expo-sqlite and every suite mocks it, which would make this rule the one
 * piece of the integration with no coverage — and it is the piece where being
 * wrong means sending a stranger's archived comment to a public board under
 * this user's name.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * The backfill guide is strict: send comments that ORIGINATED IN THIS APP, and
 * never the ones imported from TV Time, because the archive already holds those
 * under `origin.kind: "tvtime"` and a second copy can never merge with the
 * first. It is equally strict about what to do when the two cannot be told
 * apart — stop, and talk to the operator.
 *
 * ── Why not `origin` ────────────────────────────────────────────────────────
 *
 * The obvious test is the `origin` column: 'app' and 'local' are written in
 * OpenTV, NULL is an import. But `clearPublishedCommentOrigin` sets
 * `origin = NULL` on every 'app' row when the account changes — correct for
 * what that function is about, and from then on a comment somebody typed in
 * OpenTV is indistinguishable from a TV Time import. Backfilling on `origin`
 * would either re-send an archived comment under the wrong name, or silently
 * drop everything a user wrote before they switched accounts.
 *
 * `tvtimeUuid` is the honest marker. Written only by the importer, from the
 * export's own `comments-prod-comments.csv`, and never cleared by anything:
 * a row that has one came from TV Time, a row that does not was written here.
 * It survives account changes, re-imports and republishing, because it is a
 * fact about where the words came from rather than a claim about what some
 * server currently holds.
 */
export const COMMSUNI_ELIGIBLE_WHERE = `type != 'reply' AND tvtimeUuid IS NULL AND TRIM(text) <> ''`;
