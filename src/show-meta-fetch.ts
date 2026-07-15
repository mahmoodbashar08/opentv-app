/**
 * Runtime TMDB metadata for shows outside the bundled set — anything added
 * from Explore/search or brought in by another user's import. Fetched once,
 * cached in the db (meta key `showMeta:{tvdbId}`), then indistinguishable
 * from bundled shows everywhere: episodes tab, continue tracking, stats.
 */
import { getMeta, setMeta } from '@/db';
import { registerShowMeta, showMeta, type EpisodeMeta, type SeasonMeta, type ShowMeta } from '@/metadata';
import { pool, tmdb } from '@/tmdb';

const img = (path: string | null | undefined, size: string) => (path ? `https://image.tmdb.org/t/p/${size}${path}` : null);

type TmdbSeason = { season_number: number; episode_count?: number; name?: string };
type TmdbShow = {
  name?: string;
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

export function fetchShowMeta(tvdbId: number, tmdbIdHint?: number | null): Promise<ShowMeta | null> {
  const existing = showMeta(tvdbId);
  if (existing) return Promise.resolve(existing);
  const running = inFlight.get(tvdbId);
  if (running) return running;
  const p = doFetch(tvdbId, tmdbIdHint).finally(() => inFlight.delete(tvdbId));
  inFlight.set(tvdbId, p);
  return p;
}

async function doFetch(tvdbId: number, tmdbIdHint?: number | null): Promise<ShowMeta | null> {
  try {
    // explicit hint (Fix match) → stored hint (survives restores) → TVDB lookup
    let tmdbId = tmdbIdHint ?? (Number(getMeta(`showTmdbHint:${tvdbId}`)) || null);
    if (tmdbId == null) {
      const found = await tmdb<{ tv_results: { id: number }[] }>(`/find/${tvdbId}?external_source=tvdb_id`);
      tmdbId = found.tv_results?.[0]?.id ?? null;
    }
    if (tmdbId == null) return null;

    const d = await tmdb<TmdbShow>(`/tv/${tmdbId}?append_to_response=credits,similar,watch/providers`);

    // every season's episode list, a few in parallel
    const seasonNums = (d.seasons ?? []).map((s) => s.season_number).filter((n) => n >= 0);
    const episodes: Record<string, EpisodeMeta> = {};
    await pool(
      seasonNums,
      async (n) => {
        try {
          const s = await tmdb<{ episodes?: { episode_number: number; name?: string; air_date?: string; still_path?: string | null; vote_average?: number; overview?: string }[] }>(
            `/tv/${tmdbId}/season/${n}`,
          );
          for (const ep of s.episodes ?? []) {
            episodes[`${n}-${ep.episode_number}`] = {
              title: ep.name ?? null,
              air: ep.air_date ?? null,
              still: img(ep.still_path, 'w300'),
              rating: ep.vote_average ? Math.round(ep.vote_average * 10) / 10 : undefined,
              overview: ep.overview || null,
            };
          }
        } catch {
          // a missing season shouldn't sink the whole show
        }
        return null;
      },
      5,
    );

    const seasons: Record<string, SeasonMeta> = {};
    for (const s of d.seasons ?? []) seasons[String(s.season_number)] = { count: s.episode_count ?? 0, name: s.name ?? null };

    const ended = d.status === 'Ended' || d.status === 'Canceled';
    const m: ShowMeta = {
      tmdbId,
      name: d.name ?? null,
      poster: img(d.poster_path, 'w342'),
      backdrop: img(d.backdrop_path, 'w780'),
      year: (d.first_air_date || '').slice(0, 4) || null,
      endYear: ended ? (d.last_air_date || '').slice(0, 4) || null : null,
      status: d.status ?? null,
      inProduction: !!d.in_production,
      totalEpisodes: d.number_of_episodes ?? Object.keys(episodes).length,
      totalSeasons: d.number_of_seasons ?? seasonNums.length,
      genres: (d.genres ?? []).map((g) => g.name),
      network: d.networks?.[0]?.name ?? null,
      runtime: d.episode_run_time?.[0] ?? null,
      overview: d.overview ?? null,
      rating: d.vote_average ?? 0,
      votes: d.vote_count,
      lastAir: d.last_air_date ?? null,
      cast: (d.credits?.cast ?? []).slice(0, 12).map((c) => ({
        name: c.name ?? null,
        character: c.character ?? null,
        photo: img(c.profile_path, 'w185'),
      })),
      similar: (d.similar?.results ?? []).slice(0, 10).map((s) => ({
        tmdbId: s.id,
        name: s.name ?? null,
        poster: img(s.poster_path, 'w342'),
      })),
      providers: (d['watch/providers']?.results?.US?.flatrate ?? []).map((p) => ({
        name: p.provider_name ?? null,
        logo: img(p.logo_path, 'w92'),
      })),
      seasons,
      episodes,
    };

    setMeta(`showMeta:${tvdbId}`, JSON.stringify(m));
    // remember the link itself too — exported in backups so restores keep it
    setMeta(`showTmdbHint:${tvdbId}`, String(tmdbId));
    registerShowMeta(tvdbId, m);
    return m;
  } catch {
    return null;
  }
}
