/**
 * Something to do while the library repairs itself.
 *
 * THE FRAME LOOP RUNS ON THE UI THREAD, and that is the entire reason this file
 * is shaped the way it is. `migrations.ts` blocks the JS thread for minutes on a
 * large library, so a game driven by `setInterval` or by React state would tick
 * only when the repair paused for breath — stuttering exactly when it is meant
 * to be distracting somebody. `useFrameCallback` runs in a worklet on the UI
 * thread, the rules in `@/games` are worklets, and the board is drawn by
 * `useAnimatedStyle` reading shared values. Nothing on this screen needs a
 * render from React while a game is running.
 *
 * WHAT CROSSES THE THREAD BOUNDARY: the score, twice a second, so the header can
 * show it, and the game choice when the shuffle button is pressed. Both are
 * cheap and neither is in the loop.
 *
 * The board is plain `<View>`s rather than a canvas or SVG: at 14×20 there are
 * fewer moving pieces than a list row has, and it needs no new dependency.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  COLS,
  MAX_MISSES,
  ROWS,
  moveBucket,
  newCatch,
  newSnake,
  nextGame,
  stepCatch,
  stepSnake,
  turnSnake,
  type CatchState,
  type Dir,
  type Game,
  type SnakeState,
} from '@/games';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { colors, radius } from '@/theme';

/** Board cell, in points. Small enough that a full board is ~280 views. */
const CELL = 14;
/** How long one game tick lasts. Slow enough to play with a thumb. */
const SNAKE_MS = 130;
const CATCH_MS = 220;
/** A new piece every N ticks in the catch game. */
const SPAWN_EVERY = 4;

export function RepairGame({ onClose }: { onClose?: () => void }) {
  const [game, setGame] = useState<Game>('snake');
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);

  /*
   * THE GAME STATE LIVES IN SHARED VALUES, not React state. A `useState` here
   * would need a render per tick, on the thread that is busy repairing — which
   * is the whole thing this design avoids.
   */
  const snake = useSharedValue<SnakeState>(newSnake(7));
  const catcher = useSharedValue<CatchState>(newCatch());
  const acc = useSharedValue(0);
  const ticks = useSharedValue(0);
  const mode = useSharedValue<Game>('snake');

  /*
   * PLAIN FUNCTIONS, NOT `useCallback`. The React Compiler is on and memoises
   * these itself; wrapping them by hand only made it complain that a shared
   * value was being written inside a memo, which is exactly what a shared value
   * is for. Its rule is about React state, and these are not that.
   */
  const restart = () => {
    setOver(false);
    setScore(0);
    snake.value = newSnake(Date.now() % 100000);
    catcher.value = newCatch();
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

  useFrameCallback((frame) => {
    'worklet';
    const dt = frame.timeSincePreviousFrame ?? 16;
    acc.value += dt;
    const period = mode.value === 'snake' ? SNAKE_MS : CATCH_MS;
    if (acc.value < period) return;
    acc.value = 0;
    ticks.value += 1;
    // A seed that changes every tick without `Math.random`, which is not
    // available in a worklet.
    const seed = (ticks.value * 2654435761) % 2147483647;

    if (mode.value === 'snake') {
      const next = stepSnake(snake.value, seed);
      if (next.score !== snake.value.score) runOnJS(setScore)(next.score);
      if (next.over && !snake.value.over) runOnJS(setOver)(true);
      snake.value = next;
    } else {
      const next = stepCatch(catcher.value, seed, ticks.value % SPAWN_EVERY === 0);
      if (next.score !== catcher.value.score) runOnJS(setScore)(next.score);
      if (next.over && !catcher.value.over) runOnJS(setOver)(true);
      catcher.value = next;
    }
  }, true);

  /*
   * ONE GESTURE FOR BOTH GAMES. A swipe turns the snake; a horizontal drag
   * slides the bucket. Arrow keys are not a thing on a phone, and buttons on a
   * waiting screen would take room from the board.
   */
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      'worklet';
      if (mode.value !== 'catch') return;
      // Direct control rather than accumulating: on a small board, following
      // the thumb is easier to aim than nudging.
      const cells = Math.round(e.translationX / CELL);
      if (cells !== 0) {
        catcher.value = moveBucket(catcher.value, cells > 0 ? 1 : -1);
      }
    })
    .onEnd((e) => {
      'worklet';
      if (mode.value !== 'snake') return;
      const { translationX: dx, translationY: dy } = e;
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      const dir: Dir =
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      snake.value = turnSnake(snake.value, dir);
    });

  const boardW = COLS * CELL;
  const boardH = ROWS * CELL;

  return (
    <View style={styles.wrap}>
      <View style={[styles.header, { width: boardW }]}>
        <Text style={styles.score}>
          {over ? t('repairGame.over') : t(game === 'snake' ? 'repairGame.snake' : 'repairGame.catch')}
          {'  '}
          <Text style={styles.scoreNum}>{score}</Text>
        </Text>
        <View style={styles.controls}>
          {over && (
            <Pressable hitSlop={10} onPress={restart} accessibilityLabel={t('repairGame.again')}>
              <Ionicons name="refresh" size={16} color={colors.dim} />
            </Pressable>
          )}
          {/* The shuffle: one control, one outcome, discoverable by pressing it. */}
          <Pressable hitSlop={10} onPress={shuffle} accessibilityLabel={t('repairGame.shuffle')}>
            <Ionicons name="shuffle" size={16} color={colors.dim} />
          </Pressable>
          {onClose && (
            <Pressable hitSlop={10} onPress={onClose} accessibilityLabel={t('repairGame.close')}>
              <Ionicons name="close" size={16} color={colors.dim} />
            </Pressable>
          )}
        </View>
      </View>

      <GestureDetector gesture={pan}>
        <View style={[styles.board, { width: boardW, height: boardH }]}>
          {game === 'snake' ? (
            <SnakeBoard state={snake} />
          ) : (
            <CatchBoard state={catcher} />
          )}
        </View>
      </GestureDetector>

      <Text style={styles.hint}>{t(game === 'snake' ? 'repairGame.hintSnake' : 'repairGame.hintCatch')}</Text>
    </View>
  );
}

/**
 * A FIXED POOL OF VIEWS, moved rather than created.
 *
 * Mounting a view per body segment would mean React renders on the JS thread —
 * the thread that is busy. So the maximum number of cells is mounted once and
 * each one reads its own position from the shared value on the UI thread. A
 * segment that does not exist yet is simply transparent.
 */
const MAX_BODY = 60;

function SnakeBoard({ state }: { state: { value: SnakeState } }) {
  return (
    <>
      {Array.from({ length: MAX_BODY }, (_, i) => (
        <Segment key={i} index={i} state={state} />
      ))}
      <Food state={state} />
    </>
  );
}

function Segment({ index, state }: { index: number; state: { value: SnakeState } }) {
  const style = useAnimatedStyle(() => {
    'worklet';
    const p = state.value.body[index];
    if (!p) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }] };
    return {
      opacity: index === 0 ? 1 : 0.85,
      transform: [{ translateX: p.x * CELL }, { translateY: p.y * CELL }],
    };
  });
  return <Animated.View style={[styles.cell, styles.snakeCell, style]} />;
}

function Food({ state }: { state: { value: SnakeState } }) {
  const style = useAnimatedStyle(() => {
    'worklet';
    const f = state.value.food;
    return { transform: [{ translateX: f.x * CELL }, { translateY: f.y * CELL }] };
  });
  return <Animated.View style={[styles.cell, styles.food, style]} />;
}

const MAX_DROPS = 20;

function CatchBoard({ state }: { state: { value: CatchState } }) {
  const bucket = useAnimatedStyle(() => {
    'worklet';
    const half = Math.floor(3 / 2);
    return {
      transform: [
        { translateX: (state.value.bucket - half) * CELL },
        { translateY: (ROWS - 1) * CELL },
      ],
    };
  });
  return (
    <>
      {Array.from({ length: MAX_DROPS }, (_, i) => (
        <Drop key={i} index={i} state={state} />
      ))}
      <Animated.View style={[styles.bucket, bucket]} />
      <Misses state={state} />
    </>
  );
}

function Drop({ index, state }: { index: number; state: { value: CatchState } }) {
  const style = useAnimatedStyle(() => {
    'worklet';
    const d = state.value.drops[index];
    if (!d) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }] };
    return { opacity: 1, transform: [{ translateX: d.x * CELL }, { translateY: d.y * CELL }] };
  });
  return <Animated.View style={[styles.cell, styles.food, style]} />;
}

/** Three dots that go out as pieces are missed — the only score that is a cost. */
function Misses({ state }: { state: { value: CatchState } }) {
  return (
    <View style={styles.misses}>
      {Array.from({ length: MAX_MISSES }, (_, i) => (
        <Miss key={i} index={i} state={state} />
      ))}
    </View>
  );
}

function Miss({ index, state }: { index: number; state: { value: CatchState } }) {
  const style = useAnimatedStyle(() => {
    'worklet';
    return { opacity: state.value.missed > index ? 0.25 : 1 };
  });
  return <Animated.View style={[styles.missDot, style]} />;
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  score: { color: colors.dim, fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
  scoreNum: { color: colors.text, fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  board: { backgroundColor: colors.panel, borderRadius: radius.card, overflow: 'hidden' },
  cell: { position: 'absolute', width: CELL - 2, height: CELL - 2, margin: 1, borderRadius: 3 },
  // The BRAND, not `colors.yellow`: that token is ink on the light theme, and a
  // board of black squares on a white page is not a game, it is a redaction.
  snakeCell: { backgroundColor: colors.brand },
  food: { backgroundColor: '#E8834A', borderRadius: CELL },
  bucket: { position: 'absolute', width: CELL * 3 - 2, height: CELL - 2, margin: 1, borderRadius: 3, backgroundColor: colors.brand },
  misses: { position: 'absolute', top: 6, right: 6, flexDirection: 'row', gap: 4 },
  missDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.faint },
  hint: { color: colors.faint, fontSize: 11 },
});
