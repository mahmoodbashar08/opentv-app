import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { File, Paths } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { appearanceChanged } from '@/community-appearance';
import { communityErrorText } from '@/community-error-text';
import { useJoined } from '@/community-session';
import { PromptModal } from '@/components/prompt-modal';
import { ContentColumn, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import seed from '@/seed';
import { getMeta, setMeta } from '@/db';
import { pushDisplayName, pushHiddenSections } from '@/community-profiles';
import {
  HIDDEN_SECTIONS_KEY,
  PROFILE_SECTIONS,
  parseHiddenSections,
  sectionHidden,
  withSectionHidden,
  type ProfileSection,
} from '@/pure';
import { isSeedLibrary, profileImageUri, visibleCoverUri } from '@/library';
import { usePlus } from '@/plus';
import { colors, space } from '@/theme';
import { t } from '@/i18n';
import type { LocaleKey } from '@/locales/keys';

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
      <Text style={value ? styles.fieldValue : styles.fieldAdd}>{value ?? t('editProfile.add')}</Text>
    </Pressable>
  );
}

/** The label for each switch. One map, so the order on screen is the order the
 *  sections are drawn in on a profile — top to bottom, as the reader meets them. */
const SECTION_LABEL: Record<ProfileSection, LocaleKey> = {
  stats: 'stats.title',
  activity: 'plus.activity.title',
  lists: 'profile.sectionLists',
  favourite_shows: 'profile.sectionFavoriteShows',
  favourite_movies: 'profile.sectionFavoriteMovies',
  shows: 'stats.headers.shows',
  movies: 'stats.headers.movies',
  comments: 'profile.statComments',
};

export default function EditProfileScreen() {
  // Subscribed, not read once: the banner has to change the moment a purchase
  // or a lapse lands, without navigating away and back.
  const plus = usePlus();
  const [, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);
  const joined = useJoined();
  /**
   * WHAT PEOPLE SEE. Held in state, not read from meta in render — a render-time
   * `getMeta` is memoised by the Compiler against its arguments and the switch
   * would stop moving. See CLAUDE.md.
   *
   * The local copy is written only after the PATCH succeeds, so a switch that
   * could not reach the server goes back where it was rather than leaving this
   * phone believing something the profile does not do.
   */
  const [hidden, setHidden] = useState<readonly ProfileSection[]>(() =>
    parseHiddenSections(getMeta(HIDDEN_SECTIONS_KEY)),
  );
  const [sectionBusy, setSectionBusy] = useState(false);
  const toggleSection = (section: ProfileSection, show: boolean) => {
    if (sectionBusy) return;
    tapLight();
    const before = hidden;
    const next = withSectionHidden(before, section, !show);
    setHidden(next);
    setSectionBusy(true);
    void pushHiddenSections(next)
      .then(() => setMeta(HIDDEN_SECTIONS_KEY, JSON.stringify(next)))
      .catch((e: unknown) => {
        setHidden(before);
        Alert.alert(t('editProfile.visibility.failedTitle'), communityErrorText(e));
      })
      .finally(() => setSectionBusy(false));
  };
  // re-read meta when returning from the cover picker
  useFocusEffect(
    useCallback(() => {
      setTick((t) => t + 1);
      setHidden(parseHiddenSections(getMeta(HIDDEN_SECTIONS_KEY)));
    }, []),
  );
  const seedLib = isSeedLibrary();

  const username = getMeta('username') ?? (seedLib ? seed.profile.username : 'opentv-user');
  const birthYear = getMeta('birthYear');
  const gender = getMeta('gender');
  const country = getMeta('country') ?? countryName(getMeta('countryCode'));
  const avatarUri = profileImageUri('avatar');
  /*
   * THE SAME BANNER THE PROFILE SHOWS, which it did not used to be. This read
   * the stored file directly, so somebody whose Plus had lapsed saw artwork on
   * their profile and their old GIF here — two screens disagreeing about what
   * their banner is, in the one place they had gone to change it.
   */
  const coverUri = visibleCoverUri(plus);

  const save = (key: string, value: string) => {
    setMeta(key, value.trim());
    refresh();
    // AND TO THE SERVER, for the one field other people can see. The local
    // write is the one that matters and happens first; the push is silent and
    // retried on the next edit or sign-in. Before this, a name typed here
    // never left the phone and every public profile showed a bare @handle.
    if (key === 'username') void pushDisplayName(value);
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
    Alert.alert(t('editProfile.gender'), undefined, [
      ...(
        [
          ['editProfile.genderMale', 'Male'],
          ['editProfile.genderFemale', 'Female'],
          ['editProfile.genderNonBinary', 'Non-binary'],
          ['editProfile.genderPreferNotSay', 'Prefer not to say'],
        ] as const
      ).map(([labelKey, storedValue]) => ({
        text: t(labelKey),
        onPress: () => save('gender', storedValue),
      })),
      { text: t('common.cancel'), style: 'cancel' as const },
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
      Alert.alert(t('import.buildNeededTitle'), t('editProfile.photoBuildNeededBody'));
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
      // Upload it now, for the reason given in `appearanceChanged` — a face
      // only this phone can see is not a profile picture.
      appearanceChanged();
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
        Alert.alert(t('import.buildNeededTitle'), t('editProfile.photoBuildNeededBody'));
      } else {
        Alert.alert(t('editProfile.couldNotSetPhotoTitle'), msg);
      }
    }
  };

  return (
    <Screen>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headTitle}>{t('editProfile.title')}</Text>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{t('editProfile.save')}</Text>
        </Pressable>
      </View>
      <ScrollView>
        <ContentColumn>
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
            <Text style={styles.link}>{t('editProfile.choosePhoto')}</Text>
          </Pressable>
          <Pressable style={styles.photoRow} onPress={() => router.push('/cover-picker')}>
            <View style={[styles.avatar, { borderRadius: 8, overflow: 'hidden' }]}>
              {coverUri != null ? (
                <Image source={{ uri: coverUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : seedLib ? (
                <Image source={SEED_COVER} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : null}
            </View>
            <Text style={styles.link}>{t('editProfile.chooseCover')}</Text>
          </Pressable>
          <Field label={t('editProfile.displayName')} value={username} onPress={() => prompt(t('editProfile.displayName'), 'username', username)} />
          <Text style={styles.sectionTitle}>{t('editProfile.personalInfo')}</Text>
          <Field
            label={t('editProfile.birthYear')}
            value={birthYear}
            onPress={() =>
              prompt(t('editProfile.birthYear'), 'birthYear', birthYear, (v) => /^\d{4}$/.test(v) && Number(v) >= 1900 && Number(v) <= 2026, 'number-pad')
            }
          />
          <Field label={t('editProfile.gender')} value={gender} onPress={pickGender} />
          <Field label={t('editProfile.country')} value={country} onPress={() => prompt(t('editProfile.country'), 'country', country)} />
          {/* WHAT PEOPLE SEE — one switch per band of the profile.
              NOT A PLUS FEATURE and never will be: hiding your own things is
              privacy, and a paywall in front of privacy is a shop selling back
              what was already yours.
              Only with an account, for the same reason the private switch is:
              without one there is no profile for anybody to see. */}
          {joined && (
            <>
              <Text style={styles.sectionTitle}>{t('editProfile.visibility.title')}</Text>
              <Text style={styles.sectionNote}>{t('editProfile.visibility.note')}</Text>
              {PROFILE_SECTIONS.map((s) => (
                <View key={s} style={styles.switchRow}>
                  <View style={styles.switchText}>
                    <Text style={styles.fieldLabel}>{t(SECTION_LABEL[s])}</Text>
                    {/* ONE SECTION NEEDS ITS OWN SENTENCE. The heatmap is never
                        published — there is no watch-history table on the server
                        and there is not going to be — so this switch acts on
                        your own profile and nobody else's, and saying so is the
                        difference between a control and a false promise. */}
                    {s === 'activity' && <Text style={styles.switchSub}>{t('editProfile.visibility.activitySub')}</Text>}
                  </View>
                  <Switch
                    value={!sectionHidden(hidden, s)}
                    onValueChange={(show) => toggleSection(s, show)}
                    disabled={sectionBusy}
                    trackColor={{ true: colors.green }}
                  />
                </View>
              ))}
            </>
          )}
        </ContentColumn>
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
  sectionNote: { color: colors.dim, fontSize: 13, lineHeight: 18, paddingHorizontal: space.lg, paddingBottom: 8 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1B1B1E',
  },
  switchText: { flex: 1 },
  switchSub: { color: colors.dim, fontSize: 12.5, lineHeight: 17, marginTop: 3 },
});
