/**
 * Stremio — sign in and bring in the episodes marked watched there.
 *
 * EMAIL AND PASSWORD, because Stremio offers nothing else: no PIN flow like
 * Plex, no OAuth. The password goes to Stremio once, for an auth key kept in
 * the Keychain, and is not stored anywhere.
 *
 * Everything after the connect is the Jellyfin screen: read-only, tracked
 * shows only, the phone stays the source of truth.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { MenuRow, NavHeader, PillButton, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { stremioLogin } from '@/stremio';
import { disconnectStremio, getStremioSession, setStremioSession, stremioEmail, stremioSyncedAt, syncStremio } from '@/stremio-sync';
import { colors, radius, space } from '@/theme';

export default function StremioScreen() {
  const [connected, setConnected] = useState(false);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setConnected((await getStremioSession()) != null);
        setLastSync(stremioSyncedAt());
      })();
    }, []),
  );

  const connect = async () => {
    if (!user.trim() || !password) {
      Alert.alert(t('stremio.title'), t('stremio.needLogin'));
      return;
    }
    tapLight();
    setBusy(true);
    const session = await stremioLogin(user.trim(), password);
    if (!session) {
      setBusy(false);
      Alert.alert(t('stremio.failedTitle'), t('stremio.failedBody'));
      return;
    }
    await setStremioSession(session);
    // The password has done its one job.
    setPassword('');
    setConnected(true);
    setBusy(false);
    // Straight into a first sync: connecting and then being told to press
    // another button is the flow asking twice for one decision.
    void run();
  };

  const run = async () => {
    setBusy(true);
    const out = await syncStremio();
    setBusy(false);
    setLastSync(stremioSyncedAt());
    if (!out.ran) {
      Alert.alert(t('stremio.failedTitle'), t('stremio.failedBody'));
      return;
    }
    Alert.alert(t('stremio.title'), out.applied > 0 ? t('plex.applied', { count: out.applied }) : t('plex.nothingNew'));
  };

  const cut = () => {
    Alert.alert(t('stremio.disconnectTitle'), t('plex.disconnectBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('plex.disconnect'),
        style: 'destructive',
        onPress: () => {
          void disconnectStremio().then(() => {
            setConnected(false);
            setLastSync(null);
          });
        },
      },
    ]);
  };

  const syncedLabel = lastSync ? new Date(lastSync).toLocaleString() : t('plex.never');

  return (
    <Screen>
      <NavHeader title={t('stremio.title')} close />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>{t('stremio.intro')}</Text>
        <View style={styles.promiseRow}>
          <Ionicons name="lock-closed-outline" size={16} color={colors.dim} />
          <Text style={styles.promise}>{t('stremio.rules')}</Text>
        </View>

        {connected ? (
          <>
            <Text style={styles.sectionTitle}>{t('plex.connected')}</Text>
            <MenuRow trackId="stremio.account" title={t('stremio.account')} value={stremioEmail() ?? ''} />
            <MenuRow trackId="stremio.lastSync" title={t('plex.lastSync')} value={syncedLabel} />
            <MenuRow trackId="stremio.syncNow" title={busy ? t('plex.syncing') : t('plex.syncNow')} onPress={busy ? undefined : () => void run()} />
            <MenuRow trackId="stremio.disconnect" title={t('plex.disconnect')} danger onPress={cut} />
          </>
        ) : (
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              value={user}
              onChangeText={setUser}
              placeholder={t('stremio.email')}
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="emailAddress"
              keyboardType="email-address"
            />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder={t('stremio.password')}
              placeholderTextColor={colors.faint}
              secureTextEntry
              textContentType="password"
              onSubmitEditing={() => void connect()}
            />
            <Text style={styles.hint}>{t('stremio.passwordHint')}</Text>
            <PillButton label={busy ? t('stremio.connecting') : t('stremio.connect')} trackId="stremio.connect" onPress={busy ? undefined : () => void connect()} />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { color: colors.text, fontSize: 15, lineHeight: 21, paddingHorizontal: space.lg, paddingTop: 14 },
  promiseRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingHorizontal: space.lg, paddingTop: 14, paddingBottom: 6 },
  promise: { color: colors.dim, fontSize: 13, lineHeight: 18, flex: 1 },
  sectionTitle: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: space.lg,
    paddingTop: 22,
    paddingBottom: 6,
  },
  form: { paddingHorizontal: space.lg, paddingTop: 18, gap: 10 },
  input: {
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: radius.card,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
  },
  hint: { color: colors.faint, fontSize: 12.5, lineHeight: 17, paddingBottom: 8 },
});
