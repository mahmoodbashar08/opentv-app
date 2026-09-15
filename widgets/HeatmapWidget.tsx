'use no memo'; // react-native-android-widget needs raw functions — the React Compiler's memo transform breaks its tree builder
/**
 * "Watching" home-screen widget (Android) — the profile's activity grid, one
 * square per day, shaded by how much was watched.
 *
 * IT DECIDES NOTHING. Every square arrives already shaded as '0'–'4' and the
 * five colours arrive with it, from `heatWidgetData`. This file is a nested
 * loop over a string, which is the whole point: the grid arithmetic and the
 * colour ramp live in `pure.ts` next to their tests, not here and again in
 * Swift, drifting apart from the profile a month later.
 *
 * NO LIST WIDGETS, NO LOOPS THAT CAN GROW. A launcher hands a widget a hard
 * limit on how big its view tree may be, and a six-month grid is already ~190
 * cells. Columns are `FlexWidget`s of seven, which is the flattest shape that
 * still draws a calendar.
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

export function HeatmapWidget({ data, cell = 11 }: { data: HeatWidgetData; cell?: number }) {
  const gap = 2;
  const columns: string[] = [];
  for (let i = 0; i < data.cells.length; i += 7) columns.push(data.cells.slice(i, i + 7));

  // Which column each month starts at, so a label can sit above it.
  const labelAt = new Map(data.months.map((m) => [m.index, shortMonth(m.month)]));

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
      {/* The month names, each sitting over the column its month begins in.
          Drawn as one row of fixed-width slots rather than positioned text:
          a widget has no absolute layout to position them with. */}
      <FlexWidget style={{ flexDirection: 'row', marginBottom: 4 }}>
        {columns.map((_, i) => (
          <FlexWidget key={`m${i}`} style={{ width: cell + gap, flexDirection: 'column' }}>
            <TextWidget
              text={labelAt.get(i) ?? ''}
              style={{ fontSize: 9, color: '#8A8A90' }}
            />
          </FlexWidget>
        ))}
      </FlexWidget>

      <FlexWidget style={{ flexDirection: 'row' }}>
        {columns.map((col, i) => (
          <FlexWidget key={`c${i}`} style={{ flexDirection: 'column', marginRight: gap }}>
            {col.split('').map((ch, d) => (
              <FlexWidget
                key={`d${d}`}
                style={{
                  width: cell,
                  height: cell,
                  marginBottom: gap,
                  borderRadius: 3,
                  // '.' is a day outside the months shown — a gap, not a square,
                  // so the grid starts on a 1st and ends on a 31st.
                  backgroundColor: ch === '.' ? '#00000000' : (data.shades[Number(ch)] ?? data.shades[0]),
                }}
              />
            ))}
          </FlexWidget>
        ))}
      </FlexWidget>

      <TextWidget
        text={data.total === 1 ? '1 watched in this period' : `${data.total} watched in this period`}
        style={{ fontSize: 11, color: '#8A8A90', marginTop: 6 }}
      />
    </FlexWidget>
  );
}
