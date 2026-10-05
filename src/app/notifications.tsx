/**
 * Every notification, in one place.
 *
 * SEVEN SWITCHES AND A TIME, on the App tab, under a heading that made them
 * look like eight equal preferences. They are not: one of them is the master
 * — turn `newEpisodeReminders` off and the other six are moot — and the rest
 * are refinements of it. A list gave no clue which was which.
 *
 * So the master keeps its place at the top and the refinements sit under it,
 * exactly as they did; what changes is that Settings now shows ONE row
 * carrying the summary, and this screen is where the detail lives. Somebody
 * who came to stop a buzz finds the switch in two taps instead of scrolling
 * past six others first.
 *
 * "On this day" MOVED HERE, and it should always have been here. It is
 * `notifyKind('memory')` — a notification in every way that matters — and it
 * sat under General because that is where there was room. A reminder about
 * three years ago is not a general preference.
 */
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text } from 'react-native';

import {
  disableEpisodeNotifications,
  enableEpisodeNotifications,
  notificationsEnabled,
  notifyKindEnabled,
  reminderHour,
  setNotifyKind,
  setReminderHour,
} from '@/notifications';
import { MenuRow, NavHeader, Screen } from '@/components/ui';
import { t } from '@/i18n';
import { colors, space } from '@/theme';

export default function NotificationsScreen() {
  const [reminders, setReminders] = useState(notificationsEnabled());
  const toggleReminders = (on: boolean) => {
    if (on) {
      void enableEpisodeNotifications().then((ok) => {
        setReminders(ok);
        if (!ok) Alert.alert(t('settings.app.notificationsOffTitle'), t('settings.app.notificationsOffBody'));
      });
    } else {
      setReminders(false);
      void disableEpisodeNotifications();
    }
  };
  // Each kind is independently switchable, so somebody annoyed by one does not
  // mute the category and lose the useful ones.
  const [finales, setFinales] = useState(() => notifyKindEnabled('finale'));
  const [remindAt, setRemindAt] = useState(() => reminderHour());
  const [catchup, setCatchup] = useState(() => notifyKindEnabled('catchup'));
  const [movieNight, setMovieNight] = useState(() => notifyKindEnabled('movieNight'));
  const [inactivity, setInactivity] = useState(() => notifyKindEnabled('inactivity'));
  // Defaults OFF — the game is an easter egg, not a reason anybody installed a
  // TV tracker, so this one is opt-in.
  const [popcorn, setPopcorn] = useState(() => notifyKindEnabled('popcorn'));
  // ITS OWN SWITCH, and that is the point of it. Wanting to know an episode
  // aired and wanting to be reminded of three years ago are different people.
  const [memory, setMemory] = useState(() => notifyKindEnabled('memory'));

  return (
    <Screen>
      <NavHeader title={t('settings.app.notificationsSection')} close />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
        <MenuRow trackId="settings.app.newEpisodeReminders"
          title={t('settings.app.newEpisodeReminders')}
          sub={t('settings.app.newEpisodeRemindersSub')}
          right={<Switch value={reminders} onValueChange={toggleReminders} trackColor={{ true: colors.green }} />}
        />
        {reminders && (
          <>
            {/*
              WHEN, not just whether.

              Every reminder arrived at 20:00, and a viewer asked for the
              moment the show actually starts, "like in football apps".
              That is answerable for traditional broadcast and not for
              streaming, which is most of what anybody tracks -- and a
              notification claiming "starts now" four hours early is worse
              than one that never claimed a time. See
              `DEFAULT_REMINDER_HOUR` for the whole reasoning.

              So the hour is theirs, and the app keeps a promise it can
              keep. Tapping CYCLES rather than opening a picker: there are
              twenty-four answers, almost everybody wants one of about
              four, and a wheel for that is a screen nobody needs.
            */}
            <MenuRow trackId="settings.app.reminderTime"
              title={t('settings.app.reminderTime')}
              sub={t('settings.app.reminderTimeSub')}
              onPress={() => {
                const next = (remindAt + 1) % 24;
                setRemindAt(next);
                void setReminderHour(next);
              }}
              right={<Text style={styles.reminderAt}>{`${String(remindAt).padStart(2, '0')}:00`}</Text>}
            />
            <MenuRow trackId="settings.app.finaleReminders"
              title={t('settings.app.finaleReminders')}
              sub={t('settings.app.finaleRemindersSub')}
              right={
                <Switch
                  value={finales}
                  onValueChange={(v) => {
                    setFinales(v);
                    void setNotifyKind('finale', v);
                  }}
                  trackColor={{ true: colors.green }}
                />
              }
            />
            <MenuRow trackId="settings.app.almostDone"
              title={t('settings.app.almostDone')}
              sub={t('settings.app.almostDoneSub')}
              right={
                <Switch
                  value={catchup}
                  onValueChange={(v) => {
                    setCatchup(v);
                    void setNotifyKind('catchup', v);
                  }}
                  trackColor={{ true: colors.green }}
                />
              }
            />
            <MenuRow trackId="settings.app.movieNight"
              title={t('settings.app.movieNight')}
              sub={t('settings.app.movieNightSub')}
              right={
                <Switch
                  value={movieNight}
                  onValueChange={(v) => {
                    setMovieNight(v);
                    void setNotifyKind('movieNight', v);
                  }}
                  trackColor={{ true: colors.green }}
                />
              }
            />
            <MenuRow trackId="settings.app.comeBackReminders"
              title={t('settings.app.comeBackReminders')}
              sub={t('settings.app.comeBackRemindersSub')}
              right={
                <Switch
                  value={inactivity}
                  onValueChange={(v) => {
                    setInactivity(v);
                    void setNotifyKind('inactivity', v);
                  }}
                  trackColor={{ true: colors.green }}
                />
              }
            />
            <MenuRow trackId="settings.app.popcornChallenges"
              title={t('settings.app.popcornChallenges')}
              sub={t('settings.app.popcornChallengesSub')}
              right={
                <Switch
                  value={popcorn}
                  onValueChange={(v) => {
                    setPopcorn(v);
                    void setNotifyKind('popcorn', v);
                  }}
                  trackColor={{ true: colors.green }}
                />
              }
            />
          </>
        )}
        <MenuRow trackId="settings.app.onThisDay"
          title={t('settings.app.onThisDay')}
          sub={t('settings.app.onThisDaySub')}
          right={
            <Switch
              value={memory}
              onValueChange={(v) => {
                setMemory(v);
                void setNotifyKind('memory', v);
              }}
              trackColor={{ true: colors.green }}
            />
          }
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  reminderAt: { color: colors.blue, fontSize: 15.5, fontWeight: '700' },
});
