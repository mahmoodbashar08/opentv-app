/**
 * TheTVDB v4 client. TV Time was built on TheTVDB — the export's primary key is
 * `tvdbId` — so a lookup here is a *direct* hit (no fuzzy name-matching like
 * TMDB needs), with full TV coverage. Used to resolve shows TMDB can't match.
 *
 * Auth: exchange the API key for a bearer token (valid ~1 month); we cache it in
 * memory and re-login on a 401. Artwork stays on artworks.thetvdb.com — the same
 * CDN the 1.1.9 cover-rescue already relies on.
 *
 * Key lives in src/tvdb-key.ts (gitignored) — see tvdb-key.example.ts.
 */
import { getMeta, setMeta } from '@/db';
import { artworkUrl, pickMovieMatch } from '@/pure';
import { THETVDB_API_KEY } from '@/tvdb-key';

const BASE = 'https://api4.thetvdb.com/v4';

let token: string | null = null;
let loginInFlight: Promise<string> | null = null;
// once the active key is rejected this run, stop re-attempting login on every
// lookup (an import fires dozens) — retried next launch, or when the key changes
let authFailed = false;

/** The user's OWN TheTVDB key (Settings), if set, wins over the app's bundled
 *  one — a safety net for when the shared free-tier key expires, hits quota, or
 *  is revoked. Blank means "use the bundled key". */
export function userTvdbKey(): string {
  return (getMeta('userTvdbKey') || '').trim();
}
/** The key actually used for auth: the user's if they added one, else bundled. */
export function activeTvdbKey(): string {
  return userTvdbKey() || THETVDB_API_KEY;
}
/** True once the ACTIVE key failed AUTH (bad / expired / revoked / over quota) —
 *  a real key problem, not a transient network blip. The UI reads this to invite
 *  the user to add their own key; TheTVDB matching is simply skipped meanwhile
 *  and everything falls back to TMDB. */
export function tvdbKeyFailed(): boolean {
  return getMeta('tvdbKeyFailed') === '1';
}
/** Save (or clear, with '') the user's own key and give it a fresh chance. */
export function setUserTvdbKey(key: string): void {
  setMeta('userTvdbKey', key.trim());
  token = null; // force a re-login under the new key
  loginInFlight = null;
  authFailed = false; // give the new key a fresh attempt this session
  setMeta('tvdbKeyFailed', ''); // clear the failure flag so the new key is tried
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: activeTvdbKey() }),
  });
  if (!res.ok) {
    // 401/403 = the key itself is rejected (expired/revoked/invalid) → flag it so
    // the UI can offer the user their own key, and stop retrying this session.
    // Other codes (429 rate-limit, 5xx) are transient — never flag those.
    if (res.status === 401 || res.status === 403) {
      authFailed = true;
      setMeta('tvdbKeyFailed', '1');
    }
    throw new Error(`TheTVDB login ${res.status}`);
  }
  const json = (await res.json()) as { data?: { token?: string } };
  const t = json.data?.token;
  if (!t) throw new Error('TheTVDB login: no token');
  token = t;
  setMeta('tvdbKeyFailed', ''); // a good login clears any stale failure flag
  return t;
}

async function ensureToken(): Promise<string> {
  if (token) return token;
  if (authFailed) throw new Error('TheTVDB key rejected this session');
  // collapse concurrent first-time logins into one request
  loginInFlight ??= login().finally(() => {
    loginInFlight = null;
  });
  return loginInFlight;
}

/** GET a v4 path and return its `data`. Re-logs in once on a 401. */
async function get<T>(path: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    let t = await ensureToken();
    let res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${t}` }, signal: ctrl.signal });
    if (res.status === 401) {
      token = null;
      t = await ensureToken();
      res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${t}` }, signal: ctrl.signal });
    }
    if (!res.ok) throw new Error(`TheTVDB ${res.status} on ${path}`);
    return ((await res.json()) as { data: T }).data;
  } finally {
    clearTimeout(timer);
  }
}

// ---- typed shapes (only the fields we use) --------------------------------------
export type TvdbSeries = {
  id: number;
  name: string | null;
  year: string | null;
  image: string | null;
  status?: { name?: string | null };
  originalNetwork?: { name?: string | null };
  averageRuntime?: number | null;
  overview?: string | null;
};

export type TvdbEpisode = {
  id: number;
  seasonNumber: number;
  number: number;
  name: string | null;
  aired: string | null;
  image: string | null;
  runtime: number | null;
};

/**
 * Every artwork of one type for a series or movie, best first — the choices
 * the poster/cover pickers offer. Full URLs, unlike TMDB's relative paths.
 */
export async function tvdbArtworks(
  id: number,
  kind: 'series' | 'movies',
  type: number,
  limit = 30,
): Promise<string[]> {
  try {
    const d = await get<{ artworks?: { image?: string; type?: number; score?: number }[] }>(
      `/${kind}/${id}/extended?short=false`,
    );
    return (d.artworks ?? [])
      .filter((a) => a.type === type && a.image)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit)
      .map((a) => artworkUrl(a.image))
      .filter((u): u is string => u != null);
  } catch {
    return [];
  }
}

export type TvdbTrendingItem = {
  id: number;
  name?: string | null;
  image?: string | null;
  overview?: string | null;
  year?: string | null;
  averageRuntime?: number | null;
  runtime?: number | null;
  score?: number | null;
};

/**
 * This week's trending series and movies — the same lists the site's homepage
 * shows. Undocumented under the paths you'd guess (`/series/trending` and
 * `/movies/trending` both 400); `/trending` is the one that works.
 */
export async function tvdbTrending(): Promise<{ series: TvdbTrendingItem[]; movies: TvdbTrendingItem[] } | null> {
  try {
    const d = await get<{ series?: TvdbTrendingItem[]; movies?: TvdbTrendingItem[] }>('/trending');
    return { series: d.series ?? [], movies: d.movies ?? [] };
  } catch {
    return null;
  }
}

export type TvdbMovieExtended = {
  id: number;
  name?: string | null;
  image?: string | null;
  year?: string | null;
  runtime?: number | null;
  genres?: { name?: string | null }[];
  artworks?: { image?: string; type?: number; score?: number }[];
  first_release?: { date?: string | null } | null;
};

export async function tvdbMovieExtended(id: number): Promise<TvdbMovieExtended | null> {
  try {
    return await get<TvdbMovieExtended>(`/movies/${id}/extended`);
  } catch {
    return null;
  }
}

/** A movie's first release anywhere, plus its runtime — TheTVDB publishes
 *  per-country dates and picks a `first_release` for us. '' is returned as
 *  null; callers treat "looked, nothing published" separately. */
export async function tvdbMovieRelease(
  id: number,
): Promise<{ date: string | null; runtime: number | null; released: boolean } | null> {
  try {
    const d = await get<{
      first_release?: { date?: string | null } | null;
      runtime?: number | null;
      status?: { name?: string | null } | null;
    }>(`/movies/${id}/extended`);
    const date = (d.first_release?.date ?? '').trim() || null;
    return {
      date,
      runtime: d.runtime ?? null,
      released: (d.status?.name ?? '').toLowerCase() === 'released',
    };
  } catch {
    return null;
  }
}

export type TvdbSearchResult = {
  tvdbId: number;
  name: string;
  year: string | null;
  image: string | null;
  country: string | null;
};

/** Series metadata by TheTVDB id — the direct-lookup path. */
export async function tvdbSeries(id: number): Promise<TvdbSeries | null> {
  try {
    return await get<TvdbSeries>(`/series/${id}`);
  } catch {
    return null;
  }
}

/** Best landscape background (fanart) for a series, if TheTVDB has one — used as
 *  a show's banner backdrop. type 3 = background art. Returns null if none. */
export async function tvdbSeriesBackground(id: number): Promise<string | null> {
  try {
    const d = await get<{ artworks?: { image?: string; type?: number; score?: number }[] }>(
      `/series/${id}/extended?short=false`,
    );
    return bestArtwork(d.artworks, 3);
  } catch {
    return null;
  }
}

/** TheTVDB artwork type ids (from /artwork/types). */
export const TVDB_ART_POSTER = 2;
export const TVDB_ART_BACKGROUND = 3;

/** Highest-scoring artwork of one type. TheTVDB ranks community uploads by
 *  `score`, so the top entry is the one the site itself shows. */
export function bestArtwork(
  artworks: { image?: string; type?: number; score?: number }[] | undefined,
  type: number,
): string | null {
  const hit = (artworks ?? [])
    .filter((a) => a.type === type && a.image)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return artworkUrl(hit[0]?.image);
}

export type TvdbCharacter = {
  name?: string | null;
  personName?: string | null;
  image?: string | null;
  personImgURL?: string | null;
  sort?: number;
  isFeatured?: boolean;
};

export type TvdbSeriesExtended = TvdbSeries & {
  genres?: { name?: string | null }[];
  characters?: TvdbCharacter[];
  artworks?: { image?: string; type?: number; score?: number }[];
  firstAired?: string | null;
  lastAired?: string | null;
};

/**
 * Full series record — genres, characters, artwork. TheTVDB carries real
 * characters (name + actor + both images), unlike TMDB which returns voice
 * actors for anime, so this replaces the TVmaze/AniList workarounds.
 */
export async function tvdbSeriesExtended(id: number): Promise<TvdbSeriesExtended | null> {
  try {
    return await get<TvdbSeriesExtended>(`/series/${id}/extended?short=false`);
  } catch {
    return null;
  }
}

/** Translated name + overview. The base record carries the ORIGINAL language
 *  (Japanese for anime), so English text has to be asked for explicitly. */
export async function tvdbTranslation(
  id: number,
  lang = 'eng',
): Promise<{ name: string | null; overview: string | null } | null> {
  try {
    const d = await get<{ name?: string | null; overview?: string | null }>(`/series/${id}/translations/${lang}`);
    return { name: d.name ?? null, overview: d.overview ?? null };
  } catch {
    return null;
  }
}

/** All episodes for a series (default order), following pagination.
 *  Uses the English translation — the untranslated endpoint returns titles in
 *  the original language (Japanese for anime), which would regress every anime
 *  episode title now that this is the primary structure source. Numbering is
 *  identical on both endpoints; only the strings differ. Shows with no English
 *  translation fall back to the untranslated list. */
export async function tvdbEpisodes(id: number): Promise<TvdbEpisode[] | null> {
  /**
   * Three outcomes, not two — the distinction is what makes this safe:
   *  - `unavailable`: page 0 failed, so this endpoint has nothing for us (a
   *    show with no English translation 404s here). The caller may fall back.
   *  - `partial`: a LATER page failed, so we hold some of a list and cannot
   *    know what is missing. Never usable, and never a reason to fall back —
   *    the other endpoint would be just as likely to fail.
   *  - `ok`: every page came back.
   */
  type Fetched = { status: 'ok'; episodes: TvdbEpisode[] } | { status: 'unavailable' } | { status: 'partial' };
  const fetchAll = async (path: string): Promise<Fetched> => {
    const all: TvdbEpisode[] = [];
    for (let page = 0; page < 40; page++) {
      let batch: TvdbEpisode[];
      try {
        const data = await get<{ episodes?: TvdbEpisode[] }>(`${path}?page=${page}`);
        batch = data.episodes ?? [];
      } catch {
        return page === 0 ? { status: 'unavailable' } : { status: 'partial' };
      }
      all.push(...batch);
      if (batch.length < 500) return { status: 'ok', episodes: all }; // last page (TheTVDB pages at 500)
    }
    // ran out of pages without a short one — 20,000 episodes, so almost
    // certainly a paging bug rather than a real show. Don't pretend it's whole.
    return { status: 'partial' };
  };

  const eng = await fetchAll(`/series/${id}/episodes/default/eng`);
  // a half-fetched list is worse than none: it caches as the show's true shape,
  // renders as missing seasons, and reads fresh for the next 7-30 days because
  // it is genuinely TheTVDB-sourced. Discard and let a later pass retry.
  if (eng.status === 'partial') return null;
  let list: TvdbEpisode[];
  if (eng.status === 'ok' && eng.episodes.length > 0) {
    list = eng.episodes;
  } else {
    const raw = await fetchAll(`/series/${id}/episodes/default`);
    if (raw.status !== 'ok') return null;
    list = raw.episodes;
  }
  // the translated endpoint returns bare paths where the untranslated one
  // returns absolute URLs — normalise so callers never see the difference
  return list.map((e) => ({ ...e, image: artworkUrl(e.image) }));
}

export type TvdbMovieMeta = {
  tvdbId: number;
  name: string | null;
  year: string | null;
  image: string | null;
  runtime: number | null;
};

/**
 * Find a movie by name for the AUTOMATIC fill — deliberately strict: only an
 * *unambiguous* exact-name match counts, because TV Time's export has no movie
 * id (just a name), so a loose "first result" could silently attach the wrong
 * poster on a generic title. When a year is known it must match; with no year
 * (or no year-match) a single exact-name hit is accepted, multiple → skip.
 * The loose picker (`tvdbSearchMovies`) is for the manual Fix-match screen where
 * a human sees the candidates.
 */
export async function tvdbFindMovie(name: string, year?: string | null): Promise<TvdbMovieMeta | null> {
  return (await findMovieDetailed(name, year ? Number(year) : null))?.hit ?? null;
}

/**
 * Find a movie, saying whether the answer is certain.
 *
 * TV Time's export carries a movie name and nothing else, so generic titles
 * ("Superman", "Frozen", "Scream") return several exact matches and the old
 * rule refused all of them — about a quarter of a real library. The watch year
 * breaks the tie; see pickMovieMatch. `guessed` is true when the tie was broken
 * by inference rather than settled by the data.
 */
export async function findMovieDetailed(
  name: string,
  watchedYear: number | null,
): Promise<{ hit: TvdbMovieMeta; guessed: boolean } | null> {
  try {
    const raw = await get<{ tvdb_id?: string; name?: string; year?: string; image_url?: string }[]>(
      `/search?query=${encodeURIComponent(name)}&type=movie&limit=15`,
    );
    const picked = pickMovieMatch(raw, name, watchedYear);
    if (!picked) return null;
    const r = picked.hit;
    const id = Number(r.tvdb_id);
    if (!(id > 0)) return null;
    return {
      guessed: picked.guessed,
      hit: {
        tvdbId: id,
        name: r.name ?? null,
        year: r.year ?? null,
        image: r.image_url && !r.image_url.includes('/images/missing/') ? artworkUrl(r.image_url) : null,
        runtime: null,
      },
    };
  } catch {
    return null;
  }
}

export async function tvdbSearchMovies(query: string): Promise<TvdbSearchResult[]> {
  try {
    const raw = await get<{ tvdb_id?: string; name?: string; year?: string; image_url?: string; country?: string }[]>(
      `/search?query=${encodeURIComponent(query)}&type=movie&limit=12`,
    );
    return raw
      .map((r) => ({
        tvdbId: Number(r.tvdb_id),
        name: r.name ?? '',
        year: r.year ?? null,
        image: r.image_url && !r.image_url.includes('/images/missing/') ? artworkUrl(r.image_url) : null,
        country: r.country ?? null,
      }))
      .filter((r) => r.tvdbId > 0);
  } catch {
    return [];
  }
}

/** Search series by name — returns TheTVDB ids (what TV Time keys on). */
export type TvdbSearchHit = {
  tvdb_id?: string;
  type?: string;
  name?: string;
  year?: string;
  overview?: string;
  image_url?: string;
  genres?: string[];
};

/** Unfiltered search across every record type, with the fields the browse
 *  screens show. `tvdbSearch`/`tvdbSearchMovies` narrow to one type and drop
 *  overview and genres, which the Search screen needs. */
export async function tvdbSearchRaw(query: string): Promise<TvdbSearchHit[]> {
  return get<TvdbSearchHit[]>(`/search?query=${encodeURIComponent(query)}&limit=40`);
}

export async function tvdbSearch(query: string): Promise<TvdbSearchResult[]> {
  try {
    const raw = await get<
      { tvdb_id?: string; name?: string; year?: string; image_url?: string; country?: string }[]
    >(`/search?query=${encodeURIComponent(query)}&type=series&limit=15`);
    return raw
      .map((r) => ({
        tvdbId: Number(r.tvdb_id),
        name: r.name ?? '',
        year: r.year ?? null,
        image: artworkUrl(r.image_url),
        country: r.country ?? null,
      }))
      .filter((r) => r.tvdbId > 0);
  } catch {
    return [];
  }
}
