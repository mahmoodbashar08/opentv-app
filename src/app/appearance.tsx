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
import { pushProfileLayout, pushProfileTheme } from '@/community-profiles';
import { isJoined } from '@/community-session';
import { getMeta, setMeta } from '@/db';
import { asProfileLayout, type ProfileLayout } from '@/components/profile-template';
import { requirePlus } from '@/plus';
import { appliedLight,
  ACCENTS,
  DEFAULT_ACCENT,
  appliedAccent,
  appliedCustomAccent,
  appliedOled,
  colors,
  onAccent,
  radius,
  setThemeAccentHex,
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

export default function AppearanceScreen() {
  // `null` means the custom colour below is the one painted — the eight are
  // names, a colour from artwork is not.
  const accent: AccentName | null = appliedCustomAccent() ? null : appliedAccent();
  const [custom, setCustom] = useState<string | null>(appliedCustomAccent);
  const [oled, setOled] = useState<boolean>(appliedOled);
  const [icon, setIconState] = useState<AppIconName>(currentIcon);
  const iconsWork = supported();
  // The PUBLISHED theme — what visitors see on the profile. Distinct from the
  // accent above, which is this phone's own look. Lazy initial read is mount-
  // time, not render-time, so the Compiler cannot cache it stale.
  const [profileTheme, setProfileTheme] = useState<string | null>(() => getMeta('profileThemeColor') || null);
  const [themeName, setThemeName] = useState<string>(() => getMeta('profileThemeName') ?? '');
  const [layout, setLayout] = useState<ProfileLayout>(() => asProfileLayout(getMeta('profileThemeLayout')));
  const [publishing, setPublishing] = useState(false);
  const joined = isJoined();
  // The picker is its own screen, so what it saved has to be re-read when this
  // one comes back into focus — state set here, never read bare in render.
  useFocusEffect(
    useCallback(() => {
      setProfileTheme(getMeta('profileThemeColor') || null);
      setThemeName(getMeta('profileThemeName') ?? '');
      setCustom(appliedCustomAccent() ?? (getMeta('profileThemeColor') || null));
      setLayout(asProfileLayout(getMeta('profileThemeLayout')));
    }, []),
  );

  const changed =
    (accent === null ? appliedCustomAccent() == null : accent !== appliedAccent() || appliedCustomAccent() != null) ||
    oled !== appliedOled();
  const hex = accent === null && custom != null ? custom : ACCENTS[accent ?? DEFAULT_ACCENT];
  /*
   * The preview shows the app as it will look, so on paper it has to be paper.
   * Hardcoding the dark surfaces here left a light-theme user choosing an accent
   * against a black card their app will never show them.
   */
  const light = appliedLight();
  const panel = light ? colors.panel : oled ? '#0A0A0B' : '#141416';
  const card = light ? colors.card : oled ? '#101012' : '#1C1C1E';



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
        // The app follows the profile: a theme paints it, clearing one returns
        // it to the brand. There is no third state to get stuck in.
        setThemeAccentHex(value);
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

  /**
   * Publish, then remember — the colour's rule, for the same reason: the
   * server holds the copy every visitor renders. `classic` is published as
   * null, so a profile that never chose one is indistinguishable from a
   * profile that chose the default, and neither needs a backfill.
   */
  const pickLayout = (value: ProfileLayout) => {
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
        Alert.alert(
          t('plus.appearance.profileThemeFailed'),
          e instanceof ApiError ? communityErrorText(e) : t('community.error.network'),
        );
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

          {/* NO ACCENT PICKER. The colour comes from the show somebody themed
              their profile on — that is the whole idea, and a second control
              offering eight arbitrary colours meant two settings for one
              colour, which could disagree and did. Choose a show below; the
              app follows it. */}
          {/* OLED black darkens the panels, which is nothing at all on a white
              page. The preference is kept — switching back to dark restores
              whatever was chosen — it simply has no control while light. */}
          {!light && (
            <MenuRow
              trackId="plus.appearance.oled"
              title={t('plus.appearance.oled')}
              sub={t('plus.appearance.oledSub')}
              right={<Switch value={oled} onValueChange={toggleOled} trackColor={{ true: colors.green }} />}
            />
          )}

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
              {/* THE WAY THROUGH WHEN ARTWORK WILL NOT GIVE A COLOUR. A GIF
                  has none until its still frame loads and a greyscale frame
                  yields nothing at all, so the artwork route can silently end
                  with no theme — which reads as a broken feature rather than
                  as a picture without a colour in it. Under the artwork row,
                  because that is where somebody is standing when it happens. */}
              <MenuRow
                trackId="themeColours.title"
                title={t('themeColours.title')}
                sub={t('plus.appearance.profileThemeByHandSub')}
                onPress={() => {
                  if (!requirePlus('profile_theme')) return;
                  router.push('/theme-colours');
                }}
              />
              {profileTheme != null && (
                <Pressable onPress={() => pickProfileTheme(null)} hitSlop={8} disabled={publishing}>
                  <Text style={s.clear}>{t('plus.appearance.profileThemeClear')}</Text>
                </Pressable>
              )}

              <Text style={s.label}>{t('plus.appearance.profileLayout')}</Text>
              <Text style={s.note}>{t('plus.appearance.profileLayoutSub')}</Text>
              <View style={s.layouts}>
                {(['classic', 'cards', 'poster'] as const).map((name) => (
                  <Pressable
                    key={name}
                    accessibilityRole="button"
                    accessibilityState={{ selected: layout === name }}
                    onPress={() => pickLayout(name)}
                    style={[
                      s.layoutCard,
                      layout === name && { borderColor: profileTheme ?? colors.yellow },
                    ]}>
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
                      {t(
                        name === 'classic'
                          ? 'plus.appearance.layoutClassic'
                          : name === 'cards'
                            ? 'plus.appearance.layoutCards'
                            : 'plus.appearance.layoutPoster',
                      )}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Text style={s.label}>{t('plus.appearance.icon')}</Text>
          {!iconsWork && <Text style={s.note}>{t('plus.appearance.iconUnsupported')}</Text>}
          <View style={s.icons}>
            {APP_ICONS.map((name) => (
              <Pressable
                key={name}
                accessibilityRole="button"
                accessibilityLabel={name === 'default' ? t('plus.appearance.iconDefault') : name}
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
  artRail: { height: 26, borderRadius: 4, backgroundColor: colors.card },
  artGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  artTile: { width: '47%', height: 24, borderRadius: 4, backgroundColor: colors.card },
  artPoster: { height: 30, borderRadius: 4, backgroundColor: colors.line },
  layoutName: { color: colors.dim, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  clear: { color: colors.danger, fontSize: 13.5, fontWeight: '600', paddingHorizontal: space.lg, paddingVertical: 8 },
  swatch: { width: 40, height: 40, borderRadius: 20 },

  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginHorizontal: space.lg },
  iconRing: { borderRadius: 18, borderWidth: 2, borderColor: 'transparent', padding: 3 },
  icon: { width: 64, height: 64, borderRadius: 14 },

  note: { color: colors.dim, fontSize: 13, lineHeight: 18, marginHorizontal: space.lg, marginBottom: space.md },
});
