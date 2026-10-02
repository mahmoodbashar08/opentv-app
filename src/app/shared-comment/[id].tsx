/**
 * One comment from the shared CommsUni board, on its own page: the comment,
 * then every reply to it — the same shape as one of our own comments.
 *
 * REPLYING, the TV Time way: the yellow pencil opens a full writing screen.
 * A reply goes to CommsUni only (there is no OpenTV comment for it to copy),
 * so it needs the same consent as sharing — asked once, here if not before.
 * The server applies our posting rules before anything leaves; see
 * `POST /v1/commsuni/reply`. Your own replies get ⋯ → Delete.
 *
 * The comment comes from the board that was tapped (`sharedById`), so only the
 * replies are fetched. Opened cold, with nothing remembered, it says so rather
 * than spending a request on a comment it cannot find by id alone.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  boardReplies,
  decision as commsuniDecision,
  deleteBoardReply,
  myReplyIds,
  replyOnBoard,
  sharedById,
  sharingOn,
  type SharedComment,
} from '@/commsuni';
import { useJoined } from '@/community-session';
import { CommentCard, formatCommentDate } from '@/components/comment-card';
import { ConsentSheet } from '@/components/commsuni-board';
import { NavHeader, Screen } from '@/components/ui';
import { tapLight, tapSelection } from '@/haptics';
import { t } from '@/i18n';
import { colors, radius, space } from '@/theme';
import { COMMENT_BODY_MAX, sharedAuthorName } from '@/pure';
import { sharedPicture as pictureOf } from '@/components/shared-picture';

/*
 * A REPLY IS INDENTED, NOT LABELLED. `CommentCard`'s `isReply` prints "Your
 * reply" — it was made for the reader's own archive — and every reply here is
 * somebody else's. Indent and a thread line say "answer to the one above".
 */
function Card({
  c,
  reply,
  revealed,
  onReveal,
  onMenu,
}: {
  c: SharedComment;
  reply?: boolean;
  revealed: boolean;
  onReveal: () => void;
  onMenu?: () => void;
}) {
  const card = (
    <CommentCard
      author={sharedAuthorName(c.author.name)}
      avatar={c.author.avatar ? { uri: c.author.avatar } : null}
      date={c.createdAt ? formatCommentDate(c.createdAt) : ''}
      entity={c.origin.displayName || null}
      body={c.text}
      image={pictureOf(c)}
      likes={c.likes}
      replies={c.replyCount}
      spoiler={c.isSpoiler}
      spoilerReason="flagged"
      revealed={revealed}
      onReveal={onReveal}
      onMenu={onMenu}
    />
  );
  return reply ? <View style={styles.reply}>{card}</View> : card;
}

const newClientId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export default function SharedCommentScreen() {
  const insets = useSafeAreaInsets();
  const joined = useJoined();
  const { id = '' } = useLocalSearchParams<{ id?: string }>();
  const root = sharedById(id);
  const [replies, setReplies] = useState<SharedComment[] | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [mine, setMine] = useState(myReplyIds);
  const [asking, setAsking] = useState(false);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // One id per draft, so a retried POST is the same reply, not a second one.
  const clientId = useRef(newClientId());

  const load = useCallback(() => {
    if (!root) return () => {};
    let live = true;
    void boardReplies(root.id).then((got) => {
      if (live) setReplies(got?.replies ?? []);
    });
    return () => {
      live = false;
    };
  }, [root]);

  useEffect(() => {
    if (!root || root.replyCount === 0) return;
    return load();
  }, [root, load]);

  const reveal = (cid: string) => setRevealed((prev) => new Set(prev).add(cid));

  const openWriter = () => {
    tapSelection();
    if (!joined) {
      router.push('/join');
      return;
    }
    if (commsuniDecision() === null) {
      setAsking(true);
      return;
    }
    if (!sharingOn()) {
      Alert.alert(t('commsuni.replyNeedsSharingTitle'), t('commsuni.replyNeedsSharingBody'));
      return;
    }
    setWriting(true);
  };

  const words = text.trim();
  const overLength = [...words].length > COMMENT_BODY_MAX;
  const canSend = words.length > 0 && !overLength && !sending;

  const send = async () => {
    if (!root || !canSend) return;
    setSending(true);
    tapLight();
    const result = await replyOnBoard(root.id, words, clientId.current);
    setSending(false);
    if (result === 'ok') {
      setText('');
      clientId.current = newClientId();
      setWriting(false);
      setMine(myReplyIds());
      load();
      return;
    }
    Alert.alert(
      t('community.comments.failedTitle'),
      result === 'too_long'
        ? t('community.comments.errTooLong')
        : result === 'rate_limited'
          ? t('community.error.rateLimited')
          : t('community.error.generic'),
    );
  };

  const menuFor = (c: SharedComment) =>
    mine.has(c.id)
      ? () =>
          Alert.alert(t('community.comments.deleteTitle'), t('community.comments.deleteBody'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('community.comments.delete'),
              style: 'destructive',
              onPress: () =>
                void deleteBoardReply(c.id, root?.id ?? '').then((ok) => {
                  if (!ok) {
                    Alert.alert(t('community.comments.deleteFailedTitle'), t('community.error.generic'));
                    return;
                  }
                  setMine(myReplyIds());
                  setReplies((prev) => (prev ?? []).filter((r) => r.id !== c.id));
                }),
            },
          ])
      : undefined;

  return (
    <Screen>
      <NavHeader close title={t('community.comments.title')} />
      {!root ? (
        <Text style={styles.gone}>{t('commsuni.gone')}</Text>
      ) : (
        <>
          <FlatList
            data={replies ?? []}
            keyExtractor={(r) => r.id}
            ListHeaderComponent={<Card c={root} revealed={revealed.has(root.id)} onReveal={() => reveal(root.id)} />}
            ListEmptyComponent={root.replyCount > 0 && replies === null ? <ActivityIndicator style={styles.spinner} color={colors.dim} /> : null}
            renderItem={({ item }) => (
              <Card c={item} reply revealed={revealed.has(item.id)} onReveal={() => reveal(item.id)} onMenu={menuFor(item)} />
            )}
            contentContainerStyle={{ paddingBottom: 110 }}
          />
          <Pressable style={[styles.pencil, { bottom: Math.max(insets.bottom, space.xl) }]} accessibilityLabel={t('community.comments.reply')} onPress={openWriter}>
            <Ionicons name="pencil" size={24} color={colors.onYellow} />
          </Pressable>
        </>
      )}

      <ConsentSheet
        visible={asking}
        onDone={() => {
          setAsking(false);
          if (sharingOn()) setWriting(true);
        }}
      />

      <Modal visible={writing} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setWriting(false)}>
        <KeyboardAvoidingView style={[styles.writeScreen, { paddingTop: insets.top + 8 }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.writeHead}>
            <Pressable hitSlop={12} accessibilityLabel={t('community.comments.closeWriting')} onPress={() => setWriting(false)}>
              <Ionicons name="close" size={26} color={colors.text} />
            </Pressable>
            <Pressable disabled={!canSend} style={[styles.post, !canSend && styles.postOff]} onPress={() => void send()}>
              {sending ? <ActivityIndicator size="small" color={colors.onYellow} /> : <Text style={styles.postText}>{t('createTopic.post')}</Text>}
            </Pressable>
          </View>
          {root && (
            <Text style={styles.replying} numberOfLines={1}>
              {t('community.comments.replyingTo', { handle: sharedAuthorName(root.author.name) })}
            </Text>
          )}
          <TextInput
            style={styles.writeInput}
            value={text}
            onChangeText={setText}
            placeholder={t('community.comments.placeholder')}
            placeholderTextColor={colors.faint}
            multiline
            maxLength={COMMENT_BODY_MAX + 200}
            editable={!sending}
            autoFocus
          />
          {overLength && <Text style={styles.overLength}>{t('community.comments.errTooLong')}</Text>}
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: 30 },
  reply: { marginStart: space.xl, borderStartWidth: 2, borderColor: colors.raise },
  gone: { color: colors.dim, fontSize: 15, textAlign: 'center', marginTop: 60, paddingHorizontal: space.xl },
  pencil: {
    position: 'absolute',
    end: space.lg,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  writeScreen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.lg },
  writeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  post: { backgroundColor: colors.yellow, borderRadius: radius.pill, paddingHorizontal: 18, paddingVertical: 8, minWidth: 74, alignItems: 'center' },
  postOff: { opacity: 0.4 },
  postText: { color: colors.onYellow, fontWeight: '800', fontSize: 14 },
  replying: { color: colors.dim, fontSize: 13.5, marginTop: 6 },
  writeInput: { flex: 1, color: colors.text, fontSize: 17, textAlignVertical: 'top', marginTop: 12 },
  overLength: { color: colors.danger, fontSize: 13, marginBottom: 8 },
});
