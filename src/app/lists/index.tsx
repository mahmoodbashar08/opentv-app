import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { Poster } from '@/components/poster';
import { SortableRows } from '@/components/sortable-rows';
import { NavHeader, PillButton, Screen } from '@/components/ui';
import { getCustomLists, getMeta, setListsOrder, setMeta } from '@/db';
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

/** The height of every band: tiles are `aspectRatio: 2/3`, and an empty list is
 *  padded to match so a drag has uniform slots. */
const ROW_H = (tileW: number) => Math.round(tileW * 1.5);

/**
 * One list's band. The SAME component while browsing and while rearranging —
 * dragging something that looks different from the thing you were just looking
 * at is a second appearance to learn for no reason.
 */
function Collage({
  list,
  cols,
  tileW,
  tappable,
}: {
  list: { name: string; items?: readonly { name: string; poster: string | null }[] };
  cols: number;
  tileW: number;
  tappable?: boolean;
}) {
  const covers = (list.items ?? []).slice(0, cols);
  // A LIST WITH NOTHING IN IT STILL HAS TO BE VISIBLE. The band takes its height
  // from the poster tiles and nothing else — the name and the dim layer are both
  // absolutely positioned — so a list created a moment ago drew a row of ZERO
  // height. It was on screen, in the database, and could not be seen or tapped,
  // which reads exactly like "creating a list does nothing".
  const empty = covers.length === 0;
  return (
    <Pressable
      style={[styles.collage, empty && styles.collageEmpty, { height: ROW_H(tileW) }]}
      disabled={!tappable}
      onPress={() => router.push(`/lists/${encodeURIComponent(list.name)}`)}>
      {covers.map((it, k) => (
        <View key={`${it.name}-${k}`} style={{ width: tileW }}>
          <Poster name={it.name} uri={it.poster} />
        </View>
      ))}
      {/* dim the artwork so the name pops — skipped with no artwork, where it
          would only make the name harder to read */}
      {!empty && <View style={styles.collageDim} pointerEvents="none" />}
      <Text style={styles.collageName}>{list.name}</Text>
      {tappable && (
        <Pressable
          style={styles.dots}
          hitSlop={12}
          onPress={(e) => {
            e.stopPropagation();
            router.push(`/list-menu?name=${encodeURIComponent(list.name)}`);
          }}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
        </Pressable>
      )}
    </Pressable>
  );
}

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
            return l == null ? null : <Collage list={l} cols={COLS} tileW={TILE_W} tappable={!reordering} />;
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

const styles = StyleSheet.create({
  collage: {
    flexDirection: 'row',
    gap: 2,
    marginHorizontal: 12,
    // No bottom margin: `SortableRows` positions every band absolutely and
    // spaces the SLOTS by its `gap`, so a margin here would be inert at best
    // and a double gap at worst.
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  collageDim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.3)' },
  collageEmpty: { backgroundColor: colors.panel, justifyContent: 'flex-end' },
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
});
