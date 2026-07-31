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
 * THE CARDS ARE THE THREAD'S CARDS — `CommentRow` from
 * `components/comment-thread.tsx`, not a copy of it. So a comment read here
 * looks and behaves exactly as it does under an episode: the same avatar, the
 * same relative time, the same spoiler curtain, the same heart with the same
 * count. Writing a second card for this screen is what made the two profiles
 * diverge, and it would have done the same to the two comment lists.
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
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text } from 'react-native';

import { ApiError } from '@/api';
import {
  fetchProfileComments,
  likeComment,
  reportComment,
  unlikeComment,
  type Comment,
} from '@/community-comments';
import { getProfileId, useJoined } from '@/community-session';
import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { CommentRow } from '@/components/comment-thread';
import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { getMovies, getShowNames } from '@/db';
import { tapLight } from '@/haptics';
import { episodeMeta } from '@/metadata';
import { t } from '@/i18n';
import { commentErrorKey, slug } from '@/pure';
import { colors, space } from '@/theme';

/**
 * The title a server comment is about, resolved against the local library.
 *
 * The server stores an IDENTITY, not a name: `tvdb:121361` or
 * `title:toy-story-5|1994`. That is right — names are ambiguous and change —
 * but it means the phone has to say what it means, and only the phone has the
 * library to say it with. When it cannot, the key itself is shown rather than
 * a blank: an unrecognised row is still a row somebody wrote.
 */
function targetLabel(c: Comment): string {
  if (c.target_source === 'tvdb') {
    const show = getShowNames().find((s) => String(s.tvdbId) === c.target_key);
    const name = show?.name ?? `#${c.target_key}`;
    if (c.season == null) return name;
    if (c.episode == null) return `${name} S${c.season}`;
    // The SAME words the episode page uses, so the two screens never disagree
    // about an episode no catalogue carries.
    const known = show ? episodeMeta(show.tvdbId, c.season, c.episode)?.title : null;
    if (!known && c.episode === 0) return `${name} · ${t('show.episodeUnknownTitle')}`;
    return `${name} S${c.season}E${c.episode}`;
  }
  const bare = c.target_key.split('|')[0] ?? '';
  const film = getMovies().find((m) => slug(m.name) === bare);
  return film?.name ?? bare.replace(/-/g, ' ');
}

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
  // Stamped when a page lands rather than read during render: `Date.now()` in
  // a render body is impure, and two renders of one state would disagree about
  // "3 hours ago". Same rule the thread follows.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    void fetchProfileComments(handle).then((page) => {
      if (cancelled) return;
      setItems(page.items);
      setCursor(page.next_cursor);
      setNow(Date.now());
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
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          onEndReachedThreshold={0.5}
          onEndReached={more}
          renderItem={({ item }) => (
            <ContentColumn>
              {/* WHAT IT IS ABOUT, above the card. A thread does not need this
                  — every comment in it is about the same episode — but a
                  profile's feed crosses every title the person has watched,
                  and a comment with no subject is a sentence from nowhere. */}
              <Pressable onPress={() => openTarget(item)}>
                <Text style={styles.where} numberOfLines={1}>
                  {targetLabel(item)}
                </Text>
              </Pressable>
              <CommentRow
                row={{ comment: item, depth: 0 }}
                now={now}
                mine={myId !== null && item.author.id === myId}
                revealed={revealed.has(item.id)}
                expanded={false}
                onReveal={() => setRevealed((prev) => new Set(prev).add(item.id))}
                onLike={() => toggleLike(item)}
                // A reply belongs under the thing it answers, so this opens the
                // thread rather than composing in a feed where the reader
                // cannot see what is being replied to.
                onReply={() => openThread(item)}
                onToggleReplies={() => openThread(item)}
                onMenu={() => setMenuFor(item)}
              />
            </ContentColumn>
          )}
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
