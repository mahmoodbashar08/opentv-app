/**
 * Android widget lifecycle handler — runs headless (no UI) when the launcher
 * needs a render: widget first added, resized, or periodic update. Reads the
 * library from SQLite directly, same as the app.
 */
import React from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { CombinedWidget } from './CombinedWidget';
import { MoviesWidget } from './MoviesWidget';
import { UpNextWidget } from './UpNextWidget';

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const { widgetInfo, renderWidget } = props;
  // computed lazily so the module load stays cheap for the app itself
  const { upNextList, moviesToWatch } = await import('../src/widget-data');

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      if (widgetInfo.widgetName === 'UpNext') {
        const items = upNextList(8).map((e) => ({
          ...e,
          code: `S${String(e.season).padStart(2, '0')} | E${String(e.episode).padStart(2, '0')}`,
          thumb: null,
        }));
        // a tall placement gets the movie watchlist under the episodes
        const tall = widgetInfo.height >= 220;
        renderWidget(
          <UpNextWidget items={items} tall={tall} movies={tall ? moviesToWatch(9).map((m) => ({ ...m, thumb: null })) : []} />,
        );
      } else if (widgetInfo.widgetName === 'Movies') {
        renderWidget(<MoviesWidget movies={moviesToWatch(9).map((m) => ({ ...m, thumb: null }))} />);
      } else if (widgetInfo.widgetName === 'UpNextMovies') {
        const items = upNextList(4).map((e) => ({
          ...e,
          code: `S${String(e.season).padStart(2, '0')} | E${String(e.episode).padStart(2, '0')}`,
          thumb: null,
        }));
        renderWidget(<CombinedWidget items={items} movies={moviesToWatch(4).map((m) => ({ ...m, thumb: null }))} />);
      }
      break;
    }
    default:
      break;
  }
}
