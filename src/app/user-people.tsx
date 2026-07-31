/**
 * Somebody else's followers, or who they follow.
 *
 * WHY IT EXISTS. A profile's count band has three numbers, and on your own
 * profile all three open: following, followers, comments. On somebody else's
 * they were dead text — you could read "12 following" and not find out who.
 * That is the same design behaving two ways depending on whose profile it is,
 * which is exactly what the shared profile template exists to prevent.
 *
 * EVERY REFUSAL IS THE SAME 404, as everywhere else in the community: a handle
 * that never existed, an account that deleted itself, one that blocked you and
 * one you blocked. A private profile you have not earned is a 403 and says so,
 * because being told "this is private" is not a leak — the profile's own shell
 * already said as much.
 *
 * A row opens that person's profile, so a follower list is walkable. There is
 * no Follow button on these rows: following from a list means the count beside
 * it disagrees with the button until the page is refetched, and the profile
 * behind the row is one tap away and always right.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text } from 'react-native';

import { ApiError } from '@/api';
import { fetchFollowers, fetchProfileFollowing, type ProfileEdge } from '@/community-profiles';
import { PersonRow } from '@/components/person-row';
import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { commentErrorKey } from '@/pure';
import { t } from '@/i18n';
import { colors } from '@/theme';

export default function UserPeopleScreen() {
  const { handle: raw, type } = useLocalSearchParams<{ handle?: string; type?: string }>();
  const handle = raw ?? '';
  const following = type === 'following';

  const [items, setItems] = useState<ProfileEdge[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const page = useCallback(
    (at: string | null) => (following ? fetchProfileFollowing(handle, at) : fetchFollowers(handle, at)),
    [following, handle],
  );

  useEffect(() => {
    let cancelled = false;
    void page(null)
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setCursor(res.next_cursor);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setItems([]);
        setError(t(commentErrorKey(e instanceof ApiError ? e.code : 'unknown')));
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  // Paged, not loaded whole: a popular account's followers are thousands of
  // rows and the count above already says how many.
  const more = () => {
    if (!cursor) return;
    const at = cursor;
    setCursor(null);
    void page(at)
      .then((res) => {
        setItems((prev) => [...(prev ?? []), ...res.items]);
        setCursor(res.next_cursor);
      })
      .catch(() => {});
  };

  return (
    <Screen>
      <NavHeader close title={t(following ? 'profile.statFollowing' : 'profile.statFollowers')} />
      {items === null ? (
        <ActivityIndicator style={styles.spinner} color={colors.dim} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          onEndReachedThreshold={0.5}
          onEndReached={more}
          ListEmptyComponent={<Text style={styles.empty}>{error ?? t('community.profile.peopleEmpty')}</Text>}
          renderItem={({ item }) => (
            <ContentColumn>
              <PersonRow
                person={item}
                onPress={() => router.push(`/profile/${encodeURIComponent(item.handle)}`)}
              />
            </ContentColumn>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: 60 },
  empty: { color: colors.dim, fontSize: 14.5, textAlign: 'center', marginTop: 50, paddingHorizontal: 40, lineHeight: 20 },
});
