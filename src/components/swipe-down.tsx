import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

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
  const [atTop, setAtTop] = useState(true);

  const makePan = useCallback(
    (enabled: boolean) =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetY(16)
        .failOffsetX([-24, 24])
        .onUpdate((e) => {
          translateY.value = Math.max(0, e.translationY);
        })
        .onEnd((e) => {
          if (e.translationY > 110 || e.velocityY > 650) {
            runOnJS(router.back)();
          } else {
            // clamped: snaps home without the bounce that flashed the screen behind
            translateY.value = withSpring(0, { damping: 26, stiffness: 300, overshootClamping: true });
          }
        }),
    [translateY],
  );

  // content areas: only draggable while their scroll view sits at the top
  const gesture = useMemo(() => makePan(atTop), [makePan, atTop]);
  // fixed banners/headers outside the scroll view: always draggable
  const headerGesture = useMemo(() => makePan(true), [makePan]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const top = e.nativeEvent.contentOffset.y <= 2;
    if (top !== atTop) setAtTop(top);
  };

  // setAtTop is exposed for screens that swap content without scroll events
  // (tab switches, pager page changes) so they can re-sync the flag
  return { gesture, headerGesture, animatedStyle, onScroll, setAtTop };
}
