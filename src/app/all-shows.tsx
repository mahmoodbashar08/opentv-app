import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { Poster } from '@/components/poster';
import { NavHeader, Screen } from '@/components/ui';
import db, { getShowProgress, setFollowing, setShowArchived, setShowFavorited, setShowFinished } from '@/db';
import { tapLight } from '@/haptics';
import { showFacts } from '@/filter-facts';
import { useFilters } from '@/filters-store';
import { progressColorOf, progressOf } from '@/show-status';
import { activeFilterCount, gridGeometry, matchesFilters } from '@/pure';
import { colors, radius, space } from '@/theme';
import { t } from '@/i18n';

export default function AllShowsScreen() {
  // re-read on focus — a show deleted from its page must vanish on return.
  // The rows live in STATE, not a render-time read guarded by a counter: the
  // React Compiler memoises a render-time store read against its arguments and
  // the counter in the dependency list does not save it (see CLAUDE.md).
  const [rows, setRows] = useState(getShowProgress);
  const reload = useCallback(() => {
    setRows(getShowProgress());
  }, []);
  useFocusEffect(reload);
  // filters PERSIST now — they are read from meta on first use and survive a
  // relaunch, so the pill below carries a count and the sheet a loud RESET
  const filters = useFilters('show');
  // type-to-filter your own library by name, so a big collection is findable
  // without scrolling
  const [query, setQuery] = useState('');
  // the long-press manage sheet — the same actions the show page offers,
  // reachable without opening the show
  const [menu, setMenu] = useState<{ id: number; name: string } | null>(null);
  // TWO MEMOS, deliberately. Resolving the library's genres/networks/ratings
  // costs a metadata lookup per show, and typing in the search box must not pay
  // it on every keystroke — so the expensive half depends on (library, filters)
  // only, and the name match runs over the small result.
  const filtered = useMemo(() => {
    const facts = showFacts(rows);
    const list = rows.filter((_, i) => matchesFilters(facts[i], filters));
    if (filters.sort === 'alpha') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (filters.sort === 'lastAdded') {
      // last added: in-app adds carry addedAt; imported shows go after, A-Z
      list.sort(
        (a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? '') || a.name.localeCompare(b.name),
      );
    } else {
      list.sort(
        (a, b) =>
          (b.lastWatchedAt ?? '').localeCompare(a.lastWatchedAt ?? '') ||
          Math.max(b.watched, b.episodesSeen) - Math.max(a.watched, a.episodesSeen),
      );
    }
    return list;
  }, [rows, filters]);

  const shows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? filtered.filter((sp) => sp.name.toLowerCase().includes(q)) : filtered;
  }, [filtered, query]);

  const manageActions = (id: number, name: string): SheetAction[] => {
    const row = shows.find((r) => r.tvdbId === id);
    // ShowProgress doesn't carry the favorite flag — read it live so the label
    // says what tapping will actually do
    const fav =
      (db.getFirstSync<{ favorited: number }>('SELECT favorited FROM shows WHERE tvdbId = ?', [id])?.favorited ?? 0) === 1;
    const done = () => {
      setMenu(null);
      reload();
    };
    return [
      {
        text: row?.followed ? t('show.actions.stopFollowing') : t('show.actions.follow'),
        icon: row?.followed ? 'bookmark' : 'bookmark-outline',
        onPress: () => {
          setFollowing(id, !row?.followed);
          done();
        },
      },
      {
        text: fav ? t('media.actions.removeFavorite') : t('media.actions.addFavorite'),
        icon: fav ? 'heart' : 'heart-outline',
        onPress: () => {
          setShowFavorited(id, !fav);
          done();
        },
      },
      {
        text: t('show.actions.markFinished'),
        icon: 'checkmark-done-outline',
        onPress: () => {
          setShowFinished(id, true);
          done();
        },
      },
      {
        text: t('show.actions.stopWatching'),
        icon: 'eye-off-outline',
        destructive: true,
        onPress: () => {
          setShowArchived(id, true);
          setFollowing(id, false);
          done();
        },
      },
      {
        text: t('allShows.openShow'),
        icon: 'open-outline',
        onPress: () => {
          setMenu(null);
          router.push(`/show/${id}`);
        },
      },
    ];
  };

  const active = activeFilterCount(filters);
  // columns follow the live viewport — 3 on a phone, up to 9 on a landscape iPad
  const cols = gridGeometry(useWindowDimensions().width, space.md, 3).cols;

  return (
    <Screen>
      <NavHeader title={t('allShows.title')} right={<Ionicons name="eye-outline" size={20} color={colors.yellow} />} />
      <View style={styles.searchRow}>
        <Ionicons name="search" size={17} color={colors.faint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('allShows.searchPlaceholder')}
          placeholderTextColor={colors.faint}
          style={styles.searchInput}
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable hitSlop={8} onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={17} color={colors.faint} />
          </Pressable>
        )}
      </View>
      <FlatList
        // remount on a column change — FlatList cannot vary numColumns in place
        key={cols}
        data={shows}
        keyExtractor={(s) => String(s.tvdbId)}
        numColumns={cols}
        columnWrapperStyle={{ gap: 3 }}
        contentContainerStyle={{ padding: space.md, gap: 3, paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          query.trim() ? <Text style={styles.empty}>{t('allShows.noMatches', { query: query.trim() })}</Text> : null
        }
        renderItem={({ item, index }) => (
          <Pressable
            style={{ flex: 1 / cols }}
            onPress={() => router.push(`/show/${item.tvdbId}`)}
            // TV Time muscle memory: hold a poster to manage it without
            // opening the show first
            onLongPress={() => {
              tapLight();
              setMenu({ id: item.tvdbId, name: item.name });
            }}
            delayLongPress={300}>
            <Poster
              name={item.name}
              uri={item.posterUrl}
              progress={progressOf(item)}
              progressColor={progressColorOf(item)}
              animateProgress
              animationDelay={300 + Math.min(index, 12) * 45}
            />
          </Pressable>
        )}
      />
      <ActionSheet
        visible={menu != null}
        title={menu?.name ?? ''}
        actions={menu ? manageActions(menu.id, menu.name) : []}
        onClose={() => setMenu(null)}
      />
      <Pressable style={styles.filtersFab} onPress={() => router.push('/filters')}>
        <Ionicons name="options-outline" size={16} color={colors.onYellow} />
        <Text style={styles.filtersText}>{t('allShows.filters')}</Text>
        {/* filters outlive the visit now, so the pill has to say so — an
            invisible filter reads as a library that lost half its shows */}
        {active > 0 ? <Text style={styles.filtersBadge}>{active}</Text> : null}
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1B1B1E',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginHorizontal: space.md,
    marginTop: 2,
    marginBottom: 4,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, padding: 0 },
  empty: { color: colors.dim, fontSize: 14, textAlign: 'center', marginTop: 40 },
  filtersFab: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 13,
    paddingHorizontal: 24,
  },
  filtersText: { color: colors.onYellow, fontSize: 13, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  filtersBadge: {
    color: colors.yellow,
    backgroundColor: colors.onYellow,
    fontSize: 11,
    fontWeight: '800',
    minWidth: 18,
    textAlign: 'center',
    borderRadius: 9,
    paddingVertical: 1,
    paddingHorizontal: 5,
    overflow: 'hidden',
  },
});
