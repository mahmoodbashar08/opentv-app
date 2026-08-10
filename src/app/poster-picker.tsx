import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, I18nManager, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Screen } from '@/components/ui';
import { setMovieBackdropOverride, setMoviePosterOverride, setShowBackdrop, setShowPoster } from '@/db';
import { tmdb } from '@/tmdb';
import { gridGeometry } from '@/pure';
import { colors, space } from '@/theme';
import { t } from '@/i18n';

const GAP = 10;
// derived per render from the live window width; the two width-bearing styles
// below moved out of StyleSheet.create for the same reason — a baked value
// can't follow a rotation
const posterCols = (w: number) => gridGeometry(w, space.lg, GAP).cols;
const posterWidth = (w: number) => (w - 2 * space.lg - (posterCols(w) - 1) * GAP) / posterCols(w);
const backdropWidth = (w: number) => w - 2 * space.lg;

// Pick a different poster or backdrop for a SHOW OR A FILM, from TheTVDB's
// artwork first and TMDB's second. Choices are stored as overrides so a
// metadata refresh never undoes them.
//
// ONE SCREEN FOR BOTH, because the only differences are which id is held, which
// endpoint answers, and which setter records the choice. A second screen would
// be the same grid, the same sort and the same save, drifting apart quietly.
//
// A film is addressed by `movie=<name>` — `movies` has no numeric primary key,
// and a row may carry neither a tmdbId nor a tvdbId when nothing matched it.
export default function PosterPickerScreen() {
  const { width: W } = useWindowDimensions();
  const POSTER_W = posterWidth(W);
  const { tvdbId, tmdbId: tmdbHint, name, movie } = useLocalSearchParams<{
    tvdbId?: string;
    tmdbId?: string;
    name?: string;
    /** Present for a film: the row's name, which is what identifies it. */
    movie?: string;
  }>();
  const filmName = movie ? decodeURIComponent(movie) : null;
  const [posters, setPosters] = useState<string[] | null>(null);
  const [backdrops, setBackdrops] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      // TheTVDB first — it is keyed by an id we already hold, so there is no
      // lookup at all, and it returns full URLs rather than paths.
      //
      // FILMS USE DIFFERENT TYPE IDS. 14/15 rather than 2/3; asking for 2/3 on
      // a film returns an empty list rather than an error, which would look
      // exactly like a film with no artwork.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const t = require('@/tvdb') as typeof import('@/tvdb');
        const id = Number(tvdbId);
        if (id > 0) {
          const [p, b] = await Promise.all([
            t.tvdbArtworks(id, filmName ? 'movies' : 'series', filmName ? t.TVDB_ART_MOVIE_POSTER : t.TVDB_ART_POSTER, 30),
            t.tvdbArtworks(id, filmName ? 'movies' : 'series', filmName ? t.TVDB_ART_MOVIE_BACKGROUND : t.TVDB_ART_BACKGROUND, 18),
          ]);
          if (p.length || b.length) {
            setPosters(p);
            setBackdrops(b);
            return;
          }
        }
      } catch {
        // fall through to TMDB
      }
      try {
        let id = tmdbHint ? Number(tmdbHint) || null : null;
        if (!id && tvdbId) {
          const found = await tmdb<{ tv_results: { id: number }[]; movie_results: { id: number }[] }>(
            `/find/${tvdbId}?external_source=tvdb_id`,
          );
          id = (filmName ? found.movie_results?.[0]?.id : found.tv_results?.[0]?.id) ?? null;
        }
        if (!id) {
          setPosters([]);
          return;
        }
        const res = await tmdb<{
          posters?: { file_path: string; vote_count?: number }[];
          backdrops?: { file_path: string; vote_count?: number }[];
        }>(`/${filmName ? 'movie' : 'tv'}/${id}/images`);
        const byVotes = (a: { vote_count?: number }, b: { vote_count?: number }) => (b.vote_count ?? 0) - (a.vote_count ?? 0);
        setPosters([...(res.posters ?? [])].sort(byVotes).slice(0, 30).map((p) => `https://image.tmdb.org/t/p/w500${p.file_path}`));
        setBackdrops([...(res.backdrops ?? [])].sort(byVotes).slice(0, 18).map((b) => `https://image.tmdb.org/t/p/w1280${b.file_path}`));
      } catch {
        setPosters([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvdbId, tmdbHint, filmName]);

  const choose = (fn: () => void) => {
    // A film needs no tvdbId — it may not have one. Its name is its identity.
    if (saving || (!tvdbId && !filmName)) return;
    setSaving(true);
    fn();
    router.back();
  };

  return (
    <Screen>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headTitle} numberOfLines={1}>
          {filmName ?? name ?? t('posterPicker.customizeArtwork')}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {posters == null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.yellow} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 44 }}>
          <Text style={styles.section}>{t('posterPicker.postersSection')}</Text>
          {posters.length === 0 ? (
            <Text style={styles.empty}>{t('posterPicker.noPosters')}</Text>
          ) : (
            <View style={styles.grid}>
              {posters.map((p) => (
                <Pressable
                  key={p}
                  disabled={saving}
                  onPress={() =>
                    choose(() =>
                      filmName ? setMoviePosterOverride(filmName, p) : setShowPoster(Number(tvdbId), p),
                    )
                  }>
                  <Image source={{ uri: p }} style={[styles.poster, { width: POSTER_W }]} contentFit="cover" cachePolicy="disk" />
                </Pressable>
              ))}
            </View>
          )}

          <Text style={[styles.section, { marginTop: 22 }]}>{t('posterPicker.backdropsSection')}</Text>
          {backdrops.length === 0 ? (
            <Text style={styles.empty}>{t('posterPicker.noBackdrops')}</Text>
          ) : (
            <View style={{ gap: GAP }}>
              {backdrops.map((b) => (
                <Pressable
                  key={b}
                  disabled={saving}
                  onPress={() =>
                    choose(() =>
                      filmName ? setMovieBackdropOverride(filmName, b) : setShowBackdrop(Number(tvdbId), b),
                    )
                  }>
                  <Image source={{ uri: b }} style={[styles.backdrop, { width: backdropWidth(W) }]} contentFit="cover" cachePolicy="disk" />
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
  poster: { aspectRatio: 2 / 3, borderRadius: 6, backgroundColor: colors.raise },
  backdrop: { aspectRatio: 16 / 9, borderRadius: 6, backgroundColor: colors.raise },
  empty: { color: colors.dim, fontSize: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
