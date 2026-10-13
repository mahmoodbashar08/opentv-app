/**
 * The Explore "Activity" pill: the friends feed (2.0.0, DESIGN-community §1.2).
 *
 * FOUR STATES, and only the last one ever talks to the server:
 *   1. not a member      → the join card (nothing is requested)
 *   2. follows nobody    → "Follow people…" → Find people
 *   3. nothing this week → the empty state (D2's copy)
 *   4. the feed          → cards, pull to refresh, older pages on scroll
 *
 * Long-press a card: Report (comments only — a rating has no words to report;
 * report the person from their profile), Block, Unfollow. All three are the
 * calls the comment threads and profiles already make.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, View } from 'react-native';

import { ApiError } from '@/api';
import { track } from '@/analytics';
import { blockProfile, reportComment } from '@/community-comments';
import { useFeed, type FeedCardModel } from '@/community-feed';
import { unfollow } from '@/community-profiles';
import { useJoined } from '@/community-session';
import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { FeedCard } from '@/components/feed-card';
import { ContentColumn, EmptyState } from '@/components/ui';
import { feedRoute } from '@/feed-pure';
import { tapSelection } from '@/haptics';
import { t } from '@/i18n';
import { commentErrorKey, movieRoute, REPORT_REASONS, reportReasonKey } from '@/pure';
import { colors } from '@/theme';

function errorText(e: unknown): string {
  return t(commentErrorKey(e instanceof ApiError ? e.code : 'unknown'));
}

function open(card: FeedCardModel): void {
  const { item, locked } = card;
  // Shape only: whether it was locked and what kind of card. Never who, never which title.
  track('feed_card_tap', { locked: locked ? 1 : 0, kind: item.kind });
  const route = feedRoute(item, locked);
  if (route) {
    router.push(route as never);
    return;
  }
  // A film: its page is found by name. Locked or not it is the same page — a
  // film has no episode to protect, and its own comments carry their own curtains.
  if (item.target_source === 'title') router.push(movieRoute(card.filmName ?? card.label) as never);
}

export function FeedList() {
  const joined = useJoined();
  if (!joined) {
    return (
      <EmptyState
        title={t('feed.joinTitle')}
        caption={t('feed.joinCaption')}
        cta={t('comments.joinCta')}
        onPress={() => router.push('/join')}
      />
    );
  }
  return <JoinedFeed />;
}

function JoinedFeed() {
  const feed = useFeed();
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const [menuFor, setMenuFor] = useState<FeedCardModel | null>(null);
  const [reportFor, setReportFor] = useState<string | null>(null);
  // One clock per render of the list, so every card agrees on what "2h" means.
  const [now, setNow] = useState(() => Date.now());
  const { refresh: refreshFeed, forget } = feed;

  // Once per opening of the pill. Shape only: no count, no handle, no title.
  useEffect(() => track('feed_open'), []);

  const refresh = useCallback(() => {
    setNow(Date.now());
    refreshFeed();
  }, [refreshFeed]);

  const reveal = useCallback((id: string) => setRevealed((r) => new Set(r).add(id)), []);
  const more = useCallback((card: FeedCardModel) => {
    tapSelection();
    setMenuFor(card);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: FeedCardModel }) => (
      <FeedCard card={item} now={now} revealed={revealed} onPress={open} onMore={more} onReveal={reveal} />
    ),
    [now, revealed, more, reveal],
  );

  const menuActions = useMemo((): SheetAction[] => {
    if (!menuFor) return [];
    const actor = menuFor.item.actor;
    const item = menuFor.item;
    const actions: SheetAction[] = [];
    if (item.kind === 'comment') {
      actions.push({ text: t('community.comments.report'), icon: 'flag-outline', onPress: () => setReportFor(item.comment_id) });
    }
    actions.push({
      text: t('feed.unfollow'),
      icon: 'person-remove-outline',
      onPress: () => {
        void unfollow(actor.id)
          .then(() => forget(actor.id))
          .catch((e: unknown) => Alert.alert(t('community.comments.failedTitle'), errorText(e)));
      },
    });
    actions.push({
      text: t('community.comments.block'),
      icon: 'ban-outline',
      destructive: true,
      onPress: () =>
        // Confirmed first: it is not undone from here and it drops the follow both ways.
        Alert.alert(t('community.block.title', { handle: actor.handle }), t('community.block.body'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('community.block.confirm'),
            style: 'destructive',
            onPress: () => {
              void blockProfile(actor.id)
                .then(() => forget(actor.id))
                .catch((e: unknown) => Alert.alert(t('community.block.failedTitle'), errorText(e)));
            },
          },
        ]),
    });
    return actions;
  }, [menuFor, forget]);

  const reportActions = useMemo(
    (): SheetAction[] =>
      reportFor == null
        ? []
        : REPORT_REASONS.map((reason) => ({
            text: t(reportReasonKey(reason)),
            icon: 'alert-circle-outline' as const,
            onPress: () => {
              void reportComment(reportFor, reason)
                // 202 — filed, not judged. The words say so.
                .then(() => Alert.alert(t('community.report.sentTitle'), t('community.report.sentBody')))
                .catch((e: unknown) => Alert.alert(t('community.report.failedTitle'), errorText(e)));
            },
          })),
    [reportFor],
  );

  if (!feed.ready) {
    return (
      <View style={{ paddingTop: 80, alignItems: 'center' }}>
        <ActivityIndicator color={colors.yellow} />
      </View>
    );
  }

  const empty = !feed.followsAnyone ? (
    <EmptyState
      title={t('feed.noFollowsTitle')}
      caption={t('feed.noFollowsCaption')}
      cta={t('profileMenu.findPeople')}
      onPress={() => router.push('/find-people')}
    />
  ) : (
    <EmptyState title={t('explore.noActivityTitle')} caption={t('explore.noActivityCaption')} />
  );

  return (
    // Capped like the Feed pill, so an iPad stays one readable column.
    <ContentColumn style={{ flex: 1 }}>
      <FlatList
        data={feed.cards}
        keyExtractor={(c) => c.item.id}
        renderItem={renderItem}
        extraData={revealed}
        ListEmptyComponent={empty}
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={refresh} tintColor={colors.yellow} />}
        onEndReached={feed.more ? feed.loadMore : undefined}
        onEndReachedThreshold={0.5}
      />
      <ActionSheet visible={menuFor != null} title={menuFor ? `@${menuFor.item.actor.handle}` : undefined} actions={menuActions} onClose={() => setMenuFor(null)} />
      <ActionSheet
        visible={reportFor != null}
        title={t('community.report.title')}
        actions={reportActions}
        onClose={() => setReportFor(null)}
      />
    </ContentColumn>
  );
}
