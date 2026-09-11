/**
 * How a show went, episode by episode, as YOU rated it.
 *
 * THE GAPS ARE THE FEATURE. An episode you never rated is not a low score and
 * not the average of the two beside it — it is silence, and a line drawn
 * through it would invent a rating you never gave. So the line stops at every
 * unrated episode and starts again after it, and a lone rating in a season is
 * a single dot rather than nothing at all. The arithmetic for that lives in
 * `ratingSeries` in pure.ts, where it is tested, because a chart that quietly
 * connects across a gap looks completely fine.
 *
 * DRAWN WITH PLAIN VIEWS, like `heatmap.tsx` and for the same reason: this app
 * carries no SVG or charting library, and a line is a rectangle rotated to an
 * angle. A segment per pair of neighbouring ratings, capped by the bucketing
 * in `bucketSeries` so a thousand-episode show cannot ask for a thousand of
 * them.
 */
import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { bucketSeries, ratingSeries, type ChartPoint } from '@/pure';
import { colors, space } from '@/theme';
import { t } from '@/i18n';

/** The app's own scale: 1..5 stars. TV Time's four-point scale imports into
 *  the same range, so one axis serves both. */
const MAX = 5;
const MIN = 1;
/** As many columns as can be told apart at phone width. */
const MAX_COLUMNS = 120;
const HEIGHT = 132;
const DOT = 5;
/** Room for the 1..5 labels down the left, so a dot can be read as a number. */
const GUTTER = 16;

export type RatingChartProps = {
  /** The show's episodes in broadcast order — the x axis itself. */
  episodes: { season: number; episode: number }[];
  /** `season-episode` → stars. */
  ratings: Map<string, number>;
};

export function RatingChart({ episodes, ratings }: RatingChartProps) {
  /*
   * MEASURED, NOT PASSED IN. The first version took a width from the caller,
   * which had to guess the padding around it — and guessed wrong: the line ran
   * off both edges and the first dot was cut in half by the screen. What the
   * plot may use is whatever the row it sits in actually gives it, and only
   * the row knows that.
   */
  const [plotW, setPlotW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width - GUTTER - DOT;
    if (w > 0 && Math.abs(w - plotW) > 0.5) setPlotW(w);
  };

  const series = ratingSeries(episodes, (s, e) => ratings.get(`${s}-${e}`) ?? null);
  if (series.rated === 0) return null;
  const width = plotW;

  const points = bucketSeries(series.points, MAX_COLUMNS);
  // The runs are recomputed from the BUCKETED points, not reused from `series`:
  // bucketing can swallow a one-episode gap or open a new one, and the line has
  // to break where it is actually drawn.
  const runs = splitRuns(points);

  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const plotH = HEIGHT - 18;
  const yOf = (v: number) => plotH - ((v - MIN) / (MAX - MIN)) * plotH;
  const xOf = (i: number) => i * stepX;

  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Text style={s.title}>{t('show.ratingChart.title', { count: series.rated })}</Text>
        <Text style={s.avg}>
          {(
            series.points.reduce((sum, p) => sum + (p.value ?? 0), 0) / series.rated
          ).toFixed(1)}
        </Text>
      </View>

      <View style={{ height: HEIGHT }} onLayout={onLayout}>
        {/* the scale, so a dot is a number rather than a height */}
        {[1, 3, 5].map((v) => (
          <Text key={`y${v}`} style={[s.yLabel, { top: yOf(v) - 6 }]}>
            {v}
          </Text>
        ))}
        <View style={{ position: 'absolute', left: GUTTER + DOT / 2, top: 0, right: 0, bottom: 0 }}>
        {/* the rails, so a dot can be read off without counting */}
        {[1, 2, 3, 4, 5].map((v) => (
          <View key={v} style={[s.rail, { top: yOf(v), width }]} />
        ))}

        {/* season boundaries, drawn behind the line */}
        {series.seasonStarts.slice(1).map((b) => {
          const i = points.findIndex((p) => p.season === b.season);
          return i <= 0 ? null : (
            <View key={b.season} style={[s.seasonRule, { left: xOf(i), height: plotH }]} />
          );
        })}

        {/* the line itself, one rectangle per pair — and nothing across a gap */}
        {runs.map((run, ri) =>
          run.slice(1).map((p, k) => {
            const a = run[k]!;
            const x1 = xOf(a.x);
            const y1 = yOf(a.value!);
            const x2 = xOf(p.x);
            const y2 = yOf(p.value!);
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.hypot(dx, dy);
            const angle = Math.atan2(dy, dx);
            return (
              <View
                key={`${ri}-${k}`}
                style={[
                  s.segment,
                  {
                    left: x1,
                    top: y1,
                    width: len,
                    // rotate about the left edge so the rectangle starts at the
                    // point rather than centred on it
                    transform: [{ translateY: -1 }, { rotateZ: `${angle}rad` }],
                  },
                ]}
              />
            );
          }),
        )}

        {/* a dot on every rating, which is what makes a run of one visible */}
        {points.map((p) =>
          p.value == null ? null : (
            <View
              key={p.x}
              style={[s.dot, { left: xOf(p.x) - DOT / 2, top: yOf(p.value) - DOT / 2 }]}
            />
          ),
        )}

        {/* season labels along the foot */}
        {series.seasonStarts.map((b) => {
          const i = points.findIndex((p) => p.season === b.season);
          return i < 0 ? null : (
            <Text key={b.season} style={[s.axis, { left: xOf(i) }]} numberOfLines={1}>
              {b.season === 0 ? t('show.ratingChart.specials') : `S${b.season}`}
            </Text>
          );
        })}
        </View>
      </View>
    </View>
  );
}

/** Unbroken stretches of rated points. The same rule as `ratingSeries`, applied
 *  to what will actually be drawn after bucketing. */
function splitRuns(points: ChartPoint[]): ChartPoint[][] {
  const runs: ChartPoint[][] = [];
  let cur: ChartPoint[] = [];
  for (const p of points) {
    if (p.value == null) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

const s = StyleSheet.create({
  wrap: { paddingTop: 6, paddingBottom: 10, paddingHorizontal: space.lg },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 12 },
  title: { color: colors.text, fontSize: 15, fontWeight: '800' },
  avg: { color: colors.yellow, fontSize: 17, fontWeight: '900' },
  rail: { position: 'absolute', height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.07)' },
  seasonRule: { position: 'absolute', top: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.12)' },
  segment: { position: 'absolute', height: 2, backgroundColor: colors.yellow, transformOrigin: 'left center' },
  dot: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.yellow,
  },
  axis: { position: 'absolute', bottom: 0, color: colors.faint, fontSize: 10, fontWeight: '700' },
  yLabel: { position: 'absolute', left: 0, width: GUTTER - 4, textAlign: 'right', color: colors.faint, fontSize: 10, fontWeight: '700' },
});
