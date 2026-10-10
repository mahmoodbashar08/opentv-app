/**
 * The yearly goal, drawn: a progress ring, one cell per kind, the profile
 * block, and the line on the year's Wrapped card. The rules are in
 * `@/yearly-goal`; this file only draws what they say.
 *
 * THE RING IS FOUR VIEWS, NOT A DEPENDENCY. There is no SVG library in this
 * app and a ring is not a reason to add one: a circle with a coloured border,
 * clipped to a half and rotated, draws any arc up to 180°, and two of them
 * draw the rest. React Native paints each side of a rounded border as its own
 * wedge split on the 45° diagonals, so "top + right" coloured is the right
 * half of the ring turned a quarter back — rotate that half by the angle you
 * want and clip what crosses the midline. Fiddly to derive, free to run.
 */
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { WidgetBox, type Published, type SlotEdit } from '@/components/profile-widgets';
import { currentLocale, t } from '@/i18n';
import { formatCount } from '@/locale-resolve';
import type { WidgetSpan } from '@/profile-layout';
import { colors } from '@/theme';
import {
  goalFor,
  goalOn,
  goalOnProfile,
  goalStatus,
  hasGoal,
  parsePublishedGoal,
  type GoalCell,
  type GoalKind,
} from '@/yearly-goal';

export function GoalRing({
  size,
  stroke,
  pct,
  color,
  children,
}: {
  size: number;
  stroke: number;
  /** 0–1. */
  pct: number;
  color: string;
  children?: ReactNode;
}) {
  const p = Math.max(0, Math.min(1, pct));
  const half = size / 2;
  const circle = { width: size, height: size, borderRadius: half, borderWidth: stroke } as const;
  // 12 o'clock clockwise: the right half covers the first 180°, the left the rest.
  const right = Math.min(p, 0.5) * 360;
  const left = Math.max(p - 0.5, 0) * 360;
  const arc = { ...circle, position: 'absolute' as const, borderColor: 'transparent', borderTopColor: color, borderRightColor: color };
  return (
    <View style={{ width: size, height: size }}>
      <View style={[circle, { position: 'absolute', borderColor: colors.line }]} />
      {right > 0 && (
        <View style={{ position: 'absolute', left: half, top: 0, width: half, height: size, overflow: 'hidden' }}>
          {/* the coloured half is 0–180° after +45°; turned back by (180 − arc)
              it covers (arc − 180)–arc, and the clip keeps 0–arc of that */}
          <View style={[arc, { left: -half, transform: [{ rotate: `${right - 135}deg` }] }]} />
        </View>
      )}
      {left > 0 && (
        <View style={{ position: 'absolute', left: 0, top: 0, width: half, height: size, overflow: 'hidden' }}>
          {/* same half turned forward by the arc: covers arc–(180 + arc), and
              the clip keeps the part past 180° */}
          <View style={[arc, { left: 0, transform: [{ rotate: `${left + 45}deg` }] }]} />
        </View>
      )}
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>{children}</View>
    </View>
  );
}

const kindLabel = (kind: GoalKind): string => (kind === 'films' ? t('yearlyGoal.films') : t('yearlyGoal.episodes'));

/** "3 ahead", "2 behind", "On track", "Done ✅" — or, for a year that has not
 *  started, when it does. */
export function paceText(c: GoalCell, future = false): string {
  if (c.reached) return t('yearlyGoal.reached');
  if (future) return t('yearlyGoal.startsSoon');
  if (c.delta > 0) return t('yearlyGoal.ahead', { count: c.delta });
  if (c.delta < 0) return t('yearlyGoal.behind', { count: -c.delta });
  return t('yearlyGoal.onTrack');
}

/**
 * One kind: the ring with the count inside, the target and the pace beside
 * it. GREEN CONFIRMS — the ring turns green only once the goal is done; until
 * then it is the accent, because a goal is a thing you act on. The pace line
 * is green when ahead and plain when behind: behind is a fact, not an alarm.
 */
export function GoalCellView({ c, size, future = false, big = false }: { c: GoalCell; size: number; future?: boolean; big?: boolean }) {
  const locale = currentLocale();
  const pace = paceText(c, future);
  const ring = c.reached ? colors.green : colors.yellow;
  return (
    <View
      style={s.cell}
      accessible
      accessibilityLabel={`${kindLabel(c.kind)}: ${t('yearlyGoal.progress', { done: formatCount(c.done, locale), target: formatCount(c.target, locale) })}, ${pace}`}>
      <GoalRing size={size} stroke={Math.max(5, Math.round(size / 9))} pct={c.target > 0 ? c.done / c.target : 0} color={ring}>
        <Text style={[s.inRing, { fontSize: big ? 26 : 15 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
          {formatCount(c.done, locale)}
        </Text>
      </GoalRing>
      <View style={s.cellText}>
        <Text style={[s.kind, big && { fontSize: 15 }]} numberOfLines={1}>
          {kindLabel(c.kind)}
        </Text>
        <Text style={[s.target, big && { fontSize: 14 }]} numberOfLines={1}>
          {t('yearlyGoal.progress', { done: formatCount(c.done, locale), target: formatCount(c.target, locale) })}
        </Text>
        <Text style={[s.pace, big && { fontSize: 14 }, c.delta > 0 && !c.reached && { color: colors.green }, c.reached && { color: colors.green }]} numberOfLines={1}>
          {pace}
        </Text>
      </View>
    </View>
  );
}

/**
 * The profile block. On the owner's phone it reads the library; on a visitor's
 * it draws the counts that travelled with the arrangement, and never the
 * reader's own database — see `Published` in `profile-widgets.tsx`.
 *
 * An owner with the goal on and no number yet sees an invitation rather than
 * nothing: they put the block there, and a blank where you put something is
 * a bug report. A visitor sees nothing in that case, which is the collapse
 * rule every widget follows.
 */
export function renderGoalWidget(span: WidgetSpan, slots?: SlotEdit, published?: Published): ReactNode {
  const isVisitor = published != null;
  const thisYear = new Date().getFullYear();
  let year = thisYear;
  let cells: GoalCell[];
  if (isVisitor) {
    const pub = parsePublishedGoal(published.value);
    if (!pub) return null;
    year = pub.year;
    cells = pub.cells;
  } else {
    if (!goalOn()) return null;
    cells = goalStatus(thisYear);
  }
  const label = t('yearlyGoal.block', { year: String(year) });
  const open = () => router.push('/yearly-goal');

  if (cells.length === 0) {
    return (
      <WidgetBox label={label} span={span}>
        <Pressable
          style={s.empty}
          disabled={slots?.editing}
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={t('yearlyGoal.blockEmpty', { year: String(year) })}>
          <Text style={s.emptyText}>{t('yearlyGoal.blockEmpty', { year: String(year) })}</Text>
        </Pressable>
      </WidgetBox>
    );
  }

  // The small size holds one ring — films first, the one people set goals
  // for; the wide one holds both side by side.
  const shown = span === '1x1' ? cells.slice(0, 1) : cells;
  const body = (
    <View style={s.row}>
      {shown.map((c) => (
        <GoalCellView key={c.kind} c={c} size={56} />
      ))}
    </View>
  );
  return (
    <WidgetBox label={label} span={span}>
      {isVisitor ? (
        body
      ) : (
        <Pressable style={{ flex: 1 }} disabled={slots?.editing} onPress={open} accessibilityRole="button" accessibilityLabel={label}>
          {body}
        </Pressable>
      )}
    </WidgetBox>
  );
}

/**
 * What the block publishes: THE YEAR AND FOUR NUMBERS PER KIND, nothing
 * else. No title can reach here because none is read. Null — and so dropped
 * by `publishableWidgets` — when the goal is off, unset, or the owner has
 * switched the profile copy off in Settings.
 */
export function goalWidgetValue(): unknown {
  if (!goalOn() || !goalOnProfile()) return null;
  const year = new Date().getFullYear();
  const cells = goalStatus(year);
  if (cells.length === 0) return null;
  return { year, cells: cells.map(({ kind, target, done, delta }) => ({ kind, target, done, delta })) };
}

/**
 * The line on the year's Wrapped hero: "Goal: 52 films — 61 done ✅", one
 * line per kind set. `films` and `episodes` are the recap's own counts for
 * the year, so the card and the block can never disagree about the number.
 */
export function goalShareLine(year: number, films: number, episodes: number): string | null {
  if (!goalOn()) return null;
  const g = goalFor(year);
  if (!hasGoal(g)) return null;
  const line = (goal: string, done: number, target: number) =>
    `${goal} — ${t('yearlyGoal.shareDone', { count: done })}${done >= target ? ' ✅' : ''}`;
  const parts: string[] = [];
  if (g.films != null) parts.push(line(t('yearlyGoal.shareFilms', { count: g.films }), films, g.films));
  if (g.episodes != null) parts.push(line(t('yearlyGoal.shareEpisodes', { count: g.episodes }), episodes, g.episodes));
  return parts.join('\n');
}

const s = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  cell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  cellText: { flex: 1, minWidth: 0, gap: 1 },
  inRing: { color: colors.text, fontWeight: '900', letterSpacing: -0.5 },
  kind: { color: colors.text, fontSize: 13, fontWeight: '800' },
  target: { color: colors.dim, fontSize: 12 },
  pace: { color: colors.dim, fontSize: 12, fontWeight: '700' },
  empty: { flex: 1, justifyContent: 'center' },
  emptyText: { color: colors.dim, fontSize: 12 },
});
