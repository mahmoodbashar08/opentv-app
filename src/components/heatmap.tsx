/**
 * A month of watching, as a calendar — one cell per day, shaded by how much
 * was watched, with arrows to move through the years.
 *
 * A MONTH, NOT A YEAR, and it fits the screen. A year of squares does not fit
 * a phone, so it has to scroll sideways, and a thing that scrolls sideways
 * inside a page that scrolls down is a fight the reader always loses. A month
 * is exactly seven columns wide, which is a width every phone has.
 *
 * ON YOUR OWN PROFILE ONLY, and that is a rule rather than a decision about
 * screen space. A per-day grid of what somebody watched IS their watch
 * history: the one thing this app promises never leaves the phone, and the one
 * thing the server has no table for.
 *
 * Drawn with plain Views because that is all it needs — a few dozen small
 * squares cost less than the chart library that would draw them, and they take
 * the profile theme for free.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { I18nManager, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { tapLight } from '@/haptics';
import { currentLocale, t } from '@/i18n';
import { busyDayCount, heatLevel, mixHex, monthGrid, shiftMonth } from '@/pure';
import { colors, space } from '@/theme';

/** Today as 'YYYY-MM-DD' in LOCAL time — watch dates are local days, and a
 *  UTC day would put an evening's watching on tomorrow's square east of GMT. */
export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 'YYYY-MM' for a day. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

const GAP = 5;

export function Heatmap({
  counts,
  accent,
  month,
  onMonth,
  maxMonth,
}: {
  counts: ReadonlyMap<string, number>;
  /** The profile's theme, or the app accent when it has none. */
  accent: string;
  /** 'YYYY-MM' currently shown. */
  month: string;
  onMonth: (next: string) => void;
  /** The current month — there is nothing to see in the future. */
  maxMonth: string;
}) {
  const { width } = useWindowDimensions();
  const grid = monthGrid(month, counts);
  const busy = busyDayCount(counts);
  const cell = Math.floor((Math.min(width, 520) - 2 * space.lg - 6 * GAP) / 7);

  // Four shades between the empty cell and the accent. Blending toward black
  // keeps the palest shade legible whatever colour the theme is.
  const shade = (level: number) =>
    level === 0 ? colors.raise : mixHex('#000000', accent, 0.25 + 0.25 * level);

  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString(currentLocale(), {
    month: 'long',
    year: 'numeric',
  });

  // Weekday initials in the reader's own language, Sunday first to match the
  // grid. Built from real dates rather than a hardcoded list, so Arabic and
  // French get their own letters with no table to maintain.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(2026, 1, 1 + i)).toLocaleDateString(currentLocale(), { weekday: 'narrow' }),
  );

  const monthTotal = grid
    .flat()
    .reduce((sum, c) => sum + (c?.count ?? 0), 0);

  const go = (delta: number) => {
    const next = shiftMonth(month, delta);
    if (next > maxMonth) return;
    tapLight();
    onMonth(next);
  };

  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Pressable onPress={() => go(-1)} hitSlop={10}>
          <Ionicons
            name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'}
            size={20}
            color={colors.dim}
          />
        </Pressable>
        <Text style={s.month}>{label}</Text>
        <Pressable onPress={() => go(1)} hitSlop={10} disabled={month >= maxMonth}>
          <Ionicons
            name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'}
            size={20}
            // Greyed at the present, because there is nothing after it.
            color={month >= maxMonth ? colors.line : colors.dim}
          />
        </Pressable>
      </View>

      <View style={s.grid}>
        <View style={s.row}>
          {weekdays.map((d, i) => (
            <Text key={i} style={[s.weekday, { width: cell }]}>
              {d}
            </Text>
          ))}
        </View>
        {grid.map((week, wi) => (
          <View key={wi} style={s.row}>
            {week.map((c, ci) =>
              c === null ? (
                <View key={ci} style={{ width: cell, height: cell }} />
              ) : (
                <View
                  key={c.date}
                  style={{
                    width: cell,
                    height: cell,
                    borderRadius: 4,
                    backgroundColor: shade(heatLevel(c.count, busy)),
                  }}
                />
              ),
            )}
          </View>
        ))}
      </View>

      <Text style={s.legend}>
        {monthTotal > 0
          ? t('plus.activity.monthSummary', { count: monthTotal })
          : t('plus.activity.monthEmpty')}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingBottom: 8, gap: 10 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  month: { color: colors.text, fontSize: 14.5, fontWeight: '700' },
  grid: { paddingHorizontal: space.lg, gap: GAP },
  row: { flexDirection: 'row', gap: GAP, justifyContent: 'space-between' },
  weekday: { color: colors.faint, fontSize: 10.5, textAlign: 'center', fontWeight: '700' },
  legend: { color: colors.faint, fontSize: 12, paddingHorizontal: space.lg },
});
