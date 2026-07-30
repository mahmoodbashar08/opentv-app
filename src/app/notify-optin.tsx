/**
 * The one-time notification ask, shown straight after onboarding.
 *
 * iOS spends its permission dialog ONCE — decline it and the app can never
 * prompt again, only send the user to iOS Settings. So this screen asks first
 * and calls the system prompt only on a yes. "Not now" leaves the prompt
 * unspent, and the Profile banner keeps the offer available.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContentColumn, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { enableEpisodeNotifications } from '@/notifications';
import { setNotifyAsked } from '@/session-store';
import { colors, radius, space } from '@/theme';
import { t } from '@/i18n';

const PERKS = [
  { icon: '📺', textKey: 'notifyOptin.perkNewEpisode' as const },
  { icon: '🔥', textKey: 'notifyOptin.perkFinale' as const },
  { icon: '🍿', textKey: 'notifyOptin.perkMovieNight' as const },
] as const;

export default function NotifyOptInScreen() {
  const [busy, setBusy] = useState(false);
  // Screen only insets the TOP, so without this the "Not now" control lands
  // inside the home-indicator gesture strip and is awkward to hit — it took a
  // dead-centre tap to register on an iPad.
  const insets = useSafeAreaInsets();

  // stamped by EITHER answer, so the screen never comes back. Setting it
  // re-registers the tab navigator, which is what /profile needs to exist.
  const done = () => {
    setNotifyAsked();
    router.replace('/profile');
  };

  const turnOn = () => {
    if (busy) return;
    setBusy(true);
    tapLight();
    void enableEpisodeNotifications()
      .then((ok) => {
        if (!ok) {
          // the system prompt is spent — the only way back is iOS Settings
          Alert.alert(
            t('settings.app.notificationsOffTitle'),
            t('profile.notifOffBody'),
            [
              { text: t('common.later'), style: 'cancel' },
              { text: t('common.openSettings'), onPress: () => void Linking.openSettings() },
            ],
          );
        }
      })
      .catch(() => {})
      .finally(done);
  };

  return (
    <Screen>
      <ContentColumn style={{ flex: 1, paddingHorizontal: space.xl }}>
        <View style={styles.body}>
          <Text style={styles.bell}>🔔</Text>
          <Text style={styles.title}>{t('notifyOptin.title')}</Text>
          <Text style={styles.sub}>{t('notifyOptin.sub')}</Text>

          <View style={styles.perks}>
            {PERKS.map((p) => (
              <View key={p.textKey} style={styles.perk}>
                <Text style={styles.perkIcon}>{p.icon}</Text>
                <Text style={styles.perkText}>{t(p.textKey)}</Text>
              </View>
            ))}
          </View>

          {/* the privacy story is the strongest argument this app has here */}
          <Text style={styles.privacy}>{t('notifyOptin.privacy')}</Text>
        </View>

        <Pressable style={styles.cta} onPress={turnOn} disabled={busy}>
          <Text style={styles.ctaText}>{t('notifyOptin.turnOnReminders')}</Text>
        </Pressable>
        <Pressable style={[styles.later, { marginBottom: space.sm + insets.bottom }]} onPress={done} hitSlop={12}>
          <Text style={styles.laterText}>{t('notifyOptin.notNow')}</Text>
        </Pressable>
      </ContentColumn>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: 'center', gap: 14 },
  bell: { fontSize: 46, textAlign: 'center' },
  title: { color: colors.text, fontSize: 27, fontWeight: '800', textAlign: 'center' },
  sub: { color: colors.dim, fontSize: 15, textAlign: 'center' },
  perks: { gap: 14, marginTop: 10, marginBottom: 4 },
  perk: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  perkIcon: { fontSize: 21, width: 30, textAlign: 'center' },
  perkText: { color: colors.text, fontSize: 15.5, flex: 1, lineHeight: 21 },
  privacy: { color: colors.faint, fontSize: 12.5, textAlign: 'center', lineHeight: 18, marginTop: 4 },
  cta: {
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaText: { color: colors.onYellow, fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },
  later: { paddingVertical: 16, alignItems: 'center' },
  laterText: { color: colors.dim, fontSize: 15, fontWeight: '600' },
});
