import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Poster } from '@/components/poster';
import { NavHeader, PillButton, Screen } from '@/components/ui';
import seed from '@/seed';
import { getFavoriteMovies, getFavoriteShows } from '@/db';
import { isSeedLibrary } from '@/library';
import { gridGeometry } from '@/pure';
import { colors, space } from '@/theme';

export default function FavoritesScreen() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const isShows = type === 'shows';
  const seedLib = isSeedLibrary();
  // re-read the DB whenever the screen regains focus: removing a favorite
  // happens in the show/movie modal that opens over this screen, so on
  // dismiss we must re-query or the removed item lingers until a full re-nav
  const [, setTick] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setTick((n) => n + 1);
    }, []),
  );
  const favShows = seedLib
    ? seed.favoriteShows
    : getFavoriteShows().map((s) => ({ tvdbId: s.tvdbId, name: s.name, poster: s.posterUrl }));
  const favMovies = seedLib ? seed.favoriteMovies.items : getFavoriteMovies();
  const items = isShows
    ? favShows.map((f) => ({ key: String(f.tvdbId), name: f.name, uri: f.poster }))
    : favMovies.map((m, i) => ({ key: `${m.name}-${i}`, name: m.name, uri: m.poster }));

  // columns follow the live viewport — 3 on a phone, up to 9 on a landscape iPad
  const cols = gridGeometry(useWindowDimensions().width, space.md, 3).cols;

  return (
    <Screen>
      <NavHeader />
      <View style={{ paddingHorizontal: space.lg, gap: 12, paddingBottom: 12 }}>
        <Text style={styles.title}>Favorite {isShows ? 'shows' : 'movies'}</Text>
        <PillButton label={`Add/remove ${isShows ? 'shows' : 'movies'}`} onPress={() => router.push('/lists/add-remove')} />
        <Text style={styles.sort}>
          SORT BY <Text style={{ color: colors.blue }}>User order</Text>
        </Text>
      </View>
      <FlatList
        // remount on a column change — FlatList cannot vary numColumns in place
        key={cols}
        data={items}
        keyExtractor={(it) => it.key}
        numColumns={cols}
        columnWrapperStyle={{ gap: 3 }}
        contentContainerStyle={{ paddingHorizontal: space.md, gap: 3, paddingBottom: 40 }}
        renderItem={({ item }) => (
          <Pressable
            style={{ flex: 1 / cols }}
            onPress={() =>
              router.push(isShows ? `/show/${item.key}` : `/movie/${encodeURIComponent(item.name)}`)
            }>
            <Poster name={item.name} uri={item.uri} />
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 24, fontWeight: '800' },
  sort: { color: colors.dim, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
});
