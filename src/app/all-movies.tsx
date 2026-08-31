import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { Poster } from '@/components/poster';
import { NavHeader, Screen } from '@/components/ui';
import { getMovies, type MovieRow } from '@/db';
import { movieFacts } from '@/filter-facts';
import { useFilters } from '@/filters-store';
import { activeFilterCount, gridGeometry, matchesFilters } from '@/pure';
import { colors, radius, space } from '@/theme';
import { t } from '@/i18n';

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
  // filters PERSIST now — read from meta on first use, alive across relaunches
  const filters = useFilters('movie');
  // type-to-filter your own movies by name, so a big collection is findable
  // without scrolling
  const [query, setQuery] = useState('');

  const active = activeFilterCount(filters);

  // rows of N posters, N following the viewport — 3 on a phone, more on a tablet
  const cols = gridGeometry(useWindowDimensions().width, space.md, 3).cols;

  // The expensive half — a metadata lookup per film, for genres and length —
  // depends on (library, filters) alone, so typing in the search box does not
  // re-resolve the whole collection on every keystroke.
  const kept = useMemo(() => {
    const facts = movieFacts(movies);
    return movies.filter((_, i) => matchesFilters(facts[i], filters));
  }, [movies, filters]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? kept.filter((m) => m.name.toLowerCase().includes(q)) : kept;
    const bySort = (list: MovieRow[]) => {
      const l = [...list];
      if (filters.sort === 'alpha') l.sort((a, b) => a.name.localeCompare(b.name));
      else if (filters.sort === 'lastAdded') l.sort((a, b) => (b.addedAt ?? b.watchedAt ?? '').localeCompare(a.addedAt ?? a.watchedAt ?? ''));
      else l.sort((a, b) => ((b.watchedAt ?? b.addedAt ?? '') < (a.watchedAt ?? a.addedAt ?? '') ? -1 : 1));
      return l;
    };
    const watched = bySort(base.filter((m) => m.watchedAt != null));
    const planned = bySort(base.filter((m) => m.watchedAt == null));

    // the progress axis has already removed whichever half was excluded, so a
    // section is absent because it is empty, never because it was suppressed
    const out: { title: string; data: MovieRow[][] }[] = [];
    if (watched.length) out.push({ title: t('allMovies.sectionWatched'), data: chunk(watched, cols) });
    if (planned.length) out.push({ title: t('allMovies.sectionNotWatched'), data: chunk(planned, cols) });
    return out;
  }, [kept, filters.sort, query, cols]);

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
      <NavHeader title={t('allMovies.title')} right={<Ionicons name="eye-outline" size={20} color={colors.yellow} />} />
      <View style={styles.searchRow}>
        <Ionicons name="search" size={17} color={colors.faint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('allMovies.searchPlaceholder')}
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
            query.trim() ? <Text style={styles.empty}>{t('allMovies.noMatches', { query: query.trim() })}</Text> : null
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
              {row.length < cols && Array.from({ length: cols - row.length }).map((_, i) => <View key={i} style={{ flex: 1 }} />)}
            </View>
          )}
        />
        {/* floating yellow FILTERS pill, like the real app */}
        <Pressable style={styles.filtersPill} onPress={() => router.push('/movie-filters')}>
          <Ionicons name="filter" size={16} color={colors.onYellow} />
          <Text style={styles.filtersText}>{t('allMovies.filters')}</Text>
          {/* persistent filters have to announce themselves — see all-shows */}
          {active > 0 ? <Text style={styles.filtersBadge}>{active}</Text> : null}
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
    backgroundColor: colors.card,
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
  filtersBadge: {
    color: colors.yellow,
    backgroundColor: colors.onYellow,
    fontSize: 11,
    fontWeight: '800',
    minWidth: 18,
    textAlign: 'center',
    borderRadius: 9,
    paddingVertical: 1,
    paddingHorizontal: 5,
    overflow: 'hidden',
  },
});
