/**
 * The door to today's puzzle, on the Explore tab.
 *
 * ONE CARD, ONE TAP. It says which puzzle today is, where it stands (not
 * started, try three of six, solved in three, not today) and the streak — and
 * nothing about the show, which is the one thing a card on a tab anybody can
 * glance at must not give away.
 *
 * TWO `meta` READS AND NOTHING ELSE. The Explore tab is opened constantly;
 * the answer pool (every show's cached metadata) is the game screen's cost,
 * not this card's.
 *
 * READ ON FOCUS, NOT IN RENDER, for the reason `memory-card.tsx` gives: the
 * React Compiler memoises a render-time read, and this card is the one that
 * has to change the moment somebody comes back from playing.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';

import { Squares } from '@/components/puzzle-share-card';
import { t } from '@/i18n';
import { MAX_TRIES, isOver, puzzleNumber, type Game } from '@/puzzle';
import { currentStreak, loadGame, puzzleOn, today } from '@/puzzle-data';
import { colors, radius, space } from '@/theme';

type Seen = { on: boolean; number: number; game: Game | null; streak: number };

export function PuzzleCard() {
  const [seen, setSeen] = useState<Seen | null>(null);

  useFocusEffect(
    useCallback(() => {
      const day = today();
      setSeen({ on: puzzleOn(), number: puzzleNumber(day), game: loadGame(day), streak: currentStreak(day) });
    }, []),
  );

  if (!seen?.on) return null;
  const { game, streak, number } = seen;

  const status =
    game == null || game.guesses.length === 0
      ? t('puzzle.cardSub')
      : !isOver(game)
        ? t('puzzle.cardProgress', { n: game.guesses.length + 1 })
        : game.won
          ? t('puzzle.cardWon', { score: `${game.guesses.length}/${MAX_TRIES}` })
          : t('puzzle.cardLost');
  const sub = streak > 0 ? `${status} · 🔥 ${t('puzzle.streakDays', { count: streak })}` : status;

  return (
    <Pressable
      style={s.card}
      onPress={() => router.push('/puzzle')}
      accessibilityRole="button"
      accessibilityLabel={`${t('puzzle.title')} #${number}. ${sub}`}>
      <View style={s.icon}>
        <Text style={{ fontSize: 24 }}>🎬</Text>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={s.title} numberOfLines={1}>
          {t('puzzle.title')} <Text style={s.number}>#{number}</Text>
        </Text>
        <Text style={s.sub} numberOfLines={2}>
          {sub}
        </Text>
        {game != null && game.guesses.length > 0 && (
          <View style={{ marginTop: 4 }}>
            <Squares game={game} size={14} gap={4} />
          </View>
        )}
      </View>
      <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.faint} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: space.lg,
    marginBottom: 14,
    padding: 13,
    borderRadius: radius.card,
    backgroundColor: colors.card,
  },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.raise,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.text, fontSize: 16.5, fontWeight: '800' },
  number: { color: colors.yellow },
  sub: { color: colors.dim, fontSize: 13 },
});
