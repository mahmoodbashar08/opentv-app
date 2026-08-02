/**
 * A LIST OF COMMENT CARDS — the owner's screen and a public profile's feed.
 *
 * The page around it stays with each route: `comments.tsx` is pushed under a
 * `NavHeader`, `user-comments.tsx` is a sheet with a chevron, and their menus
 * differ (delete and share for your own, report and block for someone else's).
 * What is shared is everything between the header and the sheet — the sort line,
 * the list itself, the empty state, and the cards.
 *
 * THE FLATLIST TUNING IS NOT INCIDENTAL. `initialNumToRender`, `windowSize` and
 * `removeClippedSubviews` are what stopped a library of thousands of comments,
 * many of them GIFs, locking the screen while every card mounted at once. They
 * move with the list rather than being re-derived per screen, because a screen
 * that forgets them looks fine until someone with a real archive opens it.
 */
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { CommentCard, type CommentCardProps } from '@/components/comment-card';
import { CONTENT_MAX_WIDTH, ContentColumn } from '@/components/ui';
import { colors, radius, space } from '@/theme';
import { t } from '@/i18n';

/** A card's props plus the key the list tracks it by. */
export type CommentListItem = CommentCardProps & { key: string };

type Props = {
  items: CommentListItem[];
  /** The yellow note above the first card, when a screen wants one. */
  headerNote?: string | null;
  /** Hidden on a feed that cannot be reordered. */
  showSort?: boolean;
  emptyText?: string;
  /** Paging, for the screens whose comments arrive a page at a time. */
  onEndReached?: () => void;
  ListFooterComponent?: React.ReactElement | null;
};

export function CommentsList({
  items,
  headerNote,
  showSort = true,
  emptyText,
  onEndReached,
  ListFooterComponent,
}: Props) {
  return (
    <>
      {showSort && (
        <ContentColumn>
          <View style={styles.sortRow}>
            <Text style={styles.sortLabel}>
              {t('comments.sortBy')} <Text style={{ color: colors.blue }}>{t('comments.mostRecent')}</Text>
            </Text>
          </View>
        </ContentColumn>
      )}
      <FlatList
        style={styles.cappedList}
        data={items}
        keyExtractor={(c) => c.key}
        contentContainerStyle={{ paddingBottom: 100 }}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        onEndReachedThreshold={0.5}
        onEndReached={onEndReached}
        ListHeaderComponent={
          headerNote != null && headerNote !== '' ? (
            <View style={styles.soonCard}>
              <Text style={styles.soonText}>{headerNote}</Text>
            </View>
          ) : null
        }
        ListFooterComponent={ListFooterComponent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ fontSize: 40 }}>💬</Text>
            <Text style={styles.emptyText}>{emptyText ?? t('comments.emptyText')}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const { key: _key, ...card } = item;
          return <CommentCard {...card} />;
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  cappedList: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' },
  sortRow: { paddingHorizontal: space.lg, paddingBottom: 10 },
  sortLabel: { color: colors.dim, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  soonCard: {
    marginHorizontal: space.md,
    marginBottom: 10,
    backgroundColor: '#26220E',
    borderRadius: radius.card,
    padding: 13,
    gap: 5,
  },
  soonText: { color: '#E3E3E8', fontSize: 13.5, lineHeight: 19 },
  empty: { alignItems: 'center', gap: 12, marginTop: 60, paddingHorizontal: 40 },
  emptyText: { color: colors.dim, fontSize: 15, textAlign: 'center' },
});
