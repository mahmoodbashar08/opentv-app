import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';

import { Poster } from '@/components/poster';
import { NavHeader, Screen } from '@/components/ui';
import { getMovies, type MovieRow } from '@/db';
import { DEFAULT_MOVIE_FILTERS, setMovieFilters, useMovieFilters } from '@/filters-store';
import { colors, radius, space } from '@/theme';

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export default function AllMoviesScreen() {
  // live from the database — un/marking a movie elsewhere updates the grids
  const [movies, setMovies] = useState(getMovies());
  useFocusEffect(
    useCallback(() => {
      setMovies(getMovies());
    }, []),
  );
  const filters = useMovieFilters();
  // filters are per-visit: opening the page fresh starts from the defaults
  useEffect(() => {
    setMovieFilters(DEFAULT_MOVIE_FILTERS);
  }, []);

  const sections = useMemo(() => {
    const bySort = (list: MovieRow[], watched: boolean) => {
      const l = [...list];
      if (filters.sort === 'alpha') l.sort((a, b) => a.name.localeCompare(b.name));
      else if (filters.sort === 'lastAdded') l.sort((a, b) => (b.addedAt ?? b.watchedAt ?? '').localeCompare(a.addedAt ?? a.watchedAt ?? ''));
      else l.sort((a, b) => ((b.watchedAt ?? b.addedAt ?? '') < (a.watchedAt ?? a.addedAt ?? '') ? -1 : 1));
      return l;
    };
    const watched = bySort(movies.filter((m) => m.watchedAt != null), true);
    const planned = bySort(movies.filter((m) => m.watchedAt == null), false);

    const out: { title: string; data: MovieRow[][] }[] = [];
    if (filters.progress !== 'notWatched' && watched.length) out.push({ title: 'WATCHED', data: chunk(watched, 3) });
    if (filters.progress !== 'watched' && planned.length) out.push({ title: 'NOT WATCHED', data: chunk(planned, 3) });
    return out;
  }, [movies, filters]);

  // applying filters jumps back to the top of the list
  const listRef = useRef<SectionList<MovieRow[]>>(null);
  useEffect(() => {
    if (sections.length) {
      listRef.current?.scrollToLocation({ sectionIndex: 0, itemIndex: 0, viewOffset: 44, animated: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  return (
    <Screen>
      <NavHeader title="Movies" right={<Ionicons name="eye-outline" size={20} color={colors.yellow} />} />
      <View style={{ flex: 1 }}>
        <SectionList
          ref={listRef}
          sections={sections}
          keyExtractor={(row) => row.map((m) => m.name).join('|')}
          stickySectionHeadersEnabled
          contentContainerStyle={{ paddingBottom: 70 }}
          renderSectionHeader={({ section }) => (
            // the pill stays stuck at the top until the next section takes over
            <View style={styles.pillRow} pointerEvents="none">
              <Text style={styles.sectionPill}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item: row }) => (
            <View style={styles.gridRow}>
              {row.map((m) => (
                <Pressable key={m.name} style={{ flex: 1 }} onPress={() => router.push(`/movie/${encodeURIComponent(m.name)}`)}>
                  <Poster name={m.name} uri={m.poster} />
                </Pressable>
              ))}
              {row.length < 3 && Array.from({ length: 3 - row.length }).map((_, i) => <View key={i} style={{ flex: 1 }} />)}
            </View>
          )}
        />
        {/* floating yellow FILTERS pill, like the real app */}
        <Pressable style={styles.filtersPill} onPress={() => router.push('/movie-filters')}>
          <Ionicons name="filter" size={16} color={colors.onYellow} />
          <Text style={styles.filtersText}>FILTERS</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pillRow: { alignItems: 'center', paddingVertical: 10 },
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
  gridRow: { flexDirection: 'row', gap: 3, marginHorizontal: space.md, marginBottom: 3 },
  filtersPill: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 11,
    paddingHorizontal: 22,
  },
  filtersText: { color: colors.onYellow, fontSize: 12.5, fontWeight: '800', letterSpacing: 1 },
});
