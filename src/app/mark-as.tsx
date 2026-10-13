import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  addMovieRewatch,
  markRewatched,
  setEpisodeWatchDate,
  setMovieWatchDate,
  setMovieWatched,
  unmarkWatched,
} from '@/db';
import { tapLight } from '@/haptics';
import { a11yHidden } from '@/a11y';
import { currentLocale, t } from '@/i18n';
import { calendarMonth, recentDayOptions, shiftMonth } from '@/pure';
import { colors, space } from '@/theme';

/** Today, as the local `YYYY-MM-DD` the calendar and the database both speak. */
function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * "Mark as…" for an already-watched episode or film: un-watch, +1 rewatch, or
 * CORRECT THE DAY.
 *
 * The last one closes a hole in the app's central promise. `markWatched` writes
 * "now", always, and until this existed nothing could change it afterwards.
 *
 * A FULL CALENDAR, NOT A LIST OF RECENT DAYS. The first version offered the
 * last seven days, built for "I forgot to log it yesterday" — which turned out
 * to be the smaller half of the problem. The real case, in the owner's words:
 * somebody stops opening the app for three weeks, comes back and marks twenty
 * episodes, and all twenty then say TODAY. That does not merely fail to help,
 * it damages the archive this app exists to protect — and no relative list
 * reaches three weeks back without becoming thirty rows nobody can read.
 *
 * Still no native date picker: a month grid is about eighty lines of JSX
 * against a package, a rebuild, and two platforms' worth of behaviour. Today
 * and Yesterday stay as one-tap shortcuts, because they really are the common
 * case even though they are not the whole of it.
 */
export default function MarkAsSheet() {
  const { show, s, e, movie } = useLocalSearchParams<{ show?: string; s?: string; e?: string; movie?: string }>();
  const showId = Number(show);
  const season = Number(s);
  const episode = Number(e);

  const today = localDay(new Date());
  /**
   * ONE DOOR, NOT THREE.
   *
   * Today and Yesterday were rows on the main sheet at first, beside "Watched
   * on…", which made three ways to answer one question and a main sheet that
   * was mostly dates. They belong INSIDE the date screen, at the top, where
   * somebody is already looking for a day — and the calendar sits at the foot
   * of that same list as the escape hatch for anything older.
   */
  const [step, setStep] = useState<'main' | 'days' | 'calendar'>('main');
  const [month, setMonth] = useState(() => today.slice(0, 7));

  const unwatch = () => (movie ? setMovieWatched(movie, false) : unmarkWatched(showId, season, episode));
  const rewatch = () => (movie ? addMovieRewatch(movie) : markRewatched(showId, season, episode));
  const setDay = (day: string) =>
    movie ? setMovieWatchDate(movie, day) : setEpisodeWatchDate(showId, season, episode, day);

  const act = (fn: () => void) => {
    tapLight();
    fn();
    router.back();
  };

  const weeks = calendarMonth(month);
  const atCurrentMonth = month >= today.slice(0, 7);
  // THE APP'S LANGUAGE, NOT THE PHONE'S: `undefined` here is the device
  // locale, so an Arabic phone set to English read the month, the weekdays and
  // every day button in Arabic. `currentLocale()`, as the show screen does.
  const locale = currentLocale();
  const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });
  // Weekday initials from the app's own locale, so this reads correctly in
  // Arabic and French rather than being hard-coded English. 1 Feb 2026 is a
  // Sunday, which is where `calendarMonth` starts its weeks.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2026, 1, 1 + i).toLocaleDateString(locale, { weekday: 'narrow' }),
  );

  return (
    // Neither the backdrop nor the sheet is an element: a labelled backdrop
    // still WRAPS the sheet, and an accessible Pressable is a leaf to
    // VoiceOver, so every row inside read as one "Close" button. The sheet
    // confines the reader; the escape gesture (two-finger Z) closes it.
    <Pressable style={styles.backdrop} onPress={() => router.back()} accessible={false}>
      <Pressable style={styles.sheet} onPress={() => {}} accessible={false} accessibilityViewIsModal onAccessibilityEscape={() => router.back()}>
        <Text style={styles.title} accessibilityRole="header">
          {t('markAs.title')}
        </Text>

        {step === 'calendar' ? (
          <View style={styles.cal}>
            <View style={styles.monthRow}>
              <Pressable hitSlop={12} onPress={() => setMonth(shiftMonth(month, -1))} accessibilityRole="button" accessibilityLabel={t('a11y.previousMonth')}>
                <Ionicons name="chevron-back" size={22} color={colors.text} />
              </Pressable>
              <Text style={styles.monthLabel} accessibilityRole="header">
                {monthLabel}
              </Text>
              {/* Forward stops at the month you are standing in: nobody watched
                  anything next month, and an unreachable page is clearer than a
                  page of dead days. */}
              <Pressable hitSlop={12} disabled={atCurrentMonth} onPress={() => setMonth(shiftMonth(month, 1))} accessibilityRole="button" accessibilityLabel={t('a11y.nextMonth')}>
                <Ionicons name="chevron-forward" size={22} color={atCurrentMonth ? colors.line : colors.text} />
              </Pressable>
            </View>

            {/* Letters for the eye. Read aloud they were "S, M, T, W, T, F,
                S", one stop each — and every day button already says its
                weekday in full. */}
            <View style={styles.week} {...a11yHidden()}>
              {weekdays.map((d, i) => (
                <Text key={i} style={styles.weekday}>
                  {d}
                </Text>
              ))}
            </View>

            {weeks.map((w, i) => (
              <View key={i} style={styles.week}>
                {w.map((day, j) => {
                  const future = day != null && day > today;
                  return (
                    <Pressable
                      key={j}
                      style={styles.day}
                      disabled={day == null || future}
                      // An empty cell is padding, not a dimmed button; a day says its whole date.
                      accessible={day != null}
                      importantForAccessibility={day != null ? 'yes' : 'no-hide-descendants'}
                      accessibilityRole="button"
                      accessibilityLabel={day ? new Date(`${day}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }) : undefined}
                      onPress={() => day && act(() => setDay(day))}>
                      {day && (
                        <View style={[styles.dayInner, day === today && styles.dayToday]}>
                          <Text
                            style={[styles.dayText, future && styles.dayFuture, day === today && styles.dayTodayText]}>
                            {Number(day.slice(-2))}
                          </Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        ) : step === 'days' ? (
          <>
            {recentDayOptions(new Date()).map(({ day, offset }) => (
              <Pressable key={day} style={styles.row} onPress={() => act(() => setDay(day))} accessibilityRole="button">
                <Ionicons name="calendar-outline" size={22} color={colors.text} />
                <Text style={styles.label}>
                  {offset === 0
                    ? t('markAs.today')
                    : offset === 1
                      ? t('markAs.yesterday')
                      : // Weekday AND date: "Friday" alone is ambiguous the
                        // moment a week has passed, and the number is what
                        // somebody checks their memory against.
                        `${new Date(`${day}T12:00:00`).toLocaleDateString(locale, { weekday: 'long' })} ${Number(day.slice(-2))}`}
                </Text>
              </Pressable>
            ))}
            {/* Anything older than a week. The calendar is the escape hatch,
                not the default, because most corrections are recent. */}
            <Pressable
              style={[styles.row, { borderBottomWidth: 0 }]}
              accessibilityRole="button"
              onPress={() => {
                tapLight();
                setStep('calendar');
              }}>
              <Ionicons name="calendar-number-outline" size={22} color={colors.text} />
              <Text style={styles.label}>{t('markAs.pickDate')}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.faint} style={{ marginLeft: 'auto' }} />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable style={styles.row} onPress={() => act(unwatch)} accessibilityRole="button">
              <Ionicons name="eye-off-outline" size={22} color={colors.text} />
              <Text style={styles.label}>{t('media.notWatched')}</Text>
            </Pressable>

            <Pressable style={styles.row} onPress={() => act(rewatch)} accessibilityRole="button" accessibilityLabel={t('markAs.rewatched')}>
              <View style={styles.plusOne}>
                <Text style={{ color: colors.text, fontSize: 11, fontWeight: '800' }}>+1</Text>
              </View>
              <Text style={styles.label}>{t('markAs.rewatched')}</Text>
            </Pressable>

            <Pressable
              style={[styles.row, { borderBottomWidth: 0 }]}
              accessibilityRole="button"
              onPress={() => {
                tapLight();
                setStep('days');
              }}>
              <Ionicons name="calendar-outline" size={22} color={colors.text} />
              <Text style={styles.label}>{t('markAs.changeDate')}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.faint} style={{ marginLeft: 'auto' }} />
            </Pressable>
          </>
        )}
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 14,
    paddingBottom: 30,
  },
  title: { color: colors.dim, fontSize: 14, fontWeight: '600', paddingHorizontal: space.xl, paddingBottom: 6 },
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

  cal: { paddingHorizontal: space.lg, paddingTop: 4 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  monthLabel: { color: colors.text, fontSize: 17, fontWeight: '700' },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', color: colors.faint, fontSize: 11, fontWeight: '700', paddingBottom: 6 },
  day: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  dayInner: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dayToday: { backgroundColor: colors.yellow },
  dayText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  dayTodayText: { color: colors.onYellow, fontWeight: '800' },
  dayFuture: { color: colors.line },
});
