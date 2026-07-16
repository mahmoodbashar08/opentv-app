import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated as RNAnimated, Dimensions, Easing as RNEasing, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
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

import { useSwipeDown } from '@/components/swipe-down';
import { CheckCircle, TopTabs } from '@/components/ui';
import seed from '@/seed';
import db, { addShow, getSeasonEpisodes, getSeasons, getWatchedSet, markWatched, unmarkWatched } from '@/db';
import { markWatchedWithPrompt } from '@/mark';
import { absoluteEpisode, episodeMeta, seasonTotal, showMeta, statusLabel, tvdbIdForTmdb } from '@/metadata';
import { fetchShowMeta } from '@/show-meta-fetch';
import { colors, radius, space } from '@/theme';

const TABS = ['About', 'Episodes'] as const;

const INTERESTS = [
  'The cast',
  'The premise',
  'The creators',
  'The network/platform',
  'The franchise or universe',
  'Other',
] as const;

function countLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const W = Dimensions.get('window').width;
const CARD_W = Math.round(W * 0.7);
// equal side insets so every card (first and last included) centers on screen
const CARD_SIDE = Math.round((W - CARD_W) / 2);

type CarItem =
  | { kind: 'ep'; season: number; episode: number; watched: boolean }
  | { kind: 'finished' };

function shortDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ShowScreen() {
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
  const dbShow = db.getFirstSync<{ tvdbId: number; name: string; episodesSeen: number; followed: number }>(
    'SELECT tvdbId, name, episodesSeen, followed FROM shows WHERE tvdbId = ?',
    [tvdbId],
  );
  const seedShow = seed.shows.find((s) => String(s.tvdbId) === id);
  const fetched = showMeta(tvdbId);
  const show =
    dbShow ??
    seedShow ??
    (fetched ? { tvdbId, name: fetched.name ?? '', episodesSeen: 0, followed: 0 } : undefined);
  const [tab, setTab] = useState<(typeof TABS)[number]>('About');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [interest, setInterest] = useState<number | null>(null);
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

  const { gesture, headerGesture, animatedStyle, onScroll, setAtTop } = useSwipeDown();
  // the horizontal carousel is a native scroll view that grabs vertical drags
  // too and would cancel the drag-to-dismiss pan — let them recognize together;
  // the content scrolls also list the pan (via ref) as a simultaneous partner
  const panRef = useRef<GestureType | undefined>(undefined);
  const carouselNative = useMemo(() => Gesture.Native(), []);
  const pan = useMemo(
    () => gesture.withRef(panRef).simultaneousWithExternalGesture(carouselNative),
    [gesture, carouselNative],
  );
  const meta = show ? showMeta(show.tvdbId) : undefined;

  const seen = Math.max(show?.episodesSeen ?? 0, seasons.reduce((n, s) => n + s.watched, 0));
  const progress = meta?.totalEpisodes ? Math.min(seen / meta.totalEpisodes, 1) : Math.min(seen / 200, 1);

  // bar color = TV Time status: caught up + ended = purple, caught up +
  // running = green, otherwise yellow
  const caughtUp = meta?.totalEpisodes != null && meta.totalEpisodes > 0 && seen >= meta.totalEpisodes;
  const barColor = caughtUp ? (meta?.inProduction ? colors.green : colors.status.finished) : colors.yellow;

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

  // community ratings chart: per-episode TMDB scores (0–5 scale) by season
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
              Couldn't load this show — check your connection and try again.
            </Text>
            <Pressable onPress={() => setMetaState('loading')} hitSlop={10}>
              <Text style={{ color: colors.blue, fontSize: 15, fontWeight: '600' }}>Retry</Text>
            </Pressable>
          </>
        ) : (
          <RNAnimated.View>
            <Text style={{ color: colors.dim, fontSize: 14.5 }}>Loading…</Text>
          </RNAnimated.View>
        )}
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ position: 'absolute', top: insets.top + 8, left: 16 }}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
      </View>
    );
  }

  return (
    <GestureDetector gesture={pan}>
    <Animated.View style={[{ flex: 1, backgroundColor: colors.bg }, animatedStyle]}>
      {/* full-bleed backdrop behind the status bar, like the real app —
          it never scrolls, so dragging it down always dismisses; scrolling the
          content collapses it to a compact title bar */}
      <GestureDetector gesture={headerGesture}>
      <Animated.View style={[styles.backdrop, bannerStyle]}>
        {meta?.backdrop && (
          <>
            <Image source={{ uri: meta.backdrop }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
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
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
        </View>
        <Animated.View style={[styles.backdropMeta, metaFade]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{show.name}</Text>
            <Text style={styles.meta}>
              {meta
                ? `${meta.totalSeasons} season${meta.totalSeasons === 1 ? '' : 's'} · ${statusLabel(meta)} · ${meta.network ?? '—'}`
                : `${show.episodesSeen} episodes watched · ${show.followed ? 'Following' : 'Not following'}`}
            </Text>
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
      {metaState === 'failed' && dbShow && (
        <Pressable
          style={styles.fixMatch}
          onPress={() => router.push(`/fix-match?type=show&id=${tvdbId}&name=${encodeURIComponent(show.name)}`)}>
          <Ionicons name="link-outline" size={20} color={colors.onYellow} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={styles.fixMatchTitle}>Not matched to the shows database</Text>
            <Text style={styles.fixMatchSub}>Pick the right show to add artwork and episode lists.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.onYellow} />
        </Pressable>
      )}

      {/* a fresh tab's scroll view starts at the top but fires no scroll
          event, so re-arm the drag-to-dismiss on every switch */}
      <TopTabs
        tabs={TABS}
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
          onScrollEndDrag={onContentScroll}
          onMomentumScrollEnd={onContentScroll}
          scrollEventThrottle={16}
          bounces={false}>
          <View style={styles.rowBetween}>
            <Text style={styles.h2}>Where to watch</Text>
            <Ionicons name="settings-outline" size={18} color={colors.dim} />
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
            {!meta?.providers?.length && <Text style={styles.caption2}>Not available in your region</Text>}
          </View>

          {/* interests poll, like the real app (kept on-device) */}
          <View style={styles.divider} />
          <Text style={styles.pollLabel}>WHAT INTERESTS YOU MOST ABOUT THIS SHOW?</Text>
          {INTERESTS.map((label, i) => (
            <Pressable
              key={label}
              style={[styles.interestBtn, interest === i && { backgroundColor: colors.yellow }]}
              onPress={() => setInterest(interest === i ? null : i)}>
              <Text style={[styles.interestText, interest === i && { color: colors.onYellow }]}>
                {label.toUpperCase()}
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
                  <Text style={styles.h2}>Similar to</Text>
                  <Text style={[styles.caption2, { marginTop: 2, fontSize: 15 }]}>{meta.similar[0].name}</Text>
                </View>
              </Pressable>
            </>
          )}

          <View style={styles.divider} />
          <Text style={[styles.h2, { paddingHorizontal: space.lg }]}>Show info</Text>
          <Text style={styles.caption}>
            {meta
              ? `${meta.year ?? '—'}${meta.endYear && meta.endYear !== meta.year ? ` - ${meta.endYear}` : ''} · ${meta.genres.join(', ') || '—'}`
              : 'Metadata unavailable for this show.'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.lg, marginTop: 8 }}>
            <View style={styles.tBadge}>
              <Text style={{ fontWeight: '800', color: colors.onYellow, fontSize: 13 }}>T</Text>
            </View>
            <Text style={{ color: colors.yellow, letterSpacing: 2 }}>★★★★★</Text>
            <Text style={styles.caption2}>{meta?.rating ? `${(meta.rating / 2).toFixed(1)}/5` : '—/5'}</Text>
          </View>
          <Text style={[styles.body, { paddingHorizontal: space.lg, marginTop: 10 }]}>
            {meta?.overview ?? `Your progress: ${show.episodesSeen} episodes seen.`}
          </Text>

          <View style={[styles.divider, { marginTop: 16, marginHorizontal: space.lg }]} />
          <View style={styles.factsRow}>
            <View style={styles.fact}>
              <Ionicons name="time-outline" size={22} color={colors.text} />
              <Text style={styles.factText}>
                {meta?.lastAir
                  ? new Date(`${meta.lastAir}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })
                  : '—'}
              </Text>
            </View>
            <View style={styles.fact}>
              <Ionicons name="stopwatch-outline" size={22} color={colors.text} />
              <Text style={styles.factText}>{meta?.runtime ? `${meta.runtime} min` : '—'}</Text>
            </View>
          </View>
          {meta?.votes != null && meta.votes > 0 && (
            <View style={[styles.fact, { paddingHorizontal: space.lg, marginTop: 10 }]}>
              <Ionicons name="people-outline" size={22} color={colors.text} />
              <Text style={styles.factText}>{countLabel(meta.votes)} added this show</Text>
            </View>
          )}

          {!!meta?.cast?.length && (
            <>
              <View style={[styles.divider, { marginTop: 18 }]} />
              <Text style={[styles.h2, { paddingHorizontal: space.lg, marginBottom: 12 }]}>Cast</Text>
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
              <Text style={[styles.h2, { paddingHorizontal: space.lg, marginBottom: 12 }]}>People also watched</Text>
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

          {ratingSeasons.length > 0 && (
            <>
              <View style={[styles.divider, { marginTop: 18 }]} />
              <View style={styles.rowBetween}>
                <Text style={styles.h2}>Community ratings</Text>
                <Text style={styles.caption2}>Season {ratingSeasons[Math.min(chartPage, ratingSeasons.length - 1)].season}</Text>
              </View>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(e) => setChartPage(Math.round(e.nativeEvent.contentOffset.x / (W - 2 * space.lg)))}
                style={{ marginHorizontal: space.lg }}>
                {ratingSeasons.map((rs) => {
                  const plotW = W - 2 * space.lg - 34;
                  const pts = rs.ratings.map((r, i) => ({
                    x: 26 + (rs.ratings.length > 1 ? (i / (rs.ratings.length - 1)) * plotW : plotW / 2),
                    y: (1 - r / 5) * 132,
                  }));
                  return (
                    <View key={rs.season} style={{ width: W - 2 * space.lg, height: 150 }}>
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
              {ratingSeasons.length > 1 && (
                <View style={styles.chartDots}>
                  {ratingSeasons.map((rs, i) => (
                    <View key={rs.season} style={[styles.pageDot, i === chartPage && { backgroundColor: colors.yellow }]} />
                  ))}
                </View>
              )}
            </>
          )}

          <View style={[styles.divider, { marginTop: 18 }]} />
          <Pressable style={styles.rowBetween} onPress={() => router.push(`/comments?title=${encodeURIComponent(show.name)}`)}>
            <Text style={styles.h2}>Comments</Text>
            <Text style={{ color: colors.dim, fontSize: 15 }}>›</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <ScrollView
          style={{ backgroundColor: '#1D1D1D' }}
          contentContainerStyle={{ paddingBottom: 24 }}
          simultaneousHandlers={panRef}
          onScroll={onContentScroll}
          onScrollEndDrag={onContentScroll}
          onMomentumScrollEnd={onContentScroll}
          scrollEventThrottle={16}
          bounces={false}>
          {/* Episodes tab is grey with black cards, like the real app */}
          <View style={styles.trackPanel}>
          <View style={styles.rowBetween}>
            <Text style={styles.h2}>Continue tracking</Text>
            <Ionicons name="refresh" size={18} color={colors.dim} />
          </View>
          <GestureDetector gesture={carouselNative}>
          <FlatList
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
            contentContainerStyle={{ paddingHorizontal: CARD_SIDE, gap: 10, paddingBottom: 18 }}
            renderItem={({ item }) => {
              if (item.kind === 'finished') {
                return (
                  <View style={[styles.carCard, { flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }]}>
                    {meta?.backdrop && (
                      <>
                        <Image source={{ uri: meta.backdrop }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
                      </>
                    )}
                    <Text style={{ color: colors.yellow, fontSize: 22, fontWeight: '800' }}>Finished</Text>
                    <Text style={{ color: '#E3E3E8', fontSize: 14, marginTop: 2 }}>That's all, folks!</Text>
                  </View>
                );
              }
              const em = episodeMeta(show.tvdbId, item.season, item.episode);
              return (
                <Pressable
                  style={styles.carCard}
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
                      {em?.title ?? `Episode ${item.episode}`}
                    </Text>
                  </View>
                  <View style={{ paddingRight: 10 }}>
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
            <Text style={[styles.h2, { fontSize: 16 }]}>All episodes</Text>
            <Ionicons name="checkmark-circle-outline" size={22} color={colors.dim} />
          </View>
          {seasons.map((sr) => {
            const total = seasonTotal(show.tvdbId, sr.season);
            const complete = total != null && total > 0 && sr.watched >= total;
            const isOpen = expanded === sr.season;
            const watchedMap = isOpen
              ? new Map(getSeasonEpisodes(show.tvdbId, sr.season).map((e) => [e.episode, e]))
              : null;
            const epCount = total ?? (watchedMap ? Math.max(0, ...watchedMap.keys()) : 0);
            return (
              <Animated.View key={sr.season} layout={CurvedTransition.duration(260)}>
                <Pressable
                  style={styles.seasonCard}
                  onPress={() => setExpanded(isOpen ? null : sr.season)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={styles.seasonName}>{sr.season === 0 ? 'Specials' : `Season ${sr.season}`}</Text>
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
                        const label = sr.season === 0 ? 'Specials' : `Season ${sr.season}`;
                        if (complete) {
                          Alert.alert(`Unmark ${label}?`, 'All its episodes go back to not watched.', [
                            {
                              text: 'Unmark',
                              onPress: () => {
                                for (let e = 1; e <= total; e++) unmarkWatched(show.tvdbId, sr.season, e);
                                setTick((t) => t + 1);
                              },
                            },
                            { text: 'Cancel', style: 'cancel' },
                          ]);
                        } else {
                          Alert.alert(`Mark ${label} as watched?`, `${total - sr.watched} episodes will be marked.`, [
                            {
                              text: 'Mark season',
                              onPress: () => {
                                const seen = getWatchedSet(show.tvdbId);
                                for (let e = 1; e <= total; e++) {
                                  if (!seen.has(`${sr.season}-${e}`)) markWatched(show.tvdbId, sr.season, e);
                                }
                                setTick((t) => t + 1);
                              },
                            },
                            { text: 'Cancel', style: 'cancel' },
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
                  {Array.from({ length: epCount }, (_, i) => i + 1).map((epNum) => {
                    const w = watchedMap.get(epNum);
                    const em = episodeMeta(show.tvdbId, sr.season, epNum);
                    const abs = absoluteEpisode(show.tvdbId, sr.season, epNum);
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
                            {w?.rewatch ? '  ↻' : ''}
                          </Text>
                          <Text style={styles.epTitle} numberOfLines={2}>
                            {em?.title ?? `Episode ${epNum}`}
                          </Text>
                          <Text style={styles.epWatched}>
                            {w ? `Watched ${shortDate(w.watchedAt)}` : em?.air ? shortDate(em.air) : ' '}
                          </Text>
                        </View>
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
                      </Pressable>
                    );
                  })}
                  </Animated.View>
                )}
              </Animated.View>
            );
          })}
          {seasons.length === 0 && (
            <Text style={[styles.caption, { textAlign: 'center', marginTop: 6 }]}>
              No episode data for this show yet.
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
          <Text style={styles.addBarText}>ADD SHOW</Text>
        </Pressable>
      )}
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
  match: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 4 },
  tBadgeSm: { backgroundColor: colors.yellow, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
  progressTrack: { height: 6, backgroundColor: '#57511F' },
  progressFill: { height: '100%', backgroundColor: colors.yellow },
  title: { color: colors.text, fontSize: 28, fontWeight: '800' },
  meta: { color: '#E3E3E8', fontSize: 14, marginTop: 3 },
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
    right: 8,
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
    paddingRight: 10,
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
    width: CARD_W,
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
});
