/**
 * The pieces a profile is built from — used by YOUR profile and by everybody
 * else's, so the two cannot drift apart.
 *
 * WHY THIS FILE EXISTS. The community profile was written as a second screen
 * that resembled the Profile tab: its own section headings, its own poster
 * rail, its own stat cards. Two implementations of one design diverge on the
 * first change — a tweak to the tab's rail leaves the other one behind — and
 * "somebody else's profile should look exactly like mine" then has to be
 * maintained by hand, for ever, by remembering.
 *
 * So the shared parts live here and both screens render THROUGH them. What
 * differs between the two is data and actions, which is what genuinely differs:
 * your own profile reads SQLite and offers Edit; theirs reads the server and
 * offers Follow.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlatList, I18nManager, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { CONTENT_MAX_WIDTH, GRID_GUTTER, gridMetrics } from '@/components/ui';
import { Poster } from '@/components/poster';
import { t } from '@/i18n';
import { mixHex } from '@/pure';
import { colors, radius, space } from '@/theme';

/**
 * How wide a poster is: THREE AND A HALF ACROSS.
 *
 * Three exactly was the previous answer, and it was wrong for the same reason
 * the Stats rail was — a shelf that ends flush with the margin looks like a
 * shelf that holds three things. The half poster is the affordance: it says
 * there is more, and which way, in the content's own terms rather than with an
 * icon bolted to the edge.
 *
 * As with Stats, the peek is paid for out of the RIGHT PAGE MARGIN, not out of
 * the posters. The rail keeps its left margin and gives up its right one, so
 * `room` is the page less one margin, and three whole posters plus three gaps
 * plus half a fourth fill it. On a 428pt phone that is 109pt a poster against
 * the 110 it was at three-across — the same size, and you can see there is a
 * library behind it.
 *
 * Earlier attempts tried to land poster four exactly ON the screen edge by
 * matching the gap to the margin. The arithmetic was right and the device
 * still showed a sliver, because a rounded-down width leaves its slack
 * somewhere. Wanting a sliver makes that a feature instead of a bug.
 */
export const posterWidth = (room: number, gap: number = GRID_GUTTER) =>
  Math.floor((Math.min(room, CONTENT_MAX_WIDTH) - gap * 3) / 3.5);

/** A section heading, with the heart the favourites rows carry. */
export function SectionHeader({
  title,
  onPress,
  heart,
  action,
  pad,
}: {
  title: string;
  onPress?: () => void;
  heart?: boolean;
  /** Horizontal inset. A heading inside a shelf card uses the card's own
   *  padding, not the page margin it would otherwise sit against. */
  pad?: number;
  /** A word in place of the chevron — "Hide" on a section that toggles rather
   *  than one that opens. A chevron promises a screen; this one has none. */
  action?: string;
}) {
  return (
    <Pressable
      style={[s.sectHead, pad != null && { paddingHorizontal: pad, paddingTop: pad, paddingBottom: 8 }]}
      onPress={onPress}
      disabled={!onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        {heart && (
          <View style={s.heart}>
            <Ionicons name="heart" size={15} color="#FFF" />
          </View>
        )}
        <Text style={s.sectTitle}>{title}</Text>
      </View>
      {action != null ? (
        <Text style={s.sectAction}>{action}</Text>
      ) : onPress ? (
        <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.dim} />
      ) : null}
    </Pressable>
  );
}

export type RailItem = { key: string; name: string; uri?: string | null };

/**
 * A horizontal shelf of posters.
 *
 * A FlatList and not a ScrollView because it can hold a WHOLE library: only
 * the visible posters mount and more render in as it scrolls, which is what
 * keeps a 500-show profile from locking the screen while it opens.
 */
export function PosterRail({
  items,
  onItemPress,
  contentWidth,
  gap = space.md,
}: {
  items: readonly RailItem[];
  onItemPress?: (key: string) => void;
  /** The room the rail has — the clipping block's inner width. Defaults to the
   *  screen, which is only right for a rail that is not inside one. */
  contentWidth?: number;
  gap?: number;
}) {
  const screen = useWindowDimensions().width;
  const width = posterWidth(contentWidth ?? screen, gap);
  return (
    <FlatList
      horizontal
      data={items as RailItem[]}
      keyExtractor={(it) => it.key}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap }}
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={5}
      renderItem={({ item }) => (
        <Pressable style={{ width }} onPress={() => onItemPress?.(item.key)}>
          <Poster name={item.name} uri={item.uri} />
        </Pressable>
      )}
    />
  );
}

/**
 * A shelf: heading plus rail, absent entirely when there is nothing in it.
 *
 * The absence is the point — a "Movies" heading over a blank strip reads as a
 * broken screen rather than as an empty shelf.
 */
export function ProfileShelf({
  title,
  items,
  heart,
  onTitlePress,
  onItemPress,
}: {
  title: string;
  items: readonly RailItem[];
  heart?: boolean;
  onTitlePress?: () => void;
  onItemPress?: (key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <SectionHeader title={title} heart={heart} onPress={onTitlePress} />
      <PosterRail items={items} onItemPress={onItemPress} />
    </>
  );
}

/** One number over its unit, as the clock stacks them. */
export function ClockPart({ value, unit }: { value: number; unit: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={s.clockNum}>{value}</Text>
      <Text style={s.clockUnit}>{unit}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  sectHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    // NO TOP PADDING — the block container owns the gap between blocks.
    // This used to be `space.xl`, which meant a section WITH a heading was
    // pushed down 20pt further than one without, on top of the container's
    // own margin. So the run of stat tiles sat 20 closer to what followed it
    // than "Lists" sat to what preceded it, and the page looked unevenly
    // spaced without anything obviously wrong with any one section.
    paddingTop: 0,
    paddingBottom: 10,
  },
  sectAction: { color: colors.dim, fontSize: 13, fontWeight: '700' },
  sectTitle: { color: colors.text, fontSize: 19, fontWeight: '800' },
  heart: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clockNum: { color: colors.text, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  clockUnit: {
    color: colors.faint,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 3,
  },
  statsCard: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    overflow: 'hidden',
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
  clockRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 18,
    paddingVertical: 10,
    flex: 1,
    alignItems: 'center',
  },
  bigNum: { color: colors.text, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },

  // The grid. Generous padding is the whole point — the rail's cards are
  // sized to fit four across a scroll, these are sized to be read.
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: space.lg,
    paddingTop: 4,
  },
  gridCard: {
    // Two per row, whatever the width, without measuring: half the row minus
    // half the gap.
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    minHeight: 96,
    justifyContent: 'space-between',
  },
  gridCardCompact: { flexBasis: '22%', minHeight: 76, paddingHorizontal: 8, paddingTop: 9, paddingBottom: 10 },
  gridLabelCompact: { fontSize: 9, letterSpacing: 0.3, lineHeight: 11 },
  gridBigCompact: { fontSize: 17, marginTop: 4 },
  gridLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.7 },
  gridClock: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 8 },
  gridClockPart: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  gridBig: {
    color: colors.text,
    fontSize: 27,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginTop: 8,
    letterSpacing: -0.5,
  },
  gridUnit: { color: colors.dim, fontSize: 13, fontWeight: '700' },
});

/**
 * THE SAME FOUR FACTS, AS A 2×2 GRID.
 *
 * The rail scrolls sideways, which hides half the numbers behind a gesture
 * nobody is told about — on a screen whose whole job is showing somebody what
 * they have watched. The grid shows all four at once, gives each one room, and
 * puts its label in the profile's own colour, which is what makes a themed
 * profile look themed rather than merely tinted.
 *
 * Same `StatCard` data as the rail, so a caller chooses the shape and changes
 * nothing else, and the two can never disagree about what a profile counts.
 */
/**
 * Which parts of a duration to draw: the non-zero ones, largest first.
 * "0m 24d 22h" spends a third of a small card saying nothing. A library with
 * nothing in it still shows its hours, so the card is never blank.
 */
function shownClockParts(months: number, days: number, hours: number) {
  const all = [
    { v: months, u: t('stats.clock.months') },
    { v: days, u: t('stats.clock.days') },
    { v: hours, u: t('stats.clock.hours') },
  ];
  const some = all.filter((p) => p.v > 0);
  return some.length > 0 ? some : [all[2]!];
}

export function StatsGrid({
  cards,
  accent,
  compact = false,
}: {
  cards: readonly StatCard[];
  accent?: string | null;
  /** Four across on one row instead of 2×2 — the poster body, where the
   *  numbers are a footnote and the artwork is the page. */
  compact?: boolean;
}) {
  if (cards.length === 0) return null;
  const label = accent ?? colors.dim;
  return (
    <View style={s.gridWrap}>
      {cards.map((c) => (
        <View
          key={c.key}
          style={[
            s.gridCard,
            compact && s.gridCardCompact,
            // THE CARD ITSELF WEARS THE THEME. Colouring only the label left
            // four grey boxes on a themed page, which is where the whole
            // feature stopped being visible: a tint you have to hunt for is
            // the same as no tint. Surface, edge and a lit top rule.
            accent != null && {
              backgroundColor: mixHex('#000000', accent, 0.2),
              borderWidth: 1,
              borderColor: mixHex('#000000', accent, 0.45),
            },
          ]}>
          {/* TWO LINES WHEN THERE ARE FOUR ACROSS. At a quarter of the screen
              "EPISODES WATCHED" cannot fit on one line at any size somebody
              can read, so it truncated to "EPISO…" — a label that names
              nothing. It wraps in the compact body and stays on one line in
              the 2×2, where it fits. */}
          <Text
            style={[s.gridLabel, compact && s.gridLabelCompact, { color: label }]}
            numberOfLines={compact ? 2 : 1}>
            {c.title.toUpperCase()}
          </Text>
          {/* Only the parts that are non-zero, largest first: "0m 24d 22h"
              spends a third of a small card saying nothing. A brand-new
              library still shows its hours rather than an empty card. */}
          {c.kind === 'clock' ? (
            compact ? (
              /**
               * ONE TEXT, ALLOWED TO SHRINK. Four separate runs in a row —
               * number, unit, number, unit — cannot shrink to fit anything:
               * each sizes to its own content and the row overflows the card,
               * which is why "25 DAYS 14 HOURS" ran past the edges of a card a
               * quarter of the screen wide. As one line it can be measured, and
               * `adjustsFontSizeToFit` guarantees it lands inside whatever
               * width the card has, at any number and in any language.
               */
              <Text
                style={[s.gridBig, s.gridBigCompact]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.55}>
                {shownClockParts(c.months, c.days, c.hours)
                  .map((part) => `${part.v}${part.u.slice(0, 1).toLowerCase()}`)
                  .join(' ')}
              </Text>
            ) : (
              <View style={s.gridClock}>
                {shownClockParts(c.months, c.days, c.hours).map((part) => (
                  <View key={part.u} style={s.gridClockPart}>
                    <Text style={s.gridBig}>{part.v}</Text>
                    <Text style={s.gridUnit}>{part.u}</Text>
                  </View>
                ))}
              </View>
            )
          ) : (
            <Text
              style={[s.gridBig, compact && s.gridBigCompact]}
              numberOfLines={1}
              adjustsFontSizeToFit={compact}
              minimumFontScale={0.6}>
              {c.value}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

/** One card in the Stats rail — a title over either a clock or a big number. */
export type StatCard =
  | { key: string; title: string; kind: 'clock'; months: number; days: number; hours: number }
  | { key: string; title: string; kind: 'number'; value: string };

/**
 * The Stats rail: TV time, Episodes watched, Movie time, Movies watched.
 *
 * FOUR CARDS, SCROLLING SIDEWAYS — the Profile tab's own shape, moved here so
 * a public profile shows the identical section rather than a lookalike with two
 * static cards. The two wide/narrow widths alternate exactly as the tab's did,
 * because a clock needs room for three numbers and a total does not.
 */
export function StatsRail({
  cards,
  contentWidth,
}: {
  cards: readonly StatCard[];
  /** The room the rail has — the clipping block's inner width. */
  contentWidth: number;
}) {
  /*
   * EVERY CARD IS A 1x1, and the rail is the window onto them.
   *
   * The widths used to alternate, 0.55 for a clock and 0.45 for a total, on the
   * reasoning that a clock needs room for three numbers. True in isolation, and
   * it made this the only place on the page where the same kind of fact came in
   * two sizes — neither of them matching the squares directly beneath it. A
   * stat card and a stat tile are now the same object at the same size; one of
   * them just scrolls.
   *
   * WHICH IS THE PROBLEM AN EXACT FIT CREATES. Two 1x1s plus a gutter is
   * exactly the block, so nothing shows past the right edge, and a perfect fit
   * reads as "this is everything" — the better it aligns with the grid below,
   * the more convincingly it lies about the two cards you cannot see.
   *
   * THE PEEK IS THE ANSWER, NOT AN ARROW. A slice of the next card is the one
   * affordance the research agrees on: it says there is more AND which way, in
   * the content's own terms. An icon is what gets added when the peek is
   * missing, and it competes with the section header's chevron, which means
   * something else entirely (open the Stats screen).
   *
   * The peek costs nothing here because it lives in the PAGE MARGIN. The rail
   * keeps its left margin and gives up its right one, so the two whole cards
   * still start and end exactly where the tiles below them do — card two's
   * right edge IS the tile's right edge — and card three appears in the 16pt
   * strip outside the grid. Alignment intact, and the sliver is plainly a
   * sliver rather than a card that got cut.
   */
  const { col, row } = gridMetrics(useWindowDimensions().width);
  if (cards.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: GRID_GUTTER, paddingEnd: space.lg }}>
      {cards.map((c) => (
        <View key={c.key} style={[s.statsCard, { width: col, height: row }]}>
          <Text style={s.statsCardTitle}>{c.title}</Text>
          {c.kind === 'clock' ? (
            <View style={s.clockRow}>
              {/* Zeroes dropped, so a library under a month reads "25 DAYS
                  14 HOURS" rather than leading with a nought — which matters
                  more now the box is a 1x1. */}
              {shownClockParts(c.months, c.days, c.hours).map((part) => (
                <ClockPart key={part.u} value={part.v} unit={part.u} />
              ))}
            </View>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={s.bigNum}>{c.value}</Text>
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );
}
