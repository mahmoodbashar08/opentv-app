import Ionicons from '@expo/vector-icons/Ionicons';
import { File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { hasLibrary, setMeta, wipeAllData } from '@/db';
import { router } from 'expo-router';
import { colors, radius, space } from '@/theme';
import { t } from '@/i18n';

export default function SetupProfileScreen() {
  const [name, setName] = useState('');
  // The picked photo, kept here until Start: a fresh start may erase the old
  // library (and its meta) first, which would take the avatar with it.
  const [photo, setPhoto] = useState<string | null>(null);
  const valid = name.trim().length >= 2;

  /*
   * A PICTURE, OFFERED (8 Oct). The circle showed your initial and nothing
   * said it could be anything else — the photo lived only in Edit profile,
   * which a new user has never seen. Optional, from the photo library, the
   * same square crop Edit profile uses.
   */
  const pickPhoto = async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo-modules-core') as typeof import('expo-modules-core');
    if (!requireOptionalNativeModule('ExponentImagePicker')) {
      Alert.alert(t('import.buildNeededTitle'), t('editProfile.photoBuildNeededBody'));
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ImagePicker = require('expo-image-picker') as typeof import('expo-image-picker');
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
      if (res.canceled || !res.assets?.[0]) return;
      setPhoto(res.assets[0].uri);
    } catch (err) {
      Alert.alert(t('editProfile.couldNotSetPhotoTitle'), err instanceof Error ? err.message : String(err));
    }
  };

  const begin = () => {
    setMeta('username', name.trim());
    if (photo) {
      try {
        // Unique per change — expo-image caches by uri.
        const file = `profile-avatar-${Date.now()}.jpg`;
        new File(photo).copy(new File(Paths.document, file));
        setMeta('avatarFile', file);
      } catch {
        // The name matters more than the picture; it can be added later.
      }
    }
    // Not straight into an empty library: pick some shows first (1.6.7).
    // That screen finishes onboarding on Continue or Skip.
    router.replace('/pick-shows?from=onboarding');
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

        <Pressable onPress={() => void pickPhoto()} style={styles.avatar} accessibilityRole="button" accessibilityLabel={t('setupProfile.addPhoto')}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.avatarImage} contentFit="cover" />
          ) : (
            <Text style={styles.avatarLetter}>{(name.trim()[0] ?? '?').toUpperCase()}</Text>
          )}
          <View style={styles.cameraBadge}>
            <Ionicons name="camera" size={15} color={colors.onYellow} />
          </View>
        </Pressable>
        <Pressable onPress={() => void pickPhoto()} hitSlop={8} style={{ alignSelf: 'center', marginTop: -6 }}>
          <Text style={styles.photoLink}>{photo ? t('setupProfile.changePhoto') : t('setupProfile.addPhoto')}</Text>
        </Pressable>

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
  avatarImage: { width: 92, height: 92, borderRadius: 46 },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.yellow,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoLink: { color: colors.blue, fontSize: 15, fontWeight: '700' },
  input: {
    backgroundColor: colors.card,
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
