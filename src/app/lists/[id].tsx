import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedRef, useScrollViewOffset } from 'react-native-reanimated';

import { Poster } from '@/components/poster';
import { SortablePosterGrid } from '@/components/sortable-poster-grid';
import { NavHeader, PillButton, Screen } from '@/components/ui';
import { getCustomLists, removeFromList, setListOrder, type CustomList, type CustomListItem } from '@/db';
import seed from '@/seed';
import { isSeedLibrary } from '@/library';
import { takePendingListMode, type ListMode } from '@/list-edit-mode';
import { colors, space } from '@/theme';

export default function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const name = decodeURIComponent(id ?? '');
  const seedLib = isSeedLibrary();
  const [, setTick] = useState(0);
  // 'edit' = add / remove (✕ badges); 'reorder' = drag posters. Never both.
  const [mode, setMode] = useState<ListMode>('view');
  // scroll ref + live offset drive the grid's drag-to-edge auto-scroll
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useScrollViewOffset(scrollRef);
  const refresh = () => setTick((n) => n + 1);
  // re-read on focus, and pick up a mode requested from the ⋯ menu (Reorder)
  useFocusEffect(
    useCallback(() => {
      setTick((n) => n + 1);
      const pending = takePendingListMode();
      if (pending) setMode(pending);
    }, []),
  );

  const lists = (seedLib ? seed.lists : getCustomLists()) as unknown as CustomList[];
  const list = lists.find((l) => l.name === name || l.name === (id ?? ''));
  const items = list?.items ?? [];

  const open = (item: CustomListItem) =>
    item.tvdbId ? router.push(`/show/${item.tvdbId}`) : router.push(`/movie/${encodeURIComponent(item.name)}`);

  const removeItem = (item: CustomListItem) => {
    if (seedLib || !list) return;
    Alert.alert('Remove from list', `Remove "${item.name}" from "${list.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          removeFromList(list.name, item.name);
          refresh();
        },
      },
    ]);
  };

  const reorder = (ordered: CustomListItem[]) => {
    if (!list) return;
    setListOrder(list.name, ordered);
    refresh();
  };

  return (
    <Screen>
      <NavHeader
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            {!seedLib && mode !== 'view' ? (
              <Pressable hitSlop={8} onPress={() => setMode('view')}>
                <Text style={{ color: colors.blue, fontSize: 15.5, fontWeight: '700' }}>Done</Text>
              </Pressable>
            ) : (
              <>
                {!seedLib && items.length > 0 && (
                  <Pressable hitSlop={8} onPress={() => setMode('edit')}>
                    <Text style={{ color: colors.blue, fontSize: 15.5, fontWeight: '600' }}>Edit</Text>
                  </Pressable>
                )}
                <Pressable hitSlop={10} onPress={() => router.push(`/list-menu?name=${encodeURIComponent(id ?? '')}`)}>
                  <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
                </Pressable>
              </>
            )}
          </View>
        }
      />
      <View style={{ paddingHorizontal: space.lg, gap: 12, paddingBottom: 12 }}>
        <Text style={styles.title}>{name}</Text>
        {mode === 'edit' && (
          <PillButton
            label="Add shows & movies"
            onPress={() => router.push(`/lists/add-remove?name=${encodeURIComponent(name)}`)}
          />
        )}
        <Text style={styles.sort}>
          {mode === 'reorder'
            ? 'DRAG A POSTER TO A NEW SPOT'
            : mode === 'edit'
              ? 'TAP ✕ TO REMOVE · ADD WITH THE BUTTON ABOVE'
              : 'SORT BY '}
          {mode === 'view' && <Text style={{ color: colors.blue }}>User order</Text>}
        </Text>
      </View>

      {seedLib ? (
        <FlatList
          data={items}
          keyExtractor={(it, i) => `${it.name}-${i}`}
          numColumns={3}
          columnWrapperStyle={{ gap: 3 }}
          contentContainerStyle={{ paddingHorizontal: space.md, gap: 3, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <Pressable style={{ flex: 1 / 3 }} onPress={() => open(item)}>
              <Poster name={item.name} uri={item.poster} />
            </Pressable>
          )}
        />
      ) : (
        <Animated.ScrollView
          ref={scrollRef}
          contentContainerStyle={{ paddingBottom: 40 }}
          scrollEnabled={mode !== 'reorder'}>
          <SortablePosterGrid
            items={items}
            editing={mode === 'edit'}
            draggable={mode === 'reorder'}
            onOpen={open}
            onRemove={removeItem}
            onReorder={reorder}
            scrollRef={scrollRef}
            scrollY={scrollY}
          />
          <Text style={styles.note}>
            {list?.totalCount && list.totalCount > items.length
              ? `${items.length} of ${list.totalCount} items · the rest were never tracked, so TV Time's export left their names out`
              : `${items.length} items · in your order`}
          </Text>
        </Animated.ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 24, fontWeight: '800' },
  sort: { color: colors.dim, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  note: { color: colors.faint, fontSize: 12.5, textAlign: 'center', marginTop: 14 },
});
