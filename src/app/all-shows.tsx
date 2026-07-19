import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text } from 'react-native';

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
  // the Filters sheet persists {sort, progress}; re-read on every focus so
  // APPLY takes effect the moment the sheet closes
  const shows = useMemo(() => {
    const f = filters;
    let list = getShowProgress();
    if (f.progress > 0) list = list.filter((sp) => progressClass(sp) === f.progress);
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
  }, [tick, filters]);

  return (
    <Screen>
      <NavHeader title="Shows" right={<Ionicons name="eye-outline" size={20} color={colors.yellow} />} />
      <FlatList
        data={shows}
        keyExtractor={(s) => String(s.tvdbId)}
        numColumns={3}
        columnWrapperStyle={{ gap: 3 }}
        contentContainerStyle={{ padding: space.md, gap: 3, paddingBottom: 100 }}
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
