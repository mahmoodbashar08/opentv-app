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
import { offerTranslate, translateShared } from '@/community-translate';
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
  takeLastReplyId,
  sharedById,
  sharingOn,
  type SharedComment,
} from '@/commsuni';
import { getHandle, useJoined } from '@/community-session';
import { getMeta } from '@/db';
import { CommentCard, formatCommentDate } from '@/components/comment-card';
import { CommsuniAttribution, ConsentSheet, useReport } from '@/components/commsuni-board';
import { GifSearch } from '@/components/gif-search';
import { isPlus, requirePlus, usePlusUi } from '@/plus';
import { Image } from 'expo-image';
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
  nested,
  revealed,
  onReveal,
  onMenu,
  onReply,
  mine,
}: {
  c: SharedComment;
  reply?: boolean;
  /** The second level: a reply to a reply (the guide's depth 2). */
  nested?: boolean;
  revealed: boolean;
  onReveal: () => void;
  onMenu?: () => void;
  onReply?: () => void;
  /** Your own reply: nothing to translate. */
  mine?: boolean;
}) {
  const card = (
    <CommentCard
      author={sharedAuthorName(c.author.name)}
      avatar={c.author.avatar ? { uri: c.author.avatar } : null}
      date={c.createdAt ? formatCommentDate(c.createdAt) : ''}
      entity={c.origin.displayName || null}
      body={c.text}
      translate={!mine && offerTranslate(c.language) ? { cacheKey: `cu:${c.id}`, run: () => translateShared(c.id, c.text, c.language) } : undefined}
      image={pictureOf(c)}
      likes={c.likes}
      replies={c.replyCount}
      spoiler={c.isSpoiler}
      spoilerReason="flagged"
      revealed={revealed}
      onReveal={onReveal}
      onMenu={onMenu}
      onReply={onReply}
    />
  );
  return reply ? <View style={[styles.reply, nested && styles.nested]}>{card}</View> : card;
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
  // Which comment the writer answers: the root, or one of its replies.
  const [target, setTarget] = useState<SharedComment | null>(null);
  // The same tools as a comment: a spoiler flag and a GIF (by GIPHY address —
  // CommsUni keeps links). No photo yet: ours are not served publicly until
  // they can be scanned, and CommsUni only takes allowlisted hosts.
  const [spoiler, setSpoiler] = useState(false);
  const [gif, setGif] = useState<string | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const plusUi = usePlusUi();
  // A reply's own replies, fetched when "Show replies" is tapped.
  const [branches, setBranches] = useState<Record<string, SharedComment[]>>({});
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  /*
   * WHAT YOU JUST SENT, shown at once (5 Oct). CommsUni's reads are a snapshot
   * a few seconds behind (§5), so the reload right after a send came back
   * without it — and our server then kept that copy for a minute. A sent reply
   * stays here until their list carries the same id.
   */
  const [sent, setSent] = useState<Record<string, SharedComment[]>>({});
  // A CONVERSATION READS DOWNWARDS: oldest first, what you just sent at the
  // end (the owner, 5 Oct). CommsUni offers replies newest-first only, so the
  // one page we load (up to 50) is turned round when it arrives — a whole
  // page, never a reordered prefix — and a sent reply joins at the bottom.
  const withSent = (key: string, list: SharedComment[]) => [
    ...list,
    ...(sent[key] ?? []).filter((m) => !list.some((r) => r.id === m.id)),
  ];
  const report = useReport((cid) => setGone((g) => new Set(g).add(cid)));
  const openBranch = (r: SharedComment) => {
    if (!root) return;
    void boardReplies(root.id, r.id).then((got) => {
      // The branch call returns the reply's own answers; skip the reply itself.
      setBranches((b) => ({ ...b, [r.id]: [...(got?.replies ?? [])].reverse().filter((x) => x.id !== r.id) }));
    });
  };
  // One id per draft, so a retried POST is the same reply, not a second one.
  const clientId = useRef(newClientId());

  const load = useCallback(() => {
    if (!root) return () => {};
    let live = true;
    void boardReplies(root.id).then((got) => {
      if (live) setReplies([...(got?.replies ?? [])].reverse());
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

  const openWriter = (to: SharedComment | null = null) => {
    tapSelection();
    setTarget(to);
    // Answering a reply names its author, as the guide suggests.
    if (to) setText((cur) => (cur.trim() ? cur : `@${sharedAuthorName(to.author.name)} `));
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
  const canSend = (words.length > 0 || gif != null) && !overLength && !sending;

  const send = async () => {
    if (!root || !canSend) return;
    setSending(true);
    tapLight();
    const to = target ?? root;
    const result = await replyOnBoard(to.id, words, clientId.current, root.id, { spoiler, gif });
    setSending(false);
    if (result === 'ok') {
      const key = target ? target.id : root.id;
      const mineNow: SharedComment = {
        id: takeLastReplyId() ?? `local-${clientId.current}`,
        text: words,
        language: null,
        createdAt: new Date().toISOString(),
        // The name CommsUni will show for a shared profile: display name first.
        author: { name: getMeta('username') || getHandle(), avatar: null, color: null },
        origin: { kind: 'partner', slug: 'opentv', displayName: 'OpenTV' },
        likes: 0,
        replyCount: 0,
        isSpoiler: spoiler,
        image: gif,
      };
      setSent((m) => ({ ...m, [key]: [...(m[key] ?? []), mineNow] }));
      setText('');
      setGif(null);
      setSpoiler(false);
      clientId.current = newClientId();
      setWriting(false);
      setMine(myReplyIds());
      // Their next fresh read carries it after a few seconds; ask then.
      const branchOf = target;
      setTimeout(() => {
        load();
        if (branchOf) openBranch(branchOf);
      }, 8000);
      setTarget(null);
      return;
    }
    if (result === 'gif_refused') {
      Alert.alert(t('commsuni.gifRefusedTitle'), t('commsuni.gifRefusedBody'));
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
                  // Gone from EVERY list at once: the just-sent copy would
                  // otherwise put it back until a refresh (5 Oct).
                  setGone((g) => new Set(g).add(c.id));
                  setReplies((prev) => (prev ?? []).filter((r) => r.id !== c.id));
                }),
            },
          ])
      : () => report.open(c);

  return (
    <Screen>
      <NavHeader close title={t('community.comments.title')} />
      {!root ? (
        <Text style={styles.gone}>{t('commsuni.gone')}</Text>
      ) : (
        <>
          <FlatList
            data={withSent(root?.id ?? '', replies ?? []).filter((r) => !gone.has(r.id))}
            keyExtractor={(r) => r.id}
            ListHeaderComponent={
              <>
                {/* The guide's attribution, on every page that shows the board. */}
                <CommsuniAttribution />
                {gone.has(root.id) ? (
                  <Text style={styles.gone}>{t('commsuni.gone')}</Text>
                ) : (
                  <Card c={root} revealed={revealed.has(root.id)} onReveal={() => reveal(root.id)} onMenu={menuFor(root)} onReply={() => openWriter()} />
                )}
              </>
            }
            ListEmptyComponent={root.replyCount > 0 && replies === null ? <ActivityIndicator style={styles.spinner} color={colors.dim} /> : null}
            renderItem={({ item }) => (
              <View>
                <Card c={item} reply mine={mine.has(item.id) || item.id.startsWith('local-')} revealed={revealed.has(item.id)} onReveal={() => reveal(item.id)} onMenu={menuFor(item)} onReply={() => openWriter(item)} />
                {item.replyCount > 0 && !branches[item.id] && !sent[item.id] && (
                  <Pressable style={styles.branch} onPress={() => openBranch(item)}>
                    <Text style={styles.branchText}>{t('commsuni.showReplies', { count: item.replyCount })}</Text>
                  </Pressable>
                )}
                {withSent(item.id, branches[item.id] ?? [])
                  .filter((r) => !gone.has(r.id))
                  .map((sub) => (
                    <Card
                      key={sub.id}
                      c={sub}
                      reply
                      nested
                      mine={mine.has(sub.id) || sub.id.startsWith('local-')}
                      revealed={revealed.has(sub.id)}
                      onReveal={() => reveal(sub.id)}
                      onMenu={menuFor(sub)}
                      onReply={() => openWriter(item)}
                    />
                  ))}
              </View>
            )}
            contentContainerStyle={{ paddingBottom: 110 }}
          />
          <Pressable style={[styles.pencil, { bottom: Math.max(insets.bottom, space.xl) }]} accessibilityLabel={t('community.comments.reply')} onPress={() => openWriter()}>
            <Ionicons name="pencil" size={24} color={colors.onYellow} />
          </Pressable>
        </>
      )}

      {report.sheet}
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
              {t('community.comments.replyingTo', { handle: sharedAuthorName((target ?? root).author.name) })}
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
          {gif && (
            <View style={styles.gifRow}>
              <Image source={{ uri: gif }} style={styles.gifThumb} contentFit="cover" />
              <View style={{ flex: 1 }} />
              <Pressable hitSlop={10} onPress={() => setGif(null)}>
                <Ionicons name="close-circle" size={22} color={colors.dim} />
              </Pressable>
            </View>
          )}
          <View style={[styles.tools, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            {/* PLUS, as a picture on a comment is everywhere else in the app. */}
            {plusUi && (
              <Pressable
                hitSlop={8}
                style={styles.toolBtn}
                disabled={sending}
                onPress={() => {
                  if (!isPlus()) {
                    requirePlus('commsuni_reply_gif');
                    return;
                  }
                  setGifOpen(true);
                }}>
                <Text style={[styles.gifLabel, gif != null && { color: colors.yellow }]}>{t('commsuni.gif')}</Text>
              </Pressable>
            )}
            <Pressable
              hitSlop={8}
              style={[styles.spoiler, spoiler && styles.spoilerOn]}
              onPress={() => {
                tapSelection();
                setSpoiler((v) => !v);
              }}>
              <Ionicons name={spoiler ? 'eye-off' : 'eye-off-outline'} size={16} color={spoiler ? colors.onYellow : colors.dim} />
              <Text style={[styles.spoilerText, spoiler && { color: colors.onYellow }]}>{t('community.comments.spoilerToggle')}</Text>
            </Pressable>
          </View>
          <Modal visible={gifOpen} animationType="slide" onRequestClose={() => setGifOpen(false)}>
            <View style={[styles.writeScreen, { paddingTop: insets.top + 8 }]}>
              <View style={styles.writeHead}>
                <Text style={styles.postText}>{t('pickGif.title')}</Text>
                <Pressable hitSlop={12} onPress={() => setGifOpen(false)}>
                  <Ionicons name="close" size={24} color={colors.text} />
                </Pressable>
              </View>
              <GifSearch
                onPick={(hit) => {
                  setGif(hit.full);
                  setGifOpen(false);
                }}
              />
            </View>
          </Modal>
          {overLength && <Text style={styles.overLength}>{t('community.comments.errTooLong')}</Text>}
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: 30 },
  reply: { marginStart: space.xl, borderStartWidth: 2, borderColor: colors.raise },
  nested: { marginStart: space.xl * 2 },
  gifRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  gifThumb: { width: 72, height: 72, borderRadius: 10 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingTop: space.sm },
  toolBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.card },
  gifLabel: { color: colors.dim, fontSize: 13, fontWeight: '900' },
  spoiler: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.card },
  spoilerOn: { backgroundColor: colors.yellow },
  spoilerText: { color: colors.dim, fontSize: 13, fontWeight: '700' },
  branch: { marginStart: space.xl * 2, paddingVertical: 6 },
  branchText: { color: colors.blue, fontSize: 14, fontWeight: '600' },
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
