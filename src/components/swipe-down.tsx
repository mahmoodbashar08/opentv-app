import { router } from 'expo-router';
import { useCallback, useMemo, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { nextAtTop, shouldDismissOnPull } from '@/pure';

/**
 * Pull-to-dismiss, TV Time style: scroll up, the header expands back to full
 * height, you reach the top — and only if you KEEP pulling does the page
 * leave. The fixed header can still be dragged directly at any time.
 *
 * Deliberately driven by the scroll view's own overscroll rather than a pan
 * gesture over the content. Three attempts at the gesture version all failed
 * the same way: whatever armed it at the top did so while the finger was still
 * travelling downwards, so it captured that motion and scrolling up read as
 * "go back". Overscroll is only ever reported when there is nothing left to
 * scroll and the user is still pulling, so it cannot be mistaken for arrival.
 *
 * Usage:
 *   const { gesture, headerGesture, animatedStyle, onScroll } = useSwipeDown();
 *   <GestureDetector gesture={gesture}>
 *     <Animated.View style={[{ flex: 1 }, animatedStyle]}>
 *       <GestureDetector gesture={headerGesture}><View>…fixed banner…</View></GestureDetector>
 *       <ScrollView onScroll={onScroll} onScrollEndDrag={onScroll}
 *         onMomentumScrollEnd={onScrollSettled} onScrollBeginDrag={onScrollBeginDrag}
 *         scrollEventThrottle={16} bounces>…
 *
 * `bounces` must stay ON: pulling past the top is the dismiss signal.
 */
export function useSwipeDown() {
  const translateY = useSharedValue(0);
  /*
   * THE ARMING TIMESTAMP IS A SHARED VALUE, NOT STATE, AND THAT IS A BUG FIX.
   *
   * It used to live in `useState` alongside the at-top flag, which put it in
   * `makePan`'s dependency list -- so every scroll that changed the flag built
   * BRAND NEW Gesture objects and handed them to the detectors. Replacing a
   * gesture while a finger is on the screen drops that touch: scroll the page,
   * reach for the ... button in the header, and the tap lands in the gap and
   * does nothing. "Sometimes I cannot press the three dots" is exactly that,
   * and "sometimes" is because it only happens in the moment after a scroll.
   *
   * A shared value is also more correct than the closure it replaces: the
   * worklet reads the LIVE timestamp instead of whichever one was captured
   * when the gesture happened to be built.
   *
   * The flag went the same way. Nothing renders from it -- no screen reads it
   * and the gesture no longer depends on it -- so as state it was re-rendering
   * three of the app's busiest screens on every scroll to change a boolean
   * only `onScroll` ever looks at.
   */
  const atTop = useRef(true);
  const armedAt = useSharedValue(0);
  /* EMPTY DEPS, DELIBERATELY. Both boxes it writes are stable for the life of
     the hook, and naming `armedAt` in the array is the one thing the React
     Compiler's rule forbids outright: a value passed to a hook may not then be
     modified. Keeping the array empty is also what makes this function stable,
     which is the whole point -- `makePan` depends on it. */
  const setAtTop = useCallback((v: boolean) => {
    if (atTop.current === v) return;
    atTop.current = v;
    armedAt.value = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, []);

  // When the gesture last became available. A touch that begins within a
  // moment of that is the tail of the scroll that just arrived at the top —
  // the finger is already moving downwards — not a deliberate drag. Enabling
  // alone cannot tell them apart, which is why guarding the flag kept failing:
  // whichever path flipped it, the same motion was captured.
  /** decided once per touch, in onBegin, so nothing that happens mid-drag matters */
  const dismissible = useSharedValue(true);
  /** Set the instant either dismissal path commits, and read by both. See the
   *  note in `onEnd`: the two of them firing together popped two screens. */
  const dismissing = useSharedValue(false);
  /** True only for the FIRST caller. Declared above `makePan` deliberately:
   *  the compiler rule that forbids writing to a value a hook has captured is
   *  order-sensitive, and its own advice is to move the write earlier. */
  const commitDismiss = useCallback(() => {
    if (dismissing.value) return false;
    dismissing.value = true;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a stable box
  }, []);


  const makePan = useCallback(
    (enabled: boolean) =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetY(16)
        .failOffsetX([-24, 24])
        .onBegin(() => {
          dismissible.value = Date.now() - armedAt.value > 250;
        })
        .onUpdate((e) => {
          // a continuation drag still tracks a little, so it never feels dead,
          // but it springs back instead of dismissing
          translateY.value = Math.max(0, dismissible.value ? e.translationY : e.translationY * 0.15);
        })
        .onEnd((e) => {
          if (dismissible.value && (e.translationY > 110 || e.velocityY > 650)) {
            /*
             * ONCE. This is the freeze.
             *
             * TWO independent paths dismiss this screen -- this fling, and the
             * overscroll pull in `onScroll` -- and only the other one was
             * guarded. So a fling on the header while the list was already
             * pulled past its top fired `router.back()` twice, which does not
             * go back twice as a no-op: it pops the screen AND the one behind
             * it, dropping the reader out of a tab they never left. Two quick
             * pulls did the same. That is the "it glitches".
             *
             * And the freeze on top of it: the drag leaves `translateY` wherever
             * the finger let go, and nothing ever put it back. When the second
             * `back` had nothing left to pop, the screen stayed on top of the
             * stack translated a few hundred points down the display -- mostly
             * off-screen, still mounted, still eating touches. Frozen, in the
             * only sense that matters to somebody holding the phone.
             *
             * The guard is a shared value because the check has to happen HERE,
             * on the UI thread, in the same frame as the decision. A JS-side
             * ref is read a frame late, which is exactly the window both of
             * these fire in.
             */
            if (!dismissing.value) {
              dismissing.value = true;
              runOnJS(router.back)();
            }
          }
          // ALWAYS, dismissing or not. A screen that is going away animates out
          // over this; a `back` that could not pop anything leaves a screen the
          // reader can still use, instead of one parked off the bottom edge.
          // clamped: snaps home without the bounce that flashed the screen behind
          translateY.value = withSpring(0, { damping: 26, stiffness: 300, overshootClamping: true });
        }),
    [translateY, dismissible, armedAt],
  );

  // ARMING DELAY. atTop alone is not enough: several screens set it directly
  // when their content swaps (a tab change, a new episode page), and a scroll
  // reaching the top can flip it while the finger is still travelling
  // downwards. Any of those arms the gesture mid-touch, and it takes over that
  // same motion — scrolling up reads as "go back".
  //
  // A touch that is already in progress ends well within this window, so it can
  // never be captured. A deliberate drag starts after it and is unaffected.
  // stamp the moment the gesture becomes available, so onBegin can tell a
  // deliberate drag from the tail of the scroll that just arrived at the top

  // Content areas are NEVER driven by the pan any more. Arming a drag when the
  // list reached the top is what made scrolling up read as "go back": at that
  // instant the finger is still travelling downwards, so the gesture took over
  // the same motion. The scroll view reports a pull past the top instead —
  // see onScroll — which cannot be confused with arriving at it.
  const gesture = useMemo(() => makePan(false), [makePan]);
  // fixed banners/headers outside the scroll view: always draggable
  const headerGesture = useMemo(() => makePan(true), [makePan]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // true while a finger-drag or its momentum is still running. The gesture must
  // not re-arm during one: scrolling back up reaches the top while the finger
  // is still moving downwards, and the newly-armed pan would take over that
  // same motion and dismiss the page — scrolling up read as "go back".
  const scrolling = useRef(false);
  /* In a `useCallback` for the same reason `setAtTop` is: it writes to a shared
     value, and the React Compiler forbids that in a function it treats as part
     of render. Stable deps also mean the ScrollView is not handed a new
     handler every frame of a scroll. */
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    // pulled past the top with the finger still down — the page leaves.
    // Same guard as the fling, and it has to be the SAME one: either path
    // committing must stop the other.
    if (shouldDismissOnPull(y, scrolling.current) && commitDismiss()) {
      router.back();
      return;
    }
    setAtTop(nextAtTop(atTop.current, y <= 2, scrolling.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable boxes only
  }, [commitDismiss]);

  const onScrollBeginDrag = () => {
    scrolling.current = true;
  };

  /** end of a drag or of its momentum — the scroll has come to rest */
  const onScrollSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrolling.current = false;
    onScroll(e);
  };

  // setAtTop is exposed for screens that swap content without scroll events
  // (tab switches, pager page changes) so they can re-sync the flag
  return { gesture, headerGesture, animatedStyle, onScroll, onScrollBeginDrag, onScrollSettled, setAtTop };
}
