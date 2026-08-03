/**
 * Everything one person has written — the `comments` count's destination.
 *
 * WHY IT IS ITS OWN SCREEN. It used to hang off the bottom of their profile,
 * below four shelves, which put a stranger's writing somewhere nobody scrolls
 * to and made their profile a different shape from your own. On YOUR profile
 * the comments count is a button that opens your archive; on theirs it now
 * opens this. Same band, same third cell, same gesture — different data, which
 * is the only thing that should differ.
 *
 * THE CARDS ARE THE ARCHIVE'S CARDS — `CommentCard` via `CommentsList`, the
 * same components the owner's own comments screen draws. This screen used to
 * borrow the thread's `CommentRow` instead, and the two comment lists drifted
 * exactly as the two profiles once had: one printed `Mon, Jul 6, 2026` above a
 * `RIVERDALE ›` pill, the other `3 weeks ago · From TV Time` under a yellow
 * heading. One component, so there is nothing left to drift.
 *
 * WHAT THAT COST. The thread's relative time carried a `From TV Time` marker
 * saying a comment was imported rather than written here; the archive's card
 * has nowhere to put it, and it is gone. `is_spoiler` is NOT gone — the curtain
 * moved into `CommentCard` deliberately, because a card without it would have
 * revealed every flagged comment on a public profile.
 *
 * LIKING HAPPENS HERE. Replying does not: a reply belongs under the thing it
 * answers, where the person reading it can see what that was, so Reply opens
 * the title's thread with the composer already aimed at that comment. The
 * button is in the same place and says the same word either way.
 *
 * NO PICTURES. The server stores comment images and serves none of them yet —
 * they sit at `scan_status = 'pending'` until scanning is live — and the local
 * files belong to this phone's owner alone, so a picture-only comment shows its
 * caption rather than somebody else's photograph.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet } from 'react-native';

import { ApiError } from '@/api';
import {
  avatarUri,
  fetchProfileComments,
  likeComment,
  reportComment,
  unlikeComment,
  type Comment,
} from '@/community-comments';
import { getProfileId, useJoined } from '@/community-session';
import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { formatCommentDate } from '@/components/comment-card';
import { CommentsList } from '@/components/comments-list';
import { NavHeader, Screen } from '@/components/ui';
import { targetLabel } from '@/community-target';
import { getMeta, getMovies, hasWatchedTarget } from '@/db';
import { tapLight } from '@/haptics';
import { episodeMeta } from '@/metadata';
import { t } from '@/i18n';
import { commentErrorKey, curtainReason, HIDE_UNSEEN_KEY, slug } from '@/pure';
import { colors, space } from '@/theme';

/** Open what the comment is ABOUT — the episode itself where there is one. */
function openTarget(c: Comment): void {
  if (c.target_source === 'tvdb') {
    const id = Number(c.target_key);
    if (!(id > 0)) return;
    const known = c.season != null && c.episode != null ? episodeMeta(id, c.season, c.episode)?.title : null;
    const unknown = c.episode === 0 && !known;
    router.push(
      c.season != null && c.episode != null && !unknown ? `/episode/${id}-s${c.season}e${c.episode}` : `/show/${id}`,
    );
    return;
  }
  const bare = c.target_key.split('|')[0] ?? '';
  const film = getMovies().find((m) => slug(m.name) === bare);
  if (film) router.push(`/movie/${encodeURIComponent(film.name)}`);
}

/**
 * The THREAD this comment lives in, so a reply lands under the thing it
 * answers. Season and episode ride along when the comment has them — a thread
 * without them is the show's own, which is a different conversation.
 */
function openThread(c: Comment): void {
  const title = targetLabel(c);
  const where = c.season != null ? `&season=${c.season}${c.episode != null ? `&episode=${c.episode}` : ''}` : '';
  router.push(
    `/thread?source=${c.target_source}&key=${encodeURIComponent(c.target_key)}${where}&title=${encodeURIComponent(title)}`,
  );
}

export default function UserCommentsScreen() {
  const { handle: raw } = useLocalSearchParams<{ handle?: string }>();
  const handle = raw ?? '';
  const joined = useJoined();
  const myId = getProfileId();

  const [items, setItems] = useState<Comment[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const [menuFor, setMenuFor] = useState<Comment | null>(null);

  /**
   * WHETHER THIS CARD IS COVERED, and why.
   *
   * `hasWatchedTarget` is a local read per comment. That is a handful of
   * indexed COUNT(*)s for a page of twenty-five, which is why it happens here
   * rather than being fetched: the server has no watch history to filter by,
   * and giving it one to enable this would trade the whole privacy position for
   * a curtain the phone can draw by itself.
   */
  const hideUnseen = getMeta(HIDE_UNSEEN_KEY) !== '0';
  const curtain = (c: Comment) =>
    curtainReason(c, revealed, {
      seen: hasWatchedTarget(c.target_source, c.target_key, c.season, c.episode),
      mine: myId !== null && c.author.id === myId,
      hideUnseen,
    });

  /**
   * Opening a comment about something unwatched ASKS FIRST.
   *
   * The card's curtain protects the feed, but the permalink screen shows the
   * comment and its whole reply thread — so tapping through is the moment a
   * reader can be spoiled several times over by one decision they did not
   * realise they were making.
   */
  const openComment = (c: Comment) => {
    const go = () => router.push(`/comment/${encodeURIComponent(c.id)}`);
    if (curtain(c) !== 'unseen') {
      go();
      return;
    }
    Alert.alert(t('community.comments.unseenConfirmTitle'), t('community.comments.unseenConfirmBody', { title: targetLabel(c) }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('community.comments.unseenConfirmOpen'), style: 'destructive', onPress: go },
    ]);
  };

  useEffect(() => {
    let cancelled = false;
    void fetchProfileComments(handle).then((page) => {
      if (cancelled) return;
      setItems(page.items);
      setCursor(page.next_cursor);
    });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  // Paged rather than loaded whole: seven imported years is thousands of rows,
  // and the count band above already says how many there are.
  const more = () => {
    if (!cursor) return;
    const at = cursor;
    setCursor(null);
    void fetchProfileComments(handle, at).then((page) => {
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setCursor(page.next_cursor);
    });
  };

  /**
   * OPTIMISTIC, then corrected by the server's count.
   *
   * The heart fills under the finger — a like that waits on a round trip reads
   * as a dead button — and the authoritative `like_count` replaces the guess
   * when it lands. A failure puts the card back exactly as it was rather than
   * leaving a heart that lies.
   */
  const toggleLike = (c: Comment) => {
    if (!joined) {
      router.push('/join');
      return;
    }
    tapLight();
    const liked = c.liked_by_me;
    const patch = (fn: (x: Comment) => Comment) =>
      setItems((prev) => (prev ?? []).map((x) => (x.id === c.id ? fn(x) : x)));

    patch((x) => ({ ...x, liked_by_me: !liked, like_count: Math.max(0, x.like_count + (liked ? -1 : 1)) }));
    void (liked ? unlikeComment(c.id) : likeComment(c.id))
      .then((res) => patch((x) => ({ ...x, liked_by_me: res.liked, like_count: res.like_count })))
      .catch(() => patch((x) => ({ ...x, liked_by_me: liked, like_count: c.like_count })));
  };

  const menuActions: SheetAction[] = menuFor
    ? [
        {
          text: t('community.comments.openTitle'),
          icon: 'tv-outline',
          onPress: () => {
            const c = menuFor;
            setMenuFor(null);
            openTarget(c);
          },
        },
        {
          text: t('community.comments.report'),
          icon: 'flag-outline',
          onPress: () => {
            const c = menuFor;
            setMenuFor(null);
            void reportComment(c.id, 'other')
              .then(() => Alert.alert(t('community.profile.reportedTitle'), t('community.profile.reportedBody')))
              .catch((e: unknown) =>
                Alert.alert(
                  t('community.profile.followFailedTitle'),
                  t(commentErrorKey(e instanceof ApiError ? e.code : 'unknown')),
                ),
              );
          },
        },
      ]
    : [];

  return (
    <Screen>
      <NavHeader close title={t('profile.statComments')} />
      {items === null ? (
        <ActivityIndicator style={styles.spinner} color={colors.dim} />
      ) : (
        <CommentsList
          // Nothing here can be reordered — the feed is the server's page order
          // — so the sort line the owner's screen carries would be a label for a
          // control that does not exist.
          showSort={false}
          onEndReached={more}
          items={items.map((c) => ({
            key: c.id,
            author: c.author.handle,
            // `avatarUri` returns null for a profile with no picture, and the
            // card falls back to the initial on a plain circle.
            avatar: (() => {
              const uri = avatarUri(c.author.avatar_key);
              return uri != null ? { uri } : null;
            })(),
            date: formatCommentDate(c.created_at),
            // WHAT IT IS ABOUT, in the pill. A thread does not need this —
            // every comment in it is about the same episode — but a profile's
            // feed crosses every title the person has watched, and a comment
            // with no subject is a sentence from nowhere.
            entity: targetLabel(c),
            body: c.body,
            isReply: c.parent_id !== null,
            likes: c.like_count,
            replies: c.reply_count,
            liked: c.liked_by_me,
            mine: myId !== null && c.author.id === myId,
            spoiler: curtain(c) !== null,
            spoilerReason: curtain(c) ?? undefined,
            revealed: revealed.has(c.id),
            onReveal: () => setRevealed((prev) => new Set(prev).add(c.id)),
            // Anywhere on the card opens THIS comment and its replies, not the
            // whole title's thread: from a profile feed the reader picked one
            // comment, and burying it among every other conversation on the show
            // is what made the reply count the only way in.
            onPress: () => openComment(c),
            onPressAuthor: () => router.push(`/profile/${encodeURIComponent(c.author.handle)}`),
            onPressEntity: () => openTarget(c),
            onLike: () => toggleLike(c),
            // A reply belongs under the thing it answers, so this opens the
            // thread rather than composing in a feed where the reader cannot
            // see what is being replied to.
            onReply: () => openThread(c),
            onMenu: () => setMenuFor(c),
          }))}
        />
      )}
      <ActionSheet
        visible={menuFor !== null}
        title={menuFor ? targetLabel(menuFor) : ''}
        onClose={() => setMenuFor(null)}
        actions={menuActions}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: 60 },
  where: {
    color: colors.yellow,
    fontSize: 12.5,
    fontWeight: '800',
    marginTop: 14,
    marginBottom: 2,
    paddingHorizontal: space.lg,
  },
});
