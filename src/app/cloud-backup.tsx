/**
 * Cloud backup — one copy of the library, kept off this phone.
 *
 * TWO DESTINATIONS ON ONE SCREEN, because they answer the same question and
 * splitting them would make somebody choose before understanding the choice.
 * Ours needs Plus and needs no setup; their own server needs three fields and
 * costs nothing, and that trade is stated where it is made rather than in a
 * paywall.
 *
 * The privacy line sits above the choice, not below it. This is the one place
 * the library leaves the device, and somebody deciding whether to turn it on
 * needs that before they tap, not after.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  backupDestination,
  connectWebdav,
  disconnectServerBackup,
  lastServerBackupAt,
  restoreFromServerBackup,
  serverBackupNow,
  chooseOpenTvCloud,
  webdavAddress,
  type BackupDestination,
} from '@/cloud-backup';
import { MenuRow, NavHeader, PillButton, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { currentLocale, t } from '@/i18n';
import { colors, radius, space } from '@/theme';

export default function CloudBackupScreen() {
  const [dest, setDest] = useState<BackupDestination | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  /** null until somebody picks "your own server" — the form is not the default. */
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');

  const reread = useCallback(() => {
    setDest(backupDestination());
    setAt(lastServerBackupAt());
  }, []);
  useFocusEffect(reread);

  const label = at
    ? new Date(at).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' })
    : t('cloudBackup.never');

  /** Ours: chosen, then immediately proven by a real upload — which is also
   *  where a missing subscription is discovered and named. */
  const pickOpenTv = async () => {
    tapLight();
    chooseOpenTvCloud();
    setDest('opentv');
    await runBackup(true);
  };

  const connectOwn = async () => {
    if (!/^https?:\/\//i.test(url.trim())) {
      Alert.alert(t('cloudBackup.title'), t('cloudBackup.needAddress'));
      return;
    }
    tapLight();
    setBusy(true);
    try {
      const r = await connectWebdav(url.trim(), user.trim(), password);
      if (r !== 'ok') {
        Alert.alert(
          t('cloudBackup.failedTitle'),
          r === 'unauthorised'
            ? t('cloudBackup.unauthorised')
            : r === 'not-found'
              ? t('cloudBackup.notFound')
              : t('cloudBackup.failedBody'),
        );
        return;
      }
      // The password has done its one job; it lives in the keychain now.
      setPassword('');
      setShowForm(false);
      reread();
      Alert.alert(t('cloudBackup.doneTitle'), t('cloudBackup.doneBody'));
    } finally {
      setBusy(false);
    }
  };

  const runBackup = async (quiet = false) => {
    setBusy(true);
    try {
      const r = await serverBackupNow(true);
      if (r === 'plus-required') {
        // Turned back off rather than left connected-but-failing: a row that
        // says "backing up" while nothing is being backed up is the worst
        // possible state for a feature whose whole job is a promise.
        await disconnectServerBackup();
        reread();
        Alert.alert(t('cloudBackup.plusNeededTitle'), t('cloudBackup.plusNeededBody'));
        return;
      }
      if (r === 'failed' || r === 'unavailable') {
        Alert.alert(t('cloudBackup.failedTitle'), t('cloudBackup.failedBody'));
        return;
      }
      reread();
      if (!quiet) Alert.alert(t('cloudBackup.doneTitle'), t('cloudBackup.doneBody'));
    } finally {
      setBusy(false);
    }
  };

  const restore = () => {
    Alert.alert(t('cloudBackup.restoreTitle'), t('cloudBackup.restoreBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('cloudBackup.restore'),
        onPress: () => {
          setBusy(true);
          void restoreFromServerBackup(() => {})
            .then((res) => {
              reread();
              Alert.alert(
                t('cloudBackup.title'),
                t('cloudBackup.restoreDone', { count: res.episodes ?? 0 }),
              );
            })
            .catch(() => Alert.alert(t('cloudBackup.failedTitle'), t('cloudBackup.noBackup')))
            .finally(() => setBusy(false));
        },
      },
    ]);
  };

  const cut = () => {
    Alert.alert(t('cloudBackup.disconnectTitle'), t('cloudBackup.disconnectBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('cloudBackup.disconnect'),
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void disconnectServerBackup()
            .then(reread)
            .finally(() => setBusy(false));
        },
      },
    ]);
  };

  return (
    <Screen>
      <NavHeader title={t('cloudBackup.title')} close />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>{t('cloudBackup.intro')}</Text>
        <View style={styles.promiseRow}>
          <Ionicons name="lock-closed-outline" size={16} color={colors.dim} />
          <Text style={styles.promise}>{t('cloudBackup.rules')}</Text>
        </View>

        {dest ? (
          <>
            <MenuRow
              trackId="cloudBackup.connectedTo"
              title={t('cloudBackup.connectedTo')}
              value={dest === 'opentv' ? t('cloudBackup.destOpenTv') : t('cloudBackup.destOwn')}
              sub={dest === 'webdav' ? (webdavAddress() ?? undefined) : undefined}
            />
            <MenuRow trackId="cloudBackup.lastBackup" title={t('cloudBackup.lastBackup')} value={label} />
            <MenuRow
              trackId="cloudBackup.backupNow"
              title={busy ? t('cloudBackup.backingUp') : t('cloudBackup.backupNow')}
              onPress={busy ? undefined : () => void runBackup()}
            />
            <MenuRow
              trackId="cloudBackup.restore"
              title={t('cloudBackup.restore')}
              sub={t('cloudBackup.restoreSub')}
              onPress={busy ? undefined : restore}
            />
            <MenuRow
              trackId="cloudBackup.disconnect"
              title={t('cloudBackup.disconnect')}
              danger
              onPress={busy ? undefined : cut}
            />
          </>
        ) : showForm ? (
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={setUrl}
              placeholder={t('cloudBackup.serverHint')}
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
              placeholder={t('cloudBackup.username')}
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
            />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder={t('cloudBackup.password')}
              placeholderTextColor={colors.faint}
              secureTextEntry
              textContentType="password"
              onSubmitEditing={() => void connectOwn()}
            />
            <Text style={styles.hint}>{t('cloudBackup.passwordHint')}</Text>
            <PillButton
              label={busy ? t('cloudBackup.connecting') : t('cloudBackup.connect')}
              trackId="cloudBackup.connectOwn"
              onPress={busy ? undefined : () => void connectOwn()}
            />
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>{t('cloudBackup.chooseTitle')}</Text>
            <MenuRow
              trackId="cloudBackup.pickOpenTv"
              title={t('cloudBackup.opentv')}
              sub={t('cloudBackup.opentvSub')}
              onPress={busy ? undefined : () => void pickOpenTv()}
            />
            <MenuRow
              trackId="cloudBackup.pickOwn"
              title={t('cloudBackup.own')}
              sub={t('cloudBackup.ownSub')}
              onPress={busy ? undefined : () => setShowForm(true)}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { color: colors.text, fontSize: 15, lineHeight: 21, paddingHorizontal: space.lg, paddingTop: 14 },
  promiseRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    paddingHorizontal: space.lg,
    paddingTop: 14,
    paddingBottom: 6,
  },
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
