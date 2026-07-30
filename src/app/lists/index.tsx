import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Poster } from '@/components/poster';
import { NavHeader, PillButton, Screen } from '@/components/ui';
import { getCustomLists } from '@/db';
import seed from '@/seed';
import { isSeedLibrary } from '@/library';
import { TABLET_MIN_W } from '@/pure';
import { colors, radius } from '@/theme';
import { t } from '@/i18n';

// big collage: full posters, equal margins both sides, 2pt gaps
/** four tiles across on a phone, eight on a tablet, sized from the LIVE window
 *  width so a rotation re-lays them out. */
const tileCols = (w: number) => (w >= TABLET_MIN_W ? 8 : 4);
const tileWidth = (w: number) => (w - 2 * 12 - (tileCols(w) - 1) * 2) / tileCols(w);

export default function ListsScreen() {
  const { width } = useWindowDimensions();
  const TILE_W = tileWidth(width);
  const COLS = tileCols(width);
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
      <NavHeader title={t('listsIndex.title')} right={<Ionicons name="swap-vertical" size={20} color={colors.text} />} />
      <ScrollView contentContainerStyle={{ paddingTop: 6 }}>
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <PillButton label={t('listsIndex.createNewList')} onPress={() => router.push('/lists/create')} />
        </View>
        {lists.map((l) => {
          const covers = (l.items ?? []).slice(0, COLS);
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
          !isSeedLibrary() && <Text style={styles.note}>{t('listsIndex.importedNote')}</Text>
        ) : (
          <Text style={styles.note}>{t('listsIndex.emptyNote')}</Text>
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
    start: 14,
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
    end: 12,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { color: colors.faint, fontSize: 12.5, textAlign: 'center', marginTop: 6 },
});
