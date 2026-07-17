import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { initAutoBackup } from '@/backup';
import { resumeInterruptedImport, runStartupRepairs } from '@/migrations';
import { syncWidgets } from '@/widget-sync';
import { UpdateGate } from '@/components/update-gate';
import { useOnboarded } from '@/session-store';
import { colors } from '@/theme';

export default function RootLayout() {
  // real route protection: no way into the app before onboarding,
  // and no way back to the welcome flow once inside
  const onboarded = useOnboarded();

  // every trip to the background refreshes the iCloud backup (no-op when
  // nothing changed since the last one)
  useEffect(() => {
    initAutoBackup();
    // first finish any import cut short by a backgrounded/killed app, then run
    // the silent one-time self-repairs from the preserved original export —
    // scale fixes + a merge re-import that fills anything older importers
    // dropped; users never need to erase or re-import by hand
    void (async () => {
      await resumeInterruptedImport();
      await runStartupRepairs();
    })();
    // home-screen widgets: push fresh data on launch, and again every time the
    // app heads to the background — right before the home screen is visible
    void syncWidgets();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background' || s === 'inactive') void syncWidgets();
    });
    return () => sub.remove();
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
        <Stack.Protected guard={onboarded}>
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
    </GestureHandlerRootView>
  );
}
