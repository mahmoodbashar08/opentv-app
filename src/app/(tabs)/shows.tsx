import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, I18nManager, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Poster } from '@/components/poster';
import { CheckCircle, EmptyState, Screen, TopTabs } from '@/components/ui';
import { archiveCounts, getHistory, getMeta, getMovieTotals, getShowProgress, getTotals, libraryOwner, setMeta, type ShowProgress } from '@/db';
import { markWatchedWithPrompt } from '@/mark';
import { episodeMeta, showMeta } from '@/metadata';
import { hasOriginalZip } from '@/migrations';
import { gridGeometry, importLostHistory } from '@/pure';
import { fetchShowMeta, showMetaIsStale } from '@/show-meta-fetch';
import { airedTotalOf, progressColorOf, progressOf } from '@/show-status';
import { MemoryCard } from '@/components/memory-card';
import { colors, radius, space } from '@/theme';
import { currentLocale, t } from '@/i18n';

const TABS = ['Watch List', 'Upcoming'] as const;

function shortDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(currentLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
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
      // not the watch list's.
      //
      // NO AIR DATE COUNTS AS NOT AIRED. TheTVDB lists a season the moment it
      // is announced, with its episodes carrying no date yet, so `em` existed,
      // `em.air` was null, this guard was skipped and a finished show was told
      // to watch S04E01 of a season that does not exist (reported on Foundation
      // by two testers). An episode nobody can watch is never the next one, and
      // that is the same standard as the verification guard below: suggest only
      // what we can verify.
      const em = m.episodes[`${s}-${e}`];
      if (!em?.air || em.air > today) return null;
      // verification guard: when this show's episode map is populated but has
      // NOTHING for this episode, the season count is lying (a wrong metadata
      // match once let a user check off FROM S04E19…E28 — episodes that don't
      // exist). Suggest only what we can verify; never invent history.
      if (!em && Object.keys(m.episodes).length > 0) return null;
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

/** The season/episode a card is really pointing at: the verified next episode
 * when metadata allows it, else the raw maxEp+1 counter. Everything on a card —
 * the code, the still, the tap target — must resolve through this one helper,
 * or the card reads "S06 | E01" while the tap opens "S05 | E25" of a
 * 24-episode season. */
function nextCoords(sp: ShowProgress, next: ReturnType<typeof realNext>): { season: number; episode: number } {
  return next && next !== 'unknown'
    ? { season: next.season, episode: next.episode }
    : { season: sp.nextSeason, episode: sp.nextEpisode };
}

function code(sp: ShowProgress, resolved?: ReturnType<typeof realNext>): string {
  const { season, episode } = nextCoords(sp, resolved ?? realNext(sp));
  return `S${String(season).padStart(2, '0')} | E${String(episode).padStart(2, '0')}`;
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
  const { width: W } = useWindowDimensions();
  // the Watch List's rows and grid run full width (no ContentColumn cap) —
  // these are repeated rows/tiles, not prose, so a tablet should show MORE of
  // them rather than a narrow capped column. The column count derives from
  // the raw window width. On a phone this is unchanged from before.
  const gridCols = gridGeometry(W, space.md, 3).cols;
  const [tab, setTab] = useState<(typeof TABS)[number]>('Watch List');
  const [view, setView] = useState<'list' | 'grid'>(() => (getMeta('showsView') === 'grid' ? 'grid' : 'list'));
  const [tick, setTick] = useState(0);

  // re-read the library whenever this tab regains focus — a show deleted or
  // unfollowed on its page must disappear from here immediately
  useFocusEffect(
    useCallback(() => {
      setTick((t) => t + 1);
    }, []),
  );

  const rows = useMemo<Row[]>(() => {
    // completed / caught-up shows have nothing to watch next — the Watch List
    // only queues shows with episodes remaining, like the real app
    const all = getShowProgress().filter(
      (s) => !s.archived && (s.followed || s.watched > 0 || s.episodesSeen > 0) && realNext(s) !== null,
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
      [t('shows.sectionWatchNext'), watchNext],
      [t('shows.sectionStale'), stale],
      [t('shows.sectionNotStarted'), notStarted],
    ];

    const out: Row[] = [];
    for (const [label, shows] of sections) {
      if (!shows.length) continue;
      out.push({ type: 'pill', key: `pill-${label}`, label });
      if (view === 'list') {
        for (const sp of shows) out.push({ type: 'card', key: String(sp.tvdbId), sp });
      } else {
        chunk(shows, gridCols).forEach((group, i) =>
          out.push({ type: 'grid', key: `${label}-row-${i}`, shows: group }),
        );
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, tick, gridCols]);

  const markNext = (sp: ShowProgress) => {
    const next = realNext(sp);
    if (next === null) return;
    if (next === 'unknown') {
      // metadata hasn't loaded — marking blind here once fabricated ghost
      // episodes (FROM S04E19…E28). Open the show instead: the visit fetches
      // the real structure, and marking resumes verified
      router.push(`/show/${sp.tvdbId}`);
      return;
    }
    markWatchedWithPrompt(sp.tvdbId, next.season, next.episode, () => setTick((t) => t + 1));
  };

  // shows imported but never opened have no metadata yet — without it the
  // watch list can't know where seasons end (the "ghost episodes" bug). And
  // metadata frozen at its first fetch never learns about new seasons, so
  // stale entries ride the same background sweep — a batch at a time, each
  // show once per session.
  // libraries imported before 1.1.1 have no preserved original export, so
  // silent self-repair can't reach them — one guided re-import fixes that
  // forever (and imports are merge-safe: nothing gets erased or duplicated)
  const [needsOriginal, setNeedsOriginal] = useState(false);
  /*
   * AN IMPORT THAT KEPT THE OPINIONS AND LOST THE HISTORY.
   *
   * Read on focus rather than in render: three COUNTs, and the Compiler would
   * hold the first answer past the re-import that fixes it — which is the one
   * moment this must change.
   */
  const [lostHistory, setLostHistory] = useState(false);
  /* The importer's own counts, so the banner can name the failure rather than
     only report it. Absent on a library imported before this shipped. */
  const [diagnosis, setDiagnosis] = useState<{ verdict?: string; episodeRows?: number } | null>(null);
  useFocusEffect(
    useCallback(() => {
      try {
        const counts = archiveCounts();
        setLostHistory(
          importLostHistory({
            owner: libraryOwner(),
            episodes: getTotals().episodes,
            moviesWatched: getMovieTotals().watched,
            ratings: counts.episodeRatings + counts.movieRatings,
            comments: counts.comments,
          }),
        );
        const raw = getMeta('importDiagnosis');
        setDiagnosis(raw ? (JSON.parse(raw) as { verdict?: string; episodeRows?: number }) : null);
      } catch {
        // A banner is never worth a crash on the first screen of the app.
      }
    }, []),
  );
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (libraryOwner() !== 'imported') return;
        if ((await hasOriginalZip()) === 'no' && alive) setNeedsOriginal(true);
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  const metaTried = useRef(new Set<number>());
  useEffect(() => {
    const wanted = getShowProgress()
      .filter((s) => {
        if (!(s.followed || s.watched > 0 || s.episodesSeen > 0) || metaTried.current.has(s.tvdbId)) return false;
        const m = showMeta(s.tvdbId);
        return m == null || showMetaIsStale(m);
      })
      .slice(0, 12);
    if (wanted.length === 0) return;
    for (const s of wanted) metaTried.current.add(s.tvdbId);
    void Promise.allSettled(wanted.map((s) => fetchShowMeta(s.tvdbId))).then((results) => {
      /*
       * A FETCH THAT FAILED IS NOT A FETCH THAT HAPPENED.
       *
       * `metaTried` was stamped before the request and `allSettled` swallows
       * rejections, so one bad response meant that show was never asked about
       * again for the rest of the session. Reported as "One Piece shows no +20
       * badge": `airedTotalOf` returns nothing without metadata, deliberately,
       * so a caught-up show never displays a phantom remainder — and a show
       * whose fetch had quietly failed looked exactly the same.
       *
       * Failures are forgotten so a later pass can try again. NO TICK when
       * nothing arrived, which is what keeps this from spinning: the effect
       * re-runs on `tick`, so a batch that failed entirely simply waits for
       * the next focus rather than retrying immediately, for ever.
       */
      let landed = 0;
      results.forEach((r, i) => {
        const id = wanted[i]!.tvdbId;
        if (r.status === 'fulfilled' && showMeta(id) != null) landed++;
        else metaTried.current.delete(id);
      });
      if (landed > 0) setTick((t) => t + 1);
    });
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

  // Upcoming: every announced episode of your followed shows for the next 90
  // days, straight from the air dates already cached in metadata — the same
  // data the episode notifications schedule from
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const upcoming = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    type Up = { showId: number; showName: string; poster: string | null; season: number; episode: number; title: string | null; air: string; still: string | null };
    const out: Up[] = [];
    for (const sp of getShowProgress()) {
      if (!sp.followed || sp.archived) continue;
      const m = showMeta(sp.tvdbId);
      if (!m) continue;
      for (const [key, em] of Object.entries(m.episodes)) {
        const air = em?.air;
        if (!air || air <= today || air > horizon) continue;
        const [se, ep] = key.split('-').map(Number);
        if (!se || se < 1) continue;
        out.push({ showId: sp.tvdbId, showName: sp.name, poster: sp.posterUrl, season: se, episode: ep, title: em.title ?? null, air, still: em.still ?? null });
      }
    }
    out.sort((a, b) => a.air.localeCompare(b.air) || a.showName.localeCompare(b.showName) || a.episode - b.episode);
    return out.slice(0, 150);
  }, [tick]);

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
        labels={{ 'Watch List': t('shows.tabs.watchList'), Upcoming: t('shows.tabs.upcoming') }}
        active={tab}
        onChange={(nextTab) => {
          if (nextTab === 'Watch List') anchored.current = false;
          setTab(nextTab);
        }}
      />

      {needsOriginal && (
        <Pressable style={styles.upgradeBanner} onPress={() => router.push('/import')}>
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.yellow} />
          <View style={{ flex: 1 }}>
            <Text style={styles.upgradeTitle}>{t('shows.upgradeBannerTitle')}</Text>
            <Text style={styles.upgradeText}>{t('shows.upgradeBannerBody')}</Text>
          </View>
          <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.dim} />
        </Pressable>
      )}

      {/* Above the list rather than in its header: ListHeaderComponent is
          measured to anchor the scroll past watched history, and anything else
          inside it moves that anchor. */}
      {/* SAID OUT LOUD, because the alternative is what it did to the first
          person outside the test accounts who joined the community: their
          ratings and comments went up, their shelves could not, and their
          profile showed nothing with no explanation anywhere. The phone knew.
          It just never said. */}
      {lostHistory && (
        <Pressable style={styles.upgradeBanner} onPress={() => router.push('/import')}>
          <Ionicons name="alert-circle-outline" size={20} color={colors.yellow} />
          <View style={{ flex: 1 }}>
            <Text style={styles.upgradeTitle}>{t('shows.lostHistoryTitle')}</Text>
            <Text style={styles.upgradeText}>{t('shows.lostHistoryBody')}</Text>
            {/* The numbers, when this build was the one that imported. They are
                what turns "it did not work" into a bug somebody can name. */}
            {diagnosis?.verdict === 'episodes_all_rejected' && (
              <Text style={styles.upgradeText}>
                {t('shows.lostHistoryRejected', { rows: diagnosis.episodeRows ?? 0 })}
              </Text>
            )}
            {diagnosis?.verdict === 'no_episode_file' && (
              <Text style={styles.upgradeText}>{t('shows.lostHistoryNoFile')}</Text>
            )}
          </View>
          <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.dim} />
        </Pressable>
      )}

      {tab === 'Watch List' && <MemoryCard />}

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
                    <Text style={styles.sectionPill}>{t('shows.watchedHistorySection')}</Text>
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
                            {em?.title ?? t('show.episodeFallbackTitle', { n: w.episode })}
                          </Text>
                        </View>
                        <View style={{ paddingEnd: 12 }}>
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
              title={t('shows.emptyTrackingTitle')}
              caption={t('shows.emptyTrackingCaption')}
              cta={t('shows.discoverShows')}
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
              const next = realNext(sp);
              const { season: nextS, episode: nextE } = nextCoords(sp, next);
              const em = episodeMeta(sp.tvdbId, nextS, nextE);
              const left = episodesLeft(sp);
              const thumbUri = em?.still ?? sp.posterUrl;
              return (
                <Pressable
                  style={styles.card}
                  onPress={() =>
                    // metadata still loading — the coords are an unverified
                    // guess, so open the show (which fetches the real
                    // structure) rather than a possibly-nonexistent episode,
                    // same guard markNext uses
                    next === 'unknown'
                      ? router.push(`/show/${sp.tvdbId}`)
                      : router.push(`/episode/${sp.tvdbId}-s${nextS}e${nextE}`)
                  }
                >
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
                      {code(sp, next)}
                      {left != null && left > 0 && <Text style={styles.epPlus}>  +{left}</Text>}
                    </Text>
                    <Text style={styles.epSub} numberOfLines={1}>
                      {em?.title ??
                        (sp.lastWatchedAt ? t('shows.lastWatched', { date: shortDate(sp.lastWatchedAt) }) : t('shows.notStartedYet'))}
                    </Text>
                  </View>
                  <View style={{ paddingEnd: 12 }}>
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
                {item.shows.length < gridCols &&
                  Array.from({ length: gridCols - item.shows.length }).map((_, i) => <View key={i} style={{ flex: 1 }} />)}
              </View>
            );
          }}
        />
        {/* the list/grid toggle floats at the top right, like the real app */}
        <Pressable
          style={styles.gridToggle}
          hitSlop={10}
          onPress={() => {
            const next = view === 'list' ? 'grid' : 'list';
            setView(next);
            setMeta('showsView', next);
          }}>
          <Ionicons name={view === 'list' ? 'grid' : 'list'} size={22} color={colors.text} />
        </Pressable>
        </View>
      ) : upcoming.length === 0 ? (
        <EmptyState
          title={t('shows.emptyUpcomingTitle')}
          caption={t('shows.emptyUpcomingCaption')}
          cta={t('shows.browseAllShows')}
          onPress={() => router.push('/discover-more')}
        />
      ) : (
        <FlatList
          data={upcoming}
          keyExtractor={(u) => `${u.showId}-${u.season}-${u.episode}`}
          contentContainerStyle={{ paddingBottom: 90 }}
          renderItem={({ item: u, index }) => {
            const first = index === 0 || upcoming[index - 1].air !== u.air;
            const d = new Date(`${u.air}T12:00:00`);
            const today = new Date();
            const days = Math.round((d.getTime() - new Date(today.toDateString()).getTime()) / 86400000);
            const label =
              days <= 0 ? t('shows.today') : days === 1 ? t('shows.tomorrow') : d.toLocaleDateString(currentLocale(), { weekday: 'short', month: 'short', day: 'numeric' });
            return (
              <View>
                {first && <Text style={styles.upcomingDate}>{label}</Text>}
                <Pressable
                  style={styles.card}
                  onPress={() => router.push(`/episode/${u.showId}-s${u.season}e${u.episode}`)}>
                  <View style={styles.thumb}>
                    {(u.still ?? u.poster) && (
                      <Image source={{ uri: u.still ?? u.poster! }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                    )}
                  </View>
                  <View style={styles.cardBody}>
                    <View style={styles.showPill}>
                      <Text style={styles.showPillText} numberOfLines={1}>{u.showName.toUpperCase()} ›</Text>
                    </View>
                    <Text style={styles.epCode}>
                      S{String(u.season).padStart(2, '0')} | E{String(u.episode).padStart(2, '0')}
                    </Text>
                    <Text style={styles.epSub} numberOfLines={1}>{u.title ?? t('show.episodeFallbackTitle', { n: u.episode })}</Text>
                  </View>
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  upgradeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    marginHorizontal: space.lg,
    marginTop: 8,
    padding: 12,
  },
  upgradeTitle: { color: colors.text, fontSize: 14, fontWeight: '700', marginBottom: 2 },
  upgradeText: { color: colors.dim, fontSize: 12, lineHeight: 16 },
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
  gridToggle: { position: 'absolute', end: 14, top: 16 },
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
    backgroundColor: colors.card,
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
  upcomingDate: {
    color: colors.yellow,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginHorizontal: space.md,
    marginTop: 14,
    marginBottom: 8,
  },
});
