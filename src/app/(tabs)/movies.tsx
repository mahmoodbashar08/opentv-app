import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';

import { Poster } from '@/components/poster';
import { EmptyState, Screen, TopTabs } from '@/components/ui';
import { getMovies, type MovieRow } from '@/db';
import { colors, radius, space } from '@/theme';

const TABS = ['Watch List', 'Upcoming'] as const;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export default function MoviesScreen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Watch List');
  // live from the database — marking/unmarking a movie updates the grid
  const [movies, setMovies] = useState(getMovies());
  useFocusEffect(
    useCallback(() => {
      setMovies(getMovies());
    }, []),
  );
  // the watch list = movies you plan to watch; watching one moves it out
  const planned = movies
    .filter((m) => m.watchedAt == null)
    .sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''));

  return (
    <Screen>
      <TopTabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'Watch List' ? (
        planned.length > 0 ? (
          <SectionList
            sections={[{ title: 'WATCH NEXT', data: chunk(planned, 3) }]}
            keyExtractor={(row) => row.map((m) => m.name).join('|')}
            stickySectionHeadersEnabled
            contentContainerStyle={{ paddingBottom: 24 }}
            renderSectionHeader={({ section }) => (
              // floats at the top while you scroll, like the real app
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
        ) : (
          <EmptyState
            title="Your watchlist is empty!"
            caption="Add movies you want to watch."
            cta="Browse all movies"
            onPress={() => router.push('/all-movies')}
          />
        )
      ) : (
        <View style={{ flex: 1 }}>
          <EmptyState
            title="Your upcoming list is empty!"
            caption="Add movies you want to watch."
            cta="Browse all movies"
            onPress={() => router.push('/all-movies')}
          />
        </View>
      )}
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
});
