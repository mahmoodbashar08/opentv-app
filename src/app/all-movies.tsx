import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';

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
  // type-to-filter your own movies by name, so a big collection is findable
  // without scrolling
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? movies.filter((m) => m.name.toLowerCase().includes(q)) : movies;
    const bySort = (list: MovieRow[], watched: boolean) => {
      const l = [...list];
      if (filters.sort === 'alpha') l.sort((a, b) => a.name.localeCompare(b.name));
      else if (filters.sort === 'lastAdded') l.sort((a, b) => (b.addedAt ?? b.watchedAt ?? '').localeCompare(a.addedAt ?? a.watchedAt ?? ''));
      else l.sort((a, b) => ((b.watchedAt ?? b.addedAt ?? '') < (a.watchedAt ?? a.addedAt ?? '') ? -1 : 1));
      return l;
    };
    const watched = bySort(base.filter((m) => m.watchedAt != null), true);
    const planned = bySort(base.filter((m) => m.watchedAt == null), false);

    const out: { title: string; data: MovieRow[][] }[] = [];
    if (filters.progress !== 'notWatched' && watched.length) out.push({ title: 'WATCHED', data: chunk(watched, 3) });
    if (filters.progress !== 'watched' && planned.length) out.push({ title: 'NOT WATCHED', data: chunk(planned, 3) });
    return out;
  }, [movies, filters, query]);

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
      <View style={styles.searchRow}>
        <Ionicons name="search" size={17} color={colors.faint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your movies"
          placeholderTextColor={colors.faint}
          style={styles.searchInput}
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable hitSlop={8} onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={17} color={colors.faint} />
          </Pressable>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <SectionList
          ref={listRef}
          sections={sections}
          keyExtractor={(row) => row.map((m) => m.name).join('|')}
          stickySectionHeadersEnabled
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            query.trim() ? <Text style={styles.empty}>No movies match “{query.trim()}”.</Text> : null
          }
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1B1B1E',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginHorizontal: space.md,
    marginTop: 2,
    marginBottom: 4,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, padding: 0 },
  empty: { color: colors.dim, fontSize: 14, textAlign: 'center', marginTop: 40 },
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
