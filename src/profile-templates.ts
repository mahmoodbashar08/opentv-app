/**
 * PROFILE TEMPLATES (8 Oct) — one tap puts a whole look on the profile: a
 * banner, the theme's two colours (and with them the page's gradient), the
 * layout, and an arrangement of blocks. Everything a template sets is a
 * setting the person could have chosen by hand, and every one of them stays
 * editable afterwards.
 *
 * THE BANNERS ARE OUR OWN ARTWORK, drawn for this (`assets/templates/*.jpg`):
 * no show's backdrop, so nothing here is anybody else's picture.
 *
 * Plus, because every part of it is: the theme, the layouts beyond classic and
 * the arrangement are all Plus already, and the server enforces the first two.
 */
import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';

import { appearanceChanged } from '@/community-appearance';
import {
  pushProfileLayout,
  pushProfileTheme,
  pushWidgets,
} from '@/community-profiles';
import type { ProfileLayout } from '@/components/profile-template';
import { widgetValue } from '@/components/profile-widgets';
import { profileThemeChanged } from '@/cover-frame-live';
import { getMeta, getProfileLayout, setMeta, setProfileLayout, templateTitles } from '@/db';
import {
  notifyLayoutSaved,
  publishableWidgets,
  serialise,
  SHELF_PREFIX,
  specOf,
  type Placed,
  type WidgetSpan,
} from '@/profile-layout';
import { CENTRE_FRAME, coverFrameString } from '@/pure';
import { setThemeAccentHex } from '@/theme';
import { paletteFromImage } from '@/theme-from-art';
import { tmdb } from '@/tmdb';
import { tvdbArtworks, TVDB_ART_BACKGROUND } from '@/tvdb';

/** A block: an id at its default size, `id:span` for another size, or a pair of squares. */
type Block = string | readonly [string, string];
/** Where the profile's shelves (shows, favourites, films) go. */
const SHELVES = 'SHELVES';

export type Template = {
  id: string;
  /** A bundled picture, or an artwork URL for a template made from a title. */
  banner: number | string;
  /** The show or film it was made from — what Appearance says it is themed on. */
  title?: string;
  primary: string;
  secondary: string;
  layout: ProfileLayout;
  blocks: readonly Block[];
};

export const TEMPLATES: readonly Template[] = [
  {
    id: 'midnight',
    banner: require('@/assets/templates/midnight.jpg'),
    primary: '#8B5CF6',
    secondary: '#22D3EE',
    layout: 'cards',
    blocks: [
      'banners',
      'intro',
      'counts',
      'nowWatching:2x2',
      ['streak', 'thisYear'],
      'stats',
      SHELVES,
      'activity:2x2',
      'lists',
      'extra',
    ],
  },
  {
    id: 'sunset',
    banner: require('@/assets/templates/sunset.jpg'),
    primary: '#F97316',
    secondary: '#EC4899',
    layout: 'poster',
    blocks: [
      'banners',
      'intro',
      'counts',
      'topRated:2x2',
      SHELVES,
      ['since', 'finished'],
      'stats',
      'lists',
      'extra',
    ],
  },
  {
    id: 'neon',
    banner: require('@/assets/templates/neon.jpg'),
    primary: '#D946EF',
    secondary: '#22D3EE',
    layout: 'cards',
    blocks: [
      'banners',
      'intro',
      'counts',
      ['streak', 'binge'],
      'emotions:2x1',
      'stats',
      'activity:2x2',
      SHELVES,
      'lists',
      'extra',
    ],
  },
  {
    id: 'forest',
    banner: require('@/assets/templates/forest.jpg'),
    primary: '#22C55E',
    secondary: '#A3E635',
    layout: 'classic',
    blocks: [
      'banners',
      'intro',
      'counts',
      ['genre', 'thisYear'],
      'stats',
      SHELVES,
      'lists',
      'extra',
    ],
  },
  {
    id: 'ocean',
    banner: require('@/assets/templates/ocean.jpg'),
    primary: '#06B6D4',
    secondary: '#3B82F6',
    layout: 'cards',
    blocks: [
      'banners',
      'intro',
      'counts',
      'timeline',
      SHELVES,
      ['genre', 'character'],
      'stats',
      'lists',
      'extra',
    ],
  },
  {
    id: 'cinema',
    banner: require('@/assets/templates/cinema.jpg'),
    primary: '#E11D48',
    secondary: '#F59E0B',
    layout: 'poster',
    blocks: [
      'banners',
      'intro',
      'counts',
      'topRated:2x2',
      ['rated', 'finished'],
      SHELVES,
      'stats',
      'lists',
      'extra',
    ],
  },
  {
    id: 'noir',
    banner: require('@/assets/templates/noir.jpg'),
    primary: '#A1A1AA',
    secondary: '#E4E4E7',
    layout: 'classic',
    blocks: ['banners', 'intro', 'counts', SHELVES, 'stats', 'extra'],
  },
  {
    id: 'gold',
    banner: require('@/assets/templates/gold.jpg'),
    primary: '#EAB308',
    secondary: '#F59E0B',
    layout: 'poster',
    blocks: [
      'banners',
      'intro',
      'counts',
      ['since', 'thisYear'],
      'topRated:2x1',
      'stats',
      SHELVES,
      'lists',
      'extra',
    ],
  },
  {
    id: 'pastel',
    banner: require('@/assets/templates/pastel.jpg'),
    primary: '#C084FC',
    secondary: '#FDA4AF',
    layout: 'cards',
    blocks: [
      'banners',
      'intro',
      'counts',
      'emotions:2x1',
      'emotionCalendar:2x2',
      SHELVES,
      'lists',
      'extra',
    ],
  },
  {
    id: 'retro',
    banner: require('@/assets/templates/retro.jpg'),
    primary: '#F59E0B',
    secondary: '#B45309',
    layout: 'classic',
    blocks: [
      'banners',
      'intro',
      'counts',
      ['streak', 'binge'],
      'activity:2x1',
      SHELVES,
      'stats',
      'lists',
      'extra',
    ],
  },
];

/** The same four the profile tab draws (see `(tabs)/profile.tsx`). */
const SHELF_KEYS = ['shows', 'fav-shows', 'movies', 'fav-movies'];

/** The template's blocks as an arrangement, in order, each at its size. */
export function templateItems(tpl: Template): Placed[] {
  // `id:span` — never applied to a shelf, whose own id has a colon in it.
  const one = (ref: string): Placed => {
    const [id, span] = ref.split(':') as [string, WidgetSpan | undefined];
    return { uid: id, id, span: span ?? specOf(id).span };
  };
  return tpl.blocks.flatMap((b): Placed[] =>
    b === SHELVES
      ? SHELF_KEYS.map((k) => ({
          uid: SHELF_PREFIX + k,
          id: SHELF_PREFIX + k,
          span: specOf(SHELF_PREFIX + k).span,
        }))
      : typeof b === 'string'
        ? [one(b)]
        : b.map(one),
  );
}

/**
 * Put the template on the profile. THE SERVER FIRST for the two it checks —
 * colour and layout — so a refused one changes nothing on the phone; then the
 * banner, the frame and the blocks. Throws what the server threw.
 */
export async function applyTemplate(tpl: Template): Promise<void> {
  await pushProfileTheme(tpl.primary);
  await pushProfileLayout(tpl.layout === 'classic' ? null : tpl.layout);

  setMeta('profileThemeColor', tpl.primary);
  setMeta('profileThemeSecondary', tpl.secondary);
  setMeta('profileThemeName', tpl.title ?? '');
  setMeta('profileThemeLayout', tpl.layout);

  // The banner: copied into Documents like every banner, so it publishes
  // through the same upload path a photo from the library uses.
  const name = `profile-cover-${Date.now()}.jpg`;
  const dest = new File(Paths.document, name);
  if (typeof tpl.banner === 'string') {
    const res = await fetch(tpl.banner);
    if (!res.ok) throw new Error('download failed');
    dest.write(new Uint8Array(await res.arrayBuffer()));
  } else {
    const asset = await Asset.fromModule(tpl.banner).downloadAsync();
    new File(asset.localUri ?? asset.uri).copy(dest);
  }
  const old = getMeta('coverFile');
  if (old) {
    try {
      const f = new File(Paths.document, old);
      if (f.exists) f.delete();
    } catch {}
  }
  setMeta('coverFile', name);
  setMeta('coverUrl', typeof tpl.banner === 'string' ? tpl.banner : '');
  setMeta('coverStillFile', '');
  // The banner melts into the page's gradient instead of ending on a line.
  setMeta(
    'coverFrame',
    coverFrameString({ ...CENTRE_FRAME, fade: true, strength: 0.8 }),
  );

  const items = templateItems(tpl);
  setProfileLayout(serialise(items, getProfileLayout()));
  notifyLayoutSaved();
  await pushWidgets(JSON.stringify(publishableWidgets(items, (id, span, data) => widgetValue(id, span, data)))).catch(() => {});

  profileThemeChanged();
  appearanceChanged();
  /*
   * LAST, ALWAYS. A new accent restarts the app to repaint it (1.2s later, see
   * `saveAndRepaint`) — set first, the restart landed while the banner was
   * still being copied, so the banner never arrived and the app came back on
   * this screen (8 Oct).
   */
  setThemeAccentHex(tpl.primary);
}

type Title = ReturnType<typeof templateTitles>[number];

/** The title's best wide artwork: TheTVDB's for a show, then TMDB's most voted. */
async function backdropFor(title: Title): Promise<string | null> {
  try {
    if (title.kind === 'show' && title.tvdbId != null) {
      const art = await tvdbArtworks(title.tvdbId, 'series', TVDB_ART_BACKGROUND, 1);
      if (art[0]) return art[0];
    }
  } catch {}
  try {
    let id = title.tmdbId;
    if (title.kind === 'show' && title.tvdbId != null) {
      const found = await tmdb<{ tv_results: { id: number }[] }>(`/find/${title.tvdbId}?external_source=tvdb_id`);
      id = found.tv_results?.[0]?.id ?? null;
    }
    if (id == null) return null;
    const res = await tmdb<{ backdrops: { file_path: string; vote_count?: number }[] }>(
      `/${title.kind === 'show' ? 'tv' : 'movie'}/${id}/images`,
    );
    const best = [...(res.backdrops ?? [])].sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))[0];
    return best ? `https://image.tmdb.org/t/p/w1280${best.file_path}` : null;
  } catch {
    return null;
  }
}

/**
 * TEMPLATES FROM YOUR OWN SHOWS AND FILMS: each title's artwork as the banner,
 * its colours as the theme, and the layout and blocks of one of the ten made
 * templates in turn. A title with no artwork is left out.
 */
export async function titleTemplates(): Promise<Template[]> {
  const titles = templateTitles();
  const made = await Promise.all(
    titles.map(async (title, i): Promise<Template | null> => {
      const banner = await backdropFor(title);
      if (!banner) return null;
      const base = TEMPLATES[i % TEMPLATES.length]!;
      const { accent, secondary } = await paletteFromImage(banner);
      return {
        id: `title-${i}`,
        banner,
        title: title.name,
        primary: accent ?? base.primary,
        secondary: secondary ?? accent ?? base.secondary,
        layout: base.layout,
        blocks: base.blocks,
      };
    }),
  );
  return made.filter((x): x is Template => x != null);
}
