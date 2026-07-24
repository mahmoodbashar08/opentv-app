import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TextInput, View } from 'react-native';

import { NavHeader, PillButton, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { setUserTvdbKey, tvdbKeyFailed, userTvdbKey } from '@/tvdb';
import { colors, radius, space } from '@/theme';

/**
 * Optional user-supplied TheTVDB key — a safety net for when the app's bundled
 * free-tier key expires, hits quota or is revoked. Purely additive: with no key
 * the app still works, matching just falls back to TMDB (the movie database).
 */
export default function TvdbKeyScreen() {
  const [key, setKey] = useState(userTvdbKey());
  const failed = tvdbKeyFailed();
  const hasOwn = userTvdbKey().length > 0;

  const save = () => {
    setUserTvdbKey(key);
    tapLight();
    Alert.alert(
      key.trim() ? 'Key saved' : 'Key cleared',
      key.trim()
        ? 'OpenTV will use your key for TheTVDB matching. It takes effect on the next lookup.'
        : "Removed — OpenTV falls back to its shared key, then to TMDB.",
      [{ text: 'OK', onPress: () => router.back() }],
    );
  };

  return (
    <Screen>
      <NavHeader title="TheTVDB key" />
      <View style={{ paddingHorizontal: space.lg, gap: 16, flex: 1 }}>
        {failed && !hasOwn && (
          <View style={styles.warn}>
            <Ionicons name="warning-outline" size={18} color={colors.onYellow} />
            <Text style={styles.warnText}>
              The app’s shared TheTVDB key isn’t working right now. Adding your own free key restores full show & movie
              matching. You can also ignore this — OpenTV keeps working using TMDB.
            </Text>
          </View>
        )}

        <Text style={styles.body}>
          OpenTV matches shows and movies against TMDB first, and uses TheTVDB to fill what TMDB can’t. It ships with a
          shared TheTVDB key, so you don’t need one. If that shared key ever stops working, add your own here for the
          most reliable matching.
        </Text>
        <Text style={styles.bodyDim}>
          It’s free: create an account at thetvdb.com, open Dashboard → API, and copy your v4 API key. Stored only on
          this device.
        </Text>

        <View style={styles.inputRow}>
          <Ionicons name="key-outline" size={17} color={colors.dim} />
          <TextInput
            value={key}
            onChangeText={setKey}
            placeholder="Paste your TheTVDB v4 API key"
            placeholderTextColor={colors.faint}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
          />
        </View>

        <PillButton label={key.trim() ? 'Save key' : hasOwn ? 'Clear key' : 'Save'} onPress={save} />
        <Text style={styles.link} onPress={() => void Linking.openURL('https://www.thetvdb.com/dashboard/account/apikey')}>
          Get a free key at thetvdb.com →
        </Text>

        <Text style={styles.status}>
          {hasOwn ? 'Currently using: your own key' : failed ? 'Shared key: not working — falling back to TMDB' : 'Currently using: the shared key'}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  warn: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: colors.yellow,
    borderRadius: radius.card,
    padding: 12,
  },
  warnText: { flex: 1, color: colors.onYellow, fontSize: 13.5, fontWeight: '600', lineHeight: 19 },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  bodyDim: { color: colors.dim, fontSize: 13.5, lineHeight: 20 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1B1B1E',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  input: { flex: 1, color: colors.text, fontSize: 15, padding: 0 },
  link: { color: colors.blue, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  status: { color: colors.faint, fontSize: 12.5, textAlign: 'center', marginTop: 4 },
});
