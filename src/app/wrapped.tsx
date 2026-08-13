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
 * The gate is asked twice, as everywhere in Plus: `requirePlus` on the rows
 * that open it, `usePlus()` here so a deep link cannot walk in behind it.
 */
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState, type RefObject } from 'react';
import { RecordingView, useViewRecorder } from 'react-native-view-recorder';
import { Alert, Pressable, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeInDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { PeriodSheet, periodLabel } from '@/components/period-picker';
import { NavHeader, Screen } from '@/components/ui';
import { getHandle } from '@/community-session';
import { track } from '@/analytics';
import { tapLight } from '@/haptics';
import { frameToSlide, totalFrames, VIDEO_FPS, videoPath } from '@/wrapped-video';
import { currentLocale, t } from '@/i18n';
import { formatCount } from '@/locale-resolve';
import { isPlus, requirePlus, usePlus } from '@/plus';
import { periodBounds, shiftMonth, wrappedSlides, wrappedTooQuiet, type WrappedSlideId } from '@/pure';
import { computeWrapped, type Wrapped } from '@/stats-calc';
import { colors, radius, space } from '@/theme';

/** How far the sheet must be dragged down before it leaves. */
const DISMISS_Y = 130;

/** The month that has just finished — what Wrapped means with no parameters. */
function lastCompleteMonth(): string {
  return shiftMonth(new Date().toISOString().slice(0, 7), -1);
}

export default function WrappedScreen() {
  const plus = usePlus();
  const params = useLocalSearchParams<{ month?: string; year?: string }>();
  const { width } = useWindowDimensions();

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
      if (!isPlus() || !p) {
        setData(null);
        return;
      }
      setData(computeWrapped(p.start, p.end));
    }, [key]),
  );

  const [index, setIndex] = useState(0);
  const [picking, setPicking] = useState(false);
  /**
   * MAKING THE VIDEO, and why the screen has to be driven rather than filmed.
   *
   * `recording` swaps the stage into a frame-driven mode: `onFrame` sets
   * `videoFrame` and awaits the paint, so the encoder takes the exact moment it
   * asked for. Screen-recording instead would run at whatever speed this
   * particular phone managed and drop frames on a slow one.
   */
  const recorder = useViewRecorder();
  const [recording, setRecording] = useState(false);
  const [videoFrame, setVideoFrame] = useState(0);
  const cardRef = useRef<View>(null);

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
  const shownIndex = recording ? frameToSlide(videoFrame, slides.length).slide : index;
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

  /**
   * Render the recap to an MP4 and hand it to the share sheet.
   *
   * The await inside `onFrame` is the load-bearing line: it gives React a
   * chance to paint the slide this video frame belongs to before the encoder
   * reads the view. Without it the encoder races the renderer and the video
   * comes out different on every phone.
   */
  const makeVideo = async () => {
    if (recording || data == null || slides.length === 0) return;
    tapLight();
    setRecording(true);
    setVideoFrame(0);
    try {
      const file = await recorder.record({
        output: videoPath(label),
        fps: VIDEO_FPS,
        totalFrames: totalFrames(slides.length),
        codec: 'h264',
        onFrame: async ({ frameIndex }: { frameIndex: number }) => {
          setVideoFrame(frameIndex);
          await new Promise((r) => requestAnimationFrame(() => r(null)));
        },
      });
      await Share.share({ url: file.startsWith('file://') ? file : `file://${file}` });
      track('wrapped_video');
    } catch {
      Alert.alert(t('plus.wrapped.videoFailedTitle'), t('plus.wrapped.videoFailedBody'));
    } finally {
      setRecording(false);
    }
  };

  const pick = (next: string) => {
    setPicking(false);
    setIndex(0);
    setKey(next);
  };

  if (!plus) {
    return (
      <Screen>
        <NavHeader title={t('plus.wrapped.title')} close />
        <View style={s.locked}>
          <Text style={s.lockedTitle}>{t('plus.wrapped.lockedTitle')}</Text>
          <Text style={s.lockedBody}>{t('plus.wrapped.lockedBody')}</Text>
          <Pressable
            style={s.cta}
            onPress={() => {
              tapLight();
              requirePlus('wrapped');
            }}>
            <Text style={s.ctaText}>{t('plus.settingsRow')}</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

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
              <View key={id} style={[s.segment, i <= shownIndex && { backgroundColor: colors.yellow }]} />
            ))}
          </View>
          <NavHeader title={label} close />

          <RecordingView sessionId={recorder.sessionId} style={s.stage}>
            {/* keyed on the slide, so every change replays the entering
                animation — entering only, which costs one animation per tap */}
            <Animated.View key={slide} entering={FadeInDown.duration(420)} style={s.stageInner}>
              <SlideCard label={label} cardRef={cardRef}>
                <SlideBody slide={slide} d={data} label={label} width={width} />
              </SlideCard>
            </Animated.View>
          </RecordingView>

          {/* Tap zones over the body, so the whole story area advances.
              RTL NEEDS NO CONDITIONAL HERE, and adding one breaks it: a `row`
              is reversed by React Native under `I18nManager.isRTL`, so the
              first child is already the START side (left in English, right in
              Arabic) and the second is already the END side. Back on start,
              forward on end, which is the reading direction in both. */}
          <View style={s.taps} pointerEvents="box-none">
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
          {!recording && (
            <View style={s.shareRow}>
              <Pressable style={s.cta} onPress={() => void shareCard(cardRef)}>
                <Text style={s.ctaText}>{t('plus.wrapped.share')}</Text>
              </Pressable>
              {slide === 'collage' && (
                <Pressable style={[s.cta, s.videoBtn]} onPress={() => void makeVideo()}>
                  <Text style={[s.ctaText, { color: colors.text }]}>{t('plus.wrapped.video')}</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* While it renders, the screen IS the canvas — so it says what it is
              doing rather than looking frozen on a slide that keeps changing. */}
          {recording && (
            <View style={s.recording} pointerEvents="none">
              <Text style={s.recordingText}>
                {t('plus.wrapped.rendering', {
                  percent: Math.round((videoFrame / Math.max(1, totalFrames(slides.length))) * 100),
                })}
              </Text>
            </View>
          )}
        </Screen>
      </Animated.View>
    </GestureDetector>
  );
}

/** One fact, in large type. */
function SlideBody({
  slide,
  d,
  label,
  width,
}: {
  slide: WrappedSlideId | undefined;
  d: Wrapped;
  label: string;
  width: number;
}) {
  const locale = currentLocale();
  const n = (v: number) => formatCount(v, locale);

  switch (slide) {
    case 'opening':
      return (
        <>
          <Text style={s.kicker}>{t('plus.wrapped.closingKicker')}</Text>
          <Text style={s.huge}>{t('plus.wrapped.openingTitle', { period: label })}</Text>
          <Text style={s.sub}>{t('plus.wrapped.openingSub')}</Text>
        </>
      );

    case 'time': {
      // under an hour the hours line would read "0 hours watched", which is a
      // lie about a period that did have something in it
      const hours = Math.round(d.minutes / 60);
      return (
        <>
          <Text style={s.big}>
            {hours >= 1
              ? t('plus.wrapped.hoursBig', { count: hours })
              : t('plus.wrapped.minutesBig', { count: d.minutes })}
          </Text>
          <Text style={s.sub}>{t('plus.wrapped.timeSub')}</Text>
        </>
      );
    }

    case 'counts':
      return (
        <>
          {/* Each line only when it has something in it: a month of nothing
              but films must not open on "0 episodes". */}
          {d.episodes > 0 && <Text style={s.big}>{t('plus.wrapped.episodesBig', { count: d.episodes })}</Text>}
          {d.films > 0 && <Text style={s.big}>{t('plus.wrapped.filmsBig', { count: d.films })}</Text>}
          {d.newShows > 0 && <Text style={s.sub}>{t('plus.wrapped.newShowsSub', { count: d.newShows })}</Text>}
          {d.averageRating != null && (
            <Text style={s.sub}>{t('plus.wrapped.ratingSub', { stars: d.averageRating })}</Text>
          )}
        </>
      );

    case 'topShow': {
      const top = d.topShows[0];
      return (
        <>
          <Text style={s.kicker}>{t('plus.wrapped.topShowKicker')}</Text>
          {top.poster != null && <Image source={{ uri: top.poster }} style={s.hero} contentFit="cover" cachePolicy="disk" />}
          <Text style={s.big}>{top.name}</Text>
          <Text style={s.sub}>{t('plus.wrapped.topShowSub', { count: top.episodes })}</Text>
        </>
      );
    }

    case 'topGenre':
      return (
        <>
          <Text style={s.kicker}>{t('plus.wrapped.topGenreKicker')}</Text>
          <Text style={s.huge}>{d.topGenres[0].name}</Text>
          {d.topDecade != null && <Text style={s.sub}>{t('plus.wrapped.topDecadeSub', { decade: d.topDecade })}</Text>}
        </>
      );

    case 'biggestDay':
      return (
        <>
          <Text style={s.kicker}>{t('plus.wrapped.biggestDayKicker')}</Text>
          <Text style={s.huge}>
            {new Date(`${d.biggestDay.date}T00:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long' })}
          </Text>
          <Text style={s.sub}>{t('plus.wrapped.biggestDaySub', { count: d.biggestDay.count })}</Text>
        </>
      );

    case 'streak':
      return (
        <>
          <Text style={s.kicker}>{t('plus.wrapped.streakKicker')}</Text>
          <Text style={s.big}>{t('plus.wrapped.streakDays', { count: d.longestStreak })}</Text>
          <Text style={s.sub}>{t('plus.wrapped.activeDaysSub', { count: d.activeDays })}</Text>
        </>
      );

    case 'collage':
      return <ClosingCard d={d} label={label} width={width} n={n} />;

    default:
      return null;
  }
}

/**
 * THE CARD EVERY SLIDE SITS IN, and why it is not just the closing one.
 *
 * Any slide is worth sharing — "mostly comedy this month" is a better post
 * than a poster wall, and it is the one somebody actually wants to argue with.
 * So the chrome that made the closing card shareable — the kicker, the period,
 * the app name and the handle — belongs around every slide instead of around
 * one, and the Share button follows it.
 *
 * It carries the app name because a card works as a SCREENSHOT on somebody
 * else's timeline, and a beautiful card with no name on it is somebody else's
 * product.
 */
function SlideCard({
  label,
  cardRef,
  children,
}: {
  label: string;
  cardRef: RefObject<View | null>;
  children: React.ReactNode;
}) {
  const [handle] = useState(() => getHandle());
  return (
    <View ref={cardRef} collapsable={false} style={s.card}>
      <Text style={s.cardKicker}>{t('plus.wrapped.closingKicker')}</Text>
      <Text style={s.cardPeriod}>{label}</Text>
      {children}
      <View style={s.cardBrand}>
        <Text style={s.cardBrandText}>OPENTV</Text>
        <Text style={s.cardBrandSub}>{handle != null ? `@${handle}` : t('plus.stats.cardTagline')}</Text>
      </View>
    </View>
  );
}

/** The closing slide's contents: the poster wall and the one-line summary. */
function ClosingCard({
  d,
  label,
  width,
  n,
}: {
  d: Wrapped;
  label: string;
  width: number;
  n: (v: number) => string;
}) {
  // three across, whatever the screen — a collage that reflows is a collage
  // that does not look the same in the shared image as it did on screen
  const tile = Math.min(Math.floor((width - space.lg * 2 - 12) / 3), 110);
  const posters = d.posters.slice(0, 9);

  return (
    <Animated.View entering={FadeIn.duration(400)} style={{ alignItems: 'center' }}>
      <>
        <View style={[s.grid, { width: tile * 3 + 12 }]}>
          {posters.map((uri) => (
            <Image key={uri} source={{ uri }} style={{ width: tile, height: tile * 1.5, borderRadius: 5 }} contentFit="cover" cachePolicy="disk" />
          ))}
        </View>
        <Text style={s.cardLine}>
          {[
            d.episodes > 0 ? t('plus.wrapped.episodesBig', { count: d.episodes }) : null,
            d.films > 0 ? t('plus.wrapped.filmsBig', { count: d.films }) : null,
            `${n(Math.round(d.minutes / 60))}h`,
          ]
            .filter((part) => part != null)
            .join(' · ')}
        </Text>
      </>
    </Animated.View>
  );
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
  stage: { flex: 1, justifyContent: 'center', paddingHorizontal: space.lg },
  stageInner: { alignItems: 'center', gap: 10 },
  // BELOW THE HEADER (segment bar 9pt + NavHeader 54pt). Covering it would
  // put "next slide" on top of the close button, and the only way out of the
  // story would be the swipe.
  taps: { position: 'absolute', top: 66, bottom: 0, left: 0, right: 0, flexDirection: 'row', zIndex: 1 },
  tapHalf: { flex: 1 },
  kicker: { color: colors.yellow, fontSize: 12, fontWeight: '900', letterSpacing: 1.4, textTransform: 'uppercase' },
  huge: { color: colors.text, fontSize: 40, fontWeight: '900', textAlign: 'center', lineHeight: 46 },
  big: { color: colors.text, fontSize: 30, fontWeight: '900', textAlign: 'center', lineHeight: 36 },
  sub: { color: colors.dim, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  hero: { width: 120, height: 180, borderRadius: 8, backgroundColor: colors.raise, marginVertical: 6 },
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 18, alignItems: 'center', gap: 12, overflow: 'hidden' },
  cardKicker: { color: colors.yellow, fontSize: 10.5, fontWeight: '900', letterSpacing: 1.4 },
  cardPeriod: { color: colors.text, fontSize: 24, fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  cardLine: { color: colors.dim, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  cardBrand: {
    alignSelf: 'stretch',
    margin: -18,
    marginTop: 4,
    backgroundColor: '#0D0D0F',
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardBrandText: { color: colors.text, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.8 },
  cardBrandSub: { color: '#C9C9CF', fontSize: 10 },
  locked: { padding: space.lg, gap: 10, alignItems: 'center', marginTop: 40 },
  lockedTitle: { color: colors.text, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  lockedBody: { color: colors.dim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  shareRow: { flexDirection: 'row', gap: 10, alignSelf: 'center', alignItems: 'center' },
  videoBtn: { backgroundColor: colors.raise },
  recording: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' },
  recordingText: { color: colors.dim, fontSize: 14, fontWeight: '700' },
  shareBtn: { position: 'absolute', bottom: 34, alignSelf: 'center', zIndex: 2 },
  cta: { marginTop: 8, backgroundColor: colors.yellow, borderRadius: radius.pill, paddingHorizontal: 26, paddingVertical: 12 },
  ctaText: { color: colors.onYellow, fontWeight: '800', fontSize: 14, letterSpacing: 0.8 },
});
