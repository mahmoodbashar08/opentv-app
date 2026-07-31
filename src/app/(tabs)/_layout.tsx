import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { InteractionManager } from 'react-native';

import { offerCommunityIfDue } from '@/community-prompt';
import { t } from '@/i18n';
import { colors } from '@/theme';

export default function TabsLayout() {
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
      offerCommunityIfDue();
    });
    return () => task.cancel();
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: '#1C1C1F' },
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
