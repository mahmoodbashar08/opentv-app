'use no memo'; // react-native-android-widget needs raw functions — the React Compiler's memo transform breaks its tree builder
/**
 * "Movies to Watch" home-screen widget (Android) — the watchlist as a poster
 * row. Tapping a poster opens that movie in the app.
 */
import React from 'react';
import { FlexWidget, ImageWidget, TextWidget } from 'react-native-android-widget';

import type { WidgetPayload } from '../src/widget-sync';

type Props = { movies: WidgetPayload['movies'] };

export function MoviesWidget({ movies }: Props) {
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
      clickAction="OPEN_APP">
      <TextWidget
        text="MOVIES TO WATCH"
        style={{ fontSize: 12, color: '#F5C518', letterSpacing: 1.2, marginBottom: 8 }}
      />
      {movies.length === 0 ? (
        <TextWidget text="Watchlist is empty" style={{ fontSize: 14, color: '#EDEDED', marginTop: 8 }} />
      ) : (
        <FlexWidget style={{ flexDirection: 'row', width: 'match_parent' }}>
          {movies.slice(0, 5).map((m) => (
            <FlexWidget
              key={m.name}
              style={{ flexDirection: 'column', marginRight: 8 }}
              clickAction="OPEN_URI"
              clickActionData={{ uri: `ourtvtime://movie/${encodeURIComponent(m.name)}` }}>
              {m.poster?.startsWith('https:') ? (
                <ImageWidget image={m.poster as `https:${string}`} imageWidth={56} imageHeight={84} radius={8} />
              ) : (
                <FlexWidget style={{ width: 56, height: 84, backgroundColor: '#2A2A2E', borderRadius: 8 }} />
              )}
            </FlexWidget>
          ))}
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
