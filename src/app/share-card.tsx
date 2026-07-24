import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { Alert, Dimensions, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import { getEpisodeVote, getMovie, getShowBrief } from '@/db';
import { episodeMeta, showMeta } from '@/metadata';
import { colors, radius } from '@/theme';

const W = Dimensions.get('window').width;
const CARD_W = W - 32;
const CARD_H = Math.round(CARD_W * 0.62);
const BRAND_H = 34;
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

  const displayName = isMovie ? (movie?.name ?? 'Untitled') : (brief?.name ?? meta?.name ?? 'Untitled');
  const poster = isMovie ? (movie?.poster ?? null) : (brief?.poster ?? meta?.poster ?? null);

  const stars = isMovie ? (movie?.stars ?? 0) : isEpisode ? (getEpisodeVote(tvdbId, s, e).stars ?? 0) : 0;
  const canRate = isMovie || isEpisode;

  const trackedLabel = isMovie
    ? movie?.watchedAt
      ? 'WATCHED'
      : 'WATCHLIST'
    : isEpisode
      ? 'WATCHED'
      : 'TRACKED';

  const subtitle = isMovie
    ? (movie?.year ?? '')
    : isEpisode
      ? `S${pad(s)} | E${pad(e)}`
      : [meta?.totalSeasons ? `${meta.totalSeasons} season${meta.totalSeasons === 1 ? '' : 's'}` : null, meta?.network]
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
          dialogTitle: `Share ${displayName}`,
        });
        return;
      }
      await Share.share({ url: uri, message: `${displayName} on OpenTV` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('native module') || msg.includes('RNViewShot')) {
        Alert.alert('One more build needed', 'The share-card capture arrives with the next rebuild (npx expo run:ios --device).');
      } else {
        Alert.alert('Share failed', msg);
      }
    }
  };

  const shareTitle = isMovie ? 'Share movie' : isEpisode ? 'Share episode' : 'Share show';

  return (
    <Screen>
      <NavHeader title={shareTitle} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 }}>
        <View ref={cardRef} collapsable={false} style={styles.card}>
          {/* poster left */}
          <View style={styles.left}>
            {poster ? (
              <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.posterFallback]}>
                <Text style={{ color: colors.yellow, fontSize: fs(30), fontWeight: '900' }}>
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
                <Text style={styles.voted}>I RATED:</Text>
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
              <Text style={styles.voted}>{meta.inProduction ? 'Watching' : meta.status}</Text>
            ) : null}
          </View>

          {/* bottom brand bar */}
          <View style={styles.brandBar}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <View style={styles.otBadge}>
                <Text style={{ color: colors.onYellow, fontSize: 11, fontWeight: '900' }}>O</Text>
              </View>
              <Text style={styles.brandText}>OPENTV</Text>
            </View>
            <Text style={styles.brandCta}>Open source · your data, forever</Text>
          </View>
        </View>

        <Pressable style={styles.shareBtn} onPress={share}>
          <Ionicons name="share-outline" size={18} color={colors.onYellow} />
          <Text style={styles.shareText}>SHARE</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 10,
    overflow: 'hidden',
    flexDirection: 'row',
    backgroundColor: colors.yellow,
  },
  left: { width: '37%', height: '100%', backgroundColor: '#1C1C1E' },
  posterFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#26262A' },
  right: { flex: 1, backgroundColor: colors.yellow, paddingHorizontal: 18, paddingTop: 16, paddingBottom: BRAND_H + 6 },
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
  otBadge: { width: 18, height: 18, borderRadius: 4, backgroundColor: colors.yellow, alignItems: 'center', justifyContent: 'center' },
  brandText: { color: '#FFF', fontSize: fs(11.5), fontWeight: '800', letterSpacing: 0.8 },
  brandCta: { color: '#C9C9CF', fontSize: fs(9.5) },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 14,
    paddingHorizontal: 44,
  },
  shareText: { color: colors.onYellow, fontSize: 13.5, fontWeight: '800', letterSpacing: 1 },
});
