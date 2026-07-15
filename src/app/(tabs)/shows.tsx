import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Poster } from '@/components/poster';
import { CheckCircle, EmptyState, Screen, TopTabs } from '@/components/ui';
import { getHistory, getShowProgress, type ShowProgress } from '@/db';
import { markWatchedWithPrompt } from '@/mark';
import { episodeMeta, showMeta } from '@/metadata';
import { fetchShowMeta } from '@/show-meta-fetch';
import { airedTotalOf, progressColorOf, progressOf } from '@/show-status';
import { colors, radius, space } from '@/theme';

const TABS = ['Watch List', 'Upcoming'] as const;

function shortDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** The actual next episode, respecting season structure when we know it.
 * null = caught up (nothing left); 'unknown' = no metadata yet, structure
 * unverifiable — never invent episodes off it. */
function realNext(sp: ShowProgress): { season: number; episode: number } | null | 'unknown' {
  const m = showMeta(sp.tvdbId);
  if (!m) return 'unknown';
  const today = new Date().toISOString().slice(0, 10);
  let s = sp.nextSeason;
  let e = sp.nextEpisode;
  for (;;) {
    const count = m.seasons[String(s)]?.count ?? 0;
    if (e <= count) {
      // the next episode exists but hasn't aired — that's Upcoming's job,
      // not the watch list's
      const air = m.episodes[`${s}-${e}`]?.air;
      if (air && air > today) return null;
      return { season: s, episode: e };
    }
    const later = Object.keys(m.seasons)
      .map(Number)
      .filter((n) => n > s)
      .sort((a, b) => a - b);
    if (later.length === 0) return null;
    s = later[0];
    e = 1;
  }
}

function code(sp: ShowProgress): string {
  const next = realNext(sp);
  const s = next && next !== 'unknown' ? next.season : sp.nextSeason;
  const e = next && next !== 'unknown' ? next.episode : sp.nextEpisode;
  return `S${String(s).padStart(2, '0')} | E${String(e).padStart(2, '0')}`;
}

/** episodes remaining — "+139" on the real app's cards; aired only, so a
 * caught-up show never shows a phantom remainder */
function episodesLeft(sp: ShowProgress): number | null {
  const total = airedTotalOf(sp.tvdbId);
  if (!total) return null;
  return Math.max(total - Math.max(sp.watched, sp.episodesSeen), 0);
}

type Row =
  | { type: 'pill'; key: string; label: string }
  | { type: 'card'; key: string; sp: ShowProgress }
  | { type: 'grid'; key: string; shows: ShowProgress[] };

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export default function ShowsScreen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Watch List');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [tick, setTick] = useState(0);

  const rows = useMemo<Row[]>(() => {
    // completed / caught-up shows have nothing to watch next — the Watch List
    // only queues shows with episodes remaining, like the real app
    const all = getShowProgress().filter(
      (s) => (s.followed || s.watched > 0 || s.episodesSeen > 0) && realNext(s) !== null,
    );
    const withActivity = all
      .filter((s) => s.lastWatchedAt != null)
      .sort(
        (a, b) => b.lastWatchedAt!.localeCompare(a.lastWatchedAt!) || b.watched - a.watched,
      );
    // Watch Next = shows active within ~30 days of your newest watch —
    // verified against the real app: AT, Spider-Noir, Noddy, Family Matter
    // in Watch Next; Record of Ragnarok leads "haven't watched for a while"
    const newestTs = withActivity.length
      ? Date.parse(withActivity[0].lastWatchedAt!.replace(' ', 'T'))
      : 0;
    const isRecent = (s: ShowProgress) =>
      newestTs - Date.parse(s.lastWatchedAt!.replace(' ', 'T')) < 30 * 24 * 3600 * 1000;
    const watchNext = withActivity.filter(isRecent).slice(0, 10);
    const stale = [
      ...withActivity.filter((s) => !watchNext.includes(s)),
      ...all.filter((s) => s.lastWatchedAt == null && (s.episodesSeen > 0 || s.watched > 0)),
    ];
    const notStarted = all.filter((s) => s.lastWatchedAt == null && s.episodesSeen === 0 && s.watched === 0);

    const sections: [string, ShowProgress[]][] = [
      ['Watch Next', watchNext],
      ["Haven't watched for a while", stale],
      ["Haven't started", notStarted],
    ];

    const out: Row[] = [];
    for (const [label, shows] of sections) {
      if (!shows.length) continue;
      out.push({ type: 'pill', key: `pill-${label}`, label });
      if (view === 'list') {
        for (const sp of shows) out.push({ type: 'card', key: String(sp.tvdbId), sp });
      } else {
        chunk(shows, 3).forEach((group, i) =>
          out.push({ type: 'grid', key: `${label}-row-${i}`, shows: group }),
        );
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, tick]);

  const markNext = (sp: ShowProgress) => {
    const next = realNext(sp);
    if (next === null) return;
    // metadata still loading/unavailable: fall back to the raw counter so
    // tracking never blocks — the fetch effect below corrects the structure
    const target = next === 'unknown' ? { season: sp.nextSeason, episode: sp.nextEpisode } : next;
    markWatchedWithPrompt(sp.tvdbId, target.season, target.episode, () => setTick((t) => t + 1));
  };

  // shows imported but never opened have no metadata yet — without it the
  // watch list can't know where seasons end (the "ghost episodes" bug).
  // Fetch it in the background, a batch at a time, each show only once.
  const metaTried = useRef(new Set<number>());
  useEffect(() => {
    const missing = getShowProgress()
      .filter(
        (s) =>
          (s.followed || s.watched > 0 || s.episodesSeen > 0) &&
          !showMeta(s.tvdbId) &&
          !metaTried.current.has(s.tvdbId),
      )
      .slice(0, 12);
    if (missing.length === 0) return;
    for (const s of missing) metaTried.current.add(s.tvdbId);
    void Promise.allSettled(missing.map((s) => fetchShowMeta(s.tvdbId))).then(() => setTick((t) => t + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // WATCHED HISTORY lives above WATCH NEXT: the list opens anchored at
  // WATCH NEXT and scrolling up reveals older and older watches — all the
  // way back to the first episode ever. Rows load in chunks as you climb,
  // with the scroll position compensated so nothing jumps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const historyAll = useMemo(() => getHistory(), [tick]);
  const [histCount, setHistCount] = useState(30);
  const history = useMemo(() => historyAll.slice(0, histCount).reverse(), [historyAll, histCount]);
  const listRef = useRef<FlatList<Row>>(null);
  const anchored = useRef(false);
  const scrollY = useRef(0);
  const contentH = useRef(0);
  const pendingGrow = useRef<number | null>(null);

  const onListScroll = (y: number) => {
    scrollY.current = y;
    if (view === 'list' && y < 500 && pendingGrow.current == null && histCount < historyAll.length) {
      pendingGrow.current = contentH.current;
      setHistCount((c) => Math.min(c + 100, historyAll.length));
    }
  };
  const onListSize = (h: number) => {
    if (pendingGrow.current != null) {
      const delta = h - pendingGrow.current;
      pendingGrow.current = null;
      if (delta > 0) listRef.current?.scrollToOffset({ offset: scrollY.current + delta, animated: false });
    }
    contentH.current = h;
  };

  return (
    <Screen>
      <TopTabs
        tabs={TABS}
        active={tab}
        onChange={(t) => {
          if (t === 'Watch List') anchored.current = false;
          setTab(t);
        }}
      />

      {tab === 'Watch List' ? (
        <View style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(r) => r.key}
          onScroll={(e) => onListScroll(e.nativeEvent.contentOffset.y)}
          scrollEventThrottle={16}
          onContentSizeChange={(_, h) => onListSize(h)}
          ListHeaderComponent={
            <View
              onLayout={(e) => {
                if (anchored.current) return;
                anchored.current = true;
                const h = e.nativeEvent.layout.height;
                if (h > 12) listRef.current?.scrollToOffset({ offset: h, animated: false });
              }}>
              {view === 'list' && history.length > 0 && (
                <>
                  <View style={styles.pillRow}>
                    <Text style={styles.sectionPill}>WATCHED HISTORY</Text>
                  </View>
                  {history.map((w, i) => {
                    const em = episodeMeta(w.showId, w.season, w.episode);
                    return (
                      <Pressable
                        key={`h${i}`}
                        style={[styles.card, styles.histCard]}
                        onPress={() => router.push(`/episode/${w.showId}-s${w.season}e${w.episode}`)}>
                        <View style={styles.thumb}>
                          {em?.still ? (
                            <Image source={{ uri: em.still }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                          ) : (
                            <Text style={styles.thumbText}>{w.name.slice(0, 2).toUpperCase()}</Text>
                          )}
                        </View>
                        <View style={styles.cardBody}>
                          <Pressable style={styles.showPill} onPress={() => router.push(`/show/${w.showId}`)}>
                            <Text style={styles.showPillText} numberOfLines={1}>
                              {w.name.toUpperCase()} ›
                            </Text>
                          </Pressable>
                          <Text style={styles.epCode}>
                            S{String(w.season).padStart(2, '0')} | E{String(w.episode).padStart(2, '0')}
                          </Text>
                          <Text style={styles.epSub} numberOfLines={1}>
                            {em?.title ?? `Episode ${w.episode}`}
                          </Text>
                        </View>
                        <View style={{ paddingRight: 12 }}>
                          <CheckCircle
                            watched
                            onPress={() => router.push(`/mark-as?show=${w.showId}&s=${w.season}&e=${w.episode}`)}
                          />
                        </View>
                      </Pressable>
                    );
                  })}
                </>
              )}
              <View style={{ height: 6 }} />
            </View>
          }
          contentContainerStyle={rows.length === 0 ? { paddingBottom: 24, flexGrow: 1 } : { paddingBottom: 24 }}
          ListEmptyComponent={
            <EmptyState
              title="You aren't tracking any shows yet!"
              caption="Follow shows and check off episodes as you watch."
              cta="Discover shows"
              onPress={() => router.push('/discover-more')}
            />
          }
          renderItem={({ item }) => {
            if (item.type === 'pill') {
              return (
                <View style={styles.pillRow}>
                  <Text style={styles.sectionPill}>{item.label.toUpperCase()}</Text>
                </View>
              );
            }
            if (item.type === 'card') {
              const sp = item.sp;
              const em = episodeMeta(sp.tvdbId, sp.nextSeason, sp.nextEpisode);
              const left = episodesLeft(sp);
              const thumbUri = em?.still ?? sp.posterUrl;
              return (
                <Pressable style={styles.card} onPress={() => router.push(`/episode/${sp.tvdbId}-s${sp.nextSeason}e${sp.nextEpisode}`)}>
                  <View style={styles.thumb}>
                    {thumbUri ? (
                      <Image source={{ uri: thumbUri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                    ) : (
                      <Text style={styles.thumbText}>{sp.name.slice(0, 2).toUpperCase()}</Text>
                    )}
                  </View>
                  <View style={styles.cardBody}>
                    <Pressable style={styles.showPill} onPress={() => router.push(`/show/${sp.tvdbId}`)}>
                      <Text style={styles.showPillText} numberOfLines={1}>
                        {sp.name.toUpperCase()} ›
                      </Text>
                    </Pressable>
                    <Text style={styles.epCode}>
                      {code(sp)}
                      {left != null && left > 0 && <Text style={styles.epPlus}>  +{left}</Text>}
                    </Text>
                    <Text style={styles.epSub} numberOfLines={1}>
                      {em?.title ??
                        (sp.lastWatchedAt ? `Last watched ${shortDate(sp.lastWatchedAt)}` : 'Not started yet')}
                    </Text>
                  </View>
                  <View style={{ paddingRight: 12 }}>
                    <CheckCircle onPress={() => markNext(sp)} />
                  </View>
                </Pressable>
              );
            }
            return (
              <View style={styles.gridRow}>
                {item.shows.map((sp) => (
                  <Pressable key={sp.tvdbId} style={{ flex: 1 }} onPress={() => router.push(`/show/${sp.tvdbId}`)}>
                    <Poster name={sp.name} uri={sp.posterUrl} progress={progressOf(sp)} progressColor={progressColorOf(sp)} animateProgress />
                  </Pressable>
                ))}
                {item.shows.length < 3 &&
                  Array.from({ length: 3 - item.shows.length }).map((_, i) => <View key={i} style={{ flex: 1 }} />)}
              </View>
            );
          }}
        />
        {/* the list/grid toggle floats at the top right, like the real app */}
        <Pressable
          style={styles.gridToggle}
          hitSlop={10}
          onPress={() => setView(view === 'list' ? 'grid' : 'list')}>
          <Ionicons name={view === 'list' ? 'grid' : 'list'} size={22} color={colors.text} />
        </Pressable>
        </View>
      ) : (
        <EmptyState
          title="Your upcoming list is empty!"
          caption="Air dates appear once show data is synced."
          cta="Browse all shows"
          onPress={() => router.push('/discover-more')}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pillRow: { alignItems: 'center', justifyContent: 'center', marginVertical: 10 },
  sectionPill: {
    backgroundColor: colors.pillGrey,
    color: colors.text,
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.8,
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  gridToggle: { position: 'absolute', right: 14, top: 16 },
  // history cards read as "done": dimmed like the real app
  histCard: { opacity: 0.55 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderRadius: radius.card,
    marginHorizontal: space.md,
    marginBottom: 10,
    overflow: 'hidden',
  },
  thumb: {
    width: 124,
    aspectRatio: 16 / 10,
    backgroundColor: '#2A3550',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbText: { color: '#8B98AE', fontSize: 18, fontWeight: '800' },
  cardBody: { flex: 1, minWidth: 0, paddingHorizontal: 14, paddingVertical: 12 },
  showPill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderWidth: 1,
    borderColor: '#55555C',
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 11,
  },
  showPillText: { color: colors.text, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.7 },
  epCode: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: 7 },
  epPlus: { color: colors.dim, fontSize: 12, fontWeight: '600' },
  epSub: { color: colors.dim, fontSize: 12.5, marginTop: 2 },
  gridRow: { flexDirection: 'row', gap: 3, marginHorizontal: space.md, marginBottom: 3 },
});
