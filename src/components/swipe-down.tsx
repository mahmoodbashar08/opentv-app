import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { nextAtTop } from '@/pure';

/**
 * Full-screen drag-to-dismiss, TV Time style: when the page's content is
 * scrolled to the top, dragging down moves the whole page with the finger;
 * release past the threshold pops back to the previous screen.
 *
 * Usage:
 *   const { gesture, headerGesture, animatedStyle, onScroll } = useSwipeDown();
 *   <GestureDetector gesture={gesture}>
 *     <Animated.View style={[{ flex: 1 }, animatedStyle]}>
 *       <GestureDetector gesture={headerGesture}><View>…fixed banner…</View></GestureDetector>
 *       <ScrollView onScroll={onScroll} onScrollEndDrag={onScroll}
 *         onMomentumScrollEnd={onScroll} scrollEventThrottle={32} bounces={false}>…
 */
export function useSwipeDown() {
  const translateY = useSharedValue(0);
  // at-top plus WHEN it became so, kept together so the timestamp can never
  // drift from the flag and no effect is needed to maintain it
  const [top, setTop] = useState({ at: true, since: 0 });
  const atTop = top.at;
  const armedAtMs = top.since;
  const setAtTop = useCallback(
    (v: boolean) => setTop((prev) => (prev.at === v ? prev : { at: v, since: Date.now() })),
    [],
  );

  // When the gesture last became available. A touch that begins within a
  // moment of that is the tail of the scroll that just arrived at the top —
  // the finger is already moving downwards — not a deliberate drag. Enabling
  // alone cannot tell them apart, which is why guarding the flag kept failing:
  // whichever path flipped it, the same motion was captured.
  /** decided once per touch, in onBegin, so nothing that happens mid-drag matters */
  const dismissible = useSharedValue(true);


  const makePan = useCallback(
    (enabled: boolean) =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetY(16)
        .failOffsetX([-24, 24])
        .onBegin(() => {
          dismissible.value = Date.now() - armedAtMs > 250;
        })
        .onUpdate((e) => {
          // a continuation drag still tracks a little, so it never feels dead,
          // but it springs back instead of dismissing
          translateY.value = Math.max(0, dismissible.value ? e.translationY : e.translationY * 0.15);
        })
        .onEnd((e) => {
          if (dismissible.value && (e.translationY > 110 || e.velocityY > 650)) {
            runOnJS(router.back)();
          } else {
            // clamped: snaps home without the bounce that flashed the screen behind
            translateY.value = withSpring(0, { damping: 26, stiffness: 300, overshootClamping: true });
          }
        }),
    [translateY, dismissible, armedAtMs],
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

  // content areas: only draggable while their scroll view sits at the top
  const gesture = useMemo(() => makePan(atTop), [makePan, atTop]);
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

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const top = e.nativeEvent.contentOffset.y <= 2;
    const next = nextAtTop(atTop, top, scrolling.current);
    if (next !== atTop) setAtTop(next);
  };

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
