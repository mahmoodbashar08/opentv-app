import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { listsChanged } from '@/community-publish';
import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { collageHeight, ListCollage } from '@/components/list-collage';
import { SortableRows } from '@/components/sortable-rows';
import { NavHeader, PillButton, Screen } from '@/components/ui';
import { getCustomLists, getMeta, setListsOrder, setMeta } from '@/db';
import seed from '@/seed';
import { isSeedLibrary } from '@/library';
import { isListSort, LIST_SORTS as SORTS, sortLists, TABLET_MIN_W, type ListSort } from '@/pure';
import { colors } from '@/theme';
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

/** The height of every band — `list-collage.tsx` owns the number, and the drag
 *  needs it for its slot size. */
const ROW_H = collageHeight;

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

  // A drag only means anything against the user's own order, so committing one
  // switches to it rather than silently fighting an A–Z sort that would snap
  // every row back the moment it re-rendered.
  const commitOrder = (names: string[]) => {
    if (sort !== 'custom') {
      setSortState('custom');
      setMeta(LIST_SORT_KEY, 'custom');
    }
    setListsOrder(names);
    setTick((n) => n + 1);
    // A REORDER IS A CHANGE. Every other list edit published immediately and
    // this one did not, so an arrangement lived on the phone and reached
    // nobody — which looks exactly like the server ignoring it.
    listsChanged();
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
        {/* ONE TREE, ALWAYS. Rearranging switches the gesture on, not the view:
            rendering a different list to drag unmounts every band, and an image
            that remounts re-fetches and fades in — seen as the screen flashing
            the instant the mode changes. */}
        <SortableRows
          keys={lists.map((l) => l.name)}
          rowHeight={ROW_H(TILE_W)}
          gap={12}
          enabled={reordering}
          onReorder={commitOrder}
          renderRow={(name) => {
            const l = lists.find((x) => x.name === name);
            if (l == null) return null;
            return (
              <ListCollage
                list={l}
                cols={COLS}
                tileW={TILE_W}
                onPress={
                  reordering ? undefined : () => router.push(`/lists/${encodeURIComponent(l.name)}`)
                }
                // No ⋯ while rearranging: a drag handle and a menu in the same
                // corner is a coin toss.
                onMenu={
                  reordering
                    ? undefined
                    : () => router.push(`/list-menu?name=${encodeURIComponent(l.name)}`)
                }
              />
            );
          }}
        />
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

// The band's own styles live with the band, in `components/list-collage.tsx` —
// this screen and a visitor's draw the identical component.
const styles = StyleSheet.create({
  note: { color: colors.faint, fontSize: 12.5, textAlign: 'center', marginTop: 6 },
  doneText: { color: colors.yellow, fontSize: 16, fontWeight: '700' },
});
