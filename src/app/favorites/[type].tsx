import { router, useLocalSearchParams } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Poster } from '@/components/poster';
import { NavHeader, PillButton, Screen } from '@/components/ui';
import seed from '@/seed';
import { getFavoriteMovies, getFavoriteShows } from '@/db';
import { isSeedLibrary } from '@/library';
import { colors, space } from '@/theme';

export default function FavoritesScreen() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const isShows = type === 'shows';
  const seedLib = isSeedLibrary();
  const favShows = seedLib
    ? seed.favoriteShows
    : getFavoriteShows().map((s) => ({ tvdbId: s.tvdbId, name: s.name, poster: s.posterUrl }));
  const favMovies = seedLib ? seed.favoriteMovies.items : getFavoriteMovies();
  const items = isShows
    ? favShows.map((f) => ({ key: String(f.tvdbId), name: f.name, uri: f.poster }))
    : favMovies.map((m, i) => ({ key: `${m.name}-${i}`, name: m.name, uri: m.poster }));

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
        data={items}
        keyExtractor={(it) => it.key}
        numColumns={3}
        columnWrapperStyle={{ gap: 3 }}
        contentContainerStyle={{ paddingHorizontal: space.md, gap: 3, paddingBottom: 40 }}
        renderItem={({ item }) => (
          <Pressable
            style={{ flex: 1 / 3 }}
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
