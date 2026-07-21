import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { File, Paths } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PromptModal } from '@/components/prompt-modal';
import { Screen } from '@/components/ui';
import seed from '@/seed';
import { getMeta, setMeta } from '@/db';
import { isSeedLibrary, profileImageUri } from '@/library';
import { colors, space } from '@/theme';

const SEED_AVATAR = require('../../assets/profile/avatar.jpg');
const SEED_COVER = require('../../assets/profile/cover.jpg');

// "IQ" → "Iraq"; falls back to the raw code if Intl can't help
function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    return dn.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

function Field({ label, value, onPress }: { label: string; value: string | null; onPress: () => void }) {
  return (
    <Pressable style={styles.field} onPress={onPress}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={value ? styles.fieldValue : styles.fieldAdd}>{value ?? 'Add'}</Text>
    </Pressable>
  );
}

export default function EditProfileScreen() {
  const [, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);
  // re-read meta when returning from the cover picker
  useFocusEffect(
    useCallback(() => {
      setTick((t) => t + 1);
    }, []),
  );
  const seedLib = isSeedLibrary();

  const username = getMeta('username') ?? (seedLib ? seed.profile.username : 'opentv-user');
  const birthYear = getMeta('birthYear');
  const gender = getMeta('gender');
  const country = getMeta('country') ?? countryName(getMeta('countryCode'));
  const avatarUri = profileImageUri('avatar');
  const coverUri = profileImageUri('cover');

  const save = (key: string, value: string) => {
    setMeta(key, value.trim());
    refresh();
  };

  // Alert.prompt is iOS-only (a no-op on Android), so profile fields couldn't be
  // edited there at all. Drive a cross-platform PromptModal from state instead.
  const [promptCfg, setPromptCfg] = useState<{
    title: string;
    key: string;
    current: string;
    validate?: (v: string) => boolean;
    keyboard: 'default' | 'number-pad';
  } | null>(null);

  const prompt = (
    title: string,
    key: string,
    current: string | null,
    validate?: (v: string) => boolean,
    keyboard: 'default' | 'number-pad' = 'default',
  ) => {
    setPromptCfg({ title, key, current: current ?? '', validate, keyboard });
  };

  const pickGender = () => {
    Alert.alert('Gender', undefined, [
      ...['Male', 'Female', 'Non-binary', 'Prefer not to say'].map((g) => ({
        text: g,
        onPress: () => save('gender', g),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  // avatar comes from your photo library; the cover is TV Time-style — fanart
  // from one of your shows/movies, picked on its own screen
  const pickPhoto = async (kind: 'avatar') => {
    // probe for the native module without crashing — it only exists after the
    // next rebuild bakes it in (requireOptionalNativeModule returns null, never throws)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo-modules-core') as typeof import('expo-modules-core');
    if (!requireOptionalNativeModule('ExponentImagePicker')) {
      Alert.alert('One more build needed', 'Photo picking arrives with the next rebuild (npx expo run:ios --device).');
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ImagePicker = require('expo-image-picker') as typeof import('expo-image-picker');
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (res.canceled || !res.assets?.[0]) return;
      // unique filename per change — expo-image caches by uri
      const name = `profile-${kind}-${Date.now()}.jpg`;
      const old = getMeta(`${kind}File`);
      new File(res.assets[0].uri).copy(new File(Paths.document, name));
      setMeta(`${kind}File`, name);
      if (old) {
        try {
          const f = new File(Paths.document, old);
          if (f.exists) f.delete();
        } catch {}
      }
      refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('native module') || msg.includes('ExponentImagePicker')) {
        Alert.alert('One more build needed', 'Photo picking arrives with the next rebuild (npx expo run:ios --device).');
      } else {
        Alert.alert('Could not set photo', msg);
      }
    }
  };

  return (
    <Screen>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headTitle}>Edit profile</Text>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>SAVE</Text>
        </Pressable>
      </View>
      <ScrollView>
        <Pressable style={styles.photoRow} onPress={() => pickPhoto('avatar')}>
          <View style={styles.avatar}>
            {avatarUri != null ? (
              <Image source={{ uri: avatarUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : seedLib ? (
              <Image source={SEED_AVATAR} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <Text style={{ color: colors.yellow, fontWeight: '800', fontSize: 22 }}>
                {username[0]?.toUpperCase() ?? '?'}
              </Text>
            )}
          </View>
          <Text style={styles.link}>Choose profile photo</Text>
        </Pressable>
        <Pressable style={styles.photoRow} onPress={() => router.push('/cover-picker')}>
          <View style={[styles.avatar, { borderRadius: 8, overflow: 'hidden' }]}>
            {coverUri != null ? (
              <Image source={{ uri: coverUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : seedLib ? (
              <Image source={SEED_COVER} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : null}
          </View>
          <Text style={styles.link}>Choose cover photo</Text>
        </Pressable>
        <Field label="Display name" value={username} onPress={() => prompt('Display name', 'username', username)} />
        <Text style={styles.sectionTitle}>Personal information</Text>
        <Field
          label="Birth year"
          value={birthYear}
          onPress={() =>
            prompt('Birth year', 'birthYear', birthYear, (v) => /^\d{4}$/.test(v) && Number(v) >= 1900 && Number(v) <= 2026, 'number-pad')
          }
        />
        <Field label="Gender" value={gender} onPress={pickGender} />
        <Field label="Country" value={country} onPress={() => prompt('Country', 'country', country)} />
      </ScrollView>
      <PromptModal
        visible={promptCfg != null}
        title={promptCfg?.title ?? ''}
        initial={promptCfg?.current ?? ''}
        keyboardType={promptCfg?.keyboard}
        onCancel={() => setPromptCfg(null)}
        onSubmit={(v) => {
          const val = v.trim();
          if (!val) {
            setPromptCfg(null); // empty = cancel
            return true;
          }
          if (promptCfg?.validate && !promptCfg.validate(val)) return false; // invalid → keep open to fix
          if (promptCfg) save(promptCfg.key, val);
          setPromptCfg(null);
          return true;
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: 12,
  },
  headTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1B1B1E',
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.raise,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  link: { color: colors.blue, fontSize: 16, fontWeight: '500' },
  field: { paddingHorizontal: space.lg, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1B1B1E' },
  fieldLabel: { color: colors.text, fontSize: 16 },
  fieldValue: { color: colors.blue, fontSize: 15.5, marginTop: 4 },
  fieldAdd: { color: colors.faint, fontSize: 15.5, marginTop: 4 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700', paddingHorizontal: space.lg, paddingTop: 20, paddingBottom: 4 },
});
