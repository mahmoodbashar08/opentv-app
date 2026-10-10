/**
 * The picture a finished puzzle becomes — and the squares every surface draws.
 *
 * NO STILL, NO TITLE, ON PURPOSE. A share card that showed the frame or named
 * the show would hand the answer to everybody who sees it, and the whole point
 * of a daily puzzle is that the person reading the post can go and play the
 * same one. So this is Wordle's grid as a picture: the number, six squares,
 * the score, the streak, and the brand bar. Everything on it is a number or a
 * colour, which is also why it needs no translating.
 *
 * FIXED COLOURS, NO THEME, for the reason `ratings-share-card.tsx` gives: a
 * share card is a picture and a picture does not have a theme. Two people
 * sharing the same result must produce the same card.
 */
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { t } from '@/i18n';
import { MAX_TRIES, SKIP, squares, type Game } from '@/puzzle';
import { SITE } from '@/share-link';

const INK = '#0B0B0D';
const TEXT = '#FFFFFF';
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
      // Read as the text grid: "🟥🟥🟩", then the empty tries.
      accessible
      accessibilityLabel={`${squares(game)} ${game.guesses.length}/${MAX_TRIES}`}>
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
  streak,
  cardRef,
}: {
  number: number;
  game: Game;
  streak: number;
  /** Where `captureRef` points. The card is what it photographs. */
  cardRef?: React.RefObject<View | null>;
}) {
  const score = game.won ? `${game.guesses.length}/${MAX_TRIES}` : `X/${MAX_TRIES}`;
  return (
    <View ref={cardRef} collapsable={false} style={s.card}>
      <View style={s.head}>
        <Text style={s.heading}>{t('puzzle.title').toUpperCase()}</Text>
        <Text style={s.number}>#{number}</Text>
      </View>
      <View style={s.plot}>
        <Squares game={game} />
      </View>
      <View style={s.figures}>
        <Text style={s.score}>{score}</Text>
        {streak > 0 && <Text style={s.streak}>🔥 {t('puzzle.streakDays', { count: streak })}</Text>}
      </View>
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
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', padding: 16, paddingBottom: 6 },
  heading: { color: BRAND, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  number: { color: TEXT, fontSize: 18, fontWeight: '900' },
  plot: { alignItems: 'center', paddingVertical: 14 },
  figures: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 14 },
  score: { color: TEXT, fontSize: 22, fontWeight: '900' },
  streak: { color: TEXT, fontSize: 13, fontWeight: '700' },
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
  brandName: { color: TEXT, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.8 },
  brandUrl: { color: FAINT, fontSize: 10 },
});
