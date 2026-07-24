import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Poster } from '@/components/poster';
import { NavHeader, Screen } from '@/components/ui';
import { getShowProgress, type ShowProgress } from '@/db';
import { showMeta } from '@/metadata';
import { DEFAULT_SHOW_FILTERS, setShowFilters, useShowFilters } from '@/filters-store';
import { airedTotalOf, progressColorOf, progressOf } from '@/show-status';


// Progress classes, matching the sheet: All / Watching / Haven't started /
// Up to date / Finished / Stopped
function progressClass(sp: ShowProgress): number {
  if (sp.finished) return 4; // user manually marked complete
  if (sp.archived) return 5; // Stopped
  const seen = Math.max(sp.watched, sp.episodesSeen);
  if (seen === 0) return 2; // Haven't started
  const total = airedTotalOf(sp.tvdbId);
  if (total && seen >= total) {
    const m = showMeta(sp.tvdbId);
    const ended = m?.status === 'Ended' || m?.status === 'Canceled';
    const hasUnaired = (m?.totalEpisodes ?? 0) > total;
    return ended && !hasUnaired ? 4 : 3; // Finished : Up to date
  }
  return 1; // Watching
}
import { colors, radius, space } from '@/theme';

export default function AllShowsScreen() {
  // re-read on focus — a show deleted from its page must vanish on return
  const [tick, setTick] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setTick((t) => t + 1);
    }, []),
  );
  // filters are per-visit: opening the page fresh starts from the defaults
  const filters = useShowFilters();
  useEffect(() => {
    setShowFilters(DEFAULT_SHOW_FILTERS);
  }, []);
  // type-to-filter your own library by name, so a big collection is findable
  // without scrolling
  const [query, setQuery] = useState('');
  // the Filters sheet persists {sort, progress}; re-read on every focus so
  // APPLY takes effect the moment the sheet closes
  const shows = useMemo(() => {
    const f = filters;
    let list = getShowProgress();
    if (f.progress > 0) list = list.filter((sp) => progressClass(sp) === f.progress);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((sp) => sp.name.toLowerCase().includes(q));
    if (f.sort === 2) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (f.sort === 1) {
      // last added: in-app adds carry addedAt; imported shows go after, A-Z
      list.sort(
        (a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? '') || a.name.localeCompare(b.name),
      );
    } else {
      list.sort(
        (a, b) =>
          (b.lastWatchedAt ?? '').localeCompare(a.lastWatchedAt ?? '') ||
          Math.max(b.watched, b.episodesSeen) - Math.max(a.watched, a.episodesSeen),
      );
    }
    return list;
  }, [tick, filters, query]);

  return (
    <Screen>
      <NavHeader title="Shows" right={<Ionicons name="eye-outline" size={20} color={colors.yellow} />} />
      <View style={styles.searchRow}>
        <Ionicons name="search" size={17} color={colors.faint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your shows"
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
      <FlatList
        data={shows}
        keyExtractor={(s) => String(s.tvdbId)}
        numColumns={3}
        columnWrapperStyle={{ gap: 3 }}
        contentContainerStyle={{ padding: space.md, gap: 3, paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          query.trim() ? <Text style={styles.empty}>No shows match “{query.trim()}”.</Text> : null
        }
        renderItem={({ item, index }) => (
          <Pressable style={{ flex: 1 / 3 }} onPress={() => router.push(`/show/${item.tvdbId}`)}>
            <Poster
              name={item.name}
              uri={item.posterUrl}
              progress={progressOf(item)}
              progressColor={progressColorOf(item)}
              animateProgress
              animationDelay={300 + Math.min(index, 12) * 45}
            />
          </Pressable>
        )}
      />
      <Pressable style={styles.filtersFab} onPress={() => router.push('/filters')}>
        <Ionicons name="options-outline" size={16} color={colors.onYellow} />
        <Text style={styles.filtersText}>Filters</Text>
      </Pressable>
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
  filtersFab: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 13,
    paddingHorizontal: 24,
  },
  filtersText: { color: colors.onYellow, fontSize: 13, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
});
