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
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import {
  backupDestination,
  connectWebdav,
  disconnectServerBackup,
  lastServerBackupAt,
  findServerBackup,
  restoreFromServerBackup,
  serverBackupNow,
  chooseOpenTvCloud,
  webdavAddress,
  type BackupDestination,
} from '@/cloud-backup';
import { hasLibrary } from '@/db';
import { MenuRow, NavHeader, PillButton, Screen } from '@/components/ui';
import { disableSync, lastSyncAt, pendingCount, setSyncEnabled, syncDevices, syncEnabled } from '@/device-sync';
import { usePlus } from '@/plus';
import { tapLight } from '@/haptics';
import { currentLocale, t } from '@/i18n';
import { colors, radius, space } from '@/theme';

export default function CloudBackupScreen() {
  const plus = usePlus();
  /*
   * WHO SENT YOU HERE. "I use my own server" on the Restore screen means a
   * WebDAV box the reader already owns — it needs no OpenTV account and no
   * Plus. Landing on the bare screen answered a different question: if this
   * phone had ever picked OpenTV's server the row read "Backing up to:
   * OpenTV's server" with a Plus notice under it, which is the opposite of
   * what was asked for, and even on a fresh phone it made them choose again
   * having just chosen.
   */
  const { dest: wanted } = useLocalSearchParams<{ dest?: string }>();
  const askedForOwn = wanted === 'own';
  const [dest, setDest] = useState<BackupDestination | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  /** null until somebody picks "your own server" — the form is not the default. */
  const [showForm, setShowForm] = useState(askedForOwn);
  const [url, setUrl] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');

  const [syncOn, setSyncOn] = useState(false);
  const [syncAt, setSyncAt] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(0);

  const reread = useCallback(() => {
    setDest(backupDestination());
    setAt(lastServerBackupAt());
    setSyncOn(syncEnabled());
    setSyncAt(lastSyncAt());
    setWaiting(pendingCount());
  }, []);
  useFocusEffect(reread);

  const label = at
    ? new Date(at).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' })
    : t('cloudBackup.never');

  /* WHAT IS STILL WAITING, said before when it last ran. Somebody who has just
     ticked an episode and opened this screen wants to know it is queued, not
     when the last round trip happened. */
  const syncLabel = waiting > 0
    ? t('deviceSync.waiting', { count: waiting })
    : syncAt
      ? new Date(syncAt).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' })
      : t('cloudBackup.never');

  const runSync = async () => {
    setBusy(true);
    try {
      const out = await syncDevices();
      if (out === 'plus-required') {
        Alert.alert(t('deviceSync.plusTitle'), t('deviceSync.plusBody'));
      } else if (out === 'failed') {
        Alert.alert(t('cloudBackup.failedTitle'), t('deviceSync.failedBody'));
      }
    } finally {
      setBusy(false);
      reread();
    }
  };

  /* TURNING IT ON RELAYS FROM NOW, and says so rather than leaving somebody
     watching an unchanged tablet wondering what broke. The library already
     crosses — that is what the backup above is for. */
  const toggleSync = (on: boolean) => {
    tapLight();
    setSyncOn(on);
    if (on) {
      setSyncEnabled(true);
      Alert.alert(t('deviceSync.onTitle'), t('deviceSync.onBody'));
    } else {
      void disableSync();
    }
    reread();
  };

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
      /*
       * A PHONE WITH NOTHING ON IT CAME HERE TO GET SOMETHING BACK.
       *
       * `connectWebdav` uploads nothing when the library is empty — it must
       * not, or it overwrites the backup being looked for. So "Backed up. Your
       * library is safe off this phone." would be false twice over: nothing was
       * sent, and there is nothing to send. Offer the thing they actually came
       * for instead, and when there is no copy up there, say nothing at all —
       * the row now reads "Backing up to: your own server", which is true.
       */
      if (!hasLibrary()) {
        const found = await findServerBackup();
        if (found) restore();
        return;
      }
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

        {dest && !askedForOwn ? (
          <>
            <MenuRow
              trackId="cloudBackup.connectedTo"
              title={t('cloudBackup.connectedTo')}
              value={dest === 'opentv' ? t('cloudBackup.destOpenTv') : t('cloudBackup.destOwn')}
              sub={dest === 'webdav' ? (webdavAddress() ?? undefined) : undefined}
            />
            {/* STANDING, NOT ON PRESS. The lapse was only discoverable by
                pressing "Back up now" and reading an alert — so a card that
                expired in March was found in June, by which point three months
                of a library had never left the phone. */}
            {dest === 'opentv' && !plus && (
              <MenuRow
                trackId="cloudBackup.lapsed"
                title={t('cloudBackup.plusNeededTitle')}
                sub={t('cloudBackup.lapsedSub')}
                onPress={() => router.push('/paywall')}
              />
            )}
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
            {/*
              SYNC SITS UNDER BACKUP BECAUSE IT DEPENDS ON IT, in two ways
              worth being honest about. It needs the same account, and when a
              device has been away longer than the relay keeps messages, the
              backup is the only thing that can make it current again.

              OpenTV's own cloud only. A WebDAV box holds a file; it has no
              account to key a relay to and nothing to order two devices with.
            */}
            {dest === 'opentv' && (
              <>
                <Text style={styles.sectionTitle}>{t('deviceSync.section')}</Text>
                <MenuRow
                  trackId="deviceSync.on"
                  title={t('deviceSync.on')}
                  sub={t('deviceSync.onSub')}
                  right={
                    <Switch value={syncOn} onValueChange={toggleSync} trackColor={{ true: colors.green }} />
                  }
                />
                {syncOn && (
                  <MenuRow
                    trackId="deviceSync.state"
                    title={t('deviceSync.state')}
                    value={syncLabel}
                    sub={t('deviceSync.stateSub')}
                    onPress={busy ? undefined : () => void runSync()}
                  />
                )}
              </>
            )}
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
