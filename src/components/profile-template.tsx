/**
 * A PROFILE. Not "the Profile tab" and not "a community profile" — one screen
 * body, rendered twice with different data.
 *
 * WHY THIS EXISTS, after `profile-sections.tsx` already existed. That file
 * shared the PARTS: a section heading, a poster rail, a stats card. Sharing
 * parts is not sharing a screen. The two profiles still each owned their own
 * cover, their own identity block, their own band of counts and their own
 * order — so "somebody else's profile looks exactly like mine" remained a
 * promise maintained by hand, and it was not being kept: one had a collapsing
 * cover photo and a Lists collage, the other a flat header and a list of rows.
 *
 * So the LAYOUT lives here and both screens pass data into it. What each screen
 * still owns is what genuinely differs:
 *
 *   - where the data comes from — SQLite for you, the server for them;
 *   - what the buttons do — Edit and the bell for you, Follow and ••• for them;
 *   - anything extra underneath, passed as `children`.
 *
 * Everything else — the cover that shrinks into a bar, the avatar that fades
 * out as the centred name fades in, the three counts, the stats rail, the list
 * collage, the four shelves and their exact order — is written once, here.
 */
import { type ReactNode } from 'react';
import {
  type ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Image } from 'expo-image';

import { CONTENT_MAX_WIDTH } from '@/components/ui';
import { Poster } from '@/components/poster';
import { PosterRail, SectionHeader, StatsRail, type RailItem, type StatCard } from '@/components/profile-sections';
import { t } from '@/i18n';
import { colors, radius, space } from '@/theme';

/** The collage spans the full width, so a tablet gets more tiles, not wider ones. */
const listTiles = (w: number) => (w > CONTENT_MAX_WIDTH ? 8 : 4);
const listTileWidth = (w: number) => (w - 2 * space.lg - (listTiles(w) - 1) * 2) / listTiles(w);

/** One shelf of posters, in the order the caller lists them. */
export type ProfileShelfSpec = {
  key: string;
  title: string;
  heart?: boolean;
  items: readonly RailItem[];
  onTitlePress?: () => void;
  onItemPress?: (key: string) => void;
};

/** One cell of the counts band under the cover. */
export type ProfileCountCell = { key: string; value: string; label: string; onPress?: () => void };

/** One list, drawn as a collage of its first few posters. */
export type ProfileListItem = {
  name: string;
  items: readonly { name: string; poster?: string | null }[];
  onPress?: () => void;
};

/**
 * The Lists band — EVERY list, swipeable, one per page.
 *
 * It drew exactly one and always had: the caller passed a single list and the
 * band rendered a single collage under a single hard-coded dot. That dot is the
 * tell — a carousel was intended from the start and never had more than one
 * page to move between, so a library with a dozen lists showed one of them and
 * gave no sign the others existed.
 */
export type ProfileListSpec = {
  lists: readonly ProfileListItem[];
  /** The heading's ›. Opens the full Lists screen. */
  onSeeAll?: () => void;
};

export type ProfileTemplateProps = {
  /** A photo from disk or the network. Falls back to `coverSource`, then plain. */
  coverUri?: string | null;
  coverSource?: ImageSourcePropType | null;
  /** Whatever goes in the 58pt circle — a photo, a letter, an initial. */
  avatar: ReactNode;
  username: string;
  /** Edit, or Follow. Sits under the name exactly where Edit sits. */
  pill?: ReactNode;
  barLeft?: ReactNode;
  barRight?: ReactNode;
  banners?: ReactNode;
  /** Between the banners and the counts — a bio, or a "this is private" note. */
  intro?: ReactNode;
  cells: readonly ProfileCountCell[];
  statsCards?: readonly StatCard[] | null;
  onStatsPress?: () => void;
  list?: ProfileListSpec | null;
  shelves: readonly ProfileShelfSpec[];
  /** Anything below the shelves — the comments feed, on a public profile. */
  children?: ReactNode;
};

export function ProfileTemplate({
  coverUri,
  coverSource,
  avatar,
  username,
  pill,
  barLeft,
  barRight,
  banners,
  intro,
  cells,
  statsCards,
  onStatsPress,
  list,
  shelves,
  children,
}: ProfileTemplateProps) {
  const { width: W } = useWindowDimensions();
  const CONTENT_W = Math.min(W, CONTENT_MAX_WIDTH);
  const LIST_TILE_W = listTileWidth(W);
  const insets = useSafeAreaInsets();

  // TV Time's collapsing cover: pinned over the content, it shrinks from the
  // full banner to a compact bar; avatar fades out, the centred name fades in.
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

  const lists = list?.lists ?? [];
  // The one drawn on the profile: the first with artwork to show, because
  // `createList` unshifts and a list made a moment ago has none — taking index
  // 0 blindly replaced a shelf of posters with an empty card the instant a list
  // was created, which reads as "it did not save".
  const first = lists.find((l) => l.items.length > 0) ?? lists[0];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Animated.View style={[styles.cover, coverStyle]}>
        {coverUri != null ? (
          <Image source={{ uri: coverUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : coverSource ? (
          <Image source={coverSource} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.65)' }]} />
        <View style={[styles.coverBar, { marginTop: insets.top + 6 }]}>
          {/* Both slots are rendered even when empty, so the centred name stays
              centred on a screen that has a bell and one that does not. */}
          <View style={styles.barSlot}>{barLeft}</View>
          <Animated.Text style={[styles.barName, barNameStyle]} numberOfLines={1}>
            {username}
          </Animated.Text>
          <View style={styles.barSlot}>{barRight}</View>
        </View>
        <Animated.View style={[styles.identity, identityStyle]}>
          <View style={styles.avatar}>{avatar}</View>
          <View>
            <Text style={styles.username} numberOfLines={1}>
              {username}
            </Text>
            {pill}
          </View>
        </Animated.View>
      </Animated.View>

      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingTop: FULL, paddingBottom: 24 }}>
        {banners}
        {intro}

        <View style={styles.statBand}>
          {cells.map((c, i) => (
            <Pressable
              key={c.key}
              style={[styles.statCell, i > 0 && i < cells.length - 1 && styles.statCellMid]}
              onPress={c.onPress}
              disabled={!c.onPress}>
              <Text style={styles.statNum}>{c.value}</Text>
              <Text style={styles.statLbl}>{c.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* STATS. Absent, not zeroed, when there is nothing to show: "has
            watched nothing" and "has never synced" are different sentences. */}
        {statsCards && statsCards.length > 0 && (
          <>
            <SectionHeader title={t('stats.title')} onPress={onStatsPress} />
            <StatsRail contentWidth={CONTENT_W} cards={statsCards} />
          </>
        )}

        {/* PRESENT WHENEVER THE CALLER PASSES ONE, even with nothing in it.
            This used to hide on `listItems.length > 0`, and on the owner's own
            profile that was the only door to the Lists screen — so a library
            with no lists had no way to reach the one button that makes one.
            A public profile still passes null when the person has none. */}
        {list != null && (
          <>
            <SectionHeader title={t('profile.sectionLists')} onPress={list.onSeeAll} />
            {/* ONE COLLAGE, NOT A PAGER. A swipeable band was tried and removed:
                a profile is scrolled vertically, and a horizontal gesture inside
                that is a thing to discover rather than a thing to use. The
                heading's › opens the Lists screen, which shows all of them in a
                plain vertical list — the place to browse lists is the list
                screen. */}
            {first == null ? (
              <Pressable style={styles.collageEmpty} onPress={list.onSeeAll} disabled={!list.onSeeAll}>
                <Text style={styles.collageEmptyText}>{t('listsIndex.emptyNote')}</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.collage} onPress={first.onPress} disabled={!first.onPress}>
                {first.items.slice(0, listTiles(W)).map((it, i) => (
                  <View key={`${it.name}-${i}`} style={{ width: LIST_TILE_W }}>
                    {/* collage tiles are cropped shorter than full posters */}
                    <Poster name={it.name} uri={it.poster} aspect={0.78} />
                  </View>
                ))}
                {/* dim the artwork so the list name pops — the name stays bright */}
                <View style={styles.collageDim} pointerEvents="none" />
                <Text style={styles.collageName}>{first.name}</Text>
              </Pressable>
            )}
          </>
        )}

        {shelves.map((sh) =>
          sh.items.length === 0 ? null : (
            <View key={sh.key}>
              <SectionHeader title={sh.title} heart={sh.heart} onPress={sh.onTitlePress} />
              <PosterRail items={sh.items} onItemPress={sh.onItemPress} />
            </View>
          ),
        )}

        {children}
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
  barSlot: { minWidth: 31.5, alignItems: 'center', justifyContent: 'center' },
  barName: {
    flex: 1,
    textAlign: 'center',
    paddingHorizontal: 10,
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
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
  statBand: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.line },
  statCell: { flex: 1, alignItems: 'center', paddingVertical: 13 },
  statCellMid: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.line },
  statNum: { color: colors.text, fontSize: 20, fontWeight: '700' },
  statLbl: { color: colors.dim, fontSize: 13, marginTop: 1 },
  collage: {
    flexDirection: 'row',
    gap: 2,
    marginHorizontal: space.lg,
    overflow: 'hidden',
  },
  collageDim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.3)' },
  collageEmpty: {
    marginHorizontal: space.lg,
    borderRadius: radius.card,
    backgroundColor: colors.panel,
    paddingVertical: 22,
    alignItems: 'center',
  },
  collageEmptyText: { color: colors.dim, fontSize: 14 },
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
