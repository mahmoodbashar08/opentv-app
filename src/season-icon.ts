/**
 * The season's app icon — its own module because `app-icon.ts` is loaded by
 * `plus.ts` and must stay free of the database, i18n and React Native.
 */
import { currentIcon, setIcon, supported, type AppIconName } from '@/app-icon';
import { getMeta, setMeta } from '@/db';
import { t } from '@/i18n';
import { activeEvent, seasonalOn, type SeasonId } from '@/season';

/**
 * THE SEASON'S ICON (9 Oct). During an event the app offers its icon once —
 * one tap, never switched unasked: iOS announces every change with its own
 * alert, and Apple expects an icon to change because somebody chose it. Free
 * may use the original and the running season's icon; every other is Plus.
 * When the season ends, an icon this offer put on goes back to the original —
 * one the person picked by hand is theirs and is left alone.
 */
export const SEASON_ICON: Partial<Record<SeasonId, AppIconName>> = { halloween: 'halloween', christmas: 'christmas' };
const ASKED = 'seasonIconAsked';
const AUTO = 'seasonIconAuto';

/** The icons a free account may choose right now. */
export function freeIcons(): AppIconName[] {
  const e = activeEvent();
  const icon = e ? SEASON_ICON[e.id] : undefined;
  return icon ? ['default', icon] : ['default'];
}

/** A choice made in Appearance: from now on the season leaves the icon alone. */
export function iconChosenByHand(): void {
  setMeta(AUTO, '');
}

export async function offerSeasonIcon(): Promise<void> {
  if (!supported()) return;
  const e = seasonalOn() ? activeEvent() : null;
  const auto = getMeta(AUTO);
  if (auto && (!e || SEASON_ICON[e.id] !== auto)) {
    if (currentIcon() === auto) await setIcon('default');
    setMeta(AUTO, '');
  }
  const icon = e ? SEASON_ICON[e.id] : undefined;
  if (!e || !icon || getMeta(ASKED) === e.id) return;
  setMeta(ASKED, e.id);
  // Somebody who already picked an icon of their own is not asked to change it.
  if (currentIcon() !== 'default') return;
  const season = t(`seasonal.${e.id}`);
  // Required here, not imported: this module is loaded by suites that run without React Native.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Alert } = require('react-native') as typeof import('react-native');
  Alert.alert(t('seasonIcon.title', { season }), t('seasonIcon.body', { season }), [
    { text: t('seasonIcon.keep'), style: 'cancel' },
    {
      text: t('seasonIcon.use'),
      onPress: () =>
        void setIcon(icon).then((ok) => {
          if (ok) setMeta(AUTO, icon);
        }),
    },
  ]);
}
