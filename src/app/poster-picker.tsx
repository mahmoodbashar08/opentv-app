import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui';
import { setShowBackdrop, setShowPoster } from '@/db';
import { tmdb } from '@/tmdb';
import { colors, space } from '@/theme';

const W = Dimensions.get('window').width;
const COL = 3;
const GAP = 10;
const POSTER_W = (W - 2 * space.lg - (COL - 1) * GAP) / COL;

// Pick a different poster or backdrop for a show from TMDB's own artwork.
// Choices are stored as overrides so a metadata refresh never undoes them.
export default function PosterPickerScreen() {
  const { tvdbId, tmdbId: tmdbHint, name } = useLocalSearchParams<{ tvdbId: string; tmdbId?: string; name?: string }>();
  const [posters, setPosters] = useState<string[] | null>(null);
  const [backdrops, setBackdrops] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        let id = tmdbHint ? Number(tmdbHint) || null : null;
        if (!id && tvdbId) {
          const found = await tmdb<{ tv_results: { id: number }[] }>(`/find/${tvdbId}?external_source=tvdb_id`);
          id = found.tv_results?.[0]?.id ?? null;
        }
        if (!id) {
          setPosters([]);
          return;
        }
        const res = await tmdb<{
          posters?: { file_path: string; vote_count?: number }[];
          backdrops?: { file_path: string; vote_count?: number }[];
        }>(`/tv/${id}/images`);
        const byVotes = (a: { vote_count?: number }, b: { vote_count?: number }) => (b.vote_count ?? 0) - (a.vote_count ?? 0);
        setPosters([...(res.posters ?? [])].sort(byVotes).slice(0, 30).map((p) => p.file_path));
        setBackdrops([...(res.backdrops ?? [])].sort(byVotes).slice(0, 18).map((b) => b.file_path));
      } catch {
        setPosters([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvdbId, tmdbHint]);

  const choose = (fn: () => void) => {
    if (saving || !tvdbId) return;
    setSaving(true);
    fn();
    router.back();
  };

  return (
    <Screen>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headTitle} numberOfLines={1}>
          {name ?? 'Customize artwork'}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {posters == null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.yellow} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 44 }}>
          <Text style={styles.section}>POSTERS</Text>
          {posters.length === 0 ? (
            <Text style={styles.empty}>No posters available for this show.</Text>
          ) : (
            <View style={styles.grid}>
              {posters.map((p) => (
                <Pressable
                  key={p}
                  disabled={saving}
                  onPress={() => choose(() => setShowPoster(Number(tvdbId), `https://image.tmdb.org/t/p/w500${p}`))}>
                  <Image source={{ uri: `https://image.tmdb.org/t/p/w342${p}` }} style={styles.poster} contentFit="cover" cachePolicy="disk" />
                </Pressable>
              ))}
            </View>
          )}

          <Text style={[styles.section, { marginTop: 22 }]}>BACKDROPS</Text>
          {backdrops.length === 0 ? (
            <Text style={styles.empty}>No backdrops available for this show.</Text>
          ) : (
            <View style={{ gap: GAP }}>
              {backdrops.map((b) => (
                <Pressable
                  key={b}
                  disabled={saving}
                  onPress={() => choose(() => setShowBackdrop(Number(tvdbId), `https://image.tmdb.org/t/p/w1280${b}`))}>
                  <Image source={{ uri: `https://image.tmdb.org/t/p/w780${b}` }} style={styles.backdrop} contentFit="cover" cachePolicy="disk" />
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {saving && (
        <View style={[StyleSheet.absoluteFill as object, styles.center, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <ActivityIndicator color={colors.yellow} size="large" />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    gap: 12,
  },
  headTitle: { color: colors.text, fontSize: 17, fontWeight: '600', flex: 1, textAlign: 'center' },
  section: { color: colors.dim, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.5, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  poster: { width: POSTER_W, aspectRatio: 2 / 3, borderRadius: 6, backgroundColor: colors.raise },
  backdrop: { width: W - 2 * space.lg, aspectRatio: 16 / 9, borderRadius: 6, backgroundColor: colors.raise },
  empty: { color: colors.dim, fontSize: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
