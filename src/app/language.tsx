import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { currentLocale, hasLocaleOverride, setLocale, t } from '@/i18n';
import { SUPPORTED, type Locale } from '@/locale-resolve';
import { colors, radius, space } from '@/theme';

/** Each language named in itself — a Spanish speaker looks for "Español". */
export const NAMES: Record<Locale, string> = {
  en: 'English',
  ar: 'العربية',
  it: 'Italiano',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  fr: 'Français',
};

export default function LanguageScreen() {
  const [active, setActive] = useState<Locale>(currentLocale());
  const [isSystem, setIsSystem] = useState<boolean>(() => !hasLocaleOverride());

  const pick = (locale: Locale | null) => {
    const { needsRestart } = setLocale(locale);
    setActive(currentLocale());
    setIsSystem(locale === null);
    if (!needsRestart) return;
    // crossing into or out of Arabic: React Native only flips direction at
    // startup, so say so rather than appearing to have done nothing. Shown
    // immediately, synchronously with the tap — before the user can navigate
    // away and forget the app is now in a half-changed state.
    Alert.alert(t('language.restartTitle'), t('language.restartBody'), [
      { text: t('language.restartConfirm'), onPress: () => router.back() },
    ]);
  };

  return (
    <Screen>
      <NavHeader title={t('language.title')} />
      <ScrollView contentContainerStyle={{ paddingVertical: 12 }}>
        <ContentColumn>
          <Pressable style={styles.row} onPress={() => pick(null)}>
            <Text style={styles.name}>{t('language.system')}</Text>
            {isSystem && <Ionicons name="checkmark" size={20} color={colors.yellow} />}
          </Pressable>
          {SUPPORTED.map((locale) => (
            <Pressable key={locale} style={styles.row} onPress={() => pick(locale)}>
              <Text style={styles.name}>{NAMES[locale]}</Text>
              {!isSystem && active === locale && <Ionicons name="checkmark" size={20} color={colors.yellow} />}
            </Pressable>
          ))}
        </ContentColumn>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    marginHorizontal: space.lg,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
});
