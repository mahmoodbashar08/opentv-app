/**
 * The profile block: this month's puzzles as a calendar of squares.
 *
 * LIKE THE WATCH HEATMAP, COLOURED BY TRIES. A first-try win is the full
 * green, a sixth-try one is pale, a loss is grey, a day not played is the
 * empty cell, and today is ringed exactly as the heatmap rings it. One number
 * per day is the whole input (`winLevel`), so the block on a visitor's phone
 * is drawn from the same value the owner's phone published — counts and
 * colours, never a title.
 *
 * SIZED BY MEASURING, not by the grid's arithmetic: the block may be 1x1,
 * 2x1 or 2x2, and a month is five or six rows of seven either way, so the
 * cells are whatever fits the box it was given.
 */
import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { todayISO } from '@/components/heatmap';
import { t } from '@/i18n';
import { MAX_TRIES, type PublicPuzzle } from '@/puzzle';
import { calendarMonth, mixHex } from '@/pure';
import { colors } from '@/theme';

const GAP = 3;

/** Level 0 (lost) is grey; 1–6 climb from a pale green to the full one. */
function cellColor(level: number | undefined): string {
  if (level == null) return colors.raise;
  if (level === 0) return colors.pillGrey;
  return mixHex(colors.raise, colors.green, 0.3 + (0.7 * level) / MAX_TRIES);
}

export function PuzzleBlock({ value }: { value: PublicPuzzle }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const today = todayISO();
  const weeks = calendarMonth(today.slice(0, 7));
  const levels = new Map(value.days);
  const played = value.days.length;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== box.w || height !== box.h) setBox({ w: width, h: height });
  };
  const rows = Math.max(weeks.length, 1);
  const cell = Math.max(4, Math.floor(Math.min((box.w - 6 * GAP) / 7, (box.h - (rows - 1) * GAP) / rows)));

  return (
    <View style={{ flex: 1, gap: 6 }}>
      <View style={{ flex: 1 }} onLayout={onLayout} accessible accessibilityLabel={t('puzzle.blockPlayed', { count: played })}>
        {box.w > 0 && (
          <View style={{ gap: GAP }}>
            {weeks.map((week, wi) => (
              <View key={wi} style={{ flexDirection: 'row', gap: GAP }}>
                {week.map((day, di) =>
                  day == null || day > today ? (
                    // Outside the month, or still to come: nothing, so the
                    // grid starts on a 1st and stops at today.
                    <View key={di} style={{ width: cell, height: cell }} />
                  ) : (
                    <View
                      key={day}
                      style={[
                        { width: cell, height: cell, borderRadius: 2, backgroundColor: cellColor(levels.get(day)) },
                        day === today && { borderWidth: 1.5, borderColor: colors.text },
                      ]}
                    />
                  ),
                )}
              </View>
            ))}
          </View>
        )}
      </View>
      <Text style={s.foot} numberOfLines={1}>
        {value.n > 0 ? `🔥 ${t('puzzle.streakDays', { count: value.n })} · ` : ''}
        {t('puzzle.blockPlayed', { count: played })}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  foot: { color: colors.dim, fontSize: 11.5, fontWeight: '700' },
});
