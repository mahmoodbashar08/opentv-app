import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { posterLabel } from '@/pure';
import { colors, radius } from '@/theme';

export type ShowStatus = 'watching' | 'upToDate' | 'finished' | 'stopped' | 'none';

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
  const color = progressColor ?? colors.yellow;

  return (
    // A poster is artwork with no text, so without an explicit label the tile
    // aggregates to an empty one and a screen reader sees an unlabelled
    // element — the whole library grid was unnavigable by VoiceOver.
    <View
      accessible
      accessibilityLabel={posterLabel(name, { progress, status })}
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
    color: 'rgba(255,255,255,0.55)',
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
