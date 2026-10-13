import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { t } from '@/i18n';
import { posterLabel } from '@/pure';
import { colors, radius } from '@/theme';

export type ShowStatus = 'watching' | 'upToDate' | 'finished' | 'stopped' | 'none';

/**
 * The one line a poster CARD reads as under a screen reader: the title, then
 * what matters — "Silo, 45% watched". Goes on the Pressable around the tile,
 * never on the tile: see the note on `Poster`.
 */
export function posterSpeech(name: string, s: { progress?: number; status?: ShowStatus } = {}): string {
  const { key, vars } = posterLabel(name, s);
  return t(key, vars);
}

/** Stable pastel-on-dark tile color derived from the show name. */
function tileColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 32%, 22%)`;
}

function initials(name: string): string {
  return name
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/** Progress fill that sweeps from 0 to its value when the tile mounts. */
function AnimatedFill({ progress, color, delay }: { progress: number; color: string; delay: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: progress,
      duration: 800,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, delay, anim]);
  return (
    <Animated.View
      style={{
        width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        height: '100%',
        backgroundColor: color,
      }}
    />
  );
}

/**
 * Poster tile — real artwork when `uri` is provided (disk-cached), colored
 * initials placeholder otherwise. Bottom edge shows either a solid status
 * line or a (optionally animated) partial progress bar in the status color.
 */
export function Poster({
  name,
  status = 'none',
  aspect,
  uri,
  progress,
  progressColor,
  animateProgress,
  animationDelay = 350,
}: {
  name: string;
  status?: ShowStatus;
  aspect?: number;
  uri?: string | null;
  /** 0..1 — renders a partial progress bar instead of the solid status line */
  progress?: number;
  /** bar color — yellow watching, green up to date, purple finished */
  progressColor?: string;
  /** sweep the bar from 0 on mount */
  animateProgress?: boolean;
  animationDelay?: number;
}) {
  const fill = Math.min(Math.max(progress ?? 0, progress ? 0.02 : 0), 1);
  // A bar, not a button — see `progressColorOf`. Ink on paper is a black stripe.
  const color = progressColor ?? colors.brand;

  return (
    // DECORATIVE, DELIBERATELY. The tile used to carry its own label, and that
    // was the wrong element: every poster sits inside a Pressable, and on
    // Android a focusable tile inside a focusable card is TWO stops — an empty
    // "button", then the title — for every show in the grid. The CARD is the
    // element now (`posterSpeech`), and the artwork says nothing on its own, so
    // the initials placeholder cannot be read out as "BB" inside a collage.
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.tile, { backgroundColor: tileColor(name) }, aspect != null && { aspectRatio: aspect }]}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} cachePolicy="disk" />
      ) : (
        <Text style={styles.initials}>{initials(name)}</Text>
      )}
      {progress != null ? (
        <View style={[styles.statusLine, { backgroundColor: color + '40' }]}>
          {animateProgress ? (
            <AnimatedFill progress={fill} color={color} delay={animationDelay} />
          ) : (
            <View style={{ width: `${Math.round(fill * 100)}%`, height: '100%', backgroundColor: color }} />
          )}
        </View>
      ) : (
        status !== 'none' && <View style={[styles.statusLine, { backgroundColor: colors.status[status] }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    aspectRatio: 2 / 3,
    borderRadius: radius.poster,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flex: 1,
  },
  initials: {
    color: colors.faint,
    fontSize: 20,
    fontWeight: '800',
  },
  statusLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 5,
  },
});
