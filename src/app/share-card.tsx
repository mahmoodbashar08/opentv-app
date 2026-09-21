import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Dimensions, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import { getEpisodeVote, getMovie, getShowBrief } from '@/db';
import { episodeMeta, showMeta } from '@/metadata';
import { movieMeta } from '@/movie-metadata';
import { colors, radius } from '@/theme';
import { currentLocale, t } from '@/i18n';
import { runtimeLabel } from '@/duration';
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
/**
 * How dark the floor under the words is, and the value the fade above it ends
 * on.
 *
 * 0.93 WAS TOO MUCH. It made the bottom third of every poster a black slab —
 * readable, and no longer a picture of anything. The words are white on it and
 * the stars are brand-coloured, so 0.78 clears both comfortably while the
 * poster still shows through as the thing being shared.
 */
const FLOOR_A = 0.78;
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

  /**
   * WHEN, and it is the line that makes the picture yours.
   *
   * Without it the story is a poster with a title on it, which anybody could
   * have posted about any film at any time. "Watched 21 August 2026" is a
   * sentence about a person — and it is the part a friend replies to.
   *
   * Only for a film actually watched: a watchlist entry has no date, and
   * inventing one would be the card claiming something untrue.
   */
  const watchedOn =
    isMovie && movie?.watchedAt
      ? new Date(movie.watchedAt).toLocaleDateString(currentLocale(), {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : null;

  /**
   * THE YEAR NEEDS COMPANY, or it reads as a second date.
   *
   * The badge above now says "WATCHED · 21 AUGUST 2026", and a bare "2026"
   * under it is two years on a card with nothing saying which is which — is
   * that when it came out, or when I saw it? Beside a runtime it is plainly
   * the film's own line: "2026 · 1h 11m" is a sentence about the film, not
   * about the viewer.
   *
   * The runtime is what the LIBRARY holds rather than what a fetch returns, so
   * it is whatever the card already knows and never a request this screen has
   * to wait for. Absent for a film that has never had one, and then the year
   * stands alone as it did.
   *
   * TWO UNITS, and mixing them shipped "2023 · 120h 0m" onto a card somebody
   * was about to post. `movies.runtime` is SECONDS (see `db.ts`) and
   * `runtimeLabel` takes MINUTES. The bundled metadata is the second half of
   * the same bug: TV Time's export leaves the column empty for a lot of films,
   * which is why the line was missing altogether for some of them — and that
   * metadata is already in minutes, so it goes in unconverted.
   *
   * No ~100-minute guess like `stats-calc`'s `filmMinutes`. A total can
   * average over an assumption; a card naming one film cannot.
   */
  const runtimeMins =
    movie?.runtime != null && movie.runtime > 0
      ? Math.round(movie.runtime / 60)
      : (movieMeta(movie?.tmdbId ?? null)?.runtime ?? null);

  const subtitle = isMovie
    ? [movie?.year ?? null, runtimeLabel(runtimeMins) || null].filter(Boolean).join(' · ')
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

            {/* A REAL GRADIENT, after two attempts at faking one.
                Stacked views work elsewhere in this app — `profile-template`
                ramps a page colour that way — but that ramp is 460pt tall and
                sits behind ordinary content. Here the fade is a third of a
                picture people POST, and at any band count the seams showed:
                each band is a separate view rounded to device pixels, so the
                edges land on whole pixels and read as lines drawn across the
                poster. 24 striped, 96 still striped more faintly. The
                technique has a limit and this is past it.
                One native module, for the one screen whose output leaves the
                app and is looked at by people who have never heard of it. */}
            <LinearGradient
              colors={['rgba(8,8,10,0)', `rgba(8,8,10,${FLOOR_A})`]}
              style={styles.fade}
              pointerEvents="none"
            />

            <View style={styles.storyFoot}>
              <View style={styles.storyTracked}>
                <Ionicons name="checkmark-circle" size={ss(13)} color={colors.brand} />
                <Text style={styles.storyTrackedText}>
                  {/* THE DATE BELONGS TO THE BADGE, not under the year.
                      On its own line it sat directly beneath the release year
                      as a second bare date — "2026" then "August 21, 2026" —
                      and nothing said which was which. Attached to the word
                      WATCHED it reads as one fact: watched, then, and the
                      year below is plainly the film's. */}
                  {watchedOn ? `${trackedLabel} · ${watchedOn}` : trackedLabel}
                </Text>
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
            {/*
              THE DATE GETS ITS OWN LINE HERE, and on the story it does not.

              On the story the words run the full width of the picture, so
              "WATCHED · 21 AUGUST 2026" is one line and reads as one fact.
              This panel is under two thirds of a card that is itself narrower
              than the screen, and the same string wrapped mid-badge — a bold
              uppercase shout broken across two lines, with the second line
              orphaning a year. "MINHA NOTA" is not the long label in this app;
              a date is.

              So the badge keeps the single word it can always hold, and the
              date sits under it quieter and smaller. Same two facts, ranked
              rather than run together, which is what the narrower column was
              asking for.
            */}
            <View style={styles.trackedRow}>
              <Ionicons name="checkmark-circle" size={fs(14)} color="#141414" />
              <Text style={styles.tracked} numberOfLines={1}>
                {trackedLabel}
              </Text>
            </View>
            {!!watchedOn && <Text style={styles.trackedOn}>{watchedOn}</Text>}

            <Text style={styles.name} numberOfLines={2}>
              {displayName}
            </Text>
            {!!subtitle && <Text style={styles.sub}>{subtitle}</Text>}

            {/*
              PINNED TO THE FLOOR, and that is the actual repair.

              The panel was a plain stack inside a card of FIXED height with
              `overflow: hidden`, so every line above the stars pushed them
              down and the card simply cut off whatever no longer fitted —
              which is how a two-line badge silently sliced the bottom off
              somebody's rating. `marginTop: 'auto'` takes the block out of
              that race: the title may run to two lines, the date may be long,
              and the rating still sits exactly above the brand bar. Nothing
              downstream of the title can be clipped by something upstream of
              it growing.
            */}
            <View style={styles.foot}>
              <View style={styles.dash} />
              {canRate && stars > 0 ? (
                // One row, not a label with a block of stars beneath it: the
                // label is three short words and the stars are five glyphs,
                // and stacking them spent two lines saying one thing.
                <View style={styles.rateRow}>
                  <Text style={styles.voted}>{t('shareCard.iRated')}</Text>
                  <Text style={styles.stars}>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Text key={i} style={{ color: i <= stars ? '#141414' : 'rgba(20,20,20,0.22)' }}>
                        ★
                      </Text>
                    ))}
                  </Text>
                </View>
              ) : isEpisode && em?.title ? (
                <Text style={styles.epTitle} numberOfLines={2}>
                  {em.title}
                </Text>
              ) : !isMovie && !isEpisode && meta?.status ? (
                <Text style={styles.voted}>{meta.inProduction ? t('shareCard.watching') : meta.status}</Text>
              ) : null}
            </View>
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
  // paddingBottom clears the brand bar with room to spare -- the bar is an
  // absolute overlay, so anything the panel lays out under it is hidden by it
  // rather than pushing it down.
  right: { flex: 1, backgroundColor: colors.brand, paddingHorizontal: 18, paddingTop: 15, paddingBottom: BRAND_H + 11 },
  trackedRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tracked: { color: '#141414', fontSize: fs(12), fontWeight: '900', letterSpacing: 0.6 },
  trackedOn: { color: '#3A3A1E', fontSize: fs(11.5), fontWeight: '700', marginTop: fs(2), opacity: 0.85 },
  name: { color: '#141414', fontSize: fs(20), fontWeight: '900', marginTop: fs(8), lineHeight: fs(23) },
  sub: { color: '#3A3A1E', fontSize: fs(12.5), fontWeight: '600', marginTop: fs(3) },
  foot: { marginTop: 'auto', paddingTop: fs(10) },
  dash: { width: fs(30), height: fs(4), backgroundColor: '#141414', marginBottom: fs(9) },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: fs(7) },
  voted: { color: '#141414', fontSize: fs(12), fontWeight: '900', letterSpacing: 0.5 },
  // an explicit lineHeight: a bare fontSize leaves the glyph's descent to the
  // platform, and the row it produced was taller on iOS than the stars drawn
  // in it -- which is the other half of why they sat under the brand bar.
  stars: { fontSize: fs(17), lineHeight: fs(20) },
  epTitle: { color: '#3A3A1E', fontSize: fs(12.5), fontWeight: '600' },
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
  /** The ramp, ABOVE the floor rather than over it. Taller than it needs to
   *  be on purpose: the same alpha spread over more height is a gentler step
   *  per band, which is half of why the first version striped. */
  fade: { height: '42%' },
  storyFoot: { padding: ss(18), gap: ss(2), backgroundColor: `rgba(8,8,10,${FLOOR_A})` },
  storyTracked: { flexDirection: 'row', alignItems: 'center', gap: ss(5), marginBottom: ss(6) },
  // `flex: 1` so a long date wraps inside the row instead of pushing the
  // badge off the edge of the card.
  storyTrackedText: {
    flex: 1,
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
