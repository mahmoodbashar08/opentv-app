/**
 * The Wrapped design system — the handful of pieces every card is built from.
 *
 * ONE LANGUAGE, EIGHT COMPOSITIONS. These primitives fix what is shared —
 * the black canvas, the yellow kicker, the display type, the way artwork
 * dissolves into black, the recurring yellow light, the brand strip — so
 * that the eight card layouts in `cards.tsx` can each be genuinely different
 * without the deck falling apart. Nothing here decides a layout.
 *
 * NO GRADIENT OR SVG LIBRARY. The app does not ship one and this is not the
 * feature to add one for: every gradient below is a short stack of plain
 * Views at stepped opacity, and the glow is concentric rounded Views. Both
 * survive `react-native-view-shot`, which is the whole point — a card that
 * looks right on screen and wrong in the PNG is a card nobody shares.
 */
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

export const WRAPPED_YELLOW = '#FFD400';
const INK = '#FFFFFF';
const GREY = '#B4B4BC';
const FAINT = '#7A7A84';

/** The 9:16 black card. Slight radius, hairline edge so it holds on a feed. */
export function Canvas({ width, children, style }: { width: number; children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ width, height: width * (16 / 9), backgroundColor: '#050505', borderRadius: 18, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' }, style]}>
      {children}
    </View>
  );
}

/** Small uppercase yellow kicker. */
export function Label({ children, colour = WRAPPED_YELLOW, size = 11, style }: { children: ReactNode; colour?: string; size?: number; style?: TextStyle }) {
  return <Text style={[{ color: colour, fontSize: size, fontWeight: '900', letterSpacing: size * 0.18, textTransform: 'uppercase' }, style]}>{children}</Text>;
}

/** The period, as a masthead. */
export function Period({ children, size = 26, style }: { children: ReactNode; size?: number; style?: TextStyle }) {
  return <Text style={[{ color: INK, fontSize: size, fontWeight: '900', letterSpacing: -size * 0.03, lineHeight: size * 1.05 }, style]}>{children}</Text>;
}

/**
 * Display type that never overflows — or clips. iOS cuts the top of a glyph
 * whose line box is shorter than its em, so the line-height is never below
 * 1.02em, however tight the headline wants to sit.
 *
 * `adjustsFontSizeToFit` with a line cap is what makes "LOST" and "IT'S ALWAYS
 * SUNNY IN PHILADELPHIA" both work in the same slot: the long one shrinks
 * until it fits its lines, the short one stays enormous. `minScale` is the
 * floor — below it the text would be smaller than the sub-copy and the card
 * would have lost its hierarchy, so the layout must give it room instead.
 */
export function Display({
  children,
  size,
  lines = 2,
  colour = INK,
  minScale = 0.45,
  align = 'left',
  style,
}: {
  children: ReactNode;
  size: number;
  lines?: number;
  colour?: string;
  minScale?: number;
  align?: 'left' | 'center' | 'right';
  style?: TextStyle;
}) {
  return (
    <Text
      numberOfLines={lines}
      adjustsFontSizeToFit
      minimumFontScale={minScale}
      allowFontScaling={false}
      style={[{ color: colour, fontSize: size, fontWeight: '900', lineHeight: size * 1.02, letterSpacing: -size * 0.035, textAlign: align }, style]}>
      {children}
    </Text>
  );
}

/** A display size for a number, by how many characters it has to hold. */
export function numberSize(value: string, room: number): number {
  const n = value.length;
  const wanted = n <= 2 ? 220 : n <= 3 ? 170 : n <= 5 ? 128 : 96;
  // 0.64em per digit at weight 900 with tight tracking: the number must clear
  // the room it was given, whatever the count of digits — "1,024" at 128pt
  // is 410pt wide, and the card is 370. Capped here, before layout.
  return Math.min(wanted, room / (n * 0.64));
}

export function Sub({ children, colour = GREY, size = 15, style, numberOfLines }: { children: ReactNode; colour?: string; size?: number; style?: TextStyle; numberOfLines?: number }) {
  return <Text numberOfLines={numberOfLines} style={[{ color: colour, fontSize: size, lineHeight: size * 1.4, fontWeight: '500' }, style]}>{children}</Text>;
}

/**
 * A gradient, as an image.
 *
 * Stacked Views at stepped opacity showed as BANDS over a photograph — the
 * eye finds a 7% step in a sky instantly. So the fade is a real alpha ramp:
 * a 1×256 PNG (black, alpha eased from 0 to 1), generated once and inlined,
 * stretched by expo-image over the box and rotated for the other edges. It
 * is smooth at any size, costs nothing to draw, and survives view-shot.
 */
const RAMP = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAEACAYAAAByPhyYAAABk0lEQVR42o3EV6gIABQA0Gfvvffee++9994je2RnZmZlZGWEjJARQgghRAgRIkJEiIiIiIjOz61XPpyPk5DwX5L8o6SJSxYlT1yKKGXiUkWpozRR2ihdlD7KoIxRpiizskRZo2zKHuVQziiXckd5lDfKp/wqEBVUIRWOiqioikXFVUIlVSoqrTIqq3JReVVQRVVSZVWJqqqaqquGaqqWaqtOVFf1VF8N1FCN1FhN1FTN1Fwt1FKt1Fpt1Fbt1F4d1FGd1Fld1FXd1F091FO91Ft91Ff91F8DNFCDNFhDNFTDNFwjNFKjNFpjNFbjNF4TNFGTNFlTNFXTNF0zNFOzNFtzNFfzNF8LtFCLtFhLtFTLtFwrtFKrtFprtFbrtF4btFGbtFlbtFXbtF07tFO7tFt7tFf7tF8HdFCHdFhHdFTHdFwndFKndFpndFbndF4XdFGXdFlXdFXXdF03dFO3dFt3dFf3dF8P9FCP9FhP9FTP9Fwv9FKv9Fpv9Fbv9F4f9FGf9Flf9FXf9F0/9FO/9Ft//gLQXmWgdW5ougAAAABJRU5ErkJggg==';

export function Gradient({ edge = 'bottom', strength = 1, style }: { from?: string; edge?: 'top' | 'bottom' | 'left' | 'right'; strength?: number; style?: ViewStyle }) {
  const rotate = edge === 'bottom' ? '0deg' : edge === 'top' ? '180deg' : edge === 'right' ? '-90deg' : '90deg';
  const vertical = edge === 'top' || edge === 'bottom';
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, style]}>
      {/* For left/right the image is rotated, so it is sized to the box's
          other axis and centred — a rotated rectangle needs the swap. */}
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Image
          source={{ uri: RAMP }}
          contentFit="fill"
          style={{ width: vertical ? '100%' : '1000%', height: vertical ? '100%' : '1000%', aspectRatio: undefined, transform: [{ rotate }], opacity: strength }}
        />
      </View>
    </View>
  );
}

/**
 * The yellow light — the deck's recurring motif.
 *
 * A soft radial bloom: one 256×256 PNG (yellow, alpha falling off as
 * (1−d)^2.2), generated once and inlined, stretched to `size`. Concentric
 * Views showed as rings the moment they sat over a photograph; an alpha image
 * is smooth at any size. Yellow at low alpha over black is the one treatment
 * that reads as light rather than as a yellow shape. Placed by the card;
 * never centred by default.
 *
 * There was a diagonal "seam" beam as well. The owner asked for it to go —
 * a hard line across a photograph read as a stripe, not as light.
 */
const GLOW = 'data:image/png;base64,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';

export function YellowLight({ size = 320, x = 0, y = 0, strength = 1 }: { size?: number; x?: number; y?: number; strength?: number }) {
  return (
    <Image
      pointerEvents="none"
      source={{ uri: GLOW }}
      contentFit="fill"
      style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, opacity: 0.55 * strength }}
    />
  );
}

/**
 * A display size that will never split a word.
 *
 * `adjustsFontSizeToFit` shrinks only once a LINE overflows, and a single word
 * wider than the box is wrapped by character first — "SAVIN / G HOPE". So the
 * size is capped from the longest word before layout, and `wordLines` gives a
 * headline exactly as many lines as it has words (capped) — so a one-word
 * headline can only ever SHRINK, never break.
 */
export function wordLines(text: string, max = 3): number {
  return Math.max(1, Math.min(max, text.trim().split(/\s+/).length));
}
export function fitSize(text: string, width: number, base: number, min = 28, lines = wordLines(text, 3)): number {
  const longest = text.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 1);
  // 0.74em per glyph: measured on SF at weight 900 in caps with tight tracking.
  const byWord = width / (longest * 0.74);
  // And the whole title across its lines at ~0.6em a glyph: "THE HAUNTING
  // OF HILL HOUSE" is five short words, so no single word caps it, but 26
  // glyphs in three lines does — sized here so it lands at its size instead
  // of being shrunk after the fact.
  const byTotal = (width * lines) / (text.trim().length * 0.6);
  return Math.max(min, Math.min(base, byWord, byTotal));
}

/** Artwork, cover-cropped, in whatever box it is given. */
export function Media({ uri, style, fade, dim = 0, focus = 'center' }: { uri: string; style: ViewStyle; fade?: 'top' | 'bottom' | 'left' | 'right'; dim?: number; focus?: 'top' | 'center' }) {
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: '#141416' }, style]}>
      {/* `focus="top"` for a tall crop of a wide still: faces sit in the upper
          half of nearly every backdrop, and a centre crop takes the chin. */}
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition={focus} cachePolicy="disk" transition={200} />
      {dim > 0 ? <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: dim }]} /> : null}
      {fade ? <Gradient edge={fade} /> : null}
    </View>
  );
}

/** The brand strip: yellow square + OPENTV on the left, a small line on the right. */
export function Brand({ right, handle }: { right?: string; handle?: string | null }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 16, paddingTop: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: WRAPPED_YELLOW }} />
        <Text style={{ color: INK, fontSize: 11.5, fontWeight: '900', letterSpacing: 1.6 }}>OPENTV</Text>
        {handle ? <Text style={{ color: FAINT, fontSize: 10.5, marginLeft: 4 }}>@{handle}</Text> : null}
      </View>
      {right ? <Text numberOfLines={1} style={{ color: FAINT, fontSize: 8.5, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', flexShrink: 1, marginLeft: 14, textAlign: 'right' }}>{right}</Text> : null}
    </View>
  );
}

/** A thin rule. */
export function Rule({ colour = 'rgba(255,255,255,0.14)', style }: { colour?: string; style?: ViewStyle }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: colour, alignSelf: 'stretch' }, style]} />;
}

/**
 * The month as a field of days: seven across, one cell per day, lit by how
 * much was watched. Four steps, not a ramp — a quiet day, a normal one, a
 * heavy one, and THE day, which gets the full yellow and a bloom of light
 * behind it. A graphic, not a chart: no labels, no axes.
 */
export function ActivityGrid({ days, width, gap = 7, cell: fixed }: { days: readonly { count: number }[]; width: number; gap?: number; cell?: number }) {
  const cols = 7;
  const cell = fixed ?? Math.floor((width - gap * (cols - 1)) / cols);
  const max = Math.max(1, ...days.map((d) => d.count));
  const peak = days.findIndex((d) => d.count === max);
  const px = (peak % cols) * (cell + gap) + cell / 2;
  const py = Math.floor(peak / cols) * (cell + gap) + cell / 2;
  return (
    <View style={{ width: cell * cols + gap * (cols - 1) + 1, flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {max > 0 && days[peak]?.count ? <YellowLight size={cell * 5} x={px} y={py} strength={1.1} /> : null}
      {days.map((d, i) => {
        const t = d.count / max;
        const lit = d.count > 0;
        const tone = !lit ? 0 : i === peak ? 1 : t < 0.34 ? 0.42 : t < 0.7 ? 0.68 : 0.9;
        return (
          <View
            key={i}
            style={{
              width: cell,
              height: cell,
              borderRadius: cell * 0.24,
              backgroundColor: lit ? WRAPPED_YELLOW : '#151519',
              opacity: lit ? tone : 1,
              borderWidth: lit ? 0 : 1,
              borderColor: 'rgba(255,255,255,0.05)',
            }}
          />
        );
      })}
    </View>
  );
}

/**
 * The year as twelve months: a bar each, as tall as the share of its days
 * that had something on, the strongest month in full yellow. Month = days,
 * year = months — the same idea at the scale the period deserves.
 */
export function MonthBars({ months, width, height, locale }: { months: readonly { active: number; total: number }[]; width: number; height: number; locale: string }) {
  const gap = 6;
  const bar = Math.floor((width - gap * 11) / 12);
  const best = Math.max(...months.map((m) => (m.total ? m.active / m.total : 0)), 0.001);
  return (
    <View style={{ width: bar * 12 + gap * 11 + 1, flexDirection: 'row', gap, alignItems: 'flex-end' }}>
      {months.map((m, i) => {
        const share = m.total ? m.active / m.total : 0;
        const h = Math.max(4, Math.round((share / best) * height));
        const top = share > 0 && share === best;
        return (
          <View key={i} style={{ width: bar, alignItems: 'center' }}>
            <View style={{ width: bar, height: h, borderRadius: 4, backgroundColor: share > 0 ? WRAPPED_YELLOW : '#151519', opacity: share === 0 ? 1 : top ? 1 : 0.35 + 0.5 * (share / best) }} />
            {/* three letters in a column a bar wide: small, no tracking, and
                allowed to overhang the bar rather than be ellipsised */}
            <Text style={{ color: top ? INK : FAINT, fontSize: 7.5, fontWeight: '800', marginTop: 8, textTransform: 'uppercase', width: bar + gap, textAlign: 'center' }}>
              {new Date(2000, i, 1).toLocaleDateString(locale, { month: 'short' }).replace('.', '').slice(0, 3)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export const wrappedColours = { INK, GREY, FAINT, YELLOW: WRAPPED_YELLOW };
