import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedRef, useScrollViewOffset } from 'react-native-reanimated';

import { track } from '@/analytics';
import { listsChanged } from '@/community-publish';
import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { collageHeight, ListCollage } from '@/components/list-collage';
import { SortableRows } from '@/components/sortable-rows';
import { NavHeader, PillButton, Screen } from '@/components/ui';
import { getCustomLists, getMeta, setListsOrder, setMeta } from '@/db';
import { useJoined } from '@/community-session';
import { fetchSharedLists, type SharedListRow } from '@/community-shared-lists';
import seed from '@/seed';
import { isSeedLibrary } from '@/library';
import { usePlus, requirePlus } from '@/plus';
import {
  isListSort,
  LIST_SORTS as SORTS,
  PROFILE_LIST_LIMIT,
  publishCapHit,
  sortLists,
  TABLET_MIN_W,
  type ListSort,
  publicCutIndex,
} from '@/pure';
import { tapLight } from '@/haptics';
import { colors } from '@/theme';
import { t } from '@/i18n';

const LIST_SORT_KEY = 'listsSort';

function readSort(): ListSort {
  const v = getMeta(LIST_SORT_KEY);
  return isListSort(v) ? v : 'custom';
}

function sortActions(
  current: ListSort,
  pick: (s: ListSort) => void,
  rearrange: () => void,
  joined: boolean,
  join: () => void,
): SheetAction[] {
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
    /*
     * JOINING SOMEBODY ELSE'S LIST lives here rather than on a button of its
     * own. Starting a list -- of either kind -- is now one question on the
     * create screen, which leaves joining as the only thing the old "Shared
     * lists" door still did. It is done once per list, from a code somebody
     * sent you, and a permanent button for it would outweigh how often anyone
     * presses it.
     */
    ...(joined
      ? [{ text: t('listsIndex.joinWithCode'), icon: 'enter-outline' as SheetAction['icon'], onPress: join }]
      : []),
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
  // The scroll view is animated so a drag can move it: without this a row can
  // only travel as far as the screen shows, and on twenty lists the last one
  // could never reach the top.
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useScrollViewOffset(scrollRef);
  const [sort, setSortState] = useState<ListSort>(() => readSort());
  const [sheet, setSheet] = useState(false);
  const [reordering, setReordering] = useState(false);
  const seedLib = isSeedLibrary();
  const joined = useJoined();
  // Render-safe: a purchase re-renders this screen and the cut line disappears
  // the moment it lands. `isPlus()` here would be memoised against nothing.
  const plus = usePlus();
  const lists = sortLists(seedLib ? seed.lists : getCustomLists(), sort);

  /**
   * THE SHARED ONES BELONG IN THIS SHELF, not behind a separate door.
   *
   * They were reachable only through the "Shared lists" row above, which made
   * them a different feature rather than a different kind of list -- somebody
   * looking for "the list with the horror films" should not have to remember
   * who started it before they can find it.
   *
   * They are rendered BELOW the sortable rows rather than inside them, and
   * that is deliberate: dragging writes a `position` onto your own lists, and
   * a list several people share has no single owner to arrange it. Mixing them
   * into the drag order would also make them count against the ten that reach
   * a profile, which they do not.
   */
  const [sharedLists, setSharedLists] = useState<SharedListRow[]>([]);
  useFocusEffect(
    useCallback(() => {
      if (!joined) return;
      let live = true;
      void fetchSharedLists()
        .then((rows) => {
          if (live) setSharedLists(rows);
        })
        .catch(() => {
          // Offline: the local lists are still the whole screen, as before.
        });
      return () => {
        live = false;
      };
    }, [joined]),
  );

  /**
   * The rule only tells the truth in the user's OWN order.
   *
   * `publishableLists` takes the first ten of `getCustomLists()`, which is the
   * stored order. Sorted A–Z or by size the tenth row on screen is not the
   * tenth row sent, so a line drawn there would name the wrong lists — worse
   * than no line, because it looks authoritative.
   *
   * AND ONLY WHEN THERE IS A CAP. Plus publishes all of them, so there is no
   * tenth row to draw a line under and nothing to offer.
   */
  /*
   * COUNTED ON WHAT CAN BE PUBLISHED, not on how many rows there are.
   * `publishableLists` drops hidden lists before it applies the cap, so twelve
   * lists with three hidden are nine publishable ones and nothing is cut at
   * all -- the warning used to appear anyway.
   */
  // The seed library's lists carry no `hidden` at all, and none of them are —
  // one shape for both so the cap arithmetic below has a single answer.
  const cutRows = lists.map((l) => ({ hidden: (l as { hidden?: boolean }).hidden === true }));
  const publishable = cutRows.filter((l) => !l.hidden).length;
  const overCap = joined && !seedLib && publishCapHit(plus, publishable, PROFILE_LIST_LIMIT);
  const showCut = overCap && sort === 'custom';

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
    // Shape only: that a rearrangement happened, never which lists moved where.
    track('list_reorder');
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
      <Animated.ScrollView ref={scrollRef} contentContainerStyle={{ paddingTop: 6 }}>
        <View style={{ alignItems: 'center', marginBottom: 16, gap: 10 }}>
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
          // The line goes where the tenth PUBLISHABLE list ends, which is
          // further down than row ten whenever a hidden list sits above it.
          publicLimit={showCut ? (publicCutIndex(cutRows, PROFILE_LIST_LIMIT) ?? undefined) : undefined}
          publicLimitLabel={t('favorites.notOnProfile')}
          scrollRef={scrollRef}
          scrollY={scrollY}
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
        {sharedLists.map((sl) => (
          <View key={sl.id} style={{ marginTop: 12 }}>
            <ListCollage
              list={{ name: sl.name, items: [], shared: true, memberCount: sl.members }}
              cols={COLS}
              tileW={TILE_W}
              onPress={reordering ? undefined : () => router.push(`/shared/${encodeURIComponent(sl.id)}`)}
            />
          </View>
        ))}
        {/* QUIET, AND NOT A WALL. Nothing here is blocked: every list on this
            screen exists, opens and can be edited. What the row says is that
            the PROFILE shows ten of them — an offer, in the same faint grey as
            the note under it, with nothing red about it. */}
        {overCap ? (
          <Pressable
            onPress={() => {
              tapLight();
              track('publish_cap_hit', { kind: 'lists' });
              requirePlus('publish_lists');
            }}>
            <Text style={styles.note}>
              {t('plus.lists.publishCap', { count: PROFILE_LIST_LIMIT })}{' '}
              <Text style={styles.upsell}>{t('plus.lists.publishAll')}</Text>
            </Text>
          </Pressable>
        ) : null}
        {lists.length > 0 ? (
          !isSeedLibrary() && <Text style={styles.note}>{t('listsIndex.importedNote')}</Text>
        ) : (
          <Text style={styles.note}>{t('listsIndex.emptyNote')}</Text>
        )}
      </Animated.ScrollView>
      <ActionSheet
        visible={sheet}
        title={t('listsIndex.sortTitle')}
        actions={sortActions(
          sort,
          setSort,
          () => {
            setSheet(false);
            setReordering(true);
          },
          joined,
          () => {
            setSheet(false);
            router.push('/shared');
          },
        )}
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
  upsell: { color: colors.yellow, fontWeight: '700' },
});

