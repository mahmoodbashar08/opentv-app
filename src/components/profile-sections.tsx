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

import { CONTENT_MAX_WIDTH } from '@/components/ui';
import { Poster } from '@/components/poster';
import { t } from '@/i18n';
import { colors, radius, space } from '@/theme';

/** 3.8 posters across the readable width — the tab's number, kept exactly. */
export const posterWidth = (w: number) =>
  Math.round((Math.min(w, CONTENT_MAX_WIDTH) - space.lg - 3 * 8) / 3.8);

/** A section heading, with the heart the favourites rows carry. */
export function SectionHeader({
  title,
  onPress,
  heart,
}: {
  title: string;
  onPress?: () => void;
  heart?: boolean;
}) {
  return (
    <Pressable style={s.sectHead} onPress={onPress} disabled={!onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        {heart && (
          <View style={s.heart}>
            <Ionicons name="heart" size={15} color="#FFF" />
          </View>
        )}
        <Text style={s.sectTitle}>{title}</Text>
      </View>
      {onPress && (
        <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.dim} />
      )}
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
}: {
  items: readonly RailItem[];
  onItemPress?: (key: string) => void;
}) {
  const width = posterWidth(useWindowDimensions().width);
  return (
    <FlatList
      horizontal
      data={items as RailItem[]}
      keyExtractor={(it) => it.key}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingStart: space.lg, paddingEnd: space.sm, gap: 8 }}
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
    paddingTop: space.xl,
    paddingBottom: 10,
  },
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
}: {
  cards: readonly StatCard[];
  accent?: string | null;
}) {
  if (cards.length === 0) return null;
  const label = accent ?? colors.dim;
  return (
    <View style={s.gridWrap}>
      {cards.map((c) => (
        <View key={c.key} style={s.gridCard}>
          <Text style={[s.gridLabel, { color: label }]} numberOfLines={1}>
            {c.title.toUpperCase()}
          </Text>
          {c.kind === 'clock' ? (
            <View style={s.gridClock}>
              {/* Only the parts that are non-zero, largest first: "0m 24d 22h"
                  spends a third of a small card saying nothing. A brand-new
                  library still shows its hours rather than an empty card. */}
              {shownClockParts(c.months, c.days, c.hours)
                .map((part) => (
                  <View key={part.u} style={s.gridClockPart}>
                    <Text style={s.gridBig}>{part.v}</Text>
                    <Text style={s.gridUnit}>{part.u}</Text>
                  </View>
                ))}
            </View>
          ) : (
            <Text style={s.gridBig}>{c.value}</Text>
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
export function StatsRail({ cards, contentWidth }: { cards: readonly StatCard[]; contentWidth: number }) {
  if (cards.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingStart: space.lg, paddingEnd: space.sm, gap: 10 }}>
      {cards.map((c) => (
        <View
          key={c.key}
          style={[s.statsCard, { width: contentWidth * (c.kind === 'clock' ? 0.55 : 0.42) }]}>
          <Text style={s.statsCardTitle}>{c.title}</Text>
          {c.kind === 'clock' ? (
            <View style={s.clockRow}>
              {/* The SAME strings the Profile tab used — hardcoding English
                  here would have shipped as a bug in five languages. */}
              <ClockPart value={c.months} unit={t('stats.clock.months')} />
              <ClockPart value={c.days} unit={t('stats.clock.days')} />
              <ClockPart value={c.hours} unit={t('stats.clock.hours')} />
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
