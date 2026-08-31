/**
 * Discover more — this week's trending, fetched live on-device like every
 * other lookup. TheTVDB first, TMDB as fallback. Tap a card to open it; the +
 * adds it straight to your library / watchlist.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ContentColumn, NavHeader, Screen, TopTabs } from '@/components/ui';
import { addMovieToWatchlist, addShow, inLibrary } from '@/db';
import { trendingByKind, tvdbIdFor, type CatalogItem } from '@/catalog';
import { alertNotOnTvdb } from '@/not-on-tvdb';
import { movieRoute } from '@/pure';
import { colors, radius, space } from '@/theme';
import { t } from '@/i18n';

const TABS = ['Shows', 'Movies'] as const;

type Trend = CatalogItem;

export default function DiscoverMoreScreen() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  const [tab, setTab] = useState<(typeof TABS)[number]>(type === 'movies' ? 'Movies' : 'Shows');
  const [shows, setShows] = useState<Trend[] | null>(null);
  const [movies, setMovies] = useState<Trend[] | null>(null);
  // Tapped during THIS visit. What is already yours is a separate question,
  // answered against the database by `inLib` below — the set alone said "not
  // added" about everything on every mount, which is what was reported.
  const [added, setAdded] = useState<Set<string>>(new Set());

  /**
   * Is this already tracked?
   *
   * Asked per card at render. Cheap enough inline: this screen shows a couple
   * of dozen cards and the reads are indexed, while one memo over the whole
   * trending list would go stale the moment somebody adds something elsewhere
   * and comes back.
   */
  const inLib = (x: { title: string; tvdbId?: number | null; tmdbId?: number | null; sub?: string | null }) =>
    inLibrary({
      kind: tab === 'Shows' ? 'show' : 'movie',
      name: x.title,
      tvdbId: x.tvdbId,
      tmdbId: x.tmdbId,
      year: x.sub,
    });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { shows: sh, movies: mv } = await trendingByKind();
        if (!alive) return;
        setShows(sh);
        setMovies(mv);
      } catch {
        if (alive) {
          setShows([]);
          setMovies([]);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const openShow = async (t: Trend) => {
    const tvdbId = await tvdbIdFor(t);
    if (!tvdbId) return alertNotOnTvdb(t.title);
    router.push(`/show/${tvdbId}${t.tmdbId ? `?tmdbId=${t.tmdbId}` : ''}`);
  };

  const addTrend = async (t: Trend) => {
    const key = `${tab}-${t.key}`;
    if (added.has(key)) return;
    try {
      if (tab === 'Shows') {
        const tvdbId = await tvdbIdFor(t);
        if (!tvdbId) return alertNotOnTvdb(t.title);
        addShow(tvdbId, t.title, t.poster);
      } else {
        addMovieToWatchlist(t.title, t.poster, t.sub || null, t.tmdbId, t.tvdbId);
      }
      setAdded((prev) => new Set(prev).add(key));
    } catch {}
  };

  const list = tab === 'Shows' ? shows : movies;

  return (
    <Screen>
      <NavHeader title={t('discover.title')} />
      <TopTabs
        tabs={TABS}
        labels={{ Shows: t('discover.tabs.shows'), Movies: t('discover.tabs.movies') }}
        active={tab}
        onChange={setTab}
      />
      {list == null ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.yellow} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 60 }}>
          {/* A single column of large artwork cards: widening the column does not
              show MORE cards, it just inflates each one — on a 13" iPad one card
              filled the screen. Capped so a card stays a card. */}
          <ContentColumn>
          <Text style={styles.section}>{t('discover.trendingThisWeek')}</Text>
          {list.map((t) => (
            <Pressable
              key={t.key}
              style={styles.card}
              onPress={() =>
                tab === 'Shows'
                  ? void openShow(t)
                  : router.push(movieRoute(t.title, { tmdbId: t.tmdbId, tvdbId: t.tvdbId, poster: t.poster, year: t.sub }) as never)
              }>
              <View style={styles.art}>
                {t.backdrop || t.poster ? (
                  <Image source={{ uri: t.backdrop ?? t.poster ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                ) : (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.card }]} />
                )}
                <View style={styles.shade} />
                <Pressable style={styles.addBtn} hitSlop={8} onPress={() => void addTrend(t)}>
                  <Ionicons
                    name={added.has(`${tab}-${t.key}`) || inLib(t) ? 'checkmark' : 'add'}
                    size={20}
                    color={colors.yellow}
                  />
                </Pressable>
                <View style={styles.meta}>
                  <Text style={styles.title} numberOfLines={1}>{t.title}</Text>
                  {!!t.sub && <Text style={styles.sub}>{t.sub}</Text>}
                </View>
                {/* only TMDB gives a 0-100 rating; TheTVDB's score is a raw
                    popularity count, so the badge is simply omitted there */}
                {t.tmdbId != null && t.votes > 0 && (
                  <View style={styles.match}>
                    <View style={styles.tBadge}>
                      <Text style={{ fontWeight: '800', color: colors.onYellow, fontSize: 12 }}>T</Text>
                    </View>
                    <Text style={{ color: colors.yellow, fontWeight: '800', fontSize: 14 }}>{t.votes}%</Text>
                  </View>
                )}
              </View>
            </Pressable>
          ))}
          </ContentColumn>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    color: colors.yellow,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginHorizontal: space.lg,
    marginBottom: 10,
  },
  card: { marginHorizontal: space.lg, marginBottom: 14, borderRadius: radius.card, overflow: 'hidden' },
  art: { aspectRatio: 16 / 9, justifyContent: 'flex-end' },
  shade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 70,
    backgroundColor: 'rgba(0,0,0,.45)',
  },
  addBtn: {
    position: 'absolute',
    top: 12,
    end: 12,
    width: 34,
    height: 34,
    borderWidth: 2,
    borderColor: colors.yellow,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { position: 'absolute', start: 14, bottom: 12, end: 80 },
  title: { color: colors.text, fontSize: 21, fontWeight: '800' },
  sub: { color: colors.text, fontSize: 13, marginTop: 1 },
  match: { position: 'absolute', end: 14, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 5 },
  tBadge: { backgroundColor: colors.yellow, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
});
