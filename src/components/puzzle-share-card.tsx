/**
 * The picture a finished puzzle becomes — and the squares every surface draws.
 *
 * NO STILL, NO TITLE, ON PURPOSE. A share card that showed the frame or named
 * the show would hand the answer to everybody who sees it, and the whole point
 * of a daily puzzle is that the person reading the post can go and play the
 * same one. So this is Wordle's grid as a picture: the number, six squares,
 * the score, the three stats, and the brand bar. Not even a blurred frame —
 * blur is the first clue, and the card would be giving it away.
 *
 * REDRAWN 14 Oct, in the shape the other share cards have: a dark ground with
 * a wash of the brand yellow from the top, one big figure, small caps over
 * small numbers, and the same brand bar `share-card.tsx` ends on. The streak
 * went with the streak.
 *
 * FIXED COLOURS, NO THEME, for the reason `ratings-share-card.tsx` gives: a
 * share card is a picture and a picture does not have a theme. Two people
 * sharing the same result must produce the same card.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { t } from '@/i18n';
import { MAX_TRIES, SKIP, type Game, type Stats } from '@/puzzle';
import { SITE } from '@/share-link';
import { ls } from '@/theme';

const INK = '#0B0B0D';
const TEXT = '#FFFFFF';
const DIM = '#A7A7AE';
const FAINT = '#6B6B72';
const BRAND = '#FFD400';
/** The grid's own three colours — the same ones the emoji squares stand for. */
const RIGHT = '#78BE3D';
const WRONG = '#E5484D';
const SKIPPED = '#3A3A3E';
const UNUSED = '#1C1C1E';

const ICON = require('../../assets/images/icon.png');

/**
 * Six squares, drawn — 🟥 🟩 ⬛ as views rather than emoji, because emoji
 * squares render at different sizes on different phones and never line up
 * with anything. One component for the game screen, the Explore card and the
 * share card, so the three cannot disagree about what a skip looks like.
 */
export function Squares({ game, size = 40, gap = 8 }: { game: Game; size?: number; gap?: number }) {
  return (
    <View
      style={{ flexDirection: 'row', gap }}
      // IN WORDS: "Wrong, skipped, right, 3 of 6 tries". The text grid this
      // used to hand over was read as "red square, red square, green square,
      // 3 slash 6" — the share line's emoji are for a post, not for an ear.
      accessible
      accessibilityLabel={[
        ...game.guesses.map((g) => t(g === game.id ? 'a11y.puzzleRight' : g === SKIP ? 'a11y.puzzleSkipped' : 'a11y.puzzleWrong')),
        t('a11y.puzzleTries', { n: game.guesses.length, total: MAX_TRIES }),
      ].join(', ')}>
      {Array.from({ length: MAX_TRIES }, (_, i) => {
        const g = game.guesses[i];
        const color = g == null ? UNUSED : g === game.id ? RIGHT : g === SKIP ? SKIPPED : WRONG;
        return <View key={i} style={{ width: size, height: size, borderRadius: Math.round(size / 5), backgroundColor: color }} />;
      })}
    </View>
  );
}

export function PuzzleShareCard({
  number,
  game,
  stats,
  cardRef,
}: {
  number: number;
  game: Game;
  /** Today's player's stats; null on an archive game, which does not count. */
  stats: Stats | null;
  /** Where `captureRef` points. The card is what it photographs. */
  cardRef?: React.RefObject<View | null>;
}) {
  const score = game.won ? `${game.guesses.length}/${MAX_TRIES}` : `X/${MAX_TRIES}`;
  const verdict = game.won ? t('puzzle.wonTitle', { count: game.guesses.length }) : t('puzzle.lostTitle');
  return (
    <View ref={cardRef} collapsable={false} style={s.card}>
      <LinearGradient colors={['rgba(255,212,0,0.20)', 'rgba(255,212,0,0)']} style={StyleSheet.absoluteFill} end={{ x: 0.5, y: 0.7 }} />
      <View style={s.head}>
        <Text style={s.heading} numberOfLines={1}>
          {t('puzzle.title').toUpperCase()}
        </Text>
        <Text style={s.number}>#{number}</Text>
      </View>
      <View style={s.plot}>
        <Squares game={game} size={40} gap={9} />
        <Text style={s.score}>{score}</Text>
        <Text style={s.verdict} numberOfLines={1}>
          {verdict}
        </Text>
      </View>
      {stats && (
        <View style={s.stats}>
          {(
            [
              [String(stats.played), t('puzzlePolish.played')],
              [`${stats.win}%`, t('puzzlePolish.win')],
              [stats.avg == null ? '–' : stats.avg.toFixed(1), t('puzzlePolish.avg')],
            ] as const
          ).map(([v, label], i) => (
            <View key={label} style={[s.stat, i > 0 && s.statLine]}>
              <Text style={s.statValue}>{v}</Text>
              <Text style={s.statLabel} numberOfLines={1}>
                {label}
              </Text>
            </View>
          ))}
        </View>
      )}
      <View style={s.brandBar}>
        <View style={s.brandLeft}>
          <Image source={ICON} style={s.badge} contentFit="cover" />
          <Text style={s.brandName}>OPENTV</Text>
        </View>
        <Text style={s.brandUrl}>{SITE.replace(/^https?:\/\//, '')}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  /* Square corners on the thing that is captured: a JPEG has no transparency,
     so a radius here would be four black wedges on a light timeline. The
     screen that shows it rounds its frame instead — see `share-card.tsx`. */
  card: { backgroundColor: INK, alignSelf: 'stretch' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingTop: 18 },
  heading: { color: BRAND, fontSize: 11.5, fontWeight: '900', letterSpacing: ls(1.4), flexShrink: 1 },
  number: { color: TEXT, fontSize: 20, fontWeight: '900' },
  plot: { alignItems: 'center', paddingTop: 26, paddingBottom: 20, gap: 4 },
  score: { color: TEXT, fontSize: 44, fontWeight: '900', letterSpacing: ls(-1), marginTop: 14 },
  verdict: { color: DIM, fontSize: 14, fontWeight: '700' },
  stats: {
    flexDirection: 'row',
    marginHorizontal: 18,
    marginBottom: 18,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  stat: { flex: 1, alignItems: 'center', gap: 3 },
  statLine: { borderStartWidth: StyleSheet.hairlineWidth, borderStartColor: 'rgba(255,255,255,0.14)' },
  statValue: { color: TEXT, fontSize: 19, fontWeight: '900' },
  statLabel: { color: FAINT, fontSize: 9.5, fontWeight: '800', letterSpacing: ls(0.8), textTransform: 'uppercase' },
  brandBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0D0D0F',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  brandLeft: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  badge: { width: 26, height: 26, borderRadius: 7 },
  brandName: { color: TEXT, fontSize: 11.5, fontWeight: '800', letterSpacing: ls(0.8) },
  brandUrl: { color: FAINT, fontSize: 10 },
});
