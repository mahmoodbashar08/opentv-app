import { router, useFocusEffect } from 'expo-router';
import { useCallback, useReducer, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';

import { ApiError } from '@/api';
import { backupNow, icloudAvailable, icloudSupported, lastBackupAt } from '@/backup';
import {
  connectDrive,
  disconnectDrive,
  driveBackupNow,
  driveConnected,
  driveSupported,
  lastDriveBackupAt,
} from '@/gdrive-backup';
import { deleteCommunityAccount } from '@/community-account';
import { hasAnythingToSeed, seedingDone } from '@/community-seed';
import { getHandle, useHasPassword, useJoined } from '@/community-session';
import { communityErrorText } from '@/community-error-text';
import { fetchFollowRequests, fetchProfile, pushPrivate } from '@/community-profiles';
import { HIDE_UNSEEN_KEY, PRIVATE_PROFILE_KEY } from '@/pure';
import { shareLibraryExport } from '@/manual-backup';
import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { PeriodSheet } from '@/components/period-picker';
import { MenuRow, NavHeader, PillButton, Screen, TopTabs } from '@/components/ui';
import seed from '@/seed';
import { exportAll, getMeta, setMeta, wipeAllData } from '@/db';
import { currentLocale, t } from '@/i18n';
import { isSeedLibrary } from '@/library';
import { PLUS_AVAILABLE, usePlus, usePlusUi } from '@/plus';
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
  const plus = usePlus();
  const plusUi = usePlusUi();
  const hasPassword = useHasPassword();
  /**
   * PRIVATE, AND IT ACTUALLY IS NOW.
   *
   * This switch shipped as local `useState(false)` — it moved, it looked like a
   * setting, and it reached nothing: no meta write, no request. Every account
   * in the community was public and a user who had switched this on believed
   * otherwise, which is the worst possible failure for a control of this kind.
   *
   * Seeded from the local mirror so the first frame is right offline, then
   * corrected by the server's `is_private` when the profile lands.
   */
  const [priv, setPriv] = useState(() => getMeta(PRIVATE_PROFILE_KEY) === '1');
  const [privBusy, setPrivBusy] = useState(false);
  const [requests, setRequests] = useState(0);
  const [pickingWrapped, setPickingWrapped] = useState(false);
  const [requestsMore, setRequestsMore] = useState(false);
  /**
   * The two things only the server knows: whether this account is actually
   * private, and who is waiting. Read on focus and put in state — a render-time
   * read of either would be memoised by the Compiler and never move again.
   *
   * Silent on failure. A settings screen that cannot reach the network still
   * has to draw every other row it has.
   */
  useFocusEffect(
    useCallback(() => {
      if (!joined) {
        setRequests(0);
        return;
      }
      let cancelled = false;
      const handle = getHandle();
      if (handle != null) {
        void fetchProfile(handle)
          .then((p) => {
            if (cancelled) return;
            setPriv(p.is_private);
            setMeta(PRIVATE_PROFILE_KEY, p.is_private ? '1' : '');
          })
          .catch(() => {});
      }
      void fetchFollowRequests().then((page) => {
        if (cancelled) return;
        // The FIRST PAGE, and the `+` says so. A true total would be another
        // route for a number whose only job is to say "there is something here".
        setRequests(page.items.length);
        setRequestsMore(page.next_cursor != null);
      });
      return () => {
        cancelled = true;
      };
    }, [joined]),
  );
  const togglePrivate = (on: boolean) => {
    if (privBusy) return;
    setPriv(on);
    setPrivBusy(true);
    void pushPrivate(on)
      .then(() => setMeta(PRIVATE_PROFILE_KEY, on ? '1' : ''))
      .catch((e: unknown) => {
        // Back where it was. A curtain that failed to close must not be drawn
        // as closed — see `pushPrivate`.
        setPriv(!on);
        Alert.alert(t('settings.account.privateFailedTitle'), communityErrorText(e));
      })
      .finally(() => setPrivBusy(false));
  };
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
        `${communityErrorText(err)}\n\n${t('community.settings.deleteFailedStillSignedIn')}`,
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

  /**
   * ANDROID'S BACKUP, mirroring the iCloud rows above it.
   *
   * Connecting is its own tap and its own permission: signing in here does NOT
   * join the community, and a person who never wants a profile can still have
   * their library backed up. See the note at the top of `gdrive-backup.ts`.
   */
  const [driveOn, setDriveOn] = useState(() => driveConnected());
  const [driveAt, setDriveAt] = useState<number | null>(() => lastDriveBackupAt());
  const [driveBusy, setDriveBusy] = useState(false);

  const driveLabel = driveAt
    ? new Date(driveAt).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' })
    : t('settings.data.never');

  const toggleDrive = async (on: boolean) => {
    if (driveBusy) return;
    if (!on) {
      disconnectDrive();
      setDriveOn(false);
      return;
    }
    setDriveBusy(true);
    try {
      const ok = await connectDrive();
      setDriveOn(ok);
      if (!ok) Alert.alert(t('settings.data.driveFailedTitle'), t('settings.data.driveFailedBody'));
      else void driveBackUp();
    } finally {
      setDriveBusy(false);
    }
  };

  const driveBackUp = async () => {
    try {
      const r = await driveBackupNow(true);
      if (r === 'unavailable') {
        Alert.alert(t('settings.data.driveFailedTitle'), t('settings.data.driveFailedBody'));
        return;
      }
      setDriveAt(lastDriveBackupAt());
      Alert.alert(t('settings.data.backedUpTitle'), t('settings.data.driveBackedUpBody'));
    } catch (err) {
      Alert.alert(t('settings.data.backupFailedTitle'), err instanceof Error ? err.message : String(err));
    }
  };

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
            {/* OpenTV Plus, at the top and in both states, with no heading of
                its own: it is the one row that is about the app rather than a
                setting of it, and a section title above a single row is a
                label pretending to be an organiser.

                A supporter needs a way back to the sheet that says what they
                are paying for (and holds Restore); everyone else needs one
                door to the offer that is not a feature they happened to tap.
                `usePlus()` rather than `isPlus()` — see plus.ts. */}
            {PLUS_AVAILABLE && (
            <MenuRow
              trackId="plus.settingsRow"
              title={t('plus.settingsRow')}
              sub={plus ? undefined : t('plus.settingsPitch')}
              value={plus ? t('plus.settingsSupporter') : undefined}
              onPress={() => router.push('/paywall?from=settings')}
            />
            )}
            {/* The door to Appearance. The screen shipped without one — built
                behind requirePlus but reachable from nowhere, which read as
                "the feature is not in my phone". Free users may open it: the
                default look is always selectable, and the locked swatches are
                the paywall's best advert. */}
            <SectionTitle title={t('settings.account.personalSection')} />
            {/* Appearance is entirely paid — accents, OLED, icons, the profile
                theme and its layouts — so the whole door waits with them. */}
            {plusUi && (
              <MenuRow
                trackId="plus.appearanceRow"
                title={t('plus.appearance.title')}
                onPress={() => router.push('/appearance')}
              />
            )}
            {/* MAKING IT YOURS: the look of the app, and the recap of your
                own watching. Both are "about you" rather than "about how the
                app behaves", which is what the App tab holds.

                Wrapped is free, and lives here rather than on the profile
                because the profile offers it once a month on its own — this is
                the door for the other twenty-nine days. */}
            <MenuRow
              trackId="plus.wrapped.entry"
              title={t('plus.wrapped.entry')}
              sub={t('plus.wrapped.entrySub')}
              onPress={() => setPickingWrapped(true)}
            />
            <SectionTitle title={t('settings.account.identificationSection')} />
            <MenuRow trackId="settings.account.username" title={t('settings.account.username')} value={getMeta('username') ?? seed.profile.username} />
            <MenuRow trackId="settings.account.memberSince"
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
                <MenuRow trackId="community.settings.handleRow" title={t('community.settings.handleRow')} value={`@${getHandle() ?? ''}`} />
                {/* ONLY WHERE THERE IS NO PASSWORD YET. An account that joined
                    with Apple or Google can add one and afterwards use either
                    door — which matters on a device where the provider sign-in
                    fails, or if they stop using that Google account. Once set,
                    the row goes: changing a password is the reset flow, which
                    proves possession of the inbox first. */}
                {!hasPassword && (
                  <MenuRow
                    trackId="community.settings.setPasswordRow"
                    title={t('community.settings.setPasswordRow')}
                    sub={t('community.settings.setPasswordRowSub')}
                    onPress={() => router.push('/set-password')}
                  />
                )}
                {/* The archive, on a second thought. Someone who tapped "Not
                    now" the day they joined must be able to change their mind
                    without reinstalling anything — and someone who already
                    brought them can run it again harmlessly, because the
                    server dedupes by content. */}
                {hasAnythingToSeed() && (
                  <MenuRow trackId="community.settings.seedRow"
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
                {/* LEAVE IS GONE, deliberately. Signing out and back in was
                    the one way to end up on a second account: the library is
                    unchanged, so it republishes onto whoever signs in next, and
                    the person's comments and followers stay behind on a profile
                    they can no longer reach. One device, one account.
                    Deleting remains — it is the honest way off, it clears the
                    remembered address, and Apple 5.1.1(v) requires it. */}
                {/* WHO CAN SEE YOU — a community setting, so it sits with the
                    rest of them rather than in a section of its own below the
                    delete button, which is where it was. */}
                <MenuRow trackId="settings.account.privateProfile"
                  title={t('settings.account.privateProfile')}
                  sub={t('settings.account.privateProfileSub')}
                  right={
                    <Switch
                      value={priv}
                      onValueChange={togglePrivate}
                      disabled={privBusy}
                      trackColor={{ true: colors.green }}
                    />
                  }
                />
                {/* ONLY WHEN SOMEBODY IS WAITING. A row reading "0" is a
                    permanent reminder of an empty room; the count IS the reason
                    to show it, so no count means no row. Reachable from the
                    bell as well — see `notifications.tsx`. */}
                {requests > 0 && (
                  <MenuRow trackId="community.followRequests.row"
                    title={t('community.followRequests.title')}
                    sub={t('community.followRequests.rowSub')}
                    value={`${formatCount(requests, currentLocale())}${requestsMore ? '+' : ''}`}
                    onPress={() => router.push('/follow-requests')}
                  />
                )}

                {/* LAST IN THE SECTION, because it ends the account. It sat in
                    the middle with two switches under it, so the most
                    destructive row on the screen had settings after it — the
                    one place a reader is most likely to tap by momentum.

                    Apple 5.1.1(v): an account made in the app must be
                    deletable from the app. Styled destructive, two-step, and
                    honest about the one thing it does NOT delete. */}
                <MenuRow trackId="community.settings.deleteRow"
                  title={t('community.settings.deleteRow')}
                  sub={deletingAccount ? t('community.settings.deleting') : t('community.settings.deleteRowSub')}
                  danger
                  onPress={() => confirmDeleteCommunityAccount(() => void runDeleteAccount())}
                />
              </>
            ) : (
              <MenuRow trackId="community.settings.joinRow"
                title={t('community.settings.joinRow')}
                sub={t('community.settings.joinRowSub')}
                onPress={() => router.push('/join')}
              />
            )}
            {/* Spoilers, not privacy: this is about what YOU are shown, not
                about who sees you. It was filed under a heading that made a
                reading preference look like a visibility control. */}
            <SectionTitle title={t('settings.account.spoilersSection')} />
            {/* ON BY DEFAULT. The cost of the two mistakes is not symmetrical:
                a needless curtain is one tap, and a missing one is the ending
                of something you were part-way through. */}
            <MenuRow trackId="settings.account.hideUnseenSpoilers"
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
            <MenuRow trackId="settings.app.newEpisodeReminders"
              title={t('settings.app.newEpisodeReminders')}
              sub={t('settings.app.newEpisodeRemindersSub')}
              right={<Switch value={reminders} onValueChange={toggleReminders} trackColor={{ true: colors.green }} />}
            />
            {reminders && (
              <>
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
            {/* NOT "Theme": this section held the language picker and the
                start tab, neither of which is one. It is how the app behaves,
                and the look of it now lives in Appearance under Account. */}
            <SectionTitle title={t('settings.app.generalSection')} />
            <MenuRow trackId="language.title" title={t('language.title')} value={NAMES[currentLocale()]} onPress={() => router.push('/language')} />
            <MenuRow trackId="settings.app.startTab"
              title={t('settings.app.startTab')}
              sub={t('settings.app.startTabSub')}
              value={t(`tabBar.${startTab as 'profile' | 'shows' | 'movies' | 'explore'}`)}
              onPress={() => setStartSheet(true)}
            />
            <MenuRow trackId="settings.app.darkMode" title={t('settings.app.darkMode')} sub={t('settings.app.darkModeSub')} />
            <SectionTitle title={t('settings.app.metadataSection')} />
            <MenuRow trackId="settings.app.tvdbKey"
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
              <MenuRow trackId="settings.app.undoMigration"
                title={t('settings.app.undoMigration')}
                sub={t('settings.app.undoMigrationSub', { date: new Date(snapAt).toLocaleDateString(currentLocale()) })}
                onPress={undoMigration}
              />
            )}
            {resumedSummary && (
              <MenuRow trackId="settings.app.resumedImportSummary"
                title={t('settings.app.resumedImportSummary')}
                sub={t('settings.app.resumedImportSummarySub')}
                onPress={() => router.push('/import?summary=1')}
              />
            )}
            {guessedMovies > 0 && (
              <MenuRow trackId="settings.app.reviewMatchedMovies"
                title={t('settings.app.reviewMatchedMovies')}
                sub={t('settings.app.reviewMatchedMoviesSub', { count: guessedMovies })}
                value={String(guessedMovies)}
                onPress={() => router.push('/review-movies')}
              />
            )}
            <MenuRow trackId="settings.app.refreshMetadata"
              title={t('settings.app.refreshMetadata')}
              sub={
                refreshing
                  ? t('settings.app.refreshingProgress', { done: refreshDone, total: refreshTotal || '…' })
                  : t('settings.app.refreshMetadataSub')
              }
              onPress={() => void refreshAll()}
            />
            <SectionTitle title={t('settings.app.funSection')} />
            <MenuRow trackId="settings.app.popcornGame"
              title={t('settings.app.popcornGame')}
              sub={t('settings.app.popcornGameSub', { score: bestPopcornScore() })}
              onPress={() => router.push('/popcorn' as never)}
            />
            <SectionTitle title={t('settings.app.aboutSection')} />
            <MenuRow trackId="settings.about.title" title={t('settings.about.title')} sub={t('settings.about.sub')} onPress={() => router.push('/about')} />
          </>
        )}

        {tab === 'Data' && (
          <>
            {driveSupported() && (
              <>
                <SectionTitle title={t('settings.data.driveSection')} />
                <MenuRow trackId="settings.data.driveBackup"
                  title={t('settings.data.driveBackup')}
                  sub={t('settings.data.driveBackupSub')}
                  right={
                    <Switch
                      value={driveOn}
                      disabled={driveBusy}
                      onValueChange={(v) => void toggleDrive(v)}
                      trackColor={{ true: colors.green }}
                    />
                  }
                />
                {driveOn && (
                  <>
                    <MenuRow trackId="settings.data.driveLastBackedUp"
                      title={t('settings.data.lastBackedUp')}
                      value={driveLabel}
                    />
                    <MenuRow trackId="settings.data.driveBackupNow"
                      title={t('settings.data.backupNow')}
                      sub={t('settings.data.driveBackupNowSub')}
                      onPress={() => void driveBackUp()}
                    />
                  </>
                )}
              </>
            )}
            {icloudSupported() && (
              <>
                <SectionTitle title={t('settings.data.icloudSection')} />
                <MenuRow trackId="settings.data.icloudDrive"
                  title={t('settings.data.icloudDrive')}
                  sub={t('settings.data.icloudDriveSub')}
                  value={icloudAvailable() ? t('common.on') : t('common.off')}
                />
                <MenuRow trackId="settings.data.lastBackedUp" title={t('settings.data.lastBackedUp')} value={backedUpLabel} />
                <MenuRow trackId="settings.data.backupNow"
                  title={t('settings.data.backupNow')}
                  sub={t('settings.data.backupNowSub')}
                  onPress={() => void backUp()}
                />
              </>
            )}
            <SectionTitle title={t('settings.data.yourDataSection')} />
            <MenuRow trackId="settings.data.import" title={t('settings.data.import')} sub={t('settings.data.importSub')} onPress={() => router.push('/import')} />
            <MenuRow trackId="settings.data.export" title={t('settings.data.export')} sub={t('settings.data.exportSub')} onPress={() => void exportData()} />
            <MenuRow trackId="settings.data.backupJson" title={t('settings.data.backupJson')} sub={t('settings.data.backupJsonSub')} onPress={() => void exportJson()} />
            <SectionTitle title={t('settings.data.upcomingSection')} />
            <MenuRow trackId="settings.data.hideWatched"
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
                {/* THE ENTITLEMENT, BY HAND. Plus is granted by RevenueCat and
                    nowhere else, which is correct and makes every paid feature
                    untestable until purchases exist -- `requirePlus` simply
                    returns false and the tap does nothing, which is
                    indistinguishable from a broken control.

                    So: a switch that calls the same `setPlusEntitled` the
                    purchases module calls. It writes the same meta row and
                    notifies the same subscribers, so what you are testing is
                    the real path and not a second one built for testing.

                    Compiled out of release builds with the rest of this block,
                    so it cannot become a free tier by accident. */}
                <MenuRow
                  title="OpenTV Plus"
                  sub={plus ? 'On — every paid feature is unlocked' : 'Off — paid features refuse'}
                  right={
                    <Switch
                      value={plus}
                      onValueChange={(on) => {
                        const { setPlusEntitled } =
                          // eslint-disable-next-line @typescript-eslint/no-require-imports
                          require('@/plus') as typeof import('@/plus');
                        setPlusEntitled(on);
                      }}
                      trackColor={{ true: colors.yellow }}
                    />
                  }
                />
                {/* eslint-enable no-restricted-syntax */}
              </>
            )}
            <SectionTitle title={t('settings.data.dangerSection')} />
            <MenuRow trackId="settings.data.eraseAll"
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
      <PeriodSheet
        visible={pickingWrapped}
        onClose={() => setPickingWrapped(false)}
        onPick={(key) => {
          setPickingWrapped(false);
          router.push(key.length === 4 ? `/wrapped?year=${key}` : `/wrapped?month=${key}`);
        }}
      />
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
