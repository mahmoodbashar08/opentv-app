/**
 * Update prompts, in two strengths. On launch it fetches a version policy JSON
 * you host:
 *
 *   { "iosMinVersion": "1.1.0", "iosSuggestedVersion": "1.6.3" }
 *
 * TWO LEVELS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS.
 *
 * `minVersion` is the emergency: a build that corrupts data, or talks to a
 * route the server has removed. It still takes the whole screen and cannot be
 * dismissed, because the alternative is somebody quietly losing a decade of
 * history. That is what this component was built for and it is not going away.
 *
 * `suggestedVersion` is the ordinary case, and until now there was nothing for
 * it — a new release existed and the only way to say so was to lock everybody
 * out of the app over a feature. So it is a sheet from the bottom instead: it
 * says there is an update, and the reader can carry on watching television if
 * they would rather.
 *
 * ASKED ONCE PER VERSION. Dismissing stamps the version it was dismissed for,
 * so the next release asks again and this one does not. A prompt that returns
 * every launch is one people learn to close without reading.
 *
 * Everything else — file missing, offline, malformed JSON — fails open: the app
 * must never lock users out by accident.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { getMeta, setMeta } from '@/db';
import { olderThan } from '@/pure';
import { colors, radius, space } from '@/theme';
import { t } from '@/i18n';

// point this at a raw JSON file you control (GitHub repo/gist raw URL);
// until the file exists the gate simply never triggers
const VERSION_URL = 'https://raw.githubusercontent.com/mahmoodbashar08/opentv-config/main/version.json';
const STORE_URL =
  Platform.OS === 'android'
    ? 'https://play.google.com/store/apps/details?id=com.insightfy.opentv'
    : 'https://apps.apple.com/app/id6787399404';

/** Which version the reader last dismissed a soft prompt for. */
const SEEN_KEY = 'updateSuggestSeen';

type Policy = {
  iosMinVersion?: string;
  androidMinVersion?: string;
  iosSuggestedVersion?: string;
  androidSuggestedVersion?: string;
};

export function UpdateGate() {
  const [blocked, setBlocked] = useState(false);
  const [suggest, setSuggest] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(VERSION_URL);
        if (!res.ok) return;
        const policy = (await res.json()) as Policy;
        const android = Platform.OS === 'android';
        const min = android ? policy.androidMinVersion : policy.iosMinVersion;
        const want = android ? policy.androidSuggestedVersion : policy.iosSuggestedVersion;
        const current = Constants.expoConfig?.version;
        if (!current) return;
        if (min && olderThan(current, min)) {
          setBlocked(true);
          return; // the emergency wins; never show both
        }
        if (want && olderThan(current, want) && getMeta(SEEN_KEY) !== want) {
          setSuggest(want);
        }
      } catch {
        // offline or the policy file isn't hosted yet — stay open
      }
    })();
  }, []);

  if (!blocked && suggest) {
    const dismiss = () => {
      // Stamped with the version it was about, so the NEXT release asks again.
      try {
        setMeta(SEEN_KEY, suggest);
      } catch {
        // A failed write only means it asks once more. Not worth reporting.
      }
      setSuggest(null);
    };
    return (
      <View style={[StyleSheet.absoluteFill, styles.scrim]}>
        {/* Tapping the dark area is the same as Later: a sheet you cannot get
            out of except through a button is a blocker wearing a sheet. */}
        <Pressable style={{ flex: 1 }} onPress={dismiss} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>{t('updateGate.suggestTitle')}</Text>
          <Text style={styles.sheetBody}>{t('updateGate.suggestBody')}</Text>
          <Pressable style={styles.sheetCta} onPress={() => void Linking.openURL(STORE_URL)}>
            <Text style={styles.ctaText}>{t('updateGate.cta')}</Text>
          </Pressable>
          <Pressable style={styles.later} onPress={dismiss}>
            <Text style={styles.laterText}>{t('updateGate.later')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!blocked) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap]}>
      <View style={styles.iconCircle}>
        <Ionicons name="arrow-up-circle-outline" size={44} color={colors.yellow} />
      </View>
      <Text style={styles.title}>{t('updateGate.title')}</Text>
      <Text style={styles.sub}>{t('updateGate.body')}</Text>
      <Pressable style={styles.cta} onPress={() => void Linking.openURL(STORE_URL)}>
        <Text style={styles.ctaText}>{t('updateGate.cta')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end', zIndex: 1000 },
  sheet: {
    backgroundColor: colors.panel,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: space.lg,
    paddingTop: 10,
    paddingBottom: 38,
    alignItems: 'center',
    gap: 12,
  },
  grabber: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#3A3A42', marginBottom: 10 },
  sheetTitle: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  sheetBody: { color: colors.dim, fontSize: 14.5, lineHeight: 20, textAlign: 'center', paddingHorizontal: 8 },
  sheetCta: {
    alignSelf: 'stretch',
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 6,
  },
  later: { paddingVertical: 10 },
  laterText: { color: colors.faint, fontSize: 14, fontWeight: '600' },
  wrap: {
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 18,
    zIndex: 1000,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1.5,
    borderColor: '#4A4A4E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.text, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.dim, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  cta: {
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 15,
    paddingHorizontal: 40,
    marginTop: 8,
  },
  ctaText: { color: colors.onYellow, fontSize: 13.5, fontWeight: '800', letterSpacing: 1 },
});
