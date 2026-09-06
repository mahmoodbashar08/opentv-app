/**
 * Running OpenTV entirely yourself: your server, your TMDB token, your
 * TheTVDB key.
 *
 * THREE FIELDS, AND ALL THREE ARE REQUIRED TOGETHER. Pointing the app at your
 * own server while it still fetches every poster on OUR keys is half a move:
 * the community data is yours and the metadata traffic is still ours, issued
 * to our application under terms that name us. Somebody who decides to run
 * this themselves should not end up quietly depending on the person they were
 * leaving. So the switch takes all three or none.
 *
 * AND THE KEYS ARE TESTED BEFORE ANYTHING IS SAVED. A required field whose
 * value is wrong is worse than an optional one: the app would come back with
 * no artwork, no titles and nothing on screen explaining why. One call each —
 * TMDB's `/configuration`, TheTVDB's `/login` — and a rejected key never
 * reaches the database. A NETWORK failure is not a rejection and is reported
 * as itself, because refusing a good key on a bad connection is the error that
 * would be impossible to argue with.
 *
 * LEAVING IS ONE FIELD. Clear the address and the app goes back to the
 * official server; the keys stay, because they are yours and they work
 * either way.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { switchServer } from '@/community-account';
import { NavHeader, PillButton, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { isCustomServer, officialServerUrl, serverUrl } from '@/server-url';
import { normaliseServerUrl } from '@/pure';
import { checkTmdbToken, setUserTmdbToken, userTmdbToken } from '@/tmdb';
import { checkTvdbKey, setUserTvdbKey, userTvdbKey } from '@/tvdb';
import { colors, radius, space } from '@/theme';

export default function SelfHostScreen() {
  const [url, setUrl] = useState(() => (isCustomServer() ? serverUrl() : ''));
  const [tmdb, setTmdb] = useState(userTmdbToken);
  const [tvdb, setTvdb] = useState(userTvdbKey);
  const [busy, setBusy] = useState(false);

  const wantsCustom = url.trim() !== '';
  const ready = !wantsCustom || (tmdb.trim() !== '' && tvdb.trim() !== '');

  /** Back to the official server. The keys are left alone — see the header. */
  const goOfficial = () => {
    Alert.alert(t('selfHost.resetTitle'), t('settings.data.serverConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.data.serverConfirmAction'),
        style: 'destructive',
        onPress: () => {
          void switchServer(null).then(() => router.back());
        },
      },
    ]);
  };

  const save = async () => {
    if (!wantsCustom) {
      goOfficial();
      return;
    }
    const next = normaliseServerUrl(url);
    if (next === null) {
      Alert.alert(t('settings.data.serverBadTitle'), t('settings.data.serverBadBody'));
      return;
    }
    tapLight();
    setBusy(true);
    // Both at once: two round trips one after the other is twice the wait for
    // no more certainty.
    const [tm, tv] = await Promise.all([checkTmdbToken(tmdb), checkTvdbKey(tvdb)]);
    setBusy(false);
    if (tm === 'unreachable' || tv === 'unreachable') {
      Alert.alert(t('selfHost.checkFailedTitle'), t('selfHost.checkFailedBody'));
      return;
    }
    if (tm === 'bad' || tv === 'bad') {
      Alert.alert(
        t('selfHost.keyBadTitle'),
        tm === 'bad' && tv === 'bad' ? t('selfHost.keyBadBoth') : tm === 'bad' ? t('selfHost.keyBadTmdb') : t('selfHost.keyBadTvdb'),
      );
      return;
    }
    Alert.alert(t('settings.data.serverConfirmTitle'), t('settings.data.serverConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.data.serverConfirmAction'),
        style: 'destructive',
        onPress: () => {
          // The keys first: `switchServer` signs out and the screen closes on
          // its promise, so writing them afterwards would race the unmount.
          setUserTmdbToken(tmdb);
          setUserTvdbKey(tvdb);
          void switchServer(next).then(() => router.back());
        },
      },
    ]);
  };

  return (
    <Screen>
      <NavHeader title={t('selfHost.title')} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>{t('selfHost.intro')}</Text>

        <Text style={styles.label}>{t('settings.data.server')}</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder={t('selfHost.serverHint')}
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Text style={styles.hint}>{t('selfHost.serverNote')}</Text>

        {/* Shown always, required only when an address is typed: somebody
            reading this screen should see what running it themselves costs
            before they decide, not after. */}
        <Text style={styles.label}>{t('selfHost.tmdbLabel')}</Text>
        <TextInput
          style={styles.input}
          value={tmdb}
          onChangeText={setTmdb}
          placeholder={t('selfHost.tmdbHint')}
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.link} onPress={() => void Linking.openURL('https://www.themoviedb.org/settings/api').catch(() => {})}>
          {t('selfHost.tmdbGet')}
        </Text>

        <Text style={styles.label}>{t('settings.app.tvdbKey')}</Text>
        <TextInput
          style={styles.input}
          value={tvdb}
          onChangeText={setTvdb}
          placeholder={t('selfHost.tvdbHint')}
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.link} onPress={() => void Linking.openURL('https://thetvdb.com/api-information').catch(() => {})}>
          {t('selfHost.tvdbGet')}
        </Text>

        {wantsCustom && !ready && <Text style={styles.required}>{t('selfHost.bothRequired')}</Text>}

        <View style={{ height: 10 }} />
        {busy ? (
          <ActivityIndicator color={colors.yellow} />
        ) : (
          <PillButton
            label={wantsCustom ? t('selfHost.save') : t('selfHost.useOfficial')}
            trackId="selfHost.save"
            onPress={ready ? () => void save() : undefined}
          />
        )}
        <Text style={styles.foot}>{t('selfHost.foot', { url: officialServerUrl().replace(/^https?:\/\//, '') })}</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.lg, paddingBottom: 48, gap: 6 },
  intro: { color: colors.text, fontSize: 15, lineHeight: 21, paddingVertical: 12 },
  label: { color: colors.faint, fontSize: 12, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase', marginTop: 16 },
  input: {
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: radius.card,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    marginTop: 6,
  },
  hint: { color: colors.dim, fontSize: 12.5, lineHeight: 17, marginTop: 6 },
  link: { color: colors.blue, fontSize: 13, marginTop: 8 },
  required: { color: colors.yellow, fontSize: 13, fontWeight: '700', marginTop: 18 },
  foot: { color: colors.faint, fontSize: 12, lineHeight: 17, marginTop: 18 },
});
