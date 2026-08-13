/**
 * Who has asked to follow you.
 *
 * THE OTHER HALF OF A PRIVATE ACCOUNT. Switching the curtain on without this
 * screen would be a trap: every follow becomes a request, requests pile up on
 * the server, and the person who set the switch has no way to let anybody in.
 * The two shipped together on purpose.
 *
 * OPTIMISTIC, LIKE `toggleFollow`. The row leaves the list the moment Accept or
 * Deny is tapped and comes back if the server refuses — same contract as the
 * follow button, because these are the same kind of act: a social decision that
 * must feel instant and must never quietly not happen.
 *
 * A 404 IS NOT A FAILURE HERE. It means the row is already gone — they
 * cancelled, or another device answered — so the row stays gone and nothing is
 * said. Restoring it would put a decision back in front of somebody who has no
 * decision left to make.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api';
import { communityErrorText } from '@/community-error-text';
import { answerFollowRequest, fetchFollowRequests, type FollowRequest } from '@/community-profiles';
import { PersonRow } from '@/components/person-row';
import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { colors, radius } from '@/theme';

export default function FollowRequestsScreen() {
  const [items, setItems] = useState<FollowRequest[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // ON FOCUS, not on mount: the row that leads here shows a count, and coming
  // back to a list that disagrees with the number that sent you is worse than
  // one extra request.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void fetchFollowRequests().then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.next_cursor);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const more = () => {
    if (cursor == null) return;
    const at = cursor;
    setCursor(null);
    void fetchFollowRequests(at).then((page) => {
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setCursor(page.next_cursor);
    });
  };

  const answer = async (person: FollowRequest, action: 'accept' | 'deny') => {
    if (busy != null) return;
    tapLight();
    setBusy(person.id);
    setItems((prev) => (prev ?? []).filter((x) => x.id !== person.id));
    try {
      await answerFollowRequest(person.id, action);
    } catch (e) {
      // Already answered elsewhere — leave it gone. Anything else is a real
      // failure and the row goes back where it was.
      if (e instanceof ApiError && e.code === 'not_found') return;
      setItems((prev) => [person, ...(prev ?? [])]);
      Alert.alert(t('community.followRequests.failedTitle'), communityErrorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <NavHeader close title={t('community.followRequests.title')} />
      {items === null ? (
        <ActivityIndicator style={styles.spinner} color={colors.dim} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          onEndReachedThreshold={0.5}
          onEndReached={more}
          ListEmptyComponent={<Text style={styles.empty}>{t('community.followRequests.empty')}</Text>}
          renderItem={({ item }) => (
            <ContentColumn>
              <PersonRow
                person={item}
                onPress={() => router.push(`/profile/${encodeURIComponent(item.handle)}`)}
                right={
                  <View style={styles.actions}>
                    {/* DENY FIRST AND QUIET, ACCEPT SECOND AND YELLOW. The
                        destructive half of a pair should never be the one the
                        thumb lands on by habit, and yellow acts in this app. */}
                    <Pressable
                      hitSlop={6}
                      style={styles.deny}
                      onPress={() => void answer(item, 'deny')}
                      accessibilityRole="button">
                      <Text style={styles.denyText}>{t('community.followRequests.deny')}</Text>
                    </Pressable>
                    <Pressable
                      hitSlop={6}
                      style={styles.accept}
                      onPress={() => void answer(item, 'accept')}
                      accessibilityRole="button">
                      <Text style={styles.acceptText}>{t('community.followRequests.accept')}</Text>
                    </Pressable>
                  </View>
                }
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
  empty: {
    color: colors.dim,
    fontSize: 14.5,
    textAlign: 'center',
    marginTop: 50,
    paddingHorizontal: 40,
    lineHeight: 20,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  accept: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.yellow,
  },
  acceptText: { color: colors.onYellow, fontWeight: '800', fontSize: 12.5 },
  deny: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.raise,
  },
  denyText: { color: colors.dim, fontWeight: '800', fontSize: 12.5 },
});
