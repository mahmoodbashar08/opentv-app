/**
 * Bundled show metadata fetched from TMDB (scripts/fetch-metadata.py).
 * Canonical posters/backdrops, season totals, and episode titles for every
 * season present in your watch history. Phase 2 will refresh this on-device.
 */
export type EpisodeMeta = {
  title: string | null;
  air: string | null;
  still: string | null;
  rating?: number;
  overview?: string | null;
};
export type SeasonMeta = { count: number; name: string | null };
export type CastMeta = { name: string | null; character: string | null; photo: string | null };
export type CharacterMeta = { name: string; image: string };
export type SimilarMeta = { tmdbId: number; name: string | null; poster: string | null };
export type ProviderMeta = { name: string | null; logo: string | null };
export type ShowMeta = {
  tmdbId: number;
  name: string | null;
  poster: string | null;
  backdrop: string | null;
  year: string | null;
  endYear: string | null;
  status: string | null;
  inProduction: boolean;
  totalEpisodes: number;
  totalSeasons: number;
  genres: string[];
  network: string | null;
  runtime: number | null;
  overview: string | null;
  rating: number;
  votes?: number;
  lastAir?: string | null;
  cast?: CastMeta[];
  characters?: CharacterMeta[];
  similar?: SimilarMeta[];
  providers?: ProviderMeta[];
  seasons: Record<string, SeasonMeta>;
  episodes: Record<string, EpisodeMeta>;
};

// require + cast keeps tsc from inferring a giant literal type for the JSON
// eslint-disable-next-line @typescript-eslint/no-require-imports
const metadata = require('@/data/metadata.json') as Record<string, ShowMeta>;

// shows outside the bundle (added from Explore/search, or another user's
// import) get their metadata fetched from TMDB at runtime and cached in the
// db — this overlay makes them look identical to bundled shows everywhere
const runtime: Record<string, ShowMeta> = {};
const missing = new Set<string>();

function cachedMeta(tvdbId: number): ShowMeta | undefined {
  const key = String(tvdbId);
  if (runtime[key]) return runtime[key];
  if (missing.has(key)) return undefined;
  try {
    // lazy require — a top-level import would cycle with db.ts
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getMeta } = require('@/db') as typeof import('@/db');
    const raw = getMeta(`showMeta:${key}`);
    if (raw) {
      runtime[key] = JSON.parse(raw) as ShowMeta;
      return runtime[key];
    }
  } catch {}
  missing.add(key);
  return undefined;
}

/** Called by the runtime fetcher once TMDB data lands. */
export function registerShowMeta(tvdbId: number, m: ShowMeta): void {
  runtime[String(tvdbId)] = m;
  missing.delete(String(tvdbId));
}

export function showMeta(tvdbId: number): ShowMeta | undefined {
  return metadata[String(tvdbId)] ?? cachedMeta(tvdbId);
}

export function episodeMeta(tvdbId: number, season: number, episode: number): EpisodeMeta | undefined {
  return showMeta(tvdbId)?.episodes[`${season}-${episode}`];
}

export function seasonTotal(tvdbId: number, season: number): number | undefined {
  return showMeta(tvdbId)?.seasons[String(season)]?.count;
}

/** Absolute episode number across the show, specials excluded — S02E01 → 26.
 *  TV Time shows it as "S02 | E01 (E26)" on the episode page. */
export function absoluteEpisode(tvdbId: number, season: number, episode: number): number | undefined {
  const m = showMeta(tvdbId);
  if (!m || season < 1) return undefined;
  let before = 0;
  for (let s = 1; s < season; s++) {
    const count = m.seasons[String(s)]?.count;
    if (count == null) return undefined;
    before += count;
  }
  return before + episode;
}

/** "Ended" / "Returning" style label for the show header meta line. */
export function statusLabel(m: ShowMeta): string {
  if (m.status === 'Returning Series') return 'Returning';
  return m.status ?? '—';
}

// reverse index: TMDB id → our TVDB id, for linking "people also watched"
// posters back to shows you already track
const byTmdb = new Map<number, number>(
  Object.entries(metadata).map(([tvdb, m]) => [m.tmdbId, Number(tvdb)]),
);

export function tvdbIdForTmdb(tmdbId: number): number | undefined {
  return byTmdb.get(tmdbId);
}

export default metadata;
