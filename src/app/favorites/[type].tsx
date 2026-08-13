import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedRef, useScrollViewOffset } from 'react-native-reanimated';

import { Poster } from '@/components/poster';
import { SortablePosterGrid } from '@/components/sortable-poster-grid';
import { NavHeader, PillButton, Screen } from '@/components/ui';
import seed from '@/seed';
import { getFavoriteMovies, getFavoriteShows, setFavoriteOrder, type CustomListItem } from '@/db';
import { isSeedLibrary } from '@/library';
import { track } from '@/analytics';
import { tapLight } from '@/haptics';
import { usePlus, requirePlus } from '@/plus';
import { PROFILE_FAVOURITE_LIMIT, gridGeometry, publishCapHit } from '@/pure';
import { useJoined } from '@/community-session';
import { colors, space } from '@/theme';
import { t } from '@/i18n';

export default function FavoritesScreen() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const isShows = type === 'shows';
  const seedLib = isSeedLibrary();
  const joined = useJoined();
  // re-read the DB whenever the screen regains focus: removing a favorite
  // happens in the show/movie modal that opens over this screen, so on
  // dismiss we must re-query or the removed item lingers until a full re-nav
  const [, setTick] = useState(0);
  const [dragging, setDragging] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setTick((n) => n + 1);
    }, []),
  );
  // scroll ref + live offset drive the grid's drag-to-edge auto-scroll
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useScrollViewOffset(scrollRef);

  const favShows = seedLib
    ? seed.favoriteShows
    : getFavoriteShows().map((s) => ({ tvdbId: s.tvdbId, name: s.name, poster: s.posterUrl }));
  const favMovies = seedLib ? seed.favoriteMovies.items : getFavoriteMovies();
  // One shape for both, so the sortable grid does not need to know which tab
  // it is on. `tvdbId` is what identifies a show; a film has only its name.
  const items: CustomListItem[] = isShows
    ? favShows.map((f) => ({ kind: 'show', name: f.name, poster: f.poster, tvdbId: f.tvdbId }))
    : favMovies.map((m) => ({ kind: 'movie', name: m.name, poster: m.poster }));

  // columns follow the live viewport — 3 on a phone, up to 9 on a landscape iPad
  const cols = gridGeometry(useWindowDimensions().width, space.md, 3).cols;

  // The faded tiles only mean anything to somebody who has a profile for them
  // to be missing from, and only when there are actually more than fit — which
  // for Plus is never, because all of them are published.
  const plus = usePlus();
  const overLimit = joined && !seedLib && publishCapHit(plus, items.length, PROFILE_FAVOURITE_LIMIT);

  const open = (item: CustomListItem) =>
    router.push(item.tvdbId ? `/show/${item.tvdbId}` : `/movie/${encodeURIComponent(item.name)}`);

  const reorder = (ordered: CustomListItem[]) => {
    setFavoriteOrder(
      isShows ? 'show' : 'movie',
      ordered.map((it) => (isShows ? (it.tvdbId as number) : it.name)),
    );
    setTick((n) => n + 1);
  };

  return (
    <Screen>
      <NavHeader
        right={
          seedLib || items.length < 2 ? undefined : (
            <Pressable hitSlop={8} onPress={() => setDragging((d) => !d)}>
              <Text style={{ color: colors.blue, fontSize: 15.5, fontWeight: dragging ? '700' : '600' }}>
                {dragging ? t('common.done') : t('favorites.reorder')}
              </Text>
            </Pressable>
          )
        }
      />
      <View style={{ paddingHorizontal: space.lg, gap: 12, paddingBottom: 12 }}>
        <Text style={styles.title}>{isShows ? t('profile.sectionFavoriteShows') : t('profile.sectionFavoriteMovies')}</Text>
        <PillButton
          label={isShows ? t('favorites.addRemoveShows') : t('favorites.addRemoveMovies')}
          onPress={() => router.push(`/lists/add-remove?fav=${isShows ? 'shows' : 'movies'}`)}
        />
        <Text style={styles.sort}>
          {dragging ? (
            t('favorites.dragHint')
          ) : (
            <>
              {t('favorites.sortBy')} <Text style={{ color: colors.blue }}>{t('favorites.userOrder')}</Text>
            </>
          )}
        </Text>
        {/* Only says anything when it is actually true of THIS shelf, and only
            to somebody with a profile for it to be true of. A cap explained to
            a person who has 6 favourites and no account is a rule invented for
            no one. */}
        {overLimit ? (
          <Pressable
            onPress={() => {
              tapLight();
              track('publish_cap_hit', { kind: 'favourites' });
              requirePlus('publish_lists');
            }}>
            <Text style={styles.cap}>
              {t('plus.lists.favouritesCap', { count: PROFILE_FAVOURITE_LIMIT })}{' '}
              <Text style={styles.upsell}>{t('plus.lists.publishAll')}</Text>
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* Scrolling stays on IN REORDER MODE TOO. The grid picks a poster up only
          after a 220ms hold, so a flick still scrolls — freezing the list was
          never needed, and it made a long shelf impossible to rearrange past
          the first screen. */}
      {seedLib ? (
        <FlatList
          // remount on a column change — FlatList cannot vary numColumns in place
          key={cols}
          data={items}
          keyExtractor={(it, i) => `${it.name}-${i}`}
          numColumns={cols}
          columnWrapperStyle={{ gap: 3 }}
          contentContainerStyle={{ paddingHorizontal: space.md, gap: 3, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <Pressable style={{ flex: 1 / cols }} onPress={() => open(item)}>
              <Poster name={item.name} uri={item.poster} />
            </Pressable>
          )}
        />
      ) : (
        <Animated.ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: 40 }}>
          <SortablePosterGrid
            items={items}
            editing={false}
            draggable={dragging}
            publicLimit={overLimit ? PROFILE_FAVOURITE_LIMIT : undefined}
            publicLimitLabel={t('favorites.notOnProfile')}
            onOpen={open}
            onRemove={() => {}}
            onReorder={reorder}
            scrollRef={scrollRef}
            scrollY={scrollY}
          />
        </Animated.ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 24, fontWeight: '800' },
  sort: { color: colors.dim, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  cap: { color: colors.faint, fontSize: 12.5, lineHeight: 17 },
  upsell: { color: colors.yellow, fontWeight: '700' },
});
