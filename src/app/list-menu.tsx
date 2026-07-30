import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, router, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { deleteList } from '@/db';
import { setPendingListMode } from '@/list-edit-mode';
import { colors, space } from '@/theme';
import { t } from '@/i18n';

export default function ListMenuSheet() {
  const { name } = useLocalSearchParams<{ name?: string }>();

  const go = (to?: Href) => {
    router.back();
    if (to) setTimeout(() => router.push(to), 250);
  };

  const confirmDelete = () => {
    if (!name) return;
    Alert.alert(t('listMenu.deleteListTitle'), t('listMenu.deleteConfirmBody', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('listMenu.delete'),
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
          <Text style={styles.label}>{t('listMenu.editDetails')}</Text>
        </Pressable>
        <Pressable
          style={styles.row}
          onPress={() => {
            setPendingListMode('reorder');
            router.back();
          }}>
          <Ionicons name="swap-vertical" size={20} color={colors.text} />
          <Text style={styles.label}>{t('listMenu.reorderItems')}</Text>
        </Pressable>
        <Pressable style={[styles.row, { borderBottomWidth: 0 }]} onPress={confirmDelete}>
          <Ionicons name="trash-outline" size={20} color={colors.danger} />
          <Text style={[styles.label, { color: colors.danger }]}>{t('listMenu.delete')}</Text>
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
