import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, router, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { deleteList } from '@/db';
import { setPendingListMode } from '@/list-edit-mode';
import { colors, space } from '@/theme';

export default function ListMenuSheet() {
  const { name } = useLocalSearchParams<{ name?: string }>();

  const go = (to?: Href) => {
    router.back();
    if (to) setTimeout(() => router.push(to), 250);
  };

  const confirmDelete = () => {
    if (!name) return;
    Alert.alert('Delete list', `Delete "${name}"? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteList(name);
          router.back(); // close this menu
          // pop the now-deleted list's detail screen back to the Lists tab
          setTimeout(() => router.back(), 260);
        },
      },
    ]);
  };

  return (
    <Pressable style={styles.backdrop} onPress={() => router.back()}>
      <View style={styles.sheet}>
        <Pressable
          style={styles.row}
          onPress={() => go(name ? `/lists/create?edit=${encodeURIComponent(name)}` : '/lists/create')}>
          <Ionicons name="create-outline" size={20} color={colors.text} />
          <Text style={styles.label}>Edit details</Text>
        </Pressable>
        <Pressable
          style={styles.row}
          onPress={() => {
            setPendingListMode('reorder');
            router.back();
          }}>
          <Ionicons name="swap-vertical" size={20} color={colors.text} />
          <Text style={styles.label}>Reorder items</Text>
        </Pressable>
        <Pressable style={[styles.row, { borderBottomWidth: 0 }]} onPress={confirmDelete}>
          <Ionicons name="trash-outline" size={20} color={colors.danger} />
          <Text style={[styles.label, { color: colors.danger }]}>Delete</Text>
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
