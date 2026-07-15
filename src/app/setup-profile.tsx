import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { NavHeader, Screen } from '@/components/ui';
import { hasLibrary, setMeta, wipeAllData } from '@/db';
import { setOnboarded } from '@/session-store';
import { colors, radius, space } from '@/theme';

export default function SetupProfileScreen() {
  const [name, setName] = useState('');
  const valid = name.trim().length >= 2;

  const begin = () => {
    setMeta('username', name.trim());
    setOnboarded(true);
    router.replace('/movies');
  };

  const start = () => {
    if (!valid) return;
    // a fresh start means a fresh library — never someone else's data
    if (hasLibrary()) {
      Alert.alert(
        'Start a fresh library?',
        'This erases the library currently on this phone. Export it first from Settings if you want to keep it.',
        [
          {
            text: 'Erase and start fresh',
            style: 'destructive',
            onPress: () => {
              wipeAllData();
              begin();
            },
          },
          { text: 'Cancel', style: 'cancel' },
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
      <View style={{ paddingHorizontal: space.xl, gap: 18, marginTop: 12 }}>
        <Text style={styles.title}>What should we call you?</Text>
        <Text style={styles.sub}>
          Just a display name — it lives on your phone, nowhere else. You can change it anytime, and if
          accounts ever go online you'll claim your real username then.
        </Text>

        <View style={styles.avatar}>
          <Text style={styles.avatarLetter}>{(name.trim()[0] ?? '?').toUpperCase()}</Text>
        </View>

        <TextInput
          style={styles.input}
          placeholder="Your name"
          placeholderTextColor={colors.faint}
          value={name}
          onChangeText={setName}
          autoCorrect={false}
          maxLength={24}
          autoFocus
        />

        <Pressable style={[styles.cta, !valid && { opacity: 0.4 }]} onPress={start} disabled={!valid}>
          <Text style={styles.ctaText}>START TRACKING</Text>
        </Pressable>
      </View>
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
