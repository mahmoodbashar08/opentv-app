import { router, useFocusEffect } from 'expo-router';
import { useCallback, useReducer, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';

import { ApiError } from '@/api';
import { backupNow, icloudAvailable, icloudSupported, lastBackupAt } from '@/backup';
import { deleteCommunityAccount, leaveCommunity } from '@/community-account';
import { hasAnythingToSeed, seedingDone } from '@/community-seed';
import { getHandle, useJoined } from '@/community-session';
import { communityErrorKey, HIDE_UNSEEN_KEY } from '@/pure';
import { shareLibraryExport } from '@/manual-backup';
import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { MenuRow, NavHeader, PillButton, Screen, TopTabs } from '@/components/ui';
import seed from '@/seed';
import { exportAll, getMeta, setMeta, wipeAllData } from '@/db';
import { currentLocale, t } from '@/i18n';
import { isSeedLibrary } from '@/library';
import { formatCount } from '@/locale-resolve';
import { NAMES } from '@/app/language';
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
    Alert.alert(t('settings.data.exportFailedTitle'), err instanceof Error ? err.message : String(err));
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
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: t('settings.data.backupJsonShareTitle') });
    } else {
      await Share.share({ url: file.uri });
    }
  } catch (err) {
    Alert.alert(t('settings.data.exportFailedTitle'), err instanceof Error ? err.message : String(err));
  }
}

function logOut() {
  Alert.alert(t('settings.account.logOutConfirmTitle'), t('settings.account.logOutConfirmBody'), [
    {
      text: t('settings.account.logOut'),
      style: 'destructive',
      onPress: () => {
        setOnboarded(false);
        // navigate explicitly — don't rely on the guard flip alone
        setTimeout(() => router.replace('/welcome'), 0);
      },
    },
    { text: t('common.cancel'), style: 'cancel' },
  ]);
}

/**
 * Leaving the community. ONE confirmation, because nothing is destroyed —
 * matching `logOut` above rather than the two-step erase flow, since the two
 * are the same kind of act: this device stops being signed in, and everything
 * else — locally and on the server — is exactly where it was.
 *
 * The body says so in as many words. "Leave" reads as destructive to someone
 * who has published comments, and the only cure for that fear is telling them
 * plainly that their profile and their comments remain.
 */
function confirmLeaveCommunity() {
  Alert.alert(t('community.settings.leaveConfirmTitle'), t('community.settings.leaveConfirmBody'), [
    { text: t('common.cancel'), style: 'cancel' },
    {
      text: t('community.settings.leaveConfirmAction'),
      style: 'destructive',
      // No server call, no library write. Just the token and the flag.
      onPress: () => void leaveCommunity(),
    },
  ]);
}

/**
 * Deleting the community account. TWO confirmations, the app's idiom for an
 * irreversible act (see the erase-everything flow in the Data tab), and for
 * the same reason: the first alert is an explanation and the second is a
 * decision, so nobody arrives at "gone for ever" by muscle memory.
 *
 * The copy is written against what `backend/src/routes/auth.ts` actually does
 * — identity rows deleted so a later sign-in is a NEW profile, comments,
 * likes, ratings, follows, blocks, lists and notifications deleted, profile
 * row scrubbed to a shell — and against what it deliberately does not do,
 * which is touch this phone.
 */
function confirmDeleteCommunityAccount(run: () => void) {
  Alert.alert(t('community.settings.deleteConfirmTitle'), t('community.settings.deleteConfirmBody'), [
    { text: t('common.cancel'), style: 'cancel' },
    {
      text: t('community.settings.deleteContinue'),
      style: 'destructive',
      onPress: () =>
        Alert.alert(t('community.settings.deleteFinalTitle'), t('community.settings.deleteFinalBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('community.settings.deleteFinalAction'), style: 'destructive', onPress: run },
        ]),
    },
  ]);
}

const TABS = ['Account', 'App', 'Data'] as const;

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

export default function SettingsScreen() {
  // NAMES[currentLocale()] below is read directly in the render body, so
  // nothing normally triggers a re-render when the user returns from the
  // language picker — force one on every focus, the same pattern used for
  // exactly this problem in movie/[name].tsx
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  useFocusEffect(useCallback(() => refresh(), []));
  const [tab, setTab] = useState<(typeof TABS)[number]>('Account');
  // Reactive: signing in on /join must flip this row without a manual refresh.
  const joined = useJoined();
  const [priv, setPriv] = useState(false);
  const [hideUnseen, setHideUnseen] = useState(() => getMeta(HIDE_UNSEEN_KEY) !== '0');
  // The account deletion is the one network call in Settings that must not be
  // startable twice: the second DELETE would arrive with a token the first has
  // already invalidated and report a failure for an operation that succeeded.
  const [deletingAccount, setDeletingAccount] = useState(false);
  const runDeleteAccount = async () => {
    if (deletingAccount) return;
    setDeletingAccount(true);
    try {
      await deleteCommunityAccount();
      Alert.alert(t('community.settings.deletedTitle'), t('community.settings.deletedBody'));
    } catch (err) {
      // The session is deliberately still alive here — `deleteCommunityAccount`
      // only signs out after the server has answered 204. Telling someone their
      // account is gone when it is not, and taking away the token they would
      // need to try again, would be the worst outcome this screen can produce.
      Alert.alert(
        t('community.settings.deleteFailedTitle'),
        `${t(communityErrorKey(err instanceof ApiError ? err.code : 'unknown'))}\n\n${t('community.settings.deleteFailedStillSignedIn')}`,
      );
    } finally {
      setDeletingAccount(false);
    }
  };
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
  // the extra notification kinds, each independently switchable so a user
  // annoyed by one doesn't mute the category and lose the useful ones
  const [finales, setFinales] = useState(() => notifyKindEnabled('finale'));
  const [catchup, setCatchup] = useState(() => notifyKindEnabled('catchup'));
  const [movieNight, setMovieNight] = useState(() => notifyKindEnabled('movieNight'));
  const [inactivity, setInactivity] = useState(() => notifyKindEnabled('inactivity'));
  // defaults OFF — the game is an easter egg, not a reason anyone installed a
  // TV tracker, so this one is opt-in
  const [popcorn, setPopcorn] = useState(() => notifyKindEnabled('popcorn'));
  const [hideWatched, setHideWatched] = useState(false);
  const [startTab, setStartTab] = useState(() => getMeta('startTab') ?? 'profile');
  const [startSheet, setStartSheet] = useState(false);
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
        Alert.alert(t('settings.app.refreshFailedTitle'), t('settings.app.refreshFailedBody'));
      } else if (ok < total) {
        Alert.alert(
          t('settings.app.refreshPartialTitle'),
          t('settings.app.refreshPartialBody', { ok, total }),
        );
      }
    } catch {
      Alert.alert(t('settings.app.refreshFailedTitle'), t('settings.app.refreshFailedBody'));
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
      t('settings.app.undoMigrationConfirmTitle'),
      t('settings.app.undoMigrationConfirmBody', {
        count: formatCount(total, currentLocale()),
        date: new Date(snapAt ?? '').toLocaleDateString(currentLocale()),
      }),
      [
        {
          text: t('settings.app.undoMigrationRestore'),
          style: 'destructive',
          onPress: () => {
            const ok = restoreSnapshot();
            Alert.alert(
              ok ? t('settings.app.undoMigrationRestoredTitle') : t('settings.app.undoMigrationRestoreFailedTitle'),
              ok ? t('settings.app.undoMigrationRestoredBody') : t('settings.app.undoMigrationRestoreFailedBody'),
            );
          },
        },
        {
          text: t('settings.app.undoMigrationDelete'),
          style: 'destructive',
          onPress: () => {
            discardSnapshot();
            setSnapAt(null);
          },
        },
        { text: t('common.cancel'), style: 'cancel' },
      ],
    );
  };

  const backedUpLabel = backedUp
    ? new Date(backedUp).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' })
    : t('settings.data.never');

  const backUp = async () => {
    try {
      const r = await backupNow(true);
      if (r === 'unavailable') {
        Alert.alert(t('settings.data.icloudOffTitle'), t('settings.data.icloudOffBody'));
        return;
      }
      setBackedUp(lastBackupAt());
      Alert.alert(t('settings.data.backedUpTitle'), t('settings.data.backedUpBody'));
    } catch (err) {
      Alert.alert(t('settings.data.backupFailedTitle'), err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Screen>
      <NavHeader title={t('settings.title')} />
      <TopTabs
        tabs={TABS}
        labels={{ Account: t('settings.tabs.account'), App: t('settings.tabs.app'), Data: t('settings.tabs.data') }}
        active={tab}
        onChange={setTab}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        {tab === 'Account' && (
          <>
            <SectionTitle title={t('settings.account.identificationSection')} />
            <MenuRow title={t('settings.account.username')} value={getMeta('username') ?? seed.profile.username} />
            <MenuRow
              title={t('settings.account.memberSince')}
              value={isSeedLibrary() ? seed.profile.since : t('settings.account.memberSinceToday')}
            />
            {/* The community, always reachable. The one-time prompt can be
                declined, dismissed, or never shown at all (someone who started
                fresh and never imported), so this row is what guarantees
                joining is never a door that closed.
                Both exits live here too: leaving (this device signs out,
                everything survives) and deleting (the server forgets you, the
                phone does not). Neither touches a single local row. */}
            <SectionTitle title={t('community.settings.section')} />
            {joined ? (
              <>
                <MenuRow title={t('community.settings.handleRow')} value={`@${getHandle() ?? ''}`} />
                {/* The archive, on a second thought. Someone who tapped "Not
                    now" the day they joined must be able to change their mind
                    without reinstalling anything — and someone who already
                    brought them can run it again harmlessly, because the
                    server dedupes by content. */}
                {hasAnythingToSeed() && (
                  <MenuRow
                    title={t('community.settings.seedRow')}
                    sub={t('community.settings.seedRowSub')}
                    value={seedingDone() ? t('community.settings.seedRowDone') : undefined}
                    onPress={() => router.push('/seed')}
                  />
                )}
                {/* There is no "re-upload my archive" row any more, and that
                    is the point. It asked the user to know something they
                    cannot see from in here — that a phase marked done under an
                    older build is never revisited, so their votes went up
                    carrying one feeling each. `syncArchiveIfNeeded` now decides
                    that on every open, from a contract revision and a local
                    fingerprint, and sends whatever is owed without being
                    asked. */}
                <MenuRow
                  title={t('community.settings.leaveRow')}
                  sub={t('community.settings.leaveRowSub')}
                  onPress={confirmLeaveCommunity}
                />
                {/* Apple 5.1.1(v): an account made in the app must be
                    deletable from the app. Styled destructive, two-step, and
                    honest about the one thing it does NOT delete. */}
                <MenuRow
                  title={t('community.settings.deleteRow')}
                  sub={deletingAccount ? t('community.settings.deleting') : t('community.settings.deleteRowSub')}
                  danger
                  onPress={() => confirmDeleteCommunityAccount(() => void runDeleteAccount())}
                />
              </>
            ) : (
              <MenuRow
                title={t('community.settings.joinRow')}
                sub={t('community.settings.joinRowSub')}
                onPress={() => router.push('/join')}
              />
            )}
            <SectionTitle title={t('settings.account.yourDataSection')} />
            <MenuRow
              title={t('settings.account.exportData')}
              sub={t('settings.account.exportDataSub')}
              onPress={() => void exportData()}
            />
            <SectionTitle title={t('settings.account.privacySection')} />
            <MenuRow
              title={t('settings.account.privateProfile')}
              sub={t('settings.account.privateProfileSub')}
              right={<Switch value={priv} onValueChange={setPriv} trackColor={{ true: colors.green }} />}
            />
            {/* ON BY DEFAULT. The cost of the two mistakes is not symmetrical:
                a needless curtain is one tap, and a missing one is the ending
                of something you were part-way through. */}
            <MenuRow
              title={t('settings.account.hideUnseenSpoilers')}
              sub={t('settings.account.hideUnseenSpoilersSub')}
              right={
                <Switch
                  value={hideUnseen}
                  onValueChange={(on) => {
                    setHideUnseen(on);
                    setMeta(HIDE_UNSEEN_KEY, on ? '1' : '0');
                  }}
                  trackColor={{ true: colors.green }}
                />
              }
            />
            <View style={{ alignItems: 'center', marginTop: 30, gap: 14 }}>
              <PillButton label={t('settings.account.logOut')} onPress={logOut} />
              <Text style={styles.note}>{t('settings.account.logOutNote')}</Text>
            </View>
          </>
        )}

        {tab === 'App' && (
          <>
            <SectionTitle title={t('settings.app.notificationsSection')} />
            <MenuRow
              title={t('settings.app.newEpisodeReminders')}
              sub={t('settings.app.newEpisodeRemindersSub')}
              right={<Switch value={reminders} onValueChange={toggleReminders} trackColor={{ true: colors.green }} />}
            />
            {reminders && (
              <>
                <MenuRow
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
                <MenuRow
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
                <MenuRow
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
                <MenuRow
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
                <MenuRow
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
            <SectionTitle title={t('settings.app.themeSection')} />
            <MenuRow title={t('language.title')} value={NAMES[currentLocale()]} onPress={() => router.push('/language')} />
            <MenuRow
              title={t('settings.app.startTab')}
              sub={t('settings.app.startTabSub')}
              value={t(`tabBar.${startTab as 'profile' | 'shows' | 'movies' | 'explore'}`)}
              onPress={() => setStartSheet(true)}
            />
            <MenuRow title={t('settings.app.darkMode')} sub={t('settings.app.darkModeSub')} />
            <SectionTitle title={t('settings.app.metadataSection')} />
            <MenuRow
              title={t('settings.app.tvdbKey')}
              sub={
                userTvdbKey()
                  ? t('settings.app.tvdbKeyOwnSub')
                  : tvdbKeyFailed()
                    ? t('settings.app.tvdbKeyFailedSub')
                    : t('settings.app.tvdbKeyDefaultSub')
              }
              value={tvdbKeyFailed() && !userTvdbKey() ? '!' : undefined}
              onPress={() => router.push('/tvdb-key')}
            />
            {!!snapAt && (
              <MenuRow
                title={t('settings.app.undoMigration')}
                sub={t('settings.app.undoMigrationSub', { date: new Date(snapAt).toLocaleDateString(currentLocale()) })}
                onPress={undoMigration}
              />
            )}
            {resumedSummary && (
              <MenuRow
                title={t('settings.app.resumedImportSummary')}
                sub={t('settings.app.resumedImportSummarySub')}
                onPress={() => router.push('/import?summary=1')}
              />
            )}
            {guessedMovies > 0 && (
              <MenuRow
                title={t('settings.app.reviewMatchedMovies')}
                sub={t('settings.app.reviewMatchedMoviesSub', { count: guessedMovies })}
                value={String(guessedMovies)}
                onPress={() => router.push('/review-movies')}
              />
            )}
            <MenuRow
              title={t('settings.app.refreshMetadata')}
              sub={
                refreshing
                  ? t('settings.app.refreshingProgress', { done: refreshDone, total: refreshTotal || '…' })
                  : t('settings.app.refreshMetadataSub')
              }
              onPress={() => void refreshAll()}
            />
            <SectionTitle title={t('settings.app.funSection')} />
            <MenuRow
              title={t('settings.app.popcornGame')}
              sub={t('settings.app.popcornGameSub', { score: bestPopcornScore() })}
              onPress={() => router.push('/popcorn' as never)}
            />
            <SectionTitle title={t('settings.app.aboutSection')} />
            <MenuRow title={t('settings.about.title')} sub={t('settings.about.sub')} onPress={() => router.push('/about')} />
          </>
        )}

        {tab === 'Data' && (
          <>
            {icloudSupported() && (
              <>
                <SectionTitle title={t('settings.data.icloudSection')} />
                <MenuRow
                  title={t('settings.data.icloudDrive')}
                  sub={t('settings.data.icloudDriveSub')}
                  value={icloudAvailable() ? t('common.on') : t('common.off')}
                />
                <MenuRow title={t('settings.data.lastBackedUp')} value={backedUpLabel} />
                <MenuRow
                  title={t('settings.data.backupNow')}
                  sub={t('settings.data.backupNowSub')}
                  onPress={() => void backUp()}
                />
              </>
            )}
            <SectionTitle title={t('settings.data.yourDataSection')} />
            <MenuRow title={t('settings.data.import')} sub={t('settings.data.importSub')} onPress={() => router.push('/import')} />
            <MenuRow title={t('settings.data.export')} sub={t('settings.data.exportSub')} onPress={() => void exportData()} />
            <MenuRow title={t('settings.data.backupJson')} sub={t('settings.data.backupJsonSub')} onPress={() => void exportJson()} />
            <SectionTitle title={t('settings.data.upcomingSection')} />
            <MenuRow
              title={t('settings.data.hideWatched')}
              right={<Switch value={hideWatched} onValueChange={setHideWatched} trackColor={{ true: colors.green }} />}
            />
            {/* DEVELOPMENT BUILDS ONLY. `__DEV__` is a constant the bundler
                folds away, so in a release build this branch is dead code and
                the generator module is dropped with it — there is no path to
                this row in a shipped app, and no string to translate.

                Deliberately untranslated for the same reason: it is a tool for
                whoever is building the app, not a feature. */}
            {__DEV__ && (
              <>
                {/* eslint-disable no-restricted-syntax -- the i18n rule is
                    right about user-facing strings and these are not: this
                    whole block is compiled out of a release build, so no user
                    ever sees them and a translator would be asked to translate
                    a debug tool. */}
                <SectionTitle title="Developer" />
                <MenuRow
                  title="Generate test data"
                  sub="Random ratings, feelings and favourites across 12 shows"
                  onPress={() => {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { generateTestData } = require('@/dev-seed') as typeof import('@/dev-seed');
                    const r = generateTestData();
                    Alert.alert(
                      'Test data added',
                      `${r.shows} shows · ${r.ratings} ratings · ${r.emotions} feelings · ${r.favourites} favourites`,
                    );
                  }}
                />
                {/* eslint-enable no-restricted-syntax */}
              </>
            )}
            <SectionTitle title={t('settings.data.dangerSection')} />
            <MenuRow
              title={t('settings.data.eraseAll')}
              sub={t('settings.data.eraseAllSub')}
              danger
              onPress={() =>
                Alert.alert(
                  t('settings.data.eraseAllConfirmTitle'),
                  icloudSupported()
                    ? t('settings.data.eraseAllConfirmBodyIcloud')
                    : t('settings.data.eraseAllConfirmBodyNoIcloud'),
                  [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                      text: t('settings.data.eraseAllConfirmAction'),
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
      </ScrollView>
      <ActionSheet
        visible={startSheet}
        title={t('settings.app.startTab')}
        onClose={() => setStartSheet(false)}
        actions={(
          [
            ['profile', 'person-outline'],
            ['shows', 'tv-outline'],
            ['movies', 'film-outline'],
            ['explore', 'search'],
          ] as const
        ).map(
          ([tab, icon]): SheetAction => ({
            text: t(`tabBar.${tab}`),
            icon,
            onPress: () => {
              setMeta('startTab', tab);
              setStartTab(tab);
              setStartSheet(false);
            },
          }),
        )}
      />
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
