import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';

import { backupNow, icloudAvailable, icloudSupported, lastBackupAt } from '@/backup';
import { shareLibraryExport } from '@/manual-backup';
import { ContentColumn, MenuRow, NavHeader, PillButton, Screen, TopTabs } from '@/components/ui';
import seed from '@/seed';
import { exportAll, getMeta, wipeAllData } from '@/db';
import { isSeedLibrary } from '@/library';
import { bestPopcornScore } from '@/components/popcorn-game';
import { disableEpisodeNotifications, enableEpisodeNotifications, notificationsEnabled, notifyKindEnabled, setNotifyKind } from '@/notifications';
import { setOnboarded } from '@/session-store';
import { getGuessedMovies } from '@/db';
import { discardSnapshot, restoreSnapshot, snapshotCounts, snapshotTakenAt } from '@/pre-tvdb-snapshot';
import { refreshAllShowMetadata } from '@/show-meta-fetch';
import { tvdbKeyFailed, userTvdbKey } from '@/tvdb';
import { colors, space } from '@/theme';

/** Export as a TV Time-format ZIP (images bundled) — our importer reads it
 * back losslessly. Shares via the Android-safe helper. */
async function exportData() {
  try {
    await shareLibraryExport();
  } catch (err) {
    Alert.alert('Export failed', err instanceof Error ? err.message : String(err));
  }
}

/** Full raw backup as JSON — belt and braces alongside the ZIP. */
async function exportJson() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sharing = require('expo-sharing') as typeof import('expo-sharing');
    const name = `opentv-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.write(JSON.stringify(exportAll()));
    // Share.share only attaches a file on iOS — Android needs expo-sharing
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Back up your OpenTV data' });
    } else {
      await Share.share({ url: file.uri });
    }
  } catch (err) {
    Alert.alert('Export failed', err instanceof Error ? err.message : String(err));
  }
}

function logOut() {
  Alert.alert('Log out?', 'Your library stays safely on this device — you just return to the welcome screen.', [
    {
      text: 'Log out',
      style: 'destructive',
      onPress: () => {
        setOnboarded(false);
        // navigate explicitly — don't rely on the guard flip alone
        setTimeout(() => router.replace('/welcome'), 0);
      },
    },
    { text: 'Cancel', style: 'cancel' },
  ]);
}

const TABS = ['Account', 'App', 'Data'] as const;

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

export default function SettingsScreen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Account');
  const [priv, setPriv] = useState(false);
  const [reminders, setReminders] = useState(notificationsEnabled());
  const toggleReminders = (on: boolean) => {
    if (on) {
      void enableEpisodeNotifications().then((ok) => {
        setReminders(ok);
        if (!ok) Alert.alert('Notifications are off', 'Allow notifications for OpenTV in system Settings to get episode reminders.');
      });
    } else {
      setReminders(false);
      void disableEpisodeNotifications();
    }
  };
  // the extra notification kinds, each independently switchable so a user
  // annoyed by one doesn't mute the category and lose the useful ones
  const [finales, setFinales] = useState(() => notifyKindEnabled('finale'));
  const [catchup, setCatchup] = useState(() => notifyKindEnabled('catchup'));
  const [movieNight, setMovieNight] = useState(() => notifyKindEnabled('movieNight'));
  const [inactivity, setInactivity] = useState(() => notifyKindEnabled('inactivity'));
  const [hideWatched, setHideWatched] = useState(false);
  const [backedUp, setBackedUp] = useState(lastBackupAt());
  // Refresh all metadata — one pass over the whole library, so it needs a
  // live counter rather than a spinner
  const [refreshing, setRefreshing] = useState(false);
  const [refreshDone, setRefreshDone] = useState(0);
  const [refreshTotal, setRefreshTotal] = useState(0);
  const refreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshDone(0);
    setRefreshTotal(0);
    try {
      const { total, ok } = await refreshAllShowMetadata((done, t) => {
        setRefreshDone(done);
        setRefreshTotal(t);
      });
      // the refresh never throws — a failed fetch keeps serving the cached copy
      // — so without checking the result this reported success while reaching
      // nothing at all
      if (total > 0 && ok === 0) {
        Alert.alert('Refresh failed', 'Could not reach the metadata service. Check your connection and try again.');
      } else if (ok < total) {
        Alert.alert(
          'Partly refreshed',
          `${ok} of ${total} shows updated. The rest will finish on their own over the next few launches.`,
        );
      }
    } catch {
      Alert.alert('Refresh failed', 'Could not reach the metadata service. Check your connection and try again.');
    } finally {
      setRefreshing(false);
    }
  };

  // the 1.2.0 numbering migration keeps a verbatim copy of every watch row it
  // touched. It is never deleted automatically — this is the way back.
  const [snapAt, setSnapAt] = useState(() => snapshotTakenAt());
  const [guessedMovies] = useState(() => getGuessedMovies().length);
  // an import cut short finishes itself on the next launch, with no screen in
  // front of it — this is the only way its summary and "Needs attention" list
  // ever reach the user. Re-read on focus so it clears once they've seen it.
  const [resumedSummary, setResumedSummary] = useState(() => !!getMeta('resumedImportSummary'));
  useFocusEffect(useCallback(() => setResumedSummary(!!getMeta('resumedImportSummary')), []));
  const undoMigration = () => {
    const counts = snapshotCounts();
    const total = Object.values(counts).reduce((n, v) => n + v, 0);
    Alert.alert(
      'Undo the episode-numbering update?',
      `Your watch history goes back exactly as it was before the update — ${total.toLocaleString()} rows saved on ${new Date(snapAt ?? '').toLocaleDateString()}.\n\nAnything you marked watched since then will be lost. Seasons will go back to how they looked before.`,
      [
        {
          text: 'Restore',
          style: 'destructive',
          onPress: () => {
            const ok = restoreSnapshot();
            Alert.alert(
              ok ? 'Restored' : 'Could not restore',
              ok
                ? 'Your history is back to its pre-update state. Restart the app to see it everywhere.'
                : 'The saved copy could not be read. Your current data has not been changed.',
            );
          },
        },
        {
          text: 'Delete the saved copy',
          style: 'destructive',
          onPress: () => {
            discardSnapshot();
            setSnapAt(null);
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const backedUpLabel = backedUp
    ? new Date(backedUp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Never';

  const backUp = async () => {
    try {
      const r = await backupNow(true);
      if (r === 'unavailable') {
        Alert.alert(
          'iCloud Drive is off',
          'Sign in to iCloud and turn on iCloud Drive in Settings, then try again. Until then, use "Export my data" to keep a copy safe.',
        );
        return;
      }
      setBackedUp(lastBackupAt());
      Alert.alert('Backed up ✓', 'Your library is safe in your iCloud Drive — it survives deleting the app.');
    } catch (err) {
      Alert.alert('Backup failed', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Screen>
      <NavHeader title="Settings" />
      <TopTabs tabs={TABS} active={tab} onChange={setTab} />
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      <ContentColumn>
        {tab === 'Account' && (
          <>
            <SectionTitle title="Identification" />
            <MenuRow title="Username" value={getMeta('username') ?? seed.profile.username} />
            <MenuRow title="Member since" value={isSeedLibrary() ? seed.profile.since : "today"} />
            <SectionTitle title="Your data" />
            <MenuRow
              title="Export my data"
              sub="TV Time-format ZIP — import it back anytime"
              onPress={() => void exportData()}
            />
            <SectionTitle title="Privacy" />
            <MenuRow
              title="Set profile to private"
              sub="Only followers can see your activity."
              right={<Switch value={priv} onValueChange={setPriv} trackColor={{ true: colors.green }} />}
            />
            <View style={{ alignItems: 'center', marginTop: 30, gap: 14 }}>
              <PillButton label="Log out" onPress={logOut} />
              <Text style={styles.note}>
                Logging out keeps your library on this device — the welcome screen lets you back in.
              </Text>
            </View>
          </>
        )}

        {tab === 'App' && (
          <>
            <SectionTitle title="Notifications" />
            <MenuRow
              title="New episode reminders"
              sub="Scheduled on-device from air dates"
              right={<Switch value={reminders} onValueChange={toggleReminders} trackColor={{ true: colors.green }} />}
            />
            {reminders && (
              <>
                <MenuRow
                  title="Season & series finales"
                  sub="Flags the finale instead of a plain reminder"
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
                <MenuRow
                  title="Almost done"
                  sub="When you're an episode or two from finishing a season"
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
                <MenuRow
                  title="Movie night"
                  sub="Friday evening, if your watchlist isn't empty"
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
                <MenuRow
                  title="Come back reminders"
                  sub="After a week away, only if episodes are waiting"
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
              </>
            )}
            <SectionTitle title="Theme" />
            <MenuRow title="Dark mode" sub="Light theme arrives later" />
            <SectionTitle title="Titles" />
            <MenuRow title="Display in your language" sub="By default, titles display in English" right={<Switch value={false} trackColor={{ true: colors.green }} />} />
            <SectionTitle title="Metadata" />
            <MenuRow
              title="TheTVDB key"
              sub={
                userTvdbKey()
                  ? 'Using your own key'
                  : tvdbKeyFailed()
                    ? 'Shared key not working — add your own'
                    : 'Optional — improves matching if the shared key fails'
              }
              value={tvdbKeyFailed() && !userTvdbKey() ? '!' : undefined}
              onPress={() => router.push('/tvdb-key')}
            />
            {!!snapAt && (
              <MenuRow
                title="Undo the episode-numbering update"
                sub={`Restore your history as it was on ${new Date(snapAt).toLocaleDateString()}`}
                onPress={undoMigration}
              />
            )}
            {resumedSummary && (
              <MenuRow
                title="See your last import's summary"
                sub="An import finished in the background — here's what it brought in, and anything that needs attention"
                onPress={() => router.push('/import?summary=1')}
              />
            )}
            {guessedMovies > 0 && (
              <MenuRow
                title="Review matched movies"
                sub={`${guessedMovies} film${guessedMovies === 1 ? '' : 's'} shared a name with another — check we picked right`}
                value={String(guessedMovies)}
                onPress={() => router.push('/review-movies')}
              />
            )}
            <MenuRow
              title="Refresh all metadata"
              sub={
                refreshing
                  ? `Refreshing… ${refreshDone}/${refreshTotal || '…'}`
                  : 'Re-download every show’s episodes, artwork and cast'
              }
              onPress={() => void refreshAll()}
            />
            <SectionTitle title="Fun" />
            <MenuRow
              title="Popcorn game"
              sub={`Best score: ${bestPopcornScore()}`}
              onPress={() => router.push('/popcorn' as never)}
            />
            <SectionTitle title="About" />
            <MenuRow title="About OpenTV" sub="Version, data sources, privacy" onPress={() => router.push('/about')} />
          </>
        )}

        {tab === 'Data' && (
          <>
            {icloudSupported() && (
              <>
                <SectionTitle title="iCloud backup" />
                <MenuRow
                  title="iCloud Drive"
                  sub="Your library survives deleting the app"
                  value={icloudAvailable() ? 'On' : 'Off'}
                />
                <MenuRow title="Last backed up" value={backedUpLabel} />
                <MenuRow
                  title="Back up now"
                  sub="Writes OpenTV Backup.zip to Files → iCloud Drive → OpenTV"
                  onPress={() => void backUp()}
                />
              </>
            )}
            <SectionTitle title="Your data" />
            <MenuRow title="Import TV Time export" sub="Bring your full history" onPress={() => router.push('/import')} />
            <MenuRow title="Export my data" sub="TV Time-format ZIP" onPress={() => void exportData()} />
            <MenuRow title="Backup as JSON" sub="Raw full backup" onPress={() => void exportJson()} />
            <SectionTitle title="Upcoming" />
            <MenuRow
              title="Hide watched episodes"
              right={<Switch value={hideWatched} onValueChange={setHideWatched} trackColor={{ true: colors.green }} />}
            />
            <SectionTitle title="Danger zone" />
            <MenuRow
              title="Erase all data"
              sub="Deletes the local database. No undo."
              danger
              onPress={() =>
                Alert.alert(
                  'Erase all data?',
                  icloudSupported()
                    ? 'This deletes your entire library from this device. Your iCloud backup is kept — you can restore from it on the welcome screen.'
                    : 'This deletes your entire library from this device. Export a copy first if you want to keep it.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Erase',
                      style: 'destructive',
                      onPress: async () => {
                        // capture the latest state first — the welcome screen's
                        // restore offer is only as good as the last backup
                        try {
                          await backupNow();
                        } catch {
                          // no iCloud right now — erase proceeds regardless
                        }
                        wipeAllData();
                        setOnboarded(false);
                        // settings itself isn't behind the guard, so it stays
                        // mounted when the flag flips — leave it explicitly
                        router.replace('/welcome');
                      },
                    },
                  ],
                )
              }
            />
          </>
        )}
      </ContentColumn>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
    paddingHorizontal: space.lg,
    paddingTop: 18,
    paddingBottom: 4,
  },
  note: { color: colors.faint, fontSize: 12.5, textAlign: 'center', paddingHorizontal: 30 },
});
