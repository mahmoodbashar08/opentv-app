/**
 * Browsing and discovery, TheTVDB first.
 *
 * Everything the user browses rather than tracks — the Discover feed, search,
 * "more like this" — resolves here, so the screens don't each carry their own
 * provider logic. TheTVDB is asked first because that is the database the rest
 * of the app speaks: a show it returns already carries the `tvdbId` the library
 * is keyed by, so adding it needs no id translation at all. TMDB used to need
 * an `/external_ids` round trip per item just to find that out.
 *
 * TMDB stays as the fallback for the whole feed — if TheTVDB is unreachable or
 * its key has been revoked, Discover keeps working rather than going blank.
 */
import { runtimeLabel } from '@/duration';
import { tvdbIdForTmdb } from '@/metadata';
import { artworkUrl, mergeSearchFallback, splitYearQuery } from '@/pure';
import { pool, tmdb } from '@/tmdb';

const TMDB_IMG = 'https://image.tmdb.org/t/p';

export type CatalogItem = {
  key: string;
  kind: 'tv' | 'movie';
  /** TheTVDB id — present on everything TheTVDB returned, so a show can be
   *  tracked without another lookup. null only on TMDB-fallback rows. */
  tvdbId: number | null;
  /** TMDB id, when that is where the row came from. Movies are still keyed by
   *  name in the library, so this rides along for their detail route. */
  tmdbId: number | null;
  title: string;
  backdrop: string | null;
  poster: string | null;
  overview: string;
  /** the small grey line under the title — seasons/network, or runtime/genres */
  sub: string;
  /** popularity, shown as a rounded count. TheTVDB's `score` and TMDB's
   *  `vote_count` are different scales; both are only ever displayed. */
  votes: number;
};

// ---- TheTVDB ---------------------------------------------------------------

async function tvdbFeed(limit: number): Promise<CatalogItem[] | null> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const t = require('@/tvdb') as typeof import('@/tvdb');
  const trending = await t.tvdbTrending();
  if (!trending) return null;

  // interleave shows and films so the feed isn't all one kind up top
  const picks: { kind: 'tv' | 'movie'; raw: import('@/tvdb').TvdbTrendingItem }[] = [];
  const half = Math.ceil(limit / 2);
  for (let i = 0; i < half; i++) {
    if (trending.series[i]) picks.push({ kind: 'tv', raw: trending.series[i] });
    if (trending.movies[i]) picks.push({ kind: 'movie', raw: trending.movies[i] });
  }

  const items = await pool(
    picks.slice(0, limit),
    async ({ kind, raw }): Promise<CatalogItem | null> => {
      // the card wants landscape art, which the trending list doesn't carry
      const ext = kind === 'tv' ? await t.tvdbSeriesExtended(raw.id) : await t.tvdbMovieExtended(raw.id);
      const backdrop = t.bestArtwork(ext?.artworks, t.TVDB_ART_BACKGROUND);
      // no landscape art = no card worth showing, same rule as the TMDB feed
      if (!backdrop) return null;

      let sub: string;
      if (kind === 'tv') {
        const series = ext as import('@/tvdb').TvdbSeriesExtended | null;
        const network = series?.originalNetwork?.name ?? null;
        const genres = (series?.genres ?? []).map((g) => g.name).filter(Boolean).slice(0, 2).join(', ');
        sub = [genres || null, network].filter(Boolean).join(' • ');
      } else {
        const movie = ext as import('@/tvdb').TvdbMovieExtended | null;
        const genres = (movie?.genres ?? []).map((g) => g.name).filter(Boolean).slice(0, 2).join(', ');
        sub = [runtimeLabel(movie?.runtime ?? raw.runtime ?? null), genres || null].filter(Boolean).join(' • ');
      }

      return {
        key: `${kind}-tvdb-${raw.id}`,
        kind,
        tvdbId: raw.id,
        tmdbId: null,
        title: raw.name ?? '',
        backdrop,
        poster: artworkUrl(raw.image ?? ext?.image),
        overview: raw.overview ?? '',
        sub: sub || (raw.year ?? ''),
        votes: raw.score ?? 0,
      };
    },
    5,
  );
  const out = items.filter((x): x is CatalogItem => x != null);
  // an empty result is a failure, not an empty catalogue — let TMDB try
  return out.length > 0 ? out : null;
}

async function tvdbSearch(query: string): Promise<CatalogItem[] | null> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const t = require('@/tvdb') as typeof import('@/tvdb');
  type Hit = {
    tvdb_id?: string;
    type?: string;
    name?: string;
    year?: string;
    overview?: string;
    image_url?: string;
    genres?: string[];
  };
  let raw: Hit[];
  try {
    raw = await t.tvdbSearchRaw(query);
  } catch {
    return null;
  }
  const out = raw
    // /search also returns companies, people and lists — none are trackable
    .filter((h) => (h.type === 'series' || h.type === 'movie') && h.tvdb_id && h.name)
    .slice(0, 30)
    .map((h): CatalogItem => {
      const kind = h.type === 'movie' ? ('movie' as const) : ('tv' as const);
      return {
        key: `${kind}-tvdb-${h.tvdb_id}`,
        kind,
        tvdbId: Number(h.tvdb_id),
        tmdbId: null,
        title: h.name ?? '',
        backdrop: null,
        poster: artworkUrl(h.image_url),
        overview: h.overview ?? '',
        sub: [h.year, (h.genres ?? []).slice(0, 2).join(', ')].filter(Boolean).join(' • '),
        votes: 0,
      };
    });
  return out.length > 0 ? out : null;
}

// ---- TMDB fallback ---------------------------------------------------------

async function tmdbFeed(limit: number): Promise<CatalogItem[]> {
  const trending = await tmdb<{
    results: { id: number; media_type: string; title?: string; name?: string; backdrop_path?: string; poster_path?: string; overview?: string }[];
  }>('/trending/all/week');
  const picks = trending.results
    .filter((r) => (r.media_type === 'tv' || r.media_type === 'movie') && r.backdrop_path)
    .slice(0, limit);

  const items = await pool(
    picks,
    async (r): Promise<CatalogItem> => {
      if (r.media_type === 'tv') {
        const d = await tmdb<{ number_of_seasons?: number; networks?: { name: string }[]; vote_count?: number }>(`/tv/${r.id}`);
        const seasons = d.number_of_seasons ?? 1;
        return {
          key: `tv-tmdb-${r.id}`,
          kind: 'tv',
          tvdbId: null,
          tmdbId: r.id,
          title: r.name ?? '',
          backdrop: `${TMDB_IMG}/w780${r.backdrop_path}`,
          poster: r.poster_path ? `${TMDB_IMG}/w342${r.poster_path}` : null,
          overview: r.overview ?? '',
          sub: `${seasons} season${seasons === 1 ? '' : 's'}${d.networks?.[0]?.name ? ` • ${d.networks[0].name}` : ''}`,
          votes: d.vote_count ?? 0,
        };
      }
      const d = await tmdb<{ runtime?: number; genres?: { name: string }[]; vote_count?: number }>(`/movie/${r.id}`);
      return {
        key: `movie-tmdb-${r.id}`,
        kind: 'movie',
        tvdbId: null,
        tmdbId: r.id,
        title: r.title ?? '',
        backdrop: `${TMDB_IMG}/w780${r.backdrop_path}`,
        poster: r.poster_path ? `${TMDB_IMG}/w342${r.poster_path}` : null,
        overview: r.overview ?? '',
        sub: [runtimeLabel(d.runtime), d.genres?.slice(0, 2).map((g) => g.name).join(', ')].filter(Boolean).join(' • '),
        votes: d.vote_count ?? 0,
      };
    },
    5,
  );
  return items.filter((x): x is CatalogItem => x != null);
}

async function tmdbSearch(query: string): Promise<CatalogItem[]> {
  const d = await tmdb<{
    results: { id: number; media_type: string; name?: string; title?: string; poster_path?: string | null; overview?: string; first_air_date?: string; release_date?: string }[];
  }>(`/search/multi?query=${encodeURIComponent(query)}&include_adult=false`);
  return (d.results ?? [])
    .filter((r) => r.media_type === 'tv' || r.media_type === 'movie')
    .slice(0, 30)
    .map((r): CatalogItem => {
      const kind = r.media_type === 'movie' ? ('movie' as const) : ('tv' as const);
      return {
        key: `${kind}-tmdb-${r.id}`,
        kind,
        tvdbId: null,
        tmdbId: r.id,
        title: (kind === 'movie' ? r.title : r.name) ?? '',
        backdrop: null,
        poster: r.poster_path ? `${TMDB_IMG}/w342${r.poster_path}` : null,
        overview: r.overview ?? '',
        sub: ((kind === 'movie' ? r.release_date : r.first_air_date) ?? '').slice(0, 4),
        votes: 0,
      };
    });
}

// ---- public ----------------------------------------------------------------

/** This week's trending shows and films. TheTVDB, falling back to TMDB. */
export async function trendingFeed(limit = 12): Promise<CatalogItem[]> {
  try {
    const viaTvdb = await tvdbFeed(limit);
    if (viaTvdb) return viaTvdb;
  } catch {
    // fall through — a dead TheTVDB key must not blank the Discover tab
  }
  return tmdbFeed(limit);
}

/**
 * Trending, split by kind and WITHOUT per-item enrichment — for grid screens
 * showing dozens of cards, where one extra request per card to fetch landscape
 * art would cost 40 round trips for artwork the grid shows small anyway.
 * `backdrop` is therefore null here and callers fall back to the poster.
 */
export async function trendingByKind(): Promise<{ shows: CatalogItem[]; movies: CatalogItem[] }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const t = require('@/tvdb') as typeof import('@/tvdb');
    const trending = await t.tvdbTrending();
    if (trending && (trending.series.length || trending.movies.length)) {
      const map = (raw: import('@/tvdb').TvdbTrendingItem, kind: 'tv' | 'movie'): CatalogItem => ({
        key: `${kind}-tvdb-${raw.id}`,
        kind,
        tvdbId: raw.id,
        tmdbId: null,
        title: raw.name ?? '',
        backdrop: null,
        poster: artworkUrl(raw.image),
        overview: raw.overview ?? '',
        sub: raw.year ?? '',
        votes: raw.score ?? 0,
      });
      return {
        shows: trending.series.map((r) => map(r, 'tv')),
        movies: trending.movies.map((r) => map(r, 'movie')),
      };
    }
  } catch {
    // fall through
  }
  const [shows, movies] = await Promise.all([
    tmdbTrendingList('tv').catch(() => []),
    tmdbTrendingList('movie').catch(() => []),
  ]);
  return { shows, movies };
}

async function tmdbTrendingList(kind: 'tv' | 'movie'): Promise<CatalogItem[]> {
  const d = await tmdb<{
    results: { id: number; name?: string; title?: string; backdrop_path?: string | null; poster_path?: string | null; overview?: string; first_air_date?: string; release_date?: string; vote_average?: number }[];
  }>(`/trending/${kind}/week`);
  return (d.results ?? []).slice(0, 20).map((r) => ({
    key: `${kind}-tmdb-${r.id}`,
    kind,
    tvdbId: null,
    tmdbId: r.id,
    title: (kind === 'movie' ? r.title : r.name) ?? '',
    backdrop: r.backdrop_path ? `${TMDB_IMG}/w1280${r.backdrop_path}` : null,
    poster: r.poster_path ? `${TMDB_IMG}/w500${r.poster_path}` : null,
    overview: r.overview ?? '',
    sub: ((kind === 'movie' ? r.release_date : r.first_air_date) ?? '').slice(0, 4),
    votes: Math.round((r.vote_average ?? 0) * 10),
  }));
}

/**
 * Search both databases' worth of titles. TheTVDB is asked first and its rows
 * are trusted as-is; TMDB is only asked to fill in a kind (series or films)
 * that TheTVDB came back with nothing for — not asked again just because
 * TheTVDB answered at all. That per-kind fallback is what lets a query like
 * "Amadeo" (a TheTVDB film, no series) still surface TMDB's series of the
 * same name, without doubling the request cost for the common case where
 * TheTVDB already covers both kinds.
 *
 * A dead/revoked TheTVDB key is unaffected: that still falls through to a
 * full TMDB search, same as before.
 */
/**
 * The year the searcher typed, used to RANK and never to filter.
 *
 * Somebody who remembers 2007 for a 2006 film should still be shown it. A
 * stable sort keeps the API's own ordering intact inside each group, so this
 * only ever lifts the matches to the top rather than reshuffling the rest.
 */
function byYear(items: CatalogItem[], year: number | null): CatalogItem[] {
  if (year == null) return items;
  // A row has no year field; it carries one inside `sub` ("Movie · 2007"),
  // which is what both providers put there and what the list already shows.
  const yearOf = (it: CatalogItem): number | null => {
    const m = /\b((?:19|20)\d{2})\b/.exec(it.sub);
    return m ? Number(m[1]) : null;
  };
  return items
    .map((it, i) => ({ it, i, hit: yearOf(it) === year ? 0 : 1 }))
    .sort((a, b) => a.hit - b.hit || a.i - b.i)
    .map((x) => x.it);
}

export async function searchCatalog(query: string): Promise<CatalogItem[]> {
  // "Partner 2007" is a title and a hint, and only the title may go to an API
  // that matches on names — see `splitYearQuery`.
  const { title, year } = splitYearQuery(query);
  const q = title;
  if (!q) return [];
  /*
   * BOTH CATALOGUES, EVERY TIME.
   *
   * This used to ask TMDB only when TheTVDB returned NOTHING of a kind, on the
   * theory that a catalogue which answered at all had answered fully. It does
   * not. Searching "partner" gets 25 films from TheTVDB and the 2007 Indian
   * film is not among them — TMDB has it at position six. Because TheTVDB
   * returned *some* movies the fallback never ran, so the film was unfindable
   * and unaddable, and a user reported exactly that. Dropping the year from the
   * query changed nothing, which is what ruled out the year-parsing above and
   * pointed here.
   *
   * "Non-empty" was standing in for "complete" and the two are not the same:
   * a missing kind is the rare failure, a missing TITLE within a present kind
   * is the common one. Regional cinema is where the two catalogues diverge
   * most, and it is precisely where a user knows the film exists.
   *
   * TheTVDB stays FIRST because it is the primary source and its ids are what
   * the library keys on; TMDB rows are appended, deduped by kind+title+year.
   * The two requests go together, so the extra catalogue costs no extra wait.
   */
  const [viaTvdb, viaTmdb] = await Promise.all([
    tvdbSearch(q).catch(() => null), // dead/revoked key etc
    tmdbSearch(q).catch(() => [] as CatalogItem[]), // unreachable/rate-limited
  ]);
  if (!viaTvdb) return byYear(viaTmdb, year);
  return byYear(mergeSearchFallback(viaTvdb, viaTmdb), year);
}

/**
 * TheTVDB id for a TMDB show id, for the places that hold one and need the
 * other.
 *
 * THE LOCAL MAP IS NOT ENOUGH, and assuming it was is what broke "People also
 * watched". `tvdbIdForTmdb` reads a reverse index built from the shows in the
 * library — so it can only answer for a show you already track, in a section
 * whose whole purpose is showing shows you do not. It returned undefined for
 * almost every card, and the tap handler's `&& ` swallowed the press in
 * silence.
 *
 * So: the map first, because it costs nothing and is right when it answers,
 * then TMDB's `/external_ids`. Results are remembered for the session --
 * including the misses, which are permanent (a show TheTVDB does not carry
 * today will not start being carried between two taps) and are the answer most
 * worth not asking twice.
 */
const tvdbIdCache = new Map<number, number | null>();

export async function showTvdbIdForTmdb(tmdbId: number): Promise<number | null> {
  if (!(tmdbId > 0)) return null;
  const known = tvdbIdForTmdb(tmdbId);
  if (known) return known;
  const cached = tvdbIdCache.get(tmdbId);
  if (cached !== undefined) return cached;
  try {
    const ext = await tmdb<{ tvdb_id?: number }>(`/tv/${tmdbId}/external_ids`);
    const id = ext.tvdb_id && ext.tvdb_id > 0 ? ext.tvdb_id : null;
    tvdbIdCache.set(tmdbId, id);
    return id;
  } catch {
    // A NETWORK FAILURE IS NOT A MISS. Caching it would make one bad moment
    // permanent for the session, so this one is asked again next time.
    return null;
  }
}

/**
 * The TheTVDB id for a catalog row, which is what the library keys shows by.
 * Rows that came from TheTVDB already have it; TMDB-fallback rows need the
 * `/external_ids` round trip that used to happen for every single item.
 */
export async function tvdbIdFor(item: CatalogItem): Promise<number | null> {
  if (item.tvdbId) return item.tvdbId;
  if (!item.tmdbId || item.kind !== 'tv') return null;
  return showTvdbIdForTmdb(item.tmdbId);
}
