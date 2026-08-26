/**
 * A community thread: the comments on one episode, one show, or one film.
 *
 * READING NEEDS NO ACCOUNT. `GET /v1/comments` is open, and that is the point
 * — somebody who has not joined can still see what everyone thought of last
 * night's episode. What they do not get is the composer, which is replaced by
 * a row that opens the join screen. Nothing else is hidden, nothing is blurred
 * to sell an account.
 *
 * MODERATION IS NOT A LATER PHASE. Every row carries a `⋯` that opens Report
 * and Block — two taps from the comment to the control, which is what App
 * Store guideline 1.2 asks for on any app carrying user-generated content.
 * Your own comment offers Delete instead, and never offers you the chance to
 * report or block yourself.
 *
 * TEXT ONLY. There is no attach button, no picker, no image field. Accepting
 * pictures from the public is a different product with a legal obligation
 * attached to it, and shipping the button before the scanning is how that goes
 * wrong.
 *
 * `FlatList`, never `ScrollView` + `.map()` — the P2 bug in INSTRUCTIONS.md is
 * literally about this screen. Replies are flattened into the same list rather
 * than nested in a second one, so there is exactly one virtualised list here.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  I18nManager,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError } from '@/api';
import type { Comment, ThreadTarget } from '@/community-comments';
import { targetLabel } from '@/community-target';
import { cachedTranslation, translateComment } from '@/community-translate';
import {
  avatarUri,
  commentImageUri,
  blockProfile,
  deleteComment,
  fetchReplies,
  fetchThread,
  likeComment,
  postComment,
  reportComment,
  unlikeComment,
} from '@/community-comments';
import { getHandle, getProfileId, useJoined } from '@/community-session';
import { useCommentAttachment } from '@/components/comment-attachment';
import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { CONTENT_MAX_WIDTH } from '@/components/ui';
import { tapLight, tapSelection } from '@/haptics';
import { t } from '@/i18n';
import {
  COMMENT_BODY_MAX,
  REPORT_REASONS,
  type ReportReason,
  canReplyTo,
  commentBodyError,
  commentErrorKey,
  relativeTime,
  reportReasonKey,
  spoilerHidden,
  isOrphanedReply,
  localPictureIndex,
  pictureKeyOf,
  type LocalCommentPicture,
  archivedCommentKey,
} from '@/pure';
import { addOwnComment, getComments, tombstoneArchivedComment } from '@/db';
import { documentFileUri } from '@/library';
import { colors, radius, space } from '@/theme';

/**
 * One rendered line. Replies are flattened INTO the top-level list with a
 * depth flag rather than nested in their own `FlatList`: a virtualised list
 * inside a virtualised list is the warning React Native prints and the
 * scrolling bug it warns about.
 */
/** A comment and how deep it sits. Exported with `CommentRow`, which takes it. */
export type Row = { comment: Comment; depth: 0 | 1 };

/** A pending optimistic row. Prefixed so it can never collide with a server id. */
const TEMP_PREFIX = 'tmp_';
let tempSeq = 0;

function isTemp(c: Comment): boolean {
  return c.id.startsWith(TEMP_PREFIX);
}

/** The message for a failed write, from the code — never from the server's English. */
function errorMessage(e: unknown): string {
  return t(commentErrorKey(e instanceof ApiError ? e.code : 'unknown'));
}

// ── one row ──────────────────────────────────────────────────────────────────

function Avatar({ author }: { author: Comment['author'] }) {
  const uri = avatarUri(author.avatar_key);
  if (uri) return <Image source={{ uri }} style={styles.avatar} contentFit="cover" cachePolicy="disk" />;
  // Avatars are not served yet (no R2 binding on the Worker), so the letter is
  // the real state of the world rather than a loading placeholder.
  return (
    <View style={[styles.avatar, styles.avatarLetter]}>
      <Text style={styles.avatarLetterText}>{(author.handle[0] ?? '?').toUpperCase()}</Text>
    </View>
  );
}

/**
 * ONE COMMENT, wherever it appears.
 *
 * Exported because a person's profile shows their comments too, and a card
 * copied into that screen would be a second implementation of likes, spoilers,
 * pictures and the reply rules — which is how the two ended up looking
 * different in the first place. The thread passes a `Row`; anything else wraps
 * its comment as `{ comment, depth: 0 }`.
 */
export function CommentRow({
  row,
  now,
  mine,
  revealed,
  expanded,
  onReveal,
  onLike,
  onReply,
  onToggleReplies,
  onPress,
  onMenu,
  onPressAuthor,
  picture,
}: {
  row: Row;
  /** Stamped when the page loaded, not read during render — see `now` below. */
  now: number;
  mine: boolean;
  revealed: boolean;
  expanded: boolean;
  onReveal: () => void;
  onLike: () => void;
  onReply: () => void;
  /** Omitted on a screen that already shows every reply — the permalink, where
   *  "3 replies" / "Hide replies" would offer to fold away the only thing on
   *  the page. */
  onToggleReplies?: () => void;
  /** The whole card. Opens this comment on its own screen with its replies —
   *  a tap on a comment used to do nothing at all. */
  onPress?: () => void;
  onMenu: () => void;
  /** The avatar and the handle. Opens whoever wrote it — a name that is not a
   *  link on a screen full of other people is a dead end, and it is the only
   *  route to the block and report controls a profile carries. */
  onPressAuthor: () => void;
  /** This device's copy of the comment's photograph, when it has one. */
  picture?: (c: Comment) => LocalCommentPicture | undefined;
}) {
  const c = row.comment;
  /*
   * SEEDED FROM THE MODULE CACHE, once, in a `useState` initialiser. A row
   * scrolls out of a FlatList and is unmounted; without this it comes back
   * untranslated and asks the server again for something it already has. The
   * initialiser runs per mount rather than per render, so the React Compiler
   * has nothing to memoise away.
   */
  const [translation, setTranslation] = useState(() => cachedTranslation(c.id));
  const [showTranslated, setShowTranslated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const hidden = spoilerHidden(c, revealed ? new Set([c.id]) : new Set());
  const age = relativeTime(c.created_at, now);

  return (
    <Pressable
      style={[styles.card, row.depth === 1 && styles.cardReply]}
      onPress={onPress}
      disabled={onPress == null}>
      {/* RTL: `flexDirection: 'row'` already mirrors under I18nManager.isRTL,
          so avatar → handle → time reads right-to-left in Arabic with no
          per-language branch. `marginStart`/`textAlign: 'left'` below are the
          writing-direction-relative forms, for the same reason. */}
      <View style={styles.head}>
        {/* Avatar AND handle together: two separate targets for one destination
            is two chances to miss, and the pair is what reads as a person. */}
        <Pressable style={styles.headTap} onPress={onPressAuthor} hitSlop={6}>
          <Avatar author={c.author} />
          <View style={styles.headText}>
            <Text style={styles.handle} numberOfLines={1}>
              {c.author.display_name || `@${c.author.handle}`}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {age ? t(age.key, { count: age.count }) : ''}
              {c.edited_at ? ` · ${t('community.comments.edited')}` : ''}
              {c.imported_at ? ` · ${t('community.comments.imported')}` : ''}
            </Text>
          </View>
        </Pressable>
        <Pressable hitSlop={12} onPress={onMenu} style={styles.menuBtn}>
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.dim} />
        </Pressable>
      </View>

      {hidden ? (
        <Pressable style={styles.spoiler} onPress={onReveal}>
          <Ionicons name="eye-off-outline" size={16} color={colors.dim} />
          <Text style={styles.spoilerText}>{t('community.comments.spoilerHidden')}</Text>
        </Pressable>
      ) : (
        <>
          {/* A REPLY WITH NO ORIGINAL. The export carried the user's own
              comments and nobody else's, so an imported reply answers words
              that are not here and cannot be — it arrives with `parent_id`
              null and renders at the top of a thread as a stray sentence.
              Saying what it is costs one line and turns a non-sequitur back
              into a comment. */}
          {isOrphanedReply(picture?.(c), c.parent_id) && (
            <Text style={styles.orphanReply}>{t('community.comments.orphanReply')}</Text>
          )}
          {c.body.length > 0 && <Text style={styles.body}>{showTranslated && translation ? translation.text : c.body}</Text>}
          {/*
            TRANSLATE — the row that makes six locales a translation of the
            community rather than of the buttons.

            ONLY WHEN THERE IS SOMETHING TO TRANSLATE. A comment already in the
            reader's language, an empty body, or a picture-only card offers
            nothing: the server answers `same` for the first, and this hides the
            row for good once it has been told.
          */}
          {c.body.length > 0 && !translation?.same && (
            <Pressable
              hitSlop={6}
              onPress={() => {
                if (busy) return;
                if (translation) {
                  setShowTranslated((v) => !v);
                  return;
                }
                setBusy(true);
                setFailed(false);
                void translateComment(c.id)
                  .then((r) => {
                    setTranslation(r);
                    setShowTranslated(!r.same);
                  })
                  .catch(() => setFailed(true))
                  .finally(() => setBusy(false));
              }}>
              <Text style={[styles.translate, failed && styles.translateFailed]}>
                {busy
                  ? t('community.comments.translating')
                  : failed
                    ? t('community.comments.translateFailed')
                    : translation
                      ? showTranslated
                        ? t('community.comments.showOriginal')
                        : t('community.comments.translate')
                      : t('community.comments.translate')}
              </Text>
            </Pressable>
          )}
          {/* THE PICTURE — this phone's copy, or the server's.
              A picture-ONLY comment (TV Time allowed a photo with no caption)
              arrived here as an empty card with nothing in it at all. The
              user's own file is on the device, downloaded at import;
              `localPictureIndex` joins the two on the timestamp and body BOTH
              sides derive from the same local row.

              Somebody else's used to be invisible, because the server stored
              images and served none of them. It serves cleared ones now — a
              person looks at each in the review queue first — so a rescued
              photograph is finally visible to somebody other than the phone
              that saved it. Posting a NEW image is still not possible
              anywhere in the app. */}
          {(() => {
            const local = picture?.(c);
            /**
             * THIS PHONE'S COPY FIRST, THE SERVER'S SECOND.
             *
             * The local file is free, offline, and already the right picture;
             * the remote one is a request. So a user's own imported photographs
             * still come off disk exactly as before, and the fetch happens only
             * for somebody else's — which is the case that used to render
             * nothing at all.
             *
             * `c.image` is present only for an image a person has cleared for
             * showing, so this cannot request one that is waiting or refused.
             * The ratio comes from the server's stored dimensions when there is
             * no local row to ask.
             */
            const remote = c.image ? commentImageUri(c.id) : null;
            const uri = documentFileUri(local?.image) ?? local?.imageUrl ?? remote;
            if (uri) {
              const serverRatio =
                c.image?.width && c.image?.height ? c.image.width / c.image.height : null;
              return (
                <Image
                  source={{ uri }}
                  style={[styles.picture, { aspectRatio: local?.ratio || serverRatio || 4 / 3 }]}
                  contentFit="cover"
                  cachePolicy="disk"
                />
              );
            }
            /*
             * YOUR OWN PICTURE, STILL BEING LOOKED AT.
             *
             * Only its author is told (the server sends `image_pending` to
             * nobody else), and no picture comes with it -- so this is a shape
             * standing in for one, not a blurred copy of the real thing. Drawn
             * because the alternative is a comment that looks like the upload
             * failed, which is what the author had just been fighting.
             */
            if (c.image_pending) {
              return (
                <View style={[styles.picture, styles.pictureWaiting, { aspectRatio: 4 / 3 }]}>
                  <Ionicons name="time-outline" size={22} color={colors.dim} />
                  <Text style={styles.pictureWaitingText}>{t('community.comments.pictureWaiting')}</Text>
                </View>
              );
            }
            return c.body.length === 0 ? (
              <Text style={styles.picturePlaceholder}>{t('community.profile.photoComment')}</Text>
            ) : null;
          })()}
        </>
      )}

      <View style={styles.actions}>
        <Pressable hitSlop={8} style={styles.action} onPress={onLike}>
          <Ionicons
            name={c.liked_by_me ? 'heart' : 'heart-outline'}
            size={20}
            color={c.liked_by_me ? colors.danger : '#C9C9CF'}
          />
          {c.like_count > 0 && <Text style={styles.actionCount}>{c.like_count}</Text>}
        </Pressable>

        {/* Only a top-level comment can be replied to. One level, and the
            server refuses a deeper one — so the button is not offered. */}
        {canReplyTo(c) && (
          <Pressable hitSlop={8} style={styles.action} onPress={onReply}>
            <Ionicons name="chatbubble-outline" size={18} color="#C9C9CF" />
            <Text style={styles.actionCount}>{t('community.comments.reply')}</Text>
          </Pressable>
        )}

        {c.reply_count > 0 && onToggleReplies != null && (
          <Pressable hitSlop={8} style={styles.action} onPress={onToggleReplies}>
            <Text style={styles.repliesLink}>
              {expanded
                ? t('community.comments.hideReplies')
                : t('community.comments.replies', { count: c.reply_count })}
            </Text>
          </Pressable>
        )}

        {mine && <View style={styles.mineDot} />}
      </View>
    </Pressable>
  );
}

// ── the thread ───────────────────────────────────────────────────────────────

export function CommentThread({ target }: { target: ThreadTarget }) {
  // Built once for the whole thread rather than per card: a busy thread would
  // otherwise scan the local comments table for every row rendered. See
  // `localPictureIndex` for why the join exists at all.
  const pictures = useMemo(() => localPictureIndex(getComments()), []);
  const joined = useJoined();
  const myId = getProfileId();
  // ONLY THIS PHONE'S OWNER GETS A PICTURE FROM THIS PHONE. The join is on
  // timestamp-and-body, which identifies a comment only among one person's —
  // run against every author, two comments that coincided would put one
  // reader's photo on another reader's card. A comment belongs to one person
  // and so does its picture; everybody else's arrives from the server, or not
  // at all until image serving is live.
  const lookupPicture = useCallback(
    (c: Comment) => (myId !== null && c.author.id === myId ? pictures.get(pictureKeyOf(c)) : undefined),
    [pictures, myId],
  );

  const [items, setItems] = useState<Comment[]>([]);
  const [replies, setReplies] = useState<Record<string, Comment[]>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());

  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [text, setText] = useState('');
  const [spoiler, setSpoiler] = useState(false);
  const [sending, setSending] = useState(false);
  const attach = useCommentAttachment();
  const [replyTo, setReplyTo] = useState<Comment | null>(null);

  const [menuFor, setMenuFor] = useState<Comment | null>(null);
  const [reportFor, setReportFor] = useState<Comment | null>(null);

  /**
   * The clock every "3 hours ago" is measured against, stamped when a page
   * lands rather than read during render.
   *
   * `Date.now()` in a render body is impure — two renders of the same state
   * would produce two different screens, which is the rule `react-hooks/purity`
   * enforces. Re-stamping on each load also means the ages refresh on a
   * pull-to-refresh, which is exactly when a reader expects them to.
   */
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(
    async (mode: 'first' | 'refresh') => {
      if (mode === 'refresh') setRefreshing(true);
      const page = await fetchThread(target);
      setItems(page.items);
      setCursor(page.next_cursor);
      setNow(Date.now());
      // A refresh drops every expansion: after a block, the replies held in
      // state may be from somebody who is no longer allowed to appear.
      setReplies({});
      setExpanded(new Set());
      setLoading(false);
      setRefreshing(false);
    },
    // The target is a plain object rebuilt by the parent on each render, so
    // its fields — not its identity — are the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target.source, target.key, target.season, target.episode],
  );

  // The first page is fetched INSIDE the effect and applied in the `then`,
  // rather than by calling `load` — a setState in an effect body is a cascading
  // render, and a promise callback is the shape the rule asks for. `cancelled`
  // covers a modal dismissed while the request is still in the air.
  useEffect(() => {
    let cancelled = false;
    void fetchThread(target).then((page) => {
      if (cancelled) return;
      setItems(page.items);
      setCursor(page.next_cursor);
      setNow(Date.now());
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.source, target.key, target.season, target.episode]);

  const loadMore = async () => {
    if (loadingMore || !cursor) return;
    setLoadingMore(true);
    const page = await fetchThread({ ...target, cursor });
    // Filtered against what is already shown: a comment posted between two
    // page fetches shifts the window, and the cursor is (created_at, id) so a
    // duplicate is possible even though it is rare.
    setItems((prev) => {
      const seen = new Set(prev.map((c) => c.id));
      return [...prev, ...page.items.filter((c) => !seen.has(c.id))];
    });
    setCursor(page.next_cursor);
    setLoadingMore(false);
  };

  const toggleReplies = async (parent: Comment) => {
    tapSelection();
    if (expanded.has(parent.id)) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(parent.id);
        return next;
      });
      return;
    }
    setExpanded((prev) => new Set(prev).add(parent.id));
    if (replies[parent.id]) return; // already fetched once this session
    const page = await fetchReplies(parent.id);
    setReplies((prev) => ({ ...prev, [parent.id]: page.items }));
  };

  /** Applies a change to a comment wherever it lives — top level or reply. */
  const patch = (id: string, change: (c: Comment) => Comment) => {
    setItems((prev) => prev.map((c) => (c.id === id ? change(c) : c)));
    setReplies((prev) => {
      const next: Record<string, Comment[]> = {};
      for (const [parentId, list] of Object.entries(prev)) {
        next[parentId] = list.map((c) => (c.id === id ? change(c) : c));
      }
      return next;
    });
  };

  const toggleLike = async (c: Comment) => {
    if (!joined || isTemp(c)) return;
    tapLight();
    const liking = !c.liked_by_me;
    // Optimistic: the heart fills under the finger. The server answers with
    // the authoritative count, which then replaces this guess.
    patch(c.id, (x) => ({
      ...x,
      liked_by_me: liking,
      like_count: Math.max(0, x.like_count + (liking ? 1 : -1)),
    }));
    try {
      const res = liking ? await likeComment(c.id) : await unlikeComment(c.id);
      patch(c.id, (x) => ({ ...x, liked_by_me: res.liked, like_count: res.like_count }));
    } catch (e) {
      // Roll back to exactly what was on screen before the tap.
      patch(c.id, (x) => ({ ...x, liked_by_me: c.liked_by_me, like_count: c.like_count }));
      Alert.alert(t('community.comments.failedTitle'), errorMessage(e));
    }
  };

  const send = async () => {
    /*
     * A PICTURE IS ENOUGH ON ITS OWN. TV Time let people post a photograph
     * with no caption and this archive is full of them, so refusing one here
     * meant the app could not do what its own import proves people did. An
     * empty body is only allowed when there is actually a picture to carry it.
     */
    const failure = commentBodyError(text);
    if (failure === 'too_long' || sending || !joined) return;
    if (failure !== null && attach.attachment == null) return;

    const body = text.trim();
    const parent = replyTo;
    const tempId = `${TEMP_PREFIX}${++tempSeq}`;
    const optimistic: Comment = {
      id: tempId,
      author: {
        id: myId ?? '',
        handle: getHandle() ?? '',
        display_name: null,
        avatar_key: null,
      },
      target_source: target.source,
      target_key: target.key,
      season: target.season ?? null,
      episode: target.episode ?? null,
      body,
      is_spoiler: spoiler ? 1 : 0,
      lang: null,
      parent_id: parent?.id ?? null,
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
    if (parent) {
      setReplies((prev) => ({ ...prev, [parent.id]: [optimistic, ...(prev[parent.id] ?? [])] }));
      setExpanded((prev) => new Set(prev).add(parent.id));
    } else {
      setItems((prev) => [optimistic, ...prev]);
    }

    try {
      const saved = await postComment({
        target,
        body,
        isSpoiler: spoiler,
        parentId: parent?.id ?? null,
        hasImage: attach.attachment != null,
      });
      /*
       * The picture goes up against the id the server just made. If it fails,
       * `upload` takes the comment back down -- a comment meant to have a
       * picture is wrong without one -- so this screen has to lose the row it
       * optimistically added, and give the words back to the box.
       */
      const hadPicture = attach.attachment != null;
      const { sent, image: keptImage } = await attach.upload(saved.id);
      /*
       * THE ROW PREDATES THE PICTURE, so it has to be told about it.
       *
       * `POST /v1/comments` answers before a single byte of image is sent --
       * that is the whole point of the two steps -- so the comment it returns
       * says `image_pending: false`, truthfully, and nothing asks again. The
       * author was left looking at their own comment with no picture and no
       * explanation, which is the exact thing `image_pending` exists to
       * prevent.
       */
      const posted = sent ? { ...saved, image_pending: true } : saved;
      if (hadPicture && !sent) {
        if (parent) {
          setReplies((prev) => ({ ...prev, [parent.id]: (prev[parent.id] ?? []).filter((c) => c.id !== tempId) }));
        } else {
          setItems((prev) => prev.filter((c) => c.id !== tempId));
        }
        setText(body);
        return;
      }
      // The phone keeps its own copy — see `addOwnComment`. `title` is what the
      // screen is already showing as the subject, which is exactly what the
      // archive stores as `entity`.
      addOwnComment({
        entity: targetLabel(saved),
        text: body,
        date: saved.created_at,
        // The archive keeps the picture too — see `useCommentAttachment`.
        image: keptImage,
        // And the server's own id, so deleting this from the profile can reach
        // the copy other people see. A content hash cannot: the server minted
        // this id rather than deriving it.
        serverId: saved.id,
        type: parent ? 'reply' : 'comment',
      });
      // The server shapes POST and GET identically, so the optimistic row is
      // simply replaced rather than reconciled field by field.
      if (parent) {
        setReplies((prev) => ({
          ...prev,
          [parent.id]: (prev[parent.id] ?? []).map((c) => (c.id === tempId ? posted : c)),
        }));
        patch(parent.id, (x) => ({ ...x, reply_count: x.reply_count + 1 }));
      } else {
        setItems((prev) => prev.map((c) => (c.id === tempId ? posted : c)));
      }
      setSpoiler(false);
      setReplyTo(null);
    } catch (e) {
      // ROLLBACK, and the text comes back into the box. Losing what somebody
      // just wrote because a request failed is unforgivable in a way a failed
      // like is not.
      if (parent) {
        setReplies((prev) => ({
          ...prev,
          [parent.id]: (prev[parent.id] ?? []).filter((c) => c.id !== tempId),
        }));
      } else {
        setItems((prev) => prev.filter((c) => c.id !== tempId));
      }
      setText(body);
      Alert.alert(t('community.comments.failedTitle'), errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const confirmDelete = (c: Comment) => {
    Alert.alert(t('community.comments.deleteTitle'), t('community.comments.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('community.comments.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteComment(c.id);
              /*
               * AND FROM THE ARCHIVE. Deleting here used to remove the
               * server's copy and leave this phone's, so a comment somebody
               * had just deleted was still sitting on their own profile --
               * while deleting from the profile removed both. The key is the
               * same one `addOwnComment` wrote the row under.
               */
              tombstoneArchivedComment(
                archivedCommentKey({ entity: targetLabel(c), date: c.created_at, text: c.body }),
              );
              setItems((prev) => prev.filter((x) => x.id !== c.id));
              setReplies((prev) => {
                const next: Record<string, Comment[]> = {};
                for (const [parentId, list] of Object.entries(prev)) {
                  next[parentId] = list.filter((x) => x.id !== c.id);
                }
                return next;
              });
              if (c.parent_id) patch(c.parent_id, (x) => ({ ...x, reply_count: Math.max(0, x.reply_count - 1) }));
            } catch (e) {
              Alert.alert(t('community.comments.deleteFailedTitle'), errorMessage(e));
            }
          })();
        },
      },
    ]);
  };

  const sendReport = (c: Comment, reason: ReportReason) => {
    void (async () => {
      try {
        await reportComment(c.id, reason);
        // 202 — FILED, not judged. The confirmation says so on purpose: the
        // queue is a person, and promising an outcome would be a lie.
        Alert.alert(t('community.report.sentTitle'), t('community.report.sentBody'));
      } catch (e) {
        Alert.alert(t('community.report.failedTitle'), errorMessage(e));
      }
    })();
  };

  const confirmBlock = (c: Comment) => {
    // Confirmed first, because it is not reversible from here and it drops any
    // follow between the two accounts in both directions.
    Alert.alert(
      t('community.block.title', { handle: c.author.handle }),
      t('community.block.body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('community.block.confirm'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await blockProfile(c.author.id);
                // Refresh rather than filter locally: the server's filter runs
                // both ways and covers replies and reply counts too, which a
                // local filter would quietly get wrong.
                await load('refresh');
                Alert.alert(
                  t('community.block.doneTitle'),
                  t('community.block.doneBody', { handle: c.author.handle }),
                );
              } catch (e) {
                Alert.alert(t('community.block.failedTitle'), errorMessage(e));
              }
            })();
          },
        },
      ],
    );
  };

  /**
   * The `⋯` menu. Two taps from a comment to Report or Block, which is the
   * bar App Store guideline 1.2 sets for user-generated content.
   *
   * Your own comment offers Delete and nothing else — reporting or blocking
   * yourself is not a feature, and the server would refuse the block anyway.
   */
  const menuActions = (c: Comment): SheetAction[] => {
    const mine = myId !== null && c.author.id === myId;
    if (mine) {
      return [
        {
          text: t('community.comments.delete'),
          icon: 'trash-outline',
          destructive: true,
          onPress: () => confirmDelete(c),
        },
      ];
    }
    return [
      { text: t('community.comments.report'), icon: 'flag-outline', onPress: () => setReportFor(c) },
      {
        text: t('community.comments.block'),
        icon: 'ban-outline',
        destructive: true,
        onPress: () => confirmBlock(c),
      },
    ];
  };

  const reportActions = (c: Comment): SheetAction[] =>
    REPORT_REASONS.map((reason) => ({
      text: t(reportReasonKey(reason)),
      icon: 'alert-circle-outline' as const,
      onPress: () => sendReport(c, reason),
    }));

  /** Top-level comments with their expanded replies folded in, in order. */
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const c of items) {
      out.push({ comment: c, depth: 0 });
      if (expanded.has(c.id)) {
        for (const r of replies[c.id] ?? []) out.push({ comment: r, depth: 1 });
      }
    }
    return out;
  }, [items, replies, expanded]);

  const bodyFailure = commentBodyError(text);
  const overLength = bodyFailure === 'too_long';
  // Send is live for words, or for a picture with none.
  const canSend = overLength ? false : bodyFailure === null || attach.attachment != null;

  return (
    <View style={styles.fill}>
      <FlatList
        style={styles.capped}
        data={rows}
        keyExtractor={(r) => r.comment.id}
        contentContainerStyle={styles.listContent}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshing={refreshing}
        onRefresh={() => void load('refresh')}
        onEndReachedThreshold={0.4}
        onEndReached={() => void loadMore()}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.spinner} color={colors.dim} />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.emptyText}>{t('community.comments.empty')}</Text>
            </View>
          )
        }
        ListFooterComponent={
          loadingMore ? <ActivityIndicator style={styles.spinner} color={colors.dim} /> : null
        }
        renderItem={({ item: row }) => (
          <CommentRow
            row={row}
            picture={lookupPicture}
            now={now}
            mine={myId !== null && row.comment.author.id === myId}
            revealed={revealed.has(row.comment.id)}
            expanded={expanded.has(row.comment.id)}
            onReveal={() => {
              tapSelection();
              setRevealed((prev) => new Set(prev).add(row.comment.id));
            }}
            onLike={() => void toggleLike(row.comment)}
            onReply={() => {
              tapSelection();
              setReplyTo(row.comment);
            }}
            onToggleReplies={() => void toggleReplies(row.comment)}
            onPress={() => router.push(`/comment/${encodeURIComponent(row.comment.id)}`)}
            onMenu={() => {
              tapSelection();
              setMenuFor(row.comment);
            }}
            onPressAuthor={() => router.push(`/profile/${encodeURIComponent(row.comment.author.handle)}`)}
          />
        )}
      />

      {joined ? (
        <View style={styles.composer}>
          {replyTo && (
            <View style={styles.replyBar}>
              <Text style={styles.replyBarText} numberOfLines={1}>
                {t('community.comments.replyingTo', { handle: replyTo.author.handle })}
              </Text>
              <Pressable hitSlop={10} onPress={() => setReplyTo(null)}>
                <Ionicons name="close" size={18} color={colors.dim} />
              </Pressable>
            </View>
          )}
          {/* THE PICTURE SITS ABOVE THE BOX, with the one thing its author
              needs to know: it is not visible yet. A picture that simply did
              not appear after posting would be reported as a bug. */}
          {attach.attachment != null && (
            <View style={styles.attachRow}>
              <Image source={{ uri: attach.attachment.uri }} style={styles.attachThumb} contentFit="cover" />
              <Text style={styles.attachNote} numberOfLines={2}>
                {t('community.comments.willReview')}
              </Text>
              <Pressable hitSlop={10} onPress={attach.clear}>
                <Ionicons name="close-circle" size={22} color={colors.dim} />
              </Pressable>
            </View>
          )}
          <View style={styles.composerRow}>
            {/* Plus only, and refused before the picker rather than after —
                but hidden entirely where Plus cannot be bought, because there
                the refusal has no paywall to offer and reads as a dead button.
                See `canAttach`. */}
            {attach.canAttach && (
              <Pressable hitSlop={8} style={styles.attachBtn} onPress={attach.open} disabled={sending}>
                <Ionicons
                  name={attach.attachment ? 'image' : 'image-outline'}
                  size={19}
                  color={attach.attachment ? colors.yellow : colors.dim}
                />
              </Pressable>
            )}
            <Pressable
              hitSlop={8}
              style={[styles.spoilerToggle, spoiler && styles.spoilerToggleOn]}
              onPress={() => {
                tapSelection();
                setSpoiler((v) => !v);
              }}>
              <Ionicons
                name={spoiler ? 'eye-off' : 'eye-off-outline'}
                size={16}
                color={spoiler ? colors.onYellow : colors.dim}
              />
              <Text style={[styles.spoilerToggleText, spoiler && { color: colors.onYellow }]}>
                {t('community.comments.spoilerToggle')}
              </Text>
            </Pressable>

            <TextInput
              style={[styles.input, overLength && styles.inputBad]}
              value={text}
              onChangeText={setText}
              placeholder={t('community.comments.placeholder')}
              placeholderTextColor={colors.faint}
              multiline
              // A hard cap of the limit itself would let a paste be silently
              // truncated mid-sentence; a little headroom lets the counter and
              // the disabled Send button explain what happened instead.
              maxLength={COMMENT_BODY_MAX + 200}
              editable={!sending}
            />

            <Pressable
              hitSlop={8}
              disabled={!canSend || sending}
              style={[styles.send, (!canSend || sending) && styles.sendOff]}
              onPress={() => void send()}>
              {sending ? (
                <ActivityIndicator size="small" color={colors.onYellow} />
              ) : (
                <Ionicons
                  name={I18nManager.isRTL ? 'arrow-back' : 'arrow-forward'}
                  size={18}
                  color={colors.onYellow}
                />
              )}
            </Pressable>
          </View>
          {overLength && <Text style={styles.overLength}>{t('community.comments.errTooLong')}</Text>}
        </View>
      ) : (
        <Pressable style={styles.joinRow} onPress={() => router.push('/join')}>
          <Ionicons name="chatbubbles-outline" size={18} color={colors.yellow} />
          <Text style={styles.joinText}>{t('community.comments.joinToComment')}</Text>
        </Pressable>
      )}

      {attach.ui}
      <ActionSheet
        visible={menuFor !== null}
        title={menuFor ? `@${menuFor.author.handle}` : undefined}
        actions={menuFor ? menuActions(menuFor) : []}
        onClose={() => setMenuFor(null)}
      />
      <ActionSheet
        visible={reportFor !== null}
        title={t('community.report.title')}
        actions={reportFor ? reportActions(reportFor) : []}
        onClose={() => setReportFor(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  /* A frosted panel the size a picture would be, so the card does not jump
     when the real one arrives. */
  pictureWaiting: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pictureWaitingText: { color: colors.dim, fontSize: 12.5, fontWeight: '600' },
  attachBtn: { paddingHorizontal: 4, paddingVertical: 6, justifyContent: 'center' },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 8, paddingHorizontal: 12 },
  attachThumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: '#1C1C1E' },
  attachNote: { flex: 1, color: '#6B6B72', fontSize: 12, lineHeight: 16 },
  fill: { flex: 1 },
  capped: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' },
  listContent: { paddingBottom: 16 },
  spinner: { marginVertical: 24 },

  card: {
    backgroundColor: colors.panel,
    borderRadius: radius.card,
    marginHorizontal: space.md,
    marginBottom: 10,
    padding: 14,
  },
  // marginStart, not marginLeft: the indent has to move to the right-hand side
  // in Arabic or a reply reads as a top-level comment.
  cardReply: { marginStart: space.xxl + space.md, backgroundColor: colors.card },

  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // The tappable pair inside the head. `flex: 1` so it takes the row's width
  // and leaves the ⋯ its own corner rather than overlapping it.
  headTap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headText: { flex: 1 },
  handle: { color: colors.text, fontWeight: '700', fontSize: 14.5 },
  meta: { color: colors.faint, fontSize: 12 },
  menuBtn: { paddingHorizontal: 4 },

  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.raise },
  avatarLetter: { alignItems: 'center', justifyContent: 'center' },
  avatarLetterText: { color: colors.yellow, fontWeight: '800', fontSize: 15 },

  translate: { color: colors.blue, fontSize: 13, fontWeight: '700', marginTop: 8 },
  // The failure is not red: a translation that did not arrive costs the reader
  // nothing they had, and shouting about it beside somebody's words is louder
  // than the thing that failed.
  translateFailed: { color: colors.dim, fontWeight: '600' },
  body: { color: colors.text, fontSize: 15, lineHeight: 21, marginTop: 10, textAlign: 'left' },
  picture: { width: '100%', borderRadius: radius.card, marginTop: 10, backgroundColor: '#000' },
  orphanReply: { color: colors.faint, fontSize: 12.5, marginTop: 8, fontStyle: 'italic' },
  picturePlaceholder: { color: colors.dim, fontSize: 15, fontStyle: 'italic', marginTop: 10 },

  spoiler: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: radius.card,
    backgroundColor: colors.raise,
  },
  spoilerText: { color: colors.dim, fontSize: 13.5, flex: 1 },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 12 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionCount: { color: '#C9C9CF', fontSize: 13 },
  repliesLink: { color: colors.blue, fontSize: 13, fontWeight: '600' },
  mineDot: { marginStart: 'auto', width: 6, height: 6, borderRadius: 3, backgroundColor: colors.yellow },

  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingHorizontal: space.md,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 8,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    maxHeight: 120,
    minHeight: 40,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    textAlign: 'left',
  },
  inputBad: { borderWidth: 1, borderColor: colors.danger },
  overLength: { color: colors.danger, fontSize: 12.5 },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { opacity: 0.4 },

  spoilerToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 40,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
  },
  spoilerToggleOn: { backgroundColor: colors.yellow },
  spoilerToggleText: { color: colors.dim, fontSize: 12, fontWeight: '700' },

  replyBar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  replyBarText: { color: colors.dim, fontSize: 12.5, flex: 1 },

  joinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  joinText: { color: colors.yellow, fontSize: 14.5, fontWeight: '700' },

  empty: { alignItems: 'center', gap: 12, marginTop: 70, paddingHorizontal: 40 },
  emptyEmoji: { fontSize: 40 },
  emptyText: { color: colors.dim, fontSize: 15, textAlign: 'center' },
});
