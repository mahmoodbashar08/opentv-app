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
import { mixHex } from '@/pure';
import { colors, radius, space } from '@/theme';

/** The collage spans the full width, so a tablet gets more tiles, not wider ones. */
const listTiles = (w: number) => (w > CONTENT_MAX_WIDTH ? 8 : 4);
const listTileWidth = (w: number) => (w - 2 * space.lg - (listTiles(w) - 1) * 2) / listTiles(w);

/** The band's height, whatever is in it. Collage tiles are cropped to `0.78`
 *  rather than a full poster's 2/3, so the empty card must match THAT — not the
 *  poster ratio the Lists screen uses. */
const LIST_BAND_H = (tileW: number) => Math.round(tileW / 0.78);

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
  /**
   * What an empty band says. The owner is told to make one; a visitor is told
   * there are none. Hiding the section entirely was the old behaviour and it
   * reads as a screen that failed to load rather than an answer.
   */
  emptyLabel?: string;
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
  /**
   * A supporter. Draws a small PLUS chip beside the name and nothing else —
   * ABSENT MEANS ABSENT: a profile the server has not told us about renders
   * exactly as it always has, never a greyed-out or "not Plus" chip.
   *
   * Optional and defaulted false on purpose. The own-profile tab passes
   * `usePlus()` — local truth, known the instant a purchase lands and true even
   * offline — while a public profile passes the server's `is_plus`, which is
   * the only thing that can be known about somebody else.
   */
  plus?: boolean;
  /**
   * The owner's published theme — `theme_color` from the server, or the local
   * choice on the own-profile tab. Tints the identity of THIS profile: avatar
   * ring, PLUS chip, stat numbers. Deliberately nothing else — the visitor's
   * own app keeps its own accent everywhere around it, because somebody else's
   * taste may colour their profile and not your controls.
   */
  themeColor?: string | null;
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
  plus = false,
  themeColor = null,
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
  /**
   * THE FIRST ONE, IN THE USER'S OWN ORDER.
   *
   * This used to skip to the first list WITH artwork, which was a workaround
   * for an empty list rendering as a row of zero height — it made the band
   * ignore a rearrangement entirely, so dragging a list to the top changed
   * nothing here. Empty lists draw at full size now, so the workaround is not
   * only unnecessary, it was overriding the one thing the order is for.
   */
  const first = lists[0];

  return (
    /* The wash: the whole body sits on a near-black blend of the owner's
       theme — 10% is a tint the eye reads as atmosphere, not a background
       colour fighting the posters. Plain bg when there is no theme. */
    <View style={{ flex: 1, backgroundColor: themeColor != null ? mixHex('#000000', themeColor, 0.1) : colors.bg }}>
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
          <View style={[styles.avatar, themeColor != null && { borderWidth: 2, borderColor: themeColor }]}>{avatar}</View>
          <View style={styles.nameBlock}>
            <View style={styles.nameRow}>
              <Text style={styles.username} numberOfLines={1}>
                {username}
              </Text>
              {/* An outline, not a filled badge: it sits beside a name, not
                  above it. Yellow acts elsewhere in this app — here it is the
                  accent on a chip that does nothing when tapped. */}
              {plus && (
                <View style={[styles.plusChip, themeColor != null && { borderColor: themeColor }]}>
                  <Text style={[styles.plusChipText, themeColor != null && { color: themeColor }]}>
                    {t('plus.badge')}
                  </Text>
                </View>
              )}
            </View>
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
              <Text style={[styles.statNum, themeColor != null && { color: themeColor }]}>{c.value}</Text>
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
                heading's › and the band itself both open the Lists screen,
                which shows all of them in a plain vertical list — the place to
                browse lists is the list screen. */}
            {/* A NAMED LIST WITH NOTHING IN IT IS STILL A LIST. The band takes
                its height from the poster tiles and nothing else, so a list made
                a moment ago — or one built from a name and a description alone —
                drew a row of zero height and looked like it had not saved. It
                gets the empty card, with its own name on it. */}
            {first == null || first.items.length === 0 ? (
              <Pressable
                // THE SAME HEIGHT WHETHER OR NOT IT HAS ARTWORK. The band was
                // sized by its poster tiles and the empty card by its padding,
                // so the section jumped between two heights depending on which
                // list happened to be first — and a list with no posters looked
                // like a lesser thing than one with them.
                style={[styles.collageEmpty, { height: LIST_BAND_H(LIST_TILE_W) }]}
                onPress={list.onSeeAll ?? first?.onPress}
                disabled={list.onSeeAll == null && first?.onPress == null}>
                {first != null ? (
                  // A real list: its name sits where a poster band's name sits.
                  <Text style={styles.collageName}>{first.name}</Text>
                ) : (
                  <Text style={styles.collageEmptyText}>
                    {list.emptyLabel ?? t('listsIndex.emptyNote')}
                  </Text>
                )}
              </Pressable>
            ) : (
              // THE BAND OPENS ALL OF THEM, not the one it happens to show.
              // It is a preview of the section, the way the Shows and Films
              // bands are, and the section is "Lists" — tapping it to land
              // inside a single list, with no sight of the others, reads as
              // the profile having exactly one. Both callers pass `onSeeAll`
              // (`/lists` for the owner, `/user-lists` for a visitor); the
              // fallback is for a caller that one day does not.
              <Pressable
                style={styles.collage}
                onPress={list.onSeeAll ?? first.onPress}
                disabled={list.onSeeAll == null && !first.onPress}>
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
  // `flexShrink` so a long display name gives way to the chip rather than
  // pushing it off the edge of the cover.
  nameBlock: { flexShrink: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  username: { color: colors.text, fontSize: 20.5, fontWeight: '800', flexShrink: 1 },
  plusChip: {
    borderWidth: 1,
    borderColor: colors.yellow,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  plusChipText: { color: colors.yellow, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
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
    // Height comes from `LIST_BAND_H` so this matches a band of posters exactly;
    // centred for the "no lists" message, while a real list's name is absolutely
    // positioned bottom-left like the poster band's.
    alignItems: 'center',
    justifyContent: 'center',
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
