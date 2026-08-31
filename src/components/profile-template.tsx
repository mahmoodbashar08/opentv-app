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
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  type ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  runOnJS,
  Extrapolation,
  interpolate,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';

import { firstWatchDay, topCharacter, watchStreak } from '@/db';
import { CONTENT_MAX_WIDTH } from '@/components/ui';
import { Poster } from '@/components/poster';
import { PosterRail, SectionHeader, StatsGrid, StatsRail, type RailItem, type StatCard } from '@/components/profile-sections';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { ArrangeBar, ArrangeableBlock } from '@/components/profile-arrange';
import { tapLight } from '@/haptics';
import { requirePlus } from '@/plus';
import { renderWidget } from '@/components/profile-widgets';
import { LOCKED, defaultLayout, type Placed, type WidgetSpan } from '@/profile-layout';
import { t } from '@/i18n';
import { usePlusUi } from '@/plus';
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

/**
 * "Other people are in this one."
 *
 * The same mark the Lists screen puts on a shared row, so the two screens
 * agree. It matters most on the empty card, which is what a shared list draws
 * here -- the server sends a summary with no posters, and an unmarked blank
 * card with a name on it reads as a list that failed to load.
 */
function SharedMark({ count }: { count?: number | null }) {
  return (
    <View style={styles.sharedMark}>
      <Ionicons name="people" size={11} color={colors.yellow} />
      {count != null && count > 0 && <Text style={styles.sharedMarkText}>{count}</Text>}
    </View>
  );
}

/** One list, drawn as a collage of its first few posters. */
export type ProfileListItem = {
  name: string;
  items: readonly { name: string; poster?: string | null }[];
  onPress?: () => void;
  /** Built with other people. Drawn with the same mark the Lists screen uses. */
  shared?: boolean;
  memberCount?: number | null;
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
  /** The artwork's partner colour, when it had one. Null means the picture is
   *  a single hue and everything uses the primary. */
  themeSecondary?: string | null;
  /**
   * A padlock beside the name on a private profile.
   *
   * OWN PROFILE ONLY, and passed rather than derived: a visitor looking at a
   * private profile is already being shown the shell and does not need telling
   * why. The person who turned it on does -- the switch lives three screens
   * away in Edit profile, and without a mark here the only way to know it is
   * still on is to go and look.
   */
  isPrivate?: boolean;
  /**
   * How the body is drawn. `classic` is the band-and-rail this app shipped
   * with; `cards` gives every number its own tile in a 2×2 grid, which is what
   * makes a themed profile look designed rather than recoloured.
   *
   * Published alongside the theme, so a visitor sees the layout its OWNER
   * chose — the point of a profile is that it is theirs.
   */
  layout?: ProfileLayout;
  /**
   * The arrangement. Omitted means `DEFAULT_BLOCKS`, which is what every
   * caller passes today and is why this refactor changes nothing on screen.
   * An unknown id renders nothing rather than throwing, so a layout saved by a
   * newer build cannot break an older one.
   */
  /** The owner's saved arrangement. Absent on a public profile and on a phone
   *  that has never edited one — the default is used when it is absent.
   *  Named `arrangement`, not `layout`: `layout` already means classic / cards
   *  / poster on this component, and two meanings for one prop is how a screen
   *  ends up rendering the wrong thing. */
  arrangement?: readonly Placed[];
  /** False when somebody else is looking. Widgets marked `private` in the
   *  catalogue do not exist on that screen. */
  own?: boolean;
  /**
   * The values that arrived with a visitor's copy of the arrangement, by widget
   * id. Absent on the owner's own profile, where the database is the source.
   *
   * WITHOUT THIS A VISITOR'S PHONE DRAWS ITS OWN LIBRARY. Every widget is a
   * query, and on somebody else's profile those queries return the READER's
   * streak and the READER's top genre — the worst bug this feature could have,
   * because it would look entirely plausible.
   */
  published?: ReadonlyMap<string, unknown>;
  /** Called when the owner rearranges or removes something. Absent means the
   *  profile cannot be arranged — which is how every public profile is. */
  onArrange?: (next: Placed[]) => void;
  /** Opens the picker for widgets that have been taken off. */
  onAddWidget?: () => void;

  /** "Joined August 2026", already formatted by the caller in its own locale. */
  joined?: string | null;
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
  /**
   * The activity heatmap and its heading — own profile ONLY, and the template
   * takes it as a slot rather than building it, because a per-day grid of what
   * somebody watched is watch history: the thing that never leaves the phone
   * and has no table on the server. There is nothing a public profile could
   * pass here even if it wanted to.
   */
  activity?: ReactNode | ((span: WidgetSpan) => ReactNode);
  /**
   * The timeline row, as its OWN block.
   *
   * It used to be part of the activity section, which meant one widget was two
   * things: a year of squares, and a door to every episode ever watched.
   * Somebody who wants the heatmap on their profile does not necessarily want
   * the door beside it, and there was no way to say so. Same slot rule as the
   * heatmap — this is watch history, so only the owner's own screen passes one.
   */
  timeline?: ReactNode;
  list?: ProfileListSpec | null;
  shelves: readonly ProfileShelfSpec[];
  /** Anything below the shelves — the comments feed, on a public profile. */
  children?: ReactNode;
};

/**
 * The cover's bottom edge, dissolved into the page.
 *
 * A hard rectangle of artwork that simply stops is the difference between a
 * banner and a themed profile: in the reference the image melts into the
 * background and the eye reads one surface. React Native has no gradient of
 * its own and `expo-linear-gradient` is a native module — a rebuild for a
 * visual flourish — so this is N slices of the page's own colour at rising
 * opacity. Sixteen is past the point where a band is visible on an OLED
 * screen, and it costs sixteen empty views.
 */
function CoverFade({ color, height }: { color: string; height: number }) {
  // Same reasoning as `ThemeWash` below: enough steps that no band is visible.
  const STEPS = 40;
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height }} pointerEvents="none">
      {Array.from({ length: STEPS }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            backgroundColor: color,
            // Squared, so the fade starts almost invisibly and gathers — a
            // linear ramp reads as a grey veil over the whole image.
            opacity: ((i + 1) / STEPS) ** 2,
          }}
        />
      ))}
    </View>
  );
}

/**
 * The themed page: a vertical ramp from a strong tint at the top to the page
 * colour by the fold.
 *
 * SIXTEEN FLAT VIEWS, not a gradient library. This project has no gradient
 * dependency and does not need one for a ramp — `CoverFade` above already does
 * the same trick for the cover, and adding a native module to draw sixteen
 * rectangles would be a bad trade.
 *
 * `pointerEvents="none"` matters: it lies across the whole page and would
 * otherwise eat every tap on the content beneath it.
 */
function ThemeWash({ from, to }: { from: string; to: string }) {
  /*
   * SIXTY STEPS, NOT FOURTEEN.
   *
   * Fourteen bands over 460pt is a 33pt stripe each, and the eye finds those
   * instantly — the fade read as a set of horizontal bars rather than as a
   * ramp. It was survivable while every band was 15% transparent, because the
   * page beneath blurred the joins; making them opaque to fix the muddy colour
   * took that cover away and exposed the banding underneath.
   *
   * Sixty puts each band under 8pt with roughly one step of 8-bit colour
   * between neighbours, which is below the threshold anything can see. They are
   * empty Views with a background colour — sixty of them cost less than the
   * gradient library this project has deliberately never added.
   */
  const STEPS = 60;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={{ height: 460 }}>
        {Array.from({ length: STEPS }, (_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              backgroundColor: mixHex(from, to, (i + 1) / STEPS),
              // Squared, like the cover fade: the colour holds near the top and
              // then lets go, rather than draining evenly and reading as haze.
              // Fully opaque. The 15% transparency let the near-black page
              // show through every band, which greyed the whole ramp — the
              // colour is already mixed towards the page, so letting the page
              // leak through it as well drained it twice.
              opacity: 1,
            }}
          />
        ))}
      </View>
      {/* Not opaque: the artwork keeps showing through the lower page, faintly,
          so the bottom of the profile still belongs to the same picture. */}
      <View style={{ flex: 1, backgroundColor: to, opacity: 0.94 }} />
    </View>
  );
}

/** The three profile bodies. Stored as this string, server-side and locally. */
/**
 * The blocks a profile is made of, in the order they appear by default.
 *
 * This is the order the page has always had, written down instead of implied
 * by the source file. `banners` and `intro` lead because they are messages
 * about the account rather than parts of it; `counts` is the first thing about
 * the person; activity answers "have I been watching lately", which is what
 * somebody opens their own profile to ask, before stats answer the slower
 * "how much, ever".
 */
/**
 * Draw each block's bounds.
 *
 * A LOOKING TOOL, NOT A DESIGN. Once the body is an ordered list of blocks it
 * is worth being able to SEE them — where one ends, what is genuinely its own
 * thing, and what is two things that only look separate. That question arrives
 * the moment somebody can rearrange them, and guessing the answer from a
 * screenshot is how a grid ends up with a block that was never a block.
 *
 * Off in every build. Flip it, reload, look, flip it back.
 */
const SHOW_BLOCK_BOUNDS = false;

export const DEFAULT_BLOCKS = ['banners', 'intro', 'counts', 'activity', 'stats', 'lists', 'extra'] as const;

export type ProfileBlock = (typeof DEFAULT_BLOCKS)[number];

/**
 * A shelf is addressed by its own key, not lumped in with the others.
 *
 * The first version had ONE `shelves` block holding Favourites, Shows and Films
 * together, which quietly decided that nobody may show their films without also
 * showing their shows. Somebody who tracks films and barely watches television
 * would have a profile two thirds of which is somebody else's idea of them.
 *
 * `shelf:favourites`, `shelf:shows`, `shelf:movies` — one id each, so each can
 * move or disappear alone. Prefixed rather than a bare key because the CALLER
 * chooses those keys, and a shelf called `stats` would otherwise silently
 * replace the stats block.
 */
/*
 * THE CATALOGUE MOVED. Which widgets exist, what sizes each can be, the default
 * arrangement, and how a stored one is reconciled with the build all live in
 * `src/profile-layout.ts` — where the edit screen can reach them without
 * importing this component, and where they can be tested without rendering
 * anything. Two copies of "what a profile is made of" is precisely the kind of
 * pair that drifts.
 */
export { SHELF_PREFIX, defaultLayout, normalise, specOf, type Placed, type WidgetSpan } from '@/profile-layout';
export { GRID_GUTTER, gridMetrics } from '@/components/ui';
import { GRID_GUTTER, gridMetrics } from '@/components/ui';
import { SHELF_PREFIX, specOf } from '@/profile-layout';

export type ProfileLayout = 'classic' | 'cards' | 'poster';

/**
 * Any stored or received value, as a layout this app can draw. One parser for
 * the server's string, the local meta and the picker, so a value the server
 * learns about before this build does renders as the default rather than as
 * nothing.
 */
export function asProfileLayout(v: string | null | undefined): ProfileLayout {
  return v === 'cards' || v === 'poster' ? v : 'classic';
}

/**
 * One square. A faint label, then whatever the block wants to say.
 *
 * Square by aspect ratio rather than a fixed height, so two of them beside each
 * other are the same size on any phone and the row keeps its rhythm when the
 * text inside them differs in length.
 */
function Tile({ label, children }: { label: string; children: ReactNode }) {
  // ONE MEASUREMENT, EVERYWHERE. A tile is a 1x1, so its height is the grid's
  // row — not a number typed into a stylesheet that drifts from the columns.
  const { height } = gridMetrics(useWindowDimensions().width);
  return (
    <View style={[styles.tile, { height: height(1) }]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <View style={styles.tileBody}>{children}</View>
    </View>
  );
}

export function ProfileTemplate({
  coverUri,
  coverSource,
  avatar,
  username,
  plus = false,
  themeColor = null,
  themeSecondary = null,
  isPrivate = false,
  layout = 'classic',
  arrangement,
  timeline,
  own = true,
  published,
  onArrange,
  onAddWidget,
  joined = null,
  pill,
  barLeft,
  barRight,
  banners,
  intro,
  cells,
  statsCards,
  onStatsPress,
  activity,
  list,
  shelves,
  children,
}: ProfileTemplateProps) {
  const { width: W } = useWindowDimensions();
  const CONTENT_W = Math.min(W, CONTENT_MAX_WIDTH);
  /** The room inside a block: the page, less the margin on each side. Rails are
   *  sized from this and clipped to it, so nothing can reach the screen edge. */
  const BLOCK_W = CONTENT_W - 2 * space.lg;
  /** What a rail actually has: the page less its LEFT margin. The right margin
   *  is deliberately unspent — it is where the peek shows. */
  const RAIL_W = CONTENT_W - space.lg;
  const LIST_TILE_W = listTileWidth(W);
  const insets = useSafeAreaInsets();

  // TV Time's collapsing cover: pinned over the content, it shrinks from the
  // full banner to a compact bar; avatar fades out, the centred name fades in.
  // Taller in the cards body: the artwork is the point there, and a centred
  // 84pt avatar needs the room the row layout did not.
  const FULL = insets.top + (layout !== 'classic' ? 252 : 196);
  const BAR = insets.top + 52;
  const RANGE = FULL - BAR;

  const plusUi = usePlusUi();

  const scrollY = useSharedValue(0);
  /** The scroll view itself, so a drag near an edge can move it — see
   *  `ArrangeableBlock`. The same pattern the list reorder uses. */
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
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

  /**
   * THE WASH, AND IT USED TO BE INVISIBLE.
   *
   * 10% of the theme mixed into black was "atmosphere" in the design and
   * nothing at all on a phone -- put a themed profile beside an unthemed one on
   * a real screen and you cannot tell which is which. A paid feature nobody can
   * SEE is not a subtle paid feature, it is an absent one.
   *
   * So the theme now arrives in strength at the top, where the eye lands, and
   * gives way to black by the time the posters start -- because artwork is what
   * a profile is FOR, and a colour cast held all the way down turns every
   * poster on the page the same shade.
   *
   * `pageColor` stays the deep end of that ramp: it is what the cover dissolves
   * into, so the two must remain the same value.
   */
  const pageColor = themeColor != null ? mixHex('#000000', themeColor, 0.14) : colors.bg;
  /** The top of the ramp. Loud on purpose — this is the half people screenshot. */
  /*
   * THE TOP OF THE PAGE WASH, and the number is the whole complaint.
   *
   * It was 42% of the theme mixed into pure black, which on a warm palette is
   * not a dark version of the colour — it is a brown. Black drains the
   * saturation out of a hue long before it darkens it, so the ramp read as
   * grubby rather than tinted, which is exactly the "تدرج الوان" that looked
   * wrong under the banner.
   *
   * 62% keeps the hue recognisable at the top and still lands on the page
   * colour by the fold, so the fade is a colour becoming darker rather than a
   * colour becoming dirt.
   */
  const washTop = themeColor != null ? mixHex('#000000', themeColor, 0.62) : colors.bg;

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

  /**
   * THE PROFILE, AS AN ORDERED LIST OF BLOCKS RATHER THAN A FIXED SEQUENCE.
   *
   * The body used to be written out in JSX, top to bottom, which meant the
   * ARRANGEMENT was a property of the source file. Nothing about that is wrong
   * until somebody is allowed to rearrange it — and then every reorder is an
   * edit to this component instead of a change of data.
   *
   * So the same JSX, moved verbatim into one entry per section, rendered in
   * whatever order `blocks` gives. Today every caller gets `DEFAULT_BLOCKS` and
   * the page is pixel-for-pixel what it was; the point is that reordering is
   * now an array, which is what makes a widget picker a picker rather than a
   * rewrite.
   *
   * TWO RULES THAT COST NOTHING NOW AND WOULD BE EXPENSIVE LATER:
   *
   * A block returns `null` when it has nothing to say. That is the collapse
   * rule already — a new profile shows what it has and grows, with no empty
   * "no favourites yet" furniture and no special case for a first-day account.
   *
   * And `BLOCK_SIZE` records how wide each one wants to be. Everything renders
   * full width today, so the field does nothing; when the grid arrives it is a
   * layout change rather than a data migration.
   *
   * ONE RENDERER, STILL. Both the owner's Profile tab and every public profile
   * come through here, deliberately, so they cannot drift. Blocks are a change
   * to this component — never a second one.
   */
  const blockContent: Record<string, (span: WidgetSpan) => ReactNode> = {
    banners: () => banners ?? null,
    intro: () => intro ?? null,
    counts: () => (
      <View
        style={[
          styles.statBand,
          layout !== 'classic' && styles.statBandCards,
          /*
           * A SURFACE, WITH NO EDGE ON IT.
           *
           * It used to carry a lit top border in the palette's second colour,
           * on the argument that two colours chosen together read as a palette
           * rather than a tint. True in the abstract and wrong here: the band
           * sits directly under the cover, so that border became a hard line
           * ACROSS the artwork — invisible on a black profile, and on a themed
           * one the first thing the eye lands on. A rule drawn where two
           * surfaces already meet is decoration explaining what the colours
           * had already said.
           */
          /*
           * NO FILL OF ITS OWN, WHICH IS WHAT THE "SPACE" UNDER THE BANNER WAS.
           *
           * The band painted itself at 22% of the theme while the wash behind
           * it starts at 62% — so a strip of a different, lighter colour ran
           * across the page exactly where the cover ended. It read as a gap
           * because it WAS a discontinuity: two surfaces meeting with nothing
           * to explain the join.
           *
           * Letting the page wash run through it means the counts sit on the
           * profile's colour rather than on a rectangle of their own, and the
           * banner meets the page in one continuous ramp.
           */
        ]}>
        {cells.map((c, i) => (
          <Pressable
            key={c.key}
            style={[
              styles.statCell,
              i > 0 && i < cells.length - 1 && layout !== 'cards' && styles.statCellMid,
            ]}
            onPress={c.onPress}
            disabled={!c.onPress}>
            <Text style={[styles.statNum, themeColor != null && { color: themeColor }]}>{c.value}</Text>
            <Text style={styles.statLbl}>{c.label}</Text>
          </Pressable>
        ))}
      </View>
    ),
    activity: (span: WidgetSpan) => (typeof activity === 'function' ? activity(span) : (activity ?? null)),
    timeline: () => timeline ?? null,
    stats: () =>
      !statsCards || statsCards.length === 0 ? null : (
        /* Boxed for the same reason the shelves are — see `renderBlock`. */
        /*
         * THE HEADER KEEPS BOTH MARGINS; THE RAIL GIVES UP ITS RIGHT ONE.
         *
         * That 16pt strip is where the peek lives — see `StatsRail`. The two
         * whole cards still begin and end exactly where the tiles below them
         * do, so nothing about the grid moves; a slice of the third simply
         * appears in the margin, which is the only honest way to say "there is
         * more, that way" without an icon.
         */
        <View>
          {/* STATS. Absent, not zeroed, when there is nothing to show: "has
              watched nothing" and "has never synced" are different sentences. */}
          <View style={{ marginHorizontal: space.lg }}>
            <SectionHeader title={t('stats.title')} onPress={onStatsPress} pad={0} />
          </View>
          {layout === 'classic' ? (
            <View style={styles.railBleed}>
              <StatsRail contentWidth={BLOCK_W} cards={statsCards} accent={themeColor} />
            </View>
          ) : (
            <View style={styles.shelfCard}>
              <StatsGrid cards={statsCards} accent={themeColor} compact={layout === 'poster'} />
            </View>
          )}
        </View>
      ),
    lists: () =>
      list == null ? null : (
        <>
      {/* PRESENT WHENEVER THE CALLER PASSES ONE, even with nothing in it.
          This used to hide on `listItems.length > 0`, and on the owner's own
          profile that was the only door to the Lists screen — so a library
          with no lists had no way to reach the one button that makes one.
          A public profile still passes null when the person has none. */}
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
                <>
                  <Text style={styles.collageName}>{first.name}</Text>
                  {first.shared === true && <SharedMark count={first.memberCount} />}
                </>
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
              {first.shared === true && <SharedMark count={first.memberCount} />}
            </Pressable>
          )}
        </>
      ),
    extra: () => children ?? null,
  };

  /**
   * The three squares. Each returns null when it has nothing, which is the
   * collapse rule — a first-day account simply does not show them rather than
   * showing "no favourite character yet", and the page grows on its own as the
   * library does.
   */
  /*
   * The three squares that used to be written out here — Tracking since,
   * Favourite character, Streak — are widgets now, in `profile-widgets.tsx`
   * with the other eleven. One place where a widget is drawn, one place where
   * its size is decided.
   */

  /** One block by id, including a single shelf. Empty ones return null and
   *  collapse, exactly like every other block. */
  const renderBlock = (id: string, span: WidgetSpan, data?: string, uid?: string): ReactNode => {
    const widget = renderWidget(
      id,
      span,
      own,
      data,
      // Only while arranging, and only for the owner: the slots' plus and minus
      // are the count control, so they are wired straight to the arrangement.
      canArrange && uid != null
        ? {
            editing,
            onCount: (n: number) => {
              tapLight();
              onArrange?.((arrangement ?? []).map((p) => (p.uid === uid ? { ...p, data: String(n) } : p)));
            },
          }
        : undefined,
      // Present only on a visitor's screen; its presence is what tells the
      // widget which database it may read.
      published ? { value: published.get(uid ?? id) } : undefined,
    );
    if (widget != null) return widget;
    if (id.startsWith(SHELF_PREFIX)) {
      const sh = shelves.find((x) => x.key === id.slice(SHELF_PREFIX.length));
      if (!sh || sh.items.length === 0) return null;
      /*
       * A SHELF IS A BOX, like every other block on this page.
       *
       * It used to be a heading with a rail running the full width of the
       * screen underneath it, which was correct when the profile was a page
       * and wrong the moment it became a grid: a rail that bleeds off both
       * edges is the one thing on the screen with no shape, sitting between
       * things that all have one. Boxing it means the posters are clipped by
       * the card and scroll INSIDE it — so a shelf reads as the same kind of
       * object as a stat tile, just a wider one.
       *
       * The rail is told the card's inner width rather than the screen's, or
       * it would size its posters for room it does not have and the fourth
       * would be cut by the border instead of landing on it.
       */
      /* Header inside both margins, rail inside only the left one — the same
         split as Stats, and for the same reason: the right margin is the peek. */
      return (
        <View>
          <View style={{ marginHorizontal: space.lg }}>
            <SectionHeader title={sh.title} heart={sh.heart} onPress={sh.onTitlePress} pad={0} />
          </View>
          <View style={styles.railBleed}>
            <PosterRail items={sh.items} onItemPress={sh.onItemPress} contentWidth={RAIL_W} />
          </View>
        </View>
      );
    }
    // The span is passed on: a couple of the slots draw themselves differently
    // at different sizes — the heatmap spends it on how many months it covers.
    return blockContent[id]?.(span) ?? null;
  };

  /*
   * ARRANGING IS A MODE, and it lives here rather than on the tab because the
   * gesture that starts it is on the blocks.
   */
  const [editing, setEditing] = useState(false);
  /**
   * Called from a worklet, so it has to be a plain function.
   *
   * THE PLUS GATE IS HERE, ON ARRANGING, AND NOWHERE ELSE — which is the whole
   * design of the paid tier in one line. A visitor who is not Plus must still
   * see the profile its owner built, or Plus buys nothing worth having: a thing
   * to show off is worthless if only the people who already pay can see it. So
   * rendering somebody's arrangement is free forever, and building your own is
   * what costs.
   *
   * `requirePlus` returns false and shows the paywall — or, while the tier
   * cannot be bought at all, returns false and does nothing, which is what
   * ships this feature dark in 1.4.1.
   */
  const startEditing = () => {
    if (!requirePlus('profile_widgets')) return;
    tapLight();
    setEditing(true);
  };
  const canArrange = onArrange != null && own;

  /**
   * The measured heights of the CONTENT-SIZED blocks, by instance. The sized
   * widgets take their height from the grid; the furniture — banner, bio,
   * counts, shelves — is as tall as whatever is in it, and the canvas below
   * cannot place the block after one without knowing. `onLayout` here is
   * parent-relative and reliable, because every block is a direct child of the
   * one canvas view — the property the old window-measuring never had.
   *
   * STATE, NOT A REF. A height arriving must recompute every position under
   * it, which is a re-render; the Compiler would happily cache a render-time
   * ref read for ever. See CLAUDE.md.
   */
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const noteHeight = (uid: string, h: number) => {
    setHeights((prev) => {
      const known = prev.get(uid);
      // Sub-pixel wobble from rounding must not trigger a relayout loop.
      if (known != null && Math.abs(known - h) <= 1) return prev;
      const next = new Map(prev);
      next.set(uid, h);
      return next;
    });
  };

  const moveBlock = (from: number, to: number, placed: readonly Placed[]) => {
    const next = placed.slice();
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(to, 0, item);
    onArrange?.(next);
  };

  /** BY INSTANCE. Filtering on `id` would take off both Photos when somebody
   *  removed one of them. */
  const removeBlock = (uid: string, placed: readonly Placed[]) => {
    tapLight();
    onArrange?.(placed.filter((p) => p.uid !== uid));
  };

  return (
    <View style={{ flex: 1, backgroundColor: pageColor }}>
      <Animated.View style={[styles.cover, coverStyle]}>
        {coverUri != null ? (
          <Image source={{ uri: coverUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : coverSource ? (
          <Image source={coverSource} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : null}
        {/* The old flat 65% veil stays for the classic body — it is what makes
            white text legible on any artwork. The cards body dims less and
            dissolves instead, so the show is still recognisable. */}
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: layout !== 'classic' ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.65)' },
          ]}
        />
        {/* THE COLOUR REACHES THE ARTWORK. Veiling the cover in flat black and
            then tinting only the body left a themed page with an untinted
            picture at the top of it — the one part everybody looks at. A
            themed cover is what makes the whole screen read as one object. */}
        {themeColor != null && (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: themeColor, opacity: 0.28 }]} />
        )}
        {layout !== 'classic' && <CoverFade color={pageColor} height={140} />}
        <View style={[styles.coverBar, { marginTop: insets.top + 6 }]}>
          {/* Both slots are rendered even when empty, so the centred name stays
              centred on a screen that has a bell and one that does not. */}
          <View style={styles.barSlot}>{barLeft}</View>
          <Animated.Text style={[styles.barName, barNameStyle]} numberOfLines={1}>
            {username}
          </Animated.Text>
          <View style={styles.barSlot}>{barRight}</View>
        </View>
        <Animated.View style={[styles.identity, layout !== 'classic' && styles.identityCards, identityStyle]}>
          <View
            style={[
              styles.avatar,
              layout !== 'classic' && styles.avatarCards,
              themeColor != null && { borderWidth: 2, borderColor: themeColor },
            ]}>
            {avatar}
          </View>
          <View style={[styles.nameBlock, layout !== 'classic' && styles.nameBlockCards]}>
            <View style={styles.nameRow}>
              <Text style={[styles.username, layout !== 'classic' && styles.usernameCards]} numberOfLines={1}>
                {username}
              </Text>
              {/* An outline, not a filled badge: it sits beside a name, not
                  above it. Yellow acts elsewhere in this app — here it is the
                  accent on a chip that does nothing when tapped. */}
              {isPrivate && (
                <View style={styles.privateChip}>
                  <Ionicons name="lock-closed" size={11} color={colors.dim} />
                  <Text style={styles.privateChipText}>{t('profile.privateBadge')}</Text>
                </View>
              )}
              {plus && plusUi && (
                <View style={[styles.plusChip, themeColor != null && { borderColor: themeColor }]}>
                  <Text style={[styles.plusChipText, themeColor != null && { color: themeColor }]}>
                    {t('plus.badge')}
                  </Text>
                </View>
              )}
            </View>
            {joined != null && joined.length > 0 && (
              <Text style={styles.joined} numberOfLines={1}>
                {joined}
              </Text>
            )}
            {/* WRAPPED, because the pill sets its own `alignSelf: flex-start`
                — Edit here, Follow on a public profile — and a child's
                alignSelf beats the parent's alignItems, so centring the column
                left the button stubbornly on the left. The wrapper takes the
                centring; the pill keeps its own alignment inside a box that
                fits it. Neither caller has to know which body is drawn. */}
            {layout !== 'classic' ? <View style={styles.pillWrap}>{pill}</View> : pill}
          </View>
        </Animated.View>
      </Animated.View>

      {/*
        THE SHOW'S OWN ARTWORK, BEHIND THE WHOLE PAGE.
        
        A colour taken from a poster is a fact about the poster; it is not the
        poster. Themed with a hue alone the page said "blue", and the thing
        somebody actually wants it to say is the name of the show.
        
        So the same image already sitting at the top -- the cover, chosen in the
        same act that picked the colour, and already on this device -- is blurred
        hard and laid under everything. Nothing is downloaded and no data
        changes: the artwork was always here, it was only ever allowed to occupy
        140 points at the top.
        
        Blurred to 64 because it must not compete: at that radius it is light
        and shape rather than a picture, which is what makes a page feel like it
        belongs to something without asking anybody to read it.
      */}
      {themeColor != null && (coverUri != null || coverSource != null) && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Image
            source={coverUri != null ? { uri: coverUri } : coverSource!}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            blurRadius={64}
            cachePolicy="disk"
          />
          {/* Pushed most of the way back down, or the text loses its ground. */}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: pageColor, opacity: 0.78 }]} />
        </View>
      )}

      {/* Sits over the artwork, so the theme is strongest where the identity is
          and gone by the posters. */}
      {themeColor != null && <ThemeWash from={washTop} to={pageColor} />}

      {/*
        THE LONG PRESS IS ON THE PAGE, NOT ON THE WIDGETS.
        
        It used to live on each block, which meant a profile stripped down to
        nothing had nothing to press: no way to add, no way to edit, no way out
        short of reinstalling. Counting the arrangement was not the guard it
        looked like either — the banner cannot be removed, so the list is never
        empty, but the banner DRAWS nothing when there is no cover and no name.
        A page can be blank while its arrangement is not.
        
        Here it cannot fail: the gesture is on the whole scroll view, so there
        is always somewhere to press. The blocks keep their own gestures and win
        where they overlap, which is what `Simultaneous` is for.
      */}
      <GestureDetector
        gesture={Gesture.LongPress()
          .minDuration(450)
          .enabled(canArrange && !editing)
          .onStart(() => {
            runOnJS(startEditing)();
          })}>
      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingTop: FULL, paddingBottom: 24 }}>
        {/*
          ONE FLAT CANVAS, EVERY BLOCK A DIRECT CHILD, EVERY POSITION COMPUTED.

          The body used to be folded into row `<View>`s — two 1x1s sharing one —
          and that structure is what broke arranging twice over. A live reorder
          moved a block into a DIFFERENT row, which is a different parent, which
          is a React remount, which kills the Pan gesture running on it
          mid-drag. And because position then lived in the row structure, it had
          to be MEASURED back out (`measureInWindow`) for the drop to hit-test
          against — measurements that went stale the moment anything moved,
          because `onLayout` only re-fires when a view's own layout changes.

          So: one absolutely-positioned canvas. Blocks never change parent and
          never remount; their keys are their instance ids; and their positions
          are ARITHMETIC over the ordered list, which means the drag can
          hit-test against the same numbers the drawing came from. Nothing is
          measured except the heights of content-sized furniture — and that via
          a parent-relative `onLayout` that genuinely works here, because the
          canvas is every block's direct parent.
        */}
        {(() => {
          /*
           * TAKEN AS GIVEN, NOT RECONCILED AGAIN.
           *
           * This used to call `normalise(arrangement)` on every render, and
           * that is what made removal impossible however carefully the SAVED
           * arrangement remembered things. `normalise` appends widgets the list
           * has never known, and a bare in-memory array has no memory: it can
           * only take its own contents as the record of what it has held. So
           * the instant a widget was filtered out, the very next render decided
           * it was new and put it back at the end — before anything reached
           * SQLite, and no matter what SQLite said.
           *
           * Reconciling is the CALLER's job, done once, against what was
           * actually stored (see the Profile tab). By the time an arrangement
           * arrives here it is already the answer. A public profile passes
           * none, and gets the default.
           */
          const placed = arrangement ?? defaultLayout(shelves.map((sh) => sh.key));
          /** `at` is the index in `placed`, which is the space reorders speak
           *  in — a block whose content is null occupies no slot on screen but
           *  still counts in the arrangement. */
          const rendered = placed
            .map((p: Placed, at: number) => ({ ...p, at, content: renderBlock(p.id, p.span, p.data, p.uid) }))
            .filter((b) => b.content != null);

          /*
           * THE LAYOUT WALK. A cursor moves down the canvas; two 1x1s share a
           * line, anything wider closes whatever half-row was open and takes
           * the full width. The span comes from the PLACEMENT rather than the
           * catalogue, because the whole point of resizing is that the same
           * widget can be either.
           *
           * Sized widgets get the grid's height and sit inside the page
           * margin; furniture spans the full content width at x = 0 and keeps
           * its own internal margins, exactly as it did when it was a direct
           * child of the scroll — so the counts band still bleeds to the
           * edges and the shelves still indent themselves.
           */
          const m = gridMetrics(W);
          /** The inter-block spacing the old `styles.block` marginBottom gave. */
          const BLOCK_GAP = space.xl;
          /** Until a furniture block reports its height, a guess. One frame of
           *  shuffle on first paint is the price of never blocking on it. */
          const EST_H = 200;
          type Laid = (typeof rendered)[number] & Frame;
          type Frame = { x: number; y: number; w: number; h: number; fixed: boolean };
          const laid: Laid[] = [];
          let cursor = 0;
          let pendingHalf: { height: number } | null = null;
          const closeHalf = () => {
            if (pendingHalf == null) return;
            cursor += pendingHalf.height + BLOCK_GAP;
            pendingHalf = null;
          };
          for (const b of rendered) {
            const fixed = specOf(b.id).sized === true;
            const h = fixed ? m.height(b.span === '2x2' ? 2 : 1) : (heights.get(b.uid) ?? EST_H);
            if (b.span === '1x1') {
              if (pendingHalf == null) {
                laid.push({ ...b, x: space.lg, y: cursor, w: m.col, h, fixed });
                pendingHalf = { height: h };
              } else {
                laid.push({ ...b, x: space.lg + m.col + GRID_GUTTER, y: cursor, w: m.col, h, fixed });
                cursor += Math.max(pendingHalf.height, h) + BLOCK_GAP;
                pendingHalf = null;
              }
            } else {
              closeHalf();
              laid.push({ ...b, x: fixed ? space.lg : 0, y: cursor, w: fixed ? m.block : CONTENT_W, h, fixed });
              cursor += h + BLOCK_GAP;
            }
          }
          closeHalf();

          /**
           * Which SLOT a canvas point is over — a block, and which side of it.
           *
           * Naming the side is what turns a list into a grid to use. Landing
           * "on" a block is ambiguous the moment two of them share a line:
           * dropping on the left square of a pair has to mean something
           * different from dropping on the right. So a half-width block is
           * split down the middle, a full-width one across it, and the answer
           * is a position BETWEEN blocks rather than one of them. Hitting the
           * dragged block's own slot returns `from` / `from + 1`, which the
           * drag treats as the no-op it is.
           */
          const slotAt = (px: number, py: number): number | null => {
            for (const r of laid) {
              if (px < r.x || px > r.x + r.w || py < r.y || py > r.y + r.h) continue;
              const past = r.w <= m.col ? px > r.x + r.w / 2 : py > r.y + r.h / 2;
              return past ? r.at + 1 : r.at;
            }
            return null;
          };

          return (
            /* The canvas. Height is the cursor's final position — absolute
               children contribute nothing to it on their own. Centred so a
               tablet keeps the content cap. */
            <View
              style={{
                height: Math.max(cursor, editing ? m.height(1) + BLOCK_GAP : 0),
                width: '100%',
                maxWidth: CONTENT_MAX_WIDTH,
                alignSelf: 'center',
              }}>
              {/* SOMETHING TO AIM AT WHEN THERE IS NOTHING ELSE. A profile
                  stripped to the banner is a legitimate arrangement, but while
                  ARRANGING one it is a blank page with no clue that the plus at
                  the bottom is what fills it. */}
              {editing && laid.length === 0 && (
                <Pressable
                  style={[styles.emptyAdd, { top: 0, height: m.height(1) }]}
                  onPress={() => onAddWidget?.()}>
                  <Ionicons name="add" size={26} color={colors.dim} />
                  <Text style={styles.emptyAddText}>{t('editLayout.add')}</Text>
                </Pressable>
              )}
              {laid.map((b) =>
                canArrange ? (
                  <ArrangeableBlock
                    key={b.uid}
                    index={b.at}
                    editing={editing}
                    canRemove={b.id !== LOCKED}
                    rect={{ x: b.x, y: b.y, w: b.w, h: b.h }}
                    fixedHeight={b.fixed}
                    slotAt={slotAt}
                    /* THE SAME DOOR, NOT A SECOND ONE. Each block carries its
                       own long-press, and this called `setEditing` directly —
                       so the gate on the page-level press was bypassed by
                       holding any widget, which is how everybody would do it.
                       One function, gated once. */
                    onEnter={startEditing}
                    onRemove={() => removeBlock(b.uid, placed)}
                    /*
                     * ONLY FOR WIDGETS THAT CARRY SOMETHING A PERSON CHOSE.
                     *
                     * A streak or a heatmap has nothing to edit — the library
                     * decides what it says — so a pencil on those would be a
                     * control that does nothing. Links, a picture and a GIF are
                     * the three whose contents are a choice, and until now the
                     * only way to change one was to delete it and start again:
                     * survivable for a poster, absurd for eight links, where a
                     * single typo cost the lot.
                     */
                    onEdit={
                      b.id === 'links'
                        ? () => router.push(`/edit-links?uid=${encodeURIComponent(b.uid)}&span=${b.span}`)
                        : b.id === 'artwork'
                          ? () => router.push(`/pick-artwork?span=${b.span}&uid=${encodeURIComponent(b.uid)}`)
                          : b.id === 'gif'
                            ? () => router.push(`/pick-gif?span=${b.span}&uid=${encodeURIComponent(b.uid)}`)
                            : undefined
                    }
                    onMove={(from, to) => moveBlock(from, to, placed)}
                    scrollRef={scrollRef}
                    scrollY={scrollY}
                    onMeasure={b.fixed ? undefined : (h) => noteHeight(b.uid, h)}
                    /* Full-width furniture starts at x=0 and insets itself, so
                       its badge belongs at the margin, not off the canvas. */
                    /*
                     * ABOVE THE BLOCK, NOT ON ITS FIRST WORD.
                     *
                     * Furniture starts with a section title at the page margin,
                     * and a badge at `space.lg - 6` sat straight on top of it:
                     * "Stats" read "tats", "Lists" read "sts", "Shows" read
                     * "hows". A control that eats the label it belongs to reads
                     * as a rendering fault rather than a button.
                     *
                     * BLOCK_GAP is `space.xl`, so there is room above every
                     * block to put it in the gap instead. A sized widget keeps
                     * its corner badge, which overlaps artwork rather than
                     * words.
                     */
                    badgeLeft={b.fixed ? -6 : space.lg - 6}
                    badgeTop={b.fixed ? -6 : -22}>
                    {b.content}
                  </ArrangeableBlock>
                ) : (
                  /* A public profile: the same canvas, none of the wiring. */
                  <View
                    key={b.uid}
                    style={[
                      { position: 'absolute', left: b.x, top: b.y, width: b.w },
                      b.fixed && { height: b.h },
                    ]}
                    onLayout={b.fixed ? undefined : (e) => noteHeight(b.uid, e.nativeEvent.layout.height)}>
                    {b.content}
                  </View>
                ),
              )}
            </View>
          );
        })()}
      </Animated.ScrollView>
      </GestureDetector>

      {/* Only while arranging. A permanent Edit control would cost every visit
          to serve the one occasion somebody rearranges. */}
      {/*
        NO SIZE SHEET. A widget's size is chosen once, when it is added, and
        that is the whole of it -- changing your mind means taking it off and
        putting it back at the size you want. Tapping a widget to resize it was
        a second, hidden control competing with the one in the picker, and it
        made a plain tap during arranging do something unexpected to whatever
        was under your finger.
      */}
      {canArrange && editing && (
        <ArrangeBar
          onAdd={() => onAddWidget?.()}
          onDone={() => {
            tapLight();
            setEditing(false);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  /** A section that clips its own rail — see the note where it is used. */
  shelfCard: { marginHorizontal: space.lg, overflow: 'hidden' },
  /** Left margin only: the right one is where the peek shows. */
  railBleed: { marginStart: space.lg },
  tile: {
    flex: 1,
    // THE SAME EDGE THE STAT CARDS ABOVE ALREADY HAVE. `colors.card` on a
    // near-black page is a slightly lighter rectangle, not an object; the
    // hairline is what makes it read as a thing sitting on the page, which is
    // the whole premise of arranging things.
    //
    // TRANSLUCENT RATHER THAN BLACK, and that is the fix rather than the style:
    // `colors.bg` is right on a plain profile and wrong on a themed one, where
    // the page wears a wash mixed from the theme colour and a black tile sits
    // in it as a hole. White at 5% lifts whatever is behind it, so one value is
    // correct on black, on any theme, and in the Add sheet.
    backgroundColor: colors.lift,
    borderWidth: 1,
    // Translucent for the same reason as the fill: `colors.line` is a fixed
    // dark grey, which reads as a black outline on a themed page. A white
    // hairline at 12% is an edge on anything behind it.
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: 12,
    overflow: 'hidden',
  },
  /** The way back from an empty profile — see where it is rendered. */
  emptyAdd: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  emptyAddText: { color: colors.dim, fontSize: 14, fontWeight: '600' },
  tileLabel: {
    color: colors.faint,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  tileBody: { flex: 1, justifyContent: 'center' },
  tileBig: { color: colors.text, fontSize: 34, fontWeight: '900', letterSpacing: -1, lineHeight: 36 },
  tileName: { color: colors.text, fontSize: 17, fontWeight: '800', lineHeight: 21 },
  tileSub: { color: colors.dim, fontSize: 11.5, marginTop: 6 },

  // SHOW_BLOCK_BOUNDS only — see the note beside it.
  blockBounds: { borderWidth: 1, borderColor: '#FFD40055', borderRadius: 10, marginBottom: 8 },
  blockLabel: {
    color: '#FFD400',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: 8,
    paddingTop: 4,
  },

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
  // Avatar over name, both centred: the reference's shape, and the one that
  // gives a themed cover room to be looked at rather than stood next to.
  identityCards: { flexDirection: 'column', alignItems: 'center', gap: 8 },
  avatarCards: { width: 84, height: 84, borderRadius: 42 },
  nameBlockCards: { alignItems: 'center' },
  pillWrap: { alignSelf: 'center' },
  usernameCards: { fontSize: 18.5 },
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
  privateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  privateChipText: { color: colors.dim, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4 },
  plusChip: {
    borderWidth: 1,
    borderColor: colors.yellow,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  plusChipText: { color: colors.yellow, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  /** No bottom rule either — same reason: the band is already a different
   *  surface from the page under it, and a line saying so is a line. */
  statBand: { flexDirection: 'row' },
  // No dividing lines and real vertical room: in the cards body the counts are
  // a header for the grid under them, not a band ruled off from it.
  statBandCards: { borderBottomWidth: 0, paddingTop: 6, paddingBottom: 14 },
  joined: { color: colors.dim, fontSize: 12.5, marginTop: 3 },
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
  /* Top-trailing, opposite the name, so it never crowds a long list title. */
  sharedMark: {
    position: 'absolute',
    top: 10,
    end: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sharedMarkText: { color: colors.text, fontSize: 11, fontWeight: '800' },
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
