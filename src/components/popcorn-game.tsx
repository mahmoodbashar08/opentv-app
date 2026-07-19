/**
 * 🍿 The popcorn catcher — the tiny waiting game. Kernels fall, you slide the
 * bucket, the clock runs: 45-second rounds, then Play again. No network, no
 * libraries: pure JS on a timer. Best round score persists in meta so the
 * import screen and the Settings replay page share one leaderboard of you.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { getMeta, setMeta } from '@/db';
import { colors, radius } from '@/theme';

type Kernel = { id: number; x: number; y: number; speed: number; kind: 'corn' | 'clock' };

const TICK_MS = 50;
const ROUND_MS = 45_000;
const BUCKET_W = 56;
const KERNEL = 26;

export function bestPopcornScore(): number {
  return Number(getMeta('popcornBest') ?? '0') || 0;
}

export function PopcornGame({ height = 240 }: { height?: number }) {
  const [size, setSize] = useState({ w: 0, h: height });
  const [kernels, setKernels] = useState<Kernel[]>([]);
  const [bucketX, setBucketX] = useState(0);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(bestPopcornScore());
  const [msLeft, setMsLeft] = useState(ROUND_MS);
  const [bonusAt, setBonusAt] = useState(0); // when a clock was caught — flashes +5s
  const [over, setOver] = useState(false);
  const bucketRef = useRef(0);
  const scoreRef = useRef(0);
  const msRef = useRef(ROUND_MS);
  const overRef = useRef(false);
  const nextId = useRef(1);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setSize({ w, h: height });
    if (bucketRef.current === 0) {
      bucketRef.current = (w - BUCKET_W) / 2;
      setBucketX(bucketRef.current);
    }
  };

  const restart = () => {
    setBonusAt(0);
    scoreRef.current = 0;
    msRef.current = ROUND_MS;
    overRef.current = false;
    setScore(0);
    setMsLeft(ROUND_MS);
    setKernels([]);
    setOver(false);
  };

  useEffect(() => {
    if (size.w === 0) return;
    let spawnIn = 0;
    const t = setInterval(() => {
      if (overRef.current) return;
      msRef.current -= TICK_MS;
      if (msRef.current <= 0) {
        overRef.current = true;
        setMsLeft(0);
        setOver(true);
        setKernels([]);
        return;
      }
      setMsLeft(msRef.current);
      setKernels((prev) => {
        let next = prev.map((k) => ({ ...k, y: k.y + k.speed }));
        const catchY = size.h - 44;
        const caught = next.filter(
          (k) => k.y >= catchY && k.x + KERNEL / 2 >= bucketRef.current && k.x + KERNEL / 2 <= bucketRef.current + BUCKET_W,
        );
        if (caught.length) {
          const corn = caught.filter((k) => k.kind === 'corn').length;
          const clocks = caught.length - corn;
          if (corn) {
            scoreRef.current += corn;
            setScore(scoreRef.current);
            if (scoreRef.current > (Number(getMeta('popcornBest') ?? '0') || 0)) {
              setMeta('popcornBest', String(scoreRef.current));
              setBest(scoreRef.current);
            }
          }
          if (clocks) {
            // ⏰ caught — more time on the clock, the round is yours to extend
            msRef.current += clocks * 5000;
            setMsLeft(msRef.current);
            setBonusAt(Date.now());
          }
        }
        next = next.filter((k) => k.y < size.h - 10 && !caught.includes(k));
        spawnIn -= TICK_MS;
        if (spawnIn <= 0) {
          // gets a touch quicker as you score — never unfair, it's a snack
          const speedup = Math.min(scoreRef.current * 0.06, 4);
          const clockOk = ROUND_MS - msRef.current > 5000 && Math.random() < 0.11;
          next.push({
            id: nextId.current++,
            x: Math.random() * Math.max(size.w - KERNEL, 1),
            y: -KERNEL,
            speed: 4 + speedup + Math.random() * 2,
            kind: clockOk ? 'clock' : 'corn',
          });
          spawnIn = Math.max(900 - scoreRef.current * 12, 380);
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(t);
  }, [size.w, size.h]);

  const moveBucket = (x: number) => {
    const clamped = Math.max(0, Math.min(x - BUCKET_W / 2, size.w - BUCKET_W));
    bucketRef.current = clamped;
    setBucketX(clamped);
  };

  // gesture-handler pan tracks the finger reliably even inside a scroll view —
  // far smoother than the basic touch responder, which dropped moves. runOnJS
  // so the callbacks can setState; minDistance 0 = the bucket jumps to a tap too
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .shouldCancelWhenOutside(false)
        .onBegin((e) => moveBucket(e.x))
        .onUpdate((e) => moveBucket(e.x))
        .enabled(!over),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [over, size.w],
  );

  return (
    <GestureDetector gesture={pan}>
    <View style={[styles.arena, { height }]} onLayout={onLayout}>
      <View style={styles.scoreRow} pointerEvents="none">
        <Text style={styles.score}>🍿 {score}</Text>
        <Text style={styles.timer}>{Math.ceil(msLeft / 1000)}s</Text>
        <Text style={styles.best}>Best {best}</Text>
      </View>
      {kernels.map((k) => (
        <Text key={k.id} pointerEvents="none" style={[styles.kernel, { left: k.x, top: k.y }]}>
          {k.kind === 'clock' ? '⏰' : '🍿'}
        </Text>
      ))}
      {Date.now() - bonusAt < 1200 && bonusAt > 0 && <Text style={styles.bonus} pointerEvents="none">+5s</Text>}
      {!over && (
        <View pointerEvents="none" style={[styles.bucketBox, { left: bucketX }]}>
          <View style={styles.bucketRim} />
          <View style={styles.bucketBody}>
            {[0, 1, 2, 3, 4].map((i) => (
              <View key={i} style={[styles.stripe, i % 2 === 0 ? styles.stripeRed : styles.stripeWhite]} />
            ))}
          </View>
        </View>
      )}
      {over && (
        <View style={styles.overlay}>
          <Text style={styles.overTitle}>Time's up!</Text>
          <Text style={styles.overScore}>🍿 {score}{score >= best && score > 0 ? '  ·  New best!' : `  ·  Best ${best}`}</Text>
          <Pressable style={styles.again} onPress={restart}>
            <Text style={styles.againText}>PLAY AGAIN</Text>
          </Pressable>
        </View>
      )}
    </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  arena: {
    backgroundColor: '#17171A',
    borderRadius: radius.card,
    overflow: 'hidden',
    marginTop: 14,
  },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10 },
  score: { color: colors.yellow, fontWeight: '800', fontSize: 15 },
  timer: { color: colors.text, fontWeight: '800', fontSize: 14, fontVariant: ['tabular-nums'] },
  best: { color: colors.dim, fontWeight: '700', fontSize: 13 },
  kernel: { position: 'absolute', fontSize: KERNEL - 4 },
  bucketBox: { position: 'absolute', bottom: 6, width: BUCKET_W, alignItems: 'center' },
  // Only the top corners round, and there's no gap beneath: a fully rounded
  // rim sitting a pixel above the body let the background show through and
  // read as a separate floating bar rather than the lip of the tub.
  bucketRim: {
    width: BUCKET_W,
    height: 7,
    backgroundColor: '#E23636',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
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
  bonus: { position: 'absolute', top: 34, alignSelf: 'center', color: colors.green, fontWeight: '900', fontSize: 15 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,.45)' },
  overTitle: { color: colors.text, fontWeight: '900', fontSize: 18 },
  overScore: { color: colors.yellow, fontWeight: '800', fontSize: 15 },
  again: { backgroundColor: colors.yellow, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 10, marginTop: 6 },
  againText: { color: '#1B1400', fontWeight: '900', fontSize: 13, letterSpacing: 0.5 },
});
