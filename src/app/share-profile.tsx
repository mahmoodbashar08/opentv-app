import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRef } from 'react';
import { Alert, Dimensions, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import seed from '@/seed';
import { getMeta, getMovieTotals, getTotals } from '@/db';
import { isSeedLibrary, profileImageUri } from '@/library';
import { colors, radius } from '@/theme';

const AVATAR = require('../../assets/profile/avatar.jpg');
// A share card is captured as an IMAGE, so a fixed size is correct — it should
// not reflow with orientation. Clamped so a tablet (or a landscape launch)
// doesn't render an enormous card: every type size derives from CARD_W via F.
const W = Math.min(Dimensions.get('window').width, 420);
const CARD_W = W - 32;
const CARD_H = Math.round(CARD_W * 0.66);
// the brand bar is absolutely positioned over the card, so every panel has to
// reserve this much room at the bottom or its last row hides underneath it
const BRAND_H = 34;
// Type is sized against a 358pt reference card and scaled from there, so the
// card keeps the same proportions on a small phone as on a large one. Set too
// large, the username truncates and "0mo 26d 21h" wraps onto a second line.
const F = CARD_W / 358;
const fs = (n: number) => Math.round(n * F * 2) / 2;

function countLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function clock(minutes: number): string {
  const months = Math.floor(minutes / (60 * 24 * 30));
  const days = Math.floor(minutes / (60 * 24)) % 30;
  const hours = Math.floor(minutes / 60) % 24;
  return `${months}mo ${days}d ${hours}h`;
}

// faint doodle icons on the dark panel, like the real card
const DOODLES = [
  { icon: 'heart-outline', top: '6%', left: '8%' },
  { icon: 'star-outline', top: '10%', left: '68%' },
  { icon: 'notifications-outline', top: '38%', left: '80%' },
  { icon: 'search-outline', top: '72%', left: '6%' },
  { icon: 'add-circle-outline', top: '78%', left: '72%' },
] as const;

export default function ShareProfileScreen() {
  const cardRef = useRef<View>(null);
  const username = getMeta('username') ?? seed.profile.username;
  const totals = getTotals();
  const movies = getMovieTotals();

  const share = async () => {
    try {
      // lazy-load: needs the native module from the latest build
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
      const uri = await captureRef(cardRef, { format: 'png', quality: 1 });
      // Share the FILE, not a url string: React Native's Share only honours
      // `url` on iOS, so on Android the card was dropped and apps received an
      // empty share ("impossible to send a blank message" in WhatsApp).
      // expo-sharing hands the real image to the native sheet on both
      // platforms — which is also where "Save Image" comes from.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sharing = require('expo-sharing') as typeof import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          UTI: 'public.png',
          dialogTitle: 'Share your OpenTV card',
        });
        return;
      }
      // last resort (sharing unavailable): iOS still accepts a file url
      await Share.share({ url: uri, message: `${username} on OpenTV` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('native module') || msg.includes('RNViewShot')) {
        Alert.alert('One more build needed', 'The share-card capture arrives with the next rebuild (npx expo run:ios --device).');
      } else {
        Alert.alert('Share failed', msg);
      }
    }
  };

  return (
    <Screen>
      <NavHeader title="Share profile" />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 }}>
        {/* the card itself — captured pixel-perfect when sharing */}
        <View ref={cardRef} collapsable={false} style={styles.card}>
          <View style={styles.left}>
            {DOODLES.map((d, i) => (
              <Ionicons
                key={i}
                name={d.icon}
                size={30}
                color="rgba(255,255,255,0.07)"
                style={{ position: 'absolute', top: d.top as `${number}%`, left: d.left as `${number}%` }}
              />
            ))}
            <View style={styles.avatarRing}>
              {profileImageUri('avatar') != null ? (
                <Image source={{ uri: profileImageUri('avatar')! }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              ) : isSeedLibrary() ? (
                <Image source={AVATAR} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#26262A' }}>
                  <Text style={{ color: colors.yellow, fontSize: fs(28), fontWeight: '800' }}>{username[0]?.toUpperCase()}</Text>
                </View>
              )}
            </View>
          </View>
          <View style={styles.right}>
            <Text style={styles.name} numberOfLines={1}>
              {username}
            </Text>
            <Text style={styles.handle} numberOfLines={1}>
              @{username.toLowerCase()}
            </Text>
            <View style={styles.dash} />
            <Text style={styles.tracked}>TRACKED</Text>
            <View style={styles.grid}>
              <View style={styles.cell}>
                <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{countLabel(totals.episodes)}</Text>
                <Text style={styles.label}>episodes</Text>
              </View>
              <View style={styles.cell}>
                <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{movies.watched}</Text>
                <Text style={styles.label}>movies</Text>
              </View>
              <View style={styles.cell}>
                <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{clock(totals.minutes)}</Text>
                <Text style={styles.label}>of show time</Text>
              </View>
              <View style={styles.cell}>
                <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{clock(movies.minutes)}</Text>
                <Text style={styles.label}>of movie time</Text>
              </View>
            </View>
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
    backgroundColor: '#3A3A3C',
  },
  left: { width: '37%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#3A3A3C', paddingBottom: BRAND_H },
  avatarRing: {
    width: CARD_W * 0.26,
    height: CARD_W * 0.26,
    borderRadius: CARD_W * 0.13,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
  },
  right: { flex: 1, backgroundColor: colors.yellow, paddingHorizontal: 18, paddingTop: 14, paddingBottom: BRAND_H + 6 },
  name: { color: '#141414', fontSize: fs(17), fontWeight: '900' },
  handle: { color: '#3A3A1E', fontSize: fs(11.5), marginTop: 1 },
  dash: { width: fs(30), height: fs(5), backgroundColor: '#141414', marginTop: fs(8) },
  tracked: { color: '#141414', fontSize: fs(12.5), fontWeight: '900', letterSpacing: 0.5, marginTop: fs(7) },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: fs(5) },
  cell: { width: '50%', marginTop: fs(6), paddingRight: 6 },
  value: { color: '#141414', fontSize: fs(14), fontWeight: '900' },
  label: { color: '#3A3A1E', fontSize: fs(10.5) },
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
  otBadge: {
    width: 18,
    height: 18,
    borderRadius: 4,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
