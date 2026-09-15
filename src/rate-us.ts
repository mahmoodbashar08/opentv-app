/**
 * Asking to be rated, at the one moment somebody is actually pleased.
 *
 * WHY IT EXISTS: eight ratings and four written reviews after months on two
 * stores. Almost nobody rates an app they were never asked to rate, and that
 * listing is the first thing a TV Time refugee sees before they ever open it.
 *
 * A LINK, NOT THE NATIVE SHEET, AND NOT BY CHOICE. `expo-store-review` is the
 * right tool — it draws Apple's in-app control, so the reader never leaves —
 * but version 57.0.3 does not compile against this Xcode: `cannot find
 * 'SceneGeometry' in scope`, in the module's own Swift. Not worth fighting
 * before a release, so this opens the store's review composer directly with
 * `?action=write-review`, which needs no native code at all. Swap it back the
 * day that module builds; `maybeAskForRating` is the only caller either way.
 *
 * THE MOMENT MATTERS MORE THAN THE WORDING, and there is exactly one good one
 * here: the import has just finished and a decade of history is back on screen.
 * Anywhere else is an interruption. Never on a failure, never mid-task, and
 * never before the library has anything in it.
 *
 * ASKED ONCE PER VERSION, AT MOST, and it is a question with a No in it. A
 * prompt that cannot be declined is a prompt that earns one-star reviews from
 * the exact people it interrupted.
 */
import Constants from 'expo-constants';
import { Alert, Linking, Platform } from 'react-native';

import { getMeta, setMeta } from '@/db';
import { currentLocale, t } from '@/i18n';
import { formatCount } from '@/locale-resolve';

const KEY = 'ratePromptedVersion';

/** Straight into the composer, not the listing. */
export const REVIEW_URL =
  Platform.OS === 'android'
    ? 'https://play.google.com/store/apps/details?id=com.insightfy.opentv'
    : 'https://apps.apple.com/app/id6787399404?action=write-review';

/** How much recovered history counts as a good moment. Below this the import
 *  was a trial run, and being asked to rate it is being asked about nothing. */
const ENOUGH_EPISODES = 50;

export function ratePromptAlreadyShown(): boolean {
  const v = Constants.expoConfig?.version ?? '';
  return !!v && getMeta(KEY) === v;
}

/**
 * Ask, if this is a moment worth asking at. Silent and safe on every failure:
 * a rating prompt that throws would be a rating prompt that breaks an import.
 */
export function maybeAskForRating(episodesRecovered: number): void {
  try {
    if (episodesRecovered < ENOUGH_EPISODES) return;
    if (ratePromptAlreadyShown()) return;
    /*
     * STAMPED BEFORE THE ASK. There is no answer to wait for — the reader may
     * tap Later, or leave for the store and never come back — and stamping
     * afterwards would re-ask on the next launch in both cases.
     */
    setMeta(KEY, Constants.expoConfig?.version ?? '');
    /*
     * GROUPED, LIKE EVERY OTHER COUNT IN THE APP. Raw interpolation printed
     * "4182" where the profile and the import summary both say "4,182" — and
     * the whole point of the sentence is that the number feels large.
     */
    Alert.alert(t('rate.title'), t('rate.body', { count: formatCount(episodesRecovered, currentLocale()) }), [
      { text: t('rate.later'), style: 'cancel' },
      { text: t('rate.now'), onPress: () => void Linking.openURL(REVIEW_URL) },
    ]);
  } catch {
    // No store on this build, or a simulator. Both normal.
  }
}
