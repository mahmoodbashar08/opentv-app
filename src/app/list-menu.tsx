import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, space } from '@/theme';

export default function ListMenuSheet() {
  const { name } = useLocalSearchParams<{ name?: string }>();

  const go = (to?: Href) => {
    router.back();
    if (to) setTimeout(() => router.push(to), 250);
  };

  return (
    <Pressable style={styles.backdrop} onPress={() => router.back()}>
      <View style={styles.sheet}>
        <Pressable style={styles.row} onPress={() => go('/lists/create')}>
          <Ionicons name="create-outline" size={20} color={colors.text} />
          <Text style={styles.label}>Edit details</Text>
        </Pressable>
        <Pressable style={styles.row} onPress={() => go(name ? `/lists/${encodeURIComponent(name)}` : undefined)}>
          <Ionicons name="swap-vertical" size={20} color={colors.text} />
          <Text style={styles.label}>Reorder items</Text>
        </Pressable>
        <Pressable style={styles.row} onPress={() => go()}>
          <Ionicons name="trash-outline" size={20} color={colors.text} />
          <Text style={styles.label}>Delete</Text>
        </Pressable>
        <Pressable style={[styles.row, { borderBottomWidth: 0 }]} onPress={() => go()}>
          <Ionicons name="share-outline" size={20} color={colors.text} />
          <Text style={styles.label}>Share</Text>
        </Pressable>
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
    paddingTop: 12,
  },
  title: {
    color: colors.dim,
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: space.xl,
    paddingBottom: 8,
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
