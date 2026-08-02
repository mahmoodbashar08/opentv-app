import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { Poster } from '@/components/poster';
import { NavHeader, PillButton, Screen } from '@/components/ui';
import { getCustomLists, getMeta, moveList, setMeta } from '@/db';
import { tapLight } from '@/haptics';
import seed from '@/seed';
import { isSeedLibrary } from '@/library';
import { isListSort, LIST_SORTS as SORTS, sortLists, TABLET_MIN_W, type ListSort } from '@/pure';
import { colors, radius } from '@/theme';
import { t } from '@/i18n';

const LIST_SORT_KEY = 'listsSort';

function readSort(): ListSort {
  const v = getMeta(LIST_SORT_KEY);
  return isListSort(v) ? v : 'custom';
}

function sortActions(current: ListSort, pick: (s: ListSort) => void, rearrange: () => void): SheetAction[] {
  const label: Record<ListSort, string> = {
    custom: t('listsIndex.sortCustom'),
    az: t('listsIndex.sortAZ'),
    recent: t('listsIndex.sortRecent'),
    size: t('listsIndex.sortSize'),
  };
  return [
    ...SORTS.map((s) => ({
      text: label[s],
      icon: (s === current ? 'checkmark-circle' : 'ellipse-outline') as SheetAction['icon'],
      onPress: () => pick(s),
    })),
    { text: t('listsIndex.reorder'), icon: 'swap-vertical' as SheetAction['icon'], onPress: rearrange },
  ];
}

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
  const [sort, setSortState] = useState<ListSort>(() => readSort());
  const [sheet, setSheet] = useState(false);
  const [reordering, setReordering] = useState(false);
  const seedLib = isSeedLibrary();
  const lists = sortLists(seedLib ? seed.lists : getCustomLists(), sort);

  const setSort = (next: ListSort) => {
    setSortState(next);
    setMeta(LIST_SORT_KEY, next);
    setSheet(false);
  };

  // Moving a row only means anything against the user's own order, so a nudge
  // switches to it rather than silently fighting an A–Z sort that will snap the
  // row back the moment it re-renders.
  const nudge = (name: string, delta: -1 | 1) => {
    tapLight();
    if (sort !== 'custom') {
      setSortState('custom');
      setMeta(LIST_SORT_KEY, 'custom');
    }
    moveList(name, delta);
    setTick((n) => n + 1);
  };

  return (
    <Screen>
      <NavHeader
        title={t('listsIndex.title')}
        right={
          // WAS A BARE ICON. It looked like a button, had no handler, and a
          // tester reported it as broken — correctly. It sorts now, and drops
          // into a rearrange mode for the order the export never got right.
          <Pressable hitSlop={12} onPress={() => (reordering ? setReordering(false) : setSheet(true))}>
            {reordering ? (
              <Text style={styles.doneText}>{t('listsIndex.reorderDone')}</Text>
            ) : (
              <Ionicons name="swap-vertical" size={20} color={colors.text} />
            )}
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ paddingTop: 6 }}>
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <PillButton label={t('listsIndex.createNewList')} onPress={() => router.push('/lists/create')} />
        </View>
        {lists.map((l, i) => {
          const covers = (l.items ?? []).slice(0, COLS);
          return (
          <Pressable key={l.name} style={styles.collage} onPress={() => router.push(`/lists/${encodeURIComponent(l.name)}`)}>
            {covers.map((it, k) => (
              <View key={`${it.name}-${k}`} style={{ width: TILE_W }}>
                <Poster name={it.name} uri={it.poster} />
              </View>
            ))}
            {/* dim the artwork so the list name pops — the name stays bright */}
            <View style={styles.collageDim} pointerEvents="none" />
            <Text style={styles.collageName}>{l.name}</Text>
            {reordering ? (
              <View style={styles.nudges}>
                <Pressable
                  style={[styles.dots, i === 0 && styles.nudgeOff]}
                  hitSlop={8}
                  disabled={i === 0}
                  onPress={() => nudge(l.name, -1)}>
                  <Ionicons name="chevron-up" size={20} color={colors.text} />
                </Pressable>
                <Pressable
                  style={[styles.dots, i === lists.length - 1 && styles.nudgeOff]}
                  hitSlop={8}
                  disabled={i === lists.length - 1}
                  onPress={() => nudge(l.name, 1)}>
                  <Ionicons name="chevron-down" size={20} color={colors.text} />
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={styles.dots}
                hitSlop={12}
                onPress={(e) => {
                  e.stopPropagation();
                  router.push(`/list-menu?name=${encodeURIComponent(l.name)}`);
                }}>
                <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
              </Pressable>
            )}
          </Pressable>
          );
        })}
        {lists.length > 0 ? (
          !isSeedLibrary() && <Text style={styles.note}>{t('listsIndex.importedNote')}</Text>
        ) : (
          <Text style={styles.note}>{t('listsIndex.emptyNote')}</Text>
        )}
      </ScrollView>
      <ActionSheet
        visible={sheet}
        title={t('listsIndex.sortTitle')}
        actions={sortActions(sort, setSort, () => {
          setSheet(false);
          setReordering(true);
        })}
        onClose={() => setSheet(false)}
      />
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
  doneText: { color: colors.yellow, fontSize: 16, fontWeight: '700' },
  nudges: { position: 'absolute', top: 10, end: 12, gap: 8 },
  nudgeOff: { opacity: 0.35 },
});
