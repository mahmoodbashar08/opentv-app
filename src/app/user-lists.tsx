/**
 * Somebody else's lists — the SAME screen as your own, minus everything that
 * would change them.
 *
 * WHY IT EXISTS. A profile's Lists band draws one list, and the heading's › had
 * nowhere to send anybody: there was a screen for a single list and none for the
 * set. A person with a dozen lists showed one of them and gave no sign the rest
 * were there — the same shape of bug the owner's own profile had before
 * `/lists` was reachable from it.
 *
 * IT LOOKS LIKE YOURS ON PURPOSE. `ListCollage` is the component `/lists` draws,
 * so a list is a band of posters with its name across it in both places. What a
 * visitor does not get: Create, the ⋯ menu, the sort control and the drag.
 * Nothing here is theirs to change.
 *
 * EVERY LIST'S POSTERS COST A REQUEST. The index endpoint returns names and
 * counts, not contents, so the artwork is fetched per list. They go out together
 * and each band fills in as it lands, rather than holding the screen blank until
 * the slowest one returns.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { fetchList, fetchProfileLists, type PublishedList } from '@/community-profiles';
import { fetchSharedList } from '@/community-shared-lists';
import { ListCollage, type CollageList } from '@/components/list-collage';
import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { t } from '@/i18n';
import { TABLET_MIN_W } from '@/pure';
import { colors, space } from '@/theme';

/** Four tiles across on a phone, eight on a tablet — as `/lists` does it. */
const tileCols = (w: number) => (w >= TABLET_MIN_W ? 8 : 4);
const tileWidth = (w: number) => (w - 2 * 12 - (tileCols(w) - 1) * 2) / tileCols(w);

export default function UserListsScreen() {
  const { handle: raw } = useLocalSearchParams<{ handle?: string }>();
  const handle = raw ?? '';
  const { width } = useWindowDimensions();
  const TILE_W = tileWidth(width);
  const COLS = tileCols(width);

  const [lists, setLists] = useState<PublishedList[] | null>(null);
  /** Posters per list id, filled in as each detail lands. */
  const [covers, setCovers] = useState<Record<string, CollageList['items']>>({});

  useEffect(() => {
    let cancelled = false;
    void fetchProfileLists(handle)
      .then((items) => {
        if (cancelled) return;
        setLists(items);
        // Only lists that have something to show — a request per empty list is
        // a request for an empty array.
        for (const l of items.filter((x) => x.item_count > 0)) {
          // A shared list's contents come from the other route — same shape of
          // answer, different table behind it.
          void (l.shared ? fetchSharedList(l.id).then((d) => ({ items: d.items })) : fetchList(l.id))
            .then((detail) => {
              if (cancelled) return;
              setCovers((prev) => ({
                ...prev,
                [l.id]: detail.items.map((it) => ({ name: it.title ?? '', poster: it.poster })),
              }));
            })
            .catch(() => {
              // One list's artwork failing leaves that band as a named card,
              // which is still the list.
            });
        }
      })
      .catch(() => {
        if (!cancelled) setLists([]);
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  return (
    <Screen>
      <NavHeader title={t('profile.sectionLists')} close />
      {lists === null ? (
        <ActivityIndicator style={styles.spinner} color={colors.dim} />
      ) : (
        <FlatList
          data={lists}
          keyExtractor={(l) => l.id}
          contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}
          ListEmptyComponent={
            <ContentColumn>
              <View style={styles.empty}>
                <Ionicons name="albums-outline" size={34} color={colors.faint} />
                <Text style={styles.emptyText}>{t('community.list.none')}</Text>
              </View>
            </ContentColumn>
          }
          renderItem={({ item }) => (
            <View style={{ marginBottom: 12 }}>
              <ListCollage
                // `cover_url` is undefined until the server carries it, and an
                // absent cover is the collage this screen has always drawn.
                list={{ name: item.name, coverUrl: item.cover_url ?? null, items: covers[item.id] }}
                cols={COLS}
                tileW={TILE_W}
                // Two kinds of list, two screens. `/list/[id]` reads a
                // published copy of one person's list; a shared one is live and
                // has members, so it opens where its members open it.
                onPress={() =>
                  router.push(
                    item.shared
                      ? `/shared/${encodeURIComponent(item.id)}`
                      : `/list/${encodeURIComponent(item.id)}`,
                  )
                }
              />
            </View>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: 60 },
  empty: { alignItems: 'center', gap: 12, marginTop: 70, paddingHorizontal: space.xl },
  emptyText: { color: colors.dim, fontSize: 15, textAlign: 'center' },
});
