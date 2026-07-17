/**
 * Pushes the current Up Next + Movies-to-Watch lists to the home-screen
 * widgets. Runs when the app goes to background — the exact moment the user is
 * about to see their home screen — and once on launch. Entirely on-device,
 * like everything else: the widgets read a JSON file this writes, no server.
 *
 * iOS: JSON + poster thumbnails go into the App Group container
 * (group.com.insightfy.opentv) where the WidgetKit extension reads them, then
 * the native module asks WidgetKit to re-render. Widgets can't fetch the
 * network reliably, so images must be local files.
 * Android: react-native-android-widget renders JSX in a headless task inside
 * the app process, where remote poster URLs load fine — JSON alone is enough.
 */
import { File, Paths, Directory } from 'expo-file-system';
import { Platform } from 'react-native';

import { upNextList, moviesToWatch, type UpNextItem, type WatchlistMovie } from '@/widget-data';

export const APP_GROUP = 'group.com.insightfy.opentv';

export type WidgetPayload = {
  updatedAt: string;
  upNext: (UpNextItem & { code: string; thumb: string | null })[];
  movies: (WatchlistMovie & { thumb: string | null })[];
};

function groupDir(): Directory | null {
  if (Platform.OS !== 'ios') return null;
  try {
    const d = Paths.appleSharedContainers[APP_GROUP];
    return d ?? null;
  } catch {
    return null;
  }
}

/** Download one image into the shared thumbs dir; null when it can't. */
async function thumb(dir: Directory, url: string | null, name: string): Promise<string | null> {
  if (!url) return null;
  try {
    const f = new File(dir, name);
    if (f.exists) f.delete();
    await File.downloadFileAsync(url, f);
    return name;
  } catch {
    return null; // offline or a dead URL — the widget shows text instead
  }
}

export async function syncWidgets(): Promise<void> {
  try {
    const upNext = upNextList(8);
    const movies = moviesToWatch(9);

    const payload: WidgetPayload = {
      updatedAt: new Date().toISOString(),
      upNext: upNext.map((e) => ({
        ...e,
        code: `S${String(e.season).padStart(2, '0')} | E${String(e.episode).padStart(2, '0')}`,
        thumb: null,
      })),
      movies: movies.map((m) => ({ ...m, thumb: null })),
    };

    if (Platform.OS === 'ios') {
      const group = groupDir();
      if (!group) return; // entitlement missing in this build — nothing to do
      const thumbs = new Directory(group, 'widget-thumbs');
      try {
        if (!thumbs.exists) thumbs.create();
      } catch {}
      // small, bounded downloads (≤17 posters); failures degrade gracefully
      for (let i = 0; i < payload.upNext.length; i++) {
        payload.upNext[i].thumb = await thumb(thumbs, payload.upNext[i].image, `up-${payload.upNext[i].showId}.jpg`);
      }
      for (let i = 0; i < payload.movies.length; i++) {
        payload.movies[i].thumb = await thumb(thumbs, payload.movies[i].poster, `mv-${i}.jpg`);
      }
      new File(group, 'widget-data.json').write(JSON.stringify(payload));
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const WidgetRefresh = (require('../modules/widget-refresh') as typeof import('../modules/widget-refresh')).default;
        WidgetRefresh?.reloadAll();
      } catch {
        // widget extension not in this build — data is staged for when it is
      }
    } else {
      // Android: hand the payload to the widget task handler via its renderer
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { requestWidgetUpdate } = require('react-native-android-widget') as typeof import('react-native-android-widget');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { UpNextWidget } = require('../widgets/UpNextWidget') as typeof import('../widgets/UpNextWidget');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { MoviesWidget } = require('../widgets/MoviesWidget') as typeof import('../widgets/MoviesWidget');
        void requestWidgetUpdate({
          widgetName: 'UpNext',
          renderWidget: (info) => {
            const tall = info.height >= 220;
            return UpNextWidget({ items: payload.upNext, tall, movies: tall ? payload.movies : [] });
          },
          widgetNotFound: () => {},
        });
        void requestWidgetUpdate({
          widgetName: 'Movies',
          renderWidget: () => MoviesWidget({ movies: payload.movies }),
          widgetNotFound: () => {},
        });
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { CombinedWidget } = require('../widgets/CombinedWidget') as typeof import('../widgets/CombinedWidget');
        void requestWidgetUpdate({
          widgetName: 'UpNextMovies',
          renderWidget: () => CombinedWidget({ items: payload.upNext, movies: payload.movies }),
          widgetNotFound: () => {},
        });
      } catch {
        // widget lib absent in this build — nothing to update
      }
    }
  } catch {
    // widget refresh must never break the app
  }
}
