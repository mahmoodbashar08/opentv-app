import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { InteractionManager, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { offerCommunityIfDue } from '@/community-prompt';
import { isNotifyScreenOwed } from '@/session-store';
import { t } from '@/i18n';
import { colors } from '@/theme';

export default function TabsLayout() {
  /*
   * THE NAVIGATION BAR WAS SITTING ON THE TAB LABELS.
   *
   * Expo draws Android edge-to-edge, so the app owns the strip the system
   * buttons are painted over and has to keep out of it itself. It did not: on
   * a phone with three-button navigation, back/home/recents landed directly on
   * "Shows", "Movies" and "Explore" — unreadable, and the tabs under them hard
   * to hit. Never seen because nothing in this app had been run on Android.
   *
   * iOS is left alone. Its tab bar already clears the home indicator, and
   * adding the inset a second time would float it off the bottom of the
   * screen.
   */
  const insets = useSafeAreaInsets();
  const bottom = Platform.OS === 'android' ? insets.bottom : 0;
  // The community offer for everyone who imported before this update existed
  // — and, one screen later, for the user who has just finished an import
  // through the notification opt-in. `offerCommunityIfDue` stamps its own flag
  // as it presents, so this fires at most once ever, whichever path reaches it
  // first.
  //
  // Deferred behind runAfterInteractions for the same reason the root layout
  // defers startup repairs: navigating while the tab navigator is still
  // mounting drops the push entirely.
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      // Not while the notification screen is still owed: it is drawn on top of
      // these tabs, so the push lands behind it and its `replace` discards it —
      // having already stamped the flag. `notify-optin` makes the offer itself
      // once it is answered.
      if (isNotifyScreenOwed()) return;
      offerCommunityIfDue();
    });
    return () => task.cancel();
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.line,
          height: 58 + bottom,
          paddingBottom: bottom,
        },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.faint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      }}>
      {/* "/" only redirects to Explore — hidden from the tab bar */}
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen
        name="shows"
        options={{
          title: t('tabBar.shows'),
          tabBarIcon: ({ color, size }) => <Ionicons name="tv-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="movies"
        options={{
          title: t('tabBar.movies'),
          tabBarIcon: ({ color, size }) => <Ionicons name="film-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: t('tabBar.explore'),
          tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabBar.profile'),
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
