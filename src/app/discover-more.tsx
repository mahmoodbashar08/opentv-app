/**
 * Discover more — real trending from TMDB (this week), fetched live on-device
 * like every other lookup. Tap a card to open it; the + adds it straight to
 * your library / watchlist.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { NavHeader, Screen, TopTabs } from '@/components/ui';
import { addMovieToWatchlist, addShow } from '@/db';
import { tmdb } from '@/tmdb';
import { colors, radius, space } from '@/theme';

const TABS = ['Shows', 'Movies'] as const;

type Trend = {
  id: number;
  name: string;
  backdrop: string | null;
  poster: string | null;
  year: string | null;
  score: number; // 0-100
};

const img = (p: string | null | undefined, size: string) => (p ? `https://image.tmdb.org/t/p/${size}${p}` : null);

export default function DiscoverMoreScreen() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  const [tab, setTab] = useState<(typeof TABS)[number]>(type === 'movies' ? 'Movies' : 'Shows');
  const [shows, setShows] = useState<Trend[] | null>(null);
  const [movies, setMovies] = useState<Trend[] | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const tv = await tmdb<{ results: { id: number; name?: string; backdrop_path?: string; poster_path?: string; first_air_date?: string; vote_average?: number }[] }>(
          '/trending/tv/week',
        );
        if (alive)
          setShows(
            tv.results.slice(0, 20).map((r) => ({
              id: r.id,
              name: r.name ?? '?',
              backdrop: img(r.backdrop_path, 'w1280'),
              poster: img(r.poster_path, 'w500'),
              year: r.first_air_date?.slice(0, 4) ?? null,
              score: Math.round((r.vote_average ?? 0) * 10),
            })),
          );
      } catch {
        if (alive) setShows([]);
      }
      try {
        const mv = await tmdb<{ results: { id: number; title?: string; backdrop_path?: string; poster_path?: string; release_date?: string; vote_average?: number }[] }>(
          '/trending/movie/week',
        );
        if (alive)
          setMovies(
            mv.results.slice(0, 20).map((r) => ({
              id: r.id,
              name: r.title ?? '?',
              backdrop: img(r.backdrop_path, 'w1280'),
              poster: img(r.poster_path, 'w500'),
              year: r.release_date?.slice(0, 4) ?? null,
              score: Math.round((r.vote_average ?? 0) * 10),
            })),
          );
      } catch {
        if (alive) setMovies([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const openShow = async (t: Trend) => {
    try {
      const ext = await tmdb<{ tvdb_id?: number }>(`/tv/${t.id}/external_ids`);
      if (ext.tvdb_id) router.push(`/show/${ext.tvdb_id}?tmdbId=${t.id}`);
    } catch {}
  };

  const addTrend = async (t: Trend) => {
    const key = `${tab}-${t.id}`;
    if (added.has(key)) return;
    try {
      if (tab === 'Shows') {
        const ext = await tmdb<{ tvdb_id?: number }>(`/tv/${t.id}/external_ids`);
        if (!ext.tvdb_id) return;
        addShow(ext.tvdb_id, t.name, t.poster);
      } else {
        addMovieToWatchlist(t.name, t.poster, t.year, t.id);
      }
      setAdded((prev) => new Set(prev).add(key));
    } catch {}
  };

  const list = tab === 'Shows' ? shows : movies;

  return (
    <Screen>
      <NavHeader title="Discover more" />
      <TopTabs tabs={TABS} active={tab} onChange={setTab} />
      {list == null ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.yellow} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 60 }}>
          <Text style={styles.section}>Trending this week</Text>
          {list.map((t) => (
            <Pressable key={t.id} style={styles.card} onPress={() => (tab === 'Shows' ? void openShow(t) : router.push(`/movie/${encodeURIComponent(t.name)}`))}>
              <View style={styles.art}>
                {t.backdrop ? (
                  <Image source={{ uri: t.backdrop }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                ) : (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: '#22262E' }]} />
                )}
                <View style={styles.shade} />
                <Pressable style={styles.addBtn} hitSlop={8} onPress={() => void addTrend(t)}>
                  <Ionicons
                    name={added.has(`${tab}-${t.id}`) ? 'checkmark' : 'add'}
                    size={20}
                    color={colors.yellow}
                  />
                </Pressable>
                <View style={styles.meta}>
                  <Text style={styles.title} numberOfLines={1}>{t.name}</Text>
                  {t.year && <Text style={styles.sub}>{t.year}</Text>}
                </View>
                {t.score > 0 && (
                  <View style={styles.match}>
                    <View style={styles.tBadge}>
                      <Text style={{ fontWeight: '800', color: colors.onYellow, fontSize: 12 }}>T</Text>
                    </View>
                    <Text style={{ color: colors.yellow, fontWeight: '800', fontSize: 14 }}>{t.score}%</Text>
                  </View>
                )}
              </View>
            </Pressable>
          ))}
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
    right: 12,
    width: 34,
    height: 34,
    borderWidth: 2,
    borderColor: colors.yellow,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { position: 'absolute', left: 14, bottom: 12, right: 80 },
  title: { color: colors.text, fontSize: 21, fontWeight: '800' },
  sub: { color: '#E3E3E8', fontSize: 13, marginTop: 1 },
  match: { position: 'absolute', right: 14, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 5 },
  tBadge: { backgroundColor: colors.yellow, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
});
