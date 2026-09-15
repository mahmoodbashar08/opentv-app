'use no memo'; // react-native-android-widget needs raw functions — the React Compiler's memo transform breaks its tree builder
/**
 * "Watching" home-screen widget (Android) — the profile's activity grid, one
 * square per day, shaded by how much was watched.
 *
 * IT DECIDES NOTHING ABOUT THE DATA. Every square arrives already shaded as
 * '0'–'4' and the five colours arrive with it, from `heatWidgetData`. This
 * file is a nested loop over a string, which is the whole point: the grid
 * arithmetic and the colour ramp live in `pure.ts` next to their tests, not
 * here and again in Swift, drifting apart from the profile a month later.
 *
 * WHAT IT DOES DECIDE IS SIZE, and both dimensions bind — see `heatLayout`.
 * The first version took the square from the column count alone and parked the
 * result in a guessed height, so on a real tile the grid ran off the bottom
 * edge and the caption was drawn over the top of it.
 *
 * NO LIST WIDGETS, NO LOOPS THAT CAN GROW. A launcher caps how big a widget's
 * view tree may be, and six months is already ~190 cells. Columns are
 * `FlexWidget`s of seven, the flattest shape that still draws a calendar.
 */
import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';

import type { HeatWidgetData } from '../src/pure';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM' → 'Mar'. Falls back to the raw month rather than rendering junk. */
function shortMonth(month: string): string {
  const m = Number(month.slice(5, 7));
  return MONTH_NAMES[m - 1] ?? month;
}

const GAP = 3;
/** Everything that is not grid: the header line, the month labels, padding. */
const CHROME = 24 + 15 + 12 + 5;
/** Below this a week-column stops being readable and becomes noise. */
const MIN_CELL = 11;

/**
 * WHICH GRID, AND HOW BIG ITS SQUARES — measured from the tile, never assumed
 * from the placement.
 *
 * WIDTH CHOOSES THE PERIOD; HEIGHT ONLY SIZES IT. Dropping from six months to
 * three buys width — fewer columns, wider squares — and buys no height at all,
 * because a calendar is seven rows however long it is. So the floor is tested
 * against the WIDTH alone, and the height is then a cap on the square. Testing
 * it against both meant a short tile rejected every grid and fell through to
 * the fallback, showing one month where three would have fitted.
 *
 * Mirrors `layout(_:)` in OpenTVWidgets.swift — keep the two together.
 */
export function heatLayout(
  widthDp: number,
  heightDp: number,
  get: (months: number) => HeatWidgetData,
): { data: HeatWidgetData; cell: number } {
  const byHeight = (heightDp - CHROME - GAP * 6) / 7;
  let fallback: { data: HeatWidgetData; cell: number } | null = null;
  for (const months of [6, 3, 1]) {
    const data = get(months);
    const columns = data.cells.length / 7;
    if (columns <= 0) continue;
    const byWidth = (widthDp - 24 + GAP) / columns - GAP;
    const cell = Math.max(4, Math.floor(Math.min(byWidth, byHeight)));
    if (byWidth >= MIN_CELL) return { data, cell };
    // Nothing cleared the floor on a very narrow tile — one month drawn tight
    // beats nothing drawn at all.
    fallback = { data, cell };
  }
  return fallback ?? { data: get(1), cell: MIN_CELL };
}

export function HeatmapWidget({ data, cell }: { data: HeatWidgetData; cell: number }) {
  const columns: string[] = [];
  for (let i = 0; i < data.cells.length; i += 7) columns.push(data.cells.slice(i, i + 7));
  const labelAt = new Map(data.months.map((m) => [m.index, shortMonth(m.month)]));
  const radius = Math.max(2, Math.round(cell / 3.5));

  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        backgroundColor: '#121214',
        borderRadius: 16,
        padding: 12,
      }}
      clickAction="OPEN_URI"
      clickActionData={{ uri: 'ourtvtime://stats' }}>
      {/* ONE header line, not a header and a footer: two rows of small text
          around a grid left the grid the smallest thing on its own widget. */}
      <FlexWidget
        style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center', marginBottom: 5 }}>
        <TextWidget text="WATCHING" style={{ fontSize: 11, color: '#F5C518', letterSpacing: 1.2 }} />
        <FlexWidget style={{ flex: 1 }} />
        <TextWidget
          text={`${data.total} watched`}
          style={{ fontSize: 11, color: '#8A8A90' }}
        />
      </FlexWidget>

      {/* Month names, each over the column its month begins in. One row of
          fixed-width slots — a widget has no absolute layout to position with. */}
      <FlexWidget style={{ flexDirection: 'row', marginBottom: 3 }}>
        {columns.map((_, i) => (
          <FlexWidget key={`m${i}`} style={{ width: cell + GAP, flexDirection: 'column' }}>
            <TextWidget text={labelAt.get(i) ?? ''} style={{ fontSize: 9, color: '#8A8A90' }} />
          </FlexWidget>
        ))}
      </FlexWidget>

      <FlexWidget style={{ flexDirection: 'row' }}>
        {columns.map((col, i) => (
          <FlexWidget key={`c${i}`} style={{ flexDirection: 'column', marginRight: GAP }}>
            {col.split('').map((ch, d) => {
              const today = i * 7 + d === data.todayIndex;
              return (
                <FlexWidget
                  key={`d${d}`}
                  style={{
                    width: cell,
                    height: cell,
                    marginBottom: GAP,
                    borderRadius: radius,
                    // '.' is a day outside the months shown — a gap, not a
                    // square, so the grid starts on a 1st and ends on a 31st.
                    backgroundColor: ch === '.' ? '#00000000' : (data.shades[Number(ch)] ?? data.shades[0]),
                    // Today, ringed — the marker the profile draws, and the
                    // thing that tells you the grid is live.
                    ...(today ? { borderWidth: 1, borderColor: '#FFFFFF' as const } : {}),
                  }}
                />
              );
            })}
          </FlexWidget>
        ))}
      </FlexWidget>
    </FlexWidget>
  );
}
