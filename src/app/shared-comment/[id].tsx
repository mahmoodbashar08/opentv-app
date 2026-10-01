/**
 * One comment from the shared CommsUni board, on its own page: the comment,
 * then every reply to it — the same shape as one of our own comments.
 *
 * READ-ONLY FOR NOW. Replying would send words to the shared archive, which
 * waits on the consent screen the partner guide requires (asked once). Until
 * then this page reads, and the composer stays on our own threads.
 *
 * The comment comes from the board that was tapped (`sharedById`), so only the
 * replies are fetched. Opened cold, with nothing remembered, it says so rather
 * than spending a request on a comment it cannot find by id alone.
 */
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { boardReplies, sharedById, type SharedComment } from '@/commsuni';
import { CommentCard, formatCommentDate } from '@/components/comment-card';
import { NavHeader, Screen } from '@/components/ui';
import { t } from '@/i18n';
import { colors, space } from '@/theme';

/*
 * A REPLY IS INDENTED, NOT LABELLED. `CommentCard`'s `isReply` prints "Your
 * reply" — it was made for the reader's own archive — and every reply here is
 * somebody else's. Indent and a thread line say "answer to the one above".
 */
function Card({ c, reply, revealed, onReveal }: { c: SharedComment; reply?: boolean; revealed: boolean; onReveal: () => void }) {
  const card = (
    <CommentCard
      author={c.author.name ?? '—'}
      avatar={c.author.avatar ? { uri: c.author.avatar } : null}
      date={c.createdAt ? formatCommentDate(c.createdAt) : ''}
      entity={c.origin.displayName || null}
      body={c.text}
      image={c.image ? { source: { uri: c.image }, width: 1, height: 1 } : null}
      likes={c.likes}
      replies={c.replyCount}
      spoiler={c.isSpoiler}
      spoilerReason="flagged"
      revealed={revealed}
      onReveal={onReveal}
    />
  );
  return reply ? <View style={styles.reply}>{card}</View> : card;
}

export default function SharedCommentScreen() {
  const { id = '' } = useLocalSearchParams<{ id?: string }>();
  const root = sharedById(id);
  const [replies, setReplies] = useState<SharedComment[] | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!root || root.replyCount === 0) return;
    let live = true;
    void boardReplies(root.id).then((got) => {
      if (live) setReplies(got?.replies ?? []);
    });
    return () => {
      live = false;
    };
  }, [root]);

  const reveal = (cid: string) => setRevealed((prev) => new Set(prev).add(cid));

  return (
    <Screen>
      <NavHeader close title={t('community.comments.title')} />
      {!root ? (
        <Text style={styles.gone}>{t('commsuni.gone')}</Text>
      ) : (
        <FlatList
          data={replies ?? []}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={<Card c={root} revealed={revealed.has(root.id)} onReveal={() => reveal(root.id)} />}
          ListEmptyComponent={root.replyCount > 0 && replies === null ? <ActivityIndicator style={styles.spinner} color={colors.dim} /> : null}
          renderItem={({ item }) => <Card c={item} reply revealed={revealed.has(item.id)} onReveal={() => reveal(item.id)} />}
          contentContainerStyle={{ paddingBottom: space.xl }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: 30 },
  reply: { marginStart: space.xl, borderStartWidth: 2, borderColor: colors.raise },
  gone: { color: colors.dim, fontSize: 15, textAlign: 'center', marginTop: 60, paddingHorizontal: space.xl },
});
