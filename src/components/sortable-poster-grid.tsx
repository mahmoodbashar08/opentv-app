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
import { gridGeometry, reflow, slotAt, slotPosition, type GridGeometry } from '@/pure';
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
  scrollRef,
  scrollY,
}: Props) {
  const { width, height } = useWindowDimensions();
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

  const rows = Math.ceil(items.length / geo.cols);
  return (
    <View style={{ height: rows * geo.slotH, marginHorizontal: H_PAD }}>
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
  const start = slotPosition(positions.value[id] ?? 0, geo);
  const tx = useSharedValue(start.x);
  const ty = useSharedValue(start.y);

  // follow position changes driven by another tile's drag
  useAnimatedReaction(
    () => positions.value[id],
    (order, prev) => {
      if (order == null || order === prev) return;
      if (!active.value) {
        const p = slotPosition(order, geo);
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
    const p = slotPosition(positions.value[id] ?? 0, geo);
    tx.value = p.x;
    ty.value = p.y;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.cols, geo.slotW, geo.slotH]);

  // while auto-scrolling with the finger held still, no onUpdate fires — so
  // re-derive ty (and the target slot) from the live scroll offset each tick
  useAnimatedReaction(
    () => scrollY?.value ?? 0,
    (sy) => {
      if (!active.value) return;
      ty.value = startY.value + transY.value + (sy - startScroll.value);
      const target = slotAt(tx.value, ty.value, count, geo);
      const cur = positions.value[id];
      if (target !== cur) positions.value = reflow(positions.value, cur, target);
    },
  );

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
      tx.value = startX.value + e.translationX;
      ty.value = startY.value + e.translationY + ((scrollY?.value ?? 0) - startScroll.value);
      const target = slotAt(tx.value, ty.value, count, geo);
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
    opacity: 1 - lift.value * 0.08,
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
  tile: {
    width: '100%',
    height: '100%',
    borderRadius: radius.poster,
    overflow: 'hidden',
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { color: 'rgba(255,255,255,0.55)', fontSize: 20, fontWeight: '800' },
  removeBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
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
