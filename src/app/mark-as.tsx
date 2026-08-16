import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  addMovieRewatch,
  markRewatched,
  setEpisodeWatchDate,
  setMovieWatchDate,
  setMovieWatched,
  unmarkWatched,
} from '@/db';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { recentDayOptions } from '@/pure';
import { colors, space } from '@/theme';

/**
 * 'Mark as…' sheet for an already-watched episode or film: un-watch, +1 rewatch,
 * or CORRECT THE DAY.
 *
 * The last one closes a hole in the app's central promise. `markWatched` writes
 * 'now', always, and nothing could change it afterwards — so somebody who
 * watched three episodes on Friday and opened the app on Sunday had Sunday
 * written into an archive whose whole selling point is that the dates are true.
 * The import rescues nine years of accurate dates and then the app starts
 * adding inaccurate ones.
 *
 * SEVEN DAYS, AND NO CALENDAR. A native date picker is a new dependency and a
 * rebuild, and it answers a question nobody asked: the real case is "I forgot
 * for a day or two", which is one tap here and four screens in a calendar.
 * Seven is also roughly how far back a person can still be right — past a week
 * it is a guess, and a guessed date is worse than a late one in an app that
 * sells accuracy.
 */
export default function MarkAsSheet() {
  const { show, s, e, movie } = useLocalSearchParams<{
    show?: string;
    s?: string;
    e?: string;
    movie?: string;
  }>();
  const showId = Number(show);
  const season = Number(s);
  const episode = Number(e);
  const [picking, setPicking] = useState(false);

  const unwatch = () =>
    movie
      ? setMovieWatched(movie, false)
      : unmarkWatched(showId, season, episode);
  const rewatch = () =>
    movie ? addMovieRewatch(movie) : markRewatched(showId, season, episode);
  const setDay = (day: string) =>
    movie
      ? setMovieWatchDate(movie, day)
      : setEpisodeWatchDate(showId, season, episode, day);

  const act = (fn: () => void) => {
    tapLight();
    fn();
    router.back();
  };

  // Built from the device's own clock, so the days offered are the user's days
  // rather than UTC's — see `recentDayOptions`.
  const days = recentDayOptions(new Date());
  const label = (offset: number, day: string) => {
    if (offset === 0) return t('markAs.today');
    if (offset === 1) return t('markAs.yesterday');
    // Weekday plus the date: 'Friday' alone is ambiguous the moment a week has
    // passed, and the number is what somebody checks their memory against.
    const d = new Date(`${day}T12:00:00`);
    return `${d.toLocaleDateString(undefined, { weekday: 'long' })} ${d.getDate()}`;
  };

  return (
    <Pressable style={styles.backdrop} onPress={() => router.back()}>
      <Pressable style={styles.sheet} onPress={() => {}}>
        <Text style={styles.title}>{t('markAs.title')}</Text>

        {picking ? (
          <ScrollView style={styles.days} keyboardShouldPersistTaps="handled">
            {days.map(({ day, offset }) => (
              <Pressable
                key={day}
                style={styles.row}
                onPress={() => act(() => setDay(day))}
              >
                <Ionicons
                  name="calendar-outline"
                  size={22}
                  color={colors.text}
                />
                <Text style={styles.label}>{label(offset, day)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <>
            <Pressable style={styles.row} onPress={() => act(unwatch)}>
              <Ionicons name="eye-off-outline" size={22} color={colors.text} />
              <Text style={styles.label}>{t('media.notWatched')}</Text>
            </Pressable>

            <Pressable style={styles.row} onPress={() => act(rewatch)}>
              <View style={styles.plusOne}>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 11,
                    fontWeight: '800',
                  }}
                >
                  +1
                </Text>
              </View>
              <Text style={styles.label}>{t('markAs.rewatched')}</Text>
            </Pressable>

            {/* Opens in place rather than pushing a screen: correcting a date is
                a second thought about the thing already being looked at, and a
                new screen would lose that. */}
            <Pressable
              style={[styles.row, { borderBottomWidth: 0 }]}
              onPress={() => {
                tapLight();
                setPicking(true);
              }}
            >
              <Ionicons name="calendar-outline" size={22} color={colors.text} />
              <Text style={styles.label}>{t('markAs.changeDate')}</Text>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.faint}
                style={{ marginLeft: 'auto' }}
              />
            </Pressable>
          </>
        )}
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#232326',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 14,
    paddingBottom: 30,
  },
  // Capped so seven rows cannot push the sheet past the top of a small phone.
  days: { maxHeight: 360 },
  title: {
    color: colors.dim,
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: space.xl,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: space.xl,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333338',
  },
  plusOne: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { color: colors.text, fontSize: 17, fontWeight: '600' },
});
