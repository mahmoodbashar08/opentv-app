/**
 * One shelf of somebody else's profile, in full — the `›` destination.
 *
 * YOUR profile's shelves each have an arrow: Shows opens the whole library,
 * Favorite shows opens all the favourites. Somebody else's had no arrows at
 * all, because there was nowhere for them to go — which is exactly what made
 * the two screens read as different designs rather than one design with two
 * sets of data. This is where they go.
 *
 * It reads the SAME published shelves the profile does, so there is no second
 * source of truth and nothing extra for the server to serve: the four rails
 * and these four grids are the same rows, drawn at two sizes.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, useWindowDimensions } from 'react-native';

import { Poster } from '@/components/poster';
import { NavHeader, Screen } from '@/components/ui';
import { fetchPublishedProfile, type PublishedProfile, type PublishedTitle } from '@/community-profiles';
import { gridGeometry } from '@/pure';
import { colors, space } from '@/theme';
import { t } from '@/i18n';
import type { LocaleKey } from '@/locales/keys';

/** Which shelf — the same four the profile draws, in the same order. */
type Kind = 'shows' | 'fav-shows' | 'movies' | 'fav-movies';

const TITLE_KEY = {
  shows: 'stats.headers.shows',
  'fav-shows': 'profile.sectionFavoriteShows',
  movies: 'stats.headers.movies',
  'fav-movies': 'profile.sectionFavoriteMovies',
} as const satisfies Record<Kind, LocaleKey>;

function shelfOf(pub: PublishedProfile, kind: Kind): PublishedTitle[] {
  const rows = kind === 'shows' || kind === 'fav-shows' ? pub.shows : pub.movies;
  return kind.startsWith('fav-') ? rows.filter((x) => x.favourite) : [...rows];
}

/** A show opens by id; a film opens by the name it was published under. */
function openTitle(x: PublishedTitle, kind: Kind): void {
  if (kind === 'shows' || kind === 'fav-shows') {
    const id = Number(x.target_key);
    if (id > 0) router.push(`/show/${id}`);
    return;
  }
  const name = x.name ?? x.target_key.split('|')[0]?.replace(/-/g, ' ') ?? '';
  if (name) router.push(`/movie/${encodeURIComponent(name)}`);
}

export default function UserTitlesScreen() {
  const { handle: raw, kind: rawKind } = useLocalSearchParams<{ handle?: string; kind?: string }>();
  const handle = raw ?? '';
  const kind: Kind =
    rawKind === 'fav-shows' || rawKind === 'movies' || rawKind === 'fav-movies' ? rawKind : 'shows';

  const [pub, setPub] = useState<PublishedProfile | null>(null);
  const { width } = useWindowDimensions();
  const { cols } = gridGeometry(width, space.md, 3);

  useEffect(() => {
    let cancelled = false;
    void fetchPublishedProfile(handle).then((p) => {
      if (!cancelled) setPub(p);
    });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  return (
    <Screen>
      <NavHeader close title={t(TITLE_KEY[kind])} />
      {pub === null ? (
        <ActivityIndicator style={styles.spinner} color={colors.dim} />
      ) : (
        <FlatList
          // remount on a column change — FlatList cannot vary numColumns in place
          key={cols}
          data={shelfOf(pub, kind)}
          keyExtractor={(x) => x.target_key}
          numColumns={cols}
          columnWrapperStyle={{ gap: 3 }}
          contentContainerStyle={{ padding: space.md, gap: 3, paddingBottom: 60 }}
          renderItem={({ item }) => (
            <Pressable style={{ flex: 1 / cols }} onPress={() => openTitle(item, kind)}>
              <Poster name={item.name ?? ''} uri={item.poster} />
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: 60 },
});
