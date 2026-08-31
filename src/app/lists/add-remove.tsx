import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { listsChanged } from '@/community-publish';
import db, {
  addToList,
  getCustomLists,
  getFavoriteMovies,
  getFavoriteShows,
  removeFromList,
  setMovieFavorite,
  setShowFavorited,
} from '@/db';
import { colors, space } from '@/theme';
import { t } from '@/i18n';

type Row = { kind: 'show' | 'movie'; name: string; poster: string | null; tvdbId?: number };

// search the user's own library (shows + movies) — a list organises what you track
function searchLibrary(q: string): Row[] {
  const like = `%${q}%`;
  const shows = db
    .getAllSync<{ tvdbId: number; name: string; posterUrl: string | null }>(
      'SELECT tvdbId, name, posterUrl FROM shows WHERE name LIKE ? ORDER BY name LIMIT 40',
      [like],
    )
    .map((s) => ({ kind: 'show' as const, name: s.name, poster: s.posterUrl, tvdbId: s.tvdbId }));
  const movies = db
    .getAllSync<{ name: string; poster: string | null }>(
      'SELECT name, poster FROM movies WHERE name LIKE ? ORDER BY name LIMIT 40',
      [like],
    )
    .map((m) => ({ kind: 'movie' as const, name: m.name, poster: m.poster }));
  return [...shows, ...movies];
}

export default function AddRemoveScreen() {
  /**
   * TWO SHELVES, ONE PICKER. With `name` this edits a custom list; with `fav`
   * it edits the favourites row.
   *
   * It used to be list-only, and the Favourites screen sent people here with
   * neither — landing them on a picker whose `toggle` began `if (!list) return`,
   * so every tap did nothing and the only way to add a favourite was to open
   * the show and find the heart.
   */
  const { name, fav } = useLocalSearchParams<{ name?: string; fav?: string }>();
  const listName = decodeURIComponent(name ?? '');
  const favKind: 'shows' | 'movies' | null = fav === 'shows' ? 'shows' : fav === 'movies' ? 'movies' : null;
  const [query, setQuery] = useState('');
  const [, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);
  useFocusEffect(useCallback(() => setTick((n) => n + 1), []));

  // The picker offers the whole library; a favourites shelf only takes its own
  // kind, so the other one is filtered out rather than offered and refused.
  const rows = searchLibrary(query.trim()).filter(
    (r) => favKind == null || (favKind === 'shows' ? r.kind === 'show' : r.kind === 'movie'),
  );
  const list = getCustomLists().find((l) => l.name === listName);

  const favourites = favKind === 'shows' ? getFavoriteShows() : favKind === 'movies' ? getFavoriteMovies() : [];
  const favSet = new Set(
    favKind === 'shows'
      ? (favourites as { tvdbId: number }[]).map((f) => `s:${f.tvdbId}`)
      : (favourites as { name: string }[]).map((f) => `m:${f.name}`),
  );
  const keyOf = (r: Row) => (r.kind === 'show' ? `s:${r.tvdbId}` : `m:${r.name}`);

  const inList = (r: Row) =>
    favKind ? favSet.has(keyOf(r)) : !!list?.items.some((it) => it.kind === r.kind && it.name === r.name);

  const toggle = (r: Row) => {
    if (favKind) {
      const on = inList(r);
      if (r.kind === 'show' && r.tvdbId != null) setShowFavorited(r.tvdbId, !on);
      else if (r.kind === 'movie') setMovieFavorite(r.name, !on);
      refresh();
      return;
    }
    if (!list) return;
    if (inList(r)) removeFromList(list.name, r.name);
    else addToList(list.name, { kind: r.kind, name: r.name, poster: r.poster, ...(r.tvdbId ? { tvdbId: r.tvdbId } : {}) });
    listsChanged();
    refresh();
  };

  return (
    <Screen>
      <NavHeader
        title={
          favKind === 'shows'
            ? t('profile.sectionFavoriteShows')
            : favKind === 'movies'
              ? t('profile.sectionFavoriteMovies')
              : listName || t('addToList.title')
        }
        right={
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={{ color: colors.blue, fontSize: 16, fontWeight: '700' }}>{t('common.done')}</Text>
          </Pressable>
        }
      />
      <ContentColumn>
        <View style={styles.searchLine}>
          <Ionicons name="search" size={17} color={colors.faint} />
          <TextInput
            style={styles.input}
            placeholder={t('listAddRemove.searchPlaceholder')}
            placeholderTextColor={colors.faint}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
        </View>
      </ContentColumn>
      <FlatList
        data={rows}
        keyExtractor={(r, i) => `${r.kind}-${r.name}-${i}`}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const on = inList(item);
          return (
            <Pressable style={styles.row} onPress={() => toggle(item)}>
              {item.poster ? (
                <Image source={{ uri: item.poster }} style={styles.thumb} contentFit="cover" cachePolicy="disk" />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]}>
                  <Text style={styles.initials}>{item.name.slice(0, 2).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.sub}>{item.kind === 'show' ? t('listAddRemove.kindSeries') : t('listAddRemove.kindMovie')}</Text>
              </View>
              <View style={[styles.badge, on && styles.badgeOn]}>
                <Ionicons name={on ? 'checkmark' : 'add'} size={18} color={on ? colors.onYellow : colors.text} />
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {query ? t('listAddRemove.emptyNoMatches') : t('listAddRemove.emptySearchToAdd')}
          </Text>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: 6,
    marginBottom: 6,
  },
  input: { color: colors.text, fontSize: 16, flex: 1, paddingVertical: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: space.lg,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1B1B1E',
  },
  thumb: { width: 42, height: 60, borderRadius: 4, backgroundColor: colors.card },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: colors.dim, fontWeight: '800', fontSize: 12 },
  name: { color: colors.text, fontSize: 15.5, fontWeight: '600' },
  sub: { color: colors.dim, fontSize: 12.5, marginTop: 1 },
  badge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: colors.faint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  empty: { color: colors.faint, fontSize: 13.5, textAlign: 'center', marginTop: 30, paddingHorizontal: space.lg },
});
