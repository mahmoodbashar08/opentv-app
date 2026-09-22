/**
 * A shelf of favourites as one picture.
 *
 * IT PICKS FOR YOU, AND THEN YOU CAN ARGUE WITH IT.
 *
 * The first version had no picker at all, reasoning that `favorites/[type]`
 * already has drag-to-reorder and `favoriteRank` already stores that order --
 * so the top four IS the first four, and asking again would be two orderings
 * that can disagree.
 *
 * That was wrong, and the reason is worth keeping. `favoriteRank` is
 * PERSISTENT CURATION: the order you keep. A share is AD HOC: these four, for
 * this post, today. They are not the same act. Somebody with fifty favourites
 * wanting to post a particular four would have had to drag them to the top of
 * a permanent list and then drag them back -- a worse chore than the picker
 * being avoided, and it damages the list to do it.
 *
 * So the rank still does the work nobody wants to repeat: the top N arrive
 * already chosen, and doing nothing gives a good card. Tapping is how you
 * disagree with it, and it costs the permanent order nothing.
 *
 * WHY THE COUNT IS NOT FREE EITHER. The output is a fixed rectangle, so a
 * count that does not tile leaves a hole: five posters is a row of three and a
 * row of two, and the gap reads as a missing image rather than a choice. Only
 * counts that fill their grid are offered — and that is a fact about pictures,
 * not a preference, which is why it is not a setting.
 *
 * Posters and no titles, deliberately. A title under each poster is six
 * translations, three truncation cases and a row of text competing with the
 * artwork it sits under. The posters already say what they are.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, PixelRatio, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import { getFavoriteMovies, getFavoriteShows } from '@/db';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { withLink } from '@/share-link';
import { colors, radius } from '@/theme';

const W = Math.min(Dimensions.get('window').width, 420);

/* The picture is 1080 wide; the preview is not. Same reasoning as the title
   share card — `captureRef` snapshots the view's own bounds at device scale,
   so the card is laid out at export size and only displayed small. */
const STORY_PX = 1080;
const EXPORT_W = Math.round(STORY_PX / PixelRatio.get());
const EXPORT_H = Math.round((EXPORT_W * 16) / 9);
const SCREEN_H = Dimensions.get('window').height;
// Smaller than the title card's: this screen also carries a picker, and a
// 9:16 preview plus a shelf of posters plus a button does not fit otherwise.
const PREVIEW_W = Math.round(Math.min(W - 150, 214, ((SCREEN_H - 430) * 9) / 16));
const PREVIEW_H = Math.round((PREVIEW_W * 16) / 9);
const PREVIEW_SCALE = PREVIEW_W / EXPORT_W;
const SF = EXPORT_W / 268;
const ss = (n: number) => Math.round(n * SF * 2) / 2;

/**
 * THE GRIDS THAT FILL THEMSELVES.
 *
 * Every entry is a count and the columns it lays out in, and every one of them
 * divides exactly — which is the whole list of counts worth offering. 2 and 3
 * are here because somebody with three favourites should still get a picture
 * rather than a message telling them to go and pick more.
 */
const GRIDS = [
  { n: 2, cols: 2 },
  { n: 3, cols: 3 },
  { n: 4, cols: 2 },
  { n: 6, cols: 3 },
  { n: 9, cols: 3 },
] as const;

const GAP = ss(10);

export default function ShareFavoritesScreen() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  const isShows = type === 'shows';
  const cardRef = useRef<View>(null);

  const items = useMemo(
    () =>
      isShows
        ? getFavoriteShows().map((s) => ({ key: String(s.tvdbId), poster: s.posterUrl, name: s.name }))
        : getFavoriteMovies().map((m) => ({ key: m.name, poster: m.poster, name: m.name })),
    [isShows],
  );

  /* Only the grids they can actually fill. Offering "9" to somebody with five
     favourites is offering a picture with four holes in it. */
  const options = GRIDS.filter((g) => g.n <= items.length);
  const [n, setN] = useState(() => (options.length ? options[options.length - 1].n : 0));
  const grid = options.find((g) => g.n === n) ?? options[options.length - 1];

  /* Keys in the order they were chosen -- the card draws them in this order, so
     the first one tapped is the top-left poster. Seeded from the shelf's own
     order, which is why doing nothing already produces the right card. */
  const [picked, setPicked] = useState<string[]>(() =>
    items.slice(0, options.length ? options[options.length - 1].n : 0).map((i) => i.key),
  );

  /* Changing the grid keeps what is already chosen and fills the rest from the
     shelf, so switching 4 to 9 does not throw away four taps. Shrinking trims
     the end, which is the half the reader was least attached to. */
  const setCount = useCallback(
    (next: number) => {
      setN(next);
      setPicked((prev) => {
        if (prev.length >= next) return prev.slice(0, next);
        const fill = items.map((i) => i.key).filter((k) => !prev.includes(k));
        return [...prev, ...fill.slice(0, next - prev.length)];
      });
    },
    [items],
  );

  const toggle = useCallback(
    (key: string) => {
      tapLight();
      setPicked((prev) => {
        if (prev.includes(key)) return prev.filter((k) => k !== key);
        if (prev.length >= n) return prev; // full: something has to come out first
        return [...prev, key];
      });
    },
    [n],
  );

  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const shown = picked.map((k) => byKey.get(k)).filter((x): x is (typeof items)[number] => !!x);
  const full = picked.length === n;

  /* The cell is derived from whichever axis runs out first, so a 3x3 and a
     2x2 both sit inside the same frame instead of a 3x3 overflowing it. */
  const cell = useMemo(() => {
    if (!grid) return { w: 0, h: 0 };
    const rows = Math.ceil(grid.n / grid.cols);
    // What the header and the floor actually occupy, measured rather than
    // guessed: padding 54 + kicker 15 + heading 24 with its 6/22 margins, and
    // the heading is allowed two lines. Below: the mark, the tagline and its
    // 26 of breathing room. Reserving more than that is what made a 3x3 of
    // postage stamps on a card with empty space above and below it.
    const availW = EXPORT_W - ss(28) * 2 - GAP * (grid.cols - 1);
    const availH = EXPORT_H - ss(155) - ss(60) - GAP * (rows - 1);
    const w = Math.min(availW / grid.cols, (availH / rows) * (2 / 3));
    return { w, h: (w * 3) / 2 };
  }, [grid]);

  const heading = isShows ? t('shareFavorites.headingShows') : t('shareFavorites.headingMovies');

  const share = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
      const uri = await captureRef(cardRef, { format: 'png', quality: 1, useRenderInContext: true });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sharing = require('expo-sharing') as typeof import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          UTI: 'public.png',
          dialogTitle: heading,
        });
        return;
      }
      await Share.share({ url: uri, message: withLink(heading) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('native module') || msg.includes('RNViewShot')) {
        Alert.alert(t('shareCard.buildNeededTitle'), t('shareCard.buildNeededBody'));
      } else {
        Alert.alert(t('shareCard.shareFailedTitle'), msg);
      }
    }
  };

  if (!grid) {
    return (
      <Screen>
        <NavHeader title={t('shareFavorites.title')} />
        <Text style={s.empty}>
          {isShows ? t('shareFavorites.emptyShows') : t('shareFavorites.emptyMovies')}
        </Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <NavHeader title={t('shareFavorites.title')} />
      <ScrollView
        contentContainerStyle={{ alignItems: 'center', gap: 14, paddingBottom: 28, paddingTop: 6 }}>
        {/* The count, and nothing else to decide. Hidden entirely when there is
            only one grid they can fill — a control with one option is furniture. */}
        {options.length > 1 && (
          <View style={s.counts}>
            {options.map((g) => (
              <Pressable
                key={g.n}
                style={[s.countTab, g.n === grid.n && s.countTabOn]}
                onPress={() => {
                  tapLight();
                  setCount(g.n);
                }}>
                <Text style={[s.countText, g.n === grid.n && { color: colors.onBrand }]}>{g.n}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={s.box}>
          <View style={s.scale}>
            <View ref={cardRef} collapsable={false} style={s.card}>
              <LinearGradient
                colors={['#16161A', '#08080A']}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />

              <Text style={s.kicker}>{t('shareFavorites.kicker')}</Text>
              <Text style={s.heading}>{heading}</Text>

              <View style={[s.grid, { width: cell.w * grid.cols + GAP * (grid.cols - 1) }]}>
                {shown.map((it) => (
                  <View key={it.key} style={[s.cell, { width: cell.w, height: cell.h }]}>
                    {it.poster ? (
                      <Image
                        source={{ uri: it.poster }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        cachePolicy="disk"
                      />
                    ) : (
                      <View style={[StyleSheet.absoluteFill, s.fallback]}>
                        <Text style={s.fallbackText} numberOfLines={3}>
                          {it.name}
                        </Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>

              <View style={s.brand}>
                <Image
                  source={require('@/assets/images/mark.png')}
                  style={s.mark}
                  contentFit="contain"
                />
                <Text style={s.brandText}>OPENTV</Text>
              </View>
              <Text style={s.tagline} numberOfLines={2}>
                {t('shareCard.openSourceTagline')}
              </Text>
            </View>
          </View>
        </View>

        {/*
          THE SHELF, and the numbers on it are the point.

          A tick would say "in", which is not enough: the card draws these in
          the order they were tapped, so the badge shows the POSITION. Somebody
          who wants a particular poster top-left can see how to get it without
          being told, and somebody who does not care never looks.

          Horizontal, because it sits under a 9:16 preview and a wrapping grid
          of every favourite would push the share button off the screen for
          anybody with more than a dozen.
        */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.shelf}
          style={{ alignSelf: 'stretch' }}>
          {items.map((it) => {
            const at = picked.indexOf(it.key);
            const on = at >= 0;
            return (
              <Pressable
                key={it.key}
                onPress={() => toggle(it.key)}
                // Full and not already in: tapping does nothing, so say so by
                // fading it rather than letting the tap fail silently.
                style={[s.pick, on && s.pickOn, !on && full && s.pickOff]}>
                {it.poster ? (
                  <Image source={{ uri: it.poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
                ) : (
                  <View style={[StyleSheet.absoluteFill, s.fallback]}>
                    <Text style={s.pickFallbackText} numberOfLines={3}>
                      {it.name}
                    </Text>
                  </View>
                )}
                {on && (
                  <View style={s.badge}>
                    <Text style={s.badgeText}>{at + 1}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={s.hint}>
          {full ? t('shareFavorites.hintFull') : t('shareFavorites.hintPick', { count: n - picked.length })}
        </Text>

        <Pressable
          style={[s.shareBtn, !picked.length && s.shareBtnOff]}
          disabled={!picked.length}
          onPress={() => void share()}>
          <Ionicons name="share-outline" size={18} color={colors.onBrand} />
          <Text style={s.shareText}>{t('shareFavorites.share')}</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  empty: { color: colors.dim, fontSize: 15, textAlign: 'center', marginTop: 60, paddingHorizontal: 32, lineHeight: 22 },

  counts: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.pill, padding: 3, gap: 2 },
  countTab: { minWidth: 42, alignItems: 'center', paddingVertical: 7, borderRadius: radius.pill },
  countTabOn: { backgroundColor: colors.brand },
  countText: { color: colors.dim, fontSize: 13, fontWeight: '700' },

  box: { width: PREVIEW_W, height: PREVIEW_H, borderRadius: 12, overflow: 'hidden' },
  scale: { transform: [{ scale: PREVIEW_SCALE }], transformOrigin: 'top left' },
  card: {
    width: EXPORT_W,
    height: EXPORT_H,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#08080A',
    alignItems: 'center',
    paddingTop: ss(54),
  },

  kicker: {
    color: colors.brand,
    fontSize: ss(11),
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heading: {
    color: '#FFFFFF',
    fontSize: ss(24),
    fontWeight: '900',
    letterSpacing: -0.3,
    marginTop: ss(6),
    marginBottom: ss(22),
    textAlign: 'center',
    paddingHorizontal: ss(24),
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, justifyContent: 'center' },
  cell: { borderRadius: ss(8), overflow: 'hidden', backgroundColor: '#1C1C1E' },
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#26262A', padding: ss(8) },
  fallbackText: { color: colors.brand, fontSize: ss(12), fontWeight: '800', textAlign: 'center' },

  // `marginTop: 'auto'` so the mark sits on the floor of the card whatever the
  // grid above it comes out as — a 2x2 and a 3x3 leave very different slack.
  brand: { flexDirection: 'row', alignItems: 'center', gap: ss(6), marginTop: 'auto' },
  mark: { width: ss(18), height: ss(18) },
  brandText: { color: '#FFFFFF', fontSize: ss(12), fontWeight: '900', letterSpacing: 0.8 },
  tagline: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: ss(10),
    fontWeight: '600',
    marginTop: ss(3),
    marginBottom: ss(26),
  },

  shelf: { flexDirection: 'row', gap: 8, paddingHorizontal: 18 },
  pick: {
    width: 58,
    height: 87,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: '#1C1C1E',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  pickOn: { borderColor: colors.brand },
  pickOff: { opacity: 0.35 },
  pickFallbackText: { color: colors.brand, fontSize: 10, fontWeight: '800', textAlign: 'center' },
  badge: {
    position: 'absolute',
    top: 3,
    insetInlineEnd: 3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.onBrand, fontSize: 11, fontWeight: '900' },
  hint: { color: colors.faint, fontSize: 12.5, textAlign: 'center', paddingHorizontal: 24 },

  shareBtnOff: { opacity: 0.4 },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.brand,
    paddingVertical: 13,
    paddingHorizontal: 30,
    borderRadius: radius.pill,
  },
  shareText: { color: colors.onBrand, fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
});
