/**
 * The profile's layout — Classic, Cards, Poster — as three drawings, chosen
 * in place. One component so Appearance and Edit profile cannot drift: the
 * same publish-then-remember rule, the same Plus gate.
 *
 * Publish, then remember — the colour's rule, for the same reason: the server
 * holds the copy every visitor renders. `classic` is published as null, so a
 * profile that never chose one is indistinguishable from a profile that chose
 * the default, and neither needs a backfill.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { track } from '@/analytics';
import { ApiError } from '@/api';
import { communityErrorText } from '@/community-error-text';
import { pushProfileLayout } from '@/community-profiles';
import { asProfileLayout, type ProfileLayout } from '@/components/profile-template';
import { getMeta, setMeta } from '@/db';
import { t } from '@/i18n';
import { requirePlus } from '@/plus';
import { colors, radius, space } from '@/theme';

export function LayoutPicker({ accent }: { accent?: string | null }) {
  const [layout, setLayout] = useState<ProfileLayout>(() => asProfileLayout(getMeta('profileThemeLayout')));
  const [publishing, setPublishing] = useState(false);
  // A template or the other screen may have changed it while this one was away.
  useFocusEffect(useCallback(() => setLayout(asProfileLayout(getMeta('profileThemeLayout'))), []));

  const pick = (value: ProfileLayout) => {
    if (publishing || value === layout) return;
    if (value !== 'classic' && !requirePlus('profile_layout')) return;
    setPublishing(true);
    pushProfileLayout(value === 'classic' ? null : value)
      .then(() => {
        setLayout(value);
        setMeta('profileThemeLayout', value);
        track('profile_layout_set', { layout: value });
      })
      .catch((e: unknown) => {
        Alert.alert(t('plus.appearance.profileThemeFailed'), e instanceof ApiError ? communityErrorText(e) : t('community.error.network'));
      })
      .finally(() => setPublishing(false));
  };

  return (
    <View style={s.layouts}>
      {(['classic', 'cards', 'poster'] as const).map((name) => (
        <Pressable
          key={name}
          accessibilityRole="button"
          accessibilityState={{ selected: layout === name }}
          onPress={() => pick(name)}
          style={[s.layoutCard, layout === name && { borderColor: accent ?? colors.yellow }]}>
          {/* A drawing of the layout, not a word for it: "Cards" and
              "Classic" mean nothing until you have seen both. */}
          <View style={s.layoutArt}>
            {name === 'classic' ? (
              <>
                <View style={s.artBand} />
                <View style={s.artRailRow}>
                  <View style={[s.artRail, { width: 34 }]} />
                  <View style={[s.artRail, { width: 26 }]} />
                  <View style={[s.artRail, { width: 14 }]} />
                </View>
              </>
            ) : name === 'cards' ? (
              <View style={s.artGrid}>
                {[0, 1, 2, 3].map((i) => (
                  <View key={i} style={s.artTile} />
                ))}
              </View>
            ) : (
              <>
                <View style={s.artPoster} />
                <View style={s.artRailRow}>
                  <View style={[s.artRail, { width: 22, height: 18 }]} />
                  <View style={[s.artRail, { width: 22, height: 18 }]} />
                  <View style={[s.artRail, { width: 22, height: 18 }]} />
                </View>
              </>
            )}
          </View>
          <Text style={[s.layoutName, layout === name && { color: colors.text }]}>
            {t(name === 'classic' ? 'plus.appearance.layoutClassic' : name === 'cards' ? 'plus.appearance.layoutCards' : 'plus.appearance.layoutPoster')}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  layouts: { flexDirection: 'row', gap: 10, paddingHorizontal: space.lg, paddingTop: 6 },
  layoutCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: 'transparent',
    padding: 12,
    gap: 10,
  },
  layoutArt: { height: 56, justifyContent: 'center', gap: 6 },
  artBand: { height: 12, borderRadius: 3, backgroundColor: colors.line },
  artRailRow: { flexDirection: 'row', gap: 5 },
  artRail: { height: 26, borderRadius: 4, backgroundColor: colors.raise },
  artGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  artTile: { width: '47%', height: 24, borderRadius: 4, backgroundColor: colors.raise },
  artPoster: { height: 30, borderRadius: 4, backgroundColor: colors.line },
  layoutName: { color: colors.dim, fontSize: 13, fontWeight: '700', textAlign: 'center' },
});
