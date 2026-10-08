/**
 * Calendar — its own page, like Plex, Jellyfin and Stremio beside it in
 * Settings (8 Oct). It was a switch and two loose rows in the middle of the
 * Data section; a row that opens nothing read as broken next to rows that do.
 *
 * Turning it ON is the one call that may show a system prompt, so it only ever
 * happens on a deliberate tap; turning it OFF deletes the calendar rather than
 * leaving sixty entries in somebody's diary that nothing maintains any more.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, ScrollView, Switch } from 'react-native';

import {
  disableCalendarSync,
  enableCalendarSync,
  lastCalendarCounts,
  lastCalendarError,
  lastCalendarSyncAt,
  calendarSyncOn,
  syncCalendar,
} from '@/calendar-sync';
import { MenuRow, NavHeader, Screen } from '@/components/ui';
import { currentLocale, t } from '@/i18n';
import { usePlus } from '@/plus';
import { colors } from '@/theme';

export default function CalendarSyncScreen() {
  const plus = usePlus();
  const [on, setOn] = useState(() => calendarSyncOn());
  const [at, setAt] = useState<number | null>(() => lastCalendarSyncAt());
  const [busy, setBusy] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setOn(calendarSyncOn());
      setAt(lastCalendarSyncAt());
    }, []),
  );

  const label = at
    ? new Date(at).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' })
    : t('calendarSync.never');

  // A refused permission can only be fixed in the phone's own Settings, so the
  // alert takes you there instead of describing the way.
  const denied = () =>
    Alert.alert(
      t('calendarSync.deniedTitle'),
      `${t('calendarSync.deniedBody')}${lastCalendarError() ? `\n\n${lastCalendarError()}` : ''}`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('calendarSync.openSettings'), onPress: () => void Linking.openSettings() },
      ],
    );

  const toggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (!next) {
        await disableCalendarSync();
        setOn(false);
        setAt(null);
        return;
      }
      const r = await enableCalendarSync();
      setOn(r === 'done');
      setAt(lastCalendarSyncAt());
      // Its own sentence: "could not set that up" for an expired card sends
      // somebody to check their calendar permissions for an hour.
      if (r === 'plus-required') Alert.alert(t('calendarSync.plusTitle'), t('calendarSync.plusBody'));
      else if (r === 'denied') denied();
      else if (r !== 'done')
        Alert.alert(
          t('calendarSync.failedTitle'),
          `${t('calendarSync.failedBody')}${lastCalendarError() ? `\n\n${lastCalendarError()}` : ''}`,
        );
    } catch (err) {
      // `void toggle(v)` throws a rejection away; a switch that moved, failed
      // and said nothing is the worst outcome, so this one must exist.
      Alert.alert(
        t('calendarSync.failedTitle'),
        `${t('calendarSync.failedBody')}\n\n${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await syncCalendar(true);
      setAt(lastCalendarSyncAt());
      if (r === 'plus-required') Alert.alert(t('calendarSync.plusTitle'), t('calendarSync.plusBody'));
      else if (r === 'denied') denied();
      else if (r !== 'done') Alert.alert(t('calendarSync.failedTitle'), t('calendarSync.failedBody'));
      else {
        // Says what it wrote: a calendar looks the same whether air times
        // arrived or not, and the split answers that at a glance.
        const c = lastCalendarCounts();
        Alert.alert(t('calendarSync.title'), t('calendarSync.wrote', { total: c.total, timed: c.timed, allDay: c.allDay }));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <NavHeader title={t('calendarSync.title')} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <MenuRow
          trackId="calendarSync.switch"
          title={t('calendarSync.title')}
          sub={t('calendarSync.sub')}
          right={<Switch value={on} disabled={busy} onValueChange={(v) => void toggle(v)} trackColor={{ true: colors.green }} />}
        />
        {/* Said without being asked: a switch that is on and a calendar that
            stopped filling, with nothing admitting why, was the complaint. */}
        {on && !plus && (
          <MenuRow
            trackId="calendarSync.lapsed"
            title={t('calendarSync.plusTitle')}
            sub={t('calendarSync.plusBody')}
            onPress={() => router.push('/paywall')}
          />
        )}
        {on && (
          <>
            <MenuRow trackId="calendarSync.lastSynced" title={t('calendarSync.lastSynced')} value={label} />
            <MenuRow
              trackId="calendarSync.syncNow"
              title={t('calendarSync.syncNow')}
              sub={t('calendarSync.note')}
              onPress={() => void refresh()}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
