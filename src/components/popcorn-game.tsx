/**
 * 🍿 The popcorn catcher, and a snake that eats popcorn. The waiting games.
 *
 * SAME GAME, DIFFERENT THREAD. This shipped in 1.1.7 on `setInterval` with a
 * React state update per tick, and that is exactly why it could never go on the
 * startup-repair screen: the changelog recorded the feature as "blocked on the
 * setInterval-on-JS-thread problem", because the thread it needed was the one
 * `migrations.ts` holds for minutes. The loop now runs in a worklet on the UI
 * thread — `useFrameCallback` ticking the pure rules in `@/games`, positions
 * drawn by `useAnimatedStyle` from shared values — so it plays at full speed
 * while the library rebuilds behind it.
 *
 * THE GAME ITSELF IS UNCHANGED. Same 45-second round, same bucket, same
 * speed-up per point, same one-in-nine clock worth five seconds, same best
 * score in `meta`. People have a number in there; it must not quietly become a
 * different game.
 *
 * WHAT CROSSES THE THREAD BOUNDARY: the score, the whole seconds on the clock,
 * and game over. Nothing per frame, and nothing in the loop.
 *
 * A FIXED POOL OF VIEWS, moved rather than created. Mounting a kernel per
 * kernel would put React renders back on the busy thread.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import { getMeta, setMeta } from '@/db';
import {
  BUCKET_W,
  COLS,
  KERNEL,
  ROUND_MS,
  ROWS,
  newPopcorn,
  newSnake,
  nextGame,
  slideBucket,
  stepPopcorn,
  stepSnake,
  turnSnake,
  type Dir,
  type Game,
  type PopcornState,
  type SnakeState,
} from '@/games';
import { tapLight } from '@/haptics';
import { colors, radius } from '@/theme';
import { t } from '@/i18n';

export function bestPopcornScore(): number {
  return Number(getMeta('popcornBest') ?? '0') || 0;
}

/** More kernels than the spawn rate can ever put on screen at once. */
const MAX_KERNELS = 24;
/** Longer than the snake can grow on a board this size before it fills. */
const MAX_BODY = 80;
/** One snake step. Slow enough to steer with a thumb. */
const SNAKE_MS = 130;

export function PopcornGame({ height = 240 }: { height?: number }) {
  const [size, setSize] = useState({ w: 0, h: height });
  const [game, setGame] = useState<Game>('popcorn');
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(bestPopcornScore());
  const [secs, setSecs] = useState(Math.ceil(ROUND_MS / 1000));
  const [over, setOver] = useState(false);

  const pop = useSharedValue<PopcornState>(newPopcorn(0));
  const snake = useSharedValue<SnakeState>(newSnake(7));
  const acc = useSharedValue(0);
  const ticks = useSharedValue(0);
  const mode = useSharedValue<Game>('popcorn');
  const w = useSharedValue(0);
  const h = useSharedValue(height);

  const onLayout = (e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    setSize({ w: width, h: height });
    w.value = width;
    h.value = height;
    if (pop.value.bucketX === 0) pop.value = newPopcorn(width);
  };

  /*
   * PLAIN FUNCTIONS, NOT `useCallback`. The React Compiler is on and memoises
   * them itself; hand-wrapping only made it object to a shared value being
   * written inside a memo, which is what a shared value is for.
   */
  const restart = () => {
    setOver(false);
    setScore(0);
    setSecs(Math.ceil(ROUND_MS / 1000));
    pop.value = newPopcorn(w.value);
    snake.value = newSnake(Date.now() % 100000);
    acc.value = 0;
    ticks.value = 0;
  };

  const shuffle = () => {
    tapLight();
    const n = nextGame(mode.value);
    mode.value = n;
    setGame(n);
    restart();
  };

  const saveBest = (s: number) => {
    if (s > (Number(getMeta('popcornBest') ?? '0') || 0)) {
      setMeta('popcornBest', String(s));
      setBest(s);
    }
  };

  useFrameCallback((frame) => {
    'worklet';
    if (w.value === 0) return;
    const dt = Math.min(frame.timeSincePreviousFrame ?? 16, 100);
    ticks.value += 1;
    const seed = (ticks.value * 2654435761) % 2147483647;

    if (mode.value === 'popcorn') {
      const prev = pop.value;
      const next = stepPopcorn(prev, dt, w.value, h.value, seed);
      if (next.score !== prev.score) {
        runOnJS(setScore)(next.score);
        runOnJS(saveBest)(next.score);
      }
      const s = Math.ceil(next.msLeft / 1000);
      if (s !== Math.ceil(prev.msLeft / 1000)) runOnJS(setSecs)(s);
      if (next.over && !prev.over) runOnJS(setOver)(true);
      pop.value = next;
      return;
    }

    // The snake moves on its own clock rather than per frame.
    acc.value += dt;
    if (acc.value < SNAKE_MS) return;
    acc.value = 0;
    const prev = snake.value;
    const next = stepSnake(prev, seed);
    if (next.score !== prev.score) runOnJS(setScore)(next.score);
    if (next.over && !prev.over) runOnJS(setOver)(true);
    snake.value = next;
  }, true);

  /*
   * ONE GESTURE, TWO GAMES. Dragging slides the bucket; a swipe turns the
   * snake. `minDistance(0)` so a tap moves the bucket straight to the finger,
   * which is the shipped behaviour.
   *
   * NOT `runOnJS` any more: it updates a shared value directly on the UI
   * thread, so the bucket keeps following the finger even while JS is blocked.
   */
  const pan = Gesture.Pan()
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .onBegin((e) => {
      'worklet';
      if (mode.value === 'popcorn' && !pop.value.over) pop.value = slideBucket(pop.value, e.x, w.value);
    })
    .onUpdate((e) => {
      'worklet';
      if (mode.value === 'popcorn' && !pop.value.over) pop.value = slideBucket(pop.value, e.x, w.value);
    })
    .onEnd((e) => {
      'worklet';
      if (mode.value !== 'snake') return;
      const dx = e.translationX;
      const dy = e.translationY;
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      snake.value = turnSnake(snake.value, dir);
    });

  const cell = size.w > 0 ? Math.floor(Math.min(size.w / COLS, (height - 60) / ROWS)) : 0;

  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.arena, { height }]} onLayout={onLayout}>
        <View style={styles.scoreRow} pointerEvents="box-none">
          <Text style={styles.score}>🍿 {score}</Text>
          {game === 'popcorn' ? <Text style={styles.timer}>{secs}s</Text> : <View />}
          <View style={styles.right}>
            <Text style={styles.best}>{t('popcornGame.best', { score: best })}</Text>
            {/* One control, one outcome, discoverable by pressing it. */}
            <Pressable hitSlop={12} onPress={shuffle} accessibilityLabel={t('popcornGame.shuffle')}>
              <Ionicons name="shuffle" size={16} color={colors.dim} />
            </Pressable>
          </View>
        </View>

        {game === 'popcorn' ? (
          <>
            {Array.from({ length: MAX_KERNELS }, (_, i) => (
              <KernelView key={i} index={i} state={pop} />
            ))}
            <Bucket state={pop} />
          </>
        ) : (
          cell > 0 && (
            <View style={[styles.board, { width: cell * COLS, height: cell * ROWS }]}>
              {Array.from({ length: MAX_BODY }, (_, i) => (
                <Segment key={i} index={i} state={snake} cell={cell} />
              ))}
              <Food state={snake} cell={cell} />
            </View>
          )
        )}

        {over && (
          <View style={styles.overlay}>
            <Text style={styles.overTitle}>
              {game === 'popcorn' ? t('popcornGame.timesUp') : t('popcornGame.snakeOver')}
            </Text>
            <Text style={styles.overScore}>
              🍿 {score}
              {score >= best && score > 0
                ? `  ·  ${t('popcornGame.newBest')}`
                : `  ·  ${t('popcornGame.best', { score: best })}`}
            </Text>
            <Pressable style={styles.again} onPress={restart}>
              <Text style={styles.againText}>{t('popcornGame.playAgain')}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </GestureDetector>
  );
}

function KernelView({ index, state }: { index: number; state: { value: PopcornState } }) {
  const style = useAnimatedStyle(() => {
    'worklet';
    const k = state.value.kernels[index];
    if (!k) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }] };
    return { opacity: 1, transform: [{ translateX: k.x }, { translateY: k.y }] };
  });
  const clock = useAnimatedStyle(() => {
    'worklet';
    return { opacity: state.value.kernels[index]?.clock ? 1 : 0 };
  });
  const corn = useAnimatedStyle(() => {
    'worklet';
    const k = state.value.kernels[index];
    return { opacity: k && !k.clock ? 1 : 0 };
  });
  // BOTH GLYPHS ARE MOUNTED and one is transparent, because swapping the text
  // of a node would be a React render — per kernel, per frame, on the thread
  // this whole file exists to stay off.
  return (
    <Animated.View pointerEvents="none" style={[styles.kernelBox, style]}>
      <Animated.Text style={[styles.kernel, corn]}>🍿</Animated.Text>
      <Animated.Text style={[styles.kernel, styles.stacked, clock]}>⏰</Animated.Text>
    </Animated.View>
  );
}

function Bucket({ state }: { state: { value: PopcornState } }) {
  const style = useAnimatedStyle(() => {
    'worklet';
    return { opacity: state.value.over ? 0 : 1, transform: [{ translateX: state.value.bucketX }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.bucketBox, style]}>
      <View style={styles.bucketRim} />
      <View style={styles.bucketBody}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={[styles.stripe, i % 2 === 0 ? styles.stripeRed : styles.stripeWhite]} />
        ))}
      </View>
    </Animated.View>
  );
}

function Segment({ index, state, cell }: { index: number; state: { value: SnakeState }; cell: number }) {
  const style = useAnimatedStyle(() => {
    'worklet';
    const p = state.value.body[index];
    if (!p) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }] };
    return {
      opacity: index === 0 ? 1 : 0.85,
      transform: [{ translateX: p.x * cell }, { translateY: p.y * cell }],
    };
  });
  return <Animated.View style={[styles.cell, { width: cell - 2, height: cell - 2 }, style]} />;
}

function Food({ state, cell }: { state: { value: SnakeState }; cell: number }) {
  const style = useAnimatedStyle(() => {
    'worklet';
    const f = state.value.food;
    return { transform: [{ translateX: f.x * cell }, { translateY: f.y * cell }] };
  });
  return (
    <Animated.Text style={[styles.foodGlyph, { fontSize: cell, lineHeight: cell + 2 }, style]}>🍿</Animated.Text>
  );
}

const styles = StyleSheet.create({
  arena: {
    backgroundColor: '#17171A',
    borderRadius: radius.card,
    overflow: 'hidden',
    marginTop: 14,
    // A play area has no reading direction, and it must not mirror. The pan
    // gesture reports `e.x` as a physical left-to-right offset, while a
    // translate on the bucket and kernels flips under RTL — so in Arabic the
    // bucket ran opposite the finger. Pinning the arena keeps input and
    // rendering in the same coordinate system in every language.
    direction: 'ltr',
    alignItems: 'center',
  },
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 10,
    alignSelf: 'stretch',
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  score: { color: colors.yellow, fontWeight: '800', fontSize: 15 },
  timer: { color: colors.text, fontWeight: '800', fontSize: 14, fontVariant: ['tabular-nums'] },
  best: { color: colors.dim, fontWeight: '700', fontSize: 13 },
  kernelBox: { position: 'absolute', top: 0, left: 0, width: KERNEL, height: KERNEL },
  kernel: { fontSize: KERNEL - 4 },
  stacked: { position: 'absolute', top: 0, left: 0 },
  board: { marginTop: 2 },
  // The BRAND, never `colors.yellow`: that token becomes INK in the light
  // theme, and a board of black squares is a redaction rather than a game.
  cell: { position: 'absolute', margin: 1, borderRadius: 3, backgroundColor: colors.brand },
  foodGlyph: { position: 'absolute' },
  bucketBox: { position: 'absolute', bottom: 6, left: 0, width: BUCKET_W, alignItems: 'center' },
  // Only the top corners round, and there's no gap beneath: a fully rounded
  // rim sitting a pixel above the body let the background show through and
  // read as a separate floating bar rather than the lip of the tub.
  bucketRim: { width: BUCKET_W, height: 7, backgroundColor: '#E23636', borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  bucketBody: {
    width: BUCKET_W - 8,
    height: 30,
    flexDirection: 'row',
    overflow: 'hidden',
    borderBottomLeftRadius: 9,
    borderBottomRightRadius: 9,
  },
  stripe: { flex: 1 },
  stripeRed: { backgroundColor: '#E23636' },
  stripeWhite: { backgroundColor: '#F4EFE6' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,.45)',
  },
  overTitle: { color: colors.text, fontWeight: '900', fontSize: 18 },
  overScore: { color: colors.yellow, fontWeight: '800', fontSize: 15 },
  again: { backgroundColor: colors.yellow, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 10, marginTop: 6 },
  againText: { color: '#1B1400', fontWeight: '900', fontSize: 13, letterSpacing: 0.5 },
});
