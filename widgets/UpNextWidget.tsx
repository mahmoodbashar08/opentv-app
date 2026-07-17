/**
 * "Up Next" home-screen widget (Android) — the next unwatched AIRED episode of
 * each followed show, most recently watched show first. Tapping a row deep
 * links straight to that episode.
 */
import React from 'react';
import { FlexWidget, ImageWidget, TextWidget } from 'react-native-android-widget';

import type { WidgetPayload } from '../src/widget-sync';

type Props = { items: WidgetPayload['upNext'] };

export function UpNextWidget({ items }: Props) {
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
        items.slice(0, 4).map((e) => (
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
    </FlexWidget>
  );
}
