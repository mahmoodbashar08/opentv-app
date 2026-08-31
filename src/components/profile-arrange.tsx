/* eslint-disable react-hooks/immutability -- reanimated requires mutating
   sharedValue.value inside worklets/gesture callbacks; the compiler rule
   false-positives on it, same as the app's other animated components. */
/**
 * Arranging the profile the way a home screen is arranged: hold, drag things
 * where you want them, tap the minus to take one off.
 *
 * WHY IN PLACE AND NOT ON A SETTINGS SCREEN. A list of widget names with little
 * arrows can express every arrangement this grid can hold, and it is much less
 * code — but it cannot answer the only question somebody actually has, which is
 * "what will my profile LOOK like". Arranging is a visual job. Doing it
 * somewhere else means editing a description of the thing instead of the thing,
 * and then scrolling back to find out whether you liked it.
 *
 * The interaction is deliberately the one every phone already teaches:
 *
 *   hold a widget      → you are arranging
 *   drag               → the widget follows your finger, others move aside
 *   minus              → it comes off (the banner has no minus)
 *   plus at the end    → what you took off, offered back
 *   Done               → stop
 *
 * Nobody has to be told any of that, which is the entire argument for copying
 * it rather than inventing something.
 *
 * NOTHING HERE IS MEASURED. The first version measured every block with
 * `measureInWindow` and hit-tested the finger against the results, and it broke
 * in two structural ways: a live reorder moved a block into a different row
 * `<View>`, React remounted it, and the running Pan gesture died mid-drag; and
 * `onLayout` only re-fires when a view's own layout CHANGES, so after a reorder
 * most frames never repopulated and the next drop landed on nothing. The
 * template now COMPUTES every block's position on a flat canvas, so this file
 * receives geometry as fact rather than trying to observe it — the drag, the
 * hit-test and the settle are all arithmetic on numbers both sides already
 * agree on.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Dimensions, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  scrollTo,
  useFrameCallback,
  type AnimatedRef,
  type SharedValue,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { tapLight } from '@/haptics';
import { colors } from '@/theme';

/** The corner the remove badge occupies: 24pt of badge, its overhang, and a
 *  little slack, measured from the block's own top-left. */
const BADGE_HIT = 34;

/** How close to an edge starts the page moving, and how fast. Matched to the
 *  list reorder so a drag feels the same wherever it happens. */
const EDGE_TOP = 150;
const EDGE_BOTTOM = 130;
const SCROLL_SPEED = 9;
const SCREEN_H = Dimensions.get('window').height;

/** A block's computed slot, in the canvas's own coordinates. Never measured —
 *  the template's layout walk produces it, so it cannot go stale. */
export type Rect = { x: number; y: number; w: number; h: number };

export type ArrangeProps = {
  /** Position in the flat arrangement — what a reorder actually changes. */
  index: number;
  editing: boolean;
  canRemove: boolean;
  /** Where the layout says this block belongs right now. */
  rect: Rect;
  /** True when the grid owns the height (`specOf(id).sized`); false for
   *  furniture, whose height the template measures via `onMeasure`. */
  fixedHeight: boolean;
  /**
   * Which SLOT a canvas point is over — a block, and which side of it. Walks
   * the same computed layout the rects come from, so the drop can never
   * disagree with the drawing. Returns an index in the arrangement, or null in
   * the gaps.
   */
  slotAt: (px: number, py: number) => number | null;
  onEnter: () => void;
  onRemove: () => void;
  /**
   * Open this widget's own editor. Present only for widgets that CARRY
   * something a person chose — links, a picture, a GIF.
   *
   * Without it the only way to change a widget's contents was to remove it and
   * add it again, which is survivable for a poster and absurd for eight links:
   * one typo cost the lot. A home screen puts "Edit Widget" behind a tap in
   * jiggle mode, and this is the same gesture in the same mode.
   */
  onEdit?: () => void;
  /** Move the block at `from` so that it sits at `to`. */
  onMove: (from: number, to: number) => void;
  /**
   * The enclosing scroll view and its live offset, for drag-to-edge
   * auto-scroll.
   *
   * WITHOUT IT A LONG PROFILE CANNOT BE REARRANGED. Picking a widget up at the
   * bottom and carrying it to the top is the commonest move there is, and the
   * page simply sat still — the finger reached the top of the SCREEN, which is
   * nowhere near the top of the page. The list reorder screens have had this
   * for a while; the same pattern, the same constants.
   */
  scrollRef?: AnimatedRef<Animated.ScrollView>;
  scrollY?: SharedValue<number>;
  /** Tapped while arranging. The sizes a widget can be are a property of the
   *  widget, so the chooser is opened by the grid rather than drawn here. */
  onTap?: () => void;
  /**
   * Where the remove badge sits, from the block's left edge.
   *
   * IT IS NOT ALWAYS -6. The sized widgets are laid out at the page margin, so
   * a badge hanging 6pt off their corner sits on the page. The furniture —
   * shelves, Lists, Stats — spans the FULL content width and carries its own
   * inner margin, so the same -6 put the badge 6pt outside the canvas, where it
   * was clipped and could not be tapped. Those blocks could not be removed at
   * all, which is not a look-and-feel problem, it is a missing feature.
   */
  badgeLeft?: number;
  /** Lifts the badge clear of a block whose first line is a title. */
  badgeTop?: number;
  /** Content-sized blocks report their height so the layout can use it. */
  onMeasure?: (h: number) => void;
  children: ReactNode;
};

/*
 * NO WOBBLE.
 *
 * It was there because a home screen has one, and on a home screen it is doing
 * real work: those icons are otherwise identical and motionless, so the shake
 * is the only thing that can say "the rules have changed". This grid already
 * has a minus on every block and a bar at the bottom of the screen — the mode
 * is legible without it, and twenty cards jittering under a finger that is
 * trying to aim at one of them is noise in the way of the actual job.
 */

export function ArrangeableBlock({
  index,
  editing,
  canRemove,
  rect,
  fixedHeight,
  slotAt,
  onEnter,
  onRemove,
  onEdit,
  onMove,
  onMeasure,
  onTap,
  badgeLeft = -6,
  badgeTop = -6,
  scrollRef,
  scrollY,
  children,
}: ArrangeProps) {
  /** Where the block is drawn. Follows `rect` with a short timing — except on
   *  the block being carried, which is the finger's to place. */
  const posX = useSharedValue(rect.x);
  const posY = useSharedValue(rect.y);
  /** The latest computed slot, always current even mid-drag, so the drop knows
   *  where to settle without trusting a closure from an older render. */
  const slotX = useSharedValue(rect.x);
  const slotY = useSharedValue(rect.y);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const lifted = useSharedValue(0);
  const carrying = useSharedValue(false);
  /** -1 up, +1 down, 0 idle — set while the finger sits near a screen edge. */
  const scrollDir = useSharedValue(0);
  useFrameCallback(() => {
    'worklet';
    if (!scrollRef || !scrollY || scrollDir.value === 0) return;
    scrollTo(scrollRef, 0, scrollY.value + scrollDir.value * SCROLL_SPEED, false);
  });
  /** Frozen at pick-up: the point the finger grabbed, in canvas coordinates —
   *  the block's slot origin plus where inside it the touch landed. Grip +
   *  translation = the finger, with no measurement anywhere in the sum. */
  const gripX = useSharedValue(0);
  const gripY = useSharedValue(0);
  /**
   * The page offset when the block was picked up.
   *
   * The grip is in CANVAS coordinates, so as auto-scroll moves the page the
   * block travels with the content and slides out from under a finger that has
   * not moved. Adding back however far the page has scrolled since pick-up
   * pins it to the glass — which is what "carrying" means.
   */
  const scrollAtGrab = useSharedValue(0);

  /*
   * THE HELD BLOCK IGNORES THE LAYOUT. Everything else slides to its new place
   * when a reorder recomputes the canvas; the one under the finger stays where
   * the finger put it, because two authorities moving one view is a stutter.
   * This replaces the old mid-drag "correction" that re-measured the window —
   * the origin is frozen instead, so there is nothing to correct.
   */
  useEffect(() => {
    slotX.value = rect.x;
    slotY.value = rect.y;
    if (carrying.value) return;
    /*
     * SLIDE ONLY WHILE ARRANGING. Rects also change when a furniture block
     * reports its measured height a frame after first paint — and animating
     * THAT settle meant the whole profile poured up from the bottom on every
     * open, an entrance nobody asked for playing on a page that had merely
     * finished measuring itself. A reorder is the only rect change that is an
     * event; everything else is bookkeeping and snaps.
     */
    if (!editing) {
      posX.value = rect.x;
      posY.value = rect.y;
      return;
    }
    posX.value = withTiming(rect.x, { duration: 160 });
    posY.value = withTiming(rect.y, { duration: 160 });
    // Shared values are stable references; only the geometry matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect.x, rect.y, editing]);

  /**
   * Reorder AS THE FINGER MOVES. Dropping a 2x2 onto a pair of 1x1s only makes
   * sense if you can see what happens to them first; letting go then commits
   * what is already on screen rather than rearranging afterwards and leaving
   * somebody to work out what they did. `px, py` arrive as plain numbers,
   * already summed on the UI thread — the finger in canvas coordinates.
   */
  const live = (from: number, px: number, py: number) => {
    const slot = slotAt(px, py);
    if (slot == null) return;
    // A slot is a gap BETWEEN blocks, so the gaps either side of this one are
    // both where it already is. Moving to either is a no-op that would fire a
    // haptic on every frame of the drag.
    if (slot === from || slot === from + 1) return;
    // Taking this block out first shifts everything after it down by one.
    const to = slot > from ? slot - 1 : slot;
    tapLight();
    onMove(from, to);
  };

  // A long press anywhere on the profile starts arranging — the gesture every
  // phone already teaches, and the reason no permanent Edit button has to sit
  // on the page costing every visit to serve one occasion.
  /*
   * A TAP WHILE ARRANGING PICKS THE SIZE.
   *
   * On a home screen a widget is resized by holding it and choosing; here the
   * hold is already spent on entering the mode, so the tap is free and is the
   * obvious thing to try. It does nothing outside arranging — the widgets
   * underneath keep their own taps, and a stray tap during a drag would be a
   * dialog in the middle of a move.
   */
  const tap = Gesture.Tap()
    .enabled(editing && onTap != null)
    .maxDuration(300)
    .onEnd((e, ok) => {
      if (!ok || !onTap) return;
      /*
       * NOT WHEN THE TAP WAS ON THE MINUS.
       *
       * The badge is a `Pressable` inside this view, so a tap on it ran the
       * remove AND this gesture -- the widget came off and the size sheet
       * opened behind it, for a widget that was no longer there. A gesture on a
       * parent is not told that a child handled the touch, so the corner has to
       * be excluded by hand.
       */
      if (canRemove && e.x < BADGE_HIT && e.y < BADGE_HIT) return;
      runOnJS(onTap)();
    });

  const hold = Gesture.LongPress()
    .minDuration(450)
    .onStart(() => {
      if (!editing) runOnJS(onEnter)();
    });

  const drag = Gesture.Pan()
    .enabled(editing)
    .activateAfterLongPress(120)
    .onStart((e) => {
      carrying.value = true;
      scrollAtGrab.value = scrollY?.value ?? 0;
      // Snap out of any settle still in flight: the translation is measured
      // from the SLOT, so the block must start exactly there.
      posX.value = slotX.value;
      posY.value = slotY.value;
      dx.value = 0;
      dy.value = 0;
      gripX.value = slotX.value + e.x;
      gripY.value = slotY.value + e.y;
      // PICKED UP. Timing, not spring: a spring overshoots, and a card that
      // wobbles as it leaves the page reads as elastic rather than as something
      // being lifted.
      lifted.value = withTiming(1, { duration: 110 });
    })
    .onUpdate((e) => {
      // FOLLOWS THE FINGER EXACTLY. Any smoothing here shows up as the card
      // trailing the touch, which reads as the phone being slow.
      dx.value = e.translationX;
      dy.value = e.translationY;
      /*
       * NEAR AN EDGE, THE PAGE MOVES. Screen coordinates, not canvas ones: the
       * question is where the FINGER is against the glass, and `live()` above
       * asks a different question in a different space, which is how the two
       * got confused the first time this was written.
       */
      scrollDir.value = e.absoluteY < EDGE_TOP ? -1 : e.absoluteY > SCREEN_H - EDGE_BOTTOM ? 1 : 0;
      /*
       * THE SAME SUM THE CARD IS DRAWN WITH, scroll included.
       *
       * The grip is canvas coordinates frozen at pick-up, so once auto-scroll
       * moves the page the finger sits over a different part of the canvas than
       * grip + translation says. The card had this term added and the DROP TEST
       * did not, so the block followed the finger while the arrangement
       * reflowed around wherever the finger used to be — the two disagreed by
       * exactly however far the page had travelled.
       */
      const scrolled = (scrollY?.value ?? 0) - scrollAtGrab.value;
      runOnJS(live)(index, gripX.value + e.translationX, gripY.value + e.translationY + scrolled);
    })
    .onEnd(() => {
      carrying.value = false;
      scrollDir.value = 0;
      /*
       * PUT DOWN, NOT THROWN. The arrangement was settled during the drag, so
       * this only has to close the gap between where the card is and the slot
       * it already occupies. Springs were wrong here for the same reason as
       * above: the bounce made a finished action look unfinished.
       */
      posX.value = withTiming(slotX.value, { duration: 140 });
      posY.value = withTiming(slotY.value, { duration: 140 });
      dx.value = withTiming(0, { duration: 140 });
      dy.value = withTiming(0, { duration: 140 });
      lifted.value = withTiming(0, { duration: 140 });
    });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: posX.value + dx.value },
      // Plus however far the page has scrolled since pick-up — see `scrollAtGrab`.
      { translateY: posY.value + dy.value + (carrying.value ? (scrollY?.value ?? 0) - scrollAtGrab.value : 0) },
      { scale: 1 + lifted.value * 0.04 },
    ],
    zIndex: lifted.value > 0 ? 20 : 0,
    // A shadow the card only has while it is off the page. A static shadow on a
    // grid is decoration; one that appears exactly when something is lifted is
    // information.
    shadowColor: '#000',
    shadowOpacity: lifted.value * 0.45,
    shadowRadius: lifted.value * 14,
    shadowOffset: { width: 0, height: lifted.value * 8 },
    elevation: lifted.value * 10,
  }));

  return (
    <GestureDetector gesture={Gesture.Exclusive(drag, tap, hold)}>
      <Animated.View
        // Positioned by TRANSFORM from (0,0), not by left/top: the layout box
        // never moves, so `onLayout` below reports pure content height and a
        // reorder animates on the UI thread without a relayout.
        style={[s.abs, { width: rect.w }, fixedHeight && { height: rect.h }, style]}
        onLayout={
          onMeasure ? (e: LayoutChangeEvent) => onMeasure(e.nativeEvent.layout.height) : undefined
        }>
        {children}
        {editing && canRemove && (
          /* Top-LEFT, where a home screen puts it — less a design choice than a
             place people's thumbs already go. */
          <Pressable style={[s.minus, { left: badgeLeft, top: badgeTop }]} hitSlop={10} onPress={onRemove}>
            <Ionicons name="remove" size={16} color="#000" />
          </Pressable>
        )}
        {/* TOP-RIGHT, opposite the minus, so remove and edit can never be
            confused for one another under a moving thumb. */}
        {editing && onEdit != null && (
          <Pressable style={[s.pencil, { right: badgeLeft, top: badgeTop }]} hitSlop={10} onPress={onEdit}>
            <Ionicons name="pencil" size={13} color="#000" />
          </Pressable>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

/** The bar that says you are arranging, and how to stop. */
export function ArrangeBar({ onAdd, onDone }: { onAdd: () => void; onDone: () => void }) {
  return (
    <View style={s.bar}>
      {/* ALWAYS, while arranging. It used to hide when nothing had been removed
          — technically honest, and it meant the one control people go looking
          for was missing exactly when they went looking for it. A sheet that
          says "nothing to add" answers the question; an absent button leaves
          them hunting for a feature they were told exists. */}
      <Pressable style={s.add} onPress={onAdd} hitSlop={8}>
        <Ionicons name="add" size={22} color={colors.text} />
      </Pressable>
      <Pressable style={s.done} onPress={onDone} hitSlop={8}>
        <Ionicons name="checkmark" size={20} color={colors.onYellow} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  abs: { position: 'absolute', left: 0, top: 0 },
  minus: {
    position: 'absolute',
    top: -6,
    left: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.raise,
    alignItems: 'center',
    justifyContent: 'center',
    // Above the block it belongs to, and above its neighbour's edge.
    zIndex: 20,
  },
  pencil: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.raise,
    alignItems: 'center',
    justifyContent: 'center',
    // Above the block it belongs to, and above its neighbour's edge.
    zIndex: 20,
  },
  bar: {
    position: 'absolute',
    right: 16,
    bottom: 28,
    flexDirection: 'row',
    gap: 10,
    zIndex: 50,
  },
  add: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  done: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
