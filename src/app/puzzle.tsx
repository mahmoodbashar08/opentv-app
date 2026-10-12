/**
 * 🎬 Guess the show — the daily puzzle.
 *
 * WHAT IS ON THE SCREEN, top to bottom: the still, blurred; six squares; the
 * clues, one row per miss; the answer box, which suggests titles from the
 * library (and the classics) as you type. The rules are in `puzzle.ts`, the
 * reads in `puzzle-data.ts`; this file draws and saves.
 *
 * IT LEADS INTO THE LIBRARY, NOT AWAY FROM IT. Solved, and the show is
 * yours, the reward is the memory — "you watched it in 2019, 62 episodes" —
 * and a door to the show. Not yours, it goes on the watchlist in one tap.
 * Memories become the game's reward, which is the thing no catalogue game
 * can offer.
 *
 * SAVED AFTER EVERY GUESS, so an app killed mid-game comes back on the same
 * try with the same clues. A finished game is written to the history, moves
 * the streak and re-plans tonight's reminder, which is now moot.
 *
 * ANALYTICS: "played" on the first guess and "finished" with the try count —
 * shape, never the title, as `analytics.ts` requires.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { track } from '@/analytics';
import { PuzzleShareCard, Squares } from '@/components/puzzle-share-card';
import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { addShow, puzzleMemory } from '@/db';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { syncEpisodeNotifications } from '@/notifications';
import { CLUES, SKIP, blurFor, cluesShown, guess as applyGuess, isOver, puzzleNumber, shareText, titleMatches, type Game } from '@/puzzle';
import {
  answerPool,
  cluesFor,
  currentStreak,
  finishGame,
  pictureFor,
  saveGame,
  today,
  todaysGame,
  type Answer,
  type Clues,
} from '@/puzzle-data';
import { withLink } from '@/share-link';
import { colors, radius, space } from '@/theme';

/** More than this and the list is a wall; fewer and a common word hides the show. */
const SUGGESTIONS = 8;

export default function PuzzleScreen() {
  /* The day is fixed when the screen opens: a game that straddles midnight
     finishes as the day it started, which is the day its answer belongs to. */
  const [day] = useState(today);
  const number = puzzleNumber(day);
  /*
   * LAZY INITIALISERS, NOT AN EFFECT, for the synchronous reads: the screen is
   * pushed fresh every time, `useState(fn)` runs once, and the React Compiler
   * leaves it alone — the same shape `FeedCard` on Explore uses. Only the
   * picture, which may need the network, is resolved in an effect.
   */
  const [pool] = useState<Answer[]>(answerPool);
  const [game, setGame] = useState<Game | null>(() => todaysGame(day, pool));
  const [clues] = useState<Clues | null>(() => (game ? cluesFor(game.id) : null));
  /** undefined while it is being resolved; null when the phone has nothing. */
  const [picture, setPicture] = useState<string | null | undefined>(undefined);
  const [streak, setStreak] = useState(() => currentStreak(day));
  const [frozen, setFrozen] = useState(false);
  const [query, setQuery] = useState('');
  const [added, setAdded] = useState(false);
  const cardRef = useRef<View>(null);

  const answer = useMemo(() => (game ? (pool.find((a) => a.id === game.id) ?? null) : null), [pool, game]);

  useEffect(() => {
    let cancelled = false;
    const settle = (uri: string | null) => {
      if (!cancelled) setPicture(uri);
    };
    if (!answer) {
      Promise.resolve().then(() => settle(null));
    } else {
      pictureFor(answer, day).then(settle, () => settle(null));
    }
    return () => {
      cancelled = true;
    };
  }, [answer, day]);

  const guessed = useMemo(() => new Set(game?.guesses ?? []), [game]);
  const suggestions = useMemo(
    () =>
      query.trim()
        ? pool.filter((a) => !guessed.has(a.id) && a.names.some((n) => titleMatches(n, query))).slice(0, SUGGESTIONS)
        : [],
    [pool, query, guessed],
  );

  const play = (id: number) => {
    if (!game || isOver(game)) return;
    tapLight();
    Keyboard.dismiss();
    setQuery('');
    if (game.guesses.length === 0) track('puzzle_played');
    const next = applyGuess(game, id);
    setGame(next);
    if (!isOver(next)) {
      saveGame(next);
      return;
    }
    const done = finishGame(next);
    setStreak(done.streak.n);
    setFrozen(done.frozen);
    track('puzzle_finished', { won: next.won ? 1 : 0, tries: next.guesses.length });
    // Tonight's "your streak ends" is now moot: re-plan so it is dropped.
    void syncEpisodeNotifications(true);
  };

  /**
   * THE TEXT IS THE SHARE; THE PICTURE RIDES ALONG WHERE IT CAN. The grid line
   * is the Wordle format people recognise and post, and it is the same in
   * every language. iOS attaches the captured card beside it; Android's share
   * sheet takes the text only (RN's `url` is iOS-only), which is still the
   * whole result.
   */
  const share = async () => {
    if (!game) return;
    const text = withLink(shareText(number, game, streak));
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
      const url = cardRef.current ? await captureRef(cardRef, { format: 'jpg', quality: 0.92 }) : null;
      await Share.share(url ? { url, message: text } : { message: text });
    } catch {
      try {
        await Share.share({ message: text });
      } catch {
        // The sheet was dismissed, or sharing is unavailable: nothing to say.
      }
    }
  };

  const addToWatchlist = () => {
    if (!answer) return;
    tapLight();
    addShow(answer.id, answer.name, answer.poster);
    setAdded(true);
  };

  if (!game || !answer) {
    return (
      <Screen>
        <NavHeader title={t('puzzle.title')} />
        <Text style={s.empty}>{t('puzzle.noPuzzle')}</Text>
      </Screen>
    );
  }

  const over = isOver(game);
  const shown = cluesShown(game);
  const memory = over && answer.mine ? puzzleMemory(answer.id) : null;

  /** The four text clues, in the order they unlock. Null text means the
   *  phone knows nothing for that row, and the row says so. */
  const clueText = (c: (typeof CLUES)[number]): string | null => {
    if (!clues) return null;
    switch (c) {
      case 'yearGenre': {
        const parts = [clues.year && t('puzzle.clueYear', { year: clues.year }), clues.genre && t('puzzle.clueGenre', { genre: clues.genre })];
        return parts.filter(Boolean).join(' · ') || null;
      }
      case 'countryNetwork': {
        const parts = [
          clues.country && t('puzzle.clueCountry', { country: clues.country }),
          clues.network && t('puzzle.clueNetwork', { network: clues.network }),
        ];
        return parts.filter(Boolean).join(' · ') || null;
      }
      case 'seasons':
        return clues.seasons ? t('show.seasonsCount', { count: clues.seasons }) : null;
      case 'character':
        return clues.character ? t('puzzle.clueCharacter', { name: clues.character }) : null;
      default:
        return null;
    }
  };

  return (
    <Screen>
      <NavHeader title={t('puzzle.title')} right={<Text style={s.number}>#{number}</Text>} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
        <ContentColumn>
          {/* THE STILL. Blur is `expo-image`'s own, lowered per miss — on the
              phone, free, and nothing is uploaded anywhere. */}
          <View style={s.frame} accessible accessibilityLabel={t('puzzle.title')}>
            {picture ? (
              <Image
                source={{ uri: picture }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                cachePolicy="disk"
                blurRadius={blurFor(game)}
                transition={300}
              />
            ) : picture === undefined ? (
              <ActivityIndicator color={colors.yellow} />
            ) : (
              <Text style={s.noPicture}>{t('puzzle.pictureOffline')}</Text>
            )}
            {!over && (
              <View style={s.pill}>
                <Text style={s.pillText}>{answer.mine ? t('puzzle.fromLibrary') : t('puzzle.classic')}</Text>
              </View>
            )}
          </View>

          {!over ? (
            <>
              <View style={s.squares}>
                <Squares game={game} size={28} gap={6} />
              </View>

              {/* The text clues: one row per miss from the third try on. A
                  locked row stays visible so the player knows what a miss
                  buys, which is what makes skipping a choice. */}
              <View style={s.clues}>
                {CLUES.slice(2).map((c, i) => {
                  const unlocked = i + 2 < shown;
                  const text = unlocked ? clueText(c) : null;
                  return (
                    <View key={c} style={s.clueRow} accessible accessibilityState={{ disabled: !unlocked }}>
                      <Ionicons
                        name={unlocked ? 'bulb' : 'lock-closed-outline'}
                        size={16}
                        color={unlocked ? colors.yellow : colors.faint}
                      />
                      <Text style={[s.clueText, !unlocked && { color: colors.faint }]} numberOfLines={2}>
                        {unlocked ? (text ?? t('puzzle.clueUnknown')) : t('puzzle.clueLocked')}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {/* THE ANSWER BOX: titles from the library in any of their
                  names, and the classics. A guess is matched by id, so the
                  French title and the English one are one show. */}
              <View style={s.searchRow}>
                <Ionicons name="search" size={20} color={colors.dim} />
                <TextInput
                  style={s.searchInput}
                  placeholder={t('puzzle.answerPlaceholder')}
                  placeholderTextColor={colors.dim}
                  value={query}
                  onChangeText={setQuery}
                  autoCorrect={false}
                  accessibilityLabel={t('puzzle.answerPlaceholder')}
                />
              </View>
              {query.trim().length > 0 && suggestions.length === 0 && <Text style={s.noMatch}>{t('puzzle.noMatch')}</Text>}
              {suggestions.map((a) => (
                <Pressable key={a.id} style={s.row} onPress={() => play(a.id)} accessibilityRole="button" accessibilityLabel={a.name}>
                  {a.poster ? (
                    <Image source={{ uri: a.poster }} style={s.thumb} contentFit="cover" cachePolicy="disk" />
                  ) : (
                    <View style={[s.thumb, { backgroundColor: colors.raise }]} />
                  )}
                  <Text style={s.rowName} numberOfLines={1}>
                    {a.name}
                  </Text>
                  {a.mine && <Ionicons name="library-outline" size={16} color={colors.faint} />}
                </Pressable>
              ))}
              <Pressable style={s.skip} onPress={() => play(SKIP)} accessibilityRole="button">
                <Text style={s.skipText}>{t('puzzle.skip')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={s.resultTitle}>
                {game.won ? t('puzzle.wonTitle', { count: game.guesses.length }) : t('puzzle.lostTitle')}
              </Text>

              {/* THE REVEAL. On a win it is confirmation; on a loss it is the
                  answer, and the only place it is ever written down. */}
              <View style={s.reveal} accessible accessibilityLabel={t('puzzle.itWas', { show: answer.name })}>
                {answer.poster ? (
                  <Image source={{ uri: answer.poster }} style={s.poster} contentFit="cover" cachePolicy="disk" />
                ) : (
                  <View style={[s.poster, { backgroundColor: colors.raise }]} />
                )}
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={s.revealName} numberOfLines={2}>
                    {answer.name}
                  </Text>
                  {memory && <Text style={s.memory}>{t('puzzle.memory', { year: memory.year, count: memory.episodes })}</Text>}
                  {frozen && <Text style={s.memory}>{t('puzzle.freezeUsed')}</Text>}
                </View>
              </View>

              <View style={s.actions}>
                {answer.mine || added ? (
                  <Pressable style={s.primary} onPress={() => router.push(`/show/${answer.id}`)} accessibilityRole="button">
                    <Text style={s.primaryText}>{t('puzzle.openShow')}</Text>
                  </Pressable>
                ) : (
                  <Pressable style={s.primary} onPress={addToWatchlist} accessibilityRole="button">
                    <Ionicons name="add" size={18} color={colors.onYellow} />
                    <Text style={s.primaryText}>{t('puzzle.addToWatchlist')}</Text>
                  </Pressable>
                )}
                {added && <Text style={s.added}>{t('puzzle.added')}</Text>}
              </View>

              {/* The card is what the share captures — see `puzzle-share-card.tsx`. */}
              <View style={s.cardFrame}>
                <PuzzleShareCard number={number} game={game} streak={streak} cardRef={cardRef} />
              </View>
              <View style={s.actions}>
                <Pressable style={s.shareBtn} onPress={share} accessibilityRole="button" accessibilityLabel={t('puzzle.share')}>
                  <Ionicons name="share-outline" size={18} color={colors.onBrand} />
                  <Text style={s.shareText}>{t('puzzle.share')}</Text>
                </Pressable>
                <Text style={s.tomorrow}>{t('puzzle.tomorrow')}</Text>
              </View>
            </>
          )}
        </ContentColumn>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  number: { color: colors.yellow, fontSize: 15, fontWeight: '800' },
  empty: { color: colors.dim, fontSize: 15, textAlign: 'center', padding: 40 },
  frame: {
    marginHorizontal: space.lg,
    aspectRatio: 16 / 9,
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noPicture: { color: colors.dim, fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  pill: {
    position: 'absolute',
    top: 10,
    start: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillText: { color: colors.onArt, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  squares: { alignItems: 'center', paddingVertical: 14 },
  clues: { marginHorizontal: space.lg, gap: 8, marginBottom: 10 },
  clueRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  clueText: { color: colors.text, fontSize: 14.5, flex: 1 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: space.lg,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 17, paddingVertical: 4 },
  noMatch: { color: colors.faint, fontSize: 13, paddingHorizontal: space.lg, paddingTop: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: space.lg,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  thumb: { width: 34, height: 51, borderRadius: radius.poster, backgroundColor: colors.card },
  rowName: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1 },
  skip: { alignSelf: 'center', marginTop: 16, paddingHorizontal: 18, paddingVertical: 8 },
  skipText: { color: colors.dim, fontSize: 13.5, fontWeight: '700' },
  resultTitle: { color: colors.text, fontSize: 22, fontWeight: '900', textAlign: 'center', paddingTop: 16, paddingHorizontal: space.lg },
  reveal: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: space.lg, marginTop: 14 },
  poster: { width: 56, height: 84, borderRadius: radius.poster },
  revealName: { color: colors.text, fontSize: 18, fontWeight: '800' },
  memory: { color: colors.dim, fontSize: 13.5 },
  actions: { alignItems: 'center', gap: 10, marginTop: 16 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 12,
    paddingHorizontal: 26,
  },
  primaryText: { color: colors.onYellow, fontSize: 13.5, fontWeight: '800', letterSpacing: 0.6 },
  added: { color: colors.green, fontSize: 13, fontWeight: '700' },
  cardFrame: { marginHorizontal: space.lg, marginTop: 18, borderRadius: 12, overflow: 'hidden' },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingVertical: 13,
    paddingHorizontal: 40,
  },
  shareText: { color: colors.onBrand, fontSize: 13.5, fontWeight: '800', letterSpacing: 1 },
  tomorrow: { color: colors.faint, fontSize: 13 },
});
