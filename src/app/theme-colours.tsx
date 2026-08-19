/**
 * Pick the profile theme by hand, when the artwork will not give one.
 *
 * WHY THIS EXISTS ALONGSIDE THE ARTWORK PICKER, which is still the better
 * route: "themed on The Matrix" is identity and "my profile is green" is not.
 * But a GIF has no colour to extract until its still frame loads, a greyscale
 * frame yields nothing at all, and a picker that sometimes silently produces no
 * theme is a feature that reads as broken. This is the way through that never
 * fails.
 *
 * TWO COLOURS, BECAUSE THE THEME IS TWO. One hue used for every accent on a
 * page is a tint; two in different roles is an identity — which is the same
 * reason `paletteFromJpeg` returns a pair. The second is optional and falls
 * back to the first, exactly as artwork with only one colour already does.
 *
 * ONLY THE FIRST IS PUBLISHED. The server has no `theme_secondary` column, so
 * a visitor sees the primary alone. That is a real limit and it is said on the
 * screen rather than discovered by somebody wondering why their profile looks
 * different to everybody else.
 */

import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api';
import { appearanceChanged } from '@/community-appearance';
import { communityErrorText } from '@/community-error-text';
import { pushProfileTheme } from '@/community-profiles';
import { NavHeader, Screen } from '@/components/ui';
import { setMeta, getMeta } from '@/db';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { colors, onAccent, setThemeAccentHex, space } from '@/theme';

/**
 * A spread of hues rather than a colour wheel.
 *
 * A wheel is a component, a gesture and a set of edge cases for a choice made
 * once. Sixteen hues at a usable saturation cover what anybody actually wants
 * from a profile, and every one of them is legible against black — which a
 * freely chosen colour is not.
 */
const SWATCHES = [
  '#E5484D', '#E93D82', '#D6409F', '#8E4EC6',
  '#6E56CF', '#3E63DD', '#0091FF', '#00A2C7',
  '#12A594', '#30A46C', '#46A758', '#78BE3D',
  '#FFD400', '#FFB224', '#F76B15', '#B08968',
];

/**
 * One row of swatches.
 *
 * DECLARED HERE, NOT INSIDE THE SCREEN. A component created during render is a
 * new component type on every render, so React throws its state away each
 * time — the lint rule that caught this is the React Compiler's, and it was
 * right.
 */
function Row({
  value,
  onPick,
  allowNone,
}: {
  value: string | null;
  onPick: (hex: string | null) => void;
  allowNone?: boolean;
}) {
  return (
    <View style={s.grid}>
      {allowNone && (
        // "Same as the first" rather than an empty slot: a second colour that
        // is absent is a real choice and has to be selectable, not merely the
        // state you are in before tapping anything.
        <Pressable
          onPress={() => {
            tapLight();
            onPick(null);
          }}
          style={[s.swatch, s.none, value == null && s.picked]}>
          <Text style={s.noneText}>{t('themeColours.same')}</Text>
        </Pressable>
      )}
      {SWATCHES.map((hex) => (
        <Pressable
          key={hex}
          accessibilityRole="button"
          accessibilityState={{ selected: value === hex }}
          onPress={() => {
            tapLight();
            onPick(hex);
          }}
          style={[s.swatch, { backgroundColor: hex }, value === hex && s.picked]}
        />
      ))}
    </View>
  );
}

export default function ThemeColoursScreen() {
  const [primary, setPrimary] = useState<string | null>(() => getMeta('profileThemeColor') || null);
  const [secondary, setSecondary] = useState<string | null>(() => getMeta('profileThemeSecondary') || null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (primary == null || saving) return;
    setSaving(true);
    try {
      // THE SERVER FIRST, and it decides. A phone must not keep a theme nobody
      // else can see, and the entitlement check lives there because a client
      // can lie about it.
      await pushProfileTheme(primary);
      setMeta('profileThemeColor', primary);
      setMeta('profileThemeSecondary', secondary ?? '');
      // NO NAME, because there is no show behind this one. The Appearance row
      // reads "themed on <show>" when there is one and falls back to the swatch
      // when there is not.
      setMeta('profileThemeName', '');
      setThemeAccentHex(primary);
      appearanceChanged();
      router.back();
    } catch (e) {
      Alert.alert(
        t('coverPicker.coverSetThemeFailedTitle'),
        e instanceof ApiError ? communityErrorText(e) : t('coverPicker.coverSetThemeFailedBody'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <NavHeader title={t('themeColours.title')} close />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={s.note}>{t('themeColours.blurb')}</Text>

        <Text style={s.label}>{t('themeColours.primary')}</Text>
        <Row value={primary} onPick={setPrimary} />

        <Text style={s.label}>{t('themeColours.secondary')}</Text>
        <Text style={s.sub}>{t('themeColours.secondarySub')}</Text>
        <Row value={secondary} onPick={setSecondary} allowNone />

        {/* The pair, as the profile will wear it. A swatch beside a swatch says
            nothing about two colours in different roles. */}
        {primary != null && (
          <View style={s.previewWrap}>
            <Text style={s.label}>{t('themeColours.preview')}</Text>
            <View style={[s.preview, { backgroundColor: primary }]}>
              <Text style={[s.previewNum, { color: onAccent(primary) }]}>1,204</Text>
              <View style={[s.previewChip, { backgroundColor: secondary ?? primary }]}>
                <Text style={[s.previewChipText, { color: onAccent(secondary ?? primary) }]}>
                  {t('themeColours.preview')}
                </Text>
              </View>
            </View>
          </View>
        )}

        <Pressable
          style={[s.save, (primary == null || saving) && s.saveOff]}
          disabled={primary == null || saving}
          onPress={() => void save()}>
          <Text style={s.saveText}>{t('common.done')}</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  note: { color: colors.dim, fontSize: 13, lineHeight: 19, paddingHorizontal: space.lg, paddingBottom: 6 },
  label: { color: colors.text, fontSize: 13, fontWeight: '800', paddingHorizontal: space.lg, paddingTop: 18, paddingBottom: 8 },
  sub: { color: colors.faint, fontSize: 12, paddingHorizontal: space.lg, paddingBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: space.lg },
  swatch: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: 'transparent' },
  none: { backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  noneText: { color: colors.dim, fontSize: 9, fontWeight: '700', textAlign: 'center' },
  picked: { borderColor: colors.text },
  previewWrap: { paddingBottom: 4 },
  preview: { marginHorizontal: space.lg, borderRadius: 14, padding: 16, gap: 10, alignItems: 'flex-start' },
  previewNum: { fontSize: 28, fontWeight: '900' },
  previewChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  previewChipText: { fontSize: 12, fontWeight: '800' },
  save: {
    marginTop: 26,
    marginHorizontal: space.lg,
    backgroundColor: colors.yellow,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
  },
  saveOff: { opacity: 0.4 },
  saveText: { color: colors.onYellow, fontSize: 16, fontWeight: '800' },
});
