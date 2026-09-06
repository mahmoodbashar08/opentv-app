/**
 * Jellyfin — connect a self-hosted server and bring in what was watched there.
 *
 * THREE FIELDS, NOT A PIN. Jellyfin has no central directory, so there is
 * nobody to ask for a code: the user types where their server is and who they
 * are on it. That is the same decentralised property that makes Jellyfin
 * worth supporting, showing up in the one place it costs something. The
 * password goes to that server once and is not kept anywhere.
 *
 * Everything after the connect is the Plex screen: read-only, tracked shows
 * only, the phone stays the source of truth.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { MenuRow, NavHeader, PillButton, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { authenticate, normaliseServerUrl } from '@/jellyfin';
import { disconnectJellyfin, getJellyfinSession, jellyfinDeviceId, jellyfinServer, jellyfinSyncedAt, setJellyfinSession, syncJellyfin } from '@/jellyfin-sync';
import { colors, radius, space } from '@/theme';

export default function JellyfinScreen() {
  const [connected, setConnected] = useState(false);
  const [server, setServer] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setConnected((await getJellyfinSession()) != null);
        setLastSync(jellyfinSyncedAt());
      })();
    }, []),
  );

  const connect = async () => {
    const url = normaliseServerUrl(server);
    if (!url || !user.trim()) {
      Alert.alert(t('jellyfin.title'), t('jellyfin.needAddress'));
      return;
    }
    tapLight();
    setBusy(true);
    const session = await authenticate(url, user.trim(), password, jellyfinDeviceId());
    if (!session) {
      setBusy(false);
      Alert.alert(t('jellyfin.failedTitle'), t('jellyfin.failedBody'));
      return;
    }
    await setJellyfinSession(session);
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
    const out = await syncJellyfin();
    setBusy(false);
    setLastSync(jellyfinSyncedAt());
    if (!out.ran) {
      Alert.alert(t('jellyfin.failedTitle'), t('jellyfin.failedBody'));
      return;
    }
    Alert.alert(t('jellyfin.title'), out.applied > 0 ? t('plex.applied', { count: out.applied }) : t('plex.nothingNew'));
  };

  const cut = () => {
    Alert.alert(t('jellyfin.disconnectTitle'), t('plex.disconnectBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('plex.disconnect'),
        style: 'destructive',
        onPress: () => {
          void disconnectJellyfin().then(() => {
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
      <NavHeader title={t('jellyfin.title')} close />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>{t('jellyfin.intro')}</Text>
        <View style={styles.promiseRow}>
          <Ionicons name="lock-closed-outline" size={16} color={colors.dim} />
          <Text style={styles.promise}>{t('jellyfin.rules')}</Text>
        </View>

        {connected ? (
          <>
            <Text style={styles.sectionTitle}>{t('plex.connected')}</Text>
            <MenuRow trackId="jellyfin.server" title={t('jellyfin.server')} value={jellyfinServer() ?? ''} />
            <MenuRow trackId="jellyfin.lastSync" title={t('plex.lastSync')} value={syncedLabel} />
            <MenuRow trackId="jellyfin.syncNow" title={busy ? t('plex.syncing') : t('plex.syncNow')} onPress={busy ? undefined : () => void run()} />
            <MenuRow trackId="jellyfin.disconnect" title={t('plex.disconnect')} danger onPress={cut} />
          </>
        ) : (
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              value={server}
              onChangeText={setServer}
              placeholder={t('jellyfin.serverHint')}
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              textContentType="URL"
            />
            <TextInput
              style={styles.input}
              value={user}
              onChangeText={setUser}
              placeholder={t('jellyfin.username')}
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
            />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder={t('jellyfin.password')}
              placeholderTextColor={colors.faint}
              secureTextEntry
              textContentType="password"
              onSubmitEditing={() => void connect()}
            />
            <Text style={styles.hint}>{t('jellyfin.passwordHint')}</Text>
            <PillButton label={busy ? t('jellyfin.connecting') : t('jellyfin.connect')} trackId="jellyfin.connect" onPress={busy ? undefined : () => void connect()} />
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
