/**
 * Somebody else's profile.
 *
 * FOUR THINGS LOOK IDENTICAL HERE, and that is the design working. A handle
 * that never existed, an account that deleted itself, an account that blocked
 * you and an account you blocked all arrive as the same 404, so this screen
 * says "not found" and stops. Anything more helpful — "this user blocked you",
 * or even a 403 that merely confirms the account is real — hands a blocked
 * person exactly the information a block exists to withhold.
 *
 * A PRIVATE PROFILE STILL RENDERS ITS SHELL: avatar, display name, handle, and
 * a line saying it is private. It has to, because you cannot ask to follow
 * somebody you cannot find. What it withholds — bio, links, the four counts,
 * the follower list and the lists — comes back the moment `followed_by_me` is
 * true. `visibleProfileFields` in pure.ts is the same matrix the server
 * applies, so the two cannot drift.
 *
 * NO AVATAR UPLOAD, and no broken image where one would go: the Worker has no
 * R2 binding, so `avatar_key` cannot be turned into a URL and the letter is the
 * honest rendering (see `components/person-row.tsx`).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { Image } from 'expo-image';

import { ApiError } from '@/api';
import { blockProfile, fetchProfileComments, reportProfile, type Comment } from '@/community-comments';
import { getProfileId, useJoined } from '@/community-session';
import {
  fetchProfile,
  fetchProfileLists,
  follow,
  unfollow,
  fetchPublishedProfile,
  type PublicProfile,
  type PublishedList,
  type PublishedProfile,
  type PublishedTitle,
} from '@/community-profiles';
import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { CommunityAvatar } from '@/components/person-row';
import { ProfileShelf, StatsRail, type RailItem } from '@/components/profile-sections';
import { getComments, getMovies, getShowNames } from '@/db';
import { episodeMeta } from '@/metadata';
import { documentFileUri } from '@/library';
import { CONTENT_MAX_WIDTH, ContentColumn, NavHeader, PillButton, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { currentLocale, t } from '@/i18n';
import { formatCount } from '@/locale-resolve';
import { clockOf } from '@/stats-calc';
import {
  commentErrorKey,
  isOrphanedReply,
  localPictureIndex,
  pictureKeyOf,
  slug,
  visibleProfileFields,
} from '@/pure';
import { colors, radius, space } from '@/theme';

/** What the screen is showing right now. `missing` is the 404, in all its forms. */
type State =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'failed'; message: string }
  | { phase: 'ready'; profile: PublicProfile };

/**
 * The title a server comment is about, resolved against the local library.
 *
 * The server stores an IDENTITY, not a name: `tvdb:121361` or
 * `title:toy-story-5|1994`. That is right — names are ambiguous and change —
 * but it means the phone has to say what it means, and only the phone has the
 * library to say it with. When it cannot, the key itself is shown rather than
 * a blank: an unrecognised row is still a row the user wrote.
 */
function targetLabel(c: Comment): string {
  if (c.target_source === 'tvdb') {
    const show = getShowNames().find((s) => String(s.tvdbId) === c.target_key);
    const name = show?.name ?? `#${c.target_key}`;
    if (c.season == null) return name;
    if (c.episode == null) return `${name} S${c.season}`;
    // The SAME words the episode page uses. An episode no catalogue carries has
    // no title there and reads "Unknown episode"; printing its code here left
    // the two screens disagreeing about the same episode — one calling it
    // S4E0, the other saying it does not know what it is.
    const known = show ? episodeMeta(show.tvdbId, c.season, c.episode)?.title : null;
    if (!known && c.episode === 0) return `${name} · ${t('show.episodeUnknownTitle')}`;
    return `${name} S${c.season}E${c.episode}`;
  }
  // `slug|year` — matched back against the library the same way it was built.
  const bare = c.target_key.split('|')[0] ?? '';
  const film = getMovies().find((m) => slug(m.name) === bare);
  return film?.name ?? bare.replace(/-/g, ' ');
}

/**
 * Open what the comment is ABOUT — the episode itself where there is one.
 *
 * Not the series page. A comment was written about one episode, and landing on
 * a show with sixty seasons leaves the reader to go and find it.
 */
function openTarget(c: Comment): void {
  if (c.target_source === 'tvdb') {
    const id = Number(c.target_key);
    if (!(id > 0)) return;
    // The same rule the archive pill follows: an episode no catalogue can
    // identify opens the SHOW, because its own page cannot say what it was.
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
 * Open a shelf tile.
 *
 * THE KEY IS THE IDENTITY: a show is `tvdb:<id>` and a film is
 * `title:<slug>|<year>` — the same pair the comments and ratings use — so a
 * tile opens the page the reader expects rather than searching by a name their
 * own library may spell differently.
 *
 * A film is opened by NAME because that is what the film route takes, and the
 * PUBLISHED name is used rather than the slug so punctuation survives the round
 * trip. The slug is the fallback for a shelf published before names were sent.
 */
function openTitle(x: PublishedTitle, kind: 'show' | 'movie'): void {
  if (kind === 'show') {
    const id = Number(x.target_key);
    if (id > 0) router.push(`/show/${id}`);
    return;
  }
  const name = x.name ?? x.target_key.split('|')[0]?.replace(/-/g, ' ') ?? '';
  if (name) router.push(`/movie/${encodeURIComponent(name)}`);
}

/** A published title as the shared rail wants it: a key, a name, a picture. */
function railOf(titles: readonly PublishedTitle[]): RailItem[] {
  return titles.map((x) => ({ key: x.target_key, name: x.name ?? '', uri: x.poster }));
}

/** The rail hands back a key; this finds the title it belongs to and opens it. */
function openByKey(titles: readonly PublishedTitle[], key: string, kind: 'show' | 'movie'): void {
  const hit = titles.find((x) => x.target_key === key);
  if (hit) openTitle(hit, kind);
}

/** "2 Apr 2019" — the same short form the archive screen uses. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(currentLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
}


function Count({ value, label, onPress }: { value: number; label: string; onPress?: () => void }) {
  return (
    <Pressable style={styles.countCell} onPress={onPress} disabled={!onPress}>
      <Text style={styles.countNum}>{formatCount(value, currentLocale())}</Text>
      <Text style={styles.countLbl}>{label}</Text>
    </Pressable>
  );
}

export default function PublicProfileScreen() {
  const { handle: raw } = useLocalSearchParams<{ handle?: string }>();
  const handle = raw ?? '';
  const joined = useJoined();
  const myId = getProfileId();

  const [state, setState] = useState<State>({ phase: 'loading' });
  const [lists, setLists] = useState<PublishedList[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [pub, setPub] = useState<PublishedProfile>({ stats: null, shows: [], movies: [] });
  const [menu, setMenu] = useState(false);
  // Read once at the top: the Stats rail sizes its cards from this, and calling
  // the hook inside the conditionally-rendered section would break the rule of
  // hooks the moment the profile is private.
  const statsWidth = Math.min(useWindowDimensions().width, CONTENT_MAX_WIDTH) - 2 * space.lg;
  // Built once per screen, not per row: a five-thousand-comment library would
  // otherwise be a full scan for every card rendered.
  const pictures = useMemo(() => localPictureIndex(getComments()), []);
  const [busy, setBusy] = useState(false);

  // Fetched inside the effect and applied in the `then`: a setState in an
  // effect body is a cascading render, and `cancelled` covers a sheet
  // dismissed while the request is still in the air.
  useEffect(() => {
    let cancelled = false;
    void fetchProfile(handle)
      .then((p) => {
        if (cancelled) return;
        setState({ phase: 'ready', profile: p });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const code = e instanceof ApiError ? e.code : 'unknown';
        setState(code === 'not_found' ? { phase: 'missing' } : { phase: 'failed', message: t(commentErrorKey(code)) });
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  // What this person has actually written. A third independent request for the
  // reason the lists are a second one — and the one that makes the count band
  // mean something: before it existed the screen printed "2 comments" over an
  // empty page, which is the wrong thing to say to somebody who has just
  // imported seven years of their own writing.
  useEffect(() => {
    let cancelled = false;
    void fetchProfileComments(handle).then((page) => {
      if (!cancelled) setComments(page.items);
    });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  // The shelves and the two totals. A fourth independent request for the same
  // reason as the third: a private profile refuses this one while the profile
  // itself renders perfectly, so a failure must cost the shelves and nothing
  // else. See `fetchPublishedProfile` — it resolves to the empty shape rather
  // than throwing, so there is no error branch to write here.
  useEffect(() => {
    let cancelled = false;
    void fetchPublishedProfile(handle).then((p) => {
      if (!cancelled) setPub(p);
    });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  // The lists are a second, independent request: a private profile answers 403
  // here while the profile itself renders perfectly well, so a failure must
  // cost the shelf and nothing else.
  useEffect(() => {
    let cancelled = false;
    void fetchProfileLists(handle)
      .then((items) => {
        if (!cancelled) setLists(items);
      })
      .catch(() => {
        if (!cancelled) setLists([]);
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  const isSelf = state.phase === 'ready' && myId !== null && state.profile.id === myId;

  /**
   * Block, Report, Share — design/referance/52-user-profile-sarah-menu.png.
   *
   * BLOCK ASKS FIRST and says what it does, because there is no way back from
   * this screen: the profile becomes a 404 the moment it lands, so no "unblock"
   * button can be left behind to offer.
   *
   * REPORT says FILED, not judged. Promising an outcome the queue has not
   * reached is a lie somebody else then has to live with.
   */
  const profileActions: SheetAction[] = [
    {
      text: t('community.comments.block'),
      icon: 'ban-outline',
      destructive: true,
      onPress: () => {
        setMenu(false);
        if (state.phase !== 'ready') return;
        const target = state.profile;
        Alert.alert(
          t('community.profile.blockConfirm', { handle: target.handle }),
          t('community.profile.blockBody'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('community.comments.block'),
              style: 'destructive',
              onPress: () => {
                void blockProfile(target.id)
                  .then(() => router.back())
                  .catch((e: unknown) =>
                    Alert.alert(
                      t('community.profile.followFailedTitle'),
                      t(commentErrorKey(e instanceof ApiError ? e.code : 'unknown')),
                    ),
                  );
              },
            },
          ],
        );
      },
    },
    {
      text: t('community.comments.report'),
      icon: 'flag-outline',
      onPress: () => {
        setMenu(false);
        if (state.phase !== 'ready') return;
        void reportProfile(state.profile.id, 'other')
          .then(() => Alert.alert(t('community.profile.reportedTitle'), t('community.profile.reportedBody')))
          .catch((e: unknown) =>
            Alert.alert(
              t('community.profile.followFailedTitle'),
              t(commentErrorKey(e instanceof ApiError ? e.code : 'unknown')),
            ),
          );
      },
    },
    {
      text: t('common.share'),
      icon: 'share-outline',
      onPress: () => {
        setMenu(false);
        if (state.phase !== 'ready') return;
        void Share.share({ message: `@${state.profile.handle} — OpenTV` }).catch(() => {});
      },
    },
  ];

  const toggleFollow = useCallback(async () => {
    if (state.phase !== 'ready' || busy) return;
    const p = state.profile;
    const following = p.followed_by_me;
    tapLight();
    setBusy(true);
    // Optimistic, counts included: the button flips under the finger, and the
    // follower number beside it must not disagree with it for a whole round
    // trip. `visibleProfileFields` re-runs because unfollowing a private
    // profile is exactly the moment its bio and counts have to disappear.
    setState({
      phase: 'ready',
      profile: visibleProfileFields(
        {
          ...p,
          followed_by_me: !following,
          counts: p.counts
            ? { ...p.counts, followers: Math.max(0, p.counts.followers + (following ? -1 : 1)) }
            : null,
        },
        !following,
        false,
      ),
    });
    try {
      if (following) await unfollow(p.id);
      else await follow(p.id);
    } catch (e) {
      // Straight back to what was on screen before the tap, then say why.
      setState({ phase: 'ready', profile: p });
      Alert.alert(
        t('community.profile.followFailedTitle'),
        t(commentErrorKey(e instanceof ApiError ? e.code : 'unknown')),
      );
    } finally {
      setBusy(false);
    }
  }, [state, busy]);

  if (state.phase === 'loading') {
    return (
      <Screen>
        <NavHeader close />
        <ActivityIndicator style={styles.spinner} color={colors.dim} />
      </Screen>
    );
  }

  if (state.phase === 'missing' || state.phase === 'failed') {
    return (
      <Screen>
        <NavHeader close />
        <View style={styles.notFound}>
          <Text style={styles.notFoundEmoji}>🕵️</Text>
          <Text style={styles.notFoundText}>
            {state.phase === 'missing' ? t('community.profile.notFound') : state.message}
          </Text>
        </View>
      </Screen>
    );
  }

  const p = state.profile;
  // A private profile shows the shell only. `counts === null` IS the server
  // saying so — the screen never re-derives that from `is_private`, so there is
  // one rule and one place it is decided.
  const detail = p.counts !== null;

  return (
    <Screen>
      {/* No title: the handle is the first thing in the body, in full size.
          Repeating it in the bar put the same word on screen three times. */}
      {/* The ••• of design/referance/52-user-profile-sarah-menu.png. Absent on
          your own profile: blocking or reporting yourself is not a thing, and a
          menu whose every item is inapplicable is worse than no menu. */}
      <NavHeader
        close
        right={
          !isSelf && joined ? (
            <Pressable hitSlop={10} onPress={() => setMenu(true)}>
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
            </Pressable>
          ) : undefined
        }
      />
      <FlatList
        // COMMENTS are the feed and the lists ride in the header. A profile is
        // read to find out what somebody thinks; the shelf of lists is context
        // for that, not the point of the page.
        data={detail ? comments : []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <ContentColumn>
            <View style={styles.head}>
              <CommunityAvatar person={p} size={78} />
              <View style={styles.headText}>
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {p.display_name || `@${p.handle}`}
                  </Text>
                  {p.is_plus && (
                    <View style={styles.plus}>
                      <Text style={styles.plusText}>{t('community.profile.plus')}</Text>
                    </View>
                  )}
                </View>
                {/* Only when there is a DISPLAY NAME above it. Without one the
                    line above already falls back to `@handle`, so this printed
                    the same string twice, one under the other — which is what
                    the header looked like for every account that has not set a
                    name, including every account today. */}
                {!!p.display_name && <Text style={styles.handle}>@{p.handle}</Text>}
              </View>
            </View>

            {p.bio != null && p.bio.length > 0 && <Text style={styles.bio}>{p.bio}</Text>}

            {!isSelf && joined && (
              <View style={styles.followRow}>
                <PillButton
                  label={
                    p.followed_by_me ? t('community.profile.following') : t('community.profile.follow')
                  }
                  variant={p.followed_by_me ? 'outline' : 'yellow'}
                  onPress={() => void toggleFollow()}
                />
              </View>
            )}
            {!isSelf && !joined && (
              <Pressable style={styles.joinRow} onPress={() => router.push('/join')}>
                <Ionicons name="people-outline" size={18} color={colors.yellow} />
                <Text style={styles.joinText}>{t('community.profile.joinToFollow')}</Text>
              </Pressable>
            )}

            {detail && p.counts !== null ? (
              <View style={styles.countBand}>
                {/* SOMEBODY ELSE's numbers, straight from the server and never
                    merged: their TV Time friends are their business and are not
                    on this phone to count. The user's own profile is the
                    Profile tab, which counts the merged list it opens. */}
                <Count value={p.counts.followers} label={t('profile.statFollowers')} />
                <Count value={p.counts.following} label={t('profile.statFollowing')} />
                <Count value={p.counts.comments} label={t('profile.statComments')} />
                <Count value={p.counts.lists} label={t('community.profile.lists')} />
              </View>
            ) : (
              <View style={styles.private}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.dim} />
                <Text style={styles.privateText}>{t('community.profile.private')}</Text>
              </View>
            )}

            {detail && lists.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>{t('community.profile.listsTitle')}</Text>
                {lists.map((l) => (
                  <Pressable
                    key={l.id}
                    style={styles.listRow}
                    onPress={() => router.push(`/list/${encodeURIComponent(l.id)}`)}>
                    <Ionicons name="albums-outline" size={20} color={colors.yellow} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.listName} numberOfLines={1}>
                        {l.name}
                      </Text>
                      <Text style={styles.listSub}>{t('community.list.items', { count: l.item_count })}</Text>
                    </View>
                  </Pressable>
                ))}
              </>
            )}

            {/* STATS — the design's headline pair. Absent, not zeroed, for an
                account that has never published: "has watched nothing" and "has
                not synced" are different sentences. */}
            {detail && pub.stats && (
              <>
                <StatsRail
                  contentWidth={statsWidth}
                  cards={[
                    { key: 'tv', title: t('profile.tvTimeCard'), kind: 'clock', ...clockOf(pub.stats.minutes_watched) },
                    {
                      key: 'eps',
                      title: t('profile.episodesWatchedCard'),
                      kind: 'number',
                      value: formatCount(pub.stats.episodes_watched, currentLocale()),
                    },
                    { key: 'mv', title: t('profile.movieTimeCard'), kind: 'clock', ...clockOf(pub.stats.movie_minutes ?? 0) },
                    {
                      key: 'mvn',
                      title: t('profile.moviesWatchedCard'),
                      kind: 'number',
                      value: formatCount(pub.stats.movies_count, currentLocale()),
                    },
                  ]}
                />
              </>
            )}

            {/* The shelves. Each is absent when empty rather than an empty rail:
                a profile with no films should not have a Movies heading. */}
            {detail && (
              <>
                {/* The SAME components the Profile tab renders — see
                    `components/profile-sections.tsx`. Two implementations of one
                    design diverge on the first change, and "their profile looks
                    exactly like mine" then has to be maintained by remembering. */}
                <ProfileShelf
                  title={t('community.profile.showsTitle')}
                  items={railOf(pub.shows)}
                  onItemPress={(k) => openByKey(pub.shows, k, 'show')}
                />
                <ProfileShelf
                  title={t('community.profile.favouriteShows')}
                  heart
                  items={railOf(pub.shows.filter((x) => x.favourite))}
                  onItemPress={(k) => openByKey(pub.shows, k, 'show')}
                />
                <ProfileShelf
                  title={t('community.profile.moviesTitle')}
                  items={railOf(pub.movies)}
                  onItemPress={(k) => openByKey(pub.movies, k, 'movie')}
                />
                <ProfileShelf
                  title={t('community.profile.favouriteMovies')}
                  heart
                  items={railOf(pub.movies.filter((x) => x.favourite))}
                  onItemPress={(k) => openByKey(pub.movies, k, 'movie')}
                />
              </>
            )}

            {detail && comments.length > 0 && (
              <Text style={styles.sectionTitle}>{t('profile.statComments')}</Text>
            )}
          </ContentColumn>
        }
        renderItem={({ item }) => (
          <ContentColumn>
            <Pressable style={styles.commentRow} onPress={() => openTarget(item)}>
              <Text style={styles.commentWhere} numberOfLines={1}>
                {targetLabel(item)}
              </Text>
              {/* See `isOrphanedReply`: an imported reply's original was
                  somebody else's comment and was never in the export. */}
              {isOrphanedReply(pictures.get(pictureKeyOf(item)), item.parent_id) && (
                <Text style={styles.commentReply}>{t('community.comments.orphanReply')}</Text>
              )}
              {item.body.length > 0 && <Text style={styles.commentBody}>{item.body}</Text>}
              {/* THE PICTURE, from this phone. The server stores comment images
                  and deliberately serves none — they sit at scan_status
                  'pending' until scanning is live — so a comment fetched from
                  it has no picture in it, and the picture-ONLY ones (two of the
                  four in the reference export) rendered as an empty card. The
                  file is already here; `localPictureIndex` joins them on the
                  timestamp and body both sides derive from the same row.

                  A comment written on another device has no local file and
                  keeps the caption, which is the honest thing to show. */}
              {(() => {
                const local = pictures.get(pictureKeyOf(item));
                const uri = documentFileUri(local?.image) ?? local?.imageUrl ?? null;
                if (uri) {
                  return (
                    <Image
                      source={{ uri }}
                      style={[styles.commentImage, { aspectRatio: local?.ratio || 4 / 3 }]}
                      contentFit="cover"
                      cachePolicy="disk"
                    />
                  );
                }
                return item.body.length === 0 ? (
                  <Text style={styles.commentPhoto}>{t('community.profile.photoComment')}</Text>
                ) : null;
              })()}
              <Text style={styles.commentMeta}>{shortDate(item.created_at)}</Text>
            </Pressable>
          </ContentColumn>
        )}
      />
      <ActionSheet
        visible={menu}
        title={`@${p.handle}`}
        onClose={() => setMenu(false)}
        actions={profileActions}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: 60 },
  listContent: { paddingBottom: 32 },

  notFound: { alignItems: 'center', gap: 14, marginTop: 80, paddingHorizontal: 40 },
  notFoundEmoji: { fontSize: 44 },
  notFoundText: { color: colors.dim, fontSize: 15.5, textAlign: 'center', lineHeight: 21 },

  head: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: space.lg, paddingTop: 10 },
  headText: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: colors.text, fontSize: 21, fontWeight: '800', flexShrink: 1 },
  handle: { color: colors.faint, fontSize: 14, marginTop: 2 },
  plus: { backgroundColor: colors.yellow, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  plusText: { color: colors.onYellow, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.8 },

  bio: { color: colors.text, fontSize: 15, lineHeight: 21, paddingHorizontal: space.lg, marginTop: 14, textAlign: 'left' },

  followRow: { paddingHorizontal: space.lg, marginTop: 16, alignItems: 'flex-start' },
  joinRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.lg, marginTop: 16 },
  joinText: { color: colors.yellow, fontSize: 14.5, fontWeight: '700' },

  countBand: {
    flexDirection: 'row',
    marginTop: 20,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  countCell: { flex: 1, alignItems: 'center', paddingVertical: 13 },
  countNum: { color: colors.text, fontSize: 19, fontWeight: '700' },
  countLbl: { color: colors.dim, fontSize: 12, marginTop: 1, textAlign: 'center' },

  private: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 22,
    marginHorizontal: space.lg,
    padding: 14,
    borderRadius: radius.card,
    backgroundColor: colors.panel,
  },
  privateText: { color: colors.dim, fontSize: 14, flex: 1, lineHeight: 19 },

  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    paddingHorizontal: space.lg,
    marginTop: 26,
    marginBottom: 6,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1B1B1E',
  },
  listName: { color: colors.text, fontSize: 15.5, fontWeight: '600' },
  listSub: { color: colors.faint, fontSize: 12.5, marginTop: 2 },
  commentRow: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: space.lg,
    marginTop: 10,
    gap: 6,
  },
  // The title first and in the accent colour, because a profile is read top to
  // bottom and "what is this about" comes before "what did they say".
  commentWhere: { color: colors.yellow, fontSize: 12.5, fontWeight: '800' },
  commentBody: { color: colors.text, fontSize: 15, lineHeight: 21 },
  commentPhoto: { color: colors.dim, fontSize: 15, fontStyle: 'italic' },
  commentMeta: { color: colors.faint, fontSize: 12 },
  commentImage: { width: '100%', borderRadius: radius.card, backgroundColor: '#000' },
  commentReply: { color: colors.faint, fontSize: 12, fontStyle: 'italic' },

  // ── the published half ─────────────────────────────────────────────────────
  statCards: { flexDirection: 'row', gap: 10, marginTop: 10 },
  statCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    paddingVertical: space.lg,
    paddingHorizontal: space.md,
    alignItems: 'center',
    gap: 10,
  },
  statCardLabel: { color: colors.dim, fontSize: 12.5, fontWeight: '700' },
  clockRow: { flexDirection: 'row', gap: 14 },
  statBig: { color: colors.text, fontSize: 24, fontWeight: '800' },
});
