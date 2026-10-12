/**
 * Settings → Daily puzzle.
 *
 * THREE SWITCHES AND A TIME, on their own screen rather than in a list of
 * everything else, because they are one subject. The first is the master:
 * off, and the game is gone from the Explore tab, the profile and the
 * reminders — but NOT from `meta`. The history, the streak and the squares
 * stay, so switching it back on is not a fresh start.
 *
 * THE REMINDER IS OFF BY DEFAULT and fires only when the streak would end
 * tonight (`streakAtRisk`). Turning it on asks for notification permission
 * through the same door as every other reminder: `notifications.ts` plans
 * nothing while its master switch is off, so the switch has to open that too.
 *
 * THE PUBLIC SWITCH takes effect at once: turning it off republishes the
 * arrangement without the puzzle's value, so the server does not keep a copy
 * the owner no longer wants shown.
 */
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text } from 'react-native';

import { MenuRow, NavHeader, Screen } from '@/components/ui';
import { t } from '@/i18n';
import { enableEpisodeNotifications, notificationsEnabled, syncEpisodeNotifications } from '@/notifications';
import {
  puzzleOn,
  puzzlePublicOn,
  puzzleReminderHour,
  puzzleReminderOn,
  republishPuzzleBlock,
  setPuzzleOn,
  setPuzzlePublicOn,
  setPuzzleReminderHour,
  setPuzzleReminderOn,
} from '@/puzzle-data';
import { colors, space } from '@/theme';

export default function PuzzleSettingsScreen() {
  const [on, setOn] = useState(puzzleOn);
  const [remind, setRemind] = useState(puzzleReminderOn);
  const [hour, setHour] = useState(puzzleReminderHour);
  const [pub, setPub] = useState(puzzlePublicOn);

  const toggleRemind = (v: boolean) => {
    if (!v) {
      setRemind(false);
      setPuzzleReminderOn(false);
      void syncEpisodeNotifications(true);
      return;
    }
    const arm = () => {
      setRemind(true);
      setPuzzleReminderOn(true);
      void syncEpisodeNotifications(true);
    };
    if (notificationsEnabled()) {
      arm();
      return;
    }
    void enableEpisodeNotifications().then((ok) => {
      if (ok) arm();
      else Alert.alert(t('settings.app.notificationsOffTitle'), t('settings.app.notificationsOffBody'));
    });
  };

  return (
    <Screen>
      <NavHeader title={t('puzzle.settings.title')} />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
        <MenuRow
          trackId="puzzle.settings.game"
          title={t('puzzle.settings.game')}
          sub={t('puzzle.settings.gameSub')}
          right={
            <Switch
              value={on}
              onValueChange={(v) => {
                setOn(v);
                setPuzzleOn(v);
                // Off takes the block off the public profile and the reminder
                // out of the plan; on puts both back.
                void republishPuzzleBlock();
                void syncEpisodeNotifications(true);
              }}
              trackColor={{ true: colors.green }}
            />
          }
        />
        {on && (
          <>
            <MenuRow
              trackId="puzzle.settings.remind"
              title={t('puzzle.settings.remind')}
              sub={t('puzzle.settings.remindSub')}
              right={<Switch value={remind} onValueChange={toggleRemind} trackColor={{ true: colors.green }} />}
            />
            {remind && (
              // Tapping CYCLES the hour, as the episode reminders' row does:
              // twenty-four answers, four anybody wants, no wheel.
              <MenuRow
                trackId="puzzle.settings.remindAt"
                title={t('puzzle.settings.remindAt')}
                onPress={() => {
                  const next = (hour + 1) % 24;
                  setHour(next);
                  setPuzzleReminderHour(next);
                  void syncEpisodeNotifications(true);
                }}
                right={<Text style={styles.hour}>{`${String(hour).padStart(2, '0')}:00`}</Text>}
              />
            )}
            <MenuRow
              trackId="puzzle.settings.public"
              title={t('puzzle.settings.public')}
              sub={t('puzzle.settings.publicSub')}
              right={
                <Switch
                  value={pub}
                  onValueChange={(v) => {
                    setPub(v);
                    setPuzzlePublicOn(v);
                    void republishPuzzleBlock();
                  }}
                  trackColor={{ true: colors.green }}
                />
              }
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hour: { color: colors.blue, fontSize: 15.5, fontWeight: '700' },
});
