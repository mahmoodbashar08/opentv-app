import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Alert, I18nManager, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { GestureType } from 'react-native-gesture-handler';
import { GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { useSwipeDown } from '@/components/swipe-down';
import { StatusBarOnCover } from '@/components/profile-template';
import { CheckCircle, ContentColumn, TopTabs, useDetailPaneStyle } from '@/components/ui';
import { getInterest, setInterest as saveInterest,
  addMovieToWatchlist,
  deleteMovie,
  getMovieCharacterVote,
  getMovieEmotions,
  getMovieForRoute,
  setMovieCharacterVote,
  movieBackdropOverride,
  setMovieFavorite,
  setMoviePoster,
  setMovieTvdbId,
  setMovieStars,
  setMovieWatched,
  setMovieWatchedOn,
  toggleMovieEmotion,
} from '@/db';
import { runtimeLabel } from '@/duration';
import { tapSelection } from '@/haptics';
import type { CastMeta } from '@/metadata';
import { movieMeta, type MovieMeta } from '@/movie-metadata';
import { useMovieTvdbRevision } from '@/movie-tvdb-match';
import {
  characterFace,
  characterPercents,
  emotionNames,
  emotionPercents,
  mergeCastForPoll,
  movieMatchState,
  movieYear,
  orderPollCast,
  pollLabel,
  starPercents,
  targetKey,
} from '@/pure';
import { useJoined } from '@/community-session';
import {
  clearCharacterVote,
  COMMUNITY_EMOTIONS,
  postCharacterVote,
  postRating,
  useCharacterVotes,
  useTargetAggregate,
  useVoteSettling,
} from '@/community-ratings';
import { tmdb } from '@/tmdb';
import type { TvdbMovieMeta } from '@/tvdb';
import { colors, radius, space } from '@/theme';
import { currentLocale, t } from '@/i18n';

const TABS = ['About', 'More'] as const;

const STARS = ['media.stars.bad', 'media.stars.ok', 'media.stars.good', 'media.stars.super', 'media.stars.wow'] as const;

// `name` is the value persisted to the database (setMovieWatchedOn) — it must
// stay a stable English identifier across locales; `labelKey` is what's shown.
const WATCH_TILES = [
  { name: 'Theater', labelKey: 'movie.watchTiles.theater' as const, icon: 'ticket' as const, tint: colors.yellow },
  { name: 'Other', labelKey: 'media.watchTiles.other' as const, icon: 'ellipsis-horizontal-circle-outline' as const, tint: colors.text },
  { name: 'Unofficial', labelKey: 'media.watchTiles.unofficial' as const, icon: 'skull-outline' as const, tint: '#E4364C' },
];
const INTERESTS = [
  'media.interests.cast',
  'media.interests.premise',
  'media.interests.creators',
  'movie.interests.studio',
  'media.interests.franchise',
  'media.interests.other',
] as const;
const IMG = 'https://image.tmdb.org/t/p';

// the full 12-emotion set — indexes line up with the imported vote ids
const EMOTIONS = [
  { face: '😯', label: 'media.emotions.shocked' },
  { face: '😤', label: 'media.emotions.frustrated' },
  { face: '😭', label: 'media.emotions.sad' },
  { face: '🤔', label: 'media.emotions.reflective' },
  { face: '🥹', label: 'media.emotions.touched' },
  { face: '😆', label: 'media.emotions.amused' },
  { face: '😱', label: 'media.emotions.scared' },
  { face: '😑', label: 'media.emotions.bored' },
  { face: '😌', label: 'media.emotions.understood' },
  { face: '🤩', label: 'media.emotions.thrilled' },
  { face: '🙃', label: 'media.emotions.confused' },
  { face: '😬', label: 'media.emotions.tense' },
] as const;

function shortDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(currentLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
}

function countLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

type RemoteMeta = MovieMeta & { poster: string | null };

export default function MovieScreen() {
  const insets = useSafeAreaInsets();
  // Which comments screen Comments leads to — see `goComments`.
  const joined = useJoined();
  const {
    name,
    tmdbId: tmdbIdParam,
    tvdbId: tvdbIdParam,
    poster: routePoster,
    year: routeYearParam,
  } = useLocalSearchParams<{ name: string; tmdbId?: string; tvdbId?: string; poster?: string; year?: string }>();
  // a tmdbId param is real identity — supplied whenever the tap came from a
  // search/catalog result, never for a bare imported title — and it is what
  // tells apart two different films sharing a display name ("Amado" 2011 vs.
  // 2022). Without it, name resolution is unchanged: most rows are GDPR
  // imports with no tmdbId at all.
  const routeTmdbId = tmdbIdParam ? Number(tmdbIdParam) : null;
  const routeTvdbId = tvdbIdParam ? Number(tvdbIdParam) : null;
  // poster/year hints from wherever the tap came from (search result, trending
  // card, etc.) — last-resort fallbacks, used only when nothing better is
  // known yet. A bare imported title carries neither, and that's fine: every
  // fallback below tolerates null.
  const routeYear = movieYear(routeYearParam);
  // re-read the db row on focus — Fix match updates it behind this screen
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  // The film's favourite character. Declared HERE, above the focus effect that
  // fills it, rather than beside the other vote state below: that effect runs
  // on mount as well as on every return, so null is only ever the value for one
  // frame, and reaching backwards into a setter declared later is what the
  // lint rule (rightly) objects to.
  const [favChar, setFavChar] = useState<string | null>(null);
  // The chosen artwork, declared here for the same reason as `favChar` above:
  // the focus effect below fills it, and it runs on mount too. Held in state at
  // all because React Compiler cannot memoise a component that reads the
  // database during render — it reported exactly that and stopped compiling
  // this one.
  const [chosenBackdrop, setChosenBackdrop] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      refresh();
      // the Mark as… sheet may have un-watched or rewatched this movie
      const fresh = name ? getMovieForRoute(routeTmdbId, name, routeYear, routeTvdbId) : null;
      setChosenBackdrop(fresh ? movieBackdropOverride(fresh.name) : null);
      if (fresh) {
        setWatched(fresh.watchedAt != null);
        setWatchedAt(fresh.watchedAt);
        setRewatches(fresh.rewatchCount ?? 0);
        // the favourite too: the row may not have existed at mount (an
        // untracked film gets one the moment it is marked watched)
        setFavChar(getMovieCharacterVote(fresh.name)?.name ?? null);
      }
       
    }, [name, routeTmdbId, routeYear, routeTvdbId]),
  );
  // the launch backfill (movie-tvdb-match) fills in TheTVDB ids the GDPR
  // export never carried. Subscribing means a film opened WHILE that pass is
  // still running picks up its id the moment it lands — the read below re-runs
  // on the re-render, `tvdbId` stops being null, and the detail effect fetches
  // the cast on its own. Without it the poll would stay on TMDB's headshots
  // until the screen was closed and reopened.
  useMovieTvdbRevision();
  // the database is the source of truth — every change below persists to it
  // resolve by identity, not title: two different films can share a name
  const dbMovie = name ? getMovieForRoute(routeTmdbId, name, routeYear, routeTvdbId) : null;
  const title = dbMovie?.name ?? name ?? t('movie.genericLabel');
  const tmdbId = dbMovie?.tmdbId ?? routeTmdbId;
  // TheTVDB is the primary movie catalogue since 1.2.0 — a search/Explore/
  // Discover tap always carries this, and a library row that was found via
  // fillMissingMoviePosters or matched from a community export may carry it
  // too. Used below to fetch real detail for a film TMDB never matched.
  // TheTVDB-by-name preview, held only in state — see the effect below. Never
  // written to the db for a film the user hasn't added; a preview must not
  // create rows. Declared here because the identity below counts it.
  const [preview, setPreview] = useState<TvdbMovieMeta | null>(null);
  /**
   * THE PREVIEW'S ID COUNTS AS IDENTITY, and leaving it out was a bug with two
   * faces.
   *
   * A film reached with no id in the route — from a list, a share link, or an
   * imported row — is looked up on TheTVDB BY NAME, and `tvdbMovieByName` only
   * answers on an unambiguous exact match. The screen then renders that film's
   * poster, backdrop, year and runtime. But the id behind all of it was held
   * in `preview` alone and never read here, so:
   *
   *   - the yellow "we couldn't identify this movie" banner sat on top of art
   *     the app had just fetched for a film it had plainly identified;
   *   - and `ensureInDb` saved the row with no id at all, so marking it watched
   *     made the mismatch permanent.
   *
   * The route and the library still win when they have an id: an explicit
   * choice outranks a name lookup.
   */
  const tvdbId = dbMovie?.tvdbId ?? routeTvdbId ?? preview?.tvdbId ?? null;
  const matchState = movieMatchState(dbMovie?.tmdbId ?? routeTmdbId, tvdbId);
  // The identity actually written to on Mark as watched / rate / feel etc.
  // `title` (a render-time const) can go stale mid-tick right after
  // `ensureInDb` creates a disambiguated row (e.g. "Amado" → "Amado (2022)")
  // — the DB already has the new name, but `title` won't reflect it until
  // the next render. A live re-read is the fix, not a ref: it's always
  // exactly what the DB has *right now*, with no render-timing window at all.
  const currentDbName = (): string => {
    const row = name ? getMovieForRoute(routeTmdbId, name, routeYear, routeTvdbId) : null;
    return row?.name ?? title;
  };
  /** The community address of this film, right now — the same rule as
   *  `communityKey` below, re-read for the same reason `currentDbName` is. */
  const currentCommunityKey = (): string => {
    const row = name ? getMovieForRoute(routeTmdbId, name, routeYear, routeTvdbId) : null;
    return targetKey('title', { title: row?.name ?? name ?? '', year: row ? row.year : routeYear });
  };

  // bundled metadata for library movies; untracked ones fetch live (preview)
  const bundled = movieMeta(tmdbId);
  const [remote, setRemote] = useState<RemoteMeta | null>(null);
  // TheTVDB's cast for this film, kept apart from `mm`. It is the ONLY source
  // that carries a character image, and the favourite poll is the one consumer
  // that needs one — see `castForPoll`. Filled by the TheTVDB detail effect
  // below (same fetch, same cache, no second request), which now runs whenever
  // there is a tvdbId rather than only when TMDB missed the film.
  const [tvdbCast, setTvdbCast] = useState<CastMeta[] | null>(null);
  const [trailer, setTrailer] = useState<string | null>(null);
  const mm: MovieMeta | RemoteMeta | undefined = bundled ?? remote ?? undefined;

  // Source precedence, everywhere this screen renders a poster/year/runtime:
  // TMDB metadata (`mm` — bundled, or fetched below when a tmdbId is known)
  // → TheTVDB movie detail (ALSO folded into `mm`, via `remote`, by the
  // second effect below — full runtime/genres/overview/cast for a film with
  // a direct TheTVDB id but no TMDB match) → the library row (`dbMovie`,
  // what the user actually has saved) → the TheTVDB name-search preview
  // (`preview`, filled in by the effect further below for a film with
  // NEITHER a tmdbId NOR a tvdbId — nothing precise enough to fetch by, so
  // it can only guess by title) → the route hints (`routePoster`/`routeYear`,
  // whatever the tap already had on hand). A movie already in the library
  // with a tmdbId hits the first two and never reaches the last two — it is
  // completely unaffected by this chain, exactly as before.
  // Who the favourite poll offers: BOTH catalogues, merged per person. TheTVDB
  // is the only one with a picture of the character, TMDB has the wider and
  // better-illustrated film cast, and either alone leaves holes the other could
  // have filled — see `mergeCastForPoll`. The ABOUT tab's Cast row deliberately
  // keeps reading `mm.cast` and `c.photo`: that row is about the PERFORMERS and
  // prints their names.
  const pollCast = useMemo(() => mergeCastForPoll<CastMeta>(tvdbCast, mm?.cast), [tvdbCast, mm?.cast]);
  // A CHOSEN BACKDROP WINS, because the metadata behind it is refreshed on a
  // schedule and the choice is not.
  //
  // HELD IN STATE, NOT READ IN RENDER. React Compiler is on, and a render-time
  // read of the database is exactly what it cannot memoise — it reported this
  // line as "existing memoization could not be preserved" and stopped compiling
  // the component. The picker is a screen away, so the value is refreshed on
  // focus, which is when it can possibly have changed.
  const displayPoster = chosenBackdrop ?? mm?.backdrop ?? dbMovie?.poster ?? preview?.image ?? routePoster;
  const displayYear = dbMovie?.year ?? preview?.year ?? routeYear;
  const displayRuntime = mm?.runtime ?? preview?.runtime ?? null;

  /**
   * What everyone else thought of this film, and the SAME key `tellCommunity`
   * posts to — read and write must address a film identically or the screen
   * shows one row while voting into another.
   *
   * BUILT ONLY FROM WHAT IS KNOWN AT FIRST PAINT: the library row and the route
   * params, both synchronous. NOT from `displayYear`, which falls back through
   * `preview` — a TheTVDB name-guess that arrives hundreds of milliseconds
   * later and, on a film whose row carries no year, MOVES this key from
   * `slug|` to `slug|1999` after the first fetch has already gone out under the
   * first one. That is the "blank until you open it a second time" report: the
   * screen was reading a key nobody had ever written to.
   *
   * It also settles a disagreement that was already there. `community-seed.ts`
   * addresses a film as `targetKey('title', {title: m.name, year: m.year})` —
   * the library row, no preview involved — so an archive seeded under `slug|`
   * was being read back under `slug|1999` and looked empty forever. One rule,
   * one thread: the row if there is one, the route if there is not.
   */
  const communityKey = targetKey('title', {
    title: dbMovie?.name ?? name ?? '',
    year: dbMovie ? dbMovie.year : routeYear,
  });
  const agg = useTargetAggregate('title', communityKey);
  // The favourite-character rollup, addressed exactly as the ratings are.
  const charVotes = useCharacterVotes('title', communityKey);
  const charPct = characterPercents(charVotes?.items, charVotes?.total);

  useEffect(() => {
    if (!tmdbId) return;
    if (!bundled) {
      tmdb<{
        runtime?: number;
        genres?: { name: string }[];
        release_date?: string;
        overview?: string;
        vote_average?: number;
        vote_count?: number;
        backdrop_path?: string;
        poster_path?: string;
        credits?: { cast?: { name?: string; character?: string; profile_path?: string }[] };
      }>(`/movie/${tmdbId}?append_to_response=credits`)
        .then((d) =>
          setRemote({
            runtime: d.runtime ?? null,
            genres: (d.genres ?? []).map((g) => g.name).slice(0, 4),
            release: d.release_date ?? null,
            overview: d.overview ?? null,
            rating: Math.round((d.vote_average ?? 0) * 10) / 10,
            votes: d.vote_count ?? 0,
            backdrop: d.backdrop_path ? `${IMG}/w780${d.backdrop_path}` : null,
            poster: d.poster_path ? `${IMG}/w342${d.poster_path}` : null,
            cast: (d.credits?.cast ?? []).slice(0, 8).map((c) => ({
              name: c.name ?? null,
              character: c.character ?? null,
              photo: c.profile_path ? `${IMG}/w185${c.profile_path}` : null,
              // TMDB has no character image at all — stated, not omitted. This
              // list feeds the ABOUT tab's Cast row (performers, correct) and
              // the favourite poll only when TheTVDB has nothing for the film.
              charPhoto: null,
            })),
            providers: [],
          }),
        )
        .catch(() => {});
    }
    tmdb<{ results?: { site?: string; type?: string; key?: string; official?: boolean }[] }>(`/movie/${tmdbId}/videos`)
      .then((v) => {
        const vids = (v.results ?? []).filter((x) => x.site === 'YouTube' && x.key);
        const pick = vids.find((x) => x.type === 'Trailer' && x.official) ?? vids.find((x) => x.type === 'Trailer') ?? vids[0];
        if (pick?.key) setTrailer(pick.key);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbId]);

  // The film's TheTVDB record — one fetch, one cache (`tvdbMovieDetail:{id}`
  // in the meta table), two jobs:
  //
  //  1. ALWAYS, whenever there is a tvdbId: its cast, into `tvdbCast`, for the
  //     favourite poll. TheTVDB is the only database that carries a picture of
  //     the CHARACTER; TMDB has literally no such field, so a poll built from
  //     TMDB shows the performer as they look today (and, for animation, the
  //     voice actor). This used to be skipped the instant a film had a tmdbId,
  //     which is most of the library — hence the wrong faces.
  //  2. Only when TMDB has no match at all: the rest of the record — runtime,
  //     genres, release date, overview, artwork — folded into `mm` via the same
  //     `remote` state the TMDB effect above uses. A film WITH a TMDB match
  //     keeps TMDB's detail exactly as before; only the poll's cast changes.
  useEffect(() => {
    if (!tvdbId) return;
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { tvdbMovieDetail } = require('@/tvdb') as typeof import('@/tvdb');
      const d = await tvdbMovieDetail(tvdbId);
      if (cancelled || !d) return;
      setTvdbCast(d.cast ?? []);
      if (tmdbId) return; // TMDB already supplies everything below
      setRemote({
        runtime: d.runtime,
        genres: d.genres,
        release: d.release,
        overview: d.overview,
        // TheTVDB's `score` is a popularity count, not a 0-10 rating, and it
        // carries no streaming providers at all — same gap TMDB fills for
        // shows (see fetchTvdbStructure's `rating: 0` and TMDB_GAP_KEYS).
        rating: 0,
        votes: 0,
        backdrop: d.backdrop ?? d.poster,
        poster: d.poster,
        cast: d.cast,
        providers: [],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [tmdbId, tvdbId]);

  // Fallback for movies TMDB can't match AND with no TheTVDB id either (a
  // bare imported title): find it on TheTVDB by name and fill in the poster +
  // year + runtime so it stops showing blank. A film with a known tvdbId
  // skips this — the effect above already fetches its real detail directly,
  // which this name-guess can only ever approximate.
  //
  // Runs for two different situations:
  //  - a LIBRARY row with no poster yet → looked up by the db name/year, and
  //    the result is persisted (setMoviePoster) same as before.
  //  - a PREVIEW (nothing in the library at all) → looked up by the route's
  //    name/year instead, since there is no db row to read them from, and the
  //    result is held only in `preview` state. Nothing gets written to the db
  //    for a film the user hasn't added — a preview must not create rows.
  useEffect(() => {
    if (tmdbId) return; // TMDB already has (or will have) everything
    if (tvdbId) return; // the effect above already fetches real detail by id
    // RUNS FOR A MISSING ID, NOT ONLY A MISSING POSTER. This used to stop as
    // soon as the row had artwork — and the branch below stored the artwork
    // while throwing the id away, so a film ended up with a poster, a year and
    // a runtime from TheTVDB and no identity, permanently: the guard that let
    // it heal was the same one the artwork had just satisfied. That is the
    // "we couldn't identify this movie" banner sitting on top of the movie.
    if (dbMovie && dbMovie.poster && dbMovie.tvdbId) return;
    const lookupName = dbMovie?.name ?? name;
    if (!lookupName) return;
    const lookupYear = dbMovie ? dbMovie.year : routeYear;
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { tvdbFindMovie } = require('@/tvdb') as typeof import('@/tvdb');
      const hit = await tvdbFindMovie(lookupName, lookupYear);
      if (cancelled || !hit?.image || hit.image.includes('/images/missing/')) return;
      if (dbMovie) {
        // runtime from TheTVDB is minutes; this column stores seconds
        if (!dbMovie.poster) {
          setMoviePoster(dbMovie.name, hit.image, hit.runtime != null ? hit.runtime * 60 : null);
        }
        // THE ID, WHICH IS THE POINT. `tvdbFindMovie` only answers on an
        // unambiguous match, so this is an identification and not a guess —
        // the same standard the launch matcher holds itself to. Storing it
        // heals every row already in the library that was written before this,
        // one open at a time, with nothing to tap.
        if (!dbMovie.tvdbId) setMovieTvdbId(dbMovie.name, hit.tvdbId);
        refresh(); // re-reads dbMovie → poster and identity now show
      } else {
        setPreview(hit);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbId, tvdbId, dbMovie?.name, dbMovie?.poster, dbMovie?.tvdbId, name, routeYear]);

  const { gesture, headerGesture, animatedStyle, onScroll, onScrollBeginDrag, onScrollSettled, setAtTop } = useSwipeDown();
  // on a wide screen this screen sits beside the list instead of covering it
  const paneStyle = useDetailPaneStyle();
  const panRef = useRef<GestureType | undefined>(undefined);
  const pan = useMemo(() => gesture.withRef(panRef), [gesture]);

  const [inDb, setInDb] = useState(dbMovie != null);
  // watched movies open straight on More (your votes); unwatched on About
  const [tab, setTab] = useState<(typeof TABS)[number]>(dbMovie?.watchedAt != null ? 'More' : 'About');
  const [watched, setWatched] = useState(dbMovie?.watchedAt != null);
  const [watchedAt, setWatchedAt] = useState<string | null>(dbMovie?.watchedAt ?? null);
  const [rewatches, setRewatches] = useState<number>(dbMovie?.rewatchCount ?? 0);
  const [stars, setStars] = useState<number | null>(dbMovie?.stars != null ? dbMovie.stars - 1 : null);
  const [emotions, setEmotions] = useState<Set<number>>(new Set(dbMovie ? getMovieEmotions(dbMovie.name) : []));

  // REVEALED BY YOUR OWN VOTE — see the note on the episode screen. Showing
  // the room's answer before asking yours both pre-empts the question and
  // biases it, and gating on local state is what makes the reveal land on the
  // same frame as the tap instead of after the round trip.
  const voted = stars != null || emotions.size > 0;
  // CALCULATE, THEN SHOW — see the note on the episode screen. Hidden while
  // the vote is in the air, so the reader never sees the pre-vote figure.
  const settling = useVoteSettling('title', communityKey);
  // PER HALF, and only on the FIRST vote of each half — see the episode
  // screen. A later change leaves the number up and lets it change in place.
  const [hadScore] = useState(() => dbMovie?.stars != null);
  const [hadEmotions] = useState(() => (dbMovie ? getMovieEmotions(dbMovie.name).length > 0 : false));
  const holdStars = settling.score && !hadScore;
  const holdEmotions = settling.emotions && !hadEmotions;
  const starPct =
    voted && !holdStars && agg && agg.vote_count > 0 ? starPercents(agg.score_counts, agg.vote_count) : null;
  const emoPct = voted && !holdEmotions && agg ? emotionPercents(agg.emotion_counts) : {};
  const [interest, setInterest] = useState<number | null>(null);
  /* Films are keyed by name here, as everywhere else on this screen. Read on
     focus, never in render — see the note on the show screen. */
  useFocusEffect(
    useCallback(() => {
      setInterest(getInterest('movie', name));
    }, [name]),
  );

  const pickInterest = (i: number) => {
    const next = interest === i ? null : i;
    setInterest(next);
    saveInterest('movie', name, next);
  };
  const [menu, setMenu] = useState<SheetAction[] | null>(null);

  // the ⋯ menu — TV Time-style bottom sheet, matching the show screen
  const openMenu = () => {
    if (!dbMovie) return;
    const favorited = !!dbMovie.favorited;
    const actions: SheetAction[] = [
      {
        icon: favorited ? 'heart-dislike-outline' : 'heart-outline',
        text: favorited ? t('media.actions.removeFavorite') : t('media.actions.addFavorite'),
        onPress: () => {
          setMovieFavorite(dbMovie.name, !favorited);
          refresh();
        },
      },
      {
        icon: 'list-outline',
        text: t('media.actions.addToList'),
        onPress: () => router.push(`/add-to-list?type=movie&name=${encodeURIComponent(dbMovie.name)}`),
      },
      {
        icon: 'share-outline',
        text: t('media.actions.share'),
        onPress: () => router.push(`/share-card?type=movie&name=${encodeURIComponent(dbMovie.name)}`),
      },
      // ARTWORK, the same offer a show has had since 1.1. A film's poster is
      // whichever one TheTVDB or TMDB ranked highest, which is often not the
      // one somebody remembers the film by — and for a film with several
      // releases it can be the wrong language entirely.
      {
        icon: 'image-outline',
        text: t('media.actions.customizeArtwork'),
        onPress: () =>
          router.push(
            `/poster-picker?movie=${encodeURIComponent(dbMovie.name)}&tvdbId=${tvdbId ?? ''}&tmdbId=${tmdbId ?? ''}` as never,
          ),
      },
      // the banner only nags while the movie is UNmatched; once it is matched
      // the offer to re-match lives here, where an offer belongs
      {
        icon: 'link-outline',
        text: matchState === 'tmdb' ? t('media.actions.changeMatch') : t('movie.matchToDatabase'),
        onPress: () => router.push(`/fix-match?name=${encodeURIComponent(name ?? title)}`),
      },
      {
        icon: 'trash-outline',
        text: t('media.actions.removeFromLibrary'),
        destructive: true,
        onPress: () =>
          Alert.alert(
            t('media.removeConfirmTitle', { title }),
            t('movie.removeConfirmBody'),
            [
              { text: t('common.remove'), style: 'destructive', onPress: () => { deleteMovie(dbMovie.name); router.back(); } },
              { text: t('common.cancel'), style: 'cancel' },
            ],
          ),
      },
    ];
    setMenu(actions);
  };
  const [watchedOn, setWatchedOn] = useState<number | null>(() => {
    const i = WATCH_TILES.findIndex((wt) => wt.name === dbMovie?.watchedOn);
    return i >= 0 ? i : null;
  });

  // Returns the name of the row this screen actually means, right now — not
  // necessarily `title`. When the movie wasn't in the library yet,
  // `addMovieToWatchlist` may disambiguate it under a different stored name
  // (a same-titled row already exists with a different real tmdbId), and
  // `title` won't reflect that until the next render. Every write below
  // reads this return value (or calls `currentDbName()`) instead of `title`,
  // so a "mark as watched" that follows immediately in the same tick can't
  // land on the wrong row.
  const ensureInDb = (): string => {
    if (inDb) return currentDbName();
    // whatever the screen is showing right now (TMDB, TheTVDB preview, or a
    // route hint) is what gets saved — adding from a preview must not throw
    // away the poster/year this screen went to the trouble of finding
    const releaseYear = (mm?.release ?? '').slice(0, 4) || null;
    addMovieToWatchlist(
      title,
      (remote?.poster ?? displayPoster ?? null) as string | null,
      releaseYear ?? displayYear,
      tmdbId,
      tvdbId,
    );
    setInDb(true);
    return currentDbName();
  };
  const addToWatchlist = () => {
    ensureInDb();
  };

  const markWatchedNow = () => {
    const resolvedName = ensureInDb();
    setWatched(true);
    setWatchedAt(new Date().toISOString());
    try {
      setMovieWatched(resolvedName, true);
    } catch {}
  };
  const toggleWatched = () => {
    if (!watched) {
      markWatchedNow();
      return;
    }
    // same as episodes: the check on a watched movie opens Mark as…
    router.push(`/mark-as?movie=${encodeURIComponent(title)}`);
  };

  // votes require the movie to be watched first, like the real app
  const requireWatched = (apply: () => void) => {
    if (watched) {
      apply();
      return;
    }
    Alert.alert(t('movie.requireWatchedTitle'), t('movie.requireWatchedBody'), [
      {
        text: t('movie.markAsWatched'),
        onPress: () => {
          markWatchedNow();
          apply();
        },
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  /**
   * Films had no community vote at all until now: Phase 3 wired only the
   * episode screen, so every star given to a film went no further than this
   * phone and the percentages stayed empty forever.
   *
   * A film is addressed the same way its comments are — `title` + the shared
   * slug|year key — because `movies.name` is the local primary key and a tvdbId
   * is nullable. Getting this wrong forks the thread; `targetKey` is the one
   * rule both sides agree on.
   *
   * Called with the values being written rather than the state variables: both
   * setters are asynchronous, so reading state here sends the previous vote.
   *
   * EVERY SELECTED FEELING GOES, not the lowest-indexed one. This used to walk
   * the twelve tiles and break on the first match, so a film marked SHOCKED and
   * THRILLED sent `shocked` and threw `thrilled` away before it left the phone —
   * which is why the community row read "SHOCKED 100%" with nothing under the
   * other tile. `emotions` is the WHOLE current selection and the server
   * replaces its stored set with it, so an un-tapped face is a deletion and a
   * re-sent identical set is a no-op.
   *
   * The key is re-derived HERE rather than read off the render, for the same
   * reason `currentDbName()` exists: `ensureInDb` may have just created (or
   * disambiguated) the row in this very tick.
   */
  const tellCommunity = (
    nextStars: number | null,
    nextEmotions: ReadonlySet<number>,
    changed?: 'score' | 'emotions',
  ) => {
    postRating({
      source: 'title',
      key: currentCommunityKey(),
      season: null,
      episode: null,
      score: nextStars != null ? (nextStars + 1) * 2 : null,
      emotions: emotionNames(nextEmotions),
      changed,
    });
  };

  const rate = (i: number) =>
    requireWatched(() => {
      setStars(i);
      try {
        setMovieStars(currentDbName(), i + 1);
      } catch {}
      tellCommunity(i, emotions, 'score');
    });
  const feel = (i: number) =>
    requireWatched(() => {
      const next = new Set(emotions);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      setEmotions(next);
      try {
        toggleMovieEmotion(currentDbName(), i);
      } catch {}
      tellCommunity(stars, next, 'emotions');
    });

  /**
   * The film's favourite. Until now this row was a static strip of faces with
   * no `onPress` at all: the question was asked, tapping did nothing, and the
   * only rows the local table ever held came from the TV Time archive.
   *
   * Same shape as `feel` — behind `requireWatched`, written locally first,
   * read back rather than assumed, and told to the community afterwards. The
   * name is re-derived through `currentDbName()` because marking the film
   * watched may have just created (or disambiguated) the row.
   */
  const pickCharacter = (character: string) => {
    return requireWatched(() => {
      tapSelection();
      const key = currentDbName();
      try {
        setMovieCharacterVote(key, character);
      } catch {
        // A failed write leaves the row as it was, and the read below reports
        // that truthfully rather than lighting a tile nothing is behind.
      }
      const now = getMovieCharacterVote(key)?.name ?? null;
      setFavChar(now);
      // Both directions reach the server, or the bar and the highlight disagree
      // the next time this film is opened.
      const communityKey = currentCommunityKey();
      if (now) {
        postCharacterVote({ source: 'title', key: communityKey, character: now, season: null, episode: null });
      } else {
        clearCharacterVote('title', communityKey);
      }
    });
  };

  /**
   * ONE comments destination, not two.
   *
   * The archive screen and the community thread hold the SAME comments — the
   * archive is simply the ones this phone imported, and seeding puts them on
   * the server. Offering both, as this screen and the show screen did, asked
   * the user to understand a distinction that is ours and not theirs, and the
   * pill led to the read-only one, which is why a film looked like a place you
   * could not comment.
   *
   * So: joined → the thread, which already contains the archive and can be
   * written to. Not joined → the archive, because that user has no server and
   * must not acquire one by tapping Comments.
   */
  const goComments = () => {
    if (joined) {
      router.push(
        `/thread?source=title&key=${encodeURIComponent(currentCommunityKey())}&title=${encodeURIComponent(title)}`,
      );
      return;
    }
    router.push(`/comments?title=${encodeURIComponent(title)}`);
  };
  const openComments = () => {
    if (watched) {
      goComments();
      return;
    }
    Alert.alert(t('movie.spoilersTitle'), t('movie.spoilersBody'), [
      { text: t('movie.displayAnyway'), onPress: goComments },
      {
        text: t('movie.watchedThisMovie'),
        onPress: () => {
          markWatchedNow();
          goComments();
        },
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const rating5 = mm?.rating ? mm.rating / 2 : null;
  const filled = rating5 ? Math.round(rating5) : 0;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ flex: 1, backgroundColor: colors.bg }, animatedStyle, paneStyle]}>
        {/* The backdrop runs under the status bar, so its glyphs follow the
            artwork rather than the page — dark-on-dark otherwise. */}
        <StatusBarOnCover />
        {/* banner: backdrop with title + runtime · genres overlaid, like the real app */}
        <GestureDetector gesture={headerGesture}>
          <View style={[styles.backdrop, { height: insets.top + 230 }]}>
            {displayPoster && (
              <>
                <Image
                  source={{ uri: displayPoster }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="disk"
                />
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.30)' }]} />
              </>
            )}
            <View style={[styles.backdropBar, { marginTop: insets.top + 4 }]}>
              <Pressable onPress={() => router.back()} hitSlop={10}>
                {/* In the bar that sits on the backdrop — see `colors.onArt`.
                    Fixed on the show screen and missed here. */}
                <Ionicons name="chevron-down" size={26} color={colors.onArt} />
              </Pressable>
              <Pressable hitSlop={10} onPress={openMenu}>
                <Ionicons name="ellipsis-horizontal" size={22} color={colors.onArt} />
              </Pressable>
            </View>
            <View style={styles.backdropMeta}>
              <View style={{ flex: 1 }}>
                {/* shrinks instead of truncating — same reason as the show
                    header, and long film titles hit it just as hard */}
                <Text selectable style={styles.title} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.65}>
                  {title}
                </Text>
                <Text style={styles.subtitle}>
                  {[runtimeLabel(displayRuntime), mm?.genres?.join(', ')].filter(Boolean).join(' • ') || t('movie.genericLabel')}
                </Text>
              </View>
              {/* always rendered so favoriting never reflows/squeezes the title */}
              <View style={[styles.favBadge, !dbMovie?.favorited && { opacity: 0 }]}>
                <Ionicons name="heart" size={20} color="#fff" />
              </View>
            </View>
          </View>
        </GestureDetector>

        {/* release date · watch state · check */}
        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={16} color={colors.dim} />
          <Text style={styles.metaText}>{mm?.release ? shortDate(mm.release) : (displayYear ?? '—')}</Text>
          <Ionicons name="eye-outline" size={17} color={colors.dim} style={{ marginStart: 10 }} />
          <Text style={styles.metaText}>{watchedAt ? shortDate(watchedAt) : t('media.notWatched')}</Text>
          {rewatches > 0 && <Text style={[styles.metaText, { color: colors.yellow }]}>{`↻ ×${rewatches}`}</Text>}
          <View style={{ marginStart: 'auto' }}>
            <CheckCircle watched={watched} onPress={toggleWatched} size={42} />
          </View>
        </View>

        {/* Only an UNMATCHED movie gets a banner, because only then is there
            something to do. A match that has been made is not a standing task:
            picking a TheTVDB entry used to leave this bar in place, unchanged,
            which read as the tap having failed. Re-matching now lives in the
            ⋯ menu. */}
        {inDb && matchState === 'unmatched' && (
          <Pressable
            style={styles.fixMatch}
            onPress={() => router.push(`/fix-match?name=${encodeURIComponent(name ?? title)}`)}>
            <Ionicons name="link-outline" size={20} color={colors.onYellow} />
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={styles.fixMatchTitle}>{t('movie.fixMatchTitle')}</Text>
              <Text style={styles.fixMatchSub}>{t('movie.fixMatchSub')}</Text>
            </View>
            <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.onYellow} />
          </Pressable>
        )}

        <TopTabs
          tabs={TABS}
          labels={{ About: t('movie.tabs.about'), More: t('movie.tabs.more') }}
          active={tab}
          onChange={(nextTab) => {
            setTab(nextTab);
            setAtTop(true);
          }}
        />

        <View style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{ paddingBottom: (tab === 'More' ? 96 : 30) + (inDb ? 0 : 80), paddingTop: 12 }}
            simultaneousHandlers={panRef}
            onScroll={onScroll}
            onScrollBeginDrag={onScrollBeginDrag}
            onScrollEndDrag={onScrollSettled}
            onMomentumScrollEnd={onScrollSettled}
            scrollEventThrottle={32}
            bounces>
            {tab === 'About' ? (
              <>
                <View style={styles.rowBetween}>
                  <Text style={styles.h2}>{t('media.whereToWatch')}</Text>
                  <Ionicons name="settings-outline" size={18} color={colors.dim} />
                </View>
                <Text style={[styles.body, { paddingHorizontal: space.lg, marginTop: 2 }]}>
                  {mm?.providers?.length ? mm.providers.map((p) => p.name).join(' · ') : t('media.providersUnavailable')}
                </Text>

                {/* the interests poll only shows for movies in your library */}
                {inDb && (
                  <>
                    <View style={styles.divider} />
                    <Text style={styles.pollLabel}>{t('movie.interestsPollLabel')}</Text>
                    {INTERESTS.map((labelKey, i) => (
                      <Pressable
                        key={labelKey}
                        style={[styles.interestBtn, interest === i && { backgroundColor: colors.brand }]}
                        onPress={() => pickInterest(i)}>
                        <Text style={[styles.interestText, interest === i && { color: colors.onBrand }]}>
                          {t(labelKey).toUpperCase()}
                        </Text>
                      </Pressable>
                    ))}
                  </>
                )}

                <View style={styles.divider} />
                <Text style={[styles.h2, { paddingHorizontal: space.lg }]}>{t('movie.movieInfoTitle')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.lg, marginTop: 8 }}>
                  <View style={styles.tBadge}>
                    <Text style={{ fontWeight: '800', color: colors.onYellow, fontSize: 13 }}>T</Text>
                  </View>
                  <Text style={{ color: colors.yellow, letterSpacing: 2 }}>
                    {'★'.repeat(filled)}
                    {'☆'.repeat(5 - filled)}
                  </Text>
                  <Text style={styles.caption2}>{rating5 ? `${rating5.toFixed(1)}/5` : '—/5'}</Text>
                  {mm?.votes ? <Text style={styles.caption2}> {t('movie.ratingsCount', { count: countLabel(mm.votes) })}</Text> : null}
                </View>
                {/* the only prose paragraph on this screen — capped so a
                    1366pt iPad doesn't render the synopsis as one enormous
                    line; everything else on this tab is a row/band */}
                <ContentColumn>
                  <Text style={[styles.body, { paddingHorizontal: space.lg, marginTop: 10 }]}>
                    {mm?.overview ?? t('movie.noSynopsis')}
                  </Text>
                </ContentColumn>

                {trailer && (
                  <>
                    <View style={styles.divider} />
                    <Pressable
                      style={styles.trailerRow}
                      onPress={() => Linking.openURL(`https://www.youtube.com/watch?v=${trailer}`)}>
                      <View style={styles.trailerThumb}>
                        <Image
                          source={{ uri: `https://img.youtube.com/vi/${trailer}/hqdefault.jpg` }}
                          style={StyleSheet.absoluteFill}
                          contentFit="cover"
                          cachePolicy="disk"
                        />
                        <View style={styles.trailerPlay}>
                          <Ionicons name="play" size={16} color="#FFF" style={{ marginLeft: 2 }} />
                        </View>
                      </View>
                      <View>
                        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{t('movie.watchTrailer')}</Text>
                        <Text style={styles.caption2}>YouTube</Text>
                      </View>
                    </Pressable>
                  </>
                )}

                {!!mm?.cast?.length && (
                  <>
                    <View style={styles.divider} />
                    <Text style={[styles.h2, { paddingHorizontal: space.lg, marginBottom: 12 }]}>{t('media.castTitle')}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: space.lg }}>
                      {mm.cast.map((c, i) => (
                        <View key={`${c.name}-${i}`} style={{ width: 96 }}>
                          <View style={styles.charCard}>
                            {c.photo ? (
                              <Image source={{ uri: c.photo }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                            ) : (
                              <Ionicons name="person" size={30} color="#B9B9C0" />
                            )}
                          </View>
                          <Text style={styles.castName} numberOfLines={1}>
                            {c.name ?? ''}
                          </Text>
                          <Text style={styles.charName} numberOfLines={1}>
                            {(c.character ?? '').toUpperCase()}
                          </Text>
                        </View>
                      ))}
                    </ScrollView>
                  </>
                )}
              </>
            ) : (
              <>
                <Text style={styles.pollLabel}>{t('media.whereDidYouWatchPoll')}</Text>
                <View style={styles.provRow}>
                  {WATCH_TILES.map((tile, i) => (
                    <Pressable
                      key={tile.name}
                      style={{ alignItems: 'center', width: 82 }}
                      onPress={() =>
                        requireWatched(() => {
                          const next = watchedOn === i ? null : i;
                          setWatchedOn(next);
                          try {
                            setMovieWatchedOn(currentDbName(), next == null ? null : WATCH_TILES[next].name);
                          } catch {}
                        })
                      }>
                      <View style={[styles.provTile, watchedOn === i && { borderWidth: 1.5, borderColor: colors.yellow }]}>
                        <Ionicons name={tile.icon} size={30} color={tile.tint} />
                      </View>
                      <Text style={styles.provLabel}>{t(tile.labelKey).toUpperCase()}</Text>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.divider} />
                <Text style={styles.pollLabel}>{t('movie.ratePollLabel')}</Text>
                {/* stars in the box, names and figures under it — the same
                    treatment as the episode screen, from the same design */}
                <View style={styles.rateBox}>
                  {STARS.map((lblKey, i) => (
                    <Pressable key={lblKey} style={styles.starCell} onPress={() => rate(i)}>
                      <Text style={{ fontSize: 30, color: stars != null && i <= stars ? colors.brand : colors.pillGrey }}>★</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.starLegend}>
                  {STARS.map((lblKey, i) => (
                    <View key={lblKey} style={styles.starCell}>
                      <Text style={[styles.starLabel, starPct != null && (i === stars ? styles.starLabelMine : styles.starLabelOther)]}>
                        {t(lblKey)}
                      </Text>
                      {/* Always rendered, blank until there is a figure — see
                          the episode screen. A line that appears when the vote
                          settles would push the feelings grid down the screen
                          mid-read. */}
                      <Text style={[styles.starPct, i === stars && styles.starPctMine]}>
                        {starPct != null ? `${starPct[i] ?? 0}%` : ' '}
                      </Text>
                    </View>
                  ))}
                </View>

                <View style={styles.divider} />
                <Text style={styles.pollLabel}>{t('media.howDidYouFeelPoll')}</Text>
                <View style={styles.emoGrid}>
                  {EMOTIONS.map((e, i) => {
                    // `EMOTIONS` here is index-locked to COMMUNITY_EMOTIONS —
                    // the same lock `tellCommunity` above relies on to name the
                    // emotion it sends
                    const name = COMMUNITY_EMOTIONS[i];
                    const pct = name != null ? emoPct[name] : undefined;
                    return (
                      <Pressable
                        key={e.label}
                        style={[styles.emo, emotions.has(i) && { backgroundColor: colors.brand }]}
                        onPress={() => feel(i)}>
                        <Text style={{ fontSize: 24 }}>{e.face}</Text>
                        <Text style={[styles.emoLabel, emotions.has(i) && { color: colors.onBrand }]}>{t(e.label)}</Text>
                        <Text style={[styles.emoPct, emotions.has(i) && { color: colors.onBrand }]}>
                          {pct != null ? `${pct}%` : ' '}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {!!pollCast.length && (
                  <>
                    <View style={styles.divider} />
                    <Text style={styles.pollLabel}>{t('media.whoWasFavoritePoll')}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: space.lg }}>
                      {orderPollCast(pollCast, charPct).map((c, i) => {
                        const label = pollLabel(c);
                        // The character as they appear IN THE FILM, falling
                        // back to the performer for THIS entry alone — TheTVDB
                        // has art for most characters in a film but not all
                        // (Shawshank has Andy and Red, not Warden Norton), and
                        // one gap must not drag the whole row back to headshots.
                        const face = characterFace(c);
                        const picked = !!label && favChar === label;
                        // Once a favourite exists, everyone else steps back —
                        // the border alone reads as decoration on a row of
                        // bright faces, and the answer should be the only thing
                        // at full strength.
                        const dimmed = favChar != null && !picked;
                        return (
                          <Pressable
                            key={`${c.name}-${i}`}
                            style={[{ width: 96, alignItems: 'center' }, dimmed && styles.charDim]}
                            onPress={() => label && pickCharacter(label)}>
                            <View style={[styles.charCard, picked && styles.charPicked]}>
                              {face ? (
                                <Image source={{ uri: face }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                              ) : (
                                <Ionicons name="person" size={30} color="#B9B9C0" />
                              )}
                              {picked && (
                                <View style={styles.charCheck}>
                                  <Ionicons name="checkmark" size={14} color={colors.onYellow} />
                                </View>
                              )}
                            </View>
                            <Text style={[styles.charName, picked && { color: colors.yellow }]} numberOfLines={1}>
                              {label.toUpperCase()}
                            </Text>
                            {charPct[label] != null && <Text style={styles.charPct}>{`${charPct[label]}%`}</Text>}
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </>
                )}
              </>
            )}
          </ScrollView>

          {/* comments float over More, spoiler-guarded while unwatched */}
          {tab === 'More' && inDb && (
            <Pressable style={styles.commentsPill} onPress={openComments}>
              <Text style={styles.commentsText}>{t('media.commentsPill')}</Text>
              <Ionicons name={I18nManager.isRTL ? 'arrow-back' : 'arrow-forward'} size={16} color="#FFF" />
            </Pressable>
          )}

          {/* untracked movies get the full-width add bar, like the real app */}
          {!inDb && (
            <Pressable style={[styles.addBar, { paddingBottom: insets.bottom + 14 }]} onPress={addToWatchlist}>
              <Ionicons name="add" size={24} color={colors.onYellow} />
              <Text style={styles.addBarText}>{t('movie.addMovieButton')}</Text>
            </Pressable>
          )}
        </View>
        <ActionSheet visible={menu != null} title={title} actions={menu ?? []} onClose={() => setMenu(null)} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fixMatch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.yellow,
    borderRadius: radius.card,
    marginHorizontal: space.lg,
    marginBottom: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fixMatchTitle: { color: colors.onYellow, fontSize: 14.5, fontWeight: '800' },
  fixMatchSub: { color: colors.onYellow, fontSize: 12.5, opacity: 0.75 },
  backdrop: { backgroundColor: colors.card, justifyContent: 'space-between' },
  backdropBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
  },
  backdropMeta: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: space.lg, paddingBottom: 14 },
  favBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  /* On the backdrop, with the meta line below it — the same as the show
     screen's, which was fixed and this was not. `onArt` is white in both
     themes because over an unknown image only one colour is ever safe. */
  title: { color: colors.onArt, fontSize: 24, fontWeight: '800' },
  subtitle: { color: colors.onArtDim, fontSize: 14.5, marginTop: 4 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: space.lg,
    paddingVertical: 11,
  },
  metaText: { color: colors.dim, fontSize: 14 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingBottom: 8,
  },
  h2: { color: colors.text, fontSize: 20, fontWeight: '800' },
  body: { color: colors.text, fontSize: 14.5, lineHeight: 20 },
  caption2: { color: colors.dim, fontSize: 13.5 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 16 },
  pollLabel: {
    color: colors.dim,
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 1.2,
    textAlign: 'center',
    marginBottom: 13,
  },
  interestBtn: {
    backgroundColor: colors.card,
    borderRadius: 8,
    marginHorizontal: space.lg,
    marginBottom: 9,
    paddingVertical: 13,
    alignItems: 'center',
  },
  interestText: { color: colors.text, fontSize: 10.5, fontWeight: '600', letterSpacing: 0.7 },
  tBadge: { backgroundColor: colors.yellow, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 1 },
  provRow: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  provTile: {
    width: 82,
    height: 62,
    borderRadius: 8,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  provLabel: {
    color: colors.dim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: 7,
  },
  rateBox: {
    backgroundColor: colors.panel,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 8,
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '78%',
    alignSelf: 'center',
  },
  /** Shared by the star row and the legend under it so the two line up. */
  starCell: { flex: 1, alignItems: 'center', gap: 4 },
  starLegend: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    width: '78%',
    alignSelf: 'center',
    marginTop: 6,
  },
  starLabel: { color: colors.dim, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.5 },
  starLabelMine: { color: colors.text, fontWeight: '800' },
  starLabelOther: { color: colors.faint },
  starPct: { color: colors.dim, fontSize: 11, fontWeight: '600' },
  starPctMine: { color: colors.text, fontWeight: '800' },
  emoPct: { color: colors.dim, fontSize: 9, fontWeight: '700' },
  emoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  emo: {
    width: '22%',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    alignItems: 'center',
    paddingVertical: 12,
    gap: 4,
  },
  emoLabel: { color: colors.dim, fontSize: 9, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  charCard: {
    width: 96,
    height: 110,
    borderRadius: 6,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Selection shown exactly as the episode screen shows it, and as the emotion
  // tiles do: yellow.
  charPicked: { borderWidth: 2, borderColor: colors.yellow },
  // Dimmed, not hidden: the others stay legible and stay tappable, because
  // changing your mind is one tap and must not feel like undoing something.
  charDim: { opacity: 0.4 },
  charCheck: {
    position: 'absolute',
    top: 5,
    end: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  castName: { color: colors.text, fontSize: 12.5, marginTop: 6 },
  charName: { color: colors.dim, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6, marginTop: 3 },
  /** The community's share, rendered only when there is one — no zeroes. */
  charPct: { color: colors.dim, fontSize: 9, fontWeight: '700', marginTop: 2 },
  trailerRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: space.lg },
  trailerThumb: {
    width: 118,
    height: 66,
    borderRadius: 8,
    backgroundColor: colors.card,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailerPlay: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.onArt,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentsPill: {
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.blue,
    borderRadius: radius.pill,
    paddingVertical: 13,
    paddingHorizontal: 28,
  },
  commentsText: { color: '#FFF', fontSize: 13.5, fontWeight: '700', letterSpacing: 1 },
  addBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 18,
  },
  addBarText: { color: colors.onYellow, fontSize: 16, fontWeight: '900', letterSpacing: 1.5 },
});
