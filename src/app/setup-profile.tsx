import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { hasLibrary, setMeta, wipeAllData } from '@/db';
import { postOnboardingRoute, setOnboarded } from '@/session-store';
import { colors, radius, space } from '@/theme';
import { t } from '@/i18n';

export default function SetupProfileScreen() {
  const [name, setName] = useState('');
  const valid = name.trim().length >= 2;

  const begin = () => {
    setMeta('username', name.trim());
    setOnboarded(true);
    router.replace(postOnboardingRoute());
  };

  const start = () => {
    if (!valid) return;
    // a fresh start means a fresh library — never someone else's data
    if (hasLibrary()) {
      Alert.alert(
        t('setupProfile.freshLibraryTitle'),
        t('setupProfile.freshLibraryBody'),
        [
          {
            text: t('setupProfile.eraseAndStart'),
            style: 'destructive',
            onPress: () => {
              wipeAllData();
              begin();
            },
          },
          { text: t('common.cancel'), style: 'cancel' },
        ],
      );
      return;
    }
    setMeta('libraryOwner', 'fresh');
    begin();
  };

  return (
    <Screen>
      <NavHeader />
      <ContentColumn style={{ paddingHorizontal: space.xl, gap: 18, marginTop: 12 }}>
        <Text style={styles.title}>{t('setupProfile.title')}</Text>
        <Text style={styles.sub}>{t('setupProfile.sub')}</Text>

        <View style={styles.avatar}>
          <Text style={styles.avatarLetter}>{(name.trim()[0] ?? '?').toUpperCase()}</Text>
        </View>

        <TextInput
          style={styles.input}
          placeholder={t('setupProfile.placeholder')}
          placeholderTextColor={colors.faint}
          value={name}
          onChangeText={setName}
          autoCorrect={false}
          maxLength={24}
          autoFocus
        />

        <Pressable style={[styles.cta, !valid && { opacity: 0.4 }]} onPress={start} disabled={!valid}>
          <Text style={styles.ctaText}>{t('setupProfile.startTracking')}</Text>
        </Pressable>
      </ContentColumn>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 28, fontWeight: '800' },
  sub: { color: colors.dim, fontSize: 14.5, marginTop: -8 },
  avatar: {
    alignSelf: 'center',
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.raise,
    borderWidth: 2,
    borderColor: '#E8E8EC',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  avatarLetter: { color: colors.yellow, fontSize: 40, fontWeight: '800' },
  input: {
    backgroundColor: '#1C1C1F',
    borderRadius: radius.card,
    color: colors.text,
    fontSize: 17,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  cta: {
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    alignItems: 'center',
    paddingVertical: 15,
    marginTop: 6,
  },
  ctaText: { color: colors.onYellow, fontSize: 13.5, fontWeight: '800', letterSpacing: 1 },
});
