/**
 * Publishing the profile: how much has been watched, and what.
 *
 * WHAT THIS CHANGED. Until this existed the server held comments, ratings and
 * lists, and the app told users their watch history never left the phone. It
 * now leaves, in summary: two totals, and which shows and films are followed or
 * favourited. That is what another person's profile shows
 * (design/referance/51-user-profile-sarah.png) and there is no way to draw it
 * from nothing.
 *
 * WHAT STILL DOES NOT LEAVE. There is no per-episode record anywhere on the
 * server — no dates, no order, no "watched S4E12 at 23:40 on Tuesday". The
 * difference matters: a total says how much somebody watches, a history says
 * when they were home. Only the first is published.
 *
 * IT IS A REPLACEMENT, NOT AN APPEND. Each run sends the whole shelf for one
 * kind and the server deletes what was there — so a show removed from the
 * library disappears from the profile, which an append could never do.
 *
 * NOTHING HERE THROWS. Like every other sync in this app it resolves with what
 * it managed; a profile shelf that is a day stale is not worth a crash, or an
 * error a user cannot act on.
 */
import { ApiError, api, type ApiErrorCode } from '@/api';
import { getToken, isJoined } from '@/community-session';
import {
  getMeta,
  getMovieTotals,
  getPublishableMovies,
  getPublishableShows,
  getTotals,
  libraryOwner,
  setMeta,
} from '@/db';
import { publishableStats, titlesForPublish, type PublishedTitle } from '@/pure';

/** `PUBLISH_MAX_TITLES` on the server. More in one request is a 413. */
export const PUBLISH_CHUNK = 250;

export type PublishResult = { shows: number; movies: number; error: ApiErrorCode | null };

/**
 * Send both shelves and the totals.
 *
 * NEVER FOR THE DEMO LIBRARY. Its shows and films belong to a persona, and
 * publishing them under a real account would put somebody else's taste on a
 * real person's profile — the same rule the comment seeder follows.
 *
 * THE CAP IS A TRUNCATION AND IT IS DELIBERATE. A library of two thousand films
 * publishes its first 250 — the shelf on the design shows about six — and the
 * totals still count everything, so the numbers stay honest even when the
 * shelves are partial. Favourites are ordered first by the readers, so the cap
 * never eats a title somebody chose to highlight.
 */
export async function publishProfile(): Promise<PublishResult> {
  const out: PublishResult = { shows: 0, movies: 0, error: null };
  if (!isJoined()) return { ...out, error: 'unauthenticated' };
  // 'seed' is the bundled demo library: its shows and films belong to a
  // persona, and publishing them would put somebody else's taste on a real
  // person's profile. A 'fresh' library is the user's own from the first tap.
  if (libraryOwner() === 'seed') return out;

  let token: string | null = null;
  try {
    token = await getToken();
  } catch {
    token = null;
  }
  if (!token) return { ...out, error: 'unauthenticated' };

  let stats: { episodes_watched: number; minutes_watched: number };
  let shows: PublishedTitle[];
  let movies: PublishedTitle[];
  try {
    const t = getTotals();
    const m = getMovieTotals();
    stats = publishableStats({ episodes: t.episodes, showMinutes: t.minutes, movieMinutes: m.minutes });
    // FAVOURITES FIRST, THEN TRUNCATE. The cap has to fall somewhere, and it
    // must never fall on a title the owner explicitly hearted — that is the one
    // part of a shelf they chose deliberately.
    const byFavourite = (a: PublishedTitle, b: PublishedTitle) => Number(b.favourite) - Number(a.favourite);
    shows = titlesForPublish(getPublishableShows(), 'show').sort(byFavourite).slice(0, PUBLISH_CHUNK);
    movies = titlesForPublish(getPublishableMovies(), 'movie').sort(byFavourite).slice(0, PUBLISH_CHUNK);
  } catch {
    return { ...out, error: 'unknown' };
  }

  for (const [kind, titles] of [
    ['show', shows],
    ['movie', movies],
  ] as const) {
    try {
      await api('/v1/me/published', { method: 'PUT', token, body: { kind, stats, titles } });
      if (kind === 'show') out.shows = titles.length;
      else out.movies = titles.length;
    } catch (e) {
      // The first failure is reported and the second kind is still attempted:
      // one bad shelf should not cost the other, and both are replaced whole on
      // the next run anyway.
      out.error = out.error ?? (e instanceof ApiError ? e.code : 'unknown');
    }
  }
  return out;
}

/** What the last successful publish covered. Cleared with the rest of the
 *  community's state on sign-out — see `COMMUNITY_SIGN_OUT_META_KEYS`. */
const PUBLISH_FINGERPRINT_KEY = 'communityPublishFingerprint';

/**
 * Publish only when there is something new to say.
 *
 * WHY A FINGERPRINT AND NOT A TIMER. This runs on every launch and every return
 * from the background, and the overwhelmingly common case is that nothing has
 * changed since the last one. A timer would send two full shelves a day for no
 * reason; a fingerprint sends zero requests until an episode is watched, a show
 * is added or a heart is tapped — the same rule `syncArchiveIfNeeded` follows,
 * for the same reason: the free tier is sized in requests per user per day.
 *
 * The fingerprint is deliberately COARSE — five integers. It cannot notice a
 * show being renamed or a poster arriving, and that is the right trade: those
 * are cosmetic, they arrive with the next real change, and the alternative is
 * hashing the whole library on every launch.
 */
export async function publishIfChanged(): Promise<PublishResult | null> {
  if (!isJoined() || libraryOwner() === 'seed') return null;

  let fingerprint = '';
  try {
    const t = getTotals();
    const m = getMovieTotals();
    const shows = getPublishableShows();
    const movies = getPublishableMovies();
    fingerprint = [
      t.episodes,
      t.shows,
      m.watched,
      shows.filter((s) => s.favourite).length,
      movies.filter((s) => s.favourite).length,
    ].join('.');
  } catch {
    return null;
  }

  let stored: string | null = null;
  try {
    stored = getMeta(PUBLISH_FINGERPRINT_KEY);
  } catch {
    stored = null;
  }
  if (stored === fingerprint) return null;

  const result = await publishProfile();
  // Stamped only on a clean run. A partial publish must be retried, or a
  // profile keeps half a shelf until the library happens to change again.
  if (!result.error) {
    try {
      setMeta(PUBLISH_FINGERPRINT_KEY, fingerprint);
    } catch {
      // An unwritable stamp costs one redundant publish, not correctness.
    }
  }
  return result;
}
