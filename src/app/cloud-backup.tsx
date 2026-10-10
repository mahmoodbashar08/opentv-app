/**
 * Cloud backup — one copy of the library, kept off this phone.
 *
 * TWO DESTINATIONS ON ONE SCREEN, because they answer the same question and
 * splitting them would make somebody choose before understanding the choice.
 * Ours needs Plus and needs no setup; their own server needs three fields and
 * costs nothing, and that trade is stated where it is made rather than in a
 * paywall. A phone pointed at a self-hosted community server has a third
 * case that is really the first: "ours" is theirs, named as such, and needs
 * no Plus (`cloudStorageAllowed`).
 *
 * The privacy line sits above the choice, not below it. This is the one place
 * the library leaves the device, and somebody deciding whether to turn it on
 * needs that before they tap, not after.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

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
import { hasAccount } from '@/community-session';
import { isCustomServer, serverUrl } from '@/server-url';
import { MenuRow, NavHeader, PillButton, Screen } from '@/components/ui';
import { disableSync, lastSyncAt, pendingCount, setSyncEnabled, syncDevices, syncEnabled, syncRefused } from '@/device-sync';
import { cloudStorageAllowed, isPlus, useCloudStorageAllowed } from '@/plus';
import { tapLight } from '@/haptics';
import { currentLocale, t } from '@/i18n';
import { colors, radius, space } from '@/theme';

export default function CloudBackupScreen() {
  /* PLUS, OR A SERVER OF THEIR OWN — see `cloudStorageAllowed` in plus.ts.
     Every "needs Plus" surface on this screen reads this and nothing else, so
     a phone pointed at a self-hosted instance is never sold storage it is
     already paying for (10 Oct). */
  const allowed = useCloudStorageAllowed();
  /* THE WORDS CHANGE WITH THE SERVER. "OpenTV's server — needs Plus" is the
     paywall in a sentence, and on a self-hosted instance both halves are
     false. Read once: changing the server signs out and happens elsewhere,
     so it cannot move while this screen is up. */
  const custom = isCustomServer();
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
  // STATE, not a render-time read: the compiler would memoise `syncRefused()`
  // once and the row would never notice the devices screen letting this phone
  // back in.
  const [refused, setRefused] = useState(false);

  const reread = useCallback(() => {
    setDest(backupDestination());
    setAt(lastServerBackupAt());
    setSyncOn(syncEnabled());
    setSyncAt(lastSyncAt());
    setWaiting(pendingCount());
    setRefused(syncRefused() !== null);
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
        // Their own server saying "needs Plus" is a misconfiguration, not a
        // price — see `runBackup`, which says so in the same words.
        if (custom) Alert.alert(t('cloudBackup.failedTitle'), t('selfHostSync.refused'));
        else Alert.alert(t('deviceSync.plusTitle'), t('deviceSync.plusBody'));
      } else if (out === 'failed') {
        Alert.alert(t('cloudBackup.failedTitle'), t('deviceSync.failedBody'));
      }
    } finally {
      setBusy(false);
      reread();
    }
  };


  /** Ours: chosen, then immediately proven by a real upload — which is also
   *  where a missing subscription is discovered and named. */
  const pickOpenTv = async () => {
    tapLight();
    /**
     * ASK FOR THE ACCOUNT, rather than fail without saying why.
     *
     * This went straight to `runBackup`, which with no token got `unavailable`
     * back and showed "Backup failed" — a dead end whose real cause was never
     * on screen. And the only route to an account was `/join`, so the true
     * answer to "why did my backup fail" was "go and join a community", which
     * nothing told anybody and which nobody should have had to accept for a
     * backup in the first place.
     *
     * `/sign-in` takes a token and nothing else. `next` brings them back here
     * so the thing they actually tapped finishes itself.
     */
    // PLUS FIRST (5 Oct). A free user was sent to sign in, and only after
    // signing in told this needs Plus — with no way to buy from that alert.
    // UNLESS THE SERVER IS THEIRS (10 Oct): this asked the store before the
    // server, so a phone pointed at a self-hosted instance was shown the
    // paywall for storage we were never going to provide. The server itself
    // allows it (`SELF_HOSTED`); see `cloudStorageAllowed`.
    if (!cloudStorageAllowed()) {
      router.push('/paywall?from=cloud-backup');
      return;
    }
    if (!hasAccount()) {
      router.push('/sign-in?next=/cloud-backup');
      return;
    }
    chooseOpenTvCloud();
    setDest('opentv');
    /*
     * SYNC ONLY ONCE A COPY HAS LANDED (8 Oct). A subscriber whose first upload
     * failed got "Backup failed" — and sync switched on anyway, two lines
     * later. Sync then worked for days while no backup ever reached the
     * server, and the green "sync on" read as "safe". Nothing is switched on
     * by a failure now: they try again from this screen and both start
     * together, the promise below intact.
     */
    if (!(await runBackup(true))) {
      reread();
      return;
    }
    /**
     * BACKUP AND SYNC ARE ONE PROMISE, so they are one decision.
     *
     * Two switches for "my library is safe and the same everywhere" meant
     * somebody could buy Plus, turn cloud backup on, own two devices, and never
     * get sync because they never scrolled far enough to find the second one.
     *
     * Only for OUR server: sync relays through it and needs an account, which a
     * WebDAV box does not have. Unconditionally, now that the separate switch
     * is gone — there is no "they turned it off" to respect any more, and
     * leaving an old `0` in place would strand somebody with no way back on.
     *
     * It sends strictly LESS than the backup that was just enabled: a handful
     * of "watched S2E3" messages, pruned after ninety days, against a copy of
     * the whole library.
     */
    setSyncEnabled(true);
    reread();
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

  /** True when a copy reached the server (or there was nothing new to send). */
  const runBackup = async (quiet = false): Promise<boolean> => {
    setBusy(true);
    try {
      let r = await serverBackupNow(true);
      /*
       * PAID HERE, NOT YET KNOWN THERE. A purchase made before signing in
       * reaches the server only after sign-in, as a RevenueCat TRANSFER that
       * takes a few seconds -- and the first backup runs the moment sign-in
       * returns. Taking the server's "needs Plus" at its word would switch
       * cloud backup off for somebody who has paid, which is exactly the
       * subscriber this screen was rebuilt for. So while THIS phone holds the
       * entitlement, wait for the server to catch up before believing it.
       */
      for (let i = 0; r === 'plus-required' && isPlus() && i < 4; i++) {
        await new Promise((ok) => setTimeout(ok, 4000));
        r = await serverBackupNow(true);
      }
      if (r === 'plus-required') {
        // Turned back off rather than left connected-but-failing: a row that
        // says "backing up" while nothing is being backed up is the worst
        // possible state for a feature whose whole job is a promise.
        await disconnectServerBackup();
        reread();
        // ON A SERVER OF THEIR OWN this answer is a misconfiguration, not a
        // price: the Docker server allows everyone (`SELF_HOSTED`), so say
        // what the server said and where the switch is — never "needs Plus",
        // and never "our server costs us storage" about a disk that is theirs.
        if (custom) Alert.alert(t('cloudBackup.failedTitle'), t('selfHostSync.refused'));
        else Alert.alert(t('cloudBackup.plusNeededTitle'), t('cloudBackup.plusNeededBody'));
        return false;
      }
      if (r === 'failed' || r === 'unavailable') {
        Alert.alert(t('cloudBackup.failedTitle'), t('cloudBackup.failedBody'));
        return false;
      }
      reread();
      if (!quiet) Alert.alert(t('cloudBackup.doneTitle'), t('cloudBackup.doneBody'));
      return true;
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
          /*
           * AND SYNC WITH IT. They were two switches and are one promise now,
           * so turning the copy off has to stop the relay as well — otherwise
           * somebody who asked for all of it to stop keeps telling their other
           * devices what they watched, with nothing on screen admitting it.
           * `disableSync` also clears what is still in flight on the server.
           */
          void disconnectServerBackup()
            .then(() => disableSync())
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
            {/* A custom server is named as theirs, with its address — for the
                reason the WebDAV row shows one: "yours" only answers "where?"
                when it says which. */}
            <MenuRow
              trackId="cloudBackup.connectedTo"
              title={t('cloudBackup.connectedTo')}
              value={dest === 'webdav' ? t('cloudBackup.destOwn') : custom ? t('selfHostSync.dest') : t('cloudBackup.destOpenTv')}
              sub={dest === 'webdav' ? (webdavAddress() ?? undefined) : custom ? serverUrl() : undefined}
            />
            {/* STANDING, NOT ON PRESS. The lapse was only discoverable by
                pressing "Back up now" and reading an alert — so a card that
                expired in March was found in June, by which point three months
                of a library had never left the phone. */}
            {/* NOT ON YOUR OWN SERVER. Plus keeps the hosted side free for
                everybody else; somebody running their own instance is already
                paying for theirs, and their server does not gate them (see
                `SELF_HOSTED`). A lapse notice there would be selling them
                something they do not need. */}
            {dest === 'opentv' && !allowed && (
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
            {/* NO SWITCH OF ITS OWN ANY MORE.
                Keeping one copy off your phones and keeping those phones equal
                are two halves of one promise — "my library is safe and the same
                everywhere" — and asking for them separately meant somebody
                could buy Plus, turn backup on, own two devices and never get
                sync because they did not scroll far enough.
                They are also not interchangeable, which is why BOTH still run:
                a backup cannot carry a deletion (a ZIP is a list of what you
                have) and sync cannot furnish an empty phone (it relays what
                happens next). Each covers the other's blind spot; neither is a
                decision a reader should have to make.
                The row below stays, because "is it up to date, and can I make
                it happen now" is a fair question to be able to ask. */}
            {/* PAUSED, SAID WHY. With Plus gone the server refuses every push, and
                this row used to read "3 changes waiting" for ever with no reason. */}
            {dest === 'opentv' && syncOn && (
              <MenuRow
                trackId="deviceSync.state"
                title={t('deviceSync.state')}
                value={!allowed ? t('deviceSync.paused') : syncLabel}
                sub={!allowed ? t('deviceSync.plusBody') : t('deviceSync.stateSub')}
                onPress={busy ? undefined : () => void runSync()}
              />
            )}
            {/* WHENEVER BACKUP IS OURS, not only while sync is on: a phone the
                server turned away has sync off, and this row is its way back. */}
            {dest === 'opentv' && (
              <MenuRow
                trackId="devices.open"
                title={t('devices.title')}
                sub={refused ? t('devices.offSub') : t('devices.entrySub')}
                onPress={() => router.push('/devices')}
              />
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
            {/* ON A SERVER OF THEIR OWN the first row is their server, not
                ours, and it is free — the same row under its own name. */}
            <MenuRow
              trackId="cloudBackup.pickOpenTv"
              title={custom ? t('selfHostSync.dest') : t('cloudBackup.opentv')}
              sub={custom ? t('selfHostSync.destSub') : t('cloudBackup.opentvSub')}
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
