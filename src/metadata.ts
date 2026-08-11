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
/**
 * One credit. TWO pictures, deliberately: `photo` is the PERFORMER (TheTVDB's
 * `personImgURL`, TMDB's `profile_path`) and `charPhoto` is the CHARACTER as
 * they appear in the work (TheTVDB's `image`; TMDB has no equivalent, so it is
 * null there). The About tab's Cast row wants the performer, the favourite poll
 * wants the character — see `characterFace` in pure.ts, which picks between
 * them. Optional because entries cached before this field existed lack it.
 */
export type CastMeta = {
  name: string | null;
  character: string | null;
  photo: string | null;
  charPhoto?: string | null;
};
export type CharacterMeta = { name: string; image: string };
export type SimilarMeta = { tmdbId: number; name: string | null; poster: string | null };
export type ProviderMeta = { name: string | null; logo: string | null };
export type ShowMeta = {
  tmdbId: number;
  /** ms epoch of the fetch that produced this — drives staleness */
  fetchedAt?: number;
  /** Which database supplied `seasons`/`episodes`. Absent on the bundle and on
   *  records written before 1.2.0 — both are treated as 'tmdb', i.e. always
   *  refetchable, so a show can never stay stuck on TMDB's numbering. */
  structureSource?: 'tvdb' | 'tmdb';
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

// From 1.2.0 the bundle carries enrichment only — cast, characters, genres,
// artwork — because episode structure always comes from TheTVDB at runtime
// (shipping TMDB's numbering in the binary was the bug). Normalise the empty
// structure in once, at load, so no screen has to defend against a missing
// `seasons`/`episodes` and nothing allocates on the render path.
for (const m of Object.values(metadata)) {
  if (!m.seasons) m.seasons = {};
  if (!m.episodes) m.episodes = {};
}

// shows outside the bundle (added from Explore/search, or another user's
// import) get their metadata fetched from TMDB at runtime and cached in the
// db — this overlay makes them look identical to bundled shows everywhere
const runtime: Record<string, ShowMeta> = {};
const missing = new Set<string>();

/**
 * Repair a record on the way in.
 *
 * `totalEpisodes` has always meant "episodes in numbered seasons" — TMDB's
 * number_of_episodes never counted specials, and every consumer divides by it
 * on that assumption. A 1.2.0 build briefly stored TheTVDB's raw episode count
 * instead, which includes season 0, so a fully-watched show read 64/86 with a
 * yellow bar.
 *
 * Recomputed here rather than only at fetch time, so libraries already holding
 * the wrong number correct themselves on the next read instead of making the
 * user refresh their whole library.
 */
function normalise(m: ShowMeta): ShowMeta {
  /**
   * MISSING ENTIRELY — derive it from the seasons, whatever the source.
   *
   * A record can carry full season counts and no total: the bundled entries do,
   * and so does anything written before the field existed. Every consumer then
   * falls back to something invented — the show screen divides by a flat 200,
   * which drew Better Call Saul at 63/200 = 31% with all six seasons ticked
   * green above it, and Family Matter at 32/200 = 16%. The season counts are
   * the same numbers the rows already display as "10/10", so they are the
   * honest denominator.
   *
   * Numbered seasons only, matching what this field has always meant.
   */
  if (!m.totalEpisodes) {
    const fromSeasons = Object.entries(m.seasons ?? {})
      .filter(([n]) => Number(n) > 0)
      .reduce((sum, [, s]) => sum + (s?.count ?? 0), 0);
    if (fromSeasons > 0) return { ...m, totalEpisodes: fromSeasons };
  }

  // TheTVDB-sourced records ONLY. That is where the bad count came from, and
  // where the episode dict is known to be complete — fetchTvdbStructure
  // discards a partial paginated fetch rather than caching one.
  //
  // The TMDB fallback is the opposite: it tolerates a failed season ("a missing
  // season just leaves a gap in a display-only render") while still carrying
  // TMDB's authoritative number_of_episodes. Recomputing there would replace a
  // correct total with however many seasons happened to load, shrinking the
  // denominator and reading a part-watched show as complete.
  if (m.structureSource !== 'tvdb') return m;
  const keys = Object.keys(m.episodes ?? {});
  if (keys.length === 0) return m; // bundle entries carry no structure
  const numbered = keys.filter((k) => !k.startsWith('0-')).length;
  if (numbered === 0 || m.totalEpisodes === numbered) return m;
  return { ...m, totalEpisodes: numbered };
}

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
      runtime[key] = normalise(JSON.parse(raw) as ShowMeta);
      return runtime[key];
    }
  } catch {}
  missing.add(key);
  return undefined;
}

/** Called by the runtime fetcher once TMDB data lands. */
export function registerShowMeta(tvdbId: number, m: ShowMeta): void {
  runtime[String(tvdbId)] = normalise(m);
  missing.delete(String(tvdbId));
  merged.delete(String(tvdbId));
}

// a runtime refresh is always newer than the bundle, so it wins — but the
// bundle may carry fields the fetcher doesn't produce (characters), so the
// two merge once per show instead of shadowing
const merged = new Set<string>();

export function showMeta(tvdbId: number): ShowMeta | undefined {
  const key = String(tvdbId);
  const c = cachedMeta(tvdbId);
  const b = metadata[key];
  if (c && b && !merged.has(key)) {
    // freshness must come from the cached side only — inheriting the
    // bundle's stamp would make old cached data look fresh forever
    runtime[key] = { ...b, ...c, fetchedAt: c.fetchedAt };
    merged.add(key);
    return runtime[key];
  }
  return c ?? b;
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
  // the two databases word this differently — TMDB "Returning Series",
  // TheTVDB "Continuing" — and TV Time itself said "Returning"
  if (m.status === 'Returning Series' || m.status === 'Continuing') return 'Returning';
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
