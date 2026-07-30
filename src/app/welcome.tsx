import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, I18nManager, Linking, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { findCloudBackup, icloudAvailableAsync, icloudSupported, type CloudBackup } from '@/backup';
import { ContentColumn } from '@/components/ui';
import { getMeta, hasLibrary } from '@/db';
import { currentLocale, t } from '@/i18n';
import { NAMES } from '@/app/language';
import metadata from '@/metadata';
import { postOnboardingRoute, setOnboarded } from '@/session-store';
import { colors, radius, space } from '@/theme';

const COLS = 4;

// rotating taglines, like the real welcome carousel
const PAGES = [
  { icon: 'heart-outline', textKey: 'welcome.pages.discover' as const },
  { icon: 'calendar-outline', textKey: 'welcome.pages.remember' as const },
  { icon: 'lock-closed-outline', textKey: 'welcome.pages.privacy' as const },
] as const;

export default function WelcomeScreen() {
  const { width: W, height: H } = useWindowDimensions();
  const TILE_W = W / COLS;
  const TILE_H = TILE_W * 1.5;
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [gate, setGate] = useState(false);
  const [cloud, setCloud] = useState<CloudBackup | null>(null);

  // reflects the current language so the corner control's label updates when
  // the user returns from /language having picked something new — currentLocale()
  // itself is a plain module-level read, not reactive state, so re-render on focus
  const [locale, setLocaleDisplay] = useState(currentLocale());
  useFocusEffect(useCallback(() => setLocaleDisplay(currentLocale()), []));

  // null = still checking; the check runs off the JS thread because the
  // sync variant can stall the whole app on a cold iCloud state
  const [cloudOn, setCloudOn] = useState<boolean | null>(null);

  // a backup waiting in the user's iCloud means this is a reinstall —
  // greet them by name and offer their library back
  useEffect(() => {
    if (!icloudSupported()) {
      setCloudOn(false);
      return;
    }
    void icloudAvailableAsync()
      .then(setCloudOn)
      .catch(() => setCloudOn(false));
    void findCloudBackup()
      .then(setCloud)
      .catch(() => {});
  }, []);

  const start = () => {
    // iCloud is required: the library's only delete-proof copy lives there.
    // Fail open — an unfinished or failed check must never block onboarding
    if (icloudSupported() && cloudOn === false) {
      setGate(true);
      return;
    }
    setSheet(true);
  };

  const recheck = () => {
    void icloudAvailableAsync().then((on) => {
      setCloudOn(on);
      if (on) {
        setGate(false);
        setSheet(true);
        void findCloudBackup()
          .then(setCloud)
          .catch(() => {});
      } else {
        Alert.alert(t('welcome.icloudOffTitle'), t('welcome.icloudOffBody'));
      }
    });
  };

  // poster mosaic from the bundled artwork
  const posters = useMemo(() => {
    const all = Object.values(metadata)
      .map((m) => m.poster)
      .filter((p): p is string => !!p);
    const need = Math.ceil(H / TILE_H) * COLS + COLS;
    return all.slice(0, need);
    // H/TILE_H now come from useWindowDimensions, so this has to recompute on a
    // rotation — otherwise the mosaic is short by a row or two in landscape
  }, [H, TILE_H]);

  useEffect(() => {
    const t = setInterval(() => setPage((p) => (p + 1) % PAGES.length), 3200);
    return () => clearInterval(t);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* dimmed poster wall */}
      <View style={[StyleSheet.absoluteFill, { flexDirection: 'row', flexWrap: 'wrap' }]}>
        {posters.map((p, i) => (
          <Image key={i} source={{ uri: p }} style={{ width: TILE_W, height: TILE_H }} contentFit="cover" cachePolicy="disk" />
        ))}
      </View>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.78)' }]} />

      {/* language picker — the only way to change language before onboarding
          finishes, so someone whose device language isn't their own can read
          the import flow. Deliberately a small corner affordance rather than a
          mandatory step: the device locale is already right for most people. */}
      <Pressable
        style={[styles.langButton, { top: insets.top + 12 }]}
        accessibilityRole="button"
        accessibilityLabel={t('welcome.languageButtonLabel')}
        onPress={() => router.push('/language')}>
        <Ionicons name="globe-outline" size={16} color={colors.text} />
        <Text style={styles.langButtonText}>{NAMES[locale]}</Text>
      </Pressable>

      {/* logo */}
      <View style={{ marginTop: insets.top + 84, alignItems: 'center', gap: 10 }}>
        <View style={styles.logoRow}>
          <View style={styles.tBadge}>
            <Text style={{ color: colors.onYellow, fontSize: 26, fontWeight: '900' }}>O</Text>
          </View>
          <Text style={styles.logoText}>OPENTV</Text>
        </View>
        <Text style={styles.openSrc}>{t('welcome.openSource')}</Text>
      </View>

      {/* rotating tagline */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
        <View key={page} style={{ alignItems: 'center', gap: 22 }}>
          <View style={styles.iconCircle}>
            <Ionicons name={PAGES[page].icon} size={38} color="#D5D5DA" />
          </View>
          <Text style={styles.tagline}>{t(PAGES[page].textKey)}</Text>
        </View>
      </View>

      {/* bottom: pill, the iCloud gate, or the continue-with sheet */}
      {!sheet && !gate ? (
        <View style={{ paddingBottom: insets.bottom + 40, alignItems: 'center' }}>
          <Pressable style={styles.cta} onPress={start}>
            <Text style={styles.ctaText}>{t('welcome.getStarted')}</Text>
          </Pressable>
        </View>
      ) : gate ? (
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <ContentColumn>
            <View style={{ alignItems: 'center', marginBottom: 10 }}>
              <Ionicons name="cloud-offline-outline" size={40} color={colors.yellow} />
            </View>
            <Text style={styles.sheetTitle}>{t('welcome.turnOnIcloudTitle')}</Text>
            <Text style={styles.gateText}>{t('welcome.turnOnIcloudBody')}</Text>
            <Text style={styles.gateSteps}>{t('welcome.icloudSteps')}</Text>
            <Pressable style={styles.optionPrimary} onPress={() => void Linking.openSettings()}>
              <Ionicons name="settings-outline" size={20} color={colors.onYellow} />
              <Text style={styles.optionPrimaryText}>{t('welcome.openSettings')}</Text>
            </Pressable>
            <Pressable style={styles.optionSecondary} onPress={recheck}>
              <Ionicons name="refresh-outline" size={20} color={colors.text} />
              <Text style={styles.optionSecondaryText}>{t('welcome.recheckIcloud')}</Text>
            </Pressable>
            {/* iCloud can be sorted out later — auto-backup retries every time
                the app goes to background, so the library syncs up by itself */}
            <Pressable
              style={styles.optionSecondary}
              onPress={() => {
                setGate(false);
                setSheet(true);
              }}>
              <Ionicons name={I18nManager.isRTL ? 'arrow-back-outline' : 'arrow-forward-outline'} size={20} color={colors.text} />
              <Text style={styles.optionSecondaryText}>{t('welcome.continueWithoutBackup')}</Text>
            </Pressable>
            <Text style={styles.fine}>{t('welcome.icloudLaterNote')}</Text>
          </ContentColumn>
        </View>
      ) : (
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <ContentColumn>
            <Text style={styles.sheetTitle}>{t('welcome.continueWith')}</Text>
            {hasLibrary() && (
              <Pressable
                style={styles.optionPrimary}
                onPress={() => {
                  setOnboarded(true);
                  router.replace(postOnboardingRoute());
                }}>
                <Ionicons name="person-circle-outline" size={20} color={colors.onYellow} />
                <Text style={styles.optionPrimaryText}>
                  {t('welcome.continueAs', { name: (getMeta('username') ?? t('welcome.defaultName')).toUpperCase() })}
                </Text>
              </Pressable>
            )}
            {cloud && (
              <Pressable
                style={hasLibrary() ? styles.optionSecondary : styles.optionPrimary}
                onPress={() => router.push('/import?source=icloud')}>
                <Ionicons
                  name="cloud-download-outline"
                  size={20}
                  color={hasLibrary() ? colors.text : colors.onYellow}
                />
                <Text style={hasLibrary() ? styles.optionSecondaryText : styles.optionPrimaryText}>
                  {hasLibrary() || !cloud.username
                    ? t('welcome.restoreFromIcloud')
                    : t('welcome.continueAs', { name: cloud.username.toUpperCase() })}
                </Text>
              </Pressable>
            )}
            <Pressable
              style={hasLibrary() || cloud ? styles.optionSecondary : styles.optionPrimary}
              onPress={() => router.push('/import')}>
              <Ionicons
                name="download-outline"
                size={20}
                color={hasLibrary() || cloud ? colors.text : colors.onYellow}
              />
              <Text style={hasLibrary() || cloud ? styles.optionSecondaryText : styles.optionPrimaryText}>
                {t('welcome.importTvTimeData')}
              </Text>
            </Pressable>
            <Pressable style={styles.optionSecondary} onPress={() => router.push('/setup-profile')}>
              <Ionicons name="sparkles-outline" size={20} color={colors.text} />
              <Text style={styles.optionSecondaryText}>{t('welcome.startFresh')}</Text>
            </Pressable>
            {/* marginTop between stacked outline options */}
            <Text style={styles.fine}>
              {Platform.OS === 'ios' ? t('welcome.noAccountIos') : t('welcome.noAccountAndroid')}
            </Text>
          </ContentColumn>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  logoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  tBadge: {
    width: 44,
    height: 44,
    borderRadius: 9,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: colors.text, fontSize: 32, fontWeight: '900', letterSpacing: 1 },
  openSrc: { color: '#C9C9CF', fontSize: 14.5, textAlign: 'center' },
  langButton: {
    position: 'absolute',
    end: 16,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: '#4A4A4E',
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  langButtonText: { color: colors.text, fontSize: 12.5, fontWeight: '700' },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1.5,
    borderColor: '#4A4A4E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagline: { color: '#E8E8EC', fontSize: 25, fontWeight: '700', textAlign: 'center' },
  cta: {
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 16,
    paddingHorizontal: 56,
  },
  ctaText: { color: colors.onYellow, fontSize: 14.5, fontWeight: '800', letterSpacing: 1.2 },
  sheet: {
    backgroundColor: '#232326',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: space.xl,
    paddingTop: 20,
  },
  sheetTitle: { color: colors.text, fontSize: 21, fontWeight: '800', textAlign: 'center', marginBottom: 18 },
  optionPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 15,
    marginBottom: 12,
  },
  optionPrimaryText: { color: colors.onYellow, fontSize: 13.5, fontWeight: '800', letterSpacing: 0.8 },
  optionSecondary: {
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: colors.text,
    borderRadius: radius.pill,
    paddingVertical: 14,
  },
  optionSecondaryText: { color: colors.text, fontSize: 13.5, fontWeight: '800', letterSpacing: 0.8 },
  fine: { color: colors.dim, fontSize: 12.5, textAlign: 'center', marginTop: 16 },
  gateText: { color: '#C9C9CF', fontSize: 14.5, lineHeight: 21, textAlign: 'center', marginBottom: 10 },
  gateSteps: { color: colors.dim, fontSize: 13, textAlign: 'center', marginBottom: 18 },
});
