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
import { Fragment, type ReactNode } from 'react';
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

import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';

import { firstWatchDay, topCharacter, watchStreak } from '@/db';
import { CONTENT_MAX_WIDTH } from '@/components/ui';
import { Poster } from '@/components/poster';
import { PosterRail, SectionHeader, StatsGrid, StatsRail, type RailItem, type StatCard } from '@/components/profile-sections';
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
  blocks?: readonly string[];
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
  activity?: ReactNode;
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
  const STEPS = 16;
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
  const STEPS = 14;
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
              opacity: 1 - ((i + 1) / STEPS) ** 2 * 0.15,
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
export const SHELF_PREFIX = 'shelf:';

/**
 * THE GRID. Two columns, three sizes, exactly like a home screen.
 *
 * The list this replaces made the arrangement carry no information: you scroll
 * it once, top to bottom, and every profile is the same shape with different
 * posters. In a grid, SIZE means importance and POSITION is a choice — somebody
 * who puts their favourite character top-left has said something, and that is
 * the whole point of letting people arrange anything.
 *
 * Off by default while this is being judged. A grid of nothing but full-width
 * blocks looks identical to a list, which is why the small widgets below had to
 * exist before this could be looked at honestly.
 */
export const GRID = true;

/** The default arrangement, for a given set of shelves. */
export function defaultBlocks(shelfKeys: readonly string[]): string[] {
  return [
    'banners',
    'intro',
    'counts',
    'activity',
    'stats',
    // The squares sit between the numbers and the shelves: they are ABOUT the
    // person rather than about their library, which is the order the page
    // already follows.
    'since',
    'character',
    'streak',
    'lists',
    ...shelfKeys.map((k) => `${SHELF_PREFIX}${k}`),
    'extra',
  ];
}

/**
 * How wide each block wants to be, once there is a grid to want it in.
 *
 * Nothing reads this yet — every block still renders full width. It is here
 * because recording it now is free and adding it later is a data migration:
 * the moment a stored arrangement exists, changing what a block IS means
 * rewriting everybody's saved layout.
 */
/* The grid's units live in `ui.tsx`, next to CONTENT_MAX_WIDTH they derive
   from, so the Stats rail can size its cards to a 1x1 without this file and
   that one importing each other. Re-exported here because this is where blocks
   are described. */
export { GRID_GUTTER, gridMetrics, type BlockSpan } from '@/components/ui';
import { GRID_GUTTER, gridMetrics, type BlockSpan } from '@/components/ui';

/** The span each block occupies. Recorded per block rather than inferred,
 *  because the moment a saved arrangement exists, changing what a block IS
 *  means rewriting everybody's stored layout. */
export const BLOCK_SPAN: Record<string, BlockSpan> = {
  since: '1x1',
  character: '1x1',
  streak: '1x1',
  banners: '2x1',
  intro: '2x1',
  counts: '2x1',
  // Content-driven, and measured honestly rather than forced: a poster rail is
  // a poster's height plus its label plus a heading, which lands between one
  // row and two. 2x2 is what they ARE; the height stays with the content until
  // a stored arrangement needs them to snap.
  stats: '2x2',
  activity: '2x2',
  lists: '2x2',
  extra: '2x1',
};

export const blockSpan = (id: string): BlockSpan =>
  id.startsWith(SHELF_PREFIX) ? '2x2' : (BLOCK_SPAN[id] ?? '2x1');

/** The row-folding pass only needs to know whether a block shares its row.
 *  Derived from the span, so there is one source of truth rather than two. */
export function blockSize(id: string): 'small' | 'wide' | 'large' {
  const span = blockSpan(id);
  return span === '1x1' ? 'small' : span === '2x1' ? 'wide' : 'large';
}

/**
 * The squares.
 *
 * All three read something the phone already holds and no screen has ever shown
 * back: the oldest date in the import, the character voted for most often, and
 * the run of consecutive days. `character_votes` alone has 1,496 rows on the
 * server and appears nowhere in the app.
 *
 * They exist first because a grid whose blocks are all full width is a list
 * with rounded corners. Without squares there is nothing to judge.
 */
export const SMALL_BLOCKS = ['since', 'character', 'streak'] as const;

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
  blocks,
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
  const washTop = themeColor != null ? mixHex('#000000', themeColor, 0.42) : colors.bg;

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
  const blockContent: Record<string, () => ReactNode> = {
    banners: () => banners ?? null,
    intro: () => intro ?? null,
    counts: () => (
      <View
        style={[
          styles.statBand,
          layout !== 'classic' && styles.statBandCards,
          // A surface of its own in the theme, with a lit top edge. The band
          // was three numbers floating on the background; themed, it becomes
          // the first object on the page.
          themeColor != null && {
            backgroundColor: mixHex('#000000', themeColor, 0.22),
            borderTopWidth: 1,
            // THE SECOND COLOUR EARNS ITS KEEP HERE. A band edged in the same
            // hue as its fill is a shade; edged in the artwork's other colour
            // it reads as two things chosen together, which is the whole
            // difference between a tint and a palette.
            borderTopColor: mixHex('#000000', themeSecondary ?? themeColor, 0.55),
          },
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
    activity: () => activity ?? null,
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
              <StatsRail contentWidth={BLOCK_W} cards={statsCards} />
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
      ),
    extra: () => children ?? null,
  };

  /**
   * The three squares. Each returns null when it has nothing, which is the
   * collapse rule — a first-day account simply does not show them rather than
   * showing "no favourite character yet", and the page grows on its own as the
   * library does.
   */
  const smallBlock = (id: string): ReactNode => {
    if (id === 'since') {
      const day = firstWatchDay();
      if (!day) return null;
      const year = day.slice(0, 4);
      const years = new Date().getFullYear() - Number(year);
      return (
        <Tile label={t('profile.blockSince')}>
          <Text style={[styles.tileBig, themeColor != null && { color: themeColor }]}>{year}</Text>
          {years > 0 && <Text style={styles.tileSub}>{t('profile.blockSinceYears', { count: years })}</Text>}
        </Tile>
      );
    }
    if (id === 'character') {
      const c = topCharacter();
      if (!c) return null;
      return (
        <Tile label={t('profile.blockCharacter')}>
          <Text style={styles.tileName} numberOfLines={2}>
            {c.name}
          </Text>
          {c.show != null && (
            <Text style={styles.tileSub} numberOfLines={1}>
              {c.show}
            </Text>
          )}
        </Tile>
      );
    }
    if (id === 'streak') {
      const n = watchStreak();
      if (n < 2) return null; // a streak of one is not a streak
      return (
        <Tile label={t('profile.blockStreak')}>
          <Text style={styles.tileBig}>{n}</Text>
          <Text style={styles.tileSub}>{t('profile.blockStreakDays', { count: n })}</Text>
        </Tile>
      );
    }
    return null;
  };

  /** One block by id, including a single shelf. Empty ones return null and
   *  collapse, exactly like every other block. */
  const renderBlock = (id: string): ReactNode => {
    const small = smallBlock(id);
    if (small != null) return small;
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
    return blockContent[id]?.() ?? null;
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

      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingTop: FULL, paddingBottom: 24 }}>
        {/*
          TWO PASSES, BECAUSE A GRID CANNOT BE BUILT ONE ITEM AT A TIME. A run
          of consecutive small blocks has to be gathered into a row before any
          of it can be drawn, and a `wide` block ends whatever row was open. A
          `.map()` cannot see its neighbours, so the arrangement is folded into
          rows first and rendered second.
        */}
        {(() => {
          const ids = blocks ?? defaultBlocks(shelves.map((sh) => sh.key));
          const rendered = ids.map((id) => ({ id, content: renderBlock(id) })).filter((b) => b.content != null);
          if (!GRID) {
            return rendered.map((b) =>
              SHOW_BLOCK_BOUNDS ? (
                <View key={b.id} style={styles.blockBounds}>
                  <Text style={styles.blockLabel}>{b.id}</Text>
                  {b.content}
                </View>
              ) : (
                <Fragment key={b.id}>{b.content}</Fragment>
              ),
            );
          }
          const rows: { id: string; content: ReactNode }[][] = [];
          for (const b of rendered) {
            const last = rows[rows.length - 1];
            if (blockSize(b.id) === 'small' && last && last.length === 1 && blockSize(last[0].id) === 'small') {
              last.push(b);
            } else {
              rows.push([b]);
            }
          }
          return rows.map((row, i) =>
            row.length === 2 ? (
              <View key={`r${i}`} style={[styles.gridRow, styles.block]}>
                {row.map((b) => (
                  <View key={b.id} style={styles.gridHalf}>
                    {b.content}
                  </View>
                ))}
              </View>
            ) : (
              <View key={row[0].id} style={styles.block}>
                {row[0].content}
              </View>
            ),
          );
        })()}
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * A BOX THAT CLIPS AND NOTHING ELSE.
   *
   * It had a margin and 12pt of its own padding, which stacked on top of the
   * page's 16 — so Shows began at 28 while Lists, which is not boxed, began at
   * 16, and the two sections looked misaligned down the whole screen. A block
   * that indents its contents is a block with a different left edge from every
   * block beside it.
   *
   * So the box carries the page margin ITSELF and clips to it. Its children
   * take no padding of their own — the heading starts at the block's left edge,
   * which is the same 16 Lists starts at, and the rail is sized to the block's
   * inner width so poster four falls outside the clip rather than being
   * trusted to land on the screen edge.
   */
  shelfCard: { marginHorizontal: space.lg, overflow: 'hidden' },
  /** Left margin only: the right one is the peek. */
  railBleed: { marginStart: space.lg },
  gridRow: { flexDirection: 'row', gap: GRID_GUTTER, paddingHorizontal: space.lg },
  /**
   * THE CONTAINER SPACES THE BLOCKS, not the blocks themselves.
   *
   * Every section used to carry its own margins, so the gap between any two of
   * them was whatever those two happened to add up to — the stat cards sat flush
   * against the tiles below while other pairs had room to spare. That is
   * tolerable in a fixed page and impossible in one that can be rearranged: the
   * spacing would change depending on what somebody put next to what.
   */
  block: { marginBottom: space.xl },
  gridHalf: { flex: 1 },
  /** A 1x1. Height comes from `gridMetrics().row` at render time — see the
   *  `Tile` component; nothing here may hardcode a size. */
  tile: {
    flex: 1,
    // THE SAME EDGE THE STAT CARDS ABOVE ALREADY HAVE. `colors.card` on a
    // near-black page is a slightly lighter rectangle, not an object; the
    // hairline is what makes it read as a thing sitting on the page, which is
    // the whole premise of arranging things.
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: 12,
    overflow: 'hidden',
  },
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
  statBand: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.line },
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
