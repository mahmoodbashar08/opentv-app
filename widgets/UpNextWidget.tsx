/**
 * "Up Next" home-screen widget (Android) — the next unwatched AIRED episode of
 * each followed show, most recently watched show first. Tapping a row deep
 * links straight to that episode.
 */
import React from 'react';
import { FlexWidget, ImageWidget, TextWidget } from 'react-native-android-widget';

import type { WidgetPayload } from '../src/widget-sync';

type Props = {
  items: WidgetPayload['upNext'];
  /** watchlist shown under the episodes when the widget is tall enough */
  movies?: WidgetPayload['movies'];
  tall?: boolean;
};

export function UpNextWidget({ items, movies = [], tall = false }: Props) {
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
        text="UP NEXT"
        style={{ fontSize: 12, color: '#F5C518', letterSpacing: 1.2, marginBottom: 6 }}
      />
      {items.length === 0 ? (
        <TextWidget text="All caught up 🎉" style={{ fontSize: 14, color: '#EDEDED', marginTop: 8 }} />
      ) : (
        items.slice(0, tall ? 4 : 3).map((e) => (
          <FlexWidget
            key={`${e.showId}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              width: 'match_parent',
              marginTop: 7,
            }}
            clickAction="OPEN_URI"
            clickActionData={{ uri: `ourtvtime://episode/${e.showId}-s${e.season}e${e.episode}` }}>
            {e.image?.startsWith('https:') ? (
              <ImageWidget image={e.image as `https:${string}`} imageWidth={52} imageHeight={34} radius={6} />
            ) : (
              <FlexWidget style={{ width: 52, height: 34, backgroundColor: '#2A2A2E', borderRadius: 6 }} />
            )}
            <FlexWidget style={{ flexDirection: 'column', marginLeft: 10, flex: 1 }}>
              <TextWidget
                text={`${e.code}  ·  ${e.showName}`}
                truncate="END"
                maxLines={1}
                style={{ fontSize: 13, color: '#FFFFFF' }}
              />
              <TextWidget
                text={e.title ?? `Episode ${e.episode}`}
                truncate="END"
                maxLines={1}
                style={{ fontSize: 12, color: '#9A9AA0' }}
              />
            </FlexWidget>
          </FlexWidget>
        ))
      )}
      {tall && movies.length > 0 ? (
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent', marginTop: 10 }}>
          <TextWidget
            text="MOVIES TO WATCH"
            style={{ fontSize: 12, color: '#F5C518', letterSpacing: 1.2, marginBottom: 6 }}
          />
          <FlexWidget style={{ flexDirection: 'row', width: 'match_parent' }}>
            {movies.slice(0, 5).map((m) => (
              <FlexWidget
                key={m.name}
                style={{ flexDirection: 'column', marginRight: 8 }}
                clickAction="OPEN_URI"
                clickActionData={{ uri: `ourtvtime://movie/${encodeURIComponent(m.name)}` }}>
                {m.poster?.startsWith('https:') ? (
                  <ImageWidget image={m.poster as `https:${string}`} imageWidth={46} imageHeight={69} radius={7} />
                ) : (
                  <FlexWidget style={{ width: 46, height: 69, backgroundColor: '#2A2A2E', borderRadius: 7 }} />
                )}
              </FlexWidget>
            ))}
          </FlexWidget>
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}
