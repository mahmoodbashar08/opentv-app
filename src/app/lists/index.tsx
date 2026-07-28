import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Poster } from '@/components/poster';
import { NavHeader, PillButton, Screen } from '@/components/ui';
import { getCustomLists } from '@/db';
import seed from '@/seed';
import { isSeedLibrary } from '@/library';
import { colors, radius } from '@/theme';

// big collage: 4 full posters, equal margins both sides, 2pt gaps
/** four tiles across, sized from the LIVE window width so a rotation re-lays
 *  them out instead of keeping the width captured at import time. */
const tileWidth = (w: number) => (w - 2 * 12 - 3 * 2) / 4;

export default function ListsScreen() {
  const TILE_W = tileWidth(useWindowDimensions().width);
  // re-read on focus so a newly created list appears and deleted ones vanish
  const [, setTick] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setTick((n) => n + 1);
    }, []),
  );
  const lists = isSeedLibrary() ? seed.lists : getCustomLists();

  return (
    <Screen>
      <NavHeader title="Lists" right={<Ionicons name="swap-vertical" size={20} color={colors.text} />} />
      <ScrollView contentContainerStyle={{ paddingTop: 6 }}>
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <PillButton label="Create a new list" onPress={() => router.push('/lists/create')} />
        </View>
        {lists.map((l) => {
          const covers = (l.items ?? []).slice(0, 4);
          return (
          <Pressable key={l.name} style={styles.collage} onPress={() => router.push(`/lists/${encodeURIComponent(l.name)}`)}>
            {covers.map((it, i) => (
              <View key={`${it.name}-${i}`} style={{ width: TILE_W }}>
                <Poster name={it.name} uri={it.poster} />
              </View>
            ))}
            {/* dim the artwork so the list name pops — the name stays bright */}
            <View style={styles.collageDim} pointerEvents="none" />
            <Text style={styles.collageName}>{l.name}</Text>
            <Pressable
              style={styles.dots}
              hitSlop={12}
              onPress={(e) => {
                e.stopPropagation();
                router.push(`/list-menu?name=${encodeURIComponent(l.name)}`);
              }}>
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
            </Pressable>
          </Pressable>
          );
        })}
        {lists.length > 0 ? (
          !isSeedLibrary() && <Text style={styles.note}>Imported from your TV Time export</Text>
        ) : (
          <Text style={styles.note}>No lists yet — create your first one.</Text>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  collage: {
    flexDirection: 'row',
    gap: 2,
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  collageDim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.3)' },
  collageName: {
    position: 'absolute',
    left: 14,
    bottom: 12,
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowRadius: 10,
  },
  dots: {
    position: 'absolute',
    top: 10,
    right: 12,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { color: colors.faint, fontSize: 12.5, textAlign: 'center', marginTop: 6 },
});
