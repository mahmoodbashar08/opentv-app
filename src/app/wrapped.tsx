/**
 * WRAPPED — a period of watching, as a tap-through you can share.
 *
 * MONTHLY, NOT JUST YEARLY, and that is the product decision this screen
 * exists to serve. A December-only recap is a subscribe-in-December,
 * cancel-in-January machine; twelve small moments a year is a reason to still
 * be here in March. Any past month and any past year work identically —
 * `?month=2026-07` or `?year=2025`.
 *
 * A QUIET PERIOD IS THE MAIN CASE, not the edge. The owner's own August 2025
 * holds one watch. A recap that answers that with six slides of zeroes, an
 * empty collage and "longest streak: 0 days" is the single most likely way
 * this feature embarrasses somebody. So `wrappedTooQuiet` stops the story
 * before it starts and offers another period, and `wrappedSlides` drops every
 * slide the period cannot honestly fill rather than showing it at zero.
 *
 * NOTHING LEAVES THE DEVICE. Every number here is computed from the phone's
 * own SQLite and its cached artwork, like the heatmap. The only thing that
 * ever goes anywhere is the closing card, and only when Share is tapped.
 *
 * FREE, DELIBERATELY, and it is the only Plus-era screen that is. Wrapped is
 * the one feature built to LEAVE the app: every card carries the app's name to
 * somebody who does not have it, and most of those people lost TV Time and are
 * still looking. Charging for it would be charging for the app's own
 * advertising. Plus is what you get for yourself; Wrapped is what you show
 * other people.
 */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState, type RefObject } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeInDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { PeriodSheet, periodLabel } from '@/components/period-picker';
import {
  WrappedActivity,
  WrappedBiggestDay,
  WrappedHeroShare,
  WrappedObsession,
  WrappedOpening,
  WrappedPersonality,
  WrappedScale,
  WrappedTaste,
  type CardProps,
} from '@/components/wrapped/cards';
import { NavHeader, Screen, useTopInset } from '@/components/ui';
import { getHandle } from '@/community-session';
import { getMeta } from '@/db';
import { tapLight } from '@/haptics';
import { usePlus } from '@/plus';
import { t } from '@/i18n';

import {
  periodBounds,
  shiftMonth,
  wrappedSlides,
  wrappedTooQuiet,
  type WrappedSlideId,
} from '@/pure';
import { computeWrapped, type Wrapped } from '@/stats-calc';
import { ACCENTS, colors, DEFAULT_ACCENT, onAccent, radius, space } from '@/theme';

/** How far the sheet must be dragged down before it leaves. */
const DISMISS_Y = 130;

/** The month that has just finished — what Wrapped means with no parameters. */
function lastCompleteMonth(): string {
  return shiftMonth(new Date().toISOString().slice(0, 7), -1);
}

export default function WrappedScreen() {
  const insets = useSafeAreaInsets();
  /**
   * BRAND YELLOW BY DEFAULT, THE PROFILE'S THEME FOR SUPPORTERS.
   *
   * Wrapped is free, and the cards it makes are the app's advertising — so the
   * default is deliberately OpenTV's own yellow rather than the reader's app
   * accent: a hundred shared cards in one colour is a brand, and the same
   * hundred in a hundred colours is noise.
   *
   * Plus paints them in the profile's theme instead, which is the honest
   * version of a paid cosmetic: the feature is free, making it YOURS is not.
   * `ACCENTS.yellow` and not `colors.yellow` — the latter is whatever accent
   * this phone is painted in, which is exactly what must not leak in here.
   */
  const plus = usePlus();
  const [themeColor] = useState(() => getMeta('profileThemeColor') || null);
  const [handle] = useState(() => getHandle());
  const [displayName] = useState(() => getMeta('profileDisplayName') || null);
  const accent = plus && themeColor != null ? themeColor : ACCENTS[DEFAULT_ACCENT];
  /**
   * Sized so the whole 9:16 card fits between the header and the button, on a
   * short phone as well as a tall one — width first, then clamped by height,
   * because a card taller than the screen is worse than a narrower one.
   */
  const params = useLocalSearchParams<{ demo?: string; month?: string; year?: string; slide?: string }>();
  const { width, height: screenH } = useWindowDimensions();
  /**
   * Sized so the whole 9:16 card fits between the header and the button, on a
   * short phone as well as a tall one — width first, then clamped by height,
   * because a card taller than the screen is worse than a narrower one.
   */
  const cardWidth = Math.min(width - space.lg * 2, (screenH - insets.top - insets.bottom - 210) * (9 / 16));

  // The requested period, or the month that just ended. A bad parameter falls
  // back rather than rendering a range nobody meant — this is user input.
  const [key, setKey] = useState(
    () => periodBounds(params.month ?? params.year ?? '')?.key ?? lastCompleteMonth(),
  );
  const period = periodBounds(key);

  /**
   * READ IN A CALLBACK, NOT IN RENDER. `computeWrapped` walks the watch table;
   * the React Compiler memoises a render-time read of an external store
   * against its arguments and the screen would keep showing the first period
   * it ever opened. State React sets is the invalidation it understands.
   */
  const [data, setData] = useState<Wrapped | null>(null);
  useFocusEffect(
    useCallback(() => {
      const p = periodBounds(key);
      if (!p) {
        setData(null);
        return;
      }
      setData(demoData(computeWrapped(p.start, p.end), __DEV__ ? params.demo : undefined));
    }, [key, params.demo]),
  );

  // `?slide=n` opens on a given card. Used by the capture rig that screenshots
  // every card from the simulator; harmless from anywhere else.
  const [index, setIndex] = useState(() => Math.max(0, Number(params.slide ?? 0) || 0));
  const [picking, setPicking] = useState(false);
  const cardRef = useRef<View>(null);
  const topInset = useTopInset();

  // Swipe down to dismiss. A plain pan, not `useSwipeDown` — that one is
  // driven by a ScrollView's overscroll, and this screen has no scroll for it
  // to read, so there is nothing here for the gesture to be confused with.
  const translateY = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetY(16)
    .failOffsetY(-16)
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_Y) runOnJS(router.back)();
      else translateY.value = withSpring(0);
    });
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  const label = period ? periodLabel(period.key) : '';
  const slides = data && !wrappedTooQuiet(data) ? wrappedSlides(data) : [];
  // While recording, the frame decides the slide; otherwise the reader's taps do.
  const shownIndex = index;
  const slide = slides[Math.min(shownIndex, slides.length - 1)];

  const go = (delta: number) => {
    tapLight();
    const next = index + delta;
    if (next < 0) return;
    if (next >= slides.length) {
      router.back();
      return;
    }
    setIndex(next);
  };


  const pick = (next: string) => {
    setPicking(false);
    setIndex(0);
    setKey(next);
  };


  // the beat before the focus effect has read the database — blank, never the
  // locked state, which would flash "pay me" at somebody who already has
  if (!data || !period) return <Screen><View style={{ flex: 1 }} /></Screen>;

  if (wrappedTooQuiet(data)) {
    const seen = data.episodes + data.films;
    return (
      <Screen>
        <NavHeader title={t('plus.wrapped.title')} close />
        <View style={s.locked}>
          <Text style={s.lockedTitle}>{t('plus.wrapped.quietTitle', { period: label })}</Text>
          <Text style={s.lockedBody}>
            {seen === 0 ? t('plus.wrapped.quietEmpty') : t('plus.wrapped.quietBody', { count: seen })}
          </Text>
          <Pressable
            style={s.cta}
            onPress={() => {
              tapLight();
              setPicking(true);
            }}>
            <Text style={s.ctaText}>{t('plus.wrapped.quietPick')}</Text>
          </Pressable>
        </View>
        <PeriodSheet visible={picking} onClose={() => setPicking(false)} onPick={pick} />
      </Screen>
    );
  }

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ flex: 1 }, sheetStyle]}>
        <Screen>
          {/* the segment bar: one segment per slide this period could fill */}
          <View style={s.segments}>
            {slides.map((id, i) => (
              <View key={id} style={[s.segment, i <= shownIndex && { backgroundColor: accent }]} />
            ))}
          </View>
          <NavHeader title={label} close />

          {/* The stage stops ABOVE the buttons rather than running under them.
              It is centred in what is left, so a short slide still sits in the
              middle of the space it actually has — while a tall one (a year's
              nine-poster collage) ends where the Share button begins instead
              of behind it. */}
          {/* The card is sized (`cardWidth`) to leave room for the Share button
              already. Padding the stage as well on the last slide pushed a
              fixed-height card off the bottom of the screen. */}
          <View style={s.stage}>
            {/* keyed on the slide, so every change replays the entering
                animation — entering only, which costs one animation per tap */}
            {/* NO ENTERING ANIMATION WHILE RECORDING, and this is what made the
                video look like a stack of cards. Frames advance in
                milliseconds, so Reanimated had not finished removing one slide
                before the next three mounted on top of it — every frame caught
                a pile mid-transition. A recorded frame must be one settled
                slide, so the animation belongs to reading, not to rendering. */}
            <Animated.View
              key={slide}
              entering={FadeInDown.duration(420)}
              style={s.stageInner}>
              {/* THE CARD IS THE WHOLE SHARE. `cardRef` wraps exactly the 9:16
                  canvas and nothing else — no segment bar, no buttons — so the
                  PNG is the card alone. */}
              <View ref={cardRef} collapsable={false}>
                <WrappedCard slide={slide} d={data} label={label} unit={period.key.length === 4 ? 'year' : 'month'} width={cardWidth} handle={handle} name={displayName} />
              </View>
            </Animated.View>
          </View>

          {/* Tap zones over the body, so the whole story area advances.
              RTL NEEDS NO CONDITIONAL HERE, and adding one breaks it: a `row`
              is reversed by React Native under `I18nManager.isRTL`, so the
              first child is already the START side (left in English, right in
              Arabic) and the second is already the END side. Back on start,
              forward on end, which is the reading direction in both. */}
          <View style={[s.taps, { top: topInset + 66 }]} pointerEvents="box-none">
            <Pressable style={s.tapHalf} onPress={() => go(-1)} />
            <Pressable style={s.tapHalf} onPress={() => go(1)} />
          </View>

          {/* AFTER the tap zones, so Share beats the story rather than being
              swallowed by "next slide" — it is the one control on this screen
              that a tap must not walk past. */}
          {/* SHARE ON EVERY SLIDE. Each one is a card in its own right, and the
              slide somebody wants to post is rarely the last one — "mostly
              comedy" starts more conversations than a poster wall. The video
              is the closing act, so it appears only there. */}

          {(
            <View style={[s.shareRow, { bottom: insets.bottom + 18 }]}>
              <Pressable style={[s.cta, { backgroundColor: accent }]} onPress={() => void shareCard(cardRef)}>
                <Text style={[s.ctaText, { color: onAccent(accent) }]}>{t('plus.wrapped.share')}</Text>
              </Pressable>
            </View>
          )}

          {/* While it renders, the screen IS the canvas — so it says what it is
              doing rather than looking frozen on a slide that keeps changing. */}
        </Screen>
      </Animated.View>
    </GestureDetector>
  );
}

/** The eight cards, one per slide id. Each owns its composition — see cards.tsx. */
function WrappedCard({ slide, ...p }: CardProps & { slide: WrappedSlideId | undefined }) {
  switch (slide) {
    case 'hook':
      return <WrappedOpening {...p} />;
    case 'scale':
      return <WrappedScale {...p} />;
    case 'obsession':
      return <WrappedObsession {...p} />;
    case 'taste':
      return <WrappedTaste {...p} />;
    case 'personality':
      return <WrappedPersonality {...p} />;
    case 'biggestDay':
      return <WrappedBiggestDay {...p} />;
    case 'activity':
      return <WrappedActivity {...p} />;
    case 'hero':
      return <WrappedHeroShare {...p} />;
    default:
      return null;
  }
}

/**
 * DEV ONLY: `wrapped?month=…&demo=<mode>` bends real data into the shapes
 * the cards must survive — one title, two titles, a long name, no artwork,
 * a huge year, a thin month, February. Compiled out of release builds.
 */
function demoData(d: Wrapped, mode: string | undefined): Wrapped {
  if (!__DEV__ || !mode) return d;
  const first = d.topShows[0];
  switch (mode) {
    case 'one':
      return { ...d, topShows: d.topShows.slice(0, 1) };
    case 'two':
      return { ...d, topShows: d.topShows.slice(0, 2) };
    case 'long':
      return first
        ? { ...d, topShows: [{ ...first, name: 'The Haunting of Hill House' }, ...d.topShows.slice(1)], topGenres: [{ name: 'Science Fiction', minutes: 1 }, ...d.topGenres.slice(1)] }
        : d;
    case 'noart':
      return { ...d, topShows: d.topShows.map((s) => ({ ...s, backdrop: null })) };
    case 'noposter':
      return { ...d, topShows: d.topShows.map((s) => ({ ...s, poster: null })) };
    case 'huge':
      return { ...d, minutes: 1234 * 60, episodes: 1480, films: 112, biggestDay: { ...d.biggestDay, count: 124 } };
    case 'low':
      return { ...d, topShows: d.topShows.slice(0, 1), minutes: 95, episodes: 4, films: 1, activeDays: 2, longestStreak: 1, biggestDay: { ...d.biggestDay, count: 1 }, days: d.days.map((x, i) => ({ ...x, count: i === 3 || i === 17 ? 1 : 0 })) };
    case 'feb':
      return { ...d, days: Array.from({ length: 28 }, (_, i) => ({ date: `2026-02-${String(i + 1).padStart(2, '0')}`, count: i % 3 === 0 ? 2 : 0 })), totalDays: 28, activeDays: 10 };
    default:
      return d;
  }
}

/** The closing card, as a PNG, through the same view-shot + Share path the
 *  Deep Stats card already uses. No new dependency, and both cards fail the
 *  same way on a build whose native module predates them. */
async function shareCard(cardRef: RefObject<View | null>): Promise<void> {
  tapLight();
  try {
    // lazy-load: both need the native module from the latest build
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
    const uri = await captureRef(cardRef, { format: 'png', quality: 1 });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sharing = require('expo-sharing') as typeof import('expo-sharing');
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        UTI: 'public.png',
        dialogTitle: t('plus.wrapped.shareTitle'),
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('native module') || msg.includes('RNViewShot')) {
      Alert.alert(t('shareCard.buildNeededTitle'), t('shareCard.buildNeededBody'));
    } else {
      Alert.alert(t('shareCard.shareFailedTitle'), msg);
    }
  }
}

const s = StyleSheet.create({
  segments: { flexDirection: 'row', gap: 4, paddingHorizontal: space.lg, paddingTop: 6 },
  segment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.line },
  /**
   * TOP-ALIGNED, NOT CENTRED. Centring in the space under the header looks
   * right in a mockup and sits too low on a real phone: the share row eats the
   * bottom, so the free space is not symmetrical and the card drifts down into
   * it. Pinned near the header instead, with the slack left underneath where
   * the controls already are.
   */
  stage: { flex: 1, justifyContent: 'flex-start', paddingTop: 4, paddingHorizontal: space.lg },
  stageInner: { alignItems: 'center', gap: 10 },
  // BELOW THE HEADER (status inset + segment bar 9pt + NavHeader 54pt; the
  // inset is added inline). `Screen` pads for the status bar, but absolute
  // children ignore padding, so a plain 66 started ABOVE the header on a real
  // phone and "next slide" sat on top of the close chevron.
  taps: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', zIndex: 1 },
  tapHalf: { flex: 1 },
  // BIG, because the number IS the slide. Wrapped's whole trick is that a
  // statistic set at headline size stops reading as a statistic.
  kicker: { color: colors.yellow, fontSize: 13, fontWeight: '900', letterSpacing: 1.6, textTransform: 'uppercase' },
  huge: { color: colors.text, fontSize: 54, fontWeight: '900', textAlign: 'center', lineHeight: 58, letterSpacing: -1.5 },
  big: { color: colors.text, fontSize: 42, fontWeight: '900', textAlign: 'center', lineHeight: 46, letterSpacing: -1 },
  sub: { color: colors.dim, fontSize: 16.5, textAlign: 'center', lineHeight: 23 },
  hero: { width: 150, height: 225, borderRadius: 10, backgroundColor: colors.raise, marginVertical: 8 },
  card: {
    borderRadius: 24,
    paddingVertical: 26,
    paddingHorizontal: 20,
    overflow: 'hidden',
    justifyContent: 'space-between',
    // A hairline of the card's own light, so the edge reads against a black
    // screen instead of dissolving into it. Shared cards land on other
    // people's feeds, where that edge is the whole silhouette.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  cardHead: {
    alignItems: 'center',
    gap: 5,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.09)',
  },
  cardBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  cardKicker: { color: colors.yellow, fontSize: 10, fontWeight: '900', letterSpacing: 2.4 },
  // TIGHTER AND LARGER. The period is the card's title and was competing with
  // the figure below it at the same weight and nearly the same size; pulling
  // the tracking in and the size up makes it read as a masthead instead.
  cardPeriod: { color: colors.text, fontSize: 27, fontWeight: '900', letterSpacing: -0.6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  // Room above it: the summary sat against the poster wall with nothing
  // between them, so the collage and its caption read as one crowded block.
  cardLine: { color: colors.dim, fontSize: 13.5, fontWeight: '600', textAlign: 'center', marginTop: 8 },
  /**
   * BLED TO THE CARD'S EDGES, and the numbers must match the card's padding
   * exactly — they were -18 against a padding that became 26/20 when the card
   * went story-shaped, so a strip of card showed underneath with square
   * corners against the rounded ones. The bottom radius matches the card's, or
   * the bar cuts the corners off from the inside.
   */
  cardBrand: {
    alignSelf: 'stretch',
    marginHorizontal: -20,
    marginBottom: -26,
    marginTop: 14,
    backgroundColor: '#0D0D0F',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardBrandLeft: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  cardBrandDot: { width: 7, height: 7, borderRadius: 2 },
  cardBrandText: { color: colors.text, fontSize: 11.5, fontWeight: '800', letterSpacing: 1.2 },
  cardBrandSub: { color: '#C9C9CF', fontSize: 10 },
  locked: { padding: space.lg, gap: 10, alignItems: 'center', marginTop: 40 },
  lockedTitle: { color: colors.text, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  lockedBody: { color: colors.dim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  /**
   * ABSOLUTE AND ABOVE THE TAP ZONES, both of which it needs.
   *
   * `taps` is an absolute overlay reaching `bottom: 0` at zIndex 1, so a share
   * row left in normal flow sits UNDER it and every press becomes "next
   * slide". It also has to clear the home indicator, or the button is half
   * off the bottom of the screen and cannot be hit at all.
   */
  trackRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    zIndex: 2,
  },
  trackChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  trackText: { color: colors.dim, fontSize: 12, fontWeight: '700' },
  shareRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  videoBtn: { backgroundColor: colors.raise },
  rendering: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    zIndex: 3,
  },
  renderingTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  renderBarTrack: { width: 200, height: 4, borderRadius: 2, backgroundColor: colors.raise, overflow: 'hidden' },
  renderBarFill: { height: 4, borderRadius: 2 },
  shareBtn: { position: 'absolute', bottom: 34, alignSelf: 'center', zIndex: 2 },
  cta: { marginTop: 8, backgroundColor: colors.yellow, borderRadius: radius.pill, paddingHorizontal: 26, paddingVertical: 12 },
  ctaText: { color: colors.onYellow, fontWeight: '800', fontSize: 14, letterSpacing: 0.8 },
});
