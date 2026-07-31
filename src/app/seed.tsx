/**
 * The archive moment: seven years of the user's own comments, offered to the
 * community, and the people they knew there.
 *
 * THE OFFER IS THE SCREEN. Nothing is uploaded by opening it, by joining, by
 * launching the app or by a migration — only by the button, tapped here, after
 * reading what it does. That is why the sentence about what is sent sits above
 * the button rather than in a policy: a promise made anywhere except at the
 * decision point is marketing.
 *
 * IT IS ALSO REACHABLE FOREVER. Settings → Account → Community keeps a row, so
 * "Not now" costs nothing and changing your mind next year costs one tap. The
 * server dedupes by content, so running it again is a no-op rather than a
 * duplicate.
 *
 * RECONNECTION RUNS ON ITS OWN and is not a button, because it is not the same
 * kind of act: it sends numeric ids from the user's own export and gets back the
 * handles of people holding the matching id. Nothing of the library goes with
 * it. The matches appear below when there are any, and never as an empty state
 * — "0 of your friends are here" is a sentence nobody needs read to them.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  countSeedableComments,
  lastFriendMatches,
  maybeReconcileFriends,
  seedComments,
  type FriendMatch,
  type SeedResult,
} from '@/community-seed';
import { PersonRow } from '@/components/person-row';
import { ContentColumn, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { communityErrorKey, seedSummary } from '@/pure';
import { colors, radius, space } from '@/theme';

type Phase = 'offer' | 'running' | 'finished';

export default function SeedScreen() {
  const insets = useSafeAreaInsets();
  // Read once. The count cannot change while this screen is up, and re-reading
  // it every render would make the headline flicker as rows are seeded.
  const [total] = useState(() => countSeedableComments());
  const [phase, setPhase] = useState<Phase>(total > 0 ? 'offer' : 'finished');
  const [sent, setSent] = useState(0);
  const [result, setResult] = useState<SeedResult | null>(null);
  const [friends, setFriends] = useState<FriendMatch[]>(lastFriendMatches);

  // Reconnection starts with the screen and is never awaited by anything the
  // user is looking at. `mounted` guards the late resolve — a reconcile of
  // 5,000 ids outlives a swipe-down easily.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void maybeReconcileFriends().then((matched) => {
      if (mounted.current && matched.length > 0) setFriends(matched);
    });
    return () => {
      mounted.current = false;
    };
  }, []);

  const bring = () => {
    if (phase === 'running') return;
    tapLight();
    setPhase('running');
    setSent(0);
    void seedComments((p) => {
      if (mounted.current) setSent(p.done);
    }).then((res) => {
      if (!mounted.current) return;
      setResult(res);
      setPhase('finished');
    });
  };

  const close = () => {
    tapLight();
    router.back();
  };

  const summary = result ? seedSummary(result) : null;
  const percent = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;

  return (
    <Screen>
      <ContentColumn style={styles.fill}>
        <FlatList
          // A FlatList and not a ScrollView because the matched-friends list is
          // unbounded — someone with 400 TV Time friends who all joined would
          // otherwise mount 400 rows at once. The offer and the result ride in
          // the header, so there is exactly one scrolling surface on the screen.
          data={friends}
          keyExtractor={(f) => f.handle}
          contentContainerStyle={{ paddingBottom: space.xl }}
          ListHeaderComponent={
            <View style={styles.head}>
              <Text style={styles.emoji}>🗂️</Text>
              <Text style={styles.title}>{t('community.seed.title')}</Text>

              {phase === 'offer' && (
                <>
                  <Text style={styles.sub}>{t('community.seed.count', { count: total })}</Text>
                  <Text style={styles.ask}>{t('community.seed.ask')}</Text>
                  <View style={styles.promiseBox}>
                    <Text style={styles.promise}>{t('community.seed.onlyYours')}</Text>
                    <Text style={styles.promise}>{t('community.seed.datesKept')}</Text>
                  </View>
                </>
              )}

              {phase === 'running' && (
                <View style={styles.progressBox}>
                  <Text style={styles.sub}>{t('community.seed.working')}</Text>
                  <View style={styles.track}>
                    <View style={[styles.bar, { width: `${percent}%` }]} />
                  </View>
                  <Text style={styles.progressText}>
                    {t('community.seed.progress', { done: Math.min(sent, total), total })}
                  </Text>
                </View>
              )}

              {phase === 'finished' && (
                <View style={styles.resultBox}>
                  {summary ? (
                    <>
                      <Ionicons
                        name={result?.finished ? 'checkmark-circle' : 'alert-circle'}
                        size={34}
                        color={result?.finished ? colors.green : colors.yellow}
                      />
                      {/* The honest sentence. Four endings, never a bare tick —
                          see `seedSummary` in pure.ts for why. */}
                      <Text style={styles.sub}>{t(summary.key, summary.params)}</Text>
                      {!result?.finished && (
                        <Text style={styles.interrupted}>
                          {t('community.seed.interrupted')}
                          {result?.error ? ` ${t(communityErrorKey(result.error))}` : ''}
                        </Text>
                      )}
                    </>
                  ) : (
                    <Text style={styles.sub}>{t('community.seed.nothingToBring')}</Text>
                  )}
                </View>
              )}

              {friends.length > 0 && (
                <Text style={styles.friendsTitle}>
                  {t('community.seed.friendsFound', { count: friends.length })}
                </Text>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <PersonRow
              person={{ handle: item.handle, display_name: item.display_name, avatar_key: item.avatar_key }}
              onPress={() => router.push(`/profile/${item.handle}`)}
            />
          )}
        />

        <View style={[styles.actions, { paddingBottom: space.sm + insets.bottom }]}>
          {phase === 'offer' && (
            <>
              <Pressable style={styles.cta} onPress={bring}>
                <Text style={styles.ctaText}>{t('community.seed.bring')}</Text>
              </Pressable>
              <Pressable style={styles.later} onPress={close} hitSlop={12}>
                <Text style={styles.laterText}>{t('community.seed.notNow')}</Text>
              </Pressable>
            </>
          )}

          {phase === 'running' && (
            <View style={styles.cta}>
              <ActivityIndicator color={colors.onYellow} />
            </View>
          )}

          {phase === 'finished' && (
            <>
              {result && !result.finished && (
                <Pressable style={styles.cta} onPress={bring}>
                  <Text style={styles.ctaText}>{t('community.seed.tryAgain')}</Text>
                </Pressable>
              )}
              <Pressable style={styles.later} onPress={close} hitSlop={12}>
                <Text style={styles.laterText}>{t('community.seed.close')}</Text>
              </Pressable>
            </>
          )}
        </View>
      </ContentColumn>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: space.xl },
  head: { gap: 12, paddingTop: space.xl, paddingBottom: space.lg },
  emoji: { fontSize: 44, textAlign: 'center' },
  title: { color: colors.text, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  sub: { color: colors.dim, fontSize: 15.5, textAlign: 'center', lineHeight: 22 },
  ask: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  promiseBox: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: space.lg,
    gap: 8,
    marginTop: 4,
  },
  promise: { color: colors.faint, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  progressBox: { gap: 12, marginTop: 6 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.card, overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.yellow },
  progressText: { color: colors.faint, fontSize: 13, textAlign: 'center' },
  resultBox: { alignItems: 'center', gap: 10, marginTop: 6 },
  interrupted: { color: colors.faint, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  friendsTitle: {
    color: colors.text,
    fontSize: 15.5,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: space.lg,
  },
  actions: { gap: 8 },
  cta: {
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaText: { color: colors.onYellow, fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },
  later: { paddingVertical: 12, alignItems: 'center' },
  laterText: { color: colors.dim, fontSize: 15, fontWeight: '600' },
});
