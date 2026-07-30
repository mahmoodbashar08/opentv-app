import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, InteractionManager, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { initAutoBackup } from '@/backup';
import { downloadPendingCommentImages, recoverProfileCover } from '@/importer';
import { resumeInterruptedImport, runStartupRepairs } from '@/migrations';
import { cacheAllShowMetadata, fillMissingEpisodeStills, fillMissingMoviePosters, fillMissingShowPosters, fillMovieReleaseDates } from '@/show-meta-fetch';
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
        void fillMissingShowPosters();
        // shows TheTVDB covers thinly borrow their episode pictures from TMDB
        void fillMissingEpisodeStills();
        // pre-cache every show's full metadata so the library is fully browsable
        // offline (episode names, dates, seasons) — no-op once all are stored
        void cacheAllShowMetadata();
      })();
    });
    // home-screen widgets: push fresh data on launch, and again every time the
    // app heads to the background — right before the home screen is visible
    void syncWidgets();
    void syncEpisodeNotifications();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background' || s === 'inactive') {
        void syncWidgets();
        void syncEpisodeNotifications();
      }
    });
    return () => {
      sub.remove();
      task.cancel();
    };
  }, []);

  return (
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
        <Stack.Screen name="review-movies" options={{ presentation: 'modal' }} />
        <Stack.Screen name="lists/create" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit-profile" options={{ presentation: 'modal' }} />
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
