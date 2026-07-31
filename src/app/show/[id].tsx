import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated as RNAnimated, Easing as RNEasing, FlatList, I18nManager, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { GestureType } from 'react-native-gesture-handler';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, {
  CurvedTransition,
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Image } from 'expo-image';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { useSwipeDown } from '@/components/swipe-down';
import { CheckCircle, ContentColumn, TopTabs, useDetailPaneStyle, useDetailWidth } from '@/components/ui';
import seed from '@/seed';
import db, { addShow, deleteShow, getMeta, getSeasonEpisodes, getSeasons, getWatchedSet, markWatched, setFollowing, setShowArchived, setShowFavorited, setShowFinished, unmarkWatched } from '@/db';
import { tapSelection } from '@/haptics';
import { markWatchedWithPrompt } from '@/mark';
import { absoluteEpisode, episodeMeta, seasonTotal, showMeta, statusLabel, tvdbIdForTmdb } from '@/metadata';
import { airCountdown, communityScore } from '@/pure';
import { readSeasonAggregates, useSeasonAggregates } from '@/community-ratings';
import { useJoined } from '@/community-session';
import { airedTotalOf } from '@/show-status';
import { fetchShowMeta } from '@/show-meta-fetch';
import { colors, radius, space } from '@/theme';
import { currentLocale, t } from '@/i18n';

const TABS = ['About', 'Episodes'] as const;

const INTERESTS = [
  'media.interests.cast',
  'media.interests.premise',
  'media.interests.creators',
  'show.interests.network',
  'media.interests.franchise',
  'media.interests.other',
] as const;

function countLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// carousel geometry, derived per render from the live window width so an iPad
// rotation re-lays the cards out instead of keeping the import-time width.
// The Episodes tab is a list of rows/bands, not prose, so it runs full width
// (not ContentColumn-capped) — this sizes against the raw window width.
const cardWidth = (w: number) => Math.round(w * 0.7);
const cardSide = (w: number) => Math.round((w - cardWidth(w)) / 2);
// equal side insets so every card (first and last included) centers on screen

type CarItem =
  | { kind: 'ep'; season: number; episode: number; watched: boolean }
  | { kind: 'finished' };

function shortDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(currentLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ShowScreen() {
  // the pane's width when this screen sits beside the list, else the window's.
  // The carousel and the ratings chart both page against this, so measuring the
  // window instead would make every page wider than its own container.
  const W = useDetailWidth();
  // the community-ratings chart is a full-width band, not capped prose — it
  // sizes against the raw window width
  const CHART_W = W;
  const CARD_W = cardWidth(W);
  const CARD_SIDE = cardSide(W);
  const insets = useSafeAreaInsets();
  const { id, tmdbId } = useLocalSearchParams<{ id: string; tmdbId?: string }>();
  const tvdbId = Number(id);

  // metadata for shows outside the bundle arrives from TMDB at runtime
  const [metaState, setMetaState] = useState<'ready' | 'loading' | 'failed'>(() =>
    showMeta(tvdbId) != null ? 'ready' : 'loading',
  );
  useEffect(() => {
    // runs even when metadata exists: a stale entry refreshes in the
    // background (new seasons appear), a fresh one resolves instantly
    fetchShowMeta(tvdbId, tmdbId ? Number(tmdbId) : null).then((m) => setMetaState(m ? 'ready' : 'failed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the show itself: your library row first, seed as fallback, and for
  // untracked previews a stub built from the fetched metadata
  const dbShow = db.getFirstSync<{ tvdbId: number; name: string; episodesSeen: number; followed: number; favorited: number; archived: number; finished: number }>(
    'SELECT tvdbId, name, episodesSeen, followed, favorited, archived, finished FROM shows WHERE tvdbId = ?',
    [tvdbId],
  );
  // a show fix-matched to a different (current) TVDB id leaves a breadcrumb at
  // the old id — if we landed on that orphaned id, forward to the real one so
  // the page never shows "Add show" for a show that's actually tracked
  useEffect(() => {
    if (dbShow) return;
    const to = Number(getMeta(`showRemap:${tvdbId}`));
    if (Number.isFinite(to) && to > 0 && to !== tvdbId) router.replace(`/show/${to}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seedShow = seed.shows.find((s) => String(s.tvdbId) === id);
  const fetched = showMeta(tvdbId);
  const show =
    dbShow ??
    seedShow ??
    (fetched ? { tvdbId, name: fetched.name ?? '', episodesSeen: 0, followed: 0 } : undefined);
  const [tab, setTab] = useState<(typeof TABS)[number]>('About');
  // seasons stay open independently: opening one no longer closes the last,
  // so you can compare two seasons without losing your place
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  // cap how many episode rows render at once — a plain ScrollView can't
  // virtualize, so expanding a mega-season (Detective Conan = 1207 eps) would
  // otherwise mount thousands of rows and crash. Normal shows never hit it.
  //
  // PER SEASON, not shared: with several open, one "Show more" would otherwise
  // raise the cap on every open season at once and mount the very thousands of
  // rows this exists to prevent.
  const [epLimits, setEpLimits] = useState<Readonly<Record<number, number>>>({});
  const limitFor = (season: number) => epLimits[season] ?? 120;
  const [interest, setInterest] = useState<number | null>(null);
  // the ⋯ menu: null = closed. Built on open so it reads current follow /
  // favorite / finished state rather than a stale snapshot.
  const [menu, setMenu] = useState<SheetAction[] | null>(null);
  const [chartPage, setChartPage] = useState(0);

  // re-read the database whenever this screen regains focus (e.g. after
  // the Mark as… sheet changes a watch)
  const [tick, setTick] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setTick((t) => t + 1);
      // Fix match may have fetched + cached the metadata behind this screen
      if (showMeta(tvdbId)) setMetaState((s) => (s === 'failed' ? 'ready' : s));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // every season from metadata (incl. never-started ones) merged with your
  // watched counts from the database
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const seasons = useMemo(() => {
    if (!show) return [];
    const db = new Map(getSeasons(show.tvdbId).map((r) => [r.season, r.watched]));
    const m = showMeta(show.tvdbId);
    // numbered seasons ascending; Specials (season 0) always last, like TV Time
    const bySeason = (a: { season: number }, b: { season: number }) =>
      (a.season === 0 ? Number.MAX_SAFE_INTEGER : a.season) - (b.season === 0 ? Number.MAX_SAFE_INTEGER : b.season);
    if (!m) {
      return [...db.entries()].map(([season, watched]) => ({ season, watched })).sort(bySeason);
    }
    const nums = Object.keys(m.seasons)
      .map(Number)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    const list = nums.map((n) => ({ season: n, watched: db.get(n) ?? 0 }));
    for (const [sn, watched] of db) {
      if (sn !== 0 && !nums.includes(sn)) list.push({ season: sn, watched });
    }
    list.sort((a, b) => a.season - b.season);
    // shows that have specials get the row even before any special is watched
    if (m.seasons['0'] != null || db.has(0)) list.push({ season: 0, watched: db.get(0) ?? 0 });
    return list;
  }, [show, tick]);

  const { gesture, headerGesture, animatedStyle, onScroll, onScrollBeginDrag, onScrollSettled, setAtTop } = useSwipeDown();
  // on a wide screen this screen sits beside the list instead of covering it
  const paneStyle = useDetailPaneStyle();
  // the horizontal carousel is a native scroll view that grabs vertical drags
  // too and would cancel the drag-to-dismiss pan — let them recognize together;
  // the content scrolls also list the pan (via ref) as a simultaneous partner
  const panRef = useRef<GestureType | undefined>(undefined);
  // the "Continue tracking" carousel, so the jump-to-next-episode button can
  // scroll it back to where the user actually is
  const carouselRef = useRef<FlatList<CarItem>>(null);
  const carouselNative = useMemo(() => Gesture.Native(), []);
  const pan = useMemo(
    () => gesture.withRef(panRef).simultaneousWithExternalGesture(carouselNative),
    [gesture, carouselNative],
  );
  const meta = show ? showMeta(show.tvdbId) : undefined;
  // a user-chosen backdrop (Customize) wins over the metadata one; when there's
  // no backdrop at all (e.g. a TheTVDB-only show with just a poster) fall back
  // to the poster so the banner isn't a blank block
  const backdropUri =
    (show ? getMeta(`backdropOverride:${show.tvdbId}`) : null) ??
    meta?.backdrop ??
    meta?.poster ??
    (show ? getMeta(`posterOverride:${show.tvdbId}`) : null);

  const seen = Math.max(show?.episodesSeen ?? 0, seasons.reduce((n, s) => n + s.watched, 0));
  const isFinished = !!dbShow?.finished;
  const progress = isFinished ? 1 : meta?.totalEpisodes ? Math.min(seen / meta.totalEpisodes, 1) : Math.min(seen / 200, 1);

  // bar color = TV Time status: caught up + ended = purple, caught up +
  // running = green, otherwise yellow. a manual "finished" mark forces purple.
  const caughtUp = meta?.totalEpisodes != null && meta.totalEpisodes > 0 && seen >= meta.totalEpisodes;
  const barColor = isFinished ? colors.status.finished : caughtUp ? (meta?.inProduction ? colors.green : colors.status.finished) : colors.yellow;

  // "catch-up time": unwatched AIRED episodes × per-episode runtime
  const catchUpMins =
    show && meta?.runtime
      ? (() => {
          const aired = airedTotalOf(show.tvdbId);
          const left = aired ? aired - seen : 0;
          return left > 0 ? left * meta.runtime : null;
        })()
      : null;
  const catchUpText =
    catchUpMins == null
      ? null
      : catchUpMins < 60
        ? t('show.catchUpMinutes', { m: catchUpMins })
        : Math.round(catchUpMins / 60) < 24
          ? t('show.catchUpHours', { h: Math.round(catchUpMins / 60) })
          : t('show.catchUpDaysHours', { d: Math.floor(catchUpMins / 1440), h: Math.round(catchUpMins / 60) % 24 });

  // the bar fills from 0 to its value every time the show opens — the delay
  // lets the page's slide-in transition finish first so the fill is visible
  const barAnim = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    barAnim.setValue(0);
    RNAnimated.timing(barAnim, {
      toValue: progress,
      duration: 900,
      delay: 450,
      easing: RNEasing.out(RNEasing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, barAnim]);

  // Continue-tracking carousel: EVERY episode of the show, like the real app —
  // it opens on the next unwatched one and you can swipe back through all the
  // previous episodes to the very first; the "Finished" card closes the line
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const carousel = useMemo<CarItem[]>(() => {
    if (!show || !meta) return [];
    const watchedSet = getWatchedSet(show.tvdbId);
    const items: CarItem[] = [];
    for (const [sn, sm] of Object.entries(meta.seasons).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      const sNum = Number(sn);
      if (sNum === 0) continue;
      for (let e = 1; e <= sm.count; e++) {
        items.push({ kind: 'ep', season: sNum, episode: e, watched: watchedSet.has(`${sNum}-${e}`) });
      }
    }
    if (items.length) items.push({ kind: 'finished' });
    return items;
  }, [show, meta, tick]);
  // in-progress → open on the next unwatched episode;
  // completed → open directly on the "Finished" card
  const firstUnwatchedIdx = carousel.findIndex((i) => i.kind === 'ep' && !i.watched);
  const carouselStart = firstUnwatchedIdx === -1 ? Math.max(carousel.length - 1, 0) : firstUnwatchedIdx;

  // TMDB's per-episode scores (0–5 scale) by season — the fallback series for
  // the chart below, and what it drew from exclusively before the community
  // existed.
  const ratingSeasons = useMemo(() => {
    if (!meta) return [] as { season: number; ratings: number[] }[];
    const by = new Map<number, { ep: number; r: number }[]>();
    for (const [key, em] of Object.entries(meta.episodes)) {
      if (!em.rating) continue;
      const [s, e] = key.split('-').map(Number);
      if (s === 0) continue;
      if (!by.has(s)) by.set(s, []);
      by.get(s)!.push({ ep: e, r: em.rating });
    }
    return [...by.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([season, list]) => ({
        season,
        ratings: list.sort((a, b) => a.ep - b.ep).map((x) => x.r / 2),
      }));
  }, [meta]);

  /* ── the "Community ratings" chart ──────────────────────────────────────────
   *
   * design/referance/09-show-about-cast-ratings.png: one point per episode
   * across a season, a 0–5 axis, dots on a rule, page dots for the seasons.
   * The drawing was already here and is untouched; what changed is where the
   * numbers come from. It has always said "Community ratings" over TMDB's
   * scores, which are somebody else's community.
   *
   * The server's scale is 1–10 and the app's is five stars, so a score is
   * halved — the exact inverse of the `(starIndex + 1) * 2` the two vote
   * screens send.
   *
   * ONE REQUEST, FOR THE SEASON BEING LOOKED AT. `useSeasonAggregates` is a
   * hook and cannot be called per page; the other pages read the cache
   * synchronously, the way everything else in this app reads its state, so
   * swiping back to a season already visited is free and swiping to a new one
   * costs the single request its own page triggers.
   *
   * TMDB REMAINS THE FALLBACK, per season. A community weeks old has no votes
   * on almost any show yet, and replacing a chart that works today with an
   * empty space on every show but a handful would be a straight loss. The
   * section still disappears entirely when NEITHER source has anything.
   */
  const joined = useJoined();
  const chartSeasonNums = useMemo(() => {
    const fromTmdb = ratingSeasons.map((r) => r.season);
    if (fromTmdb.length > 0) return fromTmdb;
    // no TMDB scores at all: the community may still have votes, so offer the
    // show's own seasons rather than nothing. Specials are excluded here for
    // the same reason they are above — season 0 is not a point on this line.
    return seasons.filter((s) => s.season !== 0).map((s) => s.season);
  }, [ratingSeasons, seasons]);

  const activeSeason = chartSeasonNums[Math.min(chartPage, Math.max(chartSeasonNums.length - 1, 0))] ?? 1;
  // the id alone, not the row: `show` is rebuilt on every render, and a memo
  // that depends on it is a memo that never holds
  const chartTvdbId = show?.tvdbId;
  const activeAgg = useSeasonAggregates(chartTvdbId, activeSeason);

  const ratingSeasonsShown = useMemo(() => {
    /**
     * The community's line for one season, plus how many people it speaks for.
     *
     * THE VOTE COUNT IS RETURNED, not just the scores, because the heading has
     * to say whose numbers these are. A chart titled "Community ratings" that
     * silently fell back to TMDB was telling the reader that strangers on
     * OpenTV had rated a show nobody here has opened — and it is the reason
     * this screen looked like it had no community on it at all.
     */
    const communityFor = (season: number): { ratings: number[]; votes: number } => {
      if (!joined || chartTvdbId == null) return { ratings: [], votes: 0 };
      const agg = season === activeSeason ? activeAgg : readSeasonAggregates(chartTvdbId, season);
      const rows = Object.values(agg)
        .filter((a) => a.vote_count > 0)
        .sort((a, b) => a.episode - b.episode);
      return {
        ratings: rows.map((a) => {
          const s = communityScore(a.vote_count, a.score_sum);
          // clamped, not trusted: a rollup mid-repair can hold a sum that no
          // longer matches its count, and a point off the axis draws off-screen
          return Math.max(0, Math.min(5, (s ?? 0) / 2));
        }),
        votes: rows.reduce((n, a) => n + a.vote_count, 0),
      };
    };
    return chartSeasonNums
      .map((season) => {
        const community = communityFor(season);
        if (community.ratings.length > 0) {
          const avg = community.ratings.reduce((a, b) => a + b, 0) / community.ratings.length;
          return { season, ratings: community.ratings, community: true, votes: community.votes, avg };
        }
        const tmdb = ratingSeasons.find((r) => r.season === season)?.ratings ?? [];
        return { season, ratings: tmdb, community: false, votes: 0, avg: 0 };
      })
      .filter((s) => s.ratings.length > 0);
  }, [chartSeasonNums, ratingSeasons, joined, chartTvdbId, activeSeason, activeAgg]);

  // "people also watched" links back into your library where possible
  const trackedSet = useMemo(() => new Set(seed.shows.map((s) => s.tvdbId)), []);

  // TV Time's collapsing banner: scrolling shrinks it to a compact title bar,
  // freeing the screen for the seasons — like the profile cover
  const FULLH = insets.top + 180;
  const BARH = insets.top + 54;
  const COLLAPSE = 140;
  const scrollY = useSharedValue(0);
  const bannerStyle = useAnimatedStyle(() => ({
    height: interpolate(scrollY.value, [0, COLLAPSE], [FULLH, BARH], Extrapolation.CLAMP),
  }));
  const metaFade = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, COLLAPSE * 0.55], [1, 0], Extrapolation.CLAMP),
  }));
  const barTitleFade = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [COLLAPSE * 0.5, COLLAPSE], [0, 1], Extrapolation.CLAMP),
  }));
  /** the settled variants keep the same extra bookkeeping onContentScroll does */
  const onContentScrollSettled = (e: Parameters<typeof onScroll>[0]) => {
    onContentScroll(e);
    onScrollSettled(e);
  };

  const onContentScroll = (e: Parameters<typeof onScroll>[0]) => {
    scrollY.value = e.nativeEvent.contentOffset.y;
    onScroll(e);
  };

  if (!show) {
    // untracked show, metadata still on its way from TMDB (or unreachable)
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        {metaState === 'failed' ? (
          <>
            <Text style={{ fontSize: 34 }}>📡</Text>
            <Text style={{ color: colors.dim, fontSize: 14.5, textAlign: 'center', paddingHorizontal: 40 }}>
              {t('show.loadFailed')}
            </Text>
            <Pressable onPress={() => setMetaState('loading')} hitSlop={10}>
              <Text style={{ color: colors.blue, fontSize: 15, fontWeight: '600' }}>{t('show.retry')}</Text>
            </Pressable>
          </>
        ) : (
          <RNAnimated.View>
            <Text style={{ color: colors.dim, fontSize: 14.5 }}>{t('show.loading')}</Text>
          </RNAnimated.View>
        )}
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ position: 'absolute', top: insets.top + 8, start: 16 }}>
          <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={26} color={colors.text} />
        </Pressable>
      </View>
    );
  }

  return (
    <GestureDetector gesture={pan}>
    <Animated.View style={[{ flex: 1, backgroundColor: colors.bg }, animatedStyle, paneStyle]}>
      {/* full-bleed backdrop behind the status bar, like the real app —
          it never scrolls, so dragging it down always dismisses; scrolling the
          content collapses it to a compact title bar */}
      <GestureDetector gesture={headerGesture}>
      <Animated.View style={[styles.backdrop, bannerStyle]}>
        {backdropUri && (
          <>
            <Image source={{ uri: backdropUri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
          </>
        )}
        <View style={[styles.backdropBar, { marginTop: insets.top + 4 }]}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-down" size={26} color={colors.text} />
          </Pressable>
          <Animated.Text style={[styles.barTitle, barTitleFade]} numberOfLines={1}>
            {show.name}
          </Animated.Text>
          <Pressable
            hitSlop={10}
            onPress={() => {
              const following = !!dbShow?.followed;
              const favorited = !!dbShow?.favorited;
              const archived = !!dbShow?.archived;
              const finished = !!dbShow?.finished;
              const refresh = () => setTick((t) => t + 1);
              const actions: SheetAction[] = [
                {
                  icon: favorited ? 'heart-dislike-outline' : 'heart-outline',
                  text: favorited ? t('media.actions.removeFavorite') : t('media.actions.addFavorite'),
                  onPress: () => {
                    setShowFavorited(show.tvdbId, !favorited);
                    refresh();
                  },
                },
                {
                  icon: following ? 'eye-off-outline' : 'eye-outline',
                  text: following ? t('show.actions.stopFollowing') : t('show.actions.follow'),
                  onPress: () => {
                    setFollowing(show.tvdbId, !following);
                    refresh();
                  },
                },
                {
                  icon: archived ? 'play-circle-outline' : 'pause-circle-outline',
                  text: archived ? t('show.actions.resumeWatching') : t('show.actions.stopWatching'),
                  onPress: () => {
                    setShowArchived(show.tvdbId, !archived);
                    refresh();
                  },
                },
                {
                  icon: finished ? 'refresh-outline' : 'checkmark-done-outline',
                  text: finished ? t('show.actions.markNotFinished') : t('show.actions.markFinished'),
                  onPress: () => {
                    if (!finished) {
                      // mark every aired, non-special episode watched (same rule
                      // as the "mark all" checkmark) so "finished" actually
                      // completes the show — specials stay optional, like TV Time
                      const m = showMeta(show.tvdbId);
                      if (m) {
                        const today = new Date().toISOString().slice(0, 10);
                        const seen = getWatchedSet(show.tvdbId);
                        for (const [sn, sv] of Object.entries(m.seasons)) {
                          const s = Number(sn);
                          if (s < 1) continue;
                          for (let e = 1; e <= (sv?.count ?? 0); e++) {
                            const air = m.episodes[`${s}-${e}`]?.air;
                            if ((!air || air <= today) && !seen.has(`${s}-${e}`)) markWatched(show.tvdbId, s, e);
                          }
                        }
                      }
                    }
                    // flag it too, so returning shows / off-TMDB shows (nothing
                    // to mark) still read as complete
                    setShowFinished(show.tvdbId, !finished);
                    refresh();
                  },
                },
                {
                  icon: 'create-outline',
                  text: t('show.actions.customizePosterBackdrop'),
                  onPress: () =>
                    router.push(
                      `/poster-picker?tvdbId=${show.tvdbId}&tmdbId=${meta?.tmdbId ?? ''}&name=${encodeURIComponent(show.name)}`,
                    ),
                },
                {
                  icon: 'list-outline',
                  text: t('media.actions.addToList'),
                  onPress: () => router.push(`/add-to-list?type=show&id=${show.tvdbId}`),
                },
                {
                  icon: 'share-outline',
                  text: t('media.actions.share'),
                  onPress: () => router.push(`/share-card?type=show&id=${show.tvdbId}`),
                },
                // the banner only appears while unmatched; re-matching an
                // already-matched show belongs here, not in a standing bar
                {
                  icon: 'link-outline',
                  text: t('media.actions.changeMatch'),
                  onPress: () =>
                    router.push(`/fix-match?type=show&id=${tvdbId}&name=${encodeURIComponent(show.name)}`),
                },
                {
                  icon: 'trash-outline',
                  text: t('media.actions.removeFromLibrary'),
                  destructive: true,
                  onPress: () =>
                    Alert.alert(
                      t('media.removeConfirmTitle', { title: show.name }),
                      t('show.removeConfirmBody'),
                      [
                        {
                          text: t('common.remove'),
                          style: 'destructive',
                          onPress: () => {
                            deleteShow(show.tvdbId);
                            router.back();
                          },
                        },
                        { text: t('common.cancel'), style: 'cancel' },
                      ],
                    ),
                },
              ];
              setMenu(actions);
            }}>
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
          </Pressable>
        </View>
        <Animated.View style={[styles.backdropMeta, metaFade]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={2}>
              {show.name}
            </Text>
            <Text style={styles.meta}>
              {meta
                ? // the season count is absent until TheTVDB structure lands —
                  // the bundled metadata carries enrichment only since 1.2.0 —
                  // so omit that clause rather than printing "undefined seasons"
                  [
                    typeof meta.totalSeasons === 'number' && meta.totalSeasons > 0
                      ? t('show.seasonsCount', { count: meta.totalSeasons })
                      : null,
                    statusLabel(meta),
                    meta.network ?? '—',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : `${t('show.episodesWatchedCount', { count: show.episodesSeen })} · ${show.followed ? t('show.following') : t('show.notFollowing')}`}
            </Text>
            {/* the episode list is only ever TMDB-shaped when TheTVDB couldn't
                be reached — say so, because the numbering may not line up with
                what was imported */}
            {meta?.structureSource === 'tmdb' && (
              <Text style={styles.metaSourceNote}>{t('show.tmdbStructureNote')}</Text>
            )}
          </View>
          {/* always rendered so favoriting never reflows/squeezes the title */}
          <View style={[styles.favBadge, !dbShow?.favorited && { opacity: 0 }]}>
            <Ionicons name="heart" size={20} color="#fff" />
          </View>
          <View style={styles.match}>
            <View style={styles.tBadgeSm}>
              <Text style={{ fontWeight: '800', color: colors.onYellow, fontSize: 12 }}>T</Text>
            </View>
            <Text style={{ color: colors.yellow, fontWeight: '800', fontSize: 15 }}>99%</Text>
          </View>
        </Animated.View>
      </Animated.View>
      </GestureDetector>
      {/* status-colored watched-progress line, animated on open */}
      <View style={[styles.progressTrack, { backgroundColor: barColor + '40' }]}>
        <RNAnimated.View
          style={[
            styles.progressFill,
            {
              backgroundColor: barColor,
              width: barAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            },
          ]}
        />
      </View>
      {/* only while the show is genuinely unmatched — see the movie screen */}
      {dbShow && metaState === 'failed' && meta?.tmdbId !== 0 && (
        <Pressable
          style={styles.fixMatch}
          onPress={() => router.push(`/fix-match?type=show&id=${tvdbId}&name=${encodeURIComponent(show.name)}`)}>
          <Ionicons name="link-outline" size={20} color={colors.onYellow} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={styles.fixMatchTitle}>{t('show.fixMatchTitle')}</Text>
            <Text style={styles.fixMatchSub}>{t('show.fixMatchSub')}</Text>
          </View>
          <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.onYellow} />
        </Pressable>
      )}

      {/* a fresh tab's scroll view starts at the top but fires no scroll
          event, so re-arm the drag-to-dismiss on every switch */}
      <TopTabs
        tabs={TABS}
        labels={{ About: t('show.tabs.about'), Episodes: t('show.tabs.episodes') }}
        active={tab}
        onChange={(t) => {
          setTab(t);
          setAtTop(true);
          scrollY.value = 0;
        }}
      />

      {tab === 'About' ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24, paddingTop: 12 }}
          simultaneousHandlers={panRef}
          onScroll={onContentScroll}
          onScrollBeginDrag={onScrollBeginDrag}
          onScrollEndDrag={onContentScrollSettled}
          onMomentumScrollEnd={onContentScrollSettled}
          scrollEventThrottle={16}
          bounces>
          <View style={styles.rowBetween}>
            <Text style={styles.h2}>{t('media.whereToWatch')}</Text>
          </View>
          <View style={styles.providers}>
            {(meta?.providers ?? []).map((p, i) => (
              <View key={p.name ?? i} style={[styles.provider, i === 0 ? { backgroundColor: '#F47521' } : styles.providerDark]}>
                <Ionicons name="play-circle-outline" size={20} color="#FFF" />
                <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 13, letterSpacing: 0.5 }}>
                  {(p.name ?? '').toUpperCase()}
                </Text>
              </View>
            ))}
            {!meta?.providers?.length && <Text style={styles.caption2}>{t('show.providersUnavailable')}</Text>}
          </View>

          {/* interests poll, like the real app (kept on-device) */}
          <View style={styles.divider} />
          <Text style={styles.pollLabel}>{t('show.interestsPollLabel')}</Text>
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

          {meta?.similar?.[0] && (
            <>
              <View style={[styles.divider, { marginTop: 18 }]} />
              <Pressable
                style={styles.similarRow}
                onPress={() => {
                  const tvdb = tvdbIdForTmdb(meta.similar![0].tmdbId);
                  if (tvdb) router.push(`/show/${tvdb}`);
                }}>
                <View style={styles.similarThumb}>
                  {meta.similar[0].poster && (
                    <Image source={{ uri: meta.similar[0].poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.h2}>{t('show.similarTo')}</Text>
                  <Text style={[styles.caption2, { marginTop: 2, fontSize: 15 }]}>{meta.similar[0].name}</Text>
                </View>
              </Pressable>
            </>
          )}

          <View style={styles.divider} />
          <Text style={[styles.h2, { paddingHorizontal: space.lg }]}>{t('show.showInfoTitle')}</Text>
          <Text style={styles.caption}>
            {meta
              ? `${meta.year ?? '—'}${meta.endYear && meta.endYear !== meta.year ? ` - ${meta.endYear}` : ''} · ${meta.genres.join(', ') || '—'}`
              : t('show.metadataUnavailable')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.lg, marginTop: 8 }}>
            <View style={styles.tBadge}>
              <Text style={{ fontWeight: '800', color: colors.onYellow, fontSize: 13 }}>T</Text>
            </View>
            <Text style={{ color: colors.yellow, letterSpacing: 2 }}>★★★★★</Text>
            <Text style={styles.caption2}>{meta?.rating ? `${(meta.rating / 2).toFixed(1)}/5` : '—/5'}</Text>
          </View>
          {/* the only prose paragraph on this screen — capped so a 1366pt iPad
              doesn't render the overview as one enormous line; everything
              else on this tab is a row/band and runs full width */}
          <ContentColumn>
            <Text style={[styles.body, { paddingHorizontal: space.lg, marginTop: 10 }]}>
              {meta?.overview ?? t('show.progressSeen', { count: show.episodesSeen })}
            </Text>
          </ContentColumn>

          <View style={[styles.divider, { marginTop: 16, marginHorizontal: space.lg }]} />
          <View style={styles.factsRow}>
            <View style={styles.fact}>
              <Ionicons name="time-outline" size={22} color={colors.text} />
              <Text style={styles.factText}>
                {meta?.lastAir
                  ? new Date(`${meta.lastAir}T12:00:00`).toLocaleDateString(currentLocale(), { weekday: 'short' })
                  : '—'}
              </Text>
            </View>
            <View style={styles.fact}>
              <Ionicons name="stopwatch-outline" size={22} color={colors.text} />
              <Text style={styles.factText}>{meta?.runtime ? t('duration.minutesOnly', { m: meta.runtime }) : '—'}</Text>
            </View>
          </View>
          {meta?.votes != null && meta.votes > 0 && (
            <View style={[styles.fact, { paddingHorizontal: space.lg, marginTop: 10 }]}>
              <Ionicons name="people-outline" size={22} color={colors.text} />
              <Text style={styles.factText}>{t('show.addedCount', { count: countLabel(meta.votes) })}</Text>
            </View>
          )}

          {!!meta?.cast?.length && (
            <>
              <View style={[styles.divider, { marginTop: 18 }]} />
              <Text style={[styles.h2, { paddingHorizontal: space.lg, marginBottom: 12 }]}>{t('media.castTitle')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, gap: 10 }}>
                {meta.cast.map((c, i) => (
                  <View key={`${c.name}-${i}`} style={styles.castCard}>
                    <View style={styles.castPhoto}>
                      {c.photo ? (
                        <Image source={{ uri: c.photo }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                      ) : (
                        <Ionicons name="person" size={34} color="#5A5A60" />
                      )}
                    </View>
                    <Text style={styles.castName} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={styles.castChar} numberOfLines={1}>
                      {(c.character ?? '').replace(/\s*\(voice\)$/i, '').toUpperCase()}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </>
          )}

          {!!meta?.similar?.length && (
            <>
              <View style={[styles.divider, { marginTop: 18 }]} />
              <Text style={[styles.h2, { paddingHorizontal: space.lg, marginBottom: 12 }]}>{t('show.peopleAlsoWatched')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, gap: 10 }}>
                {meta.similar.map((sim) => {
                  const tvdb = tvdbIdForTmdb(sim.tmdbId);
                  const tracked = tvdb != null && trackedSet.has(tvdb);
                  return (
                    <Pressable
                      key={sim.tmdbId}
                      style={styles.alsoCard}
                      onPress={() => tvdb && router.push(`/show/${tvdb}`)}>
                      {sim.poster && (
                        <Image source={{ uri: sim.poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                      )}
                      <View style={[styles.alsoBadge, !tracked && { backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1.5, borderColor: colors.yellow }]}>
                        <Ionicons name={tracked ? 'checkmark' : 'add'} size={15} color={tracked ? colors.onYellow : colors.yellow} />
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}

          {ratingSeasonsShown.length > 0 && (
            <>
              <View style={[styles.divider, { marginTop: 18 }]} />
              {/* THE HEADING NAMES ITS SOURCE. Same chart, two possible sets
                  of numbers, and only one of them is this app's community —
                  saying "Community ratings" over TMDB's scores is a claim
                  about people who have not voted. */}
              {(() => {
                const shown = ratingSeasonsShown[Math.min(chartPage, ratingSeasonsShown.length - 1)];
                if (!shown) return null;
                return (
                  <>
                    <View style={styles.rowBetween}>
                      <Text style={styles.h2}>
                        {t(shown.community ? 'show.communityRatings' : 'show.tmdbRatings')}
                      </Text>
                      <Text style={styles.caption2}>{t('show.season', { n: shown.season })}</Text>
                    </View>
                    {shown.community && (
                      <Text style={[styles.caption2, { paddingHorizontal: space.lg, marginTop: 2 }]}>
                        {t('show.communityVotes', { avg: shown.avg.toFixed(1), count: shown.votes })}
                      </Text>
                    )}
                  </>
                );
              })()}
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(e) => setChartPage(Math.round(e.nativeEvent.contentOffset.x / (CHART_W - 2 * space.lg)))}
                style={{ marginHorizontal: space.lg }}>
                {ratingSeasonsShown.map((rs) => {
                  const plotW = CHART_W - 2 * space.lg - 34;
                  const pts = rs.ratings.map((r, i) => ({
                    x: 26 + (rs.ratings.length > 1 ? (i / (rs.ratings.length - 1)) * plotW : plotW / 2),
                    y: (1 - r / 5) * 132,
                  }));
                  return (
                    <View key={rs.season} style={{ width: CHART_W - 2 * space.lg, height: 150 }}>
                      {[5, 4, 3, 2, 1, 0].map((v) => (
                        <View key={v} style={[styles.chartLine, { top: ((5 - v) / 5) * 132 }]}>
                          <Text style={styles.chartAxis}>{v}</Text>
                          <View style={styles.chartRule} />
                        </View>
                      ))}
                      {/* the line connecting the episode dots */}
                      {pts.slice(1).map((p, i) => {
                        const q = pts[i];
                        const len = Math.hypot(p.x - q.x, p.y - q.y);
                        const ang = Math.atan2(p.y - q.y, p.x - q.x);
                        return (
                          <View
                            key={`seg${i}`}
                            style={{
                              position: 'absolute',
                              left: (q.x + p.x) / 2 - len / 2,
                              top: (q.y + p.y) / 2 - 0.75,
                              width: len,
                              height: 1.5,
                              backgroundColor: '#77777D',
                              transform: [{ rotate: `${ang}rad` }],
                            }}
                          />
                        );
                      })}
                      {pts.map((p, i) => {
                        const edge = i === 0 || i === pts.length - 1;
                        const size = edge ? 14 : 6;
                        return (
                          <View
                            key={i}
                            style={[
                              styles.chartDot,
                              { left: p.x - size / 2, top: p.y - size / 2 },
                              i === 0 && styles.chartDotStart,
                              i === pts.length - 1 && styles.chartDotEnd,
                            ]}>
                            {edge && <Text style={styles.chartDotGlyph}>{i === 0 ? '−' : '+'}</Text>}
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
              </ScrollView>
              {ratingSeasonsShown.length > 1 && (
                <View style={styles.chartDots}>
                  {ratingSeasonsShown.map((rs, i) => (
                    <View key={rs.season} style={[styles.pageDot, i === chartPage && { backgroundColor: colors.yellow }]} />
                  ))}
                </View>
              )}
            </>
          )}

          {/* ONE comments row, not two.
              This screen used to offer the archive AND the community thread as
              separate rows, one under the other, which asked the user to hold a
              distinction that is ours and not theirs: they are the same
              comments, and seeding is what moves the archive onto the server.

              No season or episode in the query: the server reads a missing
              season as -1 and matches the rows whose season IS NULL, which is
              this show's own thread rather than season zero. Readable without
              an account — joining is what buys the composer. Somebody who has
              NOT joined gets the archive instead, because they have no server
              and must not acquire one by tapping Comments. */}
          <View style={[styles.divider, { marginTop: 18 }]} />
          <Pressable
            style={styles.rowBetween}
            onPress={() => {
              tapSelection();
              if (joined) {
                router.push(`/thread?source=tvdb&key=${show.tvdbId}&title=${encodeURIComponent(show.name)}`);
              } else {
                router.push(`/comments?title=${encodeURIComponent(show.name)}`);
              }
            }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.h2}>{t('show.commentsTitle')}</Text>
              {joined && (
                <Text style={{ color: colors.dim, fontSize: 13, marginTop: 3 }}>
                  {t('community.comments.rowSub')}
                </Text>
              )}
            </View>
            <Text style={{ color: colors.dim, fontSize: 15 }}>›</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <ScrollView
          style={{ backgroundColor: '#1D1D1D' }}
          contentContainerStyle={{ paddingBottom: 24 }}
          simultaneousHandlers={panRef}
          onScroll={onContentScroll}
          onScrollBeginDrag={onScrollBeginDrag}
          onScrollEndDrag={onContentScrollSettled}
          onMomentumScrollEnd={onContentScrollSettled}
          scrollEventThrottle={16}
          bounces>
          {/* Episodes tab is grey with black cards, like the real app */}
          <View style={styles.trackPanel}>
          <View style={styles.rowBetween}>
            <Text style={styles.h2}>{t('show.continueTracking')}</Text>
            {/* jump the carousel back to the next episode to watch — handy after
                scrolling ahead to peek at later episodes without marking any */}
            <Pressable
              hitSlop={12}
              onPress={() => {
                if (!carousel.length) return;
                const target = Math.min(carouselStart, carousel.length - 1);
                try {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  void (require('expo-haptics') as typeof import('expo-haptics')).selectionAsync();
                } catch {
                  // haptics are best-effort
                }
                carouselRef.current?.scrollToIndex({ index: target, animated: true, viewPosition: 0 });
              }}>
              <Ionicons name="refresh" size={18} color={colors.dim} />
            </Pressable>
          </View>
          {catchUpText && (
            <Text style={{ color: colors.dim, fontSize: 13, marginTop: 2, marginBottom: 6, paddingHorizontal: space.lg }}>
              {catchUpText}
            </Text>
          )}
          <GestureDetector gesture={carouselNative}>
          <FlatList
            ref={carouselRef}
            style={{ width: '100%' }}
            horizontal
            data={carousel}
            keyExtractor={(it) => (it.kind === 'ep' ? `${it.season}-${it.episode}` : 'finished')}
            showsHorizontalScrollIndicator={false}
            snapToInterval={CARD_W + 10}
            snapToAlignment="start"
            disableIntervalMomentum
            decelerationRate="fast"
            initialScrollIndex={Math.min(carouselStart, Math.max(carousel.length - 1, 0))}
            getItemLayout={(_, i) => ({ length: CARD_W + 10, offset: (CARD_W + 10) * i, index: i })}
            onScrollToIndexFailed={(info) => {
              // getItemLayout should prevent this, but guard: scroll by offset
              carouselRef.current?.scrollToOffset({ offset: (CARD_W + 10) * info.index, animated: true });
            }}
            contentContainerStyle={{ paddingHorizontal: CARD_SIDE, gap: 10, paddingBottom: 18 }}
            renderItem={({ item }) => {
              if (item.kind === 'finished') {
                return (
                  <View style={[styles.carCard, { width: CARD_W, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }]}>
                    {backdropUri && (
                      <>
                        <Image source={{ uri: backdropUri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
                      </>
                    )}
                    <Text style={{ color: colors.yellow, fontSize: 22, fontWeight: '800' }}>{t('show.finishedCardTitle')}</Text>
                    <Text style={{ color: '#E3E3E8', fontSize: 14, marginTop: 2 }}>{t('show.finishedCardSub')}</Text>
                  </View>
                );
              }
              const em = episodeMeta(show.tvdbId, item.season, item.episode);
              return (
                <Pressable
                  style={[styles.carCard, { width: CARD_W }]}
                  onPress={() => router.push(`/episode/${show.tvdbId}-s${item.season}e${item.episode}`)}>
                  <View style={styles.carThumb}>
                    {em?.still ? (
                      <Image source={{ uri: em.still }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                    ) : (
                      <Text style={{ color: '#8B98AE', fontWeight: '800', fontSize: 13 }}>
                        E{String(item.episode).padStart(2, '0')}
                      </Text>
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 10 }}>
                    <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>
                      S{String(item.season).padStart(2, '0')} | E{String(item.episode).padStart(2, '0')}
                    </Text>
                    <Text style={{ color: '#C9C9CE', fontSize: 12 }} numberOfLines={2}>
                      {em?.title ?? t('show.episodeFallbackTitle', { n: item.episode })}
                    </Text>
                  </View>
                  <View style={{ paddingEnd: 10 }}>
                    <CheckCircle
                      size={36}
                      watched={item.watched}
                      onPress={() => {
                        if (item.watched) {
                          router.push(`/mark-as?show=${show.tvdbId}&s=${item.season}&e=${item.episode}`);
                        } else {
                          markWatchedWithPrompt(show.tvdbId, item.season, item.episode, () => setTick((t) => t + 1));
                        }
                      }}
                    />
                  </View>
                </Pressable>
              );
            }}
          />
          </GestureDetector>
          </View>

          {/* hairline separating the tracking block from All episodes */}
          <View style={styles.trackDivider} />

          <View style={[styles.rowBetween, { marginTop: 18, marginBottom: 8 }]}>
            <Text style={[styles.h2, { fontSize: 16 }]}>{t('show.allEpisodesTitle')}</Text>
            <Pressable
              hitSlop={10}
              onPress={() => {
                // mark/unmark the whole show — only verified aired episodes
                const m = showMeta(show.tvdbId);
                if (!m) return;
                const today = new Date().toISOString().slice(0, 10);
                const all: { s: number; e: number }[] = [];
                for (const [sn, sv] of Object.entries(m.seasons)) {
                  const s = Number(sn);
                  if (s < 1) continue;
                  for (let e = 1; e <= (sv?.count ?? 0); e++) {
                    const air = m.episodes[`${s}-${e}`]?.air;
                    if (!air || air <= today) all.push({ s, e });
                  }
                }
                if (all.length === 0) return;
                const seen = getWatchedSet(show.tvdbId);
                const missing = all.filter((x) => !seen.has(`${x.s}-${x.e}`));
                if (missing.length > 0) {
                  Alert.alert(t('show.markAllTitle', { title: show.name }), t('show.markAllBody', { count: missing.length }), [
                    {
                      text: t('show.markAll'),
                      onPress: () => {
                        for (const x of missing) markWatched(show.tvdbId, x.s, x.e);
                        setTick((t) => t + 1);
                      },
                    },
                    { text: t('common.cancel'), style: 'cancel' },
                  ]);
                } else {
                  Alert.alert(t('show.unmarkAllTitle', { title: show.name }), t('show.unmarkAllBody'), [
                    {
                      text: t('show.unmarkAll'),
                      style: 'destructive',
                      onPress: () => {
                        for (const x of all) unmarkWatched(show.tvdbId, x.s, x.e);
                        setTick((t) => t + 1);
                      },
                    },
                    { text: t('common.cancel'), style: 'cancel' },
                  ]);
                }
              }}>
              <Ionicons name="checkmark-circle-outline" size={22} color={colors.dim} />
            </Pressable>
          </View>
          {seasons.map((sr) => {
            const total = seasonTotal(show.tvdbId, sr.season);
            const complete = total != null && total > 0 && sr.watched >= total;
            const isOpen = expanded.has(sr.season);
            const epLimit = limitFor(sr.season);
            const watchedMap = isOpen
              ? new Map(getSeasonEpisodes(show.tvdbId, sr.season).map((e) => [e.episode, e]))
              : null;
            const epCount = total ?? (watchedMap ? Math.max(0, ...watchedMap.keys()) : 0);
            return (
              <Animated.View key={sr.season} layout={CurvedTransition.duration(260)}>
                <Pressable
                  style={styles.seasonCard}
                  onPress={() => {
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (isOpen) next.delete(sr.season);
                      else next.add(sr.season);
                      return next;
                    });
                    // reopening a season starts from the top of its list again
                    if (isOpen) setEpLimits((prev) => ({ ...prev, [sr.season]: 120 }));
                  }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={styles.seasonName}>{sr.season === 0 ? t('show.specials') : t('show.season', { n: sr.season })}</Text>
                    <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.text} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Text style={styles.seasonCount}>
                      {sr.watched}/{total ?? '—'}
                    </Text>
                    <CheckCircle
                      size={36}
                      iconSize={18}
                      watched={complete || (total == null && sr.watched > 0)}
                      onPress={() => {
                        if (!total) return;
                        const label = sr.season === 0 ? t('show.specials') : t('show.season', { n: sr.season });
                        if (complete) {
                          Alert.alert(t('show.unmarkSeasonTitle', { label }), t('show.unmarkSeasonBody'), [
                            {
                              text: t('show.unmarkSeason'),
                              onPress: () => {
                                for (let e = 1; e <= total; e++) unmarkWatched(show.tvdbId, sr.season, e);
                                setTick((t) => t + 1);
                              },
                            },
                            { text: t('common.cancel'), style: 'cancel' },
                          ]);
                        } else {
                          Alert.alert(t('show.markSeasonTitle', { label }), t('show.markSeasonBody', { count: total - sr.watched }), [
                            {
                              text: t('show.markSeason'),
                              onPress: () => {
                                const seen = getWatchedSet(show.tvdbId);
                                for (let e = 1; e <= total; e++) {
                                  if (!seen.has(`${sr.season}-${e}`)) markWatched(show.tvdbId, sr.season, e);
                                }
                                setTick((t) => t + 1);
                              },
                            },
                            { text: t('common.cancel'), style: 'cancel' },
                          ]);
                        }
                      }}
                    />
                  </View>
                  <View
                    style={[
                      styles.seasonLine,
                      complete
                        ? { backgroundColor: colors.green }
                        : sr.watched > 0 && { backgroundColor: colors.yellow, width: total ? `${Math.min((sr.watched / total) * 100, 100)}%` : '50%' },
                    ]}
                  />
                </Pressable>
                {isOpen && watchedMap && (
                  <Animated.View entering={FadeIn.duration(200).delay(40)} exiting={FadeOut.duration(130)}>
                  {Array.from({ length: Math.min(epCount, epLimit) }, (_, i) => i + 1).map((epNum) => {
                    const w = watchedMap.get(epNum);
                    const em = episodeMeta(show.tvdbId, sr.season, epNum);
                    // overall number only where fans count that way (anime) and
                    // only when it differs — "(E05)" next to E05 is just noise
                    const absRaw = absoluteEpisode(show.tvdbId, sr.season, epNum);
                    const abs = absRaw != null && absRaw !== epNum && (meta?.genres ?? []).includes('Animation') ? absRaw : undefined;
                    // not out yet — TV Time shows the wait, not a checkbox you
                    // could tick by accident. Already-watched rows keep their
                    // control regardless (a date can be wrong; history isn't).
                    const soon = w ? null : airCountdown(em?.air, Date.now());
                    return (
                      <Pressable
                        key={epNum}
                        style={styles.epRow}
                        onPress={() => router.push(`/episode/${show.tvdbId}-s${sr.season}e${epNum}`)}>
                        <View style={styles.epThumb}>
                          {em?.still ? (
                            <Image source={{ uri: em.still }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                          ) : (
                            <Text style={{ color: 'rgba(255,255,255,.5)', fontWeight: '800', fontSize: 11 }}>
                              E{String(epNum).padStart(2, '0')}
                            </Text>
                          )}
                        </View>
                        <View style={{ flex: 1, paddingVertical: 13 }}>
                          <Text style={styles.epCode}>
                            S{String(sr.season).padStart(2, '0')} | E{String(epNum).padStart(2, '0')}
                            {abs != null ? ` (E${String(abs).padStart(2, '0')})` : ''}
                            {w?.rewatch ? `  ↻${(w.rewatches ?? 0) > 1 ? ` ${w.rewatches}` : ''}` : ''}
                          </Text>
                          <Text style={styles.epTitle} numberOfLines={2}>
                            {em?.title ?? t('show.episodeFallbackTitle', { n: epNum })}
                          </Text>
                          <Text style={[styles.epWatched, soon != null && styles.epUpcoming]}>
                            {w ? t('show.watchedOnDate', { date: shortDate(w.watchedAt) }) : em?.air ? shortDate(em.air) : ' '}
                          </Text>
                        </View>
                        {soon != null ? (
                          <View style={styles.epCountdown}>
                            <Text style={styles.epCountdownText} numberOfLines={2}>
                              {soon}
                            </Text>
                          </View>
                        ) : (
                          <CheckCircle
                            size={43}
                            iconSize={22}
                            watched={w != null}
                            onPress={() => {
                              if (w) {
                                router.push(`/mark-as?show=${show.tvdbId}&s=${sr.season}&e=${epNum}`);
                              } else {
                                markWatchedWithPrompt(show.tvdbId, sr.season, epNum, () => setTick((t) => t + 1));
                              }
                            }}
                          />
                        )}
                      </Pressable>
                    );
                  })}
                  {epCount > epLimit && (
                    <Pressable
                      onPress={() => setEpLimits((prev) => ({ ...prev, [sr.season]: epLimit + 200 }))}
                      style={{ paddingVertical: 14, alignItems: 'center' }}>
                      <Text style={{ color: colors.yellow, fontWeight: '800', fontSize: 13.5 }}>
                        {t('show.showMoreLeft', { count: epCount - epLimit })}
                      </Text>
                    </Pressable>
                  )}
                  </Animated.View>
                )}
              </Animated.View>
            );
          })}
          {seasons.length === 0 && (
            <Text style={[styles.caption, { textAlign: 'center', marginTop: 6 }]}>
              {t('show.noEpisodeData')}
            </Text>
          )}
        </ScrollView>
      )}
      {/* untracked preview: same yellow add bar as the movie page */}
      {!dbShow && (
        <Pressable
          style={[styles.addBar, { paddingBottom: insets.bottom + 14 }]}
          onPress={() => {
            addShow(tvdbId, fetched?.name ?? show.name, fetched?.poster ?? null);
            setTick((t) => t + 1);
          }}>
          <Ionicons name="add" size={22} color={colors.onYellow} />
          <Text style={styles.addBarText}>{t('show.addShowButton')}</Text>
        </Pressable>
      )}
      <ActionSheet
        visible={menu != null}
        title={show.name}
        actions={menu ?? []}
        onClose={() => setMenu(null)}
      />
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
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fixMatchTitle: { color: colors.onYellow, fontSize: 14.5, fontWeight: '800' },
  fixMatchSub: { color: colors.onYellow, fontSize: 12.5, opacity: 0.75 },
  backdrop: { backgroundColor: '#2A3550', justifyContent: 'space-between', overflow: 'hidden' },
  backdropBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
  },
  barTitle: {
    flex: 1,
    textAlign: 'center',
    paddingHorizontal: 10,
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  backdropMeta: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: space.lg,
    paddingBottom: 12,
    gap: 10,
  },
  favBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  match: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 4 },
  tBadgeSm: { backgroundColor: colors.yellow, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
  progressTrack: { height: 6, backgroundColor: '#57511F' },
  progressFill: { height: '100%', backgroundColor: colors.yellow },
  title: { color: colors.text, fontSize: 25, fontWeight: '800' },
  meta: { color: '#E3E3E8', fontSize: 14, marginTop: 3 },
  metaSourceNote: { color: colors.faint, fontSize: 12, marginTop: 3 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingBottom: 8,
  },
  h2: { color: colors.text, fontSize: 20, fontWeight: '800' },
  providers: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: space.lg, marginBottom: 14, alignItems: 'center' },
  provider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.pill,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  providerDark: { backgroundColor: 'transparent', paddingHorizontal: 8 },
  divider: { height: 1, backgroundColor: '#5B5B63', marginBottom: 14 },
  pollLabel: {
    color: colors.text,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 10,
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
  similarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: space.lg,
    marginBottom: 4,
  },
  similarThumb: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.raise,
    overflow: 'hidden',
  },
  factsRow: { flexDirection: 'row', gap: 48, paddingHorizontal: space.lg, marginTop: 14 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  factText: { color: colors.text, fontSize: 16 },
  castCard: { width: 118 },
  castPhoto: {
    width: 118,
    height: 130,
    borderRadius: 4,
    backgroundColor: '#232326',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  castName: { color: colors.text, fontSize: 14.5, marginTop: 7 },
  castChar: { color: colors.dim, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 },
  alsoCard: {
    width: 118,
    aspectRatio: 2 / 3,
    borderRadius: 4,
    backgroundColor: colors.raise,
    overflow: 'hidden',
  },
  alsoBadge: {
    position: 'absolute',
    top: 8,
    end: 8,
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartLine: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  chartAxis: { color: colors.dim, fontSize: 11, width: 14, textAlign: 'right' },
  chartRule: { flex: 1, height: 1, backgroundColor: '#2A2A2E' },
  chartDot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: '#B0B0B5' },
  chartDotStart: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#E4364C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartDotEnd: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#3FA845',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartDotGlyph: { color: '#FFF', fontSize: 9, fontWeight: '800', lineHeight: 11 },
  chartDots: { flexDirection: 'row', gap: 7, alignSelf: 'center', marginTop: 10 },
  pageDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4A4A4E' },
  caption: { color: colors.dim, fontSize: 13.5, paddingHorizontal: space.lg, marginTop: 4 },
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
  caption2: { color: colors.dim, fontSize: 13.5 },
  body: { color: '#E3E3E8', fontSize: 14.5, lineHeight: 20 },
  tBadge: { backgroundColor: colors.yellow, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 1 },
  statusCard: {
    marginHorizontal: space.lg,
    marginBottom: 18,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    alignItems: 'center',
    padding: 16,
  },
  seasonCard: {
    marginHorizontal: space.lg,
    marginBottom: 12,
    borderRadius: radius.card,
    backgroundColor: '#000000',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    overflow: 'hidden',
  },
  seasonName: { color: colors.text, fontSize: 18.5, fontWeight: '800' },
  seasonCount: { color: colors.dim, fontSize: 12, fontVariant: ['tabular-nums'] },
  seasonLine: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: colors.pillGrey },
  epRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0A0A0C',
    borderRadius: radius.card - 1,
    marginHorizontal: space.lg,
    marginBottom: 10,
    paddingEnd: 10,
    overflow: 'hidden',
  },
  // flush against the card's left/top/bottom edges — no inset
  epThumb: {
    width: 70,
    alignSelf: 'stretch',
    backgroundColor: colors.raise,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  trackPanel: { paddingTop: 18, paddingBottom: 10 },
  trackDivider: { height: 1, backgroundColor: '#3F3F42', marginTop: 2 },
  carCard: {
    height: 87,
    borderRadius: radius.card,
    backgroundColor: '#000000',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  carThumb: {
    width: 99,
    height: '100%',
    backgroundColor: colors.raise,
    alignItems: 'center',
    justifyContent: 'center',
  },
  epCode: { color: colors.text, fontSize: 18.5, fontWeight: '800' },
  epTitle: { color: '#C9C9CE', fontSize: 15.5, marginTop: 2 },
  epWatched: { color: colors.faint, fontSize: 14, marginTop: 2 },
  // an unaired episode reads as "waiting", not "unwatched" — yellow ACTS, so
  // the countdown stays dim; it is information, not something to tap
  epUpcoming: { color: colors.dim },
  epCountdown: { width: 74, alignItems: 'flex-end', justifyContent: 'center', paddingEnd: 2 },
  epCountdownText: { color: colors.dim, fontSize: 12.5, fontWeight: '700', textAlign: 'auto' },
});
