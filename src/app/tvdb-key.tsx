import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TextInput, View } from 'react-native';

import { NavHeader, PillButton, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
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
      key.trim() ? t('tvdbKey.keySavedTitle') : t('tvdbKey.keyClearedTitle'),
      key.trim() ? t('tvdbKey.keySavedBody') : t('tvdbKey.keyClearedBody'),
      [{ text: t('common.ok'), onPress: () => router.back() }],
    );
  };

  return (
    <Screen>
      <NavHeader title={t('tvdbKey.title')} />
      <View style={{ paddingHorizontal: space.lg, gap: 16, flex: 1 }}>
        {failed && !hasOwn && (
          <View style={styles.warn}>
            <Ionicons name="warning-outline" size={18} color={colors.onYellow} />
            <Text style={styles.warnText}>{t('tvdbKey.warningText')}</Text>
          </View>
        )}

        <Text style={styles.body}>{t('tvdbKey.body')}</Text>
        <Text style={styles.bodyDim}>{t('tvdbKey.bodyDim')}</Text>

        <View style={styles.inputRow}>
          <Ionicons name="key-outline" size={17} color={colors.dim} />
          <TextInput
            value={key}
            onChangeText={setKey}
            placeholder={t('tvdbKey.placeholder')}
            placeholderTextColor={colors.faint}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
          />
        </View>

        <PillButton
          label={key.trim() ? t('tvdbKey.saveKey') : hasOwn ? t('tvdbKey.clearKey') : t('tvdbKey.save')}
          onPress={save}
        />
        <Text style={styles.link} onPress={() => void Linking.openURL('https://www.thetvdb.com/dashboard/account/apikey')}>
          {t('tvdbKey.getFreeKey')}
        </Text>

        <Text style={styles.status}>
          {hasOwn ? t('tvdbKey.statusOwn') : failed ? t('tvdbKey.statusSharedFailed') : t('tvdbKey.statusShared')}
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
    backgroundColor: colors.card,
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
