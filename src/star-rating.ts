/**
 * A RATING IS OUT OF TEN — films from 2.0.0 (plan item 14), episodes from the
 * same release a day later. Five stars on screen, half steps, and the number
 * underneath is the server's own scale — 7 is three and a half stars, 8 is four.
 *
 * WHY TEN AND NOT 3.5. Letterboxd exports 0.5–5, Trakt and IMDb 1–10, and the
 * server has always stored 1–10. An integer out of ten holds every one of them
 * exactly; a REAL column of stars would hold them too, and then every reader
 * would be one float comparison away from 3.4999. Until this the columns held
 * whole stars, so the Letterboxd import rounded 3.5 to 4 and the Trakt and IMDb
 * imports folded 7 and 8 into one.
 *
 * ONE SCALE FOR BOTH. `movies.stars` and `episode_ratings.stars` both hold
 * 1–10, each converted once by its own flag in `db.ts` (`movieStarsScale`,
 * `episodeStarsScale`). Episodes keep their five labelled stars (BAD…WOW): a
 * half stands under the star it rounds up to (`wholeStars`).
 *
 * Pure, so the arithmetic is tested without a phone.
 */

export const RATING_MAX = 10;

/** A score already out of ten (Trakt, IMDb, Letterboxd's `rating10`, a sync op, a stored row) — or null. */
export function ratingFromTen(score: unknown): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  const v = Math.round(score);
  return v >= 1 && v <= RATING_MAX ? v : null;
}

/**
 * Stars out of five, halves allowed (Letterboxd's `rating`, an old whole-star
 * row, a TV Time vote) — out of ten, or null. Below half a star is not a rating; above five is
 * clamped, as the importers always did.
 */
export function ratingFromStars(stars: unknown): number | null {
  if (typeof stars !== 'number' || !Number.isFinite(stars) || stars < 0.5) return null;
  return Math.min(RATING_MAX, Math.round(stars * 2));
}

/**
 * Whole stars, for the places that can only say whole stars: TV Time's own
 * export format, the five-bucket histogram, and a sync op an older build reads.
 *
 * HALF ROUNDS UP — 7 is four, not three — the rule every importer here has
 * always used: rounding down quietly makes somebody think less of a film than
 * they said.
 */
export function wholeStars(ten: number | null | undefined): number | null {
  const v = ratingFromTen(ten);
  return v == null ? null : Math.ceil(v / 2);
}

/** Out of ten as stars for a person to read: 7 → 3.5, 8 → 4. */
export function starsValue(ten: number): number {
  return ten / 2;
}

export type StarSlot = 'full' | 'half' | 'empty';

/** The five stars as drawn: 7 → full, full, full, half, empty. */
export function starSlots(ten: number | null | undefined): StarSlot[] {
  const v = ratingFromTen(ten) ?? 0;
  return [1, 2, 3, 4, 5].map((i) => (v >= i * 2 ? 'full' : v === i * 2 - 1 ? 'half' : 'empty'));
}

/**
 * The stars as one line of text, for a card that prints them: 7 → "★★★½☆".
 * `½` because a half-star glyph is not in every system font, and it is how
 * Letterboxd itself writes three and a half stars in text.
 */
export function starText(ten: number | null | undefined): string {
  return starSlots(ten)
    .map((s) => (s === 'full' ? '★' : s === 'half' ? '½' : '☆'))
    .join('');
}

/**
 * WHERE A FINGER IS ON THE STAR ROW, as a rating out of ten.
 *
 * Each star is two targets, its first half and its second: anywhere in the
 * first half of the fourth star is 7, anywhere in its second half is 8. So the
 * value under the finger is the half star the finger is on — never "nearest",
 * which would make the left edge of a star mean the star before it.
 *
 * Clamped to 1–10: dragging off either end holds the end value rather than
 * clearing the rating, which is what a slide is for. Taking a rating back is
 * a tap on the same star, as it always was.
 *
 * RTL: in Arabic the row is mirrored and the first star is on the right, so
 * the distance is measured from the right edge.
 */
export function ratingAt(x: number, width: number, rtl = false): number {
  if (!(width > 0) || !Number.isFinite(x)) return 1;
  const from = rtl ? width - x : x;
  const halves = Math.ceil((from / width) * RATING_MAX);
  return Math.max(1, Math.min(RATING_MAX, halves));
}

/** A TAP is a whole star, exactly as before half stars: the i-th star (0-based) is (i + 1) × 2. */
export function ratingForTap(index: number): number {
  return Math.max(1, Math.min(5, Math.trunc(index) + 1)) * 2;
}

/**
 * The screen reader's increment and decrement: half a star each way.
 * Up from unrated is half a star; down from half a star is unrated, the same
 * NULL a tap on the same star leaves.
 */
export function stepRating(ten: number | null, dir: 1 | -1): number | null {
  const v = ratingFromTen(ten);
  if (v == null) return dir === 1 ? 1 : null;
  const next = v + dir;
  if (next < 1) return null;
  return Math.min(RATING_MAX, next);
}

/**
 * Only the stars that were given, as text: 7 → "★★★½", 8 → "★★★★". For the
 * places that always printed `'★'.repeat(n)` — a row of filled glyphs with no
 * empties — and must not print 3.5 as three (`repeat` drops the fraction).
 */
export function filledStarText(ten: number | null | undefined): string {
  return starSlots(ten)
    .filter((s) => s !== 'empty')
    .map((s) => (s === 'full' ? '★' : '½'))
    .join('');
}
