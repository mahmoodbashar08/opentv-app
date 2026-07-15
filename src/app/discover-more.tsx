import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { NavHeader, Screen, TopTabs } from '@/components/ui';
import { colors, radius, space } from '@/theme';

const TABS = ['Shows', 'Movies'] as const;

const SAMPLES = [
  { name: 'Trending pick #1', sub: 'Metadata sync fills this in', hue: 215 },
  { name: 'Trending pick #2', sub: 'Match scores arrive too', hue: 320 },
  { name: 'Trending pick #3', sub: 'Posters replace placeholders', hue: 30 },
];

export default function DiscoverMoreScreen() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  const [tab, setTab] = useState<(typeof TABS)[number]>(type === 'movies' ? 'Movies' : 'Shows');

  return (
    <Screen>
      <NavHeader title="Discover more" />
      <TopTabs tabs={TABS} active={tab} onChange={setTab} />
      <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 100 }}>
        {SAMPLES.map((sh, i) => (
          <View key={i} style={styles.card}>
            <View style={[styles.art, { backgroundColor: `hsl(${sh.hue}, 30%, 20%)` }]}>
              <View style={styles.addBtn}>
                <Ionicons name="add" size={20} color={colors.yellow} />
              </View>
              <View style={styles.meta}>
                <Text style={styles.title}>{sh.name}</Text>
                <Text style={styles.sub}>{sh.sub}</Text>
              </View>
              <View style={styles.match}>
                <View style={styles.tBadge}>
                  <Text style={{ fontWeight: '800', color: colors.onYellow, fontSize: 12 }}>T</Text>
                </View>
                <Text style={{ color: colors.yellow, fontWeight: '800', fontSize: 14 }}>99%</Text>
              </View>
            </View>
          </View>
        ))}
        <Text style={{ color: colors.faint, fontSize: 12.5, textAlign: 'center', marginTop: 8, paddingHorizontal: 30 }}>
          Real trending {tab.toLowerCase()} appear here after the metadata sync (Phase 2).
        </Text>
      </ScrollView>
      <Pressable style={styles.filtersFab} onPress={() => router.push('/filters')}>
        <Ionicons name="options-outline" size={16} color={colors.onYellow} />
        <Text style={styles.filtersText}>Filters</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: space.lg, marginBottom: 14, borderRadius: radius.card, overflow: 'hidden' },
  art: { aspectRatio: 16 / 9, justifyContent: 'flex-end' },
  addBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 34,
    height: 34,
    borderWidth: 2,
    borderColor: colors.yellow,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { position: 'absolute', left: 14, bottom: 12, right: 80 },
  title: { color: colors.text, fontSize: 21, fontWeight: '800' },
  sub: { color: '#E3E3E8', fontSize: 13, marginTop: 1 },
  match: { position: 'absolute', right: 14, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 5 },
  tBadge: { backgroundColor: colors.yellow, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
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
