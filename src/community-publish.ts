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
  getFavoriteMovies,
  getCustomLists,
  getFavoriteShows,
  getMeta,
  getMovieTotals,
  getMovies,
  getShowProgress,
  getTotals,
  libraryOwner,
  setMeta,
} from '@/db';
import { publishableStats, slug, titlesForPublish, type LocalTitle, type PublishedTitle } from '@/pure';

/**
 * THE SHELVES, BUILT FROM THE SAME READS THE PROFILE TAB RENDERS.
 *
 * They used to come from `getPublishableShows`/`getPublishableMovies`, which
 * sorted alphabetically and included every show whether or not it had ever
 * been watched. The tab shows something else entirely — most recently watched
 * first, and only titles with a date — so a public profile listed different
 * titles in a different order from the owner's own screen. Two queries for one
 * shelf is how that happens, and the fix is to have one.
 *
 * `rank` is the position on the main rail. `favRank` is the position among the
 * favourites, which is the owner's drag order and NOT the same sequence — so a
 * hearted show that has never been watched carries a favRank and no rank, and
 * appears on the favourites shelf only, exactly as it does on the tab.
 */
function shelfShows(): LocalTitle[] {
  // Byte for byte the tab's `recentShows` — see app/(tabs)/profile.tsx.
  const recent = getShowProgress()
    .filter((sp) => (sp.lastWatchedAt ?? sp.addedAt) != null)
    .sort(
      (a, b) =>
        (b.lastWatchedAt ?? '').localeCompare(a.lastWatchedAt ?? '') ||
        Math.max(b.watched, b.episodesSeen) - Math.max(a.watched, a.episodesSeen),
    );
  const favourites = getFavoriteShows();
  const favRank = new Map(favourites.map((f, i) => [f.tvdbId, i]));

  const out: LocalTitle[] = recent.map((sp, i) => ({
    name: sp.name,
    poster: sp.posterUrl,
    favourite: favRank.has(sp.tvdbId),
    rank: i,
    favRank: favRank.get(sp.tvdbId) ?? null,
    tvdbId: sp.tvdbId,
  }));

  // A favourite that is not on the main rail still belongs on the favourites
  // one. The tab's two rows are drawn from two reads and do not have to agree
  // about membership; neither do these.
  const onRail = new Set(recent.map((sp) => sp.tvdbId));
  for (const [i, f] of favourites.entries()) {
    if (onRail.has(f.tvdbId)) continue;
    out.push({ name: f.name, poster: f.posterUrl, favourite: true, rank: null, favRank: i, tvdbId: f.tvdbId });
  }
  return out;
}

function shelfMovies(): LocalTitle[] {
  // The tab's `recentMovies`: watched only, newest first — `getMovies()`
  // already orders by watchedAt DESC.
  const watched = getMovies().filter((m) => m.watchedAt != null);
  const favourites = getFavoriteMovies();
  const favRank = new Map(favourites.map((f, i) => [f.name, i]));

  const out: LocalTitle[] = watched.map((m, i) => ({
    name: m.name,
    poster: m.poster,
    favourite: favRank.has(m.name),
    rank: i,
    favRank: favRank.get(m.name) ?? null,
    year: m.year,
  }));

  const onRail = new Set(watched.map((m) => m.name));
  for (const [i, f] of favourites.entries()) {
    if (onRail.has(f.name)) continue;
    out.push({ name: f.name, poster: f.poster, favourite: true, rank: null, favRank: i });
  }
  return out;
}

/**
 * Trim to what one request carries, without ever dropping a favourite.
 *
 * The cap has to fall somewhere and it must not fall on a title the owner
 * explicitly hearted — that is the one part of a shelf they chose deliberately.
 * So favourites are kept whatever their rank, the rest fill the remaining room
 * in rank order, and the survivors are put back into rank order before they go:
 * sorting to truncate must not become the order the shelf is published in,
 * which is the bug the `favourite DESC` sort used to be.
 */
function capped(titles: readonly PublishedTitle[], limit: number): PublishedTitle[] {
  if (titles.length <= limit) return [...titles];
  const byRank = (a: PublishedTitle, b: PublishedTitle) =>
    (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
  const favourites = titles.filter((t) => t.favourite);
  const rest = titles.filter((t) => !t.favourite).sort(byRank);
  return [...favourites, ...rest.slice(0, Math.max(0, limit - favourites.length))].sort(byRank);
}

/** `PUBLISH_MAX_TITLES` on the server. More in one request is a 413. */
export const PUBLISH_CHUNK = 250;

export type PublishResult = { shows: number; movies: number; lists: number; error: ApiErrorCode | null };

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
  const out: PublishResult = { shows: 0, movies: 0, lists: 0, error: null };
  if (!isJoined()) return { ...out, error: 'unauthenticated' };
  // 'seed' is the bundled demo library: its shows and films belong to a
  // persona, and publishing them would put somebody else's taste on a real
  // person's profile. A 'fresh' library is the user's own from the first tap.
  if (libraryOwner() === 'seed') return out;

  /**
   * AN EMPTY LIBRARY NEVER REPLACES A FULL PROFILE.
   *
   * Publishing REPLACES: the shelves and lists sent become the whole truth. A
   * phone that has just been reinstalled and signed in — before its backup is
   * restored — holds nothing, and publishing that would delete a profile's
   * entire history. It happened tonight and was survived only by luck.
   *
   * "I have watched nothing" and "I have not restored yet" are indistinguishable
   * from here, and one of them is recoverable. So nothing is sent until there is
   * something to send; the first real watch publishes everything.
   */
  if (getTotals().episodes === 0 && getMovieTotals().watched === 0) return out;

  let token: string | null = null;
  try {
    token = await getToken();
  } catch {
    token = null;
  }
  if (!token) return { ...out, error: 'unauthenticated' };

  let stats: { episodes_watched: number; minutes_watched: number; movie_minutes: number };
  let shows: PublishedTitle[];
  let movies: PublishedTitle[];
  try {
    const t = getTotals();
    const m = getMovieTotals();
    stats = publishableStats({ episodes: t.episodes, showMinutes: t.minutes, movieMinutes: m.minutes });
    shows = capped(titlesForPublish(shelfShows(), 'show'), PUBLISH_CHUNK);
    movies = capped(titlesForPublish(shelfMovies(), 'movie'), PUBLISH_CHUNK);
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
  // LISTS LAST, and never fatal to the shelves. A profile without its lists is
  // a profile missing a band; a profile without its shelves is empty.
  try {
    const lists = publishableLists();
    await api('/v1/published/lists', { method: 'POST', token, body: { lists } });
    out.lists = lists.length;
  } catch (e) {
    out.error = out.error ?? (e instanceof ApiError ? e.code : 'unknown');
  }

  return out;
}

/**
 * The lists this phone is willing to make public.
 *
 * HIDDEN LISTS NEVER LEAVE. The "Hide from profile" switch is honoured here, at
 * the only point where a list could become visible to anybody — not on the
 * server, which would be trusting the wrong end of the connection with somebody
 * else's privacy.
 *
 * Posters ride along: the server has no catalogue and cannot resolve an id to
 * artwork, so a collage drawn without them is a row of name cards.
 */
function publishableLists(): {
  name: string;
  items: { target_source: string; target_key: string; title: string; poster: string | null }[];
}[] {
  return getCustomLists()
    .filter((l) => l.hidden !== true)
    .slice(0, PUBLISH_MAX_LISTS)
    .map((l) => ({
      name: l.name,
      items: (l.items ?? []).slice(0, PUBLISH_MAX_LIST_ITEMS).map((it) => ({
        target_source: it.kind === 'show' ? 'tvdb' : 'title',
        target_key: it.kind === 'show' && it.tvdbId != null ? String(it.tvdbId) : slug(it.name),
        title: it.name,
        poster: it.poster ?? null,
      })),
    }));
}

/** Mirrors the server's caps, so a request is never refused for size. */
const PUBLISH_MAX_LISTS = 50;
const PUBLISH_MAX_LIST_ITEMS = 200;

/** What the last successful publish covered. Cleared with the rest of the
 *  community's state on sign-out — see `COMMUNITY_SIGN_OUT_META_KEYS`. */
const PUBLISH_FINGERPRINT_KEY = 'communityPublishFingerprint';

/**
 * THE SHAPE OF WHAT IS PUBLISHED, bumped by hand when the numbers change
 * meaning — not when the library does.
 *
 * A fingerprint records WHAT the library holds and can never record HOW it was
 * turned into a figure. Revision 1 published minutes divided by sixty, treating
 * two already-converted totals as raw seconds, so a 3,385-episode profile read
 * "1 day". Fixing the arithmetic left every fingerprint identical, so not one
 * client would ever have re-sent: the wrong number was pinned in place by the
 * very mechanism meant to keep it fresh.
 *
 * Revision 3 splits show minutes from film minutes: `minutes_watched` stopped
 * meaning "everything" and started meaning "shows", because a profile draws a
 * card for each and a combined figure cannot be split back apart.
 *
 * Part of the fingerprint, so a bump re-publishes everybody exactly once — the
 * same trick `SEED_REVISION` plays for the archive, and needed here for the
 * same reason.
 */
const PUBLISH_REVISION = 5;

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
    const shows = shelfShows();
    const movies = shelfMovies();
    // Lists are part of what is published, so they must be part of what decides
    // a re-publish — names and sizes, which is what a reader sees change.
    const lists = getCustomLists().filter((l) => l.hidden !== true);
    fingerprint = [
      PUBLISH_REVISION,
      t.episodes,
      t.shows,
      m.watched,
      shows.filter((s) => s.favourite).length,
      movies.filter((s) => s.favourite).length,
      lists.length,
      lists.map((l) => `${l.name}:${l.items?.length ?? 0}`).join(','),
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


/**
 * A list changed — get it onto the profile without waiting for a relaunch.
 *
 * Publishing used to happen only inside `syncArchiveIfNeeded`, which runs at
 * app start. So creating a list, renaming it, or adding ten films to it reached
 * the server on the NEXT cold start and not before — and to the person who just
 * made it, their profile simply did not have it.
 *
 * Fire and forget: `publishIfChanged` compares a fingerprint first, so calling
 * it after every small edit costs one cheap read when nothing moved. Never
 * awaited, never surfaced — a list is saved on the phone the moment it is made,
 * and the server catching up is not something to make somebody watch.
 */
export function listsChanged(): void {
  void publishIfChanged();
}

