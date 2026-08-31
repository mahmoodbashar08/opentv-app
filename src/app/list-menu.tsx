import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, router, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { track } from '@/analytics';
import { deleteList, getCustomLists, setListCover, setListPinned } from '@/db';
import { listsChanged } from '@/community-publish';
import { tapLight } from '@/haptics';
import { setPendingListMode } from '@/list-edit-mode';
import { requirePlus } from '@/plus';
import { colors, space } from '@/theme';
import { t } from '@/i18n';

export default function ListMenuSheet() {
  const { name } = useLocalSearchParams<{ name?: string }>();
  // A modal that lives for one tap: read once, no focus tick to keep in step.
  const list = name != null ? getCustomLists().find((l) => l.name === name) : undefined;
  const pinned = list?.pinned === true;
  const hasCover = (list?.coverUrl ?? null) != null;

  /**
   * PLUS, AND THE GATE IS THE ONLY THING THAT KNOWS IT.
   *
   * `requirePlus` either returns true or has already pushed the paywall, so
   * every gated row is the same three lines and none of them can forget to
   * close this sheet first — a paywall stacked under an open action sheet is
   * a screen nobody can dismiss.
   */
  const gated = (from: string, run: () => void) => () => {
    tapLight();
    router.back();
    setTimeout(() => {
      if (requirePlus(from)) run();
    }, 250);
  };

  const chooseCover = gated('list_covers', () => {
    if (!name) return;
    if (hasCover) {
      setListCover(name, null);
      listsChanged();
      return;
    }
    router.push(`/cover-picker?list=${encodeURIComponent(name)}`);
  });

  const togglePin = gated('list_pin', () => {
    if (!name) return;
    setListPinned(name, !pinned);
    track('list_pinned', { on: pinned ? 0 : 1 });
    listsChanged();
  });

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
          listsChanged();
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
        <Pressable style={styles.row} onPress={chooseCover}>
          <Ionicons name={hasCover ? 'image' : 'image-outline'} size={20} color={colors.text} />
          <Text style={styles.label}>
            {hasCover ? t('plus.lists.removeCover') : t('plus.lists.setCover')}
          </Text>
        </Pressable>
        <Pressable style={styles.row} onPress={togglePin}>
          <Ionicons name={pinned ? 'pin' : 'pin-outline'} size={20} color={colors.text} />
          <Text style={styles.label}>{pinned ? t('plus.lists.unpin') : t('plus.lists.pin')}</Text>
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
    backgroundColor: colors.card,
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
