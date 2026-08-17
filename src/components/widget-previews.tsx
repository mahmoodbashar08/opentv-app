/**
 * Live previews for the sections the Profile screen owns.
 *
 * WHY THIS FILE EXISTS. `renderWidget` draws the widgets, and the Add sheet can
 * simply call it. The page's own sections — the heatmap, Stats, Lists, the
 * shelves — are built inside `(tabs)/profile.tsx` and handed to the template as
 * slots, because there they carry that screen's navigation: tapping a poster
 * opens the show, tapping Lists opens the Lists screen. Nothing outside that
 * screen can produce one.
 *
 * A preview needs none of that. It needs the same COMPONENTS with the same DATA
 * and no behaviour at all — nothing here is tappable, because a preview that
 * navigates is a preview somebody falls out of. So this reads the database
 * directly and renders the real components, which is why it cannot drift into
 * showing something the profile would not: the drawing is shared, only the
 * wiring is absent.
 */

import type { ReactNode } from 'react';
import { useState } from 'react';
import { View } from 'react-native';

import { Poster } from '@/components/poster';
import { StatsRail, type RailItem } from '@/components/profile-sections';
import { getCustomLists, getFavoriteMovies, getFavoriteShows, getMovies, getShowProgress, getTotals } from '@/db';
import { currentLocale, t } from '@/i18n';
import { isSeedLibrary } from '@/library';
import seed from '@/seed';
import { formatCount } from '@/locale-resolve';
import { SHELF_PREFIX, type WidgetSpan } from '@/profile-layout';
import { Heatmap, monthOf } from '@/components/heatmap';
import { clockOf, computeMovieStats, watchDayCounts } from '@/stats-calc';
import { colors, space } from '@/theme';

const todayISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The window each size covers — the same rule the profile applies. */
/** The gap the poster rails use, so a preview lines up with the real thing. */
const GAP = 10;

const monthsFor = (span: WidgetSpan): number => (span === '1x1' ? 1 : span === '2x1' ? 3 : 6);

function HeatmapPreview({ span, width }: { span: WidgetSpan; width: number }) {
  const today = todayISO();
  // Its own end month, so paging inside a preview cannot move the profile.
  const [end, setEnd] = useState(monthOf(today));
  return (
    <Heatmap
      counts={watchDayCounts()}
      accent={colors.yellow}
      months={monthsFor(span)}
      endMonth={end}
      onEndMonth={setEnd}
      today={today}
      maxMonth={monthOf(today)}
      width={width}
    />
  );
}

function StatsPreview({ width }: { width: number }) {
  const totals = getTotals();
  const movie = computeMovieStats();
  const tv = clockOf(totals.minutes);
  /*
   * THE RAIL, because the rail is what the profile draws. A grid of four small
   * cards was briefly shown here and it answered the wrong question: the
   * preview's promise is "this is what lands on your page", and what lands is
   * the two wide cards with the rest behind a scroll.
   */
  return (
    /*
     * WRAPPED, SO THE CENTRING CAN REACH IT. The preview card centres its body
     * — which is why the Shows posters sit in the middle — but a ScrollView is
     * stretched by its parent rather than measured, so the rail filled the card
     * top to bottom and its content clung to the top. A plain View around it is
     * something the centring can hold.
     */
    <View>
    <StatsRail
      contentWidth={width}
      cards={[
        { key: 'tv', title: t('profile.tvTimeCard'), kind: 'clock', ...tv },
        {
          key: 'eps',
          title: t('profile.episodesWatchedCard'),
          kind: 'number',
          value: formatCount(totals.episodes, currentLocale()),
        },
        { key: 'mv', title: t('profile.movieTimeCard'), kind: 'clock', ...movie.clock },
        { key: 'mvn', title: t('profile.moviesWatchedCard'), kind: 'number', value: String(movie.watched) },
      ]}
    />
    </View>
  );
}

/** The posters a given shelf would hold, in the order the profile shows them. */
function shelfItems(key: string): RailItem[] {
  // The profile falls back to the bundled seed until an import arrives; a
  // preview that does not is blank on exactly the phones the profile is not.
  if (isSeedLibrary()) {
    if (key === 'shows') return seed.shows.map((x) => ({ key: x.name, name: x.name, uri: x.posterUrl }));
    if (key === 'movies') return seed.movies.map((x) => ({ key: x.name, name: x.name, uri: x.poster ?? null }));
  }
  if (key === 'shows') {
    return getShowProgress()
      .slice(0, 12)
      .map((sp) => ({ key: String(sp.tvdbId), name: sp.name, uri: sp.posterUrl }));
  }
  if (key === 'fav-shows') {
    return getFavoriteShows()
      .slice(0, 12)
      .map((f) => ({ key: String(f.tvdbId), name: f.name, uri: f.posterUrl }));
  }
  if (key === 'movies') {
    return getMovies()
      .filter((m) => m.watchedAt != null)
      .slice(0, 12)
      .map((m) => ({ key: m.name, name: m.name, uri: m.poster }));
  }
  if (key === 'fav-movies') {
    return getFavoriteMovies()
      .slice(0, 12)
      .map((m) => ({ key: m.name, name: m.name, uri: m.poster }));
  }
  return [];
}

/**
 * The first list's posters, drawn as the profile's collage draws them.
 *
 * THE SAME SOURCE AS THE PROFILE, seed included. The profile shows the bundled
 * seed lists until an import brings real ones, so a preview that read only
 * `getCustomLists()` was blank on exactly the phones the profile was not.
 */
function listItems(): { name: string; poster: string | null }[] {
  const lists = isSeedLibrary() ? seed.lists : getCustomLists();
  const first = lists[0];
  return ((first?.items ?? []) as { name: string; poster: string | null }[]).slice(0, 4);
}

/**
 * A preview for one of the profile's own sections, or null when there is no
 * sensible one — the banner and bio are somebody's identity rather than a
 * component, and Followers is a number this screen cannot know offline.
 */
export function previewSlot(id: string, span: WidgetSpan, width: number): ReactNode {
  if (id === 'activity') return <HeatmapPreview span={span} width={width} />;
  if (id === 'stats') return <StatsPreview width={width} />;
  if (id === 'lists') {
    /*
     * DATA FIRST, ELEMENT SECOND. This used to return a <ListsPreview/> whose
     * body might render null — but the ELEMENT is truthy either way, so the
     * caller's `?? outline` fallback never fired and an empty library got a
     * blank sheet instead of the named outline. Whether there is anything to
     * show has to be decided out here, before a component exists to be truthy.
     */
    const items = listItems();
    if (items.length === 0) return null;
    const cell = (width - 3 * 2) / 4;
    return (
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {items.map((it, i) => (
          <View key={`${it.name}-${i}`} style={{ width: cell, height: cell / 0.78 }}>
            <Poster name={it.name} uri={it.poster} aspect={0.78} />
          </View>
        ))}
      </View>
    );
  }
  if (id.startsWith(SHELF_PREFIX)) {
    const items = shelfItems(id.slice(SHELF_PREFIX.length));
    if (items.length === 0) return null;
    /*
     * A PLAIN ROW, NOT THE REAL RAIL.
     *
     * `PosterRail` is a FlatList, and a FlatList inside the preview's horizontal
     * pager is a virtualised list nested in a ScrollView of the same
     * orientation — React Native says so out loud, and it is right: the two
     * fight over the same gesture and the inner one can never measure itself.
     * A preview does not scroll anyway, so it shows the first few posters at
     * the rail's own size and stops.
     */
    const w = Math.floor((width - GAP * 3) / 3.5);
    // HEIGHT SPELLED OUT. A Poster is `flex: 1` inside its cell, which works on
    // the profile because the rail's cells have a measured height — here the
    // parent is content-sized, `flex: 1` means basis 0, and the posters
    // collapsed to nothing. Same disease as the widget previews, same cure.
    const h = Math.round(w * 1.5);
    return (
      <View style={{ flexDirection: 'row', gap: GAP, overflow: 'hidden' }}>
        {items.slice(0, 4).map((it) => (
          <View key={it.key} style={{ width: w, height: h }}>
            <Poster name={it.name} uri={it.uri} />
          </View>
        ))}
      </View>
    );
  }
  return null;
}
