import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Dimensions, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import { getEpisodeVote, getMovie, getShowBrief } from '@/db';
import { episodeMeta, showMeta } from '@/metadata';
import { colors, radius } from '@/theme';
import { t } from '@/i18n';
import { withLink } from '@/share-link';

// A share card is captured as an IMAGE, so a fixed size is correct — it should
// not reflow with orientation. Clamped so a tablet (or a landscape launch)
// doesn't render an enormous card: every type size derives from CARD_W via F.
const W = Math.min(Dimensions.get('window').width, 420);
const CARD_W = W - 32;
const CARD_H = Math.round(CARD_W * 0.62);
const BRAND_H = 34;
/**
 * THE STORY SHAPE, and why it is a second layout rather than a taller card.
 *
 * A Story is 9:16 and the card is 1:0.62 — stretching one into the other gives
 * a letterboxed landscape ticket floating in a sea of background, which is
 * what every app that "supports Stories" by resizing produces. So the story is
 * its own composition: the poster IS the picture, full bleed, with the words
 * over the foot of it. That is the idiom of the format, and it is also the
 * only version worth anybody posting.
 *
 * Narrower than the card on purpose. At 9:16 a 300pt width is a 533pt image,
 * which does not fit above a share button on a phone; the preview is scaled to
 * fit the screen and `captureRef` renders it at device pixel density, so the
 * exported picture is full resolution regardless of how small it looks here.
 */
const STORY_W = Math.min(W - 120, 268);
const STORY_H = Math.round((STORY_W * 16) / 9);
const SF = STORY_W / 268;
const ss = (n: number) => Math.round(n * SF * 2) / 2;
/** The scrim over the foot of the poster. Bands rather than a gradient
 *  library: `profile-template` already draws its ramps this way, and one more
 *  dependency for one screen is not a trade worth making. */
const SCRIM_STEPS = 24;
/** How dark the floor under the words is, and the value the fade above it
 *  ends on. Not 1: a sliver of poster showing through keeps it a picture
 *  rather than a caption box stuck to the bottom. */
const FLOOR_A = 0.93;
// scale type against a 358pt reference card so proportions hold on any phone
const F = CARD_W / 358;
const fs = (n: number) => Math.round(n * F * 2) / 2;

const pad = (n: number) => String(n).padStart(2, '0');

export default function ShareCardScreen() {
  const { type, id, season, episode, name } = useLocalSearchParams<{
    type?: string;
    id?: string;
    season?: string;
    episode?: string;
    name?: string;
  }>();
  const cardRef = useRef<View>(null);

  const isMovie = type === 'movie';
  const isEpisode = type === 'episode';
  const tvdbId = Number(id) || 0;
  const s = Number(season) || 0;
  const e = Number(episode) || 0;

  // movies are keyed by name; shows/episodes by tvdbId
  const movie = isMovie && name ? getMovie(decodeURIComponent(name)) : null;
  const brief = !isMovie ? getShowBrief(tvdbId) : null;
  const meta = !isMovie ? showMeta(tvdbId) : undefined;
  const em = isEpisode ? episodeMeta(tvdbId, s, e) : undefined;

  // `title` not `name`: a card somebody posts is the LEAST forgiving place to
  // print a title the reader cannot read, and `getMovie` has already chosen.
  const displayName = isMovie
    ? (movie?.title ?? t('shareCard.untitled'))
    : (brief?.name ?? meta?.name ?? t('shareCard.untitled'));
  const poster = isMovie ? (movie?.poster ?? null) : (brief?.poster ?? meta?.poster ?? null);

  const stars = isMovie ? (movie?.stars ?? 0) : isEpisode ? (getEpisodeVote(tvdbId, s, e).stars ?? 0) : 0;
  const canRate = isMovie || isEpisode;

  const trackedLabel = isMovie
    ? movie?.watchedAt
      ? t('shareCard.watched')
      : t('shareCard.watchlist')
    : isEpisode
      ? t('shareCard.watched')
      : t('shareCard.tracked');

  const subtitle = isMovie
    ? (movie?.year ?? '')
    : isEpisode
      ? `S${pad(s)} | E${pad(e)}`
      : [meta?.totalSeasons ? t('show.seasonsCount', { count: meta.totalSeasons }) : null, meta?.network]
          .filter(Boolean)
          .join(' · ');

  const share = async () => {
    try {
      // lazy-load: needs the native module from the latest build
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
      const uri = await captureRef(cardRef, { format: 'png', quality: 1 });
      // share the FILE via expo-sharing so it lands as an image on both platforms
      // (RN's Share only attaches `url` on iOS)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sharing = require('expo-sharing') as typeof import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          UTI: 'public.png',
          dialogTitle: t('shareCard.dialogTitle', { name: displayName }),
        });
        return;
      }
      await Share.share({ url: uri, message: withLink(t('shareCard.shareMessage', { name: displayName })) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('native module') || msg.includes('RNViewShot')) {
        Alert.alert(t('shareCard.buildNeededTitle'), t('shareCard.buildNeededBody'));
      } else {
        Alert.alert(t('shareCard.shareFailedTitle'), msg);
      }
    }
  };

  /** Which shape to capture. Two layouts, one ref — whichever is on screen is
   *  what `captureRef` takes, so the share button needs to know nothing. */
  const [shape, setShape] = useState<'card' | 'story'>('card');

  const shareTitle = isMovie ? t('shareCard.shareMovieTitle') : isEpisode ? t('shareCard.shareEpisodeTitle') : t('shareCard.shareShowTitle');

  return (
    <Screen>
      <NavHeader title={shareTitle} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <View style={styles.shapes}>
          {(['card', 'story'] as const).map((k) => (
            <Pressable
              key={k}
              style={[styles.shapeTab, shape === k && styles.shapeTabOn]}
              onPress={() => setShape(k)}>
              <Ionicons
                name={k === 'card' ? 'tablet-landscape-outline' : 'phone-portrait-outline'}
                size={15}
                color={shape === k ? colors.onBrand : colors.dim}
              />
              <Text style={[styles.shapeText, shape === k && { color: colors.onBrand }]}>
                {t(k === 'card' ? 'shareCard.shapeCard' : 'shareCard.shapeStory')}
              </Text>
            </Pressable>
          ))}
        </View>

        {shape === 'story' ? (
          <View ref={cardRef} collapsable={false} style={styles.story}>
            {poster ? (
              <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.posterFallback]}>
                <Text style={{ color: colors.brand, fontSize: ss(64), fontWeight: '900' }}>
                  {displayName[0]?.toUpperCase()}
                </Text>
              </View>
            )}

            {/* THE FADE RUNS OUT BEFORE THE WORDS START, and that is the whole
                point of splitting it from the floor below.
                The first version was one absolutely-positioned scrim over the
                bottom 62%, squared — which meant that where the text actually
                begins, about 39% into it, the alpha was 0.39² ≈ 0.15. Fifteen
                per cent. The curve held the poster beautifully and then did its
                darkening AFTER the words had already been drawn, so a bright
                poster — Spider-Man's own title art, as it turned out — read
                straight through them.
                Now the fade is a sibling that ends where the text begins, and
                the text sits on a solid floor. No arithmetic to get wrong: the
                words are always on `FLOOR`, whatever the poster does. */}
            <View style={styles.fade} pointerEvents="none">
              {Array.from({ length: SCRIM_STEPS }, (_, i) => (
                <View
                  key={i}
                  style={{
                    flex: 1,
                    // Squared still, so the poster holds and then lets go —
                    // but across the fade ONLY, reaching the floor's own alpha
                    // exactly where the floor starts, so there is no seam.
                    backgroundColor: `rgba(8,8,10,${(((i + 1) / SCRIM_STEPS) ** 2 * FLOOR_A).toFixed(3)})`,
                  }}
                />
              ))}
            </View>

            <View style={styles.storyFoot}>
              <View style={styles.storyTracked}>
                <Ionicons name="checkmark-circle" size={ss(13)} color={colors.brand} />
                <Text style={styles.storyTrackedText}>{trackedLabel}</Text>
              </View>
              <Text style={styles.storyName} numberOfLines={3}>
                {displayName}
              </Text>
              {!!subtitle && <Text style={styles.storySub}>{subtitle}</Text>}
              {canRate && stars > 0 && (
                <View style={{ flexDirection: 'row', marginTop: ss(6) }}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Text key={i} style={{ fontSize: ss(20), color: i <= stars ? colors.brand : 'rgba(255,255,255,0.25)' }}>
                      ★
                    </Text>
                  ))}
                </View>
              )}
              <View style={styles.storyBrand}>
                <Image source={require('@/assets/images/mark.png')} style={styles.storyBadge} contentFit="contain" />
                <Text style={styles.storyBrandText}>OPENTV</Text>
                <Text style={styles.storyBrandCta}>{t('shareCard.openSourceTagline')}</Text>
              </View>
            </View>
          </View>
        ) : (
        <View ref={cardRef} collapsable={false} style={styles.card}>
          {/* poster left */}
          <View style={styles.left}>
            {poster ? (
              <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.posterFallback]}>
                <Text style={{ color: colors.brand, fontSize: fs(30), fontWeight: '900' }}>
                  {displayName[0]?.toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          {/* yellow panel right */}
          <View style={styles.right}>
            <View style={styles.trackedRow}>
              <Ionicons name="checkmark-circle" size={fs(15)} color="#141414" />
              <Text style={styles.tracked}>{trackedLabel}</Text>
            </View>
            <Text style={styles.name} numberOfLines={2}>
              {displayName}
            </Text>
            {!!subtitle && <Text style={styles.sub}>{subtitle}</Text>}
            <View style={styles.dash} />

            {canRate && stars > 0 ? (
              <>
                <Text style={styles.voted}>{t('shareCard.iRated')}</Text>
                <View style={{ flexDirection: 'row', marginTop: fs(3) }}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Text key={i} style={{ fontSize: fs(20), color: i <= stars ? '#141414' : 'rgba(20,20,20,0.25)' }}>
                      ★
                    </Text>
                  ))}
                </View>
              </>
            ) : isEpisode && em?.title ? (
              <Text style={styles.epTitle} numberOfLines={2}>
                {em.title}
              </Text>
            ) : !isMovie && !isEpisode && meta?.status ? (
              <Text style={styles.voted}>{meta.inProduction ? t('shareCard.watching') : meta.status}</Text>
            ) : null}
          </View>

          {/* bottom brand bar */}
          <View style={styles.brandBar}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              {/* The real mark. This was a brand-coloured square with the
                  letter O in it, which is not the logo — and this bar is the
                  one part of the app that ends up on other people's timelines,
                  so it is the worst place to wear something else. */}
              <Image
                source={require('@/assets/images/mark.png')}
                style={styles.otBadge}
                contentFit="contain"
              />
              <Text style={styles.brandText}>OPENTV</Text>
            </View>
            <Text style={styles.brandCta}>{t('shareCard.openSourceTagline')}</Text>
          </View>
        </View>
        )}

        <Pressable style={styles.shareBtn} onPress={share}>
          <Ionicons name="share-outline" size={18} color={colors.onBrand} />
          <Text style={styles.shareText}>{t('shareCard.share')}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

/*
 * THE SHARE CARD IS A PICTURE, AND A PICTURE DOES NOT HAVE A THEME.
 *
 * It paints with `brand`/`onBrand` rather than `yellow`/`onYellow` because the
 * light theme turns the accent to ink so that filled CONTROLS go black-on-white
 * — and this is neither a control nor a screen. It is an image somebody posts,
 * seen by people who have never opened this app and have no idea what a theme
 * setting is. Two users sharing the same profile must produce the same card.
 *
 * It rendered as a black panel with dark text on it: the surface followed the
 * theme, the ink on top did not, and the whole card became unreadable the
 * moment the light theme was switched on.
 */
const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 10,
    overflow: 'hidden',
    flexDirection: 'row',
    backgroundColor: colors.brand,
  },
  left: { width: '37%', height: '100%', backgroundColor: '#1C1C1E' },
  posterFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#26262A' },
  right: { flex: 1, backgroundColor: colors.brand, paddingHorizontal: 18, paddingTop: 16, paddingBottom: BRAND_H + 6 },
  trackedRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tracked: { color: '#141414', fontSize: fs(12.5), fontWeight: '900', letterSpacing: 0.5 },
  name: { color: '#141414', fontSize: fs(21), fontWeight: '900', marginTop: fs(9), lineHeight: fs(24) },
  sub: { color: '#3A3A1E', fontSize: fs(13), fontWeight: '600', marginTop: fs(4) },
  dash: { width: fs(34), height: fs(5), backgroundColor: '#141414', marginTop: fs(12) },
  voted: { color: '#141414', fontSize: fs(13), fontWeight: '900', letterSpacing: 0.5, marginTop: fs(12) },
  epTitle: { color: '#3A3A1E', fontSize: fs(13), fontWeight: '600', marginTop: fs(12) },
  brandBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: BRAND_H,
    backgroundColor: '#0D0D0F',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  otBadge: { width: 22, height: 22 },
  brandText: { color: '#FFF', fontSize: fs(11.5), fontWeight: '800', letterSpacing: 0.8 },
  brandCta: { color: '#C9C9CF', fontSize: fs(9.5) },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingVertical: 14,
    paddingHorizontal: 44,
  },
  shareText: { color: colors.onBrand, fontSize: 13.5, fontWeight: '800', letterSpacing: 1 },

  // ── the shape toggle ──────────────────────────────────────────────────
  shapes: {
    flexDirection: 'row',
    gap: 6,
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
  },
  shapeTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  shapeTabOn: { backgroundColor: colors.brand },
  shapeText: { color: colors.dim, fontSize: 13, fontWeight: '700' },

  // ── the story ─────────────────────────────────────────────────────────
  story: {
    width: STORY_W,
    height: STORY_H,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#08080A',
    justifyContent: 'flex-end',
  },
  /** The ramp, ABOVE the floor rather than over it. A third of the card is
   *  enough to land softly without eating the poster. */
  fade: { height: '30%' },
  storyFoot: { padding: ss(18), gap: ss(2), backgroundColor: `rgba(8,8,10,${FLOOR_A})` },
  storyTracked: { flexDirection: 'row', alignItems: 'center', gap: ss(5), marginBottom: ss(6) },
  storyTrackedText: {
    color: colors.brand,
    fontSize: ss(11),
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  storyName: { color: '#FFFFFF', fontSize: ss(26), fontWeight: '900', lineHeight: ss(30), letterSpacing: -0.4 },
  storySub: { color: 'rgba(255,255,255,0.72)', fontSize: ss(13), fontWeight: '600', marginTop: ss(3) },
  storyBrand: { flexDirection: 'row', alignItems: 'center', gap: ss(6), marginTop: ss(16) },
  storyBadge: { width: ss(18), height: ss(18) },
  storyBrandText: { color: '#FFFFFF', fontSize: ss(12), fontWeight: '900', letterSpacing: 0.8 },
  storyBrandCta: { color: 'rgba(255,255,255,0.5)', fontSize: ss(10), fontWeight: '600', marginStart: 'auto' },
});
