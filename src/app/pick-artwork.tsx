/**
 * Choose a poster from your own library for an Artwork widget.
 *
 * A GRID OF PICTURES, NOT A LIST OF TITLES. The thing being chosen is an image
 * and the only question is which one looks right on the profile — a list of
 * names would make somebody pick blind and then go back and look.
 *
 * Nothing is created if this screen is left without choosing: an empty Artwork
 * widget would be a hole on the grid that has to be filled or removed, which is
 * the feature asking for work rather than doing any.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TitlePicker } from '@/components/title-picker';
import { getProfileLayout, setProfileLayout } from '@/db';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import {
  newUid,
  normalise,
  notifyLayoutSaved,
  parseLayout,
  serialise,
  specOf,
  type WidgetSpan,
} from '@/profile-layout';
import { colors, radius, space } from '@/theme';

export default function PickArtworkScreen() {
  /** The size chosen in the preview before getting here. */
  const { span } = useLocalSearchParams<{ span?: string }>();
  const chosen: WidgetSpan = span === '2x1' || span === '2x2' ? span : specOf('artwork').span;


  const choose = (ref: string) => {
    tapLight();
    const raw = getProfileLayout();
    const items = normalise(parseLayout(raw), []);
    // At the end, where somebody can see it arrive.
    const next = [...items, { uid: newUid('artwork'), id: 'artwork', span: chosen, data: ref }];
    setProfileLayout(serialise(next, raw));
    // The Profile tab is under a transparent modal here and never blurred, so
    // its focus effect will not fire. See `notifyLayoutSaved`.
    notifyLayoutSaved();
    router.back();
  };

  return (
    <View style={s.page}>
      <View style={s.head}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={s.title}>{t('pickArtwork.title')}</Text>
        <View style={{ width: 26 }} />
      </View>

      {/* The same grid the GIF picker's first step draws — one component, so
          the two flows cannot drift apart. */}
      <TitlePicker onPick={(c) => choose(c.key)} />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: 60,
    paddingBottom: 10,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  search: {
    marginHorizontal: space.lg,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 16,
  },
  empty: { color: colors.faint, fontSize: 15, padding: space.xl },
  poster: { aspectRatio: 2 / 3, borderRadius: 8, backgroundColor: colors.card },
});
