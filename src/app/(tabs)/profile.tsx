import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Dimensions, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { Poster } from '@/components/poster';
import seed from '@/seed';
import { getCommentCount, getFavoriteMovies, getFavoriteShows, getMeta, getMovies, getShowProgress, getTotals } from '@/db';
import { isSeedLibrary, profileImageUri } from '@/library';
import { clockOf, computeMovieStats } from '@/stats-calc';
import { colors, radius, space } from '@/theme';

const { profile } = seed;

// your real TV Time cover + avatar, rescued from the export into the bundle
const COVER = require('../../../assets/profile/cover.jpg');
const AVATAR = require('../../../assets/profile/avatar.jpg');

// 3 full cards + ~80% of the 4th visible, like the real app
const W = Dimensions.get('window').width;
const POSTER_W = Math.round((W - space.lg - 3 * 8) / 3.8);

// lists collage: 4 cropped tiles always fully visible — equal margins both
// sides (aligned with the section gutters), 2pt gaps between tiles
const LIST_TILE_W = (W - 2 * space.lg - 3 * 2) / 4;

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
      <Ionicons name="chevron-forward" size={18} color={colors.dim} />
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
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingLeft: space.lg, paddingRight: space.sm, gap: 8 }}>
      {items.map((it) => (
        <Pressable key={it.key} style={{ width: POSTER_W }} onPress={() => onItemPress?.(it.key)}>
          <Poster name={it.name} uri={it.uri} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

export default function ProfileScreen() {
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
    )
    .slice(0, 8);
  // re-read the db each time the tab regains focus (photo/name edits, new watches)
  const [, setTick] = useState(0);
  // gentle nudge when the library has no delete-proof copy — re-checked on
  // focus so it disappears right after the user turns iCloud on
  const [cloudOff, setCloudOff] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setTick((t) => t + 1);
      if (icloudSupported()) {
        void icloudAvailableAsync()
          .then((on) => setCloudOff(!on))
          .catch(() => {});
      }
    }, []),
  );

  const movieClock = movieClockNow();
  const totals = getTotals();
  const tvClock = clockOf(totals.minutes);
  const recentMovies = getMovies()
    .filter((m) => m.watchedAt != null)
    .slice(0, 8);
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
  const listItems: PosterItem[] = seedLib ? (seed.lists[0]?.items ?? []) : [];
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
              <Text style={styles.editText}>Edit</Text>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>

      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingTop: FULL, paddingBottom: 24 }}>
        {cloudOff && (
          <Pressable
            style={styles.cloudBanner}
            onPress={() =>
              Alert.alert(
                'Turn on iCloud Drive',
                "Your library isn't backed up — if you delete the app, your data goes with it. Turn on iCloud Drive and OpenTV backs everything up automatically.\n\nSettings → your name → iCloud → iCloud Drive",
                [
                  { text: 'Later', style: 'cancel' },
                  { text: 'Open Settings', onPress: () => void Linking.openSettings() },
                ],
              )
            }>
            <Ionicons name="cloud-offline-outline" size={18} color={colors.onYellow} />
            <Text style={styles.cloudBannerText}>Your library isn't backed up — tap to turn on iCloud Drive</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.onYellow} />
          </Pressable>
        )}
        <View style={styles.statBand}>
          <Pressable style={styles.statCell} onPress={() => router.push('/following')}>
            <Text style={styles.statNum}>{followingCount}</Text>
            <Text style={styles.statLbl}>following</Text>
          </Pressable>
          <Pressable style={[styles.statCell, styles.statCellMid]} onPress={() => router.push('/following?type=followers')}>
            <Text style={styles.statNum}>{followersCount}</Text>
            <Text style={styles.statLbl}>followers</Text>
          </Pressable>
          <Pressable style={styles.statCell} onPress={() => router.push('/comments')}>
            <Text style={styles.statNum}>{commentCount}</Text>
            <Text style={styles.statLbl}>comments</Text>
          </Pressable>
        </View>

        <SectHead title="Stats" onPress={() => router.push('/stats')} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingLeft: space.lg, paddingRight: space.sm, gap: 10 }}>
          <View style={[styles.statsCard, { width: W * 0.55 }]}>
            <Text style={styles.statsCardTitle}>📺 TV time</Text>
            <View style={styles.clockRow}>
              <ClockCell value={tvClock.months} unit="Months" />
              <ClockCell value={tvClock.days} unit="Days" />
              <ClockCell value={tvClock.hours} unit="Hours" />
            </View>
          </View>
          <View style={[styles.statsCard, { width: W * 0.42 }]}>
            <Text style={styles.statsCardTitle}>📺 Episodes watched</Text>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={styles.bigNum}>{totals.episodes.toLocaleString()}</Text>
            </View>
          </View>
          <View style={[styles.statsCard, { width: W * 0.55 }]}>
            <Text style={styles.statsCardTitle}>🎬 Movie time</Text>
            <View style={styles.clockRow}>
              <ClockCell value={movieClock.months} unit="Months" />
              <ClockCell value={movieClock.days} unit="Days" />
              <ClockCell value={movieClock.hours} unit="Hours" />
            </View>
          </View>
          <View style={[styles.statsCard, { width: W * 0.42 }]}>
            <Text style={styles.statsCardTitle}>🎬 Movies watched</Text>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={styles.bigNum}>{movieClock.watched}</Text>
            </View>
          </View>
        </ScrollView>

        {listItems.length > 0 && <SectHead title="Lists" onPress={() => router.push('/lists')} />}
        {listItems.length > 0 && (
        <Pressable style={styles.collage} onPress={() => router.push('/lists/avengers')}>
          {listItems.slice(0, 4).map((it, i) => (
            <View key={`${it.name}-${i}`} style={{ width: LIST_TILE_W }}>
              {/* collage tiles are cropped shorter than full posters, like the real app */}
              <Poster name={it.name} uri={it.poster} aspect={0.78} />
            </View>
          ))}
          {/* dim the artwork so the list name pops — the name stays bright */}
          <View style={styles.collageDim} pointerEvents="none" />
          <Text style={styles.collageName}>{seed.lists[0]?.name ?? ''}</Text>
        </Pressable>
        )}
        {listItems.length > 0 && <View style={styles.pageDot} />}

        <SectHead title="Shows" onPress={() => router.push('/all-shows')} />
        <PosterRow
          items={recentShows.map((sp) => ({ key: String(sp.tvdbId), name: sp.name, uri: sp.posterUrl }))}
          onItemPress={(k) => router.push(`/show/${k}`)}
        />

        {favShows.length > 0 && (
          <>
            <SectHead title="Favorite shows" heart onPress={() => router.push('/favorites/shows')} />
            <PosterRow
              items={favShows.map((f) => ({ key: String(f.tvdbId), name: f.name, uri: f.poster }))}
              onItemPress={(k) => router.push(`/show/${k}`)}
            />
          </>
        )}

        <SectHead title="Movies" onPress={() => router.push('/all-movies')} />
        <PosterRow
          items={recentMovies.map((m) => ({ key: m.name, name: m.name, uri: m.poster }))}
          onItemPress={(k) => router.push(`/movie/${encodeURIComponent(k)}`)}
        />

        {favMovies.length > 0 && (
          <>
            <SectHead title="Favorite movies" heart onPress={() => router.push('/favorites/movies')} />
            <PosterRow
              items={favMovies.slice(0, 8).map((m, i) => ({ key: `${m.name}-${i}`, name: m.name, uri: m.poster }))}
              onItemPress={(k) => router.push(`/movie/${encodeURIComponent(k.replace(/-\d+$/, ''))}`)}
            />
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
    left: 14,
    bottom: 12,
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowRadius: 10,
  },
});
