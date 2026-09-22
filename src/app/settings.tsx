import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { ApiError } from '@/api';
import { deleteCommunityAccount } from '@/community-account';
import { hasAnythingToSeed, seedingDone } from '@/community-seed';
import { getHandle, hasAccount, lastAccount, useHasPassword, useJoined } from '@/community-session';
import { communityErrorText } from '@/community-error-text';
import { fetchFollowRequests, fetchProfile, pushPrivate } from '@/community-profiles';
import { pushDevPlus } from '@/community-plus-dev';
import { appLinks } from '@/links';
import { HIDE_UNSEEN_KEY, isSafeLinkUrl, PRIVATE_PROFILE_KEY } from '@/pure';
import { backupNow, icloudSupported } from '@/backup';
import { crashReportsOn, setCrashReports } from '@/crash';
import {
  calendarSupported,
  calendarSyncOn,
  disableCalendarSync,
  enableCalendarSync,
  lastCalendarCounts,
  lastCalendarError,
  lastCalendarSyncAt,
  syncCalendar,
} from '@/calendar-sync';
import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { isCustomServer } from '@/server-url';
import { hapticsOn, setHapticsOn, tapLight } from '@/haptics';
import { MenuRow, NavHeader, PillButton, Screen, TopTabs } from '@/components/ui';
import seed from '@/seed';
import { getMeta, setMeta, wipeAllData } from '@/db';
import { currentLocale, t } from '@/i18n';
import { isSeedLibrary } from '@/library';
import { usePlus, usePlusUi } from '@/plus';
import { manageSubscriptionUrl, plusStatus } from '@/purchases';
import { formatCount } from '@/locale-resolve';
import { NAMES } from '@/app/language';
import { setOnboarded } from '@/session-store';
import { getGuessedMovies } from '@/db';
import { tvdbKeyFailed, userTvdbKey } from '@/tvdb';
import { chosenScheme, colors, setThemeScheme, space, type SchemeChoice } from '@/theme';

/** Export as a TV Time-format ZIP (images bundled) — our importer reads it
 * back losslessly. Shares via the Android-safe helper. */

/** Full raw backup as JSON — belt and braces alongside the ZIP. */

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
  /** `?tab=Data` opens straight onto a tab. The backup nudge sends people here
   *  to turn Drive on, and landing on Account with nothing highlighted makes
   *  them hunt for the thing they just asked for. */
  const { tab: wanted } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<(typeof TABS)[number]>(
    () => TABS.find((x) => x.toLowerCase() === String(wanted ?? '').toLowerCase()) ?? 'Account',
  );
  // Reactive: signing in on /join must flip this row without a manual refresh.
  const joined = useJoined();
  /* An account exists — what backup and sync need, and what joining no
     longer implies. Separate from `joined` on purpose. */
  const account = hasAccount();
  const plus = usePlus();
  const plusUi = usePlusUi();
  /**
   * RevenueCat's deep link to THIS subscription, when it answers. It is the
   * better destination than the store's list — but it is null whenever the
   * SDK is unconfigured, the call fails, or there is no entitlement, so the
   * row below never depends on it arriving: `manageSubscriptionUrl` has a
   * floor.
   */
  const [plusMgmtUrl, setPlusMgmtUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!plus) return;
    let cancelled = false;
    void plusStatus()
      .then((st) => {
        if (!cancelled) setPlusMgmtUrl(st?.managementUrl ?? null);
      })
      .catch(() => {
        // The fallback covers it; a failed lookup must not hide the row.
      });
    return () => {
      cancelled = true;
    };
  }, [plus]);
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
  const [scheme, setScheme] = useState<SchemeChoice>(chosenScheme);
  const [themeSheet, setThemeSheet] = useState(false);
  const [priv, setPriv] = useState(() => getMeta(PRIVATE_PROFILE_KEY) === '1');
  const [privBusy, setPrivBusy] = useState(false);
  const [requests, setRequests] = useState(0);
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
  // Lazy initial read, like every other switch here: the React Compiler
  // memoises a render-time store read and would freeze this at first paint.
  const [haptics, setHaptics] = useState(() => hapticsOn());
  const [hideWatched, setHideWatched] = useState(false);
  const [startTab, setStartTab] = useState(() => getMeta('startTab') ?? 'profile');
  const [startSheet, setStartSheet] = useState(false);
  const [crashOn, setCrashOn] = useState(() => crashReportsOn());
  /* `guessedMovies` stays HERE and nowhere else: the Advanced row wears the
     count as a badge, so settings has to know it even though the rows that act
     on it have moved. The rest of that block went with them. */
  const [guessedMovies] = useState(() => getGuessedMovies().length);


  /**
   * ANDROID'S BACKUP, mirroring the iCloud rows above it.
   *
   * Connecting is its own tap and its own permission: signing in here does NOT
   * join the community, and a person who never wants a profile can still have
   * their library backed up. See the note at the top of `gdrive-backup.ts`.
   */
  /*
   * THE CALENDAR SWITCH. Turning it ON is the one call that may show a system
   * prompt, so it only ever happens on a deliberate tap; turning it OFF deletes
   * the calendar rather than leaving sixty entries in somebody's diary that
   * nothing maintains any more.
   */
  const [calOn, setCalOn] = useState(() => calendarSyncOn());
  const [calAt, setCalAt] = useState<number | null>(() => lastCalendarSyncAt());
  const [calBusy, setCalBusy] = useState(false);

  const calLabel = calAt
    ? new Date(calAt).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' })
    : t('calendarSync.never');

  const toggleCalendar = async (on: boolean) => {
    if (calBusy) return;
    setCalBusy(true);
    try {
      if (!on) {
        await disableCalendarSync();
        setCalOn(false);
        setCalAt(null);
        return;
      }
      const r = await enableCalendarSync();
      setCalOn(r === 'done');
      setCalAt(lastCalendarSyncAt());
      if (r === 'plus-required')
        // Its own sentence. "Could not set that up" for an expired card sends
        // somebody to check their calendar permissions for an hour.
        Alert.alert(t('calendarSync.plusTitle'), t('calendarSync.plusBody'));
      else if (r === 'denied')
        Alert.alert(
          t('calendarSync.deniedTitle'),
          `${t('calendarSync.deniedBody')}${lastCalendarError() ? `\n\n${lastCalendarError()}` : ''}`,
        );
      // The system's own words when there are any: "could not set that up" is
      // the same sentence for a refused permission and a calendar iOS declined
      // to create, and only one of those the reader can do anything about.
      else if (r !== 'done')
        Alert.alert(
          t('calendarSync.failedTitle'),
          `${t('calendarSync.failedBody')}${lastCalendarError() ? `\n\n${lastCalendarError()}` : ''}`,
        );
    } catch (err) {
      // A LAST RESORT THAT MUST EXIST. `void toggleCalendar(v)` throws away a
      // rejection, so anything that escapes the module leaves a switch that
      // moved, failed and said nothing at all.
      Alert.alert(
        t('calendarSync.failedTitle'),
        `${t('calendarSync.failedBody')}\n\n${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setCalBusy(false);
    }
  };

  const refreshCalendar = async () => {
    if (calBusy) return;
    setCalBusy(true);
    try {
      const r = await syncCalendar(true);
      setCalAt(lastCalendarSyncAt());
      if (r === 'plus-required') Alert.alert(t('calendarSync.plusTitle'), t('calendarSync.plusBody'));
      else if (r === 'denied') Alert.alert(t('calendarSync.deniedTitle'), t('calendarSync.deniedBody'));
      else if (r !== 'done') Alert.alert(t('calendarSync.failedTitle'), t('calendarSync.failedBody'));
      else {
        // SAYS WHAT IT WROTE. A calendar looks identical whether the air times
        // arrived or not, which is what made the last four rounds of this
        // guesswork; the split answers it at a glance.
        const c = lastCalendarCounts();
        Alert.alert(t('calendarSync.title'), t('calendarSync.wrote', { total: c.total, timed: c.timed, allDay: c.allDay }));
      }
    } finally {
      setCalBusy(false);
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
            {/* `plusUi`, not `PLUS_AVAILABLE`: an entitled device must reach
                this row even in a build where the tier cannot be bought — that
                is a supporter's only route to Restore, and it is how the screen
                gets looked at before release. Same rule as every other Plus
                entry point; this one was the exception and so it appeared to be
                missing entirely. */}
            {plusUi && (
            <MenuRow
              trackId="plus.settingsRow"
              title={t('plus.settingsRow')}
              sub={plus ? undefined : t('plus.settingsPitch')}
              value={plus ? t('plus.settingsSupporter') : undefined}
              onPress={() => router.push('/paywall?from=settings')}
            />
            )}
            {/* WHERE TO CANCEL, IN SETTINGS, where a person looks for it.
                The route existed — inside the paywall, three taps down, under
                a row whose value reads "Supporter" and says nothing about
                managing anything. So the one screen a subscriber opens to stop
                paying was the screen built to sell them the thing. And it
                rendered nothing at all whenever RevenueCat had not answered,
                which is a bad connection away for anybody.

                `manageSubscriptionUrl` falls back to the store's own
                subscription page, so this row can never be the thing that is
                missing. */}
            {plus && (
              <MenuRow
                trackId="plus.manageRow"
                title={t('plus.manage')}
                onPress={() => {
                  void Linking.openURL(manageSubscriptionUrl(plusMgmtUrl)).catch(() => {});
                }}
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
            {/* WRAPPED IS NOT A PREFERENCE, so it is not here any more.
                It used to sit in this tab as "the door for the other
                twenty-nine days", the profile offering it only once a month —
                but Stats already carries the identical row, permanently, and a
                recap of your watching belongs next to the rest of your
                watching rather than under a gear icon. */}
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
            {/* TWO ROWS THAT CANNOT BE CONFUSED FOR EACH OTHER.
                An account and a community membership are different things, and
                the only way somebody can answer "have I published anything?"
                is to be able to see both states at once, at rest, rather than
                only at the moment of deciding. The account row is what backup
                and sync use; the community row above is what strangers see. */}
            <MenuRow
              trackId="settings.account.accountRow"
              title={t('settings.account.accountRow')}
              sub={account ? undefined : t('settings.account.accountRowSub')}
              value={account ? (lastAccount().email ?? t('common.on')) : t('common.off')}
              onPress={account ? undefined : () => router.push('/sign-in')}
            />
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
            {/* ONE ROW, NOT EIGHT. Seven switches and a time sat here under
                a heading that made them look like equal preferences. They are
                not: `newEpisodeReminders` is the master and the rest refine
                it, which a flat list could not say. "On this day" moved in
                with them — it is `notifyKind('memory')` and sat under General
                only because that is where there was room. */}
            <MenuRow
              trackId="settings.app.notificationsRow"
              title={t('settings.app.notificationsSection')}
              sub={t('settings.app.notificationsRowSub')}
              onPress={() => router.push('/notifications')}
            />
            {/* NOT "Theme": this section held the language picker and the
                start tab, neither of which is one. It is how the app behaves,
                and the look of it now lives in Appearance under Account. */}
            <SectionTitle title={t('settings.app.generalSection')} />
            {/*
              * ASKED FOR ON DAY ONE OF BEING PUBLIC, by somebody who could not
              * turn the buzzing off. Every tap in the app routes through two
              * functions in `@/haptics`, so the switch gates all of them at
              * once rather than 59 call sites each remembering to ask.
              */}
            <MenuRow trackId="settings.app.haptics"
              title={t('settings.app.haptics')}
              sub={t('settings.app.hapticsSub')}
              right={
                <Switch
                  value={haptics}
                  onValueChange={(on) => {
                    setHaptics(on);
                    setHapticsOn(on);
                    // Buzz on the way ON, never on the way off: the feedback
                    // for "you have switched this off" is silence.
                    if (on) tapLight();
                  }}
                  trackColor={{ true: colors.green }}
                />
              }
            />
            <MenuRow trackId="language.title" title={t('language.title')} value={NAMES[currentLocale()]} onPress={() => router.push('/language')} />
            <MenuRow trackId="settings.app.startTab"
              title={t('settings.app.startTab')}
              sub={t('settings.app.startTabSub')}
              value={t(`tabBar.${startTab as 'profile' | 'shows' | 'movies' | 'explore'}`)}
              onPress={() => setStartSheet(true)}
            />
            {/*
              * ONE CONTROL, THREE ANSWERS. This row said "Dark mode / Light
              * theme arrives later" and did nothing when tapped; the light
              * theme briefly shipped as a SECOND switch further up, which is
              * two controls for one setting — the state they can disagree in is
              * the bug.
              *
              * Free, and deliberately outside the Plus screen where the accent
              * and OLED live: those are decoration, this is legibility. It was
              * asked for by somebody who could not comfortably read black.
              */}
            <MenuRow
              trackId="settings.app.theme"
              title={t('settings.app.theme')}
              sub={t('settings.app.themeSub')}
              value={t(`settings.app.theme_${scheme}` as 'settings.app.theme_dark')}
              onPress={() => setThemeSheet(true)}
            />
            {scheme !== chosenScheme() && <Text style={styles.note}>{t('plus.appearance.restart')}</Text>}
            {/* BOTH OF THESE WERE FILED UNDER "UPCOMING", a section about
                the episode list, in the tab about your library.

                Hiding watched episodes is a list preference, which is this
                tab. Crash reports are telemetry and were there for the reason
                the audit gives: they needed a home and that was the nearest
                one. Neither has anything to do with the other; what they had
                in common was a heading. */}
            <MenuRow trackId="settings.data.hideWatched"
              title={t('settings.data.hideWatched')}
              right={<Switch value={hideWatched} onValueChange={setHideWatched} trackColor={{ true: colors.green }} />}
            />
            {/* ON BY DEFAULT, UNLIKE ANALYTICS, and the row says what it sends
                so that default is disclosed where it can be changed rather than
                only in a policy page. See the header of `src/crash.ts`. */}
            <MenuRow trackId="settings.data.crashReports"
              title={t('settings.data.crashReports')}
              sub={t('settings.data.crashReportsSub')}
              right={
                <Switch
                  value={crashOn}
                  onValueChange={(v) => {
                    setCrashOn(v);
                    setCrashReports(v);
                  }}
                  trackColor={{ true: colors.green }}
                />
              }
            />
            {/*
              WHERE TO FIND US -- in Settings, and deliberately nowhere else.
              Not onboarding: somebody who has just installed a private,
              no-account tracker is not looking for a chat server, and asking
              immediately contradicts the thing the app has just promised. And
              never a notification, which would make every other notification
              read as marketing.

              The list comes from `appLinks()`: the bundled defaults, or the
              server's override for a phone that was already talking to it. A
              link compiled into a release cannot be fixed, and a Discord
              invite expires after seven days by default.
            */}
            <SectionTitle title={t('settings.app.linksSection')} />
            {appLinks().map((l) => (
              <MenuRow
                key={l.key}
                trackId={`settings.app.link.${l.key}`}
                title={l.label}
                onPress={() => {
                  // Checked again here even though the server filtered it: this
                  // is the one value in the app that arrives from a server and
                  // is handed to the operating system.
                  if (isSafeLinkUrl(l.url)) void Linking.openURL(l.url).catch(() => {});
                }}
              />
            ))}
            {/* ONE ROW, not a section called "Metadata".
                Five rows that a reader either already knows they want or will
                never want at all -- and a heading in the middle of the tab
                somebody opened to change the theme does not tell the second
                group to move along. Most of them are conditional anyway, so on
                a healthy install this was a heading over two rows all year. */}
            <MenuRow
              trackId="settings.app.advanced"
              title={t('settings.app.advanced')}
              sub={t('settings.app.advancedSub')}
              value={tvdbKeyFailed() && !userTvdbKey() ? '!' : guessedMovies > 0 ? String(guessedMovies) : undefined}
              onPress={() => router.push('/advanced')}
            />
            <SectionTitle title={t('settings.app.aboutSection')} />
            <MenuRow trackId="settings.about.title" title={t('settings.about.title')} sub={t('settings.about.sub')} onPress={() => router.push('/about')} />
          </>
        )}

        {tab === 'Data' && (
          <>
            <SectionTitle title={t('settings.data.yourDataSection')} />
            {/* ONE ROW WHERE TEN USED TO BE. iCloud, Google Drive, the cloud
                backup, the ZIP and the JSON were three sections and ten rows
                across this tab, and a person whose whole question is "what
                happens if I lose my phone" had to tell five features apart
                before they could answer it. They are one question with three
                answers, and `/backup` is where the three live now. */}
            <MenuRow
              trackId="settings.data.backupRow"
              title={t('settings.backup.title')}
              sub={t('settings.backup.intro')}
              onPress={() => router.push('/backup')}
            />
            <MenuRow trackId="settings.data.import" title={t('settings.data.import')} sub={t('settings.data.importSub')} onPress={() => router.push('/import')} />
            {/* NEXT TO IMPORT, because it is the same idea. The GDPR ZIP is
                history from a service that died; this is history from a player
                this app cannot see. Both end in the same table, and neither
                sends anything anywhere. */}
            <MenuRow trackId="plex.title" title={t('plex.title')} sub={t('plex.entrySub')} onPress={() => router.push('/plex')} />
            <MenuRow trackId="jellyfin.title" title={t('jellyfin.title')} sub={t('jellyfin.entrySub')} onPress={() => router.push('/jellyfin')} />
            {/* NEXT TO THE OTHER SERVERS, not up with iCloud and Drive: those
                two are a switch, this one is a destination you choose and, for
                WebDAV, a server you connect to — the same shape as Plex and
                Jellyfin above. */}
            {/*
              * THE CALENDAR, BESIDE THE OTHER THINGS THAT LEAVE THE PHONE, and
              * Plus like they are. It is the clearest Plus feature this app has:
              * it needs no community, no profile and nobody else — the one
              * shape of value that the four in five who never join can use. See
              * the note at the top of `calendar-sync.ts`.
              */}
            {calendarSupported() && plusUi && (
              <MenuRow
                trackId="calendarSync.title"
                title={t('calendarSync.title')}
                sub={t('calendarSync.sub')}
                right={
                  <Switch
                    value={calOn}
                    disabled={calBusy}
                    onValueChange={(v) => void toggleCalendar(v)}
                    trackColor={{ true: colors.green }}
                  />
                }
              />
            )}
            {/*
              * SAID WITHOUT BEING ASKED. The complaint was a switch that is on,
              * a calendar that stopped filling, and nothing anywhere admitting
              * why — the failure only appeared if you happened to press
              * Refresh. A lapsed subscription has to be legible standing still.
              */}
            {calendarSupported() && calOn && !plus && (
              <MenuRow
                trackId="calendarSync.lapsed"
                title={t('calendarSync.plusTitle')}
                sub={t('calendarSync.plusBody')}
                onPress={() => router.push('/paywall')}
              />
            )}
            {calendarSupported() && plusUi && calOn && (
              <>
                <MenuRow
                  trackId="calendarSync.lastSynced"
                  title={t('calendarSync.lastSynced')}
                  value={calLabel}
                />
                <MenuRow
                  trackId="calendarSync.syncNow"
                  title={t('calendarSync.syncNow')}
                  sub={t('calendarSync.note')}
                  onPress={() => void refreshCalendar()}
                />
              </>
            )}
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
                        // AND THE SERVER, or the two disagree and every paid
                        // feature that writes something a visitor sees refuses
                        // on a phone showing the whole tier.
                        void pushDevPlus(on);
                      }}
                      trackColor={{ true: colors.yellow }}
                    />
                  }
                />
                {/* eslint-enable no-restricted-syntax */}
              </>
            )}
            {/*
              * YOUR OWN SERVER. `backend/SELF-HOSTING.md` is one container and
              * a directory; this row is the half that lives on the phone, and
              * without it that document describes a server nobody can reach.
              *
              * Under Your data rather than in the community section, because
              * it is not a community feature — it is where your community data
              * goes, which is the same question as where your backups go.
              *
              * Changing it SIGNS THE DEVICE OUT (`switchServer`): a token, a
              * profile id and every cached aggregate belong to the server that
              * issued them. The local library is untouched.
              */}
            <SectionTitle title={t('settings.data.serverSection')} />
            {/* ONE ROW, ONE SCREEN, THREE FIELDS. The server and the two
                metadata keys are required together — see `self-host.tsx` —
                so offering them as three separate rows would invite exactly
                the half-move the requirement exists to prevent. */}
            <MenuRow
              trackId="settings.data.server"
              title={t('settings.data.server')}
              sub={t('settings.data.serverSub')}
              value={isCustomServer() ? t('settings.data.serverCustom') : t('settings.data.serverOfficial')}
              onPress={() => router.push('/self-host')}
            />

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
      <ActionSheet
        visible={themeSheet}
        title={t('settings.app.theme')}
        onClose={() => setThemeSheet(false)}
        actions={(
          [
            ['light', 'sunny-outline'],
            ['dark', 'moon-outline'],
            ['system', 'phone-portrait-outline'],
          ] as const
        ).map(
          ([value, icon]): SheetAction => ({
            text: t(`settings.app.theme_${value}` as 'settings.app.theme_dark'),
            icon,
            onPress: () => {
              setScheme(value);
              setThemeScheme(value);
              setThemeSheet(false);
            },
          }),
        )}
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
  /* The one paragraph on this screen, because the three rows under it only
     make sense together: your server, your TMDB token, your TheTVDB key. */
  serverNote: { color: colors.dim, fontSize: 12.5, lineHeight: 17, paddingHorizontal: space.lg, paddingTop: 6, paddingBottom: 4 },
  reminderAt: { color: colors.blue, fontSize: 15.5, fontWeight: '700' },
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
