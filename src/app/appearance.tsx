/**
 * Appearance — accent, OLED black, app icon. A Plus feature, except for the
 * way back: the default yellow and the original icon are always selectable,
 * because a lapsed subscriber must never be locked inside a paid look.
 *
 * The accent and OLED choices are painted at launch (see the header comment in
 * `@/theme`), so this screen writes the preference, shows a preview built from
 * LOCAL STATE — which is real React state and repaints fine — and tells the
 * user the app itself changes next time they open it.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { track } from '@/analytics';
import { APP_ICONS, currentIcon, setIcon, supported, type AppIconName } from '@/app-icon';
import { ContentColumn, MenuRow, NavHeader, Screen } from '@/components/ui';
import { t } from '@/i18n';
import { ApiError } from '@/api';
import { communityErrorText } from '@/community-error-text';
import { pushProfileTheme } from '@/community-profiles';
import { isJoined } from '@/community-session';
import { getMeta, setMeta } from '@/db';
import { requirePlus } from '@/plus';
import {
  ACCENTS,
  ACCENT_NAMES,
  DEFAULT_ACCENT,
  appliedAccent,
  appliedOled,
  colors,
  onAccent,
  radius,
  setThemeAccent,
  setThemeOled,
  space,
  type,
  type AccentName,
} from '@/theme';

const ICON_SOURCES: Record<AppIconName, number> = {
  default: require('@/assets/images/icon.png'),
  orange: require('@/assets/icons/orange.png'),
  purple: require('@/assets/icons/purple.png'),
  teal: require('@/assets/icons/teal.png'),
};

const ACCENT_LABELS: Record<AccentName, Parameters<typeof t>[0]> = {
  yellow: 'plus.appearance.accents.yellow',
  orange: 'plus.appearance.accents.orange',
  red: 'plus.appearance.accents.red',
  pink: 'plus.appearance.accents.pink',
  purple: 'plus.appearance.accents.purple',
  blue: 'plus.appearance.accents.blue',
  green: 'plus.appearance.accents.green',
  teal: 'plus.appearance.accents.teal',
};

export default function AppearanceScreen() {
  const [accent, setAccent] = useState<AccentName>(appliedAccent);
  const [oled, setOled] = useState<boolean>(appliedOled);
  const [icon, setIconState] = useState<AppIconName>(currentIcon);
  const iconsWork = supported();
  // The PUBLISHED theme — what visitors see on the profile. Distinct from the
  // accent above, which is this phone's own look. Lazy initial read is mount-
  // time, not render-time, so the Compiler cannot cache it stale.
  const [profileTheme, setProfileTheme] = useState<string | null>(() => getMeta('profileThemeColor') || null);
  const [themeName, setThemeName] = useState<string>(() => getMeta('profileThemeName') ?? '');
  const [publishing, setPublishing] = useState(false);
  const joined = isJoined();
  // The picker is its own screen, so what it saved has to be re-read when this
  // one comes back into focus — state set here, never read bare in render.
  useFocusEffect(
    useCallback(() => {
      setProfileTheme(getMeta('profileThemeColor') || null);
      setThemeName(getMeta('profileThemeName') ?? '');
    }, []),
  );

  const changed = accent !== appliedAccent() || oled !== appliedOled();
  const hex = ACCENTS[accent];
  const panel = oled ? '#0A0A0B' : '#141416';
  const card = oled ? '#101012' : '#1C1C1E';

  const pickAccent = (name: AccentName) => {
    // Going back to the brand is never paywalled.
    if (name !== DEFAULT_ACCENT && !requirePlus('themes')) return;
    setAccent(name);
    setThemeAccent(name);
    track('theme_set', { accent: name });
  };

  const toggleOled = (on: boolean) => {
    if (on && !requirePlus('themes')) return;
    setOled(on);
    setThemeOled(on);
    track('theme_set', { oled: on ? 1 : 0 });
  };

  /**
   * Publish, THEN remember. The server is the copy every visitor reads, so a
   * write that fails must leave the swatch unselected rather than let this
   * phone believe in a theme nobody else can see. `plus_required` from a
   * client that talked its way past `requirePlus` lands on the paywall via
   * the error text like any other refusal.
   */
  const pickProfileTheme = (value: string | null) => {
    if (publishing) return;
    if (value !== null && !requirePlus('profile_theme')) return;
    setPublishing(true);
    pushProfileTheme(value)
      .then(() => {
        setProfileTheme(value);
        setMeta('profileThemeColor', value ?? '');
        if (value === null) {
          setMeta('profileThemeName', '');
          setThemeName('');
        }
        track('profile_theme_set', { on: value === null ? 0 : 1 });
      })
      .catch((e: unknown) => {
        Alert.alert(t('plus.appearance.profileThemeFailed'), e instanceof ApiError ? communityErrorText(e) : t('community.error.network'));
      })
      .finally(() => setPublishing(false));
  };

  const pickIcon = (name: AppIconName) => {
    if (name !== 'default' && !requirePlus('icons')) return;
    void setIcon(name).then((ok) => {
      if (!ok) return;
      setIconState(name);
      track('icon_set', { icon: name });
    });
  };

  return (
    <Screen>
      <NavHeader title={t('plus.appearance.title')} close />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <ContentColumn>
          {/* Preview — a show row and a CTA, in the colours being chosen. */}
          <View style={[s.preview, { backgroundColor: panel }]}>
            <View style={[s.row, { backgroundColor: card }]}>
              <View style={[s.poster, { backgroundColor: colors.pillGrey }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{t('plus.appearance.previewShow')}</Text>
                <Text style={[s.rowSub, { color: hex }]}>{t('plus.appearance.previewEp')}</Text>
              </View>
              <View style={[s.check, { backgroundColor: colors.green }]}>
                <Ionicons name="checkmark" size={14} color="#FFF" />
              </View>
            </View>
            <View style={[s.cta, { backgroundColor: hex }]}>
              <Text style={[s.ctaText, { color: onAccent(hex) }]}>{t('plus.appearance.previewCta')}</Text>
            </View>
          </View>

          <Text style={s.label}>{t('plus.appearance.accent')}</Text>
          <View style={s.swatches}>
            {ACCENT_NAMES.map((name) => (
              <Pressable
                key={name}
                accessibilityRole="button"
                accessibilityLabel={t(ACCENT_LABELS[name])}
                accessibilityState={{ selected: accent === name }}
                onPress={() => pickAccent(name)}
                style={[s.swatchRing, accent === name && { borderColor: ACCENTS[name] }]}>
                <View style={[s.swatch, { backgroundColor: ACCENTS[name] }]} />
              </Pressable>
            ))}
          </View>

          <MenuRow
            trackId="plus.appearance.oled"
            title={t('plus.appearance.oled')}
            sub={t('plus.appearance.oledSub')}
            right={<Switch value={oled} onValueChange={toggleOled} trackColor={{ true: colors.green }} />}
          />

          {changed && <Text style={s.note}>{t('plus.appearance.restart')}</Text>}

          {/* THE PROFILE THEME — the one section here other people see, and it
              comes from a SHOW, not a swatch: the picker extracts the colour
              from the artwork the user chooses, because "themed on The Matrix"
              is identity and "my profile is green" is nothing. Only offered
              once joined: without a profile there is nowhere for it to live. */}
          {joined && (
            <>
              <Text style={s.label}>{t('plus.appearance.profileTheme')}</Text>
              <MenuRow
                trackId="plus.appearance.profileThemePick"
                title={t('plus.appearance.profileThemePick')}
                sub={
                  profileTheme != null && themeName
                    ? t('plus.appearance.profileThemeCurrent', { name: themeName })
                    : t('plus.appearance.profileThemePickSub')
                }
                right={
                  profileTheme != null ? (
                    <View style={[s.themeDot, { backgroundColor: profileTheme }]} />
                  ) : undefined
                }
                onPress={() => {
                  if (!requirePlus('profile_theme')) return;
                  router.push('/cover-picker?theme=1');
                }}
              />
              {profileTheme != null && (
                <Pressable onPress={() => pickProfileTheme(null)} hitSlop={8} disabled={publishing}>
                  <Text style={s.clear}>{t('plus.appearance.profileThemeClear')}</Text>
                </Pressable>
              )}
            </>
          )}

          <Text style={s.label}>{t('plus.appearance.icon')}</Text>
          {!iconsWork && <Text style={s.note}>{t('plus.appearance.iconUnsupported')}</Text>}
          <View style={s.icons}>
            {APP_ICONS.map((name) => (
              <Pressable
                key={name}
                accessibilityRole="button"
                accessibilityLabel={t(name === 'default' ? 'plus.appearance.iconDefault' : ACCENT_LABELS[name])}
                accessibilityState={{ selected: icon === name, disabled: !iconsWork }}
                disabled={!iconsWork}
                onPress={() => pickIcon(name)}
                style={[s.iconRing, icon === name && iconsWork && { borderColor: colors.yellow }, !iconsWork && { opacity: 0.4 }]}>
                <Image source={ICON_SOURCES[name]} style={s.icon} contentFit="cover" />
              </Pressable>
            ))}
          </View>
        </ContentColumn>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  preview: { margin: space.lg, borderRadius: radius.card, padding: space.md, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.card, padding: space.md },
  poster: { width: 34, height: 50, borderRadius: radius.poster },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rowSub: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  check: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  cta: { borderRadius: radius.pill, paddingVertical: 12, alignItems: 'center' },
  ctaText: { fontSize: 15, fontWeight: '800' },

  label: { ...type.label, marginHorizontal: space.lg, marginTop: space.lg, marginBottom: space.sm },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginHorizontal: space.lg, marginBottom: space.lg },
  swatchRing: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  themeDot: { width: 22, height: 22, borderRadius: 11 },
  clear: { color: colors.danger, fontSize: 13.5, fontWeight: '600', paddingHorizontal: space.lg, paddingVertical: 8 },
  swatch: { width: 40, height: 40, borderRadius: 20 },

  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginHorizontal: space.lg },
  iconRing: { borderRadius: 18, borderWidth: 2, borderColor: 'transparent', padding: 3 },
  icon: { width: 64, height: 64, borderRadius: 14 },

  note: { color: colors.dim, fontSize: 13, lineHeight: 18, marginHorizontal: space.lg, marginBottom: space.md },
});
