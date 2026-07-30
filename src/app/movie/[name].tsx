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
import { CheckCircle, ContentColumn, TopTabs, useDetailPaneStyle } from '@/components/ui';
import {
  addMovieToWatchlist,
  deleteMovie,
  getMovieEmotions,
  getMovieForRoute,
  setMovieFavorite,
  setMoviePoster,
  setMovieStars,
  setMovieWatched,
  setMovieWatchedOn,
  toggleMovieEmotion,
} from '@/db';
import { runtimeLabel } from '@/duration';
import { movieMeta, type MovieMeta } from '@/movie-metadata';
import { movieMatchState, movieYear } from '@/pure';
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
  useFocusEffect(
    useCallback(() => {
      refresh();
      // the Mark as… sheet may have un-watched or rewatched this movie
      const fresh = name ? getMovieForRoute(routeTmdbId, name, routeYear, routeTvdbId) : null;
      if (fresh) {
        setWatched(fresh.watchedAt != null);
        setWatchedAt(fresh.watchedAt);
        setRewatches(fresh.rewatchCount ?? 0);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [name, routeTmdbId, routeYear, routeTvdbId]),
  );
  // the database is the source of truth — every change below persists to it
  // resolve by identity, not title: two different films can share a name
  const dbMovie = name ? getMovieForRoute(routeTmdbId, name, routeYear, routeTvdbId) : null;
  const title = dbMovie?.name ?? name ?? t('movie.genericLabel');
  const tmdbId = dbMovie?.tmdbId ?? routeTmdbId;
  // TheTVDB is the primary movie catalogue since 1.2.0 — a search/Explore/
  // Discover tap always carries this, and a library row that was found via
  // fillMissingMoviePosters or matched from a community export may carry it
  // too. Used below to fetch real detail for a film TMDB never matched.
  const tvdbId = dbMovie?.tvdbId ?? routeTvdbId;
  const matchState = movieMatchState(dbMovie?.tmdbId, dbMovie?.tvdbId ?? routeTvdbId);
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

  // bundled metadata for library movies; untracked ones fetch live (preview)
  const bundled = movieMeta(tmdbId);
  const [remote, setRemote] = useState<RemoteMeta | null>(null);
  const [trailer, setTrailer] = useState<string | null>(null);
  const mm: MovieMeta | RemoteMeta | undefined = bundled ?? remote ?? undefined;
  // TheTVDB-by-name preview, held only in state — see the effect below. Never
  // written to the db for a film the user hasn't added; a preview must not
  // create rows.
  const [preview, setPreview] = useState<TvdbMovieMeta | null>(null);

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
  const displayPoster = mm?.backdrop ?? dbMovie?.poster ?? preview?.image ?? routePoster;
  const displayYear = dbMovie?.year ?? preview?.year ?? routeYear;
  const displayRuntime = mm?.runtime ?? preview?.runtime ?? null;

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

  // A direct TheTVDB id but no TMDB match: fetch the real thing — runtime,
  // genres, release date, overview, cast, and artwork sharper than whatever
  // search-result thumbnail got us here — instead of settling for the
  // name-guess preview below. Folds straight into `mm` via the same `remote`
  // state the TMDB effect above uses, so every render below is unchanged;
  // the two effects are mutually exclusive (this one is skipped the instant
  // there's a tmdbId), so a movie WITH a TMDB match never reaches this path.
  useEffect(() => {
    if (tmdbId || !tvdbId) return;
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { tvdbMovieDetail } = require('@/tvdb') as typeof import('@/tvdb');
      const d = await tvdbMovieDetail(tvdbId);
      if (cancelled || !d) return;
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
    if (dbMovie && dbMovie.poster) return; // library row already has a poster
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
        setMoviePoster(dbMovie.name, hit.image, hit.runtime != null ? hit.runtime * 60 : null);
        refresh(); // re-reads dbMovie → poster now shows in the banner and grids
      } else {
        setPreview(hit);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbId, tvdbId, dbMovie?.name, dbMovie?.poster, name, routeYear]);

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
  const [interest, setInterest] = useState<number | null>(null);
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

  const rate = (i: number) =>
    requireWatched(() => {
      setStars(i);
      try {
        setMovieStars(currentDbName(), i + 1);
      } catch {}
    });
  const feel = (i: number) =>
    requireWatched(() => {
      setEmotions((prev) => {
        const next = new Set(prev);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        return next;
      });
      try {
        toggleMovieEmotion(currentDbName(), i);
      } catch {}
    });

  const goComments = () => router.push(`/comments?title=${encodeURIComponent(title)}`);
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
                <Ionicons name="chevron-down" size={26} color={colors.text} />
              </Pressable>
              <Pressable hitSlop={10} onPress={openMenu}>
                <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
              </Pressable>
            </View>
            <View style={styles.backdropMeta}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={2}>
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
                        style={[styles.interestBtn, interest === i && { backgroundColor: colors.yellow }]}
                        onPress={() => setInterest(interest === i ? null : i)}>
                        <Text style={[styles.interestText, interest === i && { color: colors.onYellow }]}>
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
                <View style={styles.rateBox}>
                  {STARS.map((lblKey, i) => (
                    <Pressable key={lblKey} style={{ alignItems: 'center', gap: 4 }} onPress={() => rate(i)}>
                      <Text style={{ fontSize: 30, color: stars != null && i <= stars ? colors.yellow : '#9A9A9F' }}>★</Text>
                      <Text style={styles.starLabel}>{t(lblKey)}</Text>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.divider} />
                <Text style={styles.pollLabel}>{t('media.howDidYouFeelPoll')}</Text>
                <View style={styles.emoGrid}>
                  {EMOTIONS.map((e, i) => (
                    <Pressable
                      key={e.label}
                      style={[styles.emo, emotions.has(i) && { backgroundColor: colors.yellow }]}
                      onPress={() => feel(i)}>
                      <Text style={{ fontSize: 24 }}>{e.face}</Text>
                      <Text style={[styles.emoLabel, emotions.has(i) && { color: colors.onYellow }]}>{t(e.label)}</Text>
                    </Pressable>
                  ))}
                </View>

                {!!mm?.cast?.length && (
                  <>
                    <View style={styles.divider} />
                    <Text style={styles.pollLabel}>{t('media.whoWasFavoritePoll')}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: space.lg }}>
                      {mm.cast.map((c, i) => (
                        <View key={`${c.name}-${i}`} style={{ width: 96, alignItems: 'center' }}>
                          <View style={styles.charCard}>
                            {c.photo ? (
                              <Image source={{ uri: c.photo }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                            ) : (
                              <Ionicons name="person" size={30} color="#B9B9C0" />
                            )}
                          </View>
                          <Text style={styles.charName} numberOfLines={1}>
                            {(c.character ?? c.name ?? '').toUpperCase()}
                          </Text>
                        </View>
                      ))}
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
  backdrop: { backgroundColor: '#3A2E50', justifyContent: 'space-between' },
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
  title: { color: colors.text, fontSize: 24, fontWeight: '800' },
  subtitle: { color: '#E3E3E8', fontSize: 14.5, marginTop: 4 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: space.lg,
    paddingVertical: 11,
  },
  metaText: { color: '#C9C9CF', fontSize: 14 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingBottom: 8,
  },
  h2: { color: colors.text, fontSize: 20, fontWeight: '800' },
  body: { color: '#E3E3E8', fontSize: 14.5, lineHeight: 20 },
  caption2: { color: colors.dim, fontSize: 13.5 },
  divider: { height: 1, backgroundColor: '#3A3A40', marginVertical: 16 },
  pollLabel: {
    color: '#C8C8CD',
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 1.2,
    textAlign: 'center',
    marginBottom: 13,
  },
  interestBtn: {
    backgroundColor: '#1C1C1F',
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
    backgroundColor: '#232325',
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
    backgroundColor: '#242427',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 8,
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '78%',
    alignSelf: 'center',
  },
  starLabel: { color: '#D5D5DA', fontSize: 9.5, fontWeight: '700', letterSpacing: 0.5 },
  emoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  emo: {
    width: '22%',
    backgroundColor: '#1F1F21',
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
    backgroundColor: '#232326',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  castName: { color: colors.text, fontSize: 12.5, marginTop: 6 },
  charName: { color: colors.dim, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6, marginTop: 3 },
  trailerRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: space.lg },
  trailerThumb: {
    width: 118,
    height: 66,
    borderRadius: 8,
    backgroundColor: '#232326',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailerPlay: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: '#FFF',
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
