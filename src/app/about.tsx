import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { colors, radius, space } from '@/theme';
import { t } from '@/i18n';

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
      <NavHeader title={t('settings.about.title')} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <ContentColumn style={{ paddingHorizontal: space.lg, gap: 16 }}>
        <View style={styles.brandRow}>
          <View style={styles.badge}>
            <Text style={{ color: colors.yellow, fontSize: 30, fontWeight: '900' }}>O</Text>
          </View>
          <View>
            <Text style={styles.appName}>OpenTV</Text>
            <Text style={styles.version}>{t('about.version', { version: APP_VERSION })}</Text>
          </View>
        </View>

        <Text style={styles.body}>{t('about.intro')}</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('about.privacyTitle')}</Text>
          <Text style={styles.body}>{t('about.privacyBody')}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('about.dataSourcesTitle')}</Text>
          <Text style={styles.body}>{t('about.dataSourcesBody')}</Text>
          <LinkRow label={t('about.tvdbLink')} url="https://thetvdb.com" />
          <LinkRow label={t('about.supportTvdb')} url="https://thetvdb.com/subscribe" />
          <Text style={[styles.body, { marginTop: 12 }]}>{t('about.tmdbNote')}</Text>
          <LinkRow label={t('about.tmdbLink')} url="https://www.themoviedb.org" />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('about.linksTitle')}</Text>
          <LinkRow label={t('about.privacyPolicy')} url="https://theopentv.com/privacy" />
          <LinkRow label={t('about.terms')} url="https://theopentv.com/terms" />
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
