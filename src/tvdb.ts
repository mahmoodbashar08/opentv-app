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

/**
 * A response TheTVDB itself refused, carrying the code. Nearly every caller in
 * this file swallows failures into `null` — which is right when the only
 * question is "do we have art yet?", and wrong when the answer has to be
 * REMEMBERED. A record that 404s is gone for good; a request that failed
 * because the phone was on a train is not. `tvdbCharacter` is the first caller
 * that must tell those apart, so the status survives the throw.
 */
export class TvdbHttpError extends Error {
  constructor(
    public readonly status: number,
    path: string,
  ) {
    super(`TheTVDB ${status} on ${path}`);
    this.name = 'TvdbHttpError';
  }
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
    if (!res.ok) throw new TvdbHttpError(res.status, path);
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

/**
 * Verified against a live `/movies/{id}/extended` response (Inception,
 * id 113): the fields listed here are the ones actually present. Notably
 * absent — unlike the series extended record — is a top-level `overview`;
 * the movie only lists WHICH languages have one (`overviewTranslations`, an
 * array of language codes), so the text itself has to be asked for
 * separately via `/movies/{id}/translations/{lang}` (`tvdbMovieTranslation`
 * below). `characters` and `status` ARE present, and shaped exactly like a
 * series' (same `TvdbCharacter`, same `{ name }` status object).
 */
export type TvdbMovieExtended = {
  id: number;
  name?: string | null;
  image?: string | null;
  year?: string | null;
  runtime?: number | null;
  genres?: { name?: string | null }[];
  artworks?: { image?: string; type?: number; score?: number }[];
  first_release?: { date?: string | null } | null;
  status?: { name?: string | null } | null;
  characters?: TvdbCharacter[];
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

/** Translated name + overview for a movie. Same shape and same reason as
 *  `tvdbTranslation` for series: the extended record only says which
 *  languages exist, never the English text itself. */
export async function tvdbMovieTranslation(
  id: number,
  lang = 'eng',
): Promise<{ name: string | null; overview: string | null } | null> {
  try {
    const d = await get<{ name?: string | null; overview?: string | null }>(`/movies/${id}/translations/${lang}`);
    return { name: d.name ?? null, overview: d.overview ?? null };
  } catch {
    return null;
  }
}

/** Full detail for the movie screen when there's a direct TheTVDB id but no
 *  TMDB match: runtime, genres, release date, overview, cast, and artwork
 *  sharper than a search-result thumbnail. `rating`/`votes`/`providers` are
 *  deliberately absent — TheTVDB's `score` is a popularity count rather than
 *  a 0-10 rating, and it carries no streaming providers at all; the movie
 *  screen fills those in as 0/empty, same as the show screen already does
 *  for a TheTVDB-sourced record (see fetchTvdbStructure's `rating: 0`). */
export type TvdbMovieDetail = {
  runtime: number | null;
  genres: string[];
  /** ISO release date, e.g. "2010-07-08" — from `first_release`. */
  release: string | null;
  overview: string | null;
  /** Best movie poster art (type 14), for library grids. */
  poster: string | null;
  /** Best movie background art (type 15), for the screen's banner. */
  backdrop: string | null;
  /** `photo` is the PERFORMER, `charPhoto` the CHARACTER in the film — the same
   *  split as `CastMeta` in metadata.ts, and for the same two consumers. An old
   *  film is exactly where taking only the headshot showed most: the actor as
   *  they look now, decades after the part. */
  cast: { name: string | null; character: string | null; photo: string | null; charPhoto: string | null }[];
  /** ms epoch of the fetch that produced this — drives cache staleness. */
  fetchedAt: number;
};

// A released film's runtime/genres/cast essentially never change — the same
// rationale STALE_ENDED_MS applies to a finished show, reused directly here.
const MOVIE_DETAIL_STALE_MS = 30 * 24 * 3600 * 1000;

/**
 * `tvdbMovieDetail`, cached in the `meta` table exactly like show metadata
 * (`showMeta:{tvdbId}` in show-meta-fetch.ts) so reopening the same film
 * doesn't refetch on every visit. Two requests, run together: the extended
 * record and the English translation (see `TvdbMovieExtended`'s comment for
 * why both are needed — the extended record alone has no overview text).
 */
export async function tvdbMovieDetail(id: number, force = false): Promise<TvdbMovieDetail | null> {
  const key = `tvdbMovieDetail:${id}`;
  if (!force) {
    const cached = getMeta(key);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as TvdbMovieDetail;
        // Same rule as `showMetaIsStale`: a cast cached before `charPhoto`
        // existed holds only the PERFORMER, which is what put a voice actor
        // under an animated favourite and a present-day face under an old one.
        // Absent (not null) is the tell — a character with genuinely no art is
        // stored as null and must not refetch for ever.
        const missingCharPhoto = (parsed.cast ?? []).some((c) => !('charPhoto' in c));
        if (!missingCharPhoto && Date.now() - (parsed.fetchedAt ?? 0) < MOVIE_DETAIL_STALE_MS) return parsed;
      } catch {
        // corrupt cache entry — fall through and refetch
      }
    }
  }
  try {
    const [ext, eng] = await Promise.all([tvdbMovieExtended(id), tvdbMovieTranslation(id, 'eng')]);
    if (!ext) return null;
    // featured leads first, then TheTVDB's own sort — same rule fetchTvdbStructure uses for series
    const chars = (ext.characters ?? [])
      .slice()
      .sort((a, b) => Number(b.isFeatured ?? false) - Number(a.isFeatured ?? false) || (a.sort ?? 0) - (b.sort ?? 0));
    const detail: TvdbMovieDetail = {
      runtime: ext.runtime ?? null,
      genres: (ext.genres ?? []).map((g) => g.name).filter((n): n is string => !!n),
      release: (ext.first_release?.date ?? '').trim() || null,
      overview: eng?.overview ?? null,
      poster: bestArtwork(ext.artworks, TVDB_ART_MOVIE_POSTER) ?? artworkUrl(ext.image),
      backdrop: bestArtwork(ext.artworks, TVDB_ART_MOVIE_BACKGROUND),
      cast: chars.slice(0, 20).map((c) => ({
        name: c.personName ?? null,
        character: c.name ?? null,
        photo: artworkUrl(c.personImgURL),
        charPhoto: artworkUrl(c.image),
      })),
      fetchedAt: Date.now(),
    };
    setMeta(key, JSON.stringify(detail));
    return detail;
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
// Movies have their OWN type ids, distinct from series' — verified against
// /artwork/types live: 14/15 (not 2/3, which return nothing for a movie).
export const TVDB_ART_MOVIE_POSTER = 14;
export const TVDB_ART_MOVIE_BACKGROUND = 15;

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

/** One character record, by id — `/characters/{id}`. */
export type TvdbCharacterRecord = {
  id: number;
  name?: string | null;
  personName?: string | null;
  seriesId?: number | null;
  image?: string | null;
};

/**
 * A character looked up by TheTVDB id, in THREE outcomes rather than two.
 *
 *  - `ok` — the record exists and has a name.
 *  - `gone` — TheTVDB answered, and the answer is "no such character" (a 404,
 *    or a record with no name at all). This will never become an `ok`; a
 *    caller may write it down and stop asking.
 *  - `failed` — we never got an answer: offline, timed out, rate-limited, key
 *    rejected. Says NOTHING about the record and must never be remembered as
 *    a miss, or a single flight with the phone in aeroplane mode would erase
 *    the chance of ever recovering these names.
 *
 * The other lookups here fold all three into `null` because they are only ever
 * asked again next launch anyway. This one's answer gets persisted, so the
 * distinction has to survive.
 */
export type TvdbCharacterLookup =
  | { status: 'ok'; character: TvdbCharacterRecord }
  | { status: 'gone' }
  | { status: 'failed' };

export async function tvdbCharacter(id: number): Promise<TvdbCharacterLookup> {
  try {
    const d = await get<TvdbCharacterRecord | null>(`/characters/${id}`);
    // a 200 carrying no usable name is the same dead end as a 404: TheTVDB has
    // answered, and there is no name to be had
    if (!d || !(d.name ?? '').trim()) return { status: 'gone' };
    return { status: 'ok', character: d };
  } catch (e) {
    // 404/400 = this id is not (or is no longer) a character. 401/403/429/5xx
    // and every network error are transient or about US, not about the record.
    if (e instanceof TvdbHttpError && (e.status === 404 || e.status === 400)) return { status: 'gone' };
    return { status: 'failed' };
  }
}

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
