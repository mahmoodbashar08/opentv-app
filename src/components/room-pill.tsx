/**
 * "Live room · 12 watching" — the door to the episode's live room, under the
 * episode's title on its air night (DESIGN-community §3.2).
 *
 * IT EXISTS ONLY WHEN ALL OF THESE HOLD: the phone is joined, the episode has
 * an air date, the 48-hour window is open, this server runs rooms, and the
 * episode is marked watched HERE — the last one so nobody walks into
 * spoilers. `watched` is the page's own state, so the pill appears on the same
 * frame the check lands and goes the moment it is unmarked.
 *
 * The count is free (D14, the upsell); the tap is Plus. Yellow, because it acts.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { fetchRoomCount, roomKeyFor, roomOpenNow, roomsOffHere, type RoomCount } from '@/community-room';
import { useJoined } from '@/community-session';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { requirePlus } from '@/plus';
import { colors, radius, space } from '@/theme';

export function RoomPill({
  tvdbId,
  season,
  episode,
  watched,
  showName,
}: {
  tvdbId: number;
  season: number;
  episode: number;
  watched: boolean;
  showName: string;
}) {
  const joined = useJoined();
  const [room, setRoom] = useState<{ key: string; count: RoomCount } | null>(null);

  // EVERYTHING IS READ IN THE CALLBACK, never in render: the air date comes
  // from metadata that can land after the page draws, and the React Compiler
  // would memoise a render-time `roomKeyFor(…)` against its arguments and keep
  // the "no air date" answer for ever (CLAUDE.md). On focus, so coming back
  // from the room or the Mark as… sheet shows a fresh count; and again when
  // `watched` flips, which is what makes the pill appear with the check. The
  // 60 s cache keeps all of that to one request a minute.
  useFocusEffect(
    useCallback(() => {
      const key = joined && watched ? roomKeyFor(tvdbId, season, episode) : null;
      if (key == null || !roomOpenNow(key) || roomsOffHere()) {
        setRoom(null);
        return;
      }
      let alive = true;
      void fetchRoomCount(key).then((count) => {
        if (alive) setRoom(count ? { key, count } : null);
      });
      return () => {
        alive = false;
      };
    }, [joined, watched, tvdbId, season, episode]),
  );

  if (!watched || room == null || !room.count.open) return null;
  const { key, count } = room;

  const label = count.watching > 0 ? t('room.pill', { count: count.watching }) : t('room.pillFirst');
  return (
    <Pressable
      style={styles.pill}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        tapLight();
        if (!requirePlus('room')) return;
        router.push(`/room/${encodeURIComponent(key)}?name=${encodeURIComponent(showName)}` as never);
      }}>
      <Text style={styles.text} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    marginHorizontal: 14,
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.yellow,
  },
  text: { color: colors.onYellow, fontSize: 14, fontWeight: '800' },
});
