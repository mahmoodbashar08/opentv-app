import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Poster } from '@/components/poster';
import { EmptyState, Screen, TopTabs } from '@/components/ui';
import { getMovies, type MovieRow } from '@/db';
import { airCountdown, gridGeometry } from '@/pure';
import { colors, radius, space } from '@/theme';
import { t } from '@/i18n';

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
  // stamped with the data, not read during render — "in 5 days" only needs to
  // be right as of the last time this screen came into focus
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(
    useCallback(() => {
      setMovies(getMovies());
      setNow(Date.now());
    }, []),
  );
  // the watch list = movies you plan to watch; watching one moves it out
  const allPlanned = movies
    .filter((m) => m.watchedAt == null)
    .sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''));
  // a film you've added that isn't out yet belongs in Upcoming, not in the
  // queue of things you could watch tonight — that split is what TV Time did.
  // No known date means "assume it's out", so nothing silently disappears.
  const upcoming = allPlanned
    .map((m) => ({ m, soon: airCountdown(m.releaseDate, now) }))
    .filter((x): x is { m: MovieRow; soon: string } => x.soon != null)
    .sort((a, b) => (a.m.releaseDate ?? '').localeCompare(b.m.releaseDate ?? ''));
  const upcomingNames = new Set(upcoming.map((x) => x.m.name));
  const planned = allPlanned.filter((m) => !upcomingNames.has(m.name));

  // rows of N posters, N following the viewport — 3 on a phone, more on a tablet
  const cols = gridGeometry(useWindowDimensions().width, space.md, 3).cols;

  return (
    <Screen>
      <TopTabs
        tabs={TABS}
        labels={{ 'Watch List': t('movies.tabs.watchList'), Upcoming: t('movies.tabs.upcoming') }}
        active={tab}
        onChange={setTab}
      />
      {tab === 'Watch List' ? (
        planned.length > 0 ? (
          <SectionList
            sections={[{ title: t('movies.watchNextSection'), data: chunk(planned, cols) }]}
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
                {row.length < cols && Array.from({ length: cols - row.length }).map((_, i) => <View key={i} style={{ flex: 1 }} />)}
              </View>
            )}
          />
        ) : (
          <EmptyState
            title={t('movies.emptyWatchlistTitle')}
            caption={t('movies.emptyWatchlistCaption')}
            cta={t('movies.browseAllMovies')}
            onPress={() => router.push('/all-movies')}
          />
        )
      ) : upcoming.length > 0 ? (
        <SectionList
          sections={[{ title: t('movies.notOutYetSection'), data: chunk(upcoming, cols) }]}
          keyExtractor={(row) => row.map((x) => x.m.name).join('|')}
          stickySectionHeadersEnabled
          contentContainerStyle={{ paddingBottom: 24 }}
          renderSectionHeader={({ section }) => (
            <View style={styles.pillRow} pointerEvents="none">
              <Text style={styles.sectionPill}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item: row }) => (
            <View style={styles.gridRow}>
              {row.map(({ m, soon }) => (
                <Pressable key={m.name} style={{ flex: 1 }} onPress={() => router.push(`/movie/${encodeURIComponent(m.name)}`)}>
                  <Poster name={m.name} uri={m.poster} />
                  <Text style={styles.countdown} numberOfLines={1}>
                    {soon}
                  </Text>
                </Pressable>
              ))}
              {row.length < cols && Array.from({ length: cols - row.length }).map((_, i) => <View key={i} style={{ flex: 1 }} />)}
            </View>
          )}
        />
      ) : (
        <View style={{ flex: 1 }}>
          <EmptyState
            title={t('movies.emptyUpcomingTitle')}
            caption={t('movies.emptyUpcomingCaption')}
            cta={t('movies.browseAllMovies')}
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
  // dim, not yellow — the wait is information, not something to act on
  countdown: { color: colors.dim, fontSize: 12, fontWeight: '700', marginTop: 4, marginBottom: 6, textAlign: 'center' },
});
