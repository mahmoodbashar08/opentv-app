import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { Poster } from '@/components/poster';
import { NavHeader, Screen } from '@/components/ui';
import db, { getShowProgress, setFollowing, setShowArchived, setShowFavorited, setShowFinished, type ShowProgress } from '@/db';
import { tapLight } from '@/haptics';
import { showMeta } from '@/metadata';
import { DEFAULT_SHOW_FILTERS, setShowFilters, useShowFilters } from '@/filters-store';
import { airedTotalOf, progressColorOf, progressOf } from '@/show-status';
import { gridGeometry } from '@/pure';


// Progress classes, matching the sheet: All / Watching / Haven't started /
// Up to date / Finished / Stopped
function progressClass(sp: ShowProgress): number {
  if (sp.finished) return 4; // user manually marked complete
  if (sp.archived) return 5; // Stopped
  const seen = Math.max(sp.watched, sp.episodesSeen);
  if (seen === 0) return 2; // Haven't started
  const total = airedTotalOf(sp.tvdbId);
  if (total && seen >= total) {
    const m = showMeta(sp.tvdbId);
    const ended = m?.status === 'Ended' || m?.status === 'Canceled';
    const hasUnaired = (m?.totalEpisodes ?? 0) > total;
    return ended && !hasUnaired ? 4 : 3; // Finished : Up to date
  }
  return 1; // Watching
}
import { colors, radius, space } from '@/theme';

export default function AllShowsScreen() {
  // re-read on focus — a show deleted from its page must vanish on return
  const [tick, setTick] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setTick((t) => t + 1);
    }, []),
  );
  // filters are per-visit: opening the page fresh starts from the defaults
  const filters = useShowFilters();
  useEffect(() => {
    setShowFilters(DEFAULT_SHOW_FILTERS);
  }, []);
  // type-to-filter your own library by name, so a big collection is findable
  // without scrolling
  const [query, setQuery] = useState('');
  // the long-press manage sheet — the same actions the show page offers,
  // reachable without opening the show
  const [menu, setMenu] = useState<{ id: number; name: string } | null>(null);
  // the Filters sheet persists {sort, progress}; re-read on every focus so
  // APPLY takes effect the moment the sheet closes
  const shows = useMemo(() => {
    const f = filters;
    let list = getShowProgress();
    if (f.progress > 0) list = list.filter((sp) => progressClass(sp) === f.progress);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((sp) => sp.name.toLowerCase().includes(q));
    if (f.sort === 2) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (f.sort === 1) {
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
  }, [tick, filters, query]);

  const manageActions = (id: number, name: string): SheetAction[] => {
    const row = shows.find((r) => r.tvdbId === id);
    // ShowProgress doesn't carry the favorite flag — read it live so the label
    // says what tapping will actually do
    const fav =
      (db.getFirstSync<{ favorited: number }>('SELECT favorited FROM shows WHERE tvdbId = ?', [id])?.favorited ?? 0) === 1;
    const done = () => {
      setMenu(null);
      setTick((t) => t + 1);
    };
    return [
      {
        text: row?.followed ? 'Stop following' : 'Follow',
        icon: row?.followed ? 'bookmark' : 'bookmark-outline',
        onPress: () => {
          setFollowing(id, !row?.followed);
          done();
        },
      },
      {
        text: fav ? 'Remove from favorites' : 'Add to favorites',
        icon: fav ? 'heart' : 'heart-outline',
        onPress: () => {
          setShowFavorited(id, !fav);
          done();
        },
      },
      {
        text: 'Mark as finished',
        icon: 'checkmark-done-outline',
        onPress: () => {
          setShowFinished(id, true);
          done();
        },
      },
      {
        text: 'Stop watching',
        icon: 'eye-off-outline',
        destructive: true,
        onPress: () => {
          setShowArchived(id, true);
          setFollowing(id, false);
          done();
        },
      },
      {
        text: 'Open show',
        icon: 'open-outline',
        onPress: () => {
          setMenu(null);
          router.push(`/show/${id}`);
        },
      },
    ];
  };

  // columns follow the live viewport — 3 on a phone, up to 9 on a landscape iPad
  const cols = gridGeometry(useWindowDimensions().width, space.md, 3).cols;

  return (
    <Screen>
      <NavHeader title="Shows" right={<Ionicons name="eye-outline" size={20} color={colors.yellow} />} />
      <View style={styles.searchRow}>
        <Ionicons name="search" size={17} color={colors.faint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your shows"
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
          query.trim() ? <Text style={styles.empty}>No shows match “{query.trim()}”.</Text> : null
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
        <Text style={styles.filtersText}>Filters</Text>
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
});
