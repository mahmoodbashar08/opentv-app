import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text } from 'react-native';

import { Poster } from '@/components/poster';
import { NavHeader, Screen } from '@/components/ui';
import { getShowProgress } from '@/db';
import { progressColorOf, progressOf } from '@/show-status';
import { colors, radius, space } from '@/theme';

export default function AllShowsScreen() {
  // most recently watched first, like the real app's profile Shows page
  const shows = useMemo(
    () =>
      getShowProgress().sort(
        (a, b) =>
          (b.lastWatchedAt ?? '').localeCompare(a.lastWatchedAt ?? '') ||
          Math.max(b.watched, b.episodesSeen) - Math.max(a.watched, a.episodesSeen),
      ),
    [],
  );

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
