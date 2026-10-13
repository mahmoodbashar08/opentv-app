/**
 * Nuvio — sign in with a Nuvio account and bring in the episodes watched there.
 *
 * THE STREMIO SCREEN, because it is the same deal: email and password (Nuvio
 * offers nothing else to a third party), the password used once for a session
 * kept in the Keychain and never stored, then Last checked / Check now /
 * Disconnect. Read-only, tracked shows only.
 *
 * ONE STEP STREMIO DOES NOT HAVE: a Nuvio account holds up to six profiles,
 * each with its own history, and a family's shared account would otherwise
 * tick everyone's episodes into one library. With more than one, the user
 * picks theirs before the first sync. Changing it later is disconnect and
 * sign in again — rare enough not to need its own row.
 *
 * WHEN IT BREAKS, IT SAYS WHERE TO GO. Nuvio's API is theirs to change; a
 * failed check says nothing was touched and points at Simkl, which Nuvio
 * scrobbles to natively.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { MenuRow, NavHeader, PillButton, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { nuvioProfiles, nuvioSignIn } from '@/nuvio';
import { disconnectNuvio, getNuvioSession, nuvioEmail, nuvioProfileChoices, nuvioSyncedAt, setNuvioProfile, setNuvioSession, syncNuvio } from '@/nuvio-sync';
import { colors, radius, space } from '@/theme';

export default function NuvioScreen() {
  const [connected, setConnected] = useState(false);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  /** Non-null while the user is choosing a profile, right after signing in. */
  const [profiles, setProfiles] = useState<{ index: number; name: string }[] | null>(null);
  /** Signed in, but the picker was left without choosing: nothing syncs until it is. */
  const [needsProfile, setNeedsProfile] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const s = await getNuvioSession();
        setConnected(s != null);
        setNeedsProfile(s?.profile === 0);
        setLastSync(nuvioSyncedAt());
      })();
    }, []),
  );

  const run = async () => {
    setBusy(true);
    const out = await syncNuvio();
    setBusy(false);
    setLastSync(nuvioSyncedAt());
    if (!out.ran) {
      Alert.alert(t('nuvio.title'), t('nuvio.syncFailed'), [
        { text: t('common.ok'), style: 'cancel' },
        { text: t('simkl.title'), onPress: () => router.push('/simkl') },
      ]);
      return;
    }
    Alert.alert(t('nuvio.title'), out.applied > 0 ? t('plex.applied', { count: out.applied }) : t('plex.nothingNew'));
  };

  const connect = async () => {
    if (!user.trim() || !password) {
      Alert.alert(t('nuvio.title'), t('nuvio.needLogin'));
      return;
    }
    tapLight();
    setBusy(true);
    const session = await nuvioSignIn(user.trim(), password);
    if (!session) {
      setBusy(false);
      Alert.alert(t('nuvio.failedTitle'), t('nuvio.failedBody'));
      return;
    }
    await setNuvioSession(session);
    // The password has done its one job.
    setPassword('');
    const list = await nuvioProfiles(session.access);
    setBusy(false);
    setConnected(true);
    if (list && list.length > 1) {
      setNeedsProfile(true);
      setProfiles(list);
      return;
    }
    // One profile, or Nuvio would not say: the first is the only sensible one.
    await setNuvioProfile(list?.[0]?.index ?? 1);
    void run();
  };

  const choose = async () => {
    setBusy(true);
    const list = await nuvioProfileChoices();
    setBusy(false);
    if (!list || list.length === 0) {
      Alert.alert(t('nuvio.title'), t('nuvio.syncFailed'));
      return;
    }
    setProfiles(list);
  };

  const pick = async (index: number) => {
    tapLight();
    setProfiles(null);
    setNeedsProfile(false);
    await setNuvioProfile(index);
    void run();
  };

  const cut = () => {
    Alert.alert(t('nuvio.disconnectTitle'), t('plex.disconnectBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('plex.disconnect'),
        style: 'destructive',
        onPress: () => {
          void disconnectNuvio().then(() => {
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
      <NavHeader title={t('nuvio.title')} close />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>{t('nuvio.intro')}</Text>
        <View style={styles.promiseRow}>
          <Ionicons name="lock-closed-outline" size={16} color={colors.dim} />
          <Text style={styles.promise}>{t('nuvio.rules')}</Text>
        </View>

        {profiles != null ? (
          <>
            <Text style={styles.sectionTitle}>{t('nuvio.profileTitle')}</Text>
            {/* Six at most (Nuvio's own limit), so a plain map. */}
            {profiles.map((p) => (
              <MenuRow key={p.index} trackId="nuvio.profile" title={p.name || String(p.index)} onPress={() => void pick(p.index)} />
            ))}
          </>
        ) : connected ? (
          <>
            <Text style={styles.sectionTitle}>{t('plex.connected')}</Text>
            <MenuRow trackId="nuvio.account" title={t('nuvio.account')} value={nuvioEmail() ?? ''} />
            {needsProfile ? (
              <MenuRow trackId="nuvio.chooseProfile" title={t('nuvio.profileTitle')} onPress={busy ? undefined : () => void choose()} />
            ) : (
              <>
                <MenuRow trackId="nuvio.lastSync" title={t('plex.lastSync')} value={syncedLabel} />
                <MenuRow trackId="nuvio.syncNow" title={busy ? t('plex.syncing') : t('plex.syncNow')} onPress={busy ? undefined : () => void run()} />
              </>
            )}
            <MenuRow trackId="nuvio.disconnect" title={t('plex.disconnect')} danger onPress={cut} />
          </>
        ) : (
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              value={user}
              onChangeText={setUser}
              placeholder={t('nuvio.email')}
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
              placeholder={t('nuvio.password')}
              placeholderTextColor={colors.faint}
              secureTextEntry
              textContentType="password"
              onSubmitEditing={() => void connect()}
            />
            <Text style={styles.hint}>{t('nuvio.passwordHint')}</Text>
            <PillButton label={busy ? t('nuvio.connecting') : t('nuvio.connect')} trackId="nuvio.connect" onPress={busy ? undefined : () => void connect()} />
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
  input: { backgroundColor: colors.card, color: colors.text, borderRadius: radius.card, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15 },
  hint: { color: colors.faint, fontSize: 12.5, lineHeight: 17, paddingBottom: 8 },
});
