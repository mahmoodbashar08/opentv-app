/* eslint-disable react-hooks/immutability -- reanimated requires mutating
   sharedValue.value inside worklets/gesture callbacks; the compiler rule
   false-positives on it, same as the app's other animated components. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { CustomListItem } from '@/db';
import { colors, radius, space } from '@/theme';

// 3-column poster grid matching the static list layout (paddingHorizontal md,
// gap 3, poster aspect 2/3). Long-press a poster to pick it up and drag it to a
// new slot; the others reflow live.
const COLS = 3;
const GAP = 3;
const H_PAD = space.md;
const W = Dimensions.get('window').width;
const CELL_W = (W - H_PAD * 2 - GAP * (COLS - 1)) / COLS;
const CELL_H = CELL_W * 1.5;
const SLOT_W = CELL_W + GAP;
const SLOT_H = CELL_H + GAP;

const keyOf = (it: CustomListItem, i: number): string => `${it.name}##${i}`;

function posFor(order: number): { x: number; y: number } {
  'worklet';
  return { x: (order % COLS) * SLOT_W, y: Math.floor(order / COLS) * SLOT_H };
}
function orderFor(x: number, y: number, count: number): number {
  'worklet';
  const col = Math.max(0, Math.min(COLS - 1, Math.round(x / SLOT_W)));
  const row = Math.max(0, Math.round(y / SLOT_H));
  return Math.max(0, Math.min(count - 1, row * COLS + col));
}
// shift every position between the old and new slot by one (a reorder, not a swap)
function reflow(obj: Record<string, number>, from: number, to: number): Record<string, number> {
  'worklet';
  const next: Record<string, number> = {};
  for (const k in obj) {
    let v = obj[k];
    if (v === from) v = to;
    else if (from < to && v > from && v <= to) v = v - 1;
    else if (from > to && v < from && v >= to) v = v + 1;
    next[k] = v;
  }
  return next;
}

type Props = {
  items: CustomListItem[];
  /** show the ✕ remove badges (edit mode) */
  editing: boolean;
  /** allow long-press drag-to-reorder (reorder mode) */
  draggable: boolean;
  onOpen: (item: CustomListItem) => void;
  onRemove: (item: CustomListItem) => void;
  onReorder: (ordered: CustomListItem[]) => void;
};

export function SortablePosterGrid({ items, editing, draggable, onOpen, onRemove, onReorder }: Props) {
  const positions = useSharedValue<Record<string, number>>(
    Object.fromEntries(items.map((it, i) => [keyOf(it, i), i])),
  );

  // reset to identity whenever the item set/order changes (after a commit or a
  // removal) — keyed on the content so a normal re-render doesn't reset mid-drag
  const contentKey = items.map((it) => it.name).join('|');
  useEffect(() => {
    positions.value = Object.fromEntries(items.map((it, i) => [keyOf(it, i), i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);

  const commit = () => {
    const order = positions.value;
    const ordered: CustomListItem[] = new Array(items.length);
    items.forEach((it, i) => {
      const slot = order[keyOf(it, i)];
      if (slot != null) ordered[slot] = it;
    });
    const clean = ordered.filter(Boolean);
    if (clean.length === items.length) onReorder(clean);
  };

  const rows = Math.ceil(items.length / COLS);
  return (
    <View style={{ height: rows * SLOT_H, marginHorizontal: H_PAD }}>
      {items.map((it, i) => (
        <Tile
          key={keyOf(it, i)}
          id={keyOf(it, i)}
          item={it}
          positions={positions}
          count={items.length}
          editing={editing}
          draggable={draggable}
          onOpen={onOpen}
          onRemove={onRemove}
          onCommit={commit}
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
  editing,
  draggable,
  onOpen,
  onRemove,
  onCommit,
}: {
  id: string;
  item: CustomListItem;
  positions: SharedValue<Record<string, number>>;
  count: number;
  editing: boolean;
  draggable: boolean;
  onOpen: (item: CustomListItem) => void;
  onRemove: (item: CustomListItem) => void;
  onCommit: () => void;
}) {
  const active = useSharedValue(false);
  const lift = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const start = posFor(positions.value[id] ?? 0);
  const tx = useSharedValue(start.x);
  const ty = useSharedValue(start.y);

  // follow position changes driven by another tile's drag
  useAnimatedReaction(
    () => positions.value[id],
    (order, prev) => {
      if (order == null || order === prev) return;
      if (!active.value) {
        const p = posFor(order);
        tx.value = withTiming(p.x, { duration: 200 });
        ty.value = withTiming(p.y, { duration: 200 });
      }
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
    })
    .onUpdate((e) => {
      tx.value = startX.value + e.translationX;
      ty.value = startY.value + e.translationY;
      const target = orderFor(tx.value, ty.value, count);
      const cur = positions.value[id];
      if (target !== cur) positions.value = reflow(positions.value, cur, target);
    })
    .onEnd(() => {
      const dest = posFor(positions.value[id]);
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
    width: CELL_W,
    height: CELL_H,
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
