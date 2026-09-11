import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated as RNAnimated, Easing as RNEasing, FlatList, I18nManager, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { GestureType } from 'react-native-gesture-handler';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Image } from 'expo-image';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { useSwipeDown } from '@/components/swipe-down';
import { StatusBarOnCover } from '@/components/profile-template';
import { RatingsGrid } from '@/components/ratings-grid';
import { CheckCircle, ContentColumn, TopTabs, useDetailPaneStyle, useDetailWidth } from '@/components/ui';
import seed from '@/seed';
import db, { getShowRatings, getInterest, setInterest as saveInterest, addShow, deleteShow, getMeta, showWatchCount, trackedShowIds, getSeasonEpisodes, getSeasons, getWatchedSet, markWatched, setFollowing, setShowArchived, setShowFavorited, setShowFinished, unmarkWatched } from '@/db';
import { tapSelection } from '@/haptics';
import { markWatchedWithPrompt } from '@/mark';
import { showTvdbIdForTmdb } from '@/catalog';
import { absoluteEpisode, episodeMeta, seasonTotal, showMeta, statusLabel, tvdbIdForTmdb, type SimilarMeta, orderedEpisodes } from '@/metadata';
import { airCountdown, communityScore, ratingSeries } from '@/pure';
import { readSeasonAggregates, useSeasonAggregates } from '@/community-ratings';
import { useJoined } from '@/community-session';
import { airedTotalOf } from '@/show-status';
import { fetchShowMeta } from '@/show-meta-fetch';
import { appliedLight, colors, radius, space } from '@/theme';
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
  /*
   * READ ON FOCUS, NOT DURING RENDER. The React Compiler memoises render-time
   * calls against their arguments, so a `getInterest(...)` in the body would be
   * computed once and kept — including across the write below. State React sets
   * is the only invalidation that survives it.
   */
  useFocusEffect(
    useCallback(() => {
      setInterest(getInterest('show', tvdbId));
    }, [tvdbId]),
  );

  /*
   * THE RATING CHART'S DATA, HELD IN STATE RATHER THAN READ WHILE RENDERING.
   *
   * `getShowRatings(tvdbId)` takes only the show id, so the React Compiler is
   * free to memoise it against that id and never call it again — and a rating
   * is given on the EPISODE screen, so the number this chart draws would stay
   * whatever it was the first time the show was opened. Reading it in the
   * focus effect makes it state React itself set, which is the one form of
   * invalidation the compiler cannot fold away (see CLAUDE.md).
   */
  const [myRatings, setMyRatings] = useState<Map<number, { episode: number; value: number }[]>>(new Map());
  /*
   * THE GRID NEEDS THE WHOLE SHOW, not only the seasons with ratings in them:
   * a season you rated nothing of is a column of empty cells, and leaving it
   * out would quietly renumber every season to its right.
   */
  const [gridEpisodes, setGridEpisodes] = useState<{ season: number; episode: number }[]>([]);
  const [gridRatings, setGridRatings] = useState<Map<string, number>>(new Map());
  useFocusEffect(
    useCallback(() => {
      const flat = getShowRatings(tvdbId);
      const by = new Map<number, { episode: number; value: number }[]>();
      for (const [key, stars] of flat) {
        const [season, episode] = key.split('-').map(Number);
        if (!by.has(season)) by.set(season, []);
        by.get(season)!.push({ episode, value: stars });
      }
      setMyRatings(by);
      setGridRatings(flat);
      setGridEpisodes(orderedEpisodes(tvdbId));
    }, [tvdbId]),
  );

  const pickInterest = (i: number) => {
    const next = interest === i ? null : i;
    setInterest(next);
    saveInterest('show', tvdbId, next);
  };
  // the ⋯ menu: null = closed. Built on open so it reads current follow /
  // favorite / finished state rather than a stale snapshot.
  const [menu, setMenu] = useState<SheetAction[] | null>(null);
  const [chartPage, setChartPage] = useState(0);
  /**
   * WHICH POINT THE READER ASKED ABOUT.
   *
   * The one thing everybody hated about this chart in TV Time is that a dot
   * never told you which episode it was — you could see that something fell
   * apart and never find out what. Cleared on a season change, because a
   * readout naming an episode from the page you just left is worse than none.
   */
  const [picked, setPicked] = useState<{ season: number; episode: number } | null>(null);

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
  /*
   * THE BRAND, NOT THE ACCENT-AS-INK. `colors.yellow` turns black on paper so
   * that every filled CONTROL reads as black-on-white — right for a button and
   * wrong for a bar, which is a surface reporting a status. A black stripe
   * across a show's backdrop reads as damage rather than progress, and it
   * ignores the profile theme the rest of the page is painted in.
   */
  const barColor = isFinished
    ? colors.status.finished
    : caughtUp
      ? (meta?.inProduction ? colors.green : colors.status.finished)
      : colors.brand;

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
  /**
   * THE EPISODE NUMBER TRAVELS WITH THE SCORE, and it did not used to.
   *
   * The chart drew a bare `number[]` and let the array index stand for the
   * episode, which works right up until something else has to line up with it:
   * your own ratings are sparse — you rate four episodes out of eight — so
   * index 2 is your third RATING, not episode 3. Two lines drawn from arrays
   * like that are guaranteed to disagree about where they are, and the drawing
   * would look perfectly plausible while doing it.
   */
  const ratingSeasons = useMemo(() => {
    if (!meta) return [] as { season: number; points: { episode: number; value: number }[] }[];
    const by = new Map<number, { episode: number; value: number }[]>();
    for (const [key, em] of Object.entries(meta.episodes)) {
      if (!em.rating) continue;
      const [s, e] = key.split('-').map(Number);
      if (s === 0) continue;
      if (!by.has(s)) by.set(s, []);
      by.get(s)!.push({ episode: e, value: em.rating / 2 });
    }
    return [...by.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([season, list]) => ({ season, points: list.sort((a, b) => a.episode - b.episode) }));
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
    const communityFor = (season: number): { points: { episode: number; value: number }[]; votes: number } => {
      if (!joined || chartTvdbId == null) return { points: [], votes: 0 };
      const agg = season === activeSeason ? activeAgg : readSeasonAggregates(chartTvdbId, season);
      const rows = Object.values(agg)
        .filter((a) => a.vote_count > 0)
        .sort((a, b) => a.episode - b.episode);
      return {
        points: rows.map((a) => {
          const s = communityScore(a.vote_count, a.score_sum);
          // clamped, not trusted: a rollup mid-repair can hold a sum that no
          // longer matches its count, and a point off the axis draws off-screen
          return { episode: a.episode, value: Math.max(0, Math.min(5, (s ?? 0) / 2)) };
        }),
        votes: rows.reduce((n, a) => n + a.vote_count, 0),
      };
    };
    return chartSeasonNums
      .map((season) => {
        /*
         * YOUR OWN LINE, ALWAYS, whether or not anybody else has voted. It is
         * the only line most people will ever have: the community is small and
         * `EpisodeMeta.rating` is never populated, so a chart that needed one
         * of those two to exist showed nothing at all for nearly everybody.
         */
        const mine = (myRatings.get(season) ?? []).slice().sort((a, b) => a.episode - b.episode);
        const community = communityFor(season);
        if (community.points.length > 0) {
          const avg = community.points.reduce((a, b) => a + b.value, 0) / community.points.length;
          return { season, points: community.points, mine, community: true, votes: community.votes, avg };
        }
        const tmdb = ratingSeasons.find((r) => r.season === season)?.points ?? [];
        return { season, points: tmdb, mine, community: false, votes: 0, avg: 0 };
      })
      /*
       * EVERY SEASON IS A PAGE, even one nobody has voted on.
       *
       * This filtered empty seasons out, which on a real show meant the pager
       * had ONE page and no dots: Avatar has community votes on season one
       * only, so seasons two and three vanished and the chart looked stuck.
       * A season with nothing in it is a page that says so — which is an
       * answer — where a missing page is just a control that does not work.
       *
       * The SECTION still disappears when no season anywhere has anything;
       * that guard is at the render site.
       */
      ;
  }, [chartSeasonNums, ratingSeasons, joined, chartTvdbId, activeSeason, activeAgg, myRatings]);

  /**
   * WHAT IS ACTUALLY IN THE LIBRARY, read from the database and re-read on
   * focus.
   *
   * This was `seed.shows`, computed once at mount -- the BUNDLED seed, which
   * public builds ship EMPTY. So for every real user the set was empty: the
   * tick never lit for a show they genuinely tracked, never cleared when they
   * removed one, and reflected nothing but what had been added in that session.
   * Both halves of the bug reported on the first device test come from that one
   * line.
   */
  const [trackedSet, setTrackedSet] = useState<Set<number>>(trackedShowIds);
  useFocusEffect(
    useCallback(() => {
      setTrackedSet(trackedShowIds());
    }, []),
  );

  /**
   * OPENING AND ADDING A RECOMMENDATION.
   *
   * These cards used to resolve their TheTVDB id from a map built out of the
   * library, which cannot contain a show you do not track — so every tap in
   * the one section devoted to shows you do not track did nothing at all, and
   * the `+` was a drawing rather than a control. `showTvdbIdForTmdb` asks the
   * map first and TMDB second, so the id is found either way.
   *
   * Keyed by TMDB id in state rather than re-read from the database: the
   * library is loaded once on mount here, and a card that has just been added
   * has to say so immediately, on the same screen, without a refocus.
   */
  const [busySimilar, setBusySimilar] = useState<number | null>(null);
  /** TMDB id -> the TheTVDB id we resolved for it, so the tick can be answered
   *  from `trackedSet` without asking the network twice for the same card. */
  const [resolvedTvdb, setResolvedTvdb] = useState<Record<number, number>>({});

  const similarTvdbId = (sim: SimilarMeta): number | null =>
    resolvedTvdb[sim.tmdbId] ?? tvdbIdForTmdb(sim.tmdbId) ?? null;

  const isSimilarTracked = (sim: SimilarMeta): boolean => {
    const local = similarTvdbId(sim);
    return local != null && trackedSet.has(local);
  };

  const openSimilar = async (sim: SimilarMeta) => {
    if (busySimilar != null) return;
    setBusySimilar(sim.tmdbId);
    try {
      const tvdb = await showTvdbIdForTmdb(sim.tmdbId);
      // TheTVDB genuinely may not carry it — say so rather than absorb the tap
      // a second time, which is the bug this whole block replaces.
      if (tvdb) router.push(`/show/${tvdb}`);
      else Alert.alert(sim.name ?? '', t('show.notOnTvdb'));
    } finally {
      setBusySimilar(null);
    }
  };

  /**
   * The tick TOGGLES, and taking a show back out is not a silent delete.
   *
   * `deleteShow` drops the watches, the ratings, the emotions and the character
   * votes with it. That is right for undoing an add made ten seconds ago and
   * catastrophic for a show somebody has been watching for six years, and one
   * badge cannot tell those apart on its own -- so it asks the database how
   * much history is at stake and only confirms when there is any.
   */
  const toggleSimilar = async (sim: SimilarMeta) => {
    if (busySimilar != null) return;
    setBusySimilar(sim.tmdbId);
    try {
      const tvdb = await showTvdbIdForTmdb(sim.tmdbId);
      if (!tvdb) {
        Alert.alert(sim.name ?? '', t('show.notOnTvdb'));
        return;
      }
      setResolvedTvdb((prev) => ({ ...prev, [sim.tmdbId]: tvdb }));

      if (trackedSet.has(tvdb)) {
        const watched = showWatchCount(tvdb);
        if (watched > 0) {
          Alert.alert(sim.name ?? '', t('show.removeWithHistory', { count: watched }), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('show.removeAnyway'),
              style: 'destructive',
              onPress: () => {
                deleteShow(tvdb);
                tapSelection();
                setTrackedSet(trackedShowIds());
              },
            },
          ]);
          return;
        }
        deleteShow(tvdb);
        tapSelection();
        setTrackedSet(trackedShowIds());
        return;
      }

      addShow(tvdb, sim.name ?? '', sim.poster);
      tapSelection();
      setTrackedSet(trackedShowIds());
    } finally {
      setBusySimilar(null);
    }
  };

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
          {/* Absolutely positioned over the backdrop image — see `colors.onArt`. */}
          <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={26} color={colors.onArt} />
        </Pressable>
      </View>
    );
  }

  return (
    <GestureDetector gesture={pan}>
    <Animated.View style={[{ flex: 1, backgroundColor: colors.bg }, animatedStyle, paneStyle]}>
      {/* The backdrop runs under the status bar, so its glyphs follow the
          artwork rather than the page — dark-on-dark otherwise. */}
      <StatusBarOnCover />
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
            {/* In the bar that sits on the backdrop — see `colors.onArt`. */}
            <Ionicons name="chevron-down" size={26} color={colors.onArt} />
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
            {/* LONG TITLES SHRINK RATHER THAN TRUNCATE. Two lines at a fixed
                25pt cut "I Was Reincarnated as the 7th Prince…" down to four
                words while a short title rendered in full, which read as the
                app being careless with some shows and not others (reported
                with screenshots). Scaling down to 65% buys roughly half a line
                of characters again and costs nothing in layout — the header is
                still at most two lines, so nothing below it moves. */}
            <Text selectable style={styles.title} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.65}>
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
            {/* On the backdrop, beside the badge — so it takes `onArt`, which is
                white in both themes because only one colour is ever safe over
                an unknown image. */}
            <Text style={{ color: colors.onArt, fontWeight: '800', fontSize: 15 }}>99%</Text>
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
              style={[styles.interestBtn, interest === i && { backgroundColor: colors.brand }]}
              onPress={() => pickInterest(i)}>
              <Text style={[styles.interestText, interest === i && { color: colors.onBrand }]}>
                {t(labelKey).toUpperCase()}
              </Text>
            </Pressable>
          ))}

          {meta?.similar?.[0] && (
            <>
              <View style={[styles.divider, { marginTop: 18 }]} />
              <Pressable style={styles.similarRow} onPress={() => openSimilar(meta.similar![0]!)}>
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
                  // Pressable ONLY when there is an id to follow. Cast cached
                  // before `personId` existed has none, and a card that
                  // responds to a tap by doing nothing is the exact bug this
                  // replaces -- so those stay visibly flat until the one
                  // forced refetch fills them in.
                  <Pressable
                    key={`${c.name}-${i}`}
                    style={styles.castCard}
                    disabled={!c.personId}
                    onPress={() => {
                      const pid = c.personId;
                      if (pid) router.push(`/person/${pid}?name=${encodeURIComponent(c.name ?? '')}`);
                    }}>
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
                  </Pressable>
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
                  const tracked = isSimilarTracked(sim);
                  const busy = busySimilar === sim.tmdbId;
                  return (
                    <Pressable key={sim.tmdbId} style={styles.alsoCard} onPress={() => openSimilar(sim)}>
                      {sim.poster && (
                        <Image source={{ uri: sim.poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                      )}
                      {/* ITS OWN PRESSABLE, and a big enough one. This was a
                          View drawn over the poster: it looked like a control,
                          was reported as a broken control, and had never been
                          wired to anything. Adding is now what it does, and
                          the card underneath still opens the show. */}
                      <Pressable
                        hitSlop={8}
                        disabled={busy}
                        onPress={() => toggleSimilar(sim)}
                        style={[
                          styles.alsoBadge,
                          /* On a poster, behind a black scrim: ink here is an
                             invisible ring around an invisible glyph. */
                          !tracked && { backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1.5, borderColor: colors.onArt },
                        ]}>
                        <Ionicons
                          name={tracked ? 'checkmark' : busy ? 'ellipsis-horizontal' : 'add'}
                          size={15}
                          color={tracked ? colors.onYellow : colors.onArt}
                        />
                      </Pressable>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}

          {ratingSeasonsShown.some((r) => r.points.length > 0 || r.mine.length > 0) && (
            <>
              <View style={[styles.divider, { marginTop: 18 }]} />
              {/* BREATHING ROOM ABOVE THE HEADING. On a phone this sat directly
                  under the rail above it and read as part of it. */}
              <View style={{ height: 10 }} />
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
                /*
                 * THE HEADING FOLLOWS THE FINGER, not the end of the scroll.
                 *
                 * This only updated on `onMomentumScrollEnd`, so swiping from
                 * season one to season two drew season two's line under season
                 * one's heading and vote count until the scroll settled — and
                 * then snapped. It read as the chart loading the wrong season
                 * and correcting itself, which is worse than a slow chart.
                 *
                 * Throttled to four frames: this only picks a page NUMBER, and
                 * a page number cannot change more often than a page.
                 */
                scrollEventThrottle={64}
                onScroll={(e) => {
                  const page = Math.round(e.nativeEvent.contentOffset.x / (CHART_W - 2 * space.lg));
                  setChartPage((p) => {
                    if (p === page) return p;
                    setPicked(null);
                    return page;
                  });
                }}
                onMomentumScrollEnd={(e) => setChartPage(Math.round(e.nativeEvent.contentOffset.x / (CHART_W - 2 * space.lg)))}
                style={{ marginHorizontal: space.lg }}>
                {ratingSeasonsShown.map((rs) => {
                  const plotW = CHART_W - 2 * space.lg - 34;
                  /*
                   * ONE X AXIS FOR BOTH LINES: every episode number either line
                   * knows about, in order. Drawing each line against its own
                   * length would put your episode 3 and the community's episode
                   * 3 in different places — and it would look fine.
                   */
                  const axis = [...new Set([...rs.points, ...rs.mine].map((p) => p.episode))].sort(
                    (a, b) => a - b,
                  );
                  const xOf = (episode: number) => {
                    const i = axis.indexOf(episode);
                    return 26 + (axis.length > 1 ? (i / (axis.length - 1)) * plotW : plotW / 2);
                  };
                  const yOf = yFor;
                  const place = (list: { episode: number; value: number }[]) =>
                    list.map((p) => ({ ...p, x: xOf(p.episode), y: yOf(p.value) }));
                  const theirs = place(rs.points);
                  /*
                   * YOUR LINE BREAKS AT AN EPISODE YOU NEVER RATED rather than
                   * running through it — an unrated episode is silence, not a
                   * score, and a line drawn across it invents a rating you did
                   * not give. `ratingSeries` owns that rule and is tested.
                   */
                  const mineRuns = ratingSeries(
                    axis.map((episode) => ({ season: rs.season, episode })),
                    (_, episode) => rs.mine.find((m) => m.episode === episode)?.value ?? null,
                  ).runs.map((run) => place(run.map((p) => ({ episode: p.episode, value: p.value! }))));

                  const seg = (
                    a: { x: number; y: number },
                    b: { x: number; y: number },
                    key: string,
                    color: string,
                    thickness: number,
                  ) => {
                    const len = Math.hypot(b.x - a.x, b.y - a.y);
                    const ang = Math.atan2(b.y - a.y, b.x - a.x);
                    return (
                      <View
                        key={key}
                        style={{
                          position: 'absolute',
                          left: (a.x + b.x) / 2 - len / 2,
                          top: (a.y + b.y) / 2 - thickness / 2,
                          width: len,
                          height: thickness,
                          backgroundColor: color,
                          transform: [{ rotate: `${ang}rad` }],
                        }}
                      />
                    );
                  };

                  return (
                    <View key={rs.season} style={{ width: CHART_W - 2 * space.lg, height: 150 }}>
                      {[5, 4, 3, 2, 1, 0].map((v) => (
                        <View key={v} style={[styles.chartLine, { top: yFor(v) }]}>
                          <Text style={styles.chartAxis}>{v}</Text>
                          <View style={styles.chartRule} />
                        </View>
                      ))}
                      {/* everybody else, drawn first and quietly, so it reads as
                          the backdrop your own line sits against */}
                      {theirs.slice(1).map((p, i) => seg(theirs[i], p, `t${i}`, colors.dim, 1.5))}
                      {theirs.map((p, i) => (
                        <View key={`td${i}`} style={[styles.chartDot, { left: p.x - 3, top: p.y - 3 }]} />
                      ))}
                      {/*
                        * A TOUCH TARGET PER EPISODE, the full height of the
                        * plot and as wide as the spacing allows.
                        *
                        * The dots are six points across. Nobody can hit a dot,
                        * and a chart you cannot interrogate is the exact
                        * complaint this whole section exists to answer — so the
                        * target is the COLUMN, not the mark in it. Invisible,
                        * drawn under the marks, and at least 18 points wide so
                        * a long season is still reachable.
                        */}
                      <ScrubLayer axis={axis} season={rs.season} plotW={plotW} onPick={setPicked} />
                      {/* the picked column, marked so the readout below has an
                          anchor the eye can find */}
                      {picked?.season === rs.season && axis.includes(picked.episode) && (
                        <View
                          style={{
                            position: 'absolute',
                            left: xOf(picked.episode) - 1,
                            top: 0,
                            width: 2,
                            height: 132,
                            backgroundColor: 'rgba(255,255,255,0.22)',
                          }}
                        />
                      )}
                      {/* yours, in the colour that acts */}
                      {mineRuns.map((run, ri) =>
                        run.slice(1).map((p, i) => seg(run[i], p, `m${ri}-${i}`, colors.yellow, 2.5)),
                      )}
                      {mineRuns.map((run, ri) =>
                        run.map((p, i) => (
                          <View
                            key={`md${ri}-${i}`}
                            style={[
                              styles.chartDot,
                              { left: p.x - 4, top: p.y - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.yellow },
                            ]}
                          />
                        )),
                      )}
                      {/*
                        * THE SEASON'S HIGH AND LOW, MARKED ON THE LINE — the
                        * green + and red − from the original TV Time chart in
                        * design/referance/09-show-about-cast-ratings.png.
                        *
                        * On YOUR line when you rated the season, otherwise on
                        * everybody else's: the mark belongs to whichever line
                        * is actually drawn, and marking a line that is not
                        * there would point at nothing.
                        */}
                      {(() => {
                        const src = rs.mine.length > 1 ? rs.mine : rs.points;
                        if (src.length < 2) return null;
                        const sorted = src.slice().sort((a, b) => b.value - a.value || a.episode - b.episode);
                        const hi = sorted[0]!;
                        const lo = sorted[sorted.length - 1]!;
                        if (hi.episode === lo.episode) return null;
                        return ([
                          ['hi', hi, colors.green, '+'],
                          ['lo', lo, colors.danger, '−'],
                        ] as const).map(([k, p, colour, glyph]) => (
                          <View
                            key={k}
                            style={[
                              styles.chartEdge,
                              { left: xOf(p.episode) - 6, top: yOf(p.value) - 6, backgroundColor: colour },
                            ]}>
                            <Text style={styles.chartEdgeGlyph}>{glyph}</Text>
                          </View>
                        ));
                      })()}
                    </View>
                  );
                })}
              </ScrollView>
              {/*
                * WHAT THE READER JUST TAPPED, in words.
                *
                * The whole point of the touch columns above: a dot that cannot
                * name itself is a shape, not information. Tapping this opens
                * the episode, so the chart becomes a way INTO the show rather
                * than a picture of it. When nothing is picked the row is a
                * one-line hint instead, because an affordance nobody knows
                * about is not an affordance.
                */}
              {/*
                * A KEY, BECAUSE TWO LINES WITHOUT ONE IS A PUZZLE. Somebody
                * looking at their own flat line at five and the community's
                * line below it has no way to know which is which — and the
                * accent colour is themeable, so "the yellow one" is not even
                * true for everybody.
                */}
              {(() => {
                const shown = ratingSeasonsShown[Math.min(chartPage, ratingSeasonsShown.length - 1)];
                if (!shown || (shown.mine.length === 0 && shown.points.length === 0)) return null;
                return (
                  <View style={styles.chartKey}>
                    {shown.mine.length > 0 && (
                      <View style={styles.chartKeyItem}>
                        <View style={[styles.chartKeyDash, { backgroundColor: colors.yellow }]} />
                        <Text style={styles.chartKeyText}>{t('show.chartKeyYou')}</Text>
                      </View>
                    )}
                    {shown.points.length > 0 && (
                      <View style={styles.chartKeyItem}>
                        <View style={[styles.chartKeyDash, { backgroundColor: colors.dim }]} />
                        <Text style={styles.chartKeyText}>
                          {t(shown.community ? 'show.chartKeyCommunity' : 'show.chartKeyTmdb')}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })()}
              {(() => {
                const shown = ratingSeasonsShown[Math.min(chartPage, ratingSeasonsShown.length - 1)];
                if (!shown) return null;
                if (!picked || picked.season !== shown.season) {
                  return <Text style={styles.chartHint}>{t('show.chartHint')}</Text>;
                }
                const em = episodeMeta(show.tvdbId, picked.season, picked.episode);
                const mine = shown.mine.find((m) => m.episode === picked.episode)?.value ?? null;
                const theirs = shown.points.find((m) => m.episode === picked.episode)?.value ?? null;
                return (
                  <Pressable
                    style={styles.chartPick}
                    onPress={() => {
                      tapSelection();
                      router.push(`/episode/${show.tvdbId}-s${picked.season}e${picked.episode}`);
                    }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.chartPickCode}>
                        {`S${String(picked.season).padStart(2, '0')} | E${String(picked.episode).padStart(2, '0')}`}
                      </Text>
                      {!!em?.title && (
                        <Text style={styles.chartPickTitle} numberOfLines={1}>
                          {em.title}
                        </Text>
                      )}
                    </View>
                    {mine != null && <Text style={styles.chartPickMine}>{'★'.repeat(mine)}</Text>}
                    {theirs != null && (
                      <Text style={styles.chartPickTheirs}>{theirs.toFixed(1)}</Text>
                    )}
                    <Ionicons name="chevron-forward" size={16} color={colors.faint} />
                  </Pressable>
                );
              })()}
              {ratingSeasonsShown.length > 1 && (
                <View style={styles.chartDots}>
                  {ratingSeasonsShown.map((rs, i) => (
                    <View key={rs.season} style={[styles.pageDot, i === chartPage && { backgroundColor: colors.yellow }]} />
                  ))}
                </View>
              )}
              {/*
                * ONE ROW, NOT TWO FOLDED SECTIONS. The best/worst pair and the
                * grid used to live here behind chevrons, at the bottom of a tab
                * that already carries six other things — and on a real phone
                * they were simply never found. They have their own page now;
                * this is the door to it.
                */}
              <Pressable
                style={styles.rowBetween}
                onPress={() => {
                  tapSelection();
                  router.push(`/ratings/${show.tvdbId}`);
                }}>
                <View>
                  <Text style={styles.h2}>{t('ratings.entry')}</Text>
                  <Text style={[styles.caption2, { paddingHorizontal: 0 }]}>{t('ratings.entrySub')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.dim} />
              </Pressable>
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
          style={{ backgroundColor: colors.panel }}
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
                    <Text style={{ color: colors.dim, fontSize: 14, marginTop: 2 }}>{t('show.finishedCardSub')}</Text>
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
                      <Text style={{ color: colors.dim, fontWeight: '800', fontSize: 13 }}>
                        E{String(item.episode).padStart(2, '0')}
                      </Text>
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 10 }}>
                    <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>
                      S{String(item.season).padStart(2, '0')} | E{String(item.episode).padStart(2, '0')}
                    </Text>
                    <Text style={{ color: colors.dim, fontSize: 12 }} numberOfLines={2}>
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
              /**
               * NO LAYOUT TRANSITION ON THE SEASON ROWS, and this is the whole
               * SmackDown bug.
               *
               * `layout={CurvedTransition}` animates a view from where it was
               * to where it now belongs. Opening a season inserts up to 120
               * episode rows, so EVERY season below it is handed a new
               * position — and for the length of that animation they are drawn
               * at the old one, over the episodes that just appeared. With
               * three seasons the shift is small and it settles before you can
               * see it. With 28 (SmackDown, and it goes higher) the rows below
               * are drawn on top of the list for a quarter of a second, and if
               * the ScrollView re-measures mid-flight they can stay there.
               *
               * The expanding block keeps its own fade — that one animates
               * opacity in place and moves nothing.
               */
              <View key={sr.season}>
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
                          /**
                           * A SEASON MARK STOPS AT WHAT HAS AIRED.
                           *
                           * Marking a part-aired season used to tick every
                           * episode the catalogue lists, including the three
                           * that have not been made yet — so a viewer caught up
                           * on Silo was recorded as having watched next month's
                           * finale, and the show left their Watch Next.
                           *
                           * `airCountdown` is the same test the episode rows
                           * use to draw a countdown instead of a checkmark, so
                           * the row and the season button cannot disagree about
                           * what has aired. A missing date still counts as
                           * aired, which is right for the old shows whose
                           * catalogue entries never had one.
                           */
                          const now = Date.now();
                          const seen = getWatchedSet(show.tvdbId);
                          const pending: number[] = [];
                          let upcoming = 0;
                          for (let e = 1; e <= total; e++) {
                            if (seen.has(`${sr.season}-${e}`)) continue;
                            if (airCountdown(episodeMeta(show.tvdbId, sr.season, e)?.air, now)) upcoming++;
                            else pending.push(e);
                          }
                          if (pending.length === 0) return;

                          Alert.alert(t('show.markSeasonTitle', { label }), t('show.markSeasonBody', { count: pending.length }), [
                            {
                              text: t('show.markSeason'),
                              onPress: () => {
                                for (const e of pending) markWatched(show.tvdbId, sr.season, e);
                                setTick((t) => t + 1);
                                // Said once, afterwards: the episodes are not
                                // missing, they have not happened.
                                if (upcoming > 0) {
                                  Alert.alert(t('show.upcomingLeftTitle'), t('show.upcomingLeftBody'));
                                }
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
                        : /* A bar, not a button — see `barColor`. */
                          sr.watched > 0 && {
                            backgroundColor: colors.brand,
                            width: total ? `${Math.min((sr.watched / total) * 100, 100)}%` : '50%',
                          },
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
                            <Text style={{ color: colors.faint, fontWeight: '800', fontSize: 11 }}>
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
                              {t(soon.key, { count: soon.count })}
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
              </View>
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

/**
 * One end of a season: the episode you rated highest, or lowest.
 *
 * A trophy and a thumb rather than two identical rows — the pair is only
 * useful if which is which can be read without comparing the numbers, and the
 * numbers are often one star apart.
 */
/** How far apart two neighbouring episodes sit on the chart. One place, so
 *  the touch layer and the line can never disagree about it. */
function stepOf(count: number, plotW: number): number {
  return count > 1 ? plotW / (count - 1) : plotW;
}

/** Where the plot starts, past the 0-5 labels down the left. */
const PLOT_LEFT = 26;
const PLOT_H = 132;
/**
 * AIR ABOVE THE TOP RAIL. Five used to sit at y = 0, so anything drawn ON a
 * five — a dot, and especially the round + marking the season's best — was cut
 * in half by the top of the plot. Ten points is enough for the largest mark
 * and costs the chart nothing.
 */
const PLOT_TOP = 10;
/** Value (0-5) to a y inside the plot. The rails, the lines and the marks all
 *  come through here so they cannot drift apart. */
function yFor(value: number): number {
  return PLOT_TOP + (1 - value / 5) * (PLOT_H - PLOT_TOP);
}

/**
 * Running a finger along the chart to read it.
 *
 * WHY A HOLD FIRST. A horizontal drag on this view already means something —
 * it pages the seasons — so a scrub that grabbed every horizontal movement
 * would take the pager away. `activateAfterLongPress` splits them the way the
 * hardware already suggests: flick and you change season, press and move and
 * you read episodes. A plain tap still picks one, so nothing has to be
 * discovered to use it at all.
 *
 * NEAREST COLUMN, NOT THE ONE UNDER THE FINGER: a fingertip is wider than the
 * spacing on a long season, so the answer is whichever episode is closest to
 * where the touch is, clamped to the ends. Dragging past the edge holds the
 * last episode rather than losing the readout.
 */
function ScrubLayer({
  axis,
  season,
  plotW,
  onPick,
}: {
  axis: number[];
  season: number;
  plotW: number;
  onPick: React.Dispatch<React.SetStateAction<{ season: number; episode: number } | null>>;
}) {
  const step = stepOf(axis.length, plotW);

  /**
   * `toggle` is true for a TAP and false for a DRAG, and the difference
   * matters: tapping the episode already showing should put the readout away,
   * but running a finger back over it mid-scrub must not — a scrub that
   * cleared itself every time it crossed the same column would flicker.
   */
  const at = (x: number, toggle: boolean) => {
    const i = Math.round((x - PLOT_LEFT) / (step || 1));
    const episode = axis[Math.max(0, Math.min(axis.length - 1, i))];
    if (episode == null) return;
    onPick((cur) =>
      toggle && cur && cur.season === season && cur.episode === episode
        ? null
        : { season, episode },
    );
  };

  /*
   * `onStart`, NOT `onBegin`, and the difference is the whole bug.
   *
   * `onBegin` fires the moment a finger lands, BEFORE the long press has been
   * held and before the gesture has claimed anything — so every touch picked an
   * episode, including the first frame of a swipe meant for the season pager.
   * Adding a distance limit to the tap did not help, because it was never the
   * tap doing it. `onStart` fires when the gesture actually activates, which is
   * after the hold, which is the thing the user meant.
   */
  const scrub = Gesture.Pan()
    .activateAfterLongPress(180)
    .onStart((e) => runOnJS(at)(e.x, false))
    .onUpdate((e) => runOnJS(at)(e.x, false));

  /*
   * A TAP THAT MOVED IS NOT A TAP. Without this, starting a season swipe here
   * picked an episode first and then paged — two things happening for one
   * gesture, and the readout naming an episode from the season you were
   * leaving. Ten points is about the slop of a finger held still.
   */
  const tap = Gesture.Tap()
    .maxDistance(10)
    .onEnd((e, success) => {
      if (!success) return;
      runOnJS(tapSelection)();
      runOnJS(at)(e.x, true);
    });

  return (
    <GestureDetector gesture={Gesture.Exclusive(scrub, tap)}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: PLOT_H }} />
    </GestureDetector>
  );
}

function ExtremeRow({
  kind,
  showId,
  season,
  episode,
  stars,
  title,
  air,
  still,
}: {
  kind: 'best' | 'worst';
  showId: number;
  season: number;
  episode: number;
  stars: number;
  title: string;
  air?: string | null;
  still?: string | null;
}) {
  return (
    <Pressable
      style={styles.extremeRow}
      onPress={() => {
        tapSelection();
        router.push(`/episode/${showId}-s${season}e${episode}`);
      }}>
      {/* THE STILL, because a season's best episode is recognised before it is
          read. A show whose artwork never downloaded gets the badge alone
          rather than a grey rectangle pretending to be a picture. */}
      {still ? (
        <Image source={{ uri: still }} style={styles.extremeStill} contentFit="cover" transition={120} />
      ) : (
        <View style={[styles.extremeStill, styles.extremeStillEmpty]}>
          <Ionicons name={kind === 'best' ? 'trophy' : 'thumbs-down'} size={16} color={colors.faint} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <View style={styles.extremeCodeRow}>
          <View style={[styles.extremeBadge, { backgroundColor: kind === 'best' ? colors.green : colors.danger }]}>
            <Ionicons name={kind === 'best' ? 'trophy' : 'thumbs-down'} size={11} color="#000" />
          </View>
          <Text style={styles.extremeCode}>
            {`S${String(season).padStart(2, '0')} | E${String(episode).padStart(2, '0')}`}
          </Text>
        </View>
        {!!title && (
          <Text style={styles.extremeTitle} numberOfLines={1}>
            {title}
          </Text>
        )}
        <View style={styles.extremeFoot}>
          <Text style={styles.extremeStars}>{'★'.repeat(stars)}</Text>
          {!!air && <Text style={styles.extremeDate}>{shortDate(air)}</Text>}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.faint} />
    </Pressable>
  );
}

/** A whole season at its average — the other half of the same question. */
function ExtremeSeason({
  kind,
  season,
  average,
  rated,
}: {
  kind: 'best' | 'worst';
  season: number;
  average: number;
  rated: number;
}) {
  return (
    <View style={styles.extremeRow}>
      <View style={[styles.extremeStill, styles.extremeStillEmpty]}>
        <Text style={styles.extremeSeasonNum}>{season === 0 ? '★' : season}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.extremeCodeRow}>
          <View style={[styles.extremeBadge, { backgroundColor: kind === 'best' ? colors.green : colors.danger }]}>
            <Ionicons name={kind === 'best' ? 'trophy' : 'thumbs-down'} size={11} color="#000" />
          </View>
          <Text style={styles.extremeCode}>{t(kind === 'best' ? 'show.extremes.best' : 'show.extremes.worst')}</Text>
        </View>
        <Text style={styles.extremeTitle} numberOfLines={1}>
          {t('show.season', { n: season })}
        </Text>
        <View style={styles.extremeFoot}>
          <Text style={styles.extremeStars}>{average.toFixed(1)}</Text>
          <Text style={styles.extremeDate}>{t('show.extremes.episodes', { count: rated })}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chartEdge: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartEdgeGlyph: { color: '#000', fontSize: 10, fontWeight: '900', lineHeight: 11 },
  chartKey: { flexDirection: 'row', justifyContent: 'center', gap: 18, paddingTop: 10 },
  chartKeyItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chartKeyDash: { width: 14, height: 2.5, borderRadius: 2 },
  chartKeyText: { color: colors.dim, fontSize: 11.5, fontWeight: '700' },
  chartHint: { color: colors.faint, fontSize: 12, textAlign: 'center', paddingTop: 8, paddingHorizontal: space.lg },
  chartPick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: space.lg,
    marginTop: 8,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chartPickCode: { color: colors.text, fontSize: 13, fontWeight: '800' },
  chartPickTitle: { color: colors.dim, fontSize: 12, marginTop: 2 },
  chartPickMine: { color: colors.yellow, fontSize: 12, letterSpacing: 1 },
  chartPickTheirs: { color: colors.dim, fontSize: 13, fontWeight: '800' },
  extremeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: radius.card, padding: 10 },
  extremeStill: { width: 72, height: 44, borderRadius: 6, backgroundColor: colors.panel },
  extremeStillEmpty: { alignItems: 'center', justifyContent: 'center' },
  extremeSeasonNum: { color: colors.dim, fontSize: 18, fontWeight: '900' },
  extremeCodeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  extremeBadge: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  extremeCode: { color: colors.text, fontSize: 13, fontWeight: '800' },
  extremeTitle: { color: colors.dim, fontSize: 12, marginTop: 2 },
  extremeFoot: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  extremeStars: { color: colors.yellow, fontSize: 12, letterSpacing: 1 },
  extremeDate: { color: colors.faint, fontSize: 11 },
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
  backdrop: { backgroundColor: colors.card, justifyContent: 'space-between', overflow: 'hidden' },
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
    // Beside the chevron, on the backdrop — see `colors.onArt`.
    color: colors.onArt,
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
  progressTrack: { height: 6, backgroundColor: colors.pillGrey },
  progressFill: { height: '100%', backgroundColor: colors.yellow },
  // On the backdrop, with the meta line below it.
  title: { color: colors.onArt, fontSize: 25, fontWeight: '800' },
  // Sits on the backdrop image — see `colors.onArt`.
  meta: { color: colors.onArtDim, fontSize: 14, marginTop: 3 },
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
  divider: { height: 1, backgroundColor: colors.line, marginBottom: 14 },
  pollLabel: {
    color: colors.text,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 10,
  },
  interestBtn: {
    backgroundColor: colors.panel,
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
    backgroundColor: colors.raise,
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
  chartRule: { flex: 1, height: 1, backgroundColor: colors.line },
  chartDot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: colors.dim },
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
  chartDotGlyph: { color: colors.onArt, fontSize: 9, fontWeight: '800', lineHeight: 11 },
  chartDots: { flexDirection: 'row', gap: 7, alignSelf: 'center', marginTop: 10 },
  pageDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.pillGrey },
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
  body: { color: colors.text, fontSize: 14.5, lineHeight: 20 },
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
    backgroundColor: colors.card,
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
    // One row has to end where the next begins. On black, panel is a shade
    // above the page and that is enough; on paper it is a shade the eye
    // cannot find, so the row sinks to a card instead.
    backgroundColor: appliedLight() ? colors.card : colors.panel,
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
  trackDivider: { height: 1, backgroundColor: colors.line, marginTop: 2 },
  carCard: {
    height: 87,
    borderRadius: radius.card,
    // A card on the page's own colour: black on black reads by its shadow
    // and its thumbnail, white on white reads as nothing. On paper it sinks.
    backgroundColor: appliedLight() ? colors.card : colors.bg,
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
  epTitle: { color: colors.dim, fontSize: 15.5, marginTop: 2 },
  epWatched: { color: colors.faint, fontSize: 14, marginTop: 2 },
  // an unaired episode reads as "waiting", not "unwatched" — yellow ACTS, so
  // the countdown stays dim; it is information, not something to tap
  epUpcoming: { color: colors.dim },
  epCountdown: { width: 74, alignItems: 'flex-end', justifyContent: 'center', paddingEnd: 2 },
  epCountdownText: { color: colors.dim, fontSize: 12.5, fontWeight: '700', textAlign: 'auto' },
});
