import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Poster } from '@/components/poster';
import { NavHeader, PillButton, Screen } from '@/components/ui';
import { getCustomLists, type CustomList } from '@/db';
import seed from '@/seed';
import { isSeedLibrary } from '@/library';
import { colors, space } from '@/theme';

export default function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const name = decodeURIComponent(id ?? '');
  const lists = (isSeedLibrary() ? seed.lists : getCustomLists()) as unknown as CustomList[];
  const list = lists.find((l) => l.name === name || l.name === (id ?? ''));
  const items = list?.items ?? [];

  return (
    <Screen>
      <NavHeader
        right={
          <Pressable hitSlop={10} onPress={() => router.push(`/list-menu?name=${encodeURIComponent(id ?? '')}`)}>
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
          </Pressable>
        }
      />
      <View style={{ paddingHorizontal: space.lg, gap: 12, paddingBottom: 12 }}>
        <Text style={styles.title}>{id}</Text>
        <PillButton label="Add/remove shows & movies" onPress={() => router.push('/lists/add-remove')} />
        <Text style={styles.sort}>
          SORT BY <Text style={{ color: colors.blue }}>User order</Text>
        </Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(it, i) => `${it.name}-${i}`}
        numColumns={3}
        columnWrapperStyle={{ gap: 3 }}
        contentContainerStyle={{ paddingHorizontal: space.md, gap: 3, paddingBottom: 40 }}
        renderItem={({ item }) => (
          <Pressable
            style={{ flex: 1 / 3 }}
            onPress={() =>
              item.tvdbId ? router.push(`/show/${item.tvdbId}`) : router.push(`/movie/${encodeURIComponent(item.name)}`)
            }>
            <Poster name={item.name} uri={item.poster} />
          </Pressable>
        )}
        ListFooterComponent={
          <Text style={styles.note}>
            {list?.totalCount && list.totalCount > items.length
              ? `${items.length} of ${list.totalCount} items · the rest were never tracked, so TV Time's export left their names out`
              : `${items.length} items · in your order`}
          </Text>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 24, fontWeight: '800' },
  sort: { color: colors.dim, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  note: { color: colors.faint, fontSize: 12.5, textAlign: 'center', marginTop: 14 },
});
