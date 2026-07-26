/**
 * Runtime TMDB metadata for shows outside the bundled set — anything added
 * from Explore/search or brought in by another user's import. Fetched once,
 * cached in the db (meta key `showMeta:{tvdbId}`), then indistinguishable
 * from bundled shows everywhere: episodes tab, continue tracking, stats.
 */
import db, { getAllShowIds, getMeta, getMoviesMissingPoster, getShowsMissingPoster, setMeta, setMoviePoster, setShowBackdrop, setShowPoster } from '@/db';
import { registerShowMeta, showMeta, type CharacterMeta, type EpisodeMeta, type SeasonMeta, type ShowMeta } from '@/metadata';
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

/** fetch with a hard timeout — the keyless character APIs have no SLA, and a
 * stalled request here used to hang the whole metadata fetch (and any Fix match
 * awaiting it) forever, since only tmdb() was abort-guarded. */
async function fetchT(url: string, init?: RequestInit, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Real character art (not actor headshots) from TVmaze — keyless, looks up
 * by the same TVDB id our shows are keyed by. Best-effort: a miss just means
 * the cast fallback renders, exactly like bundled shows without art. */
async function tvmazeCharacters(tvdbId: number): Promise<CharacterMeta[]> {
  const get = async (url: string) => {
    const res = await fetchT(url);
    if (!res.ok) throw new Error(`tvmaze ${res.status}`);
    return res.json();
  };
  const found = (await get(`https://api.tvmaze.com/lookup/shows?thetvdb=${tvdbId}`)) as { id?: number };
  if (!found?.id) return [];
  const cast = (await get(`https://api.tvmaze.com/shows/${found.id}/cast`)) as {
    character?: { name?: string; image?: { medium?: string } };
  }[];
  const picked: CharacterMeta[] = [];
  const seen = new Set<string>();
  for (const c of cast) {
    const name = c.character?.name;
    const image = c.character?.image?.medium;
    if (!name || !image || seen.has(name)) continue;
    seen.add(name);
    picked.push({ name, image });
    if (picked.length === 20) break;
  }
  return picked;
}

/** Real character art for anime — TMDB only lists voice actors there, and
 * TVmaze rarely covers anime. AniList is a free, keyless, community anime DB
 * (fits the no-TVDB rule). Best-effort: a miss falls back to TVmaze/cast. */
async function anilistCharacters(name: string): Promise<CharacterMeta[]> {
  const q = `query($s:String){Media(search:$s,type:ANIME){characters(sort:[ROLE,RELEVANCE],perPage:20){nodes{name{full}image{large}}}}}`;
  const res = await fetchT('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: q, variables: { s: name } }),
  });
  if (!res.ok) throw new Error(`anilist ${res.status}`);
  const data = (await res.json()) as {
    data?: { Media?: { characters?: { nodes?: { name?: { full?: string }; image?: { large?: string } }[] } } };
  };
  const nodes = data?.data?.Media?.characters?.nodes ?? [];
  const picked: CharacterMeta[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    const nm = n?.name?.full;
    const image = n?.image?.large;
    if (!nm || !image || seen.has(nm)) continue;
    seen.add(nm);
    picked.push({ name: nm, image });
    if (picked.length === 20) break;
  }
  return picked;
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
 * Episode/season structure from TheTVDB — the primary path for every show.
 *
 * TV Time was built on TheTVDB and its export numbers every episode the
 * TheTVDB way, so this is the numbering the user's watch rows already use.
 * Verified against the reference export: 388 of 389 rows match exactly, and
 * the databases genuinely disagree (TMDB files Detective Conan as one
 * 1208-episode season where TheTVDB — and the export — has 34).
 *
 * Returns null on ANY failure, including a partial paginated fetch: a gutted
 * episode list must never be cached as a show's true shape.
 *
 * tmdbId is left 0 here; the enrichment pass fills it when TMDB matches.
 */
async function fetchTvdbStructure(tvdbId: number): Promise<ShowMeta | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { tvdbSeries, tvdbEpisodes, tvdbSeriesBackground } = require('@/tvdb') as typeof import('@/tvdb');
    const s = await tvdbSeries(tvdbId);
    if (!s) return null;
    const eps = await tvdbEpisodes(tvdbId);
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
    let backdrop: string | null = null;
    try {
      backdrop = await tvdbSeriesBackground(tvdbId);
    } catch {
      // artwork is optional — never sink the structure fetch over it
    }

    const ended = (s.status?.name ?? '').toLowerCase() === 'ended';
    return {
      tmdbId: 0,
      fetchedAt: Date.now(),
      structureSource: 'tvdb',
      name: s.name ?? null,
      poster: s.image ?? null,
      backdrop,
      year: s.year ?? null,
      endYear: null,
      status: s.status?.name ?? null,
      inProduction: !ended,
      totalEpisodes: eps.length,
      totalSeasons: [...seasonCounts.keys()].filter((n) => n > 0).length,
      genres: [],
      network: s.originalNetwork?.name ?? null,
      runtime: s.averageRuntime ?? null,
      overview: s.overview ?? null,
      rating: 0,
      seasons,
      episodes,
    };
  } catch {
    return null;
  }
}

/**
 * TMDB enrichment: everything EXCEPT structure. Returns null when TMDB has no
 * match for this tvdbId, which is a normal permanent state, not an error —
 * the show simply renders from TheTVDB alone.
 *
 * Deliberately does not fetch per-season episode lists any more. Structure
 * comes from TheTVDB, so those requests (one per season — 34 of them on
 * Detective Conan) bought nothing but a numbering conflict.
 */
async function fetchTmdbEnrichment(tvdbId: number, tmdbIdHint?: number | null): Promise<Partial<ShowMeta> | null> {
  try {
    // explicit hint (Fix match) → stored hint (survives restores) → TVDB lookup
    let tmdbId = tmdbIdHint ?? (Number(getMeta(`showTmdbHint:${tvdbId}`)) || null);
    if (tmdbId == null) {
      const found = await tmdb<{ tv_results: { id: number }[] }>(`/find/${tvdbId}?external_source=tvdb_id`);
      tmdbId = found.tv_results?.[0]?.id ?? null;
    }
    if (tmdbId == null) return null;

    const d = await tmdb<TmdbShow>(`/tv/${tmdbId}?append_to_response=credits,similar,watch/providers`);

    // character art rides along when TVmaze has it; never blocks the fetch
    let characters: CharacterMeta[] = [];
    try {
      characters = await tvmazeCharacters(tvdbId);
    } catch {}
    // anime: TMDB shows voice actors, not characters, and TVmaze rarely covers
    // it — pull real character art from AniList (free, keyless). Only for
    // Japanese animation, and only when TVmaze came up short.
    const isAnime =
      (d.genres ?? []).some((g) => g.name === 'Animation') &&
      (d.original_language === 'ja' || (d.origin_country ?? []).includes('JP'));
    if (isAnime && characters.length < 5) {
      try {
        const al = await anilistCharacters(d.name ?? '');
        if (al.length > characters.length) characters = al;
      } catch {}
    }

    const ended = d.status === 'Ended' || d.status === 'Canceled';
    return {
      tmdbId,
      name: d.name ?? null,
      poster: img(d.poster_path, 'w500'),
      backdrop: img(d.backdrop_path, 'w1280'),
      year: (d.first_air_date || '').slice(0, 4) || null,
      endYear: ended ? (d.last_air_date || '').slice(0, 4) || null : null,
      status: d.status ?? null,
      genres: (d.genres ?? []).map((g) => g.name),
      network: d.networks?.[0]?.name ?? null,
      runtime: d.episode_run_time?.[0] ?? null,
      overview: d.overview ?? null,
      rating: d.vote_average ?? 0,
      votes: d.vote_count,
      lastAir: d.last_air_date ?? null,
      cast: (d.credits?.cast ?? []).slice(0, 20).map((c) => ({
        name: c.name ?? null,
        character: c.character ?? null,
        photo: img(c.profile_path, 'w185'),
      })),
      // key only present when TVmaze delivered — an absent key lets bundled
      // character art survive the cache-over-bundle merge
      ...(characters.length > 0 ? { characters } : {}),
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

/** Fields TMDB owns when it has a value, TheTVDB fills otherwise. Structure
 *  keys are deliberately absent — those are never merged. */
const ENRICH_KEYS: (keyof ShowMeta)[] = [
  'name',
  'poster',
  'backdrop',
  'year',
  'endYear',
  'status',
  'genres',
  'network',
  'runtime',
  'overview',
  'rating',
  'votes',
  'lastAir',
  'cast',
  'characters',
  'similar',
  'providers',
];

/**
 * Structure from TheTVDB, enrichment from TMDB, merged per field.
 *
 * The order matters: TheTVDB first, and if it fails we do NOT write TMDB
 * structure over a good cached copy — that would put watch rows back on the
 * wrong episodes. See fetchTmdbFallbackStructure for the degraded path.
 */
async function doFetch(tvdbId: number, tmdbIdHint?: number | null): Promise<ShowMeta | null> {
  try {
    const structure = await fetchTvdbStructure(tvdbId);

    // TheTVDB unreachable (revoked key, offline, unknown id) — degrade to a
    // read-only TMDB render rather than corrupting stored numbering
    if (!structure) return fetchTmdbFallbackStructure(tvdbId, tmdbIdHint);

    const enrichment = await fetchTmdbEnrichment(tvdbId, tmdbIdHint);
    const m: ShowMeta = enrichment
      ? {
          ...structure,
          ...mergeEnrichment<ShowMeta>(enrichment, structure, ENRICH_KEYS),
          // structure always wins, whatever the merge produced above
          tmdbId: enrichment.tmdbId ?? 0,
          structureSource: 'tvdb',
          totalEpisodes: structure.totalEpisodes,
          totalSeasons: structure.totalSeasons,
          seasons: structure.seasons,
          episodes: structure.episodes,
        }
      : structure;

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

/** Task 6 replaces this with the real read-only TMDB fallback. Until then a
 *  TheTVDB failure keeps whatever is already cached. */
async function fetchTmdbFallbackStructure(tvdbId: number, _tmdbIdHint?: number | null): Promise<ShowMeta | null> {
  return showMeta(tvdbId) ?? null;
}
