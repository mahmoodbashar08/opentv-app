/**
 * THE SEASON ON THE LOADING SCREEN (8 Oct).
 *
 * The launch screen is drawn by the system before any of our code runs, so it
 * cannot know there is an event on. This takes over on the first frame, laid
 * exactly over it — the same plain logo, the same place — and turns it into
 * the season's: the pumpkin or the snowman becomes the O, a few bats or
 * snowflakes cross, and the whole thing fades. About a second, once per launch,
 * only while the dashboard has an event on, and it never takes a tap.
 */
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, useColorScheme, useWindowDimensions, View } from 'react-native';

import { SeasonEffect } from '@/components/season-effect';
import { activeEvent, seasonalOn, type SeasonId } from '@/season';

// The native splash: a 76pt image whose logo sits dead centre (app.json).
const PLAIN_W = 76;
// The seasonal logos are 720px squares in which the OT is 601px wide and its
// centre 31.5px below the square's — scaled so the letters land on the plain ones.
const OT_PT = 47.7;
const BOX = (720 / 601) * OT_PT;
const DROP = (31.5 / 601) * OT_PT;

const LOGOS: Partial<Record<SeasonId, number>> = {
  halloween: require('@/assets/images/splash-halloween.png'),
  christmas: require('@/assets/images/splash-christmas.png'),
};

// Decided once, at launch: a season switched on mid-session waits for the next one.
let decided: { effect: string; logo?: number } | null | undefined;
function decide() {
  if (decided !== undefined) return decided;
  try {
    const e = seasonalOn() ? activeEvent() : null;
    decided = e ? { effect: e.presets[0]!.effect, logo: LOGOS[e.id] } : null;
  } catch {
    decided = null;
  }
  return decided;
}

export function SeasonSplash() {
  const dark = useColorScheme() === 'dark';
  const { width, height } = useWindowDimensions();
  const [season] = useState(decide);
  const [done, setDone] = useState(false);
  const swap = useMemo(() => new Animated.Value(0), []);
  const fade = useMemo(() => new Animated.Value(1), []);

  // THE SWAP WAITS FOR THE PICTURE. Faded in before it has decoded, the season's
  // logo is a blank where the plain one was; a second without it and the
  // whole thing steps aside rather than hold the launch.
  const [ready, setReady] = useState(season?.logo == null);
  useEffect(() => {
    if (!season) return;
    if (!ready) {
      const give = setTimeout(() => setDone(true), 1000);
      return () => clearTimeout(give);
    }
    Animated.sequence([
      Animated.delay(120),
      Animated.timing(swap, { toValue: 1, duration: 380, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }),
      Animated.delay(700),
      Animated.timing(fade, { toValue: 0, duration: 320, useNativeDriver: true }),
    ]).start(() => setDone(true));
  }, [season, ready, swap, fade]);

  // Light mode's splash is white, and the logos are drawn for the dark one.
  if (!season || done || !dark) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.ground, { opacity: fade }]}>
      <SeasonEffect emoji={season.effect} width={width} height={height} playing repeatMs={0} count={7} />
      {season.logo != null ? (
        <View style={s.centre}>
          <Animated.View style={{ position: 'absolute', opacity: swap.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
            <Image source={require('@/assets/images/splash-icon.png')} style={{ width: PLAIN_W, height: PLAIN_W }} />
          </Animated.View>
          <Animated.View style={{ marginTop: -DROP * 2, opacity: swap, transform: [{ scale: swap.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }}>
            <Image source={season.logo} style={{ width: BOX, height: BOX }} onLoad={() => setReady(true)} />
          </Animated.View>
        </View>
      ) : (
        <View style={s.centre}>
          <Image source={require('@/assets/images/splash-icon.png')} style={{ width: PLAIN_W, height: PLAIN_W }} />
        </View>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  ground: { backgroundColor: '#131313', zIndex: 1000 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
