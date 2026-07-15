import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { DEFAULT_MOVIE_FILTERS, getMovieFilters, setMovieFilters, type MovieFilters } from '@/filters-store';
import { colors, radius, space } from '@/theme';

const SORTS: { label: string; value: MovieFilters['sort'] }[] = [
  { label: 'Last Watched', value: 'lastWatched' },
  { label: 'Last Added', value: 'lastAdded' },
  { label: 'Alphabetical', value: 'alpha' },
];
const PROGRESS: { label: string; value: MovieFilters['progress'] }[] = [
  { label: 'All', value: 'all' },
  { label: 'Watched', value: 'watched' },
  { label: 'Not watched', value: 'notWatched' },
];

export default function MovieFiltersSheet() {
  const current = getMovieFilters();
  const [sort, setSort] = useState<MovieFilters['sort']>(current.sort);
  const [progress, setProgress] = useState<MovieFilters['progress']>(current.progress);

  // backdrop fades via the route; the sheet slides up on its own
  const slide = useRef(new Animated.Value(420)).current;
  useEffect(() => {
    Animated.timing(slide, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slide]);

  return (
    <Pressable style={styles.backdrop} onPress={() => router.back()}>
      <Animated.View style={{ transform: [{ translateY: slide }] }}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>Sort by</Text>
          <View style={styles.chipRow}>
            {SORTS.map((s2) => (
              <Pressable
                key={s2.value}
                style={[styles.chip, s2.value === sort ? { backgroundColor: colors.yellow } : { backgroundColor: '#D6D6DA' }]}
                onPress={() => setSort(s2.value)}>
                <Text style={{ color: '#141414', fontWeight: '600', fontSize: 14 }}>{s2.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.sectionDivider} />
          <Text style={styles.title}>Progress</Text>
          {PROGRESS.map((p) => (
            <Pressable key={p.value} style={styles.radioRow} onPress={() => setProgress(p.value)}>
              <Text style={{ color: colors.text, fontSize: 16 }}>{p.label}</Text>
              {p.value === progress ? (
                <View style={styles.radioOn}>
                  <Ionicons name="checkmark" size={15} color={colors.onYellow} />
                </View>
              ) : (
                <View style={styles.radioOff} />
              )}
            </Pressable>
          ))}

          <View style={styles.footer}>
            <Pressable
              style={styles.resetBtn}
              onPress={() => {
                setSort(DEFAULT_MOVIE_FILTERS.sort);
                setProgress(DEFAULT_MOVIE_FILTERS.progress);
              }}>
              <Text style={{ color: colors.text, fontWeight: '700', letterSpacing: 1, fontSize: 13 }}>RESET</Text>
            </Pressable>
            <Pressable
              style={styles.applyBtn}
              onPress={() => {
                setMovieFilters({ sort, progress });
                router.back();
              }}>
              <Text style={{ color: colors.onYellow, fontWeight: '700', letterSpacing: 1, fontSize: 13 }}>APPLY</Text>
            </Pressable>
          </View>
        </Pressable>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#232326',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: space.xl,
    paddingTop: 16,
    paddingBottom: 26,
  },
  title: { color: colors.text, fontSize: 19, fontWeight: '800', marginBottom: 10 },
  sectionDivider: { height: 1, backgroundColor: '#3A3A3E', marginVertical: 14, marginHorizontal: -20 },
  chipRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  chip: { borderRadius: radius.pill, paddingVertical: 10, paddingHorizontal: 18 },
  radioRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333338',
  },
  radioOn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOff: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: colors.faint },
  footer: { flexDirection: 'row', gap: 12, marginTop: 16 },
  resetBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.faint,
    borderRadius: radius.pill,
    alignItems: 'center',
    paddingVertical: 13,
  },
  applyBtn: { flex: 1, backgroundColor: colors.yellow, borderRadius: radius.pill, alignItems: 'center', paddingVertical: 14 },
});
