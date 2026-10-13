/**
 * THE COMMUNITY'S AVERAGE, AND THE TEN ROWS BEHIND IT (2.0.0) — one component
 * for the film and episode screens, so the two cannot drift.
 *
 * TV Time printed "T ★★★★★ 4.9/5" under "Episode info"
 * (design/referance/13-episode-page-bottom.png). This is that line, with the
 * number of ratings after it, and a tap opens what the five columns under the
 * stars cannot say: how many gave 3.5 rather than 4. The arithmetic is
 * `ratingBreakdown` in pure.ts, where it is tested; this file only draws.
 *
 * The sheet is `ActionSheet` with no actions and these rows as its body — its
 * slide, backdrop and screen-reader close, rather than a second copy of them.
 * `Modal` is what makes it work on these `transparentModal` screens: the film
 * screen's ⋯ menu is the same sheet on the same kind of screen.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ReactNode } from 'react';
import { I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionSheet } from '@/components/action-sheet';
import { StarRow } from '@/components/half-stars';
import { currentLocale, t } from '@/i18n';
import { ratingBreakdown } from '@/pure';
import { starsValue } from '@/star-rating';
import { colors, space } from '@/theme';

/** "3.9", "4.0" — always one decimal, as TV Time's "4.9/5" was. */
const oneDecimal = (n: number) => n.toLocaleString(currentLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** A step as a reader says it: 10 → "5", 7 → "3.5". */
const stepText = (ten: number) => starsValue(ten).toLocaleString(currentLocale());

/**
 * The line, and the sheet it opens. Draws nothing when nobody has scored the
 * title — no "—/5", no "0 ratings": an empty line is not information.
 *
 * `counts` is the aggregate's `score_counts` as it arrived; `mine` is this
 * person's own rating out of ten, for the highlighted row. `children` go in
 * front of the stars, for the episode screen's "T" badge.
 */
export function CommunityRating({
  counts,
  mine,
  children,
}: {
  counts: unknown;
  mine: number | null;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const b = ratingBreakdown(counts);
  if (!b) return null;

  const avg = oneDecimal(b.average);
  const ratings = t('ratingBreakdown.count', { count: b.count });
  const line = `${avg}/5 · ${ratings}`;
  const label = t('ratingBreakdown.averageLabel', { value: avg, ratings });
  // the average drawn to the nearest half star — 3.9 is four, 3.7 three and a half
  const ten = Math.round(b.average * 2);

  const top = Math.max(0, ...b.steps.map((r) => r.percent));
  return (
    <>
      <Pressable
        style={s.line}
        hitSlop={8}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={t('ratingBreakdown.averageHint')}>
        {children}
        <StarRow ten={ten} size={16} on={colors.yellow} off={colors.pillGrey} />
        <Text style={s.lineText}>{line}</Text>
        {/* it opens something, and says so — the reason "Stats" without a ›
            is on the known-bugs list */}
        <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={14} color={colors.dim} />
      </Pressable>

      <ActionSheet visible={open} title={t('ratingBreakdown.title')} actions={[]} onClose={() => setOpen(false)}>
        <View style={s.head} accessible accessibilityLabel={label}>
          <StarRow ten={ten} size={20} on={colors.yellow} off={colors.pillGrey} />
          <Text style={s.headText}>{line}</Text>
        </View>
        {/* Five stars down to half a star, every step present: a 0% step is an
            empty bar, which is itself the answer to "did anyone give it 2.5". */}
        {/* Bars against the BIGGEST step, as Letterboxd draws them: against
            100% a 23% top step filled under a quarter of the track and every
            row looked alike (14 Oct). The figure beside each bar stays the
            true share. */}
        {b.steps.map((r) => {
          const yours = r.ten === mine;
          const said = t('ratingBreakdown.row', { count: starsValue(r.ten), value: stepText(r.ten), percent: r.percent });
          return (
            <View
              key={r.ten}
              style={[s.row, yours && s.rowMine]}
              accessible
              accessibilityLabel={yours ? `${said}, ${t('ratingBreakdown.mine')}` : said}>
              <View style={s.value}>
                <Ionicons name="star" size={12} color={yours ? colors.brand : colors.dim} />
                <Text style={[s.valueText, yours && s.mineText]}>{stepText(r.ten)}</Text>
              </View>
              <View style={s.track}>
                <View style={[s.fill, { width: `${top > 0 ? (r.percent / top) * 100 : 0}%`, backgroundColor: yours ? colors.brand : colors.dim }]} />
              </View>
              <Text style={[s.pct, yours && s.mineText]}>{`${r.percent}%`}</Text>
              <Text style={[s.count, yours && s.mineText]}>{r.count.toLocaleString(currentLocale())}</Text>
            </View>
          );
        })}
      </ActionSheet>
    </>
  );
}

const s = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineText: { color: colors.dim, fontSize: 13.5 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 12 },
  headText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: space.lg },
  rowMine: { backgroundColor: colors.lift },
  value: { width: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  valueText: { color: colors.dim, fontSize: 14, fontWeight: '600' },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  pct: { width: 40, textAlign: 'right', color: colors.dim, fontSize: 13, fontWeight: '600' },
  count: { width: 44, textAlign: 'right', color: colors.faint, fontSize: 12 },
  mineText: { color: colors.text, fontWeight: '800' },
});
