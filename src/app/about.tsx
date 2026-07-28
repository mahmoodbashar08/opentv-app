import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { colors, radius, space } from '@/theme';

import Constants from 'expo-constants';

// always the real shipped version — bumped in app.json with every release
const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

function LinkRow({ label, url }: { label: string; url: string }) {
  return (
    <Pressable onPress={() => Linking.openURL(url)} hitSlop={6}>
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

export default function AboutScreen() {
  return (
    <Screen>
      <NavHeader title="About OpenTV" />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <ContentColumn style={{ paddingHorizontal: space.lg, gap: 16 }}>
        <View style={styles.brandRow}>
          <View style={styles.badge}>
            <Text style={{ color: colors.yellow, fontSize: 30, fontWeight: '900' }}>O</Text>
          </View>
          <View>
            <Text style={styles.appName}>OpenTV</Text>
            <Text style={styles.version}>Version {APP_VERSION}</Text>
          </View>
        </View>

        <Text style={styles.body}>
          The open-source home for your TV Time. Track shows and movies, import your full TV Time history,
          and export everything back out at any time — your library belongs to you.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your privacy</Text>
          <Text style={styles.body}>
            Everything stays on your device. Your library, watch history, votes, comments and photos live in a
            local database and never leave your phone. The app makes network requests only to TheTVDB and TMDB,
            to fetch artwork and show information — no accounts, no analytics, no tracking.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Data sources</Text>
          <Text style={styles.body}>
            Show and movie metadata and artwork — episode lists, names, air dates, artwork, genres and cast —
            are supplied by TheTVDB, the same database TV Time was built on. Please consider adding missing
            information there, or subscribing to support them.
          </Text>
          <LinkRow label="thetvdb.com" url="https://thetvdb.com" />
          <LinkRow label="Support TheTVDB" url="https://thetvdb.com/subscribe" />
          <Text style={[styles.body, { marginTop: 12 }]}>
            This product uses the TMDB API but is not endorsed or certified by TMDB. TMDB supplies streaming
            availability, similar shows and star ratings.
          </Text>
          <LinkRow label="themoviedb.org" url="https://www.themoviedb.org" />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Links</Text>
          <LinkRow label="Privacy policy" url="https://mahmoodbashar08.github.io/opentv/privacy.html" />
        </View>
      </ContentColumn>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 },
  badge: {
    width: 58,
    height: 58,
    borderRadius: 14,
    backgroundColor: '#1B1B1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  appName: { color: colors.text, fontSize: 22, fontWeight: '800' },
  version: { color: colors.faint, fontSize: 13, marginTop: 2 },
  body: { color: '#C9C9CE', fontSize: 14.5, lineHeight: 21 },
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 14, gap: 8 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  link: { color: colors.blue, fontSize: 14.5, fontWeight: '600' },
});
