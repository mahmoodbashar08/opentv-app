import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, I18nManager, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Image } from 'expo-image';

import { icloudAvailableAsync, icloudSupported } from '@/backup';
import { dismissCommunityBanner, useCommunityBannerDismissed } from '@/community-prompt';
import { readUnreadCount, refreshUnreadCount } from '@/community-notifications';
import { fetchProfile, type PublicProfile } from '@/community-profiles';
import { getHandle, useJoined } from '@/community-session';
import { tapLight } from '@/haptics';
import { manualBackupOverdue, shareLibraryExport } from '@/manual-backup';
import { CONTENT_MAX_WIDTH, EmptyState } from '@/components/ui';
import { Poster } from '@/components/poster';
import seed from '@/seed';
import { getCommentCount, getCustomLists, getFavoriteMovies, getFavoriteShows, getMeta, getMovies, getShowProgress, getTotals, setMeta } from '@/db';
import { tvdbKeyFailed, userTvdbKey } from '@/tvdb';
import { isSeedLibrary, profileImageUri } from '@/library';
import { clockOf, computeMovieStats } from '@/stats-calc';
import { enableEpisodeNotifications, notificationsEnabled } from '@/notifications';
import { topBanner, unreadBadge } from '@/pure';
import { colors, radius, space } from '@/theme';
import { currentLocale, t } from '@/i18n';
import { formatCount } from '@/locale-resolve';

const { profile } = seed;

// your real TV Time cover + avatar, rescued from the export into the bundle
const COVER = require('../../../assets/profile/cover.jpg');
const AVATAR = require('../../../assets/profile/avatar.jpg');

// 3 full cards + ~80% of the 4th visible, like the real app.
// Sized from the LIVE window width, so an iPad rotation re-lays the rows out
// instead of keeping the geometry captured at import time.
//
// Profile is the one screen NOT wrapped in ContentColumn: it is a dashboard of
// bands and shelves with no prose to protect, so a 700pt column would leave
// half a 13" iPad black while showing FEWER posters than a phone does. Instead
// the screen runs full width and the ITEM size is capped — so the extra width
// buys more posters, not bigger ones.
const posterWidth = (w: number) => Math.round((Math.min(w, CONTENT_MAX_WIDTH) - space.lg - 3 * 8) / 3.8);
// the collage spans the full width, so it takes more tiles on a tablet rather
// than four stretched ones — same rule as the Lists screen
const listTiles = (w: number) => (w > CONTENT_MAX_WIDTH ? 8 : 4);
const listTileWidth = (w: number) => (w - 2 * space.lg - (listTiles(w) - 1) * 2) / listTiles(w);


// lists collage: 4 cropped tiles always fully visible — equal margins both
// sides (aligned with the section gutters), 2pt gaps between tiles

// live from the database — un/marking anything updates these
function movieClockNow() {
  const m = computeMovieStats();
  return { watched: m.watched, ...m.clock };
}

function ClockCell({ value, unit }: { value: number; unit: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={styles.clockNum}>{value}</Text>
      <Text style={styles.clockUnit}>{unit}</Text>
    </View>
  );
}

function SectHead({ title, onPress, heart }: { title: string; onPress?: () => void; heart?: boolean }) {
  return (
    <Pressable style={styles.sectHead} onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        {heart && (
          <View style={styles.heart}>
            <Ionicons name="heart" size={15} color="#FFF" />
          </View>
        )}
        <Text style={styles.sectTitle}>{title}</Text>
      </View>
      <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.dim} />
    </Pressable>
  );
}

function PosterRow({
  items,
  onItemPress,
}: {
  items: { key: string; name: string; uri?: string | null }[];
  onItemPress?: (key: string) => void;
}) {
  const W = useWindowDimensions().width;
  const POSTER_W = posterWidth(W);
  // horizontal FlatList so the row can hold the WHOLE library: only the
  // visible posters mount, and more render in as you scroll right
  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(it) => it.key}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingStart: space.lg, paddingEnd: space.sm, gap: 8 }}
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={5}
      renderItem={({ item: it }) => (
        <Pressable style={{ width: POSTER_W }} onPress={() => onItemPress?.(it.key)}>
          <Poster name={it.name} uri={it.uri} />
        </Pressable>
      )}
    />
  );
}

export default function ProfileScreen() {
  const { width: W } = useWindowDimensions();
  // the stats mini-cards are sized as a fraction of this rather than of the
  // raw window, so they stay card-sized on a tablet instead of growing into
  // billboards — more cards visible, same size
  const CONTENT_W = Math.min(W, CONTENT_MAX_WIDTH);
  const LIST_TILE_W = listTileWidth(W);
  const insets = useSafeAreaInsets();
  // Shows row: the SAME order as the all-shows grid (most recent watch first),
  // so the two screens never disagree. Shows sharing a watch timestamp break
  // the tie by episode count; shows never watched (no date) fall to the end.
  const recentShows = getShowProgress()
    .filter((sp) => (sp.lastWatchedAt ?? sp.addedAt) != null)
    .sort(
      (a, b) =>
        (b.lastWatchedAt ?? '').localeCompare(a.lastWatchedAt ?? '') ||
        Math.max(b.watched, b.episodesSeen) - Math.max(a.watched, a.episodesSeen),
    );
  // re-read the db each time the tab regains focus (photo/name edits, new watches)
  const [, setTick] = useState(0);
  // gentle nudge when the library has no delete-proof copy — re-checked on
  // focus so it disappears right after the user turns iCloud on
  const [cloudOff, setCloudOff] = useState(false);
  // Android has no iCloud auto-backup — nudge to export instead, only when
  // there's new un-exported data (clears right after an export)
  const [backupOverdue, setBackupOverdue] = useState(false);
  // one-time nudge when the app's shared TheTVDB key stops working and the user
  // hasn't added their own — dismissible, and clears itself if the key recovers
  const [tvdbFailed, setTvdbFailed] = useState(false);
  // reminders off — the third possible banner. Re-read on focus so it clears
  // as soon as they're switched on from Settings.
  const [notifOff, setNotifOff] = useState(false);
  // The community half of this screen, when there is one. The handle is read
  // synchronously from `meta` (it is already on the device); the counts are the
  // one thing only the server knows, so they arrive after a round trip and the
  // row simply shows the handle until they do.
  const [community, setCommunity] = useState<PublicProfile | null>(null);
  // The badge starts from the `meta` cache — the bell is on the first frame and
  // cannot await a request to decide whether to draw a dot — and is corrected
  // from `GET /v1/me` on focus. A lazy initialiser, so the synchronous read
  // happens once on mount rather than on every render.
  const [unread, setUnread] = useState(() => readUnreadCount());
  useFocusEffect(
    useCallback(() => {
      setTick((t) => t + 1);
      setTvdbFailed(tvdbKeyFailed() && !userTvdbKey() && getMeta('tvdbNudgeDismissed') !== '1');
      setNotifOff(!notificationsEnabled() && getMeta('notifyNudgeDismissed') !== '1');
      if (icloudSupported()) {
        void icloudAvailableAsync()
          .then((on) => setCloudOff(!on))
          .catch(() => {});
      } else {
        setBackupOverdue(manualBackupOverdue());
      }
      // Both are no-ops when not joined: `fetchProfile` needs a handle there is
      // none of, and `refreshUnreadCount` answers null without a token. Neither
      // ever rejects into this screen.
      const handle = getHandle();
      if (handle) {
        void fetchProfile(handle)
          .then(setCommunity)
          .catch(() => {
            // Offline, or the session died. The row falls back to the handle
            // alone, which is still true and still tappable.
          });
      }
      // null means "nothing was learned" — offline, or not joined — and the
      // badge keeps whatever it was showing rather than dropping to zero.
      void refreshUnreadCount().then((n) => {
        if (n !== null) setUnread(n);
      });
    }, []),
  );

  // Only ONE banner at a time: three stacked yellow bars read as nagging.
  // Ordered by what ignoring it costs — see topBanner.
  const banner = topBanner({ cloudOff, backupOverdue, notificationsOff: notifOff });
  // Deliberately NOT part of topBanner's one-at-a-time rule: that rule ranks
  // three warnings about data the user could lose, and this is an invitation.
  // Shown to anyone not already in the community who has not closed it —
  // including someone who tapped "Not now", for whom this is the way back.
  // Both hooks read unconditionally — `&&` between two hook calls would
  // short-circuit the second and break the rules of hooks.
  const joinedCommunity = useJoined();
  const communityDismissed = useCommunityBannerDismissed();
  const communityBanner = !joinedCommunity && !communityDismissed;

  const turnOnReminders = () => {
    void enableEpisodeNotifications()
      .then((ok) => {
        if (ok) {
          setNotifOff(false);
          return;
        }
        // iOS already has a "no" on file — the prompt cannot be shown again
        Alert.alert(
          t('settings.app.notificationsOffTitle'),
          t('profile.notifOffBody'),
          [
            { text: t('common.later'), style: 'cancel' },
            { text: t('common.openSettings'), onPress: () => void Linking.openSettings() },
          ],
        );
      })
      .catch(() => {});
  };

  const exportBackup = () => {
    Alert.alert(
      t('profile.backupTitle'),
      t('profile.backupBody'),
      [
        { text: t('common.later'), style: 'cancel' },
        {
          text: t('profile.exportNow'),
          onPress: () =>
            void shareLibraryExport()
              .then(() => setBackupOverdue(false))
              .catch((err) => Alert.alert(t('settings.data.exportFailedTitle'), err instanceof Error ? err.message : String(err))),
        },
      ],
    );
  };

  const movieClock = movieClockNow();
  const totals = getTotals();
  const tvClock = clockOf(totals.minutes);
  const recentMovies = getMovies().filter((m) => m.watchedAt != null);
  // a locally-created profile name overrides the imported one
  const username = getMeta('username') ?? profile.username;
  // seed content stays in the bundle; imported libraries carry their own
  // favorites (from the export's favorite lists) and downloaded photos.
  // a photo chosen in Edit profile wins over both.
  const seedLib = isSeedLibrary();
  const avatarUri = profileImageUri('avatar');
  const coverUri = profileImageUri('cover');
  // favorites in your original TV Time order (all 9, incl. untracked shows)
  const favShows = seedLib
    ? seed.favoriteShows
    : getFavoriteShows().map((s) => ({ tvdbId: s.tvdbId, name: s.name, poster: s.posterUrl }));
  type PosterItem = { name: string; poster: string | null };
  const favMovies: PosterItem[] = seedLib ? seed.favoriteMovies.items : getFavoriteMovies();
  const firstList = seedLib ? seed.lists[0] : getCustomLists()[0];
  const listItems: PosterItem[] = firstList?.items ?? [];
  // social counts: imported libraries carry their own (friend.csv + the
  // followers mined from notifications + the comments table)
  const metaLen = (key: string) => {
    try {
      return (JSON.parse(getMeta(key) ?? '[]') as unknown[]).length;
    } catch {
      return 0;
    }
  };
  const followingCount = seedLib ? profile.following : metaLen('tvtimeFriends');
  const followersCount = seedLib ? profile.followers : metaLen('tvtimeFollowers');
  const commentCount = seedLib ? profile.comments : getCommentCount();

  // TV Time's collapsing cover: pinned over the content, it shrinks from the
  // full banner to a compact bar; avatar fades out, the centered name fades in
  const FULL = insets.top + 196;
  const BAR = insets.top + 52;
  const RANGE = FULL - BAR;

  // The community handle, and the badge on the bell. Both are absent — not
  // zero, not blank — for anybody who has not joined.
  const communityHandle = joinedCommunity ? getHandle() : null;
  const badge = joinedCommunity ? unreadBadge(unread) : '';

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const coverStyle = useAnimatedStyle(() => ({
    // pulling past the top stretches the cover, like the real app
    height: interpolate(scrollY.value, [-120, 0, RANGE], [FULL + 120, FULL, BAR], Extrapolation.CLAMP),
  }));
  const identityStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, RANGE * 0.55], [1, 0], Extrapolation.CLAMP),
  }));
  const barNameStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [RANGE * 0.55, RANGE], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Animated.View style={[styles.cover, coverStyle]}>
        {coverUri != null ? (
          <Image source={{ uri: coverUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : seedLib ? (
          <Image source={COVER} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.65)' }]} />
        <View style={[styles.coverBar, { marginTop: insets.top + 6 }]}>
          <Pressable style={styles.bell} onPress={() => router.push('/notifications')}>
            <Ionicons name="notifications-outline" size={21} color={colors.onYellow} />
            {/* Capped at "99+" — a three-digit number does not fit a 31pt
                circle, and past a hundred the exact figure stops meaning
                anything to the person reading it. */}
            {badge !== '' && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{badge}</Text>
              </View>
            )}
          </Pressable>
          <Animated.Text style={[styles.barName, barNameStyle]} numberOfLines={1}>
            {username}
          </Animated.Text>
          <Pressable hitSlop={8} onPress={() => router.push('/profile-menu')}>
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
          </Pressable>
        </View>
        <Animated.View style={[styles.identity, identityStyle]}>
          <View style={styles.avatar}>
            {avatarUri != null ? (
              <Image source={{ uri: avatarUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : seedLib ? (
              <Image source={AVATAR} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <Text style={{ color: colors.yellow, fontSize: 26, fontWeight: '800' }}>{username[0]?.toUpperCase() ?? '?'}</Text>
            )}
          </View>
          <View>
            <Text style={styles.username}>{username}</Text>
            <Pressable style={styles.editPill} onPress={() => router.push('/edit-profile')}>
              <Text style={styles.editText}>{t('profile.edit')}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>

      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingTop: FULL, paddingBottom: 24 }}>
        {banner === 'cloud' && (
          <Pressable
            style={styles.cloudBanner}
            onPress={() =>
              Alert.alert(
                t('profile.turnOnIcloudTitle'),
                t('profile.turnOnIcloudBody'),
                [
                  { text: t('common.later'), style: 'cancel' },
                  { text: t('common.openSettings'), onPress: () => void Linking.openSettings() },
                ],
              )
            }>
            <Ionicons name="cloud-offline-outline" size={18} color={colors.onYellow} />
            <Text style={styles.cloudBannerText}>{t('profile.cloudBannerText')}</Text>
            <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.onYellow} />
          </Pressable>
        )}
        {banner === 'backup' && (
          <Pressable style={styles.cloudBanner} onPress={exportBackup}>
            <Ionicons name="cloud-upload-outline" size={18} color={colors.onYellow} />
            <Text style={styles.cloudBannerText}>{t('profile.backupBannerText')}</Text>
            <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.onYellow} />
          </Pressable>
        )}
        {banner === 'notifications' && (
          <Pressable style={styles.cloudBanner} onPress={turnOnReminders}>
            <Ionicons name="notifications-outline" size={18} color={colors.onYellow} />
            <Text style={styles.cloudBannerText}>{t('profile.notifBannerText')}</Text>
            <Pressable
              hitSlop={10}
              onPress={() => {
                setMeta('notifyNudgeDismissed', '1');
                setNotifOff(false);
              }}>
              <Ionicons name="close" size={17} color={colors.onYellow} />
            </Pressable>
          </Pressable>
        )}
        {/* The community offer, for anyone who declined it or was never asked
            — the ONLY place it appears unprompted after the one-time modal.
            Sits below the other banners because none of the others can be
            postponed indefinitely without losing something, and this one can:
            not joining costs the user nothing at all. */}
        {communityBanner && (
          <Pressable
            style={styles.cloudBanner}
            onPress={() => {
              tapLight();
              router.push('/join');
            }}>
            <Ionicons name="people-outline" size={18} color={colors.onYellow} />
            <Text style={styles.cloudBannerText}>{t('community.banner.text')}</Text>
            <Pressable hitSlop={10} onPress={dismissCommunityBanner}>
              <Ionicons name="close" size={17} color={colors.onYellow} />
            </Pressable>
          </Pressable>
        )}
        {tvdbFailed && (
          <Pressable style={styles.cloudBanner} onPress={() => router.push('/tvdb-key')}>
            <Ionicons name="key-outline" size={18} color={colors.onYellow} />
            <Text style={styles.cloudBannerText}>{t('profile.tvdbBannerText')}</Text>
            <Pressable
              hitSlop={10}
              onPress={() => {
                setMeta('tvdbNudgeDismissed', '1');
                setTvdbFailed(false);
              }}>
              <Ionicons name="close" size={17} color={colors.onYellow} />
            </Pressable>
          </Pressable>
        )}
        <View style={styles.statBand}>
          <Pressable style={styles.statCell} onPress={() => router.push('/following')}>
            <Text style={styles.statNum}>{followingCount}</Text>
            <Text style={styles.statLbl}>{t('profile.statFollowing')}</Text>
          </Pressable>
          <Pressable style={[styles.statCell, styles.statCellMid]} onPress={() => router.push('/following?type=followers')}>
            <Text style={styles.statNum}>{followersCount}</Text>
            <Text style={styles.statLbl}>{t('profile.statFollowers')}</Text>
          </Pressable>
          <Pressable style={styles.statCell} onPress={() => router.push('/comments')}>
            <Text style={styles.statNum}>{commentCount}</Text>
            <Text style={styles.statLbl}>{t('profile.statComments')}</Text>
          </Pressable>
        </View>

        {/* The community identity, kept SEPARATE from the band above rather
            than folded into it. Those three numbers are the imported TV Time
            history — friends, followers and comments from the export — and they
            are not the same numbers as the server's. Overwriting them would
            have made a fresh account read as though the archive had shrunk to
            zero. This row is the other identity, and it says whose it is. */}
        {communityHandle && (
          <Pressable
            style={styles.communityRow}
            onPress={() => {
              tapLight();
              router.push(`/profile/${encodeURIComponent(communityHandle)}`);
            }}>
            <Ionicons name="people-circle-outline" size={22} color={colors.yellow} />
            <View style={{ flex: 1 }}>
              <Text style={styles.communityHandle}>@{communityHandle}</Text>
              {community?.counts != null && (
                <Text style={styles.communitySub}>
                  {t('community.profile.followerLine', {
                    followers: formatCount(community.counts.followers, currentLocale()),
                    following: formatCount(community.counts.following, currentLocale()),
                  })}
                </Text>
              )}
            </View>
            <Ionicons
              name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'}
              size={16}
              color={colors.faint}
            />
          </Pressable>
        )}

        <SectHead title={t('stats.title')} onPress={() => router.push('/stats')} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingStart: space.lg, paddingEnd: space.sm, gap: 10 }}>
          <View style={[styles.statsCard, { width: CONTENT_W * 0.55 }]}>
            <Text style={styles.statsCardTitle}>{t('profile.tvTimeCard')}</Text>
            <View style={styles.clockRow}>
              <ClockCell value={tvClock.months} unit={t('stats.clock.months')} />
              <ClockCell value={tvClock.days} unit={t('stats.clock.days')} />
              <ClockCell value={tvClock.hours} unit={t('stats.clock.hours')} />
            </View>
          </View>
          <View style={[styles.statsCard, { width: CONTENT_W * 0.42 }]}>
            <Text style={styles.statsCardTitle}>{t('profile.episodesWatchedCard')}</Text>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={styles.bigNum}>{formatCount(totals.episodes, currentLocale())}</Text>
            </View>
          </View>
          <View style={[styles.statsCard, { width: CONTENT_W * 0.55 }]}>
            <Text style={styles.statsCardTitle}>{t('profile.movieTimeCard')}</Text>
            <View style={styles.clockRow}>
              <ClockCell value={movieClock.months} unit={t('stats.clock.months')} />
              <ClockCell value={movieClock.days} unit={t('stats.clock.days')} />
              <ClockCell value={movieClock.hours} unit={t('stats.clock.hours')} />
            </View>
          </View>
          <View style={[styles.statsCard, { width: CONTENT_W * 0.42 }]}>
            <Text style={styles.statsCardTitle}>{t('profile.moviesWatchedCard')}</Text>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={styles.bigNum}>{movieClock.watched}</Text>
            </View>
          </View>
        </ScrollView>

        {listItems.length > 0 && <SectHead title={t('profile.sectionLists')} onPress={() => router.push('/lists')} />}
        {listItems.length > 0 && (
        <Pressable
          style={styles.collage}
          onPress={() => router.push(`/lists/${encodeURIComponent(firstList?.name ?? '')}`)}>
          {listItems.slice(0, listTiles(W)).map((it, i) => (
            <View key={`${it.name}-${i}`} style={{ width: LIST_TILE_W }}>
              {/* collage tiles are cropped shorter than full posters, like the real app */}
              <Poster name={it.name} uri={it.poster} aspect={0.78} />
            </View>
          ))}
          {/* dim the artwork so the list name pops — the name stays bright */}
          <View style={styles.collageDim} pointerEvents="none" />
          <Text style={styles.collageName}>{firstList?.name ?? ''}</Text>
        </Pressable>
        )}
        {listItems.length > 0 && <View style={styles.pageDot} />}

        {/* A fresh library used to render "Shows ›" and "Movies ›" over nothing,
            so the very first screen a new user sees was two headings pointing
            at empty lists. Every other section here is already gated on having
            content; these two were not. Point them somewhere instead. */}
        {recentShows.length === 0 && recentMovies.length === 0 ? (
          <EmptyState
            title={t('profile.emptyTitle')}
            caption={t('profile.emptyCaption')}
            cta={t('profile.emptyCta')}
            onPress={() => router.push('/search')}
          />
        ) : (
          <>
            {recentShows.length > 0 && (
              <>
                <SectHead title={t('stats.headers.shows')} onPress={() => router.push('/all-shows')} />
                <PosterRow
                  items={recentShows.map((sp) => ({ key: String(sp.tvdbId), name: sp.name, uri: sp.posterUrl }))}
                  onItemPress={(k) => router.push(`/show/${k}`)}
                />
              </>
            )}

        {favShows.length > 0 && (
          <>
            <SectHead title={t('profile.sectionFavoriteShows')} heart onPress={() => router.push('/favorites/shows')} />
            <PosterRow
              items={favShows.map((f) => ({ key: String(f.tvdbId), name: f.name, uri: f.poster }))}
              onItemPress={(k) => router.push(`/show/${k}`)}
            />
          </>
        )}

            {recentMovies.length > 0 && (
              <>
                <SectHead title={t('stats.headers.movies')} onPress={() => router.push('/all-movies')} />
                <PosterRow
                  items={recentMovies.map((m) => ({ key: m.name, name: m.name, uri: m.poster }))}
                  onItemPress={(k) => router.push(`/movie/${encodeURIComponent(k)}`)}
                />
              </>
            )}

        {favMovies.length > 0 && (
          <>
            <SectHead title={t('profile.sectionFavoriteMovies')} heart onPress={() => router.push('/favorites/movies')} />
            <PosterRow
              items={favMovies.map((m, i) => ({ key: `${m.name}-${i}`, name: m.name, uri: m.poster }))}
              onItemPress={(k) => router.push(`/movie/${encodeURIComponent(k.replace(/-\d+$/, ''))}`)}
            />
          </>
        )}
          </>
        )}
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: '#1E2A40',
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  coverBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barName: {
    flex: 1,
    textAlign: 'center',
    paddingHorizontal: 10,
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  bell: {
    width: 31.5,
    height: 31.5,
    borderRadius: 15.75,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -5,
    minWidth: 17,
    height: 17,
    borderRadius: 8.5,
    paddingHorizontal: 4,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFF', fontSize: 10.5, fontWeight: '800' },
  communityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  communityHandle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  communitySub: { color: colors.dim, fontSize: 12.5, marginTop: 2 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.raise,
    borderWidth: 1.5,
    borderColor: '#E8E8EC',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  username: { color: colors.text, fontSize: 20.5, fontWeight: '800' },
  editPill: {
    alignSelf: 'flex-start',
    marginTop: 5,
    borderWidth: 1.5,
    borderColor: colors.text,
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 12,
  },
  editText: { color: colors.text, fontSize: 12.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  cloudBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.yellow,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
  },
  cloudBannerText: { color: colors.onYellow, fontSize: 13, fontWeight: '700', flex: 1 },
  statBand: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.line },
  statCell: { flex: 1, alignItems: 'center', paddingVertical: 13 },
  statCellMid: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.line },
  statNum: { color: colors.text, fontSize: 20, fontWeight: '700' },
  statLbl: { color: colors.dim, fontSize: 13, marginTop: 1 },
  sectHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingTop: 22,
    paddingBottom: 12,
  },
  sectTitle: { color: colors.text, fontSize: 22, fontWeight: '800' },
  heart: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: space.lg },
  statsCard: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    overflow: 'hidden',
    minHeight: 104,
  },
  statsCardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  clockRow: { flexDirection: 'row', justifyContent: 'center', gap: 18, paddingVertical: 10, flex: 1, alignItems: 'center' },
  clockNum: { color: colors.text, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  clockUnit: {
    color: colors.faint,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 3,
  },
  bigNum: { color: colors.text, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  collage: {
    flexDirection: 'row',
    gap: 2,
    marginHorizontal: space.lg,
    overflow: 'hidden',
  },
  collageDim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.3)' },
  pageDot: {
    alignSelf: 'center',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.yellow,
    marginTop: 10,
  },
  collageName: {
    position: 'absolute',
    start: 14,
    bottom: 12,
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowRadius: 10,
  },
});
