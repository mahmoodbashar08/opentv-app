/**
 * ONE comment, on its own, with everything written under it.
 *
 * WHY IT EXISTS. A comment could only be read inside the thread it sits in.
 * Tapping one did nothing; the only way to see its replies was a small blue
 * "3 replies" link that unfolded them inline, underneath every other comment on
 * the show. In a busy thread that is a conversation buried in a list of
 * unrelated conversations, and a comment worth answering is exactly the one you
 * want alone on a screen.
 *
 * IT REUSES THE THREAD'S CARD, not the archive's. This screen IS a thread — one
 * root and its replies — so a reply has to sit indented under its parent, which
 * is what `CommentRow`'s `depth` does. The archive card has no depth and never
 * needed one.
 *
 * REPLYING HAPPENS IN THE THREAD. The composer, its draft state, the spoiler
 * toggle and the optimistic insert all live on the thread screen; a second copy
 * here would be a second implementation of posting, which is how the two comment
 * LISTS drifted apart in the first place. Reply opens the thread with the
 * composer already aimed at this comment.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, type TextInput } from 'react-native';

import {
  fetchComment,
  fetchReplies,
  likeComment,
  postComment,
  unlikeComment,
  type Comment,
} from '@/community-comments';
import { getHandle, getProfileId, useJoined } from '@/community-session';
import { targetLabel } from '@/community-target';
import { CommentComposer } from '@/components/comment-composer';
import { CommentRow, type Row } from '@/components/comment-thread';
import { addOwnComment } from '@/db';
import { commentBodyError } from '@/pure';
import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { colors, space } from '@/theme';

export default function CommentScreen() {
  const { id: raw } = useLocalSearchParams<{ id?: string }>();
  const id = raw ?? '';
  const joined = useJoined();
  const myId = getProfileId();

  const [root, setRoot] = useState<Comment | null | 'missing'>(null);
  const [replies, setReplies] = useState<Comment[]>([]);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  // Stamped when the data lands rather than read during render — `Date.now()` in
  // a render body is impure and two renders of one state would disagree about
  // "3 hours ago". Same rule the thread follows.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const c = await fetchComment(id);
      if (cancelled) return;
      setRoot(c ?? 'missing');
      setNow(Date.now());
      if (c == null) return;
      // Only fetched when the server says there is something to fetch — a
      // request per childless comment is a request for an empty array.
      if (c.reply_count > 0) {
        const page = await fetchReplies(c.id);
        if (!cancelled) setReplies(page.items);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const [text, setText] = useState('');
  const [spoiler, setSpoiler] = useState(false);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<TextInput | null>(null);

  const patch = (target: string, fn: (x: Comment) => Comment) => {
    setRoot((prev) => (prev != null && prev !== 'missing' && prev.id === target ? fn(prev) : prev));
    setReplies((prev) => prev.map((x) => (x.id === target ? fn(x) : x)));
  };

  /** Optimistic, then corrected by the server's count — as the thread does it. */
  const toggleLike = (c: Comment) => {
    if (!joined) {
      router.push('/join');
      return;
    }
    tapLight();
    const liked = c.liked_by_me;
    patch(c.id, (x) => ({ ...x, liked_by_me: !liked, like_count: Math.max(0, x.like_count + (liked ? -1 : 1)) }));
    void (liked ? unlikeComment(c.id) : likeComment(c.id))
      .then((res) => patch(c.id, (x) => ({ ...x, liked_by_me: res.liked, like_count: res.like_count })))
      .catch(() => patch(c.id, (x) => ({ ...x, liked_by_me: liked, like_count: c.like_count })));
  };

  /**
   * Post a reply to THIS comment, here.
   *
   * Every post on this screen answers the same root, so there is no reply target
   * to choose and no "Replying to @x" bar to show — the comment it answers is
   * the one at the top of the screen. The optimistic row goes straight into the
   * replies list and is replaced by the saved row, the same trade the thread
   * makes: a send that waits on a round trip reads as a dead button.
   */
  const send = async () => {
    if (root === null || root === 'missing') return;
    if (commentBodyError(text) !== null || sending || !joined) return;
    const body = text.trim();
    const tempId = `temp:${root.id}:${Date.now()}`;
    const optimistic: Comment = {
      id: tempId,
      author: { id: myId ?? '', handle: getHandle() ?? '', display_name: null, avatar_key: null },
      target_source: root.target_source,
      target_key: root.target_key,
      season: root.season,
      episode: root.episode,
      body,
      is_spoiler: spoiler ? 1 : 0,
      lang: null,
      parent_id: root.id,
      imported_at: null,
      like_count: 0,
      liked_by_me: false,
      reply_count: 0,
      created_at: new Date().toISOString(),
      edited_at: null,
    };

    tapLight();
    setSending(true);
    setText('');
    setReplies((prev) => [...prev, optimistic]);
    try {
      const saved = await postComment({
        target: {
          source: root.target_source,
          key: root.target_key,
          season: root.season ?? undefined,
          episode: root.episode ?? undefined,
        },
        body,
        isSpoiler: spoiler,
        parentId: root.id,
      });
      setReplies((prev) => prev.map((c) => (c.id === tempId ? saved : c)));
      patch(root.id, (x) => ({ ...x, reply_count: x.reply_count + 1 }));
      // The phone keeps its own copy of everything its owner writes, replies
      // included — see `addOwnComment`.
      addOwnComment({ entity: targetLabel(saved), text: body, date: saved.created_at, type: 'reply' });
      setSpoiler(false);
    } catch {
      // Put the screen back exactly as it was rather than leaving a reply that
      // looks posted and is not.
      setReplies((prev) => prev.filter((c) => c.id !== tempId));
      setText(body);
    } finally {
      setSending(false);
    }
  };

  /** The full title thread — every other conversation about this episode. */
  const openThread = (c: Comment) => {
    const where = c.season != null ? `&season=${c.season}${c.episode != null ? `&episode=${c.episode}` : ''}` : '';
    router.push(`/thread?source=${c.target_source}&key=${encodeURIComponent(c.target_key)}${where}`);
  };

  if (root === null) {
    return (
      <Screen>
        <NavHeader close title={t('community.comments.title')} />
        <ActivityIndicator style={styles.spinner} color={colors.dim} />
      </Screen>
    );
  }

  if (root === 'missing') {
    return (
      <Screen>
        <NavHeader close title={t('community.comments.title')} />
        <ContentColumn>
          <Text style={styles.gone}>{t('community.comments.gone')}</Text>
        </ContentColumn>
      </Screen>
    );
  }

  // The root at depth 0, its replies indented beneath — the same shape the
  // thread builds, minus every other conversation on the title.
  const rows: Row[] = [
    { comment: root, depth: 0 },
    ...replies.map((r): Row => ({ comment: r, depth: 1 })),
  ];

  return (
    <Screen>
      <NavHeader close title={t('community.comments.title')} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}>
        <FlatList
          data={rows}
          keyExtractor={(r) => r.comment.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          renderItem={({ item }) => (
            <ContentColumn>
              <CommentRow
                row={item}
                now={now}
                mine={myId !== null && item.comment.author.id === myId}
                revealed={revealed.has(item.comment.id)}
                // Already the whole conversation — nothing left to unfold.
                expanded
                onReveal={() => setRevealed((prev) => new Set(prev).add(item.comment.id))}
                onLike={() => toggleLike(item.comment)}
                // The box is on this screen, so Reply puts the caret in it
                // rather than sending the reader somewhere else to type.
                onReply={() => inputRef.current?.focus()}
                onMenu={() => openThread(item.comment)}
              />
            </ContentColumn>
          )}
          ListFooterComponent={
            root.reply_count > 0 && replies.length === 0 ? (
              <ActivityIndicator style={styles.spinner} color={colors.dim} />
            ) : null
          }
        />
        {/* Every post here answers the comment at the top, so no reply bar. */}
        <CommentComposer
          value={text}
          onChangeText={setText}
          spoiler={spoiler}
          onToggleSpoiler={() => setSpoiler((v) => !v)}
          sending={sending}
          onSend={() => void send()}
          joined={joined}
          inputRef={inputRef}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: 40 },
  gone: { color: colors.dim, fontSize: 15, textAlign: 'center', marginTop: 60, paddingHorizontal: space.xl },
});
