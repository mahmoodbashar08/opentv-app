/**
 * Runtime TMDB metadata for shows outside the bundled set — anything added
 * from Explore/search or brought in by another user's import. Fetched once,
 * cached in the db (meta key `showMeta:{tvdbId}`), then indistinguishable
 * from bundled shows everywhere: episodes tab, continue tracking, stats.
 */
import db, { getAllShowIds, getMeta, getMoviesMissingPoster, getShowsMissingPoster, setMeta, setMoviePoster, setShowBackdrop, setShowPoster } from '@/db';
import { registerShowMeta, showMeta, type CastMeta, type CharacterMeta, type EpisodeMeta, type SeasonMeta, type ShowMeta } from '@/metadata';
import { mergeEnrichment } from '@/pure';
import { pool, tmdb } from '@/tmdb';

/**
 * Background pass: fill posters for movies TMDB couldn't match, from TheTVDB (v4
 * covers movies too). Runs on launch so grids/lists fill without opening each
 * movie. Skips TheTVDB's "missing" placeholder art. Cheap — most libraries have
 * only a handful of unmatched movies, and it's a no-op once they're filled.
 */
export async function fillMissingMoviePosters(): Promise<void> {
  const missing = getMoviesMissingPoster();
  if (!missing.length) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { tvdbFindMovie } = require('@/tvdb') as typeof import('@/tvdb');
    for (const m of missing) {
      // already searched and found nothing — don't re-query every launch (a
      // manual Fix-match clears this marker so it can be retried)
      if (getMeta(`tvdbMovieMiss:${m.name}`)) continue;
      const hit = await tvdbFindMovie(m.name, m.year);
      const img = hit?.image;
      if (!img || img.includes('/images/missing/')) {
        setMeta(`tvdbMovieMiss:${m.name}`, '1');
        continue; // no unambiguous match
      }
      setMoviePoster(m.name, img, hit.runtime != null ? hit.runtime * 60 : null);
    }
  } catch {
    // offline or TheTVDB unreachable — retry next launch
  }
}

/**
 * Offline pre-cache: fetch + save full metadata (episode names, air dates,
 * seasons) for every tracked show that isn't already local, so the whole
 * library is browsable without a connection. Bundled/already-cached shows are
 * skipped, so it's a no-op once everything is stored. Throttled and meant to run
 * deferred after launch. (You still need internet to search/add NEW titles.)
 */
const META_CACHE_BATCH = 25;

export async function cacheAllShowMetadata(onProgress?: (done: number, total: number) => void): Promise<void> {
  // fully cached last time — skip even the scan (reading every show's meta is
  // JS-thread work). Cleared when a show is added or an import runs.
  if (getMeta('metaCacheComplete') === '1') return;
  const need = getAllShowIds().filter((id) => {
    const m = showMeta(id);
    // missing entirely, or a shell with no episodes → not yet fully local
    return !m || Object.keys(m.episodes ?? {}).length === 0;
  });
  if (!need.length) {
    setMeta('metaCacheComplete', '1');
    return;
  }
  // cap per launch so a big fresh library (hundreds of shows) fills over a few
  // launches instead of firing every request at once on whatever connection
  const batch = need.slice(0, META_CACHE_BATCH);
  await pool(batch, (id) => fetchShowMeta(id).catch(() => null), 3, onProgress);
  if (need.length <= batch.length) setMeta('metaCacheComplete', '1'); // that was the last batch
}

/**
 * Background pass: fill posters for shows with no artwork — TMDB matched them
 * but had no poster (obscure/regional titles like "Al Rowwad"), or they were
 * never matched. Direct TheTVDB lookup by tvdbId. Poster only — never touches
 * episode structure, so it's safe.
 */
export async function fillMissingShowPosters(): Promise<void> {
  const missing = getShowsMissingPoster();
  if (!missing.length) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { tvdbSeries, tvdbSeriesBackground } = require('@/tvdb') as typeof import('@/tvdb');
    for (const s of missing) {
      const hit = await tvdbSeries(s.tvdbId);
      const img = hit?.image;
      if (img && !img.includes('/images/missing/')) setShowPoster(s.tvdbId, img);
      // a landscape background for the detail banner, if TheTVDB has one (many
      // obscure titles only have a poster — the banner falls back to that)
      if (!getMeta(`backdropOverride:${s.tvdbId}`)) {
        const bg = await tvdbSeriesBackground(s.tvdbId);
        if (bg) setShowBackdrop(s.tvdbId, bg);
      }
    }
  } catch {
    // offline or TheTVDB unreachable — retry next launch
  }
}

const img = (path: string | null | undefined, size: string) => (path ? `https://image.tmdb.org/t/p/${size}${path}` : null);

type TmdbSeason = { season_number: number; episode_count?: number; name?: string };
type TmdbShow = {
  name?: string;
  original_language?: string;
  origin_country?: string[];
  poster_path?: string | null;
  backdrop_path?: string | null;
  first_air_date?: string;
  last_air_date?: string;
  status?: string;
  in_production?: boolean;
  number_of_episodes?: number;
  number_of_seasons?: number;
  genres?: { name: string }[];
  networks?: { name?: string }[];
  episode_run_time?: number[];
  overview?: string;
  vote_average?: number;
  vote_count?: number;
  seasons?: TmdbSeason[];
  credits?: { cast?: { name?: string; character?: string; profile_path?: string | null }[] };
  similar?: { results?: { id: number; name?: string; poster_path?: string | null }[] };
  'watch/providers'?: { results?: Record<string, { flatrate?: { provider_name?: string; logo_path?: string | null }[] }> };
};

const inFlight = new Map<number, Promise<ShowMeta | null>>();

// running shows grow new episodes and seasons; ended shows barely change.
// bundled entries carry no fetchedAt, so they refresh once and then live in
// the cache (which outranks the bundle) on the normal cycle
const STALE_RUNNING_MS = 7 * 24 * 3600 * 1000;
const STALE_ENDED_MS = 30 * 24 * 3600 * 1000;

export function showMetaIsStale(m: ShowMeta): boolean {
  // structure from TMDB (or from before 1.2.0) is a degraded state, not a
  // cached result — always try TheTVDB again, so a transient key failure can
  // never leave a show permanently on TMDB's numbering
  if (m.structureSource !== 'tvdb') return true;
  const ended = m.status === 'Ended' || m.status === 'Canceled';
  return Date.now() - (m.fetchedAt ?? 0) > (ended ? STALE_ENDED_MS : STALE_RUNNING_MS);
}

export function fetchShowMeta(tvdbId: number, tmdbIdHint?: number | null, force = false): Promise<ShowMeta | null> {
  const existing = showMeta(tvdbId);
  // force = the user tapped Refresh — always re-pull (new episodes, sharper art)
  if (!force && existing && !showMetaIsStale(existing)) return Promise.resolve(existing);
  const running = inFlight.get(tvdbId);
  if (running) return running;
  // entries the user matched to a MOVIE carry a movie id, not a series id —
  // refetching those through /tv would return a different show entirely, so
  // they always refresh back through the movie path
  const linkedMovie = Number(getMeta(`showMovieLink:${tvdbId}`)) || null;
  // a failed refresh keeps serving the stale copy — never trade data for null
  const p = (linkedMovie ? linkShowToMovie(tvdbId, linkedMovie) : doFetch(tvdbId, tmdbIdHint ?? existing?.tmdbId))
    .then((m) => m ?? existing ?? null)
    .finally(() => inFlight.delete(tvdbId));
  inFlight.set(tvdbId, p);
  return p;
}

/**
 * Point a show entry at a TMDB *series* the user picked by hand.
 *
 * Not plain fetchShowMeta: that returns the cached copy untouched whenever it
 * is still fresh, so a hand-picked id was silently discarded and Fix Match
 * appeared to do nothing on any show that already had metadata — which is most
 * of them. An explicit choice always overrides, so it forces the re-fetch.
 *
 * Also clears any previous movie link, which would otherwise keep winning on
 * every later refresh and quietly undo the correction.
 */
export async function linkShowToSeries(tvdbId: number, tmdbId: number): Promise<ShowMeta | null> {
  setMeta(`showMovieLink:${tvdbId}`, '');
  const m = await fetchShowMeta(tvdbId, tmdbId, true);
  if (m) {
    // Persist explicitly. doFetch only writes metadata to the database on a
    // fully clean pass — if a single season request failed it keeps the result
    // in memory alone, so a hand-picked match would vanish on the next launch
    // and never register as fixed. A deliberate choice must outlive the session.
    setMeta(`showMeta:${tvdbId}`, JSON.stringify(m));
    setMeta(`showTmdbHint:${tvdbId}`, String(tmdbId));
  }
  return m;
}

type TmdbMovie = {
  title?: string;
  original_title?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  runtime?: number | null;
  genres?: { name: string }[];
  overview?: string;
  vote_average?: number;
  vote_count?: number;
  credits?: { cast?: { name?: string; character?: string; profile_path?: string | null }[] };
  'watch/providers'?: { results?: Record<string, { flatrate?: { provider_name?: string; logo_path?: string | null }[] }> };
};

/**
 * Attach a TMDB *movie* to a show entry. TV Time tracked TV movies as shows
 * back when it was TV-only, so those rows can only ever match a movie — and
 * searching series alone left them permanently unmatchable.
 *
 * A TV movie is structurally a one-episode season, so that's exactly what we
 * synthesise: the entry then behaves like any other show everywhere (progress,
 * artwork, the watch list) without a special case per screen.
 */
export async function linkShowToMovie(tvdbId: number, tmdbMovieId: number): Promise<ShowMeta | null> {
  try {
    const d = await tmdb<TmdbMovie>(`/movie/${tmdbMovieId}?append_to_response=credits,watch/providers`);
    const title = d.title ?? d.original_title ?? null;
    const year = (d.release_date || '').slice(0, 4) || null;
    const m: ShowMeta = {
      tmdbId: tmdbMovieId,
      fetchedAt: Date.now(),
      name: title,
      poster: img(d.poster_path, 'w500'),
      backdrop: img(d.backdrop_path, 'w1280'),
      year,
      endYear: year, // a one-off finished the day it aired
      status: 'Ended',
      inProduction: false,
      totalEpisodes: 1,
      totalSeasons: 1,
      genres: (d.genres ?? []).map((g) => g.name),
      network: null,
      runtime: d.runtime ?? null,
      overview: d.overview ?? null,
      rating: d.vote_average ?? 0,
      votes: d.vote_count,
      lastAir: d.release_date ?? null,
      cast: (d.credits?.cast ?? []).slice(0, 20).map((c) => ({
        name: c.name ?? null,
        character: c.character ?? null,
        photo: img(c.profile_path, 'w185'),
      })),
      similar: [],
      providers: (d['watch/providers']?.results?.US?.flatrate ?? []).map((p) => ({
        name: p.provider_name ?? null,
        logo: img(p.logo_path, 'w92'),
      })),
      seasons: { '1': { count: 1, name: 'Season 1' } },
      episodes: {
        '1-1': {
          title,
          air: d.release_date ?? null,
          still: img(d.backdrop_path, 'w300'),
          rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : undefined,
          overview: d.overview || null,
        },
      },
    };
    setMeta(`showMeta:${tvdbId}`, JSON.stringify(m));
    // deliberately NOT showTmdbHint: that key means "series id" and would send
    // the next refresh to /tv with a movie id
    setMeta(`showMovieLink:${tvdbId}`, String(tmdbMovieId));
    registerShowMeta(tvdbId, m);
    return m;
  } catch {
    return null;
  }
}

/**
 * The show, from TheTVDB — structure AND everything else it carries.
 *
 * TV Time was built on TheTVDB and its export numbers every episode the
 * TheTVDB way, so this is the numbering the user's watch rows already use.
 * Verified against the reference export: 388 of 389 rows match exactly, and
 * the databases genuinely disagree (TMDB files Detective Conan as one
 * 1208-episode season where TheTVDB — and the export — has 34).
 *
 * Three requests: the extended record (genres, characters, artwork), the
 * English translation (the base record is in the original language, i.e.
 * Japanese for anime), and the paginated episode list.
 *
 * Returns null on ANY failure, including a partial paginated fetch: a gutted
 * episode list must never be cached as a show's true shape.
 *
 * tmdbId is left 0 here; the TMDB pass fills it when there's a match.
 */
async function fetchTvdbStructure(tvdbId: number): Promise<ShowMeta | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const t = require('@/tvdb') as typeof import('@/tvdb');
    const [s, eng, eps] = await Promise.all([
      t.tvdbSeriesExtended(tvdbId),
      t.tvdbTranslation(tvdbId, 'eng'),
      t.tvdbEpisodes(tvdbId),
    ]);
    if (!s) return null;
    if (eps.length === 0) return null; // no structure is not a valid structure

    const episodes: Record<string, EpisodeMeta> = {};
    const seasonCounts = new Map<number, number>();
    for (const e of eps) {
      episodes[`${e.seasonNumber}-${e.number}`] = { title: e.name ?? null, air: e.aired ?? null, still: e.image ?? null };
      seasonCounts.set(e.seasonNumber, (seasonCounts.get(e.seasonNumber) ?? 0) + 1);
    }
    const seasons: Record<string, SeasonMeta> = {};
    for (const [num, count] of seasonCounts) {
      seasons[String(num)] = { count, name: num === 0 ? 'Specials' : `Season ${num}` };
    }

    // TheTVDB gives real characters — name, actor, and an image for each —
    // where TMDB returns voice actors for anime. Featured first, then its own
    // sort order, so the leads lead.
    const chars = (s.characters ?? [])
      .slice()
      .sort((a, b) => Number(b.isFeatured ?? false) - Number(a.isFeatured ?? false) || (a.sort ?? 0) - (b.sort ?? 0));
    const characters: CharacterMeta[] = chars
      .filter((c) => c.name && c.image)
      .slice(0, 30)
      .map((c) => ({ name: c.name as string, image: c.image as string }));
    const cast: CastMeta[] = chars.slice(0, 20).map((c) => ({
      name: c.personName ?? null,
      character: c.name ?? null,
      photo: c.personImgURL ?? null,
    }));

    const ended = (s.status?.name ?? '').toLowerCase() === 'ended';
    return {
      tmdbId: 0,
      fetchedAt: Date.now(),
      structureSource: 'tvdb',
      name: eng?.name ?? s.name ?? null,
      poster: t.bestArtwork(s.artworks, t.TVDB_ART_POSTER) ?? s.image ?? null,
      backdrop: t.bestArtwork(s.artworks, t.TVDB_ART_BACKGROUND),
      year: s.year ?? null,
      endYear: ended ? (s.lastAired || '').slice(0, 4) || null : null,
      status: s.status?.name ?? null,
      inProduction: !ended,
      totalEpisodes: eps.length,
      totalSeasons: [...seasonCounts.keys()].filter((n) => n > 0).length,
      genres: (s.genres ?? []).map((g) => g.name).filter((n): n is string => !!n),
      network: s.originalNetwork?.name ?? null,
      runtime: s.averageRuntime ?? null,
      overview: eng?.overview ?? s.overview ?? null,
      // TheTVDB's `score` is a popularity count, not a 0-10 rating — left to TMDB
      rating: 0,
      lastAir: s.lastAired ?? null,
      ...(characters.length > 0 ? { characters } : {}),
      ...(cast.length > 0 ? { cast } : {}),
      seasons,
      episodes,
    };
  } catch {
    return null;
  }
}

/**
 * TMDB, for the three things TheTVDB does not carry: streaming providers,
 * similar shows, and a 0-10 rating (TheTVDB's `score` is a popularity count,
 * not a rating). Everything else now comes from TheTVDB.
 *
 * Returns null when TMDB has no match for this tvdbId — a normal permanent
 * state, not an error. The show simply renders from TheTVDB alone, missing
 * only these three fields.
 *
 * Deliberately does not fetch per-season episode lists any more: structure
 * comes from TheTVDB, so those requests (one per season — 34 of them on
 * Detective Conan) bought nothing but a numbering conflict.
 */
async function fetchTmdbGapFields(tvdbId: number, tmdbIdHint?: number | null): Promise<Partial<ShowMeta> | null> {
  try {
    // explicit hint (Fix match) → stored hint (survives restores) → TVDB lookup
    let tmdbId = tmdbIdHint ?? (Number(getMeta(`showTmdbHint:${tvdbId}`)) || null);
    if (tmdbId == null) {
      const found = await tmdb<{ tv_results: { id: number }[] }>(`/find/${tvdbId}?external_source=tvdb_id`);
      tmdbId = found.tv_results?.[0]?.id ?? null;
    }
    if (tmdbId == null) return null;

    const d = await tmdb<TmdbShow>(`/tv/${tmdbId}?append_to_response=similar,watch/providers`);

    return {
      tmdbId,
      rating: d.vote_average ?? 0,
      votes: d.vote_count,
      similar: (d.similar?.results ?? []).slice(0, 10).map((s) => ({
        tmdbId: s.id,
        name: s.name ?? null,
        poster: img(s.poster_path, 'w500'),
      })),
      // JustWatch lists resold channels separately ("MGM+", "MGM Plus Amazon
      // Channel", "MGM+ Roku Premium Channel") — one brand, three rows. Keep
      // the first of each brand family: strip the channel suffixes, compare.
      providers: (d['watch/providers']?.results?.US?.flatrate ?? [])
        .filter((p, i, arr) => {
          const brand = (s: string) =>
            s.toLowerCase().replace(/\s*(amazon channel|apple tv channel|roku premium channel|plus|\+)\s*/g, ' ').trim();
          const name = p.provider_name ?? '';
          return arr.findIndex((q) => brand(q.provider_name ?? '') === brand(name)) === i;
        })
        .map((p) => ({
          name: p.provider_name ?? null,
          logo: img(p.logo_path, 'w92'),
        })),
    };
  } catch {
    return null;
  }
}

/** The only fields TheTVDB cannot supply. Everything else — including name,
 *  overview, artwork, genres, cast and characters — comes from TheTVDB, so a
 *  show TMDB never matched still renders a complete screen. */
const TMDB_GAP_KEYS: (keyof ShowMeta)[] = ['rating', 'votes', 'similar', 'providers'];

/**
 * The show from TheTVDB, with TMDB filling only what TheTVDB cannot carry.
 *
 * The order matters: TheTVDB first, and if it fails we do NOT write TMDB
 * structure over a good cached copy — that would put watch rows back on the
 * wrong episodes. See fetchTmdbFallbackStructure for the degraded path.
 */
async function doFetch(tvdbId: number, tmdbIdHint?: number | null): Promise<ShowMeta | null> {
  try {
    const tvdbRecord = await fetchTvdbStructure(tvdbId);

    // TheTVDB unreachable (revoked key, offline, unknown id) — degrade to a
    // read-only TMDB render rather than corrupting stored numbering
    if (!tvdbRecord) return fetchTmdbFallbackStructure(tvdbId, tmdbIdHint);

    // TMDB is optional now: only providers, similar shows and the rating come
    // from it, so a failure here costs three fields, not a usable screen
    const gaps = await fetchTmdbGapFields(tvdbId, tmdbIdHint);
    const m: ShowMeta = gaps
      ? {
          ...tvdbRecord,
          ...mergeEnrichment<ShowMeta>(gaps, tvdbRecord, TMDB_GAP_KEYS),
          tmdbId: gaps.tmdbId ?? 0,
          structureSource: 'tvdb',
        }
      : tvdbRecord;

    setMeta(`showMeta:${tvdbId}`, JSON.stringify(m));
    if (m.tmdbId) {
      // remember the link itself too — exported in backups so restores keep it
      setMeta(`showTmdbHint:${tvdbId}`, String(m.tmdbId));
      try {
        db.runSync('UPDATE shows SET tmdbId = ? WHERE tvdbId = ?', [m.tmdbId, tvdbId]);
      } catch {
        // column arrives with the 1.2.0 migration; a miss here is harmless
      }
    }
    registerShowMeta(tvdbId, m);
    return m;
  } catch {
    return null;
  }
}

/**
 * Degraded path: TheTVDB is unreachable — revoked key, quota, offline — and the
 * user has not supplied their own key. TMDB renders an episode list so the show
 * screen isn't empty.
 *
 * READ-ONLY BY CONTRACT. The record goes into the in-memory overlay but is
 * deliberately NOT written to `showMeta:` in SQLite, and nothing anywhere moves
 * a watch row to fit it. `structureSource: 'tmdb'` keeps it permanently stale,
 * so the moment a working key appears TheTVDB structure replaces it.
 *
 * A show where the databases disagree looks wrong here — Detective Conan
 * renders as TMDB's single 1208-episode season while the user's watches are
 * numbered S1–S34, so they read as unwatched. That is accepted: visible,
 * recoverable and self-healing, unlike rewriting their database.
 */
async function fetchTmdbFallbackStructure(tvdbId: number, tmdbIdHint?: number | null): Promise<ShowMeta | null> {
  const existing = showMeta(tvdbId);
  // a TheTVDB-sourced record already on the device always wins over this
  if (existing?.structureSource === 'tvdb') return existing;

  const gaps = await fetchTmdbGapFields(tvdbId, tmdbIdHint);
  if (!gaps?.tmdbId) return existing ?? null;

  const episodes: Record<string, EpisodeMeta> = {};
  const seasons: Record<string, SeasonMeta> = {};
  try {
    const d = await tmdb<TmdbShow>(`/tv/${gaps.tmdbId}`);
    const seasonNums = (d.seasons ?? []).map((s) => s.season_number).filter((n) => n >= 0);
    await pool(
      seasonNums,
      async (n) => {
        try {
          const s = await tmdb<{
            episodes?: { episode_number: number; name?: string; air_date?: string; still_path?: string | null; overview?: string }[];
          }>(`/tv/${gaps.tmdbId}/season/${n}`);
          for (const ep of s.episodes ?? []) {
            episodes[`${n}-${ep.episode_number}`] = {
              title: ep.name ?? null,
              air: ep.air_date ?? null,
              still: img(ep.still_path, 'w300'),
              overview: ep.overview || null,
            };
          }
        } catch {
          // a missing season just leaves a gap in a display-only render
        }
        return null;
      },
      5,
    );
    for (const s of d.seasons ?? []) seasons[String(s.season_number)] = { count: s.episode_count ?? 0, name: s.name ?? null };

    const ended = d.status === 'Ended' || d.status === 'Canceled';
    if (Object.keys(episodes).length === 0) return existing ?? null;

    const m: ShowMeta = {
      tmdbId: gaps.tmdbId,
      fetchedAt: Date.now(),
      structureSource: 'tmdb',
      name: d.name ?? null,
      poster: img(d.poster_path, 'w500'),
      backdrop: img(d.backdrop_path, 'w1280'),
      year: (d.first_air_date || '').slice(0, 4) || null,
      endYear: ended ? (d.last_air_date || '').slice(0, 4) || null : null,
      status: d.status ?? null,
      inProduction: !!d.in_production,
      totalEpisodes: d.number_of_episodes ?? Object.keys(episodes).length,
      totalSeasons: d.number_of_seasons ?? Object.keys(seasons).filter((n) => Number(n) > 0).length,
      genres: (d.genres ?? []).map((g) => g.name),
      network: d.networks?.[0]?.name ?? null,
      runtime: d.episode_run_time?.[0] ?? null,
      overview: d.overview ?? null,
      rating: gaps.rating ?? 0,
      votes: gaps.votes,
      lastAir: d.last_air_date ?? null,
      similar: gaps.similar,
      providers: gaps.providers,
      seasons,
      episodes,
    };
    // in-memory ONLY — deliberately no setMeta(`showMeta:`) here
    registerShowMeta(tvdbId, m);
    return m;
  } catch {
    return existing ?? null;
  }
}
