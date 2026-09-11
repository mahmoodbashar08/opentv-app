/**
 * The picture somebody posts, with a grid of ratings inside it.
 *
 * THE FIRST VERSION WAS A SCREENSHOT OF A COLUMN. It captured the grid as it
 * sits on the page — one narrow column of cells stranded in a full-width black
 * rectangle, with the show's name in small grey type at the bottom and nothing
 * else. Nobody would post that, which makes it worthless: every one of these
 * that gets shared is the only advertising this app has.
 *
 * SO IT IS COMPOSED, NOT CAPTURED. The poster and the title carry the top, the
 * two figures that summarise the thing sit beside them, the grid is CENTRED so
 * a one-season show reads as deliberate rather than broken, and the brand bar
 * closes it the same way the profile card's does.
 *
 * FIXED COLOURS, NO THEME. `share-card.tsx` says it best: a share card is a
 * picture and a picture does not have a theme. Reading `colors` here is how
 * the last attempt came out blue for one reader and yellow for another — the
 * same card, two different brands, neither of them recognisable.
 */
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** The app's own black and yellow, written down rather than read from the
 *  theme, because this is the brand and not the reader's preference. */
const INK = '#0B0B0D';
const PANEL = '#141416';
const TEXT = '#FFFFFF';
const DIM = '#A7A7AE';
const FAINT = '#6B6B72';
const BRAND = '#FFD400';

/** The app's real icon, not a yellow square with an O in it. The first version
 *  drew the letter by hand and it was, correctly, called out as not the
 *  logo. */
const ICON = require('../../assets/images/icon.png');

export type RatingsShareCardProps = {
  /** Title across the top — the show's name. */
  show: string;
  /** Whose numbers these are, said plainly on the card. */
  heading: string;
  /**
   * The person these ratings belong to. Absent on the community's card,
   * because they belong to everybody and naming one reader would be a lie.
   *
   * It goes in the FOOTER as a real address rather than as a handle in the
   * eyebrow: `theopentv.com/@name` is somewhere a reader can actually go, and
   * it costs the card nothing it was not already spending on the domain.
   */
  who?: string | null;
  /**
   * The day it was made.
   *
   * NOT DECORATION. A community average moves as people vote, so a card
   * without a date is a claim about today being read next month — and the
   * reader has no way to know it has gone stale.
   */
  madeOn: string;
  poster?: string | null;
  /** "2014 · 10 episodes", or whatever the show can honestly say. */
  sub?: string | null;
  /** The two figures worth having on a picture. */
  average: number | null;
  rated: number;
  ratedLabel: string;
  averageLabel: string;
  children: ReactNode;
};

export function RatingsShareCard({
  show,
  heading,
  who,
  madeOn,
  poster,
  sub,
  average,
  rated,
  ratedLabel,
  averageLabel,
  children,
}: RatingsShareCardProps) {
  return (
    <View style={s.card}>
      <View style={s.head}>
        {poster ? (
          <Image source={{ uri: poster }} style={s.poster} contentFit="cover" />
        ) : (
          <View style={[s.poster, s.posterEmpty]} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={s.heading}>{heading.toUpperCase()}</Text>
          <Text style={s.title} numberOfLines={2}>
            {show}
          </Text>
          {!!sub && (
            <Text style={s.sub} numberOfLines={1}>
              {sub}
            </Text>
          )}
          <View style={s.figures}>
            {average != null && (
              <View>
                <Text style={s.figure}>{average.toFixed(1)}</Text>
                <Text style={s.figureLabel}>{averageLabel.toUpperCase()}</Text>
              </View>
            )}
            <View>
              <Text style={s.figure}>{rated}</Text>
              <Text style={s.figureLabel}>{ratedLabel.toUpperCase()}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* CENTRED, so a show with one season is a column in the middle of a card
          rather than a column abandoned at the left edge of one. */}
      <View style={s.plot}>{children}</View>

      <View style={s.brandBar}>
        <View style={s.brandLeft}>
          <Image source={ICON} style={s.badge} contentFit="cover" />
          <View>
            <Text style={s.brandName}>OPENTV</Text>
            <Text style={s.brandUrl}>{who ? `theopentv.com/@${who}` : 'theopentv.com'}</Text>
          </View>
        </View>
        <Text style={s.brandDate}>{madeOn}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  /** `alignSelf: flex-start` so the card is as wide as its widest row and no
   *  wider — a two-season grid should not be photographed on a phone-width
   *  sheet of black. */
  card: { backgroundColor: INK, borderRadius: 18, overflow: 'hidden', alignSelf: 'flex-start', minWidth: 340 },
  head: { flexDirection: 'row', gap: 14, padding: 16, paddingBottom: 14 },
  poster: { width: 74, height: 110, borderRadius: 8, backgroundColor: PANEL },
  posterEmpty: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  heading: { color: BRAND, fontSize: 10.5, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: TEXT, fontSize: 21, fontWeight: '900', lineHeight: 25, marginTop: 4 },
  sub: { color: DIM, fontSize: 12.5, marginTop: 4 },
  figures: { flexDirection: 'row', gap: 22, marginTop: 12 },
  figure: { color: TEXT, fontSize: 22, fontWeight: '900', lineHeight: 24 },
  figureLabel: { color: FAINT, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.9, marginTop: 2 },
  plot: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 6 },
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
  brandUrl: { color: FAINT, fontSize: 9.5, marginTop: 1 },
  brandDate: { color: FAINT, fontSize: 10 },
});
