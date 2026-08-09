/* eslint-disable react-hooks/immutability -- reanimated requires mutating
   sharedValue.value inside worklets/gesture callbacks; the compiler rule
   false-positives on it, same as `sortable-poster-grid.tsx` and the app's
   other animated components. */
/**
 * Drag full-width rows into a new order, showing the rows themselves.
 *
 * WHAT IT DRAGS IS WHAT YOU SEE. A first version swapped the Lists screen's
 * poster collages for compact name rows while rearranging, on the assumption
 * that the collages were different heights. They are not: every tile is
 * `aspectRatio: 2/3`, so a band is always `tileWidth * 1.5` tall, and an empty
 * list is padded to the same. Dragging the real thing needs no second
 * appearance to learn.
 *
 * WHY NOT WRITE A SHARED VALUE INSIDE `useAnimatedStyle`. The first version set
 * `y.value = withSpring(...)` in the style callback, which restarts the spring
 * every time the callback re-evaluates — the animation fights itself and the
 * drag stutters. The position is DERIVED in the style instead: the slot decides
 * where a row belongs, the finger's offset is the only stored state, and
 * nothing is written from a place that reads.
 *
 * THE SAME MATHS AS THE POSTER GRID. `slotAt`, `reflow` and `slotPosition` in
 * `pure.ts` take a `GridGeometry`, and one column is `cols: 1`.
 */
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { tapLight } from '@/haptics';
import { colors } from '@/theme';
import { gridHeight, reflow, slotAt, slotPosition, splitLineY, type GridGeometry, type GridSplit } from '@/pure';

const SPRING = { damping: 22, stiffness: 220 } as const;

/** Clear air around the rule, and the rule's own height. */
const SPLIT_GAP = 84;
const RULE_H = 18;

const rowStyles = StyleSheet.create({
  rule: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: RULE_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    pointerEvents: 'none',
    zIndex: 1,
  },
  ruleLine: { flex: 1, height: 1, backgroundColor: '#2C2C31' },
  ruleLabel: { color: colors.faint, fontSize: 10.5, fontWeight: '800', letterSpacing: 1 },
});

export function SortableRows({
  keys,
  rowHeight,
  gap,
  enabled = true,
  renderRow,
  onReorder,
  publicLimit,
  publicLimitLabel,
}: {
  keys: readonly string[];
  /** The row's own height. Every row must be this tall or the drop maths lies. */
  rowHeight: number;
  gap: number;
  /**
   * Whether the rows can be dragged. The component stays mounted either way —
   * rendering a different tree to rearrange unmounts every row, and an
   * `expo-image` that remounts re-fetches and fades in, which is seen as the
   * whole screen flashing the moment the mode changes.
   */
  enabled?: boolean;
  renderRow: (key: string) => ReactNode;
  /** The full order, once the finger lifts. Never called mid-drag. */
  onReorder: (keys: string[]) => void;
  /**
   * How many of these rows reach the owner's public profile, counted from the
   * top. A rule is drawn under them; drag a row across it to swap it in.
   *
   * One column, so unlike the poster grid there is nothing to pad — the break
   * always falls on a row boundary and the rule is exactly where the cut is.
   *
   * Only meaningful while the rows are in the ORDER THAT IS PUBLISHED. Sorted
   * A–Z the tenth row on screen is not the tenth row sent, so the caller must
   * leave this off for any sort but its own.
   */
  publicLimit?: number;
  /** Caption drawn on the rule. */
  publicLimitLabel?: string;
}) {
  const geo: GridGeometry = {
    cols: 1,
    cellW: 0,
    cellH: rowHeight,
    slotW: 1,
    slotH: rowHeight + gap,
  };

  const positions = useSharedValue<Record<string, number>>(
    Object.fromEntries(keys.map((k, i) => [k, i])),
  );

  // Re-seeded when the SET changes — a list created or deleted elsewhere. Keyed
  // on content so an ordinary re-render cannot reset an order mid-drag.
  const contentKey = keys.join('|');
  useEffect(() => {
    positions.value = Object.fromEntries(keys.map((k, i) => [k, i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);

  const split: GridSplit | null =
    publicLimit != null && keys.length > publicLimit ? { at: publicLimit, gapH: SPLIT_GAP } : null;

  const commit = () => {
    const order = positions.value;
    const out: string[] = new Array(keys.length);
    for (const k of keys) {
      const slot = order[k];
      if (slot != null) out[slot] = k;
    }
    const clean = out.filter(Boolean);
    // A short count means a slot was lost to a race. Committing it would drop a
    // row from the user's order, so do nothing — the next drag is fine.
    if (clean.length === keys.length) onReorder(clean);
  };

  return (
    <View style={{ height: gridHeight(keys.length, geo, split) }}>
      {split ? (
        <View style={[rowStyles.rule, { top: splitLineY(geo, split) - RULE_H / 2 }]}>
          <View style={rowStyles.ruleLine} />
          {publicLimitLabel ? <Text style={rowStyles.ruleLabel}>{publicLimitLabel}</Text> : null}
          <View style={rowStyles.ruleLine} />
        </View>
      ) : null}
      {keys.map((k) => (
        <Row
          key={k}
          id={k}
          positions={positions}
          count={keys.length}
          geo={geo}
          split={split}
          enabled={enabled}
          onCommit={commit}>
          {renderRow(k)}
        </Row>
      ))}
    </View>
  );
}

function Row({
  id,
  positions,
  count,
  geo,
  split,
  enabled,
  onCommit,
  children,
}: {
  id: string;
  positions: SharedValue<Record<string, number>>;
  count: number;
  geo: GridGeometry;
  split: GridSplit | null;
  enabled: boolean;
  onCommit: () => void;
  children: ReactNode;
}) {
  /** The finger's travel since the press. The only state a drag stores. */
  const offset = useSharedValue(0);
  const active = useSharedValue(false);
  /** Where the row sat when the press began — its slot moves under it as others
   *  reflow, and following that mid-drag would make it jump under the finger. */
  const from = useSharedValue(0);

  const pan = Gesture.Pan()
    .enabled(enabled)
    // Long enough not to fight the scroll view this lives inside. The poster
    // grid uses 220ms for the same reason.
    .activateAfterLongPress(220)
    .onStart(() => {
      active.value = true;
      offset.value = 0;
      from.value = slotPosition(positions.value[id] ?? 0, geo, split).y;
      runOnJS(tapLight)();
    })
    .onUpdate((e) => {
      offset.value = e.translationY;
      const cur = positions.value[id] ?? 0;
      const target = slotAt(0, from.value + e.translationY, count, geo, split);
      if (target !== cur) positions.value = reflow(positions.value, cur, target);
    })
    .onEnd(() => {
      active.value = false;
      offset.value = 0;
      runOnJS(onCommit)();
    });

  const style = useAnimatedStyle(() => {
    const slotY = slotPosition(positions.value[id] ?? 0, geo, split).y;
    return {
      position: 'absolute',
      left: 0,
      right: 0,
      height: geo.cellH,
      // Under the finger it tracks exactly; released, it springs to its slot.
      transform: [
        { translateY: active.value ? from.value + offset.value : withSpring(slotY, SPRING) },
        { scale: withSpring(active.value ? 1.02 : 1, SPRING) },
      ],
      // Lifted, or it slides beneath its neighbours.
      zIndex: active.value ? 10 : 0,
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={style}>{children}</Animated.View>
    </GestureDetector>
  );
}
