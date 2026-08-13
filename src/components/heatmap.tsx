/**
 * A year of watching, as a grid — one column per week, one cell per day,
 * shaded by how much was watched.
 *
 * ON YOUR OWN PROFILE ONLY, and that is a rule rather than a decision about
 * screen space. A per-day grid of what somebody watched IS their watch
 * history: the one thing this app promises never leaves the phone, and the one
 * thing the server has no table for. There is no version of this that a
 * visitor sees.
 *
 * Drawn with plain Views because that is all it needs — 371 small squares cost
 * less than the chart library that would draw them, and they take the profile
 * theme for free.
 */
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '@/i18n';
import { busyDayCount, heatGrid, heatLevel, mixHex } from '@/pure';
import { colors, radius, space } from '@/theme';

/** 53 columns is a year; the scroll shows the last ~20 and starts at today. */
const WEEKS = 53;
const CELL = 11;
const GAP = 3;

/** Today as 'YYYY-MM-DD' in LOCAL time — watch dates are local days, and a
 *  UTC day would put an evening's watching on tomorrow's square east of GMT. */
export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function Heatmap({
  counts,
  accent,
  today,
}: {
  counts: ReadonlyMap<string, number>;
  /** The profile's theme, or the app accent when it has none. */
  accent: string;
  /** 'YYYY-MM-DD'. Passed in rather than read here so the caller owns the clock. */
  today: string;
}) {
  const grid = heatGrid(today, WEEKS, counts);
  const busy = busyDayCount(counts);
  // Four shades between the empty cell and the accent. Blending toward the
  // page's own black keeps the palest shade legible on any theme colour.
  const shade = (level: number) =>
    level === 0 ? colors.raise : mixHex('#000000', accent, 0.25 + 0.25 * level);

  const total = [...counts.values()].reduce((a, n) => a + n, 0);
  const activeDays = [...counts.values()].filter((n) => n > 0).length;

  return (
    <View style={s.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Newest on the right, and opened there: the interesting end of a
        // history is the recent end.
        contentContainerStyle={{ paddingHorizontal: space.lg, flexDirection: 'row', gap: GAP }}
        ref={(sv) => sv?.scrollToEnd({ animated: false })}>
        {grid.map((week) => (
          <View key={week[0]!.date} style={{ gap: GAP }}>
            {week.map((cell) => (
              <View
                key={cell.date}
                style={{
                  width: CELL,
                  height: CELL,
                  borderRadius: 2.5,
                  backgroundColor: shade(heatLevel(cell.count, busy)),
                }}
              />
            ))}
          </View>
        ))}
      </ScrollView>
      <Text style={s.legend}>
        {t('plus.activity.summary', { count: total, days: activeDays })}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingVertical: 6, gap: 8 },
  legend: { color: colors.faint, fontSize: 12, paddingHorizontal: space.lg },
});

export const HEATMAP_RADIUS = radius.card;
