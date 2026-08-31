/* eslint-disable react-hooks/immutability -- reanimated requires mutating
   sharedValue.value inside worklets/gesture callbacks; the compiler rule
   false-positives on it, same as the app's other animated components. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedReaction,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type AnimatedRef,
  type SharedValue,
} from 'react-native-reanimated';

import type { CustomListItem } from '@/db';
import {
  clampToGrid,
  gridGeometry,
  gridHeight,
  reflow,
  slotAt,
  slotPosition,
  splitLineY,
  type GridGeometry,
  type GridSplit,
} from '@/pure';
import { colors, radius, space } from '@/theme';

// how far from the top/bottom of the screen the drag must reach to auto-scroll,
// and how fast it scrolls per frame while held there
const EDGE_TOP = 190; // below the nav header + list title
const EDGE_BOTTOM = 130;
const SCROLL_SPEED = 9;

// Poster grid matching the static list layout (paddingHorizontal md, gap 3,
// poster aspect 2/3). Long-press a poster to pick it up and drag it to a new
// slot; the others reflow live.
//
// Column count and cell size come from the LIVE viewport, not from a
// module-load `Dimensions.get()` — that is what left this grid at
// portrait width after the app learned to rotate in 1.2.0. The maths lives in
// `@/pure` so the drag can be tested without a device.
const GAP = 3;
const H_PAD = space.md;

/** Clear air around the rule. Big enough that the two sections read as two. */
const SPLIT_GAP = 84;
const RULE_H = 18;

// STABLE identity (not index) — so reordering never changes a tile's React key,
// which would remount it and reload its poster (the blank-then-reappear flash)
const keyOf = (it: CustomListItem): string => (it.tvdbId != null ? `s:${it.tvdbId}` : `m:${it.name}`);

type Props = {
  items: CustomListItem[];
  /** show the ✕ remove badges (edit mode) */
  editing: boolean;
  /** allow long-press drag-to-reorder (reorder mode) */
  draggable: boolean;
  onOpen: (item: CustomListItem) => void;
  onRemove: (item: CustomListItem) => void;
  onReorder: (ordered: CustomListItem[]) => void;
  /**
   * How many of these appear on the owner's public profile, counted from the
   * front. A rule is drawn under them and the rest sit below it.
   *
   * The published section is padded to whole rows so the rule is straight at
   * every column count — see `GridSplit` in `@/pure`. Dimming below the rule
   * happens only while reordering: at rest the line says it, and greying half
   * a grid the user is only trying to look at reads as broken artwork.
   *
   * Omit for a grid where every item is equal, which is every list today.
   */
  publicLimit?: number;
  /** Caption drawn on the rule, e.g. "NOT ON YOUR PROFILE". */
  publicLimitLabel?: string;
  /** the enclosing scroll view + its live offset — enables drag-to-edge
   *  auto-scroll so long lists can be reordered across screens */
  scrollRef?: AnimatedRef<Animated.ScrollView>;
  scrollY?: SharedValue<number>;
};

export function SortablePosterGrid({
  items,
  editing,
  draggable,
  onOpen,
  onRemove,
  onReorder,
  publicLimit,
  publicLimitLabel,
  scrollRef,
  scrollY,
}: Props) {
  const { width, height } = useWindowDimensions();
  // raw window width is correct only because this grid's only caller,
  // lists/[id].tsx, is NOT capped by ContentColumn/CONTENT_MAX_WIDTH today.
  // If that screen ever gains the cap, this must derive from the capped
  // width instead — drop targets would otherwise be hit-tested against the
  // wrong width and a drag would silently reorder the user's list.
  const geo = gridGeometry(width, H_PAD, GAP);
  const positions = useSharedValue<Record<string, number>>(
    Object.fromEntries(items.map((it, i) => [keyOf(it), i])),
  );
  // -1 scroll up, +1 scroll down, 0 idle — set by the dragged tile near an edge
  const scrollDir = useSharedValue(0);
  useFrameCallback(() => {
    'worklet';
    if (!scrollRef || !scrollY || scrollDir.value === 0) return;
    scrollTo(scrollRef, 0, scrollY.value + scrollDir.value * SCROLL_SPEED, false);
  });

  // reset to identity whenever the item set/order changes (after a commit or a
  // removal) — keyed on the content so a normal re-render doesn't reset mid-drag
  const contentKey = items.map((it) => it.name).join('|');
  useEffect(() => {
    positions.value = Object.fromEntries(items.map((it, i) => [keyOf(it), i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);

  const commit = () => {
    const order = positions.value;
    const ordered: CustomListItem[] = new Array(items.length);
    items.forEach((it, i) => {
      const slot = order[keyOf(it)];
      if (slot != null) ordered[slot] = it;
    });
    const clean = ordered.filter(Boolean);
    if (clean.length === items.length) onReorder(clean);
  };

  // No rule unless there is something on the far side of it.
  const split: GridSplit | null =
    publicLimit != null && items.length > publicLimit ? { at: publicLimit, gapH: SPLIT_GAP } : null;

  return (
    <View style={{ height: gridHeight(items.length, geo, split), marginHorizontal: H_PAD }}>
      {split ? (
        <View style={[styles.rule, { top: splitLineY(geo, split) - RULE_H / 2 }]}>
          <View style={styles.ruleLine} />
          {publicLimitLabel ? <Text style={styles.ruleLabel}>{publicLimitLabel}</Text> : null}
          <View style={styles.ruleLine} />
        </View>
      ) : null}
      {items.map((it) => (
        <Tile
          key={keyOf(it)}
          id={keyOf(it)}
          item={it}
          positions={positions}
          count={items.length}
          geo={geo}
          screenH={height}
          editing={editing}
          draggable={draggable}
          split={split}
          onOpen={onOpen}
          onRemove={onRemove}
          onCommit={commit}
          scrollY={scrollY}
          scrollDir={scrollDir}
        />
      ))}
    </View>
  );
}

function Tile({
  id,
  item,
  positions,
  count,
  geo,
  screenH,
  editing,
  draggable,
  split,
  onOpen,
  onRemove,
  onCommit,
  scrollY,
  scrollDir,
}: {
  id: string;
  item: CustomListItem;
  positions: SharedValue<Record<string, number>>;
  count: number;
  geo: GridGeometry;
  screenH: number;
  editing: boolean;
  draggable: boolean;
  split: GridSplit | null;
  onOpen: (item: CustomListItem) => void;
  onRemove: (item: CustomListItem) => void;
  onCommit: () => void;
  scrollY?: SharedValue<number>;
  scrollDir: SharedValue<number>;
}) {
  const active = useSharedValue(false);
  const lift = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScroll = useSharedValue(0); // scroll offset when the drag began
  const transY = useSharedValue(0); // last finger dy, so scroll ticks can re-derive ty
  const start = slotPosition(positions.value[id] ?? 0, geo, split);
  const tx = useSharedValue(start.x);
  const ty = useSharedValue(start.y);

  // follow position changes driven by another tile's drag
  useAnimatedReaction(
    () => positions.value[id],
    (order, prev) => {
      if (order == null || order === prev) return;
      if (!active.value) {
        const p = slotPosition(order, geo, split);
        tx.value = withTiming(p.x, { duration: 200 });
        ty.value = withTiming(p.y, { duration: 200 });
      }
    },
  );

  // Rotation (or any viewport change) moves every slot without changing any
  // tile's ORDER, so the reaction above — which only fires on an order change —
  // would leave every poster at its old portrait coordinates. Snap to the new
  // geometry instead: the OS is already animating the relayout, and a second
  // timing animation on top of it reads as a wobble.
  useEffect(() => {
    if (active.value) return; // never yank a tile out from under the finger
    const p = slotPosition(positions.value[id] ?? 0, geo, split);
    tx.value = p.x;
    ty.value = p.y;
    // `split` belongs here as much as the geometry does: the rule appearing,
    // moving or going away relocates every slot below it without changing any
    // tile's ORDER, so the order-change reaction above never fires and the
    // posters would sit at their pre-rule coordinates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.cols, geo.slotW, geo.slotH, split?.at, split?.gapH]);

  // while auto-scrolling with the finger held still, no onUpdate fires — so
  // re-derive ty (and the target slot) from the live scroll offset each tick
  useAnimatedReaction(
    () => scrollY?.value ?? 0,
    (sy) => {
      if (!active.value) return;
      const c = clampToGrid(tx.value, startY.value + transY.value + (sy - startScroll.value), count, geo, split);
      ty.value = c.y;
      const target = slotAt(c.x, c.y, count, geo, split);
      const cur = positions.value[id];
      if (target !== cur) positions.value = reflow(positions.value, cur, target);
    },
  );

  // SCROLLABLE WHILE REORDERING. The drag only begins after a 220ms hold, so a
  // flick never starts one and the enclosing ScrollView can stay live: a finger
  // that moves scrolls the list, a finger that waits picks a poster up. That is
  // why the caller no longer has to freeze scrolling to allow a reorder.
  const pan = Gesture.Pan()
    .enabled(draggable)
    .activateAfterLongPress(220)
    .onStart(() => {
      active.value = true;
      lift.value = withTiming(1, { duration: 120 });
      startX.value = tx.value;
      startY.value = ty.value;
      startScroll.value = scrollY?.value ?? 0;
      transY.value = 0;
    })
    .onUpdate((e) => {
      transY.value = e.translationY;
      // clamped to the grid: a tile dragged past the last row used to read as a
      // row that does not exist, flipping the target slot back and forth and
      // permuting the items it passed over — see clampToGrid
      const c = clampToGrid(
        startX.value + e.translationX,
        startY.value + e.translationY + ((scrollY?.value ?? 0) - startScroll.value),
        count,
        geo,
        split,
      );
      tx.value = c.x;
      ty.value = c.y;
      const target = slotAt(c.x, c.y, count, geo, split);
      const cur = positions.value[id];
      if (target !== cur) positions.value = reflow(positions.value, cur, target);
      // auto-scroll when the finger is held near the top/bottom edge
      if (e.absoluteY < EDGE_TOP) scrollDir.value = -1;
      else if (e.absoluteY > screenH - EDGE_BOTTOM) scrollDir.value = 1;
      else scrollDir.value = 0;
    })
    .onEnd(() => {
      scrollDir.value = 0;
      const dest = slotPosition(positions.value[id], geo);
      tx.value = withTiming(dest.x, { duration: 200 });
      ty.value = withTiming(dest.y, { duration: 200 }, () => {
        active.value = false;
      });
      lift.value = withTiming(0, { duration: 160 });
      runOnJS(onCommit)();
    });

  const tap = Gesture.Tap().onEnd(() => runOnJS(onOpen)(item));
  const gesture = Gesture.Exclusive(pan, tap);

  const style = useAnimatedStyle(() => ({
    position: 'absolute',
    width: geo.cellW,
    height: geo.cellH,
    // editing tiles float above their neighbours so the ✕ badge is never
    // covered by the poster in the next column/row
    zIndex: active.value ? 10 : editing ? 5 : 0,
    // Below the rule AND being reordered, so faded — read from `positions`,
    // which the drag updates every frame, so a poster dims the instant it is
    // pushed out and brightens the instant it is pulled back in. At rest
    // nothing is dimmed: the rule already says which side each poster is on,
    // and half a greyed grid reads as artwork that failed to load.
    opacity:
      (1 - lift.value * 0.08) *
      (draggable && split && (positions.value[id] ?? 0) >= split.at ? 0.32 : 1),
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: 1 + lift.value * 0.08 }],
    shadowColor: '#000',
    shadowOpacity: lift.value * 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={style}>
        <View style={styles.tile}>
          {item.poster ? (
            <Image source={{ uri: item.poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
          ) : (
            <Text style={styles.initials}>{item.name.slice(0, 2).toUpperCase()}</Text>
          )}
        </View>
        {editing && (
          <Pressable style={styles.removeBadge} hitSlop={8} onPress={() => onRemove(item)}>
            <Ionicons name="close" size={15} color="#fff" />
          </Pressable>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  // The rule between "on your profile" and everything else. Absolutely
  // positioned so it sits in the gap the geometry already reserved, and
  // pointerEvents none so it can never swallow a drag passing over it.
  rule: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: RULE_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    pointerEvents: 'none',
    zIndex: 1,
  },
  ruleLine: { flex: 1, height: 1, backgroundColor: '#2C2C31' },
  ruleLabel: { color: colors.faint, fontSize: 10.5, fontWeight: '800', letterSpacing: 1 },
  tile: {
    width: '100%',
    height: '100%',
    borderRadius: radius.poster,
    overflow: 'hidden',
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { color: colors.faint, fontSize: 20, fontWeight: '800' },
  removeBadge: {
    position: 'absolute',
    top: 5,
    end: 5,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
});
