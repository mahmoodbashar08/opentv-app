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
import { busyDayCount, heatLevel, mixHex, monthColumns, monthsGrid, shiftMonth } from '@/pure';
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

/** Six whole months — the widest window that fits a phone at a cell size
 *  anybody can see, and the default when nobody says otherwise. */
export const MONTHS = 6;
const GAP = 2.5;

export function Heatmap({
  counts,
  accent,
  endMonth,
  onEndMonth,
  today,
  maxMonth,
  months = MONTHS,
  width: boxWidth,
  colorOf,
  onPressDay,
}: {
  counts: ReadonlyMap<string, number>;
  /** The profile's theme, or the app accent when it has none. */
  accent: string;
  /** The last MONTH the grid covers, 'YYYY-MM'. Whole months, always. */
  endMonth: string;
  onEndMonth: (next: string) => void;
  /** Today, 'YYYY-MM-DD', ringed in the grid so the reader knows where they are. */
  today: string;
  /** The current month — there is nothing to see in the future. */
  maxMonth: string;
  /**
   * HOW MANY MONTHS THE GRID COVERS, and therefore how big the squares are.
   *
   * It is the widget's size, spent: the same grid at 1x1 has room for one
   * month, at 2x1 for three, at 2x2 for six. A fixed six months in a small
   * widget would mean cells too small to read, and one month in a large one
   * would be a lot of space saying very little.
   */
  months?: number;
  /**
   * The room the grid has.
   *
   * IT USED TO ASK THE WINDOW, which is right on the profile — where it spans
   * the page — and wrong everywhere else. In the Add sheet it is inside a card
   * a fraction of that width, so it sized its cells for a screen it did not
   * have and spilled straight out of the preview. Whoever draws it knows how
   * much room it is being given; the window does not.
   */
  width?: number;
  /**
   * COLOUR PER DAY, overriding the accent shading.
   *
   * The emotion calendar is the same grid asking a different question: not how
   * MUCH was watched on a day, but how it FELT. Everything else — whole months,
   * the arrows, the RTL mirroring, the cell arithmetic that lands on 26 or 27
   * columns — is identical, and a second calendar would be a second place for
   * all of that to be wrong.
   *
   * Returning null falls back to the shading, so a day with no feeling recorded
   * still shows that something was watched.
   */
  colorOf?: (day: string, count: number) => string | null;
  /** A day the reader tapped. Absent leaves the grid inert, as on a profile. */
  onPressDay?: (day: string) => void;
}) {
  const window = useWindowDimensions().width;
  const width = boxWidth ?? window;
  const grid = monthsGrid(endMonth, months, counts);
  const busy = busyDayCount(counts);
  const cols = Math.max(grid.length, 1);
  // Sized from the ACTUAL column count: whole months land on 26 or 27 columns
  // depending where the weeks fall, and a fixed size would overflow on 27.
  const cell = (Math.min(width, 520) - 2 * space.lg - (cols - 1) * GAP) / cols;
  const labels = monthColumns(grid);

  // Four shades between the empty cell and the accent. Blending toward black
  // keeps the palest shade legible whatever colour the theme is.
  const shade = (level: number) =>
    level === 0 ? colors.raise : mixHex('#000000', accent, 0.25 + 0.25 * level);

  const monthName = (m: string, withYear = false) =>
    new Date(`${m}-01T00:00:00`).toLocaleDateString(currentLocale(), {
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    });

  const startMonth = shiftMonth(endMonth, -(months - 1));
  const range = `${monthName(startMonth, startMonth.slice(0, 4) !== endMonth.slice(0, 4))} – ${monthName(endMonth, true)}`;

  const total = grid.flat().reduce((sum, c) => sum + (c?.count ?? 0), 0);
  const atPresent = endMonth >= maxMonth;

  const go = (delta: number) => {
    const next = shiftMonth(endMonth, delta * months);
    if (next > maxMonth) return;
    tapLight();
    onEndMonth(next);
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
        <Text style={s.month}>{range}</Text>
        <Pressable onPress={() => go(1)} hitSlop={10} disabled={atPresent}>
          <Ionicons
            name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'}
            size={20}
            // Greyed at the present, because there is nothing after it.
            color={atPresent ? colors.line : colors.dim}
          />
        </Pressable>
      </View>

      <View style={s.grid}>
        {/* Month names, over the column each month starts in. */}
        <View style={{ height: 13 }}>
          {labels.map((l) => (
            <Text
              key={l.month}
              style={[s.monthTick, { left: l.index * (cell + GAP) }]}
              numberOfLines={1}>
              {monthName(l.month)}
            </Text>
          ))}
        </View>
        <View style={s.cols}>
          {grid.map((week, wi) => (
            <View key={wi} style={{ gap: GAP }}>
              {week.map((c, di) =>
                c === null ? (
                  // A day outside these months. Drawn as nothing, so the grid
                  // starts on a 1st and ends on a 31st.
                  <View key={di} style={{ width: cell, height: cell }} />
                ) : (
                  <Pressable
                    key={c.date}
                    onPress={onPressDay ? () => onPressDay(c.date) : undefined}
                    disabled={onPressDay == null || c.count === 0}
                    style={[
                      {
                        width: cell,
                        height: cell,
                        borderRadius: 2,
                        backgroundColor:
                          colorOf?.(c.date, c.count) ?? shade(heatLevel(c.count, busy)),
                      },
                      // TODAY IS RINGED, not shaded differently: a heavier
                      // colour would read as "watched a lot", which is a
                      // different fact from "you are here".
                      c.date === today && { borderWidth: 1.5, borderColor: colors.text },
                    ]}
                  />
                ),
              )}
            </View>
          ))}
        </View>
      </View>

      <Text style={s.legend}>
        {/* "in this period", not "in these six months": the window is one, three
            or six months now, and a caption that names the wrong one is worse
            than one that names none. */}
        {total > 0 ? t('plus.activity.rangeSummary', { count: total }) : t('plus.activity.monthEmpty')}
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
  grid: { paddingHorizontal: space.lg, gap: 4 },
  cols: { flexDirection: 'row', gap: GAP },
  monthTick: { position: 'absolute', color: colors.faint, fontSize: 10, fontWeight: '700' },
  legend: { color: colors.faint, fontSize: 12, paddingHorizontal: space.lg },
});
