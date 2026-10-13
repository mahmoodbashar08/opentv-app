/**
 * Half stars for FILMS (2.0.0, plan item 14). Episodes keep their five whole
 * labelled stars and never come through here.
 *
 * A TAP IS A WHOLE STAR, exactly as before: nobody has to aim at half a star.
 * A SLIDE across the row moves in halves, with a haptic tick on each one and
 * the value handed up so the screen can print it (3.5) while the finger moves.
 * The arithmetic is `film-rating.ts`, where it is tested; this file only draws
 * and listens.
 */
import { useState } from 'react';
import { I18nManager, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { filmRatingAt, starSlots, stepFilmRating, type StarSlot } from '@/film-rating';
import { tapSelection } from '@/haptics';

/**
 * ONE STAR, FULL, EMPTY OR HALF.
 *
 * Half is the empty star with the full one laid over it and cut down the
 * middle — no half-star glyph is in every system font. Both glyphs sit in a
 * box exactly `size` wide and are centred in it, so cutting the box at half
 * its width cuts the glyph at half ITS width, whatever the font draws.
 *
 * `start: 0`, not `left`: in Arabic the row runs right to left, and a half
 * star there is filled from the right.
 */
export function StarGlyph({ fill, size, on, off, lineHeight }: { fill: StarSlot; size: number; on: string; off: string; lineHeight?: number }) {
  const glyph = { fontSize: size, lineHeight, width: size, textAlign: 'center' as const };
  return (
    <View style={{ width: size }}>
      <Text style={[glyph, { color: fill === 'full' ? on : off }]}>★</Text>
      {fill === 'half' && (
        <View style={[s.half, { width: size / 2 }]}>
          <Text style={[glyph, { color: on }]}>★</Text>
        </View>
      )}
    </View>
  );
}

/** Five stars for a rating out of ten, for screens and cards that only show it. */
export function StarRow({ ten, size, on, off, gap = 0, lineHeight }: { ten: number | null; size: number; on: string; off: string; gap?: number; lineHeight?: number }) {
  return (
    <View style={[s.row, { gap }]}>
      {starSlots(ten).map((fill, i) => (
        <StarGlyph key={i} fill={fill} size={size} on={on} off={off} lineHeight={lineHeight} />
      ))}
    </View>
  );
}

/**
 * The film screen's rating control.
 *
 * `onTap(index)` and `onSlide(ten)` are kept apart because they mean
 * different things to the screen: a tap on the star already given takes the
 * rating back, and a slide that ends where it started does not.
 *
 * SCREEN READERS get one "adjustable" control instead of five buttons: swipe
 * up or down moves half a star (`stepFilmRating`), and the value is read as
 * "3.5 out of 5 stars" — `valueText` is the screen's, in the reader's language.
 */
export function FilmStarControl({
  value,
  size,
  on,
  off,
  style,
  cellStyle,
  label,
  valueText,
  onTap,
  onSlide,
  onPreview,
}: {
  /** out of ten, or null for unrated */
  value: number | null;
  size: number;
  on: string;
  off: string;
  style?: StyleProp<ViewStyle>;
  cellStyle?: StyleProp<ViewStyle>;
  label: string;
  valueText: string;
  onTap: (index: number) => void;
  onSlide: (ten: number | null) => void;
  /** the half star under the finger while sliding; null when the finger lifts */
  onPreview?: (ten: number | null) => void;
}) {
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState<number | null>(null);

  const show = (ten: number | null) => {
    setPreview(ten);
    onPreview?.(ten);
  };
  const at = (x: number) => filmRatingAt(x, width, I18nManager.isRTL);
  // one tick per half star crossed, not one per frame the finger moves
  const track = (x: number) => {
    const v = at(x);
    if (v === preview) return;
    tapSelection();
    show(v);
  };

  /*
   * SIDEWAYS ONLY. The screen around this is a vertical scroll and a swipe-down
   * to dismiss (`swipe-down.tsx` fails on 24 points of sideways travel), so a
   * slide here must start sideways and let a mostly vertical drag go — or
   * scrolling past the stars would rate the film.
   */
  const slide = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onStart((e) => track(e.x))
    .onUpdate((e) => track(e.x))
    // the value is where the finger LIFTED, read off the event rather than
    // kept from the last tick — a cancelled slide (`ok` false) commits nothing
    .onEnd((e, ok) => {
      if (ok) onSlide(at(e.x));
    })
    .onFinalize(() => show(null));

  /* A TAP THAT MOVED IS NOT A TAP — the same ten points as the show screen's scrubber. */
  const tap = Gesture.Tap()
    .runOnJS(true)
    .maxDistance(10)
    .onEnd((e, ok) => {
      if (!ok || !(width > 0)) return;
      const from = I18nManager.isRTL ? width - e.x : e.x;
      onTap(Math.max(0, Math.min(4, Math.floor((from / width) * 5))));
    });

  const shown = preview ?? value;
  return (
    <GestureDetector gesture={Gesture.Exclusive(slide, tap)}>
      <View
        style={style}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 10, now: value ?? 0, text: valueText }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const dir = e.nativeEvent.actionName === 'increment' ? 1 : e.nativeEvent.actionName === 'decrement' ? -1 : 0;
          if (dir !== 0) onSlide(stepFilmRating(value, dir));
        }}>
        {starSlots(shown).map((fill, i) => (
          // not pressable: the row's own gestures decide what a touch means
          <View key={i} style={cellStyle} pointerEvents="none">
            <StarGlyph fill={fill} size={size} on={on} off={off} />
          </View>
        ))}
      </View>
    </GestureDetector>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  half: { position: 'absolute', top: 0, bottom: 0, start: 0, overflow: 'hidden' },
});
