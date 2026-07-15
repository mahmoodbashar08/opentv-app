import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, space } from '@/theme';

const ITEMS = [
  { icon: 'settings-outline', label: 'Settings', to: '/settings' },
  { icon: 'share-outline', label: 'Share', to: '/share-profile' },
  { icon: 'help-circle-outline', label: 'Help center', to: null },
] as const;

export default function ProfileMenuSheet() {
  return (
    <Pressable style={styles.backdrop} onPress={() => router.back()}>
      <View style={styles.sheet}>
        {ITEMS.map((item) => (
          <Pressable
            key={item.label}
            style={styles.row}
            onPress={() => {
              router.back();
              if (item.to) setTimeout(() => router.push(item.to), 250);
            }}>
            <Ionicons name={item.icon} size={20} color={colors.text} />
            <Text style={styles.label}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#232326',
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
    borderBottomColor: '#333338',
  },
  label: { color: colors.text, fontSize: 16.5 },
});
