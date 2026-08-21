import * as Notifications from 'expo-notifications';
import { router, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, InteractionManager, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

import { trackScreen } from '@/analytics';
import { initAutoBackup } from '@/backup';
import { backfillCharacterNames } from '@/character-name-fetch';
import { maybePrefetchAggregates } from '@/community-prefetch';
import { retryHandleClaim } from '@/community-prompt';
import { api } from '@/api';
import { storeAppLinks } from '@/links';
import { syncDisplayName } from '@/community-profiles';
import { refreshSession, useUnverifiedEmail } from '@/community-session';
import { syncArchiveIfNeeded } from '@/community-seed';
import { downloadPendingCommentImages, recoverProfileCover } from '@/importer';
import { dedupeOwnComments } from '@/db';
import { resumeInterruptedImport, runStartupRepairs } from '@/migrations';
import { backfillMovieTvdbIds } from '@/movie-tvdb-match';
import { initPurchases } from '@/purchases';
import { cacheAllShowMetadata, fillMissingEpisodeStills, fillMissingMoviePosters, fillMissingShowNames,
  fillMissingShowPosters, fillMovieReleaseDates } from '@/show-meta-fetch';
import { notificationsEnabled, syncEpisodeNotifications } from '@/notifications';
import { syncWidgets } from '@/widget-sync';
import { UpdateGate } from '@/components/update-gate';
import { initI18n, t } from '@/i18n';
import { useNotifyAsked, useOnboarded } from '@/session-store';
import { shouldAskForNotifications } from '@/pure';
import { colors } from '@/theme';

export default function RootLayout() {
  // Runs exactly once, before the first paint: a lazy useState initialiser
  // executes during render but only on mount, unlike a bare function call
  // (which would re-run on every re-render) or an effect (which would run
  // after paint, letting one frame render in the wrong language).
  // See initI18n(): this is true only when the phone's language resolved to a
  // direction that didn't match the native layout yet (fresh install already
  // in Arabic, or the phone's language changed under the app). The direction
  // has just been corrected for NEXT launch — RN does not guarantee an
  // already-running app re-lays-out — so this session may still render
  // mirrored wrong, and the effect below tells the user honestly, the same
  // way the language picker already does, rather than silently doing nothing
  // or restarting the app ourselves.
  const [directionMismatch] = useState(() => initI18n());
  // real route protection: no way into the app before onboarding,
  // and no way back to the welcome flow once inside
  const onboarded = useOnboarded();
  // The one-time notification ask. Read once per mount: both answers stamp
  // notifyAsked, and the screen replaces itself with /profile, so this never
  // needs to react mid-session. Guarding here rather than at the four
  // setOnboarded(true) call sites means no path into the app can skip it.
  //
  // It also has to reach EXISTING users. Routing only from the end of
  // onboarding would show it to new installs alone — and on an update that is
  // almost nobody, which is the whole point of asking. The effect below sends
  // an already-onboarded user who has never been asked to the same screen.
  const askNotify = shouldAskForNotifications({
    onboarded,
    asked: useNotifyAsked(),
    enabled: notificationsEnabled(),
  });
  // fire once per launch: answering stamps notifyAsked, which flips askNotify
  // false and unmounts the screen, so this cannot loop
  // set while the one-time repair re-import is running so we can show a real
  // progress overlay instead of a frozen splash (the import blocks the JS thread)
  const [repairPhase, setRepairPhase] = useState<string | null>(null);

  // Tell the user rather than leave them stuck in a mismatched layout with no
  // way out: reusing the exact copy the language picker shows for the same
  // situation (crossing an RTL boundary needs a relaunch). Fires once, after
  // first paint — never blocking it — and only on the launch that actually
  // found a mismatch; every launch after that is already corrected and this
  // effect is inert.
  /**
   * A TAPPED PUSH GOES WHERE THE IN-APP ROW GOES — AND A HOOK, NOT A LISTENER.
   *
   * `data` is set by the Worker's `push.ts` and mirrors `openActivity` on the
   * notifications screen: a like or a reply lands on the comment's own page,
   * where it can be read and answered; a follow lands on the person. A push
   * that only opens the app makes the reader hunt for what it was about.
   *
   * Guarded on `kind` so a local episode reminder — which carries no `kind` —
   * falls through to simply opening the app, as it always has.
   *
   * `addNotificationResponseReceivedListener` subscribes inside an effect, so it
   * only ever hears taps that happen while the app is already running. The most
   * common tap of all is the one that LAUNCHES it — the phone was locked, the
   * notification arrived, the reader tapped it — and by the time this effect
   * ran, that response had already been delivered to nobody. The app opened on
   * whatever screen it opened on and the notification led nowhere, which is
   * indistinguishable from the routing being broken.
   *
   * `useLastNotificationResponse()` returns the response that started the app as
   * well as later ones, so both paths land here. It keeps returning the same
   * response on every re-render, hence the identifier guard: without it a tap
   * would re-navigate on each render for the rest of the session.
   */
  const lastResponse = Notifications.useLastNotificationResponse();
  const routedPush = useRef<string | null>(null);
  useEffect(() => {
    if (!lastResponse) return;
    const id = lastResponse.notification.request.identifier;
    if (routedPush.current === id) return;
    routedPush.current = id;

    const data = lastResponse.notification.request.content.data as
      | { kind?: string; subjectId?: string | null; handle?: string | null; month?: string | null }
      | undefined;
    if (data?.kind == null) return;
    // the month-closed local notification: it is about one specific month, so
    // it must land on that month rather than on whatever Wrapped defaults to
    if (data.kind === 'wrapped' && data.month) {
      router.push(`/wrapped?month=${encodeURIComponent(data.month)}`);
      return;
    }
    // A friend arriving is news about the whole list, not about one profile —
    // the same reasoning the in-app row uses. See `openActivity`.
    if (data.kind === 'friend_found') {
      router.push('/reconnect');
      return;
    }
    if ((data.kind === 'like' || data.kind === 'reply' || data.kind === 'comment') && data.subjectId) {
      router.push(`/comment/${encodeURIComponent(data.subjectId)}`);
      return;
    }
    if (data.handle) router.push(`/profile/${encodeURIComponent(data.handle)}`);
  }, [lastResponse]);

  /**
   * EVERY screen view, from one place.
   *
   * `useSegments()` is the route PATTERN — `['show', '[id]']` — so this logs
   * `show/[id]` and never the tvdbId in the URL. That is deliberate twice over:
   * see the note in `analytics.ts` about shape versus content. Doing it here
   * rather than per screen means a screen added later is counted without anyone
   * remembering to instrument it, and there is one rule to audit instead of
   * forty. Firebase drops these entirely for anyone who has not joined.
   */
  const segments = useSegments();

  /**
   * An account whose email is still unconfirmed cannot use the community — the
   * server refuses every route with `email_unverified` — but nothing told the
   * app that. Closing the app on the confirm screen and reopening it dropped
   * the user into a full community that answered 403 to everything: signed in
   * by every appearance, able to do nothing, with no way back to the screen
   * that would fix it.
   *
   * So the address is remembered at sign-in and the confirm screen is put back
   * in front of them on launch. It is not a trap: that screen's "Not now"
   * leaves the community, which signs this device out.
   */
  const unverified = useUnverifiedEmail();
  const onVerifyScreen = segments.some((seg) => seg === 'verify-email');
  // Empty until expo-router has mounted its screens. A push before that is
  // DROPPED, and this effect's other inputs do not change afterwards — so the
  // one attempt it got was the one that could not work, and the gate never
  // appeared no matter how many times the app was reopened.
  const routerReady = segments.length > 0;
  useEffect(() => {
    // NOT when it is already open. Registering sets the flag and the sign-in
    // screen has already navigated here, so without this the two would stack a
    // second copy of the screen on top of the first.
    if (!routerReady || !unverified || !onboarded || onVerifyScreen) return;
    // AFTER THE FIRST INTERACTIONS, not during them. Issued the moment the
    // tabs mount, the push is made and then lost — the navigator is still
    // settling its initial route and replaces the stack underneath it. The
    // effect ran, the call was reached, and nothing appeared; deferring one
    // beat is the difference.
    const task = InteractionManager.runAfterInteractions(() => {
      router.push(`/verify-email?email=${encodeURIComponent(unverified)}`);
    });
    return () => task.cancel();
  }, [routerReady, unverified, onboarded, onVerifyScreen]);

  useEffect(() => {
    if (segments.length > 0) trackScreen(segments.join('/'));
  }, [segments]);

  useEffect(() => {
    if (!directionMismatch) return;
    Alert.alert(t('language.restartTitle'), t('language.restartBody'), [
      { text: t('language.restartConfirm') },
    ]);
  }, [directionMismatch]);

  // every trip to the background refreshes the iCloud backup (no-op when
  // nothing changed since the last one)
  useEffect(() => {
    initAutoBackup();
    // DEFER the heavy startup work until after the first frame is painted and
    // the app is interactive — a large repair re-import blocks the JS thread,
    // and running it before first paint froze the splash (users thought it hung
    // and reinstalled, losing hand-fixed matches). runAfterInteractions lets the
    // UI come up first; the overlay below then covers the actual repair.
    const task = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        await resumeInterruptedImport();
        await runStartupRepairs(setRepairPhase);
        // An early own-comment sync wrote a bare duplicate of every comment the
        // phone had already uploaded. Cleaned at launch rather than only when
        // the comments screen opens, because the PROFILE counts the same rows
        // and would otherwise read one higher than the list underneath it.
        dedupeOwnComments();
        // finish (or retroactively fill) comment images that weren't downloaded
        // in-import — runs after any interrupted import resumes
        void downloadPendingCommentImages();
        // covers lost to TV Time's dead CDN are still on TheTVDB — rescue them
        // onto the device while that CDN is itself still alive
        void recoverProfileCover();
        // backfill posters TMDB couldn't provide (movies + shows), from TheTVDB
        void fillMissingMoviePosters();
        // release dates for the watchlist, so Upcoming can split out unreleased films
        void fillMovieReleaseDates();
        // TheTVDB ids for imported films. The GDPR export has no movie id at
        // all, so every imported film had a null tvdbId and the film screen's
        // favourite-character poll silently fell back to TMDB's cast — which
        // has headshots of the performers and no character pictures at all.
        void backfillMovieTvdbIds();
        // A show with no name is blank on every screen that draws it, so this
        // runs beside the poster backfill rather than behind it.
        void fillMissingShowNames();
        void fillMissingShowPosters();
        // shows TheTVDB covers thinly borrow their episode pictures from TMDB
        void fillMissingEpisodeStills();
        // pre-cache every show's full metadata so the library is fully browsable
        // offline (episode names, dates, seasons) — no-op once all are stored
        void cacheAllShowMetadata();
        // TV Time's export identifies a favourite character by TheTVDB id and
        // nothing else, so those votes imported nameless and the seeder — which
        // cannot send a vote with no name — silently dropped every one of them.
        // The id resolves; this puts the names back.
        //
        // AWAITED, and deliberately AHEAD of syncArchiveIfNeeded: filling a name
        // is what makes the vote sendable AND what moves the archive
        // fingerprint (see archiveCounts), so the sync immediately below is the
        // run that carries the recovered names to the server. Run it after, and
        // they would wait a whole launch.
        await backfillCharacterNames();
        // the archive heals itself. A DONE flag can only record that a row was
        // sent, never that it was sent in the shape the server now stores — so
        // a contract revision plus a cheap local fingerprint decide, on every
        // open, whether anything is owed. Unchanged is the common case and
        // costs ZERO requests; see syncArchiveIfNeeded.
        //
        // AWAITED, and ahead of the prefetch below, on purpose: uploading the
        // user's own votes before caching the numbers means the percentages
        // they are about to read already contain their own vote. It never
        // throws and it is already behind runAfterInteractions, so waiting for
        // it blocks nothing the user can see.
        // FIRST OF THE COMMUNITY WORK, because everything after it assumes the
        // session is real. `requireAuth` does no I/O, so a profile deleted by
        // moderation — or by hand in the database — leaves every token working
        // until it expires; this is the one call that asks. A dead session ends
        // here and the app falls back to the Join prompt, instead of showing a
        // community that quietly answers nothing.
        await refreshSession();
        // AFTER the session is confirmed, so RevenueCat is configured with the
        // profile id this device actually has rather than one that has just
        // been signed out. Not before it either: a subscription is tied to the
        // store account, and a device with no community account at all still
        // gets Plus — the anonymous id RC generates is enough, because a
        // restore reads the receipt, not our profile.
        initPurchases();
        // THE HANDLE, IF IT IS STILL A PLACEHOLDER. `POST /v1/me/handle`
        // refuses an unverified session, which is what every email sign-up has
        // when the claim first runs — so those accounts kept `user_p_…`, and
        // with leaving removed there was no second sign-in to try again. This
        // is the retry, and it is what repairs accounts made before the fix.
        // Silent and cheap: one string check when there is nothing to do.
        await retryHandleClaim();
        // Likewise the display name, for anyone who set one before joining or
        // whose account predates it being published at all.
        await syncDisplayName();
        /*
         * THE LINKS, ON A REQUEST THIS LAUNCH WAS MAKING ANYWAY.
         *
         * Inside the signed-in branch on purpose: somebody who declined the
         * community never contacts this server, so they keep the list the app
         * shipped with and reach nothing. That is the whole reason the defaults
         * are bundled rather than fetched.
         *
         * Fire and forget, and silent: the bundled list is always there, so a
         * failure has nothing to report and nothing a user could act on.
         */
        void api<{ links: unknown }>('/v1/links')
          .then((r) => storeAppLinks(r.links))
          .catch(() => {});
        await syncArchiveIfNeeded();
        // community percentages for everything the user has RATED, a hundred
        // targets per request, straight into the same meta cache the episode and
        // film screens read during render. Without this the numbers only exist
        // for a title after that title has been opened, one at a time, which is
        // exactly what the owner reported. Throttled and fingerprinted inside —
        // see community-prefetch.ts — so calling it on every launch is free.
        void maybePrefetchAggregates();
      })();
    });
    // home-screen widgets: push fresh data on launch, and again every time the
    // app heads to the background — right before the home screen is visible
    void syncWidgets();
    void syncEpisodeNotifications(true); // launch: do the full pass once
    const sub = AppState.addEventListener('change', (s) => {
      // 'background' only. 'inactive' also fires for the app switcher, the
      // notification shade and call banners — moments the user has not left
      // and is about to come straight back to. Syncing then meant the work was
      // still running on the JS thread when they returned, which is what a
      // user saw as buttons lagging and "working after a few tries".
      if (s === 'background') {
        void syncWidgets();
        void syncEpisodeNotifications();
      }
      // Coming BACK is the other half. A phone that sat in a pocket overnight
      // has a stale sweep; picking it up is the moment to top the numbers up,
      // and deferring behind runAfterInteractions keeps it off the frame the
      // user is actually looking at — the same reason the launch work above is
      // deferred. The throttle means an app switched to and away from ten times
      // in a minute still makes at most one round of requests.
      if (s === 'active') {
        InteractionManager.runAfterInteractions(() => {
          // Same pair, same order, for the same reason as on launch: send
          // first, then read. A phone that sat in a pocket while its owner
          // rated three episodes on the train has three rows owed, and they
          // must be up before the aggregates that are supposed to include
          // them are cached. Both are no-ops when nothing changed.
          void (async () => {
            await syncArchiveIfNeeded();
            void maybePrefetchAggregates();
          })();
        });
      }
    });
    return () => {
      sub.remove();
      task.cancel();
    };
  }, []);

  return (
    /*
     * THE SAFE AREA'S ONE SOURCE OF TRUTH.
     *
     * `react-native-safe-area-context` needs this ancestor: without it every
     * `useSafeAreaInsets()` and every `<SafeAreaView>` in the app reads zero,
     * silently. That is what put the close chevron on top of the status bar
     * clock on the community profile — the control was drawn exactly where a
     * 0pt inset says the screen begins, and the clock is unpressable, so the
     * screen had no way out.
     *
     * `initialMetrics` seeds the insets from the values the native side already
     * knows at launch, so the first frame is laid out correctly instead of
     * rendering at zero and jumping once the real values arrive.
     */
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="light" />
        <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}>
        <Stack.Protected guard={!onboarded}>
          <Stack.Screen name="welcome" />
        </Stack.Protected>
        <Stack.Protected guard={askNotify}>
          <Stack.Screen name="notify-optin" />
        </Stack.Protected>
        {/* language is reachable from the welcome screen too (a corner control
            lets a user read the import flow in their own language before
            onboarding finishes), so it sits outside the onboarded guard.
            It shows no library data and gates nothing else, so this doesn't
            weaken any other Protected group. */}
        <Stack.Screen name="language" />
        <Stack.Protected guard={onboarded && !askNotify}>
        <Stack.Screen name="(tabs)" />
        {/* show / episode / movie cover the whole screen incl. status bar, like
            the real app. transparentModal keeps the previous screen rendered
            underneath, so dragging the page down reveals it instead of a black
            void; the pages paint their own opaque background */}
        <Stack.Screen
          name="show/[id]"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="episode/[id]"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="movie/[name]"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        {/* joining the community. Both are full-height sheets rather than
            fade-in panels: they are decisions, not menus, and the slide up is
            what marks them as a step rather than a popup. */}
        <Stack.Screen
          name="join"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="email-sign-in"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        {/* Also the landing point of `opentv://verify-email?token=…`, which
            is why it is a normal route rather than something nested under join:
            the link can arrive when the app is cold, from a mail client, with
            no navigation history behind it.

            `gestureEnabled: false` for the reason the handle screen has it —
            until this is done the account cannot do anything, and a swipe-down
            would leave somebody signed in, blocked, and looking at a Join
            button for an account they already have. */}
        <Stack.Screen
          name="verify-email"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
            gestureEnabled: false,
          }}
        />
        {/* The landing point of `opentv://reset-password?token=…`. It was
            never registered, so every reset link in every email opened
            "Unmatched Route" — the one screen the whole reset flow needed.
            Same shape as verify-email above, and for the same reason: it
            arrives cold from a mail client with nothing behind it. */}
        <Stack.Screen
          name="reset-password"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        {/* Adding a password to an Apple or Google account. A plain push, not
            a modal: it is reached from Settings and unwinds back to it. */}
        <Stack.Screen name="set-password" />
        {/* ── OpenTV Plus ─────────────────────────────────────────────── */}
        {/* The paywall is a sheet, like join: an offer slides up over what
            you were doing and swipes away. The other two are destinations. */}
        <Stack.Screen
          name="paywall"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen name="deep-stats" />
        {/* A year of how it felt. Pushed like deep-stats, and reached from the
            same place: it is another way of reading the archive, not an action. */}
        <Stack.Screen name="emotion-calendar" />
        {/* Picking the profile theme by hand, when artwork will not give one. */}
        <Stack.Screen name="theme-colours" />
        {/* The links on a profile — the one screen that publishes typed text. */}
        <Stack.Screen name="edit-links" />
        {/* Who you knew on TV Time, and which of them are here. A pushed page
            and not a sheet: it is reached from a menu row, a banner and a
            notification, all of which push. */}
        <Stack.Screen name="reconnect" />
        {/* An actor, reached by tapping their card in a show's Cast row. A
            pushed page rather than a modal: it is the middle of a journey —
            show → actor → another show — and a stack of sheets would bury the
            show underneath. */}
        <Stack.Screen name="person/[id]" />
        {/* Lists two people build together. Pushed, not modal: this is somewhere
            you come back to, and a sheet is for something you finish and
            dismiss. */}
        <Stack.Screen name="shared/index" />
        <Stack.Screen name="shared/[id]" />
        <Stack.Screen name="shared/create" />
        <Stack.Screen name="timeline" />
        <Stack.Screen name="wrapped" />
        <Stack.Screen name="appearance" />
        <Stack.Screen
          name="handle"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
            // The handle is not optional once a profile exists — a swipe-down
            // would leave the user joined under a `user_…` placeholder with no
            // obvious way back to this screen.
            gestureEnabled: false,
          }}
        />
        {/* bringing the TV Time archive over, offered once joining is done and
            reachable forever from Settings → Account. A sheet like the two
            above it: it is the third step of the same decision, not a menu. */}
        <Stack.Screen
          name="seed"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        {/* the community thread for an episode, a show or a film. Its own
            screen rather than a section inside the detail pages: those are one
            long ScrollView each, and a FlatList inside a ScrollView is the
            nested-virtualisation bug — see the note at the top of thread.tsx. */}
        <Stack.Screen
          name="thread"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        {/* Somebody else's profile, and a list they published. Both are
            transparentModal + slide_from_bottom like every other detail sheet
            here, so a profile opened from a comment can be swiped away back
            onto the thread it came from rather than pushing a stack the user
            then has to unwind. */}
        <Stack.Screen
          name="profile/[handle]"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        {/* Where a public profile's arrows lead: one shelf in full, and
            everything that person has written. The Profile tab's own sections
            each have a `›`; these are the same arrows on somebody else's. */}
        <Stack.Screen
          name="user-titles"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="user-people"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="user-lists"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="user-comments"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="list/[id]"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen name="review-movies" options={{ presentation: 'modal' }} />
        <Stack.Screen name="lists/create" options={{ presentation: 'modal' }} />
        {/* one comment and its replies — the permalink a tap on any card opens */}
        <Stack.Screen name="comment/[id]" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="edit-profile" options={{ presentation: 'modal' }} />
        {/* Who asked to follow you. A modal, like every other list reached from
            a row rather than a tab. */}
        <Stack.Screen name="follow-requests" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="create-topic" options={{ presentation: 'modal' }} />
        <Stack.Screen
          name="filters"
          options={{
            presentation: 'transparentModal',
            animation: 'fade',
            animationDuration: 150,
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="movie-filters"
          options={{
            presentation: 'transparentModal',
            animation: 'fade',
            animationDuration: 150,
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen name="pick-artwork" options={{ presentation: 'card', animation: 'slide_from_right' }} />
        <Stack.Screen name="pick-gif" options={{ presentation: 'card', animation: 'slide_from_right' }} />
        <Stack.Screen
          name="add-widget"
          options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: 'transparent' } }}
        />
        <Stack.Screen
          name="profile-menu"
          options={{
            presentation: 'transparentModal',
            animation: 'fade',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="list-menu"
          options={{
            presentation: 'transparentModal',
            animation: 'fade',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="mark-as"
          options={{
            presentation: 'transparentModal',
            animation: 'fade',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        </Stack.Protected>
        </Stack>
        <UpdateGate />
        {repairPhase != null && (
          <View style={[StyleSheet.absoluteFill, styles.repairOverlay]}>
            <ActivityIndicator size="large" color={colors.yellow} />
            <Text style={styles.repairTitle}>{repairPhase}</Text>
            <Text style={styles.repairSub}>{t('startupRepair.body')}</Text>
          </View>
        )}
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  repairOverlay: {
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 16,
    zIndex: 900,
  },
  repairTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  repairSub: { color: colors.dim, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
