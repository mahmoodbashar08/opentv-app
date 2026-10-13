/**
 * The puzzle archive — every past day, newest first, with how it went.
 *
 * THE NEW YORK TIMES' SHAPE (14 Oct): today's puzzle is free and always will
 * be; playing a day you missed is Plus. Everybody sees the whole list and
 * their own squares on it — the list is what makes the offer make sense —
 * and a tap on an unplayed day is where the paywall comes in (`requirePlus`).
 *
 * FROM THE FIRST DAY PLAYED, not the epoch, when that is later
 * (`archiveDays`): the archive is a record of this person's puzzles, and a
 * year of empty days before they ever opened the game is a wall.
 *
 * A PLAYED DAY IS NOT REPLAYED. Its result is final, live or from the
 * archive, so the row shows the square and does nothing — the answer is
 * already known, and a second go would only be a second, easier game.
 *
 * READ ON FOCUS, so a day played from here is coloured when you come back.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';

import { levelColor } from '@/components/puzzle-block';
import { NavHeader, Screen } from '@/components/ui';
import { currentLocale, t } from '@/i18n';
import { requirePlus, usePlus } from '@/plus';
import { MAX_TRIES, archiveDays, puzzleNumber, winLevel, type Result } from '@/puzzle';
import { firstPlayedDay, resultsByDay, today } from '@/puzzle-data';
import { colors, radius, space } from '@/theme';

type Row = { d: string; n: number; r: Result | null };

const longDay = (d: string): string =>
  new Date(`${d}T12:00:00`).toLocaleDateString(currentLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export default function PuzzleArchiveScreen() {
  const plus = usePlus();
  const [rows, setRows] = useState<Row[]>([]);

  useFocusEffect(
    useCallback(() => {
      const results = resultsByDay();
      setRows(archiveDays(today(), firstPlayedDay()).map((d) => ({ d, n: puzzleNumber(d), r: results.get(d) ?? null })));
    }, []),
  );

  const status = (r: Result | null): string =>
    r == null
      ? t('puzzlePolish.notPlayed')
      : r.won
        ? t('puzzlePolish.solvedIn', { score: `${r.tries}/${MAX_TRIES}` })
        : t('puzzlePolish.missed');

  const open = (d: string) => {
    if (!requirePlus('puzzle.archive')) return;
    router.push(`/puzzle?day=${d}`);
  };

  return (
    <Screen>
      <NavHeader title={t('puzzlePolish.archiveTitle')} />
      <FlatList
        data={rows}
        keyExtractor={(row) => row.d}
        contentContainerStyle={{ paddingBottom: space.xl }}
        ListHeaderComponent={<Text style={s.sub}>{t('puzzlePolish.archiveSub')}</Text>}
        ListEmptyComponent={<Text style={s.empty}>{t('puzzlePolish.archiveEmpty')}</Text>}
        renderItem={({ item }) => {
          const played = item.r != null;
          return (
            <Pressable
              style={({ pressed }) => [s.row, pressed && !played && { backgroundColor: colors.lift }]}
              disabled={played}
              onPress={() => open(item.d)}
              accessibilityRole="button"
              accessibilityState={{ disabled: played }}
              accessibilityLabel={`#${item.n}, ${longDay(item.d)}, ${status(item.r)}`}
              accessibilityHint={!played && !plus ? t('puzzlePolish.needsPlus') : undefined}>
              <View style={[s.square, item.r ? { backgroundColor: levelColor(winLevel(item.r)) } : s.squareEmpty]} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.title} numberOfLines={1}>
                  #{item.n} <Text style={s.date}>· {longDay(item.d)}</Text>
                </Text>
                <Text style={s.status} numberOfLines={1}>
                  {status(item.r)}
                </Text>
              </View>
              {!played &&
                (plus ? (
                  <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.faint} />
                ) : (
                  <View style={s.plus}>
                    <Ionicons name="lock-closed" size={11} color={colors.onYellow} />
                    <Text style={s.plusText}>{t('plus.badge')}</Text>
                  </View>
                ))}
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  sub: { color: colors.dim, fontSize: 13.5, lineHeight: 19, paddingHorizontal: space.lg, paddingBottom: 12 },
  empty: { color: colors.dim, fontSize: 15, textAlign: 'center', padding: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  square: { width: 26, height: 26, borderRadius: 7 },
  squareEmpty: { borderWidth: 1.5, borderColor: colors.liftStrong },
  title: { color: colors.text, fontSize: 16, fontWeight: '800' },
  date: { color: colors.dim, fontWeight: '600' },
  status: { color: colors.dim, fontSize: 13 },
  plus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  plusText: { color: colors.onYellow, fontSize: 10, fontWeight: '900' },
});
