/**
 * Forced-update gate. On launch it fetches a version policy JSON you host:
 *
 *   { "iosMinVersion": "1.1.0" }
 *
 * Installed version older than iosMinVersion → a full-screen blocker with an
 * App Store button. Everything else — file missing, offline, malformed JSON —
 * fails open: the app must never lock users out by accident. Versions
 * shipped before this component (1.0) can never be forced; 1.1.0 is the
 * baseline.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius } from '@/theme';

// point this at a raw JSON file you control (GitHub repo/gist raw URL);
// until the file exists the gate simply never triggers
const VERSION_URL = 'https://raw.githubusercontent.com/mahmoodbashar08/opentv-config/main/version.json';
const STORE_URL =
  Platform.OS === 'android'
    ? 'https://play.google.com/store/apps/details?id=com.insightfy.opentv'
    : 'https://apps.apple.com/app/id6787399404';

/** true when a < b, comparing dotted numeric versions ("1.2" < "1.10") */
const olderThan = (a: string, b: string): boolean => {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
};

export function UpdateGate() {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(VERSION_URL);
        if (!res.ok) return;
        const policy = (await res.json()) as { iosMinVersion?: string; androidMinVersion?: string };
        const min = Platform.OS === 'android' ? policy.androidMinVersion : policy.iosMinVersion;
        const current = Constants.expoConfig?.version;
        if (min && current && olderThan(current, min)) {
          setBlocked(true);
        }
      } catch {
        // offline or the policy file isn't hosted yet — stay open
      }
    })();
  }, []);

  if (!blocked) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap]}>
      <View style={styles.iconCircle}>
        <Ionicons name="arrow-up-circle-outline" size={44} color={colors.yellow} />
      </View>
      <Text style={styles.title}>Update required</Text>
      <Text style={styles.sub}>
        This version of OpenTV is no longer supported. Update from the App Store to keep tracking — your
        library and iCloud backup are untouched.
      </Text>
      <Pressable style={styles.cta} onPress={() => void Linking.openURL(STORE_URL)}>
        <Text style={styles.ctaText}>UPDATE ON THE APP STORE</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 18,
    zIndex: 1000,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1.5,
    borderColor: '#4A4A4E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.text, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.dim, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  cta: {
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 15,
    paddingHorizontal: 40,
    marginTop: 8,
  },
  ctaText: { color: colors.onYellow, fontSize: 13.5, fontWeight: '800', letterSpacing: 1 },
});
