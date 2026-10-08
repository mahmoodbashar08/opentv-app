/**
 * A FEW SECONDS OF THE SEASON over a banner or a poster: bats that flutter
 * across on paths of their own, or snow that falls. Never over the content,
 * never taking a tap.
 *
 * RANDOM EVERY RUN (8 Oct): each bat picks its side, its height, how much it
 * climbs or drops, how fast it goes and how hard it flaps — a row of bats on
 * the same line read as a pattern, not a flock.
 *
 * React Native's own Animated on the native driver: a Reanimated version drew
 * nothing here (a shared value written from a JS timer never moved).
 */
import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

type Part = {
  a: number;
  b: number;
  size: number;
  dir: 1 | -1;
  y0: number;
  y1: number;
  bob: number;
  x: number;
  flap: number;
};

const FLYERS = ['🦇', '👻', '🦋'];
// Lanterns, balloons, hearts and fireworks go up instead of down.
const RISERS = ['🏮', '🎈', '💕', '💖', '🎆'];

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

function makeParts(n: number): Part[] {
  return Array.from({ length: n }, () => {
    const a = rnd(0, 0.45);
    return {
      a,
      b: Math.min(1, a + rnd(0.35, 0.6)),
      size: rnd(18, 38),
      dir: Math.random() < 0.5 ? 1 : -1,
      y0: rnd(0.05, 0.7),
      y1: rnd(0.05, 0.75),
      bob: rnd(8, 26) * (Math.random() < 0.5 ? 1 : -1),
      x: rnd(0, 1),
      flap: rnd(0.55, 0.8),
    };
  });
}

export function SeasonEffect({
  emoji,
  width,
  height,
  playing,
  repeatMs = 15000,
  count = 8,
}: {
  emoji: string;
  width: number;
  height: number;
  playing: boolean;
  /** 0 plays once. */
  repeatMs?: number;
  count?: number;
}) {
  const t = useMemo(() => new Animated.Value(0), []);
  const [parts, setParts] = useState<Part[]>(() => makeParts(count));

  useEffect(() => {
    if (!playing) return;
    const run = () => {
      setParts(makeParts(count));
      t.setValue(0);
      Animated.timing(t, { toValue: 1, duration: 5500, easing: Easing.linear, useNativeDriver: true }).start();
    };
    run();
    if (!repeatMs) return;
    const id = setInterval(run, repeatMs);
    return () => clearInterval(id);
  }, [playing, t, repeatMs, count]);

  // Bats, ghosts and butterflies cross the banner; the rest fall like snow, or rise.
  const fly = FLYERS.includes(emoji);
  const rise = RISERS.includes(emoji);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {parts.map((p, i) => {
        const mid = (p.a + p.b) / 2;
        const q1 = p.a + (p.b - p.a) / 4;
        const q3 = p.a + ((p.b - p.a) * 3) / 4;
        const opacity = t.interpolate({ inputRange: [0, p.a, p.a + 0.04, p.b - 0.04, p.b, 1], outputRange: [0, 0, 1, 1, 0, 0] });
        let transform;
        if (fly) {
          const from = p.dir > 0 ? -60 : width + 20;
          const to = p.dir > 0 ? width + 20 : -60;
          const ya = p.y0 * height;
          const yb = p.y1 * height;
          // Wing beats: a quick squeeze of the width, many times over the flight.
          const beats = 10;
          const flapIn: number[] = [];
          const flapOut: number[] = [];
          for (let k = 0; k <= beats; k++) {
            flapIn.push(p.a + ((p.b - p.a) * k) / beats);
            flapOut.push(k % 2 ? p.flap : 1);
          }
          transform = [
            { translateX: t.interpolate({ inputRange: [p.a, p.b], outputRange: [from, to], extrapolate: 'clamp' }) },
            {
              translateY: t.interpolate({
                inputRange: [p.a, q1, mid, q3, p.b],
                outputRange: [ya, ya + p.bob, (ya + yb) / 2, yb - p.bob, yb],
                extrapolate: 'clamp',
              }),
            },
            { scaleX: t.interpolate({ inputRange: flapIn, outputRange: flapOut.map((v) => v * -p.dir), extrapolate: 'clamp' }) },
          ];
        } else {
          const x0 = p.x * width;
          transform = [
            { translateX: t.interpolate({ inputRange: [p.a, mid, p.b], outputRange: [x0, x0 + p.bob * 1.5, x0], extrapolate: 'clamp' }) },
            { translateY: t.interpolate({ inputRange: [p.a, p.b], outputRange: rise ? [height + 10, -30] : [-30, height + 10], extrapolate: 'clamp' }) },
          ];
        }
        return (
          <Animated.Text key={i} style={{ position: 'absolute', fontSize: p.size, opacity, transform }}>
            {emoji}
          </Animated.Text>
        );
      })}
    </View>
  );
}

/**
 * A soft light behind the avatar in the ring's colour, breathing slowly — the
 * "glow" part of a seasonal look. Behind, not on: the avatar clips its own
 * edge, and a clipped view casts no shadow.
 */
export function GlowRing({ color, size, playing }: { color: string; size: number; playing: boolean }) {
  const a = useMemo(() => new Animated.Value(0.55), []);
  useEffect(() => {
    if (!playing) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(a, { toValue: 0.55, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [a, playing]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: a,
        shadowColor: color,
        shadowOpacity: 1,
        shadowRadius: size * 0.22,
        shadowOffset: { width: 0, height: 0 },
        transform: [{ scale: 1.08 }],
      }}
    />
  );
}
