import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, space } from '@/theme';
import { t } from '@/i18n';

// `name` is a stable English identifier used only as the React key; `labelKey`
// is what's shown — see movie/[name].tsx and episode/[id].tsx for the pattern.
const ITEMS = [
  // Settings stays first: it is what this menu is opened for, and a row added
  // above the one everybody reaches for costs every user a moment forever to
  // save a new user one.
  { name: 'Settings', icon: 'settings-outline', labelKey: 'profileMenu.settings' as const, to: '/settings' },
  // FIND PEOPLE, AND THE ONE THING BEHIND IT NOBODY COULD FIND. Reconnect --
  // the screen a pinned Reddit post promised, that matches your old TV Time
  // friends against every new account -- was five taps deep behind an unlabelled
  // icon on the Following screen. Reachable here because "where are my friends"
  // is a question asked from the profile.
  { name: 'Find people', icon: 'person-add-outline', labelKey: 'profileMenu.findPeople' as const, to: '/find-people' },
  { name: 'Share', icon: 'share-outline', labelKey: 'profileMenu.share' as const, to: '/share-profile' },
  { name: 'Help center', icon: 'help-circle-outline', labelKey: 'profileMenu.helpCenter' as const, to: null },
] as const;

export default function ProfileMenuSheet() {
  return (
    <Pressable style={styles.backdrop} onPress={() => router.back()}>
      <View style={styles.sheet}>
        {ITEMS.map((item) => (
          <Pressable
            key={item.name}
            style={styles.row}
            onPress={() => {
              router.back();
              if (item.to) setTimeout(() => router.push(item.to), 250);
            }}>
            <Ionicons name={item.icon} size={20} color={colors.text} />
            <Text style={styles.label}>{t(item.labelKey)}</Text>
          </Pressable>
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    // A sheet is a raised surface — `raise` is white on paper and the dark
    // grey it always was on black. It was '#232326', so in the light theme the
    // sheet stayed dark while its rows painted `colors.text` on top: every item
    // present and unreadable.
    backgroundColor: colors.raise,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 30,
    paddingTop: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: space.xl,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  label: { color: colors.text, fontSize: 16.5 },
});
