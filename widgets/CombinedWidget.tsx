'use no memo'; // react-native-android-widget needs raw functions — the React Compiler's memo transform breaks its tree builder
/**
 * "Up Next + Movies" (Android, medium) — next episodes on the left, movie
 * watchlist posters on the right. The both-at-a-glance widget.
 */
import React from 'react';
import { FlexWidget, ImageWidget, TextWidget } from 'react-native-android-widget';

import type { WidgetPayload } from '../src/widget-sync';

type Props = { items: WidgetPayload['upNext']; movies: WidgetPayload['movies'] };

export function CombinedWidget({ items, movies }: Props) {
  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'row',
        backgroundColor: '#121214',
        borderRadius: 16,
        padding: 12,
      }}
      clickAction="OPEN_APP">
      <FlexWidget style={{ flexDirection: 'column', flex: 1 }}>
        <TextWidget text="UP NEXT" style={{ fontSize: 12, color: '#F5C518', letterSpacing: 1.2, marginBottom: 6 }} />
        {items.length === 0 ? (
          <TextWidget text="All caught up 🎉" style={{ fontSize: 13, color: '#EDEDED' }} />
        ) : (
          items.slice(0, 2).map((e) => (
            <FlexWidget
              key={`${e.showId}`}
              style={{ flexDirection: 'column', marginBottom: 7 }}
              clickAction="OPEN_URI"
              clickActionData={{ uri: `ourtvtime://episode/${e.showId}-s${e.season}e${e.episode}` }}>
              <TextWidget text={e.showName} truncate="END" maxLines={1} style={{ fontSize: 13, color: '#FFFFFF' }} />
              <TextWidget text={e.code} style={{ fontSize: 11, color: '#9A9AA0' }} />
            </FlexWidget>
          ))
        )}
      </FlexWidget>
      <FlexWidget style={{ flexDirection: 'column', marginLeft: 10 }}>
        <TextWidget text="MOVIES" style={{ fontSize: 12, color: '#F5C518', letterSpacing: 1.2, marginBottom: 6 }} />
        <FlexWidget style={{ flexDirection: 'row' }}>
          {movies.slice(0, 2).map((m) => (
            <FlexWidget
              key={m.name}
              style={{ flexDirection: 'column', marginRight: 6 }}
              clickAction="OPEN_URI"
              clickActionData={{ uri: `ourtvtime://movie/${encodeURIComponent(m.name)}` }}>
              {m.poster?.startsWith('https:') ? (
                <ImageWidget image={m.poster as `https:${string}`} imageWidth={48} imageHeight={72} radius={7} />
              ) : (
                <FlexWidget style={{ width: 48, height: 72, backgroundColor: '#2A2A2E', borderRadius: 7 }} />
              )}
            </FlexWidget>
          ))}
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}
