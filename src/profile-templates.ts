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
  /** A small copy of a URL banner, for the preview card. */
  thumb?: string;
  primary: string;
  secondary: string;
  layout: ProfileLayout;
  /** Who the profile says you are — what its first blocks lead with. */
  persona: Persona;
  blocks: readonly Block[];
};

/*
 * PERSONAS, NOT PILES OF WIDGETS (8 Oct, from research into Letterboxd,
 * Trakt, Serializd, Steam showcases and Wrapped). What makes a profile read
 * as somebody: taste first (favourites), one hero block, then smaller ones in
 * pairs, numbers lower down, and nothing that can be empty on a public page.
 * Each template leads with the thing its kind of viewer would show off; the
 * squares are the ones nearly every library can fill, so a pair never
 * collapses to a hole.
 */
export type Persona =
  | 'binger'
  | 'filmBuff'
  | 'explorer'
  | 'nostalgic'
  | 'completionist'
  | 'critic'
  | 'curator'
  | 'devotee'
  | 'feeler'
  | 'newcomer';

export const TEMPLATES: readonly Template[] = [
  {
    id: 'midnight',
    banner: require('@/assets/templates/midnight.jpg'),
    primary: '#8B5CF6',
    secondary: '#22D3EE',
    layout: 'cards',
    persona: 'binger',
    blocks: ['banners', 'intro', 'counts', 'nowWatching:2x2', ['binge', 'streak'], 'stats', 'activity:2x1', ['thisYear', 'finished'], 'shelf:shows', 'shelf:fav-shows', 'shelf:movies', 'shelf:fav-movies', 'lists', 'extra'],
  },
  {
    id: 'sunset',
    banner: require('@/assets/templates/sunset.jpg'),
    primary: '#F97316',
    secondary: '#EC4899',
    layout: 'poster',
    persona: 'filmBuff',
    blocks: ['banners', 'intro', 'counts', 'shelf:fav-movies', ['thisYear', 'rated'], 'topRated:2x1', 'shelf:movies', 'stats', 'shelf:fav-shows', 'shelf:shows', 'lists', 'extra'],
  },
  {
    id: 'neon',
    banner: require('@/assets/templates/neon.jpg'),
    primary: '#D946EF',
    secondary: '#22D3EE',
    layout: 'cards',
    persona: 'explorer',
    blocks: ['banners', 'intro', 'counts', 'genre:2x1', 'shelf:fav-shows', ['thisYear', 'since'], 'timeline', 'shelf:shows', 'stats', 'shelf:fav-movies', 'shelf:movies', 'lists', 'extra'],
  },
  {
    id: 'forest',
    banner: require('@/assets/templates/forest.jpg'),
    primary: '#22C55E',
    secondary: '#A3E635',
    layout: 'classic',
    persona: 'nostalgic',
    blocks: ['banners', 'intro', 'counts', 'timeline', ['since', 'finished'], 'shelf:fav-shows', 'activity:2x1', 'shelf:fav-movies', 'stats', 'shelf:shows', 'shelf:movies', 'lists', 'extra'],
  },
  {
    id: 'ocean',
    banner: require('@/assets/templates/ocean.jpg'),
    primary: '#06B6D4',
    secondary: '#3B82F6',
    layout: 'cards',
    persona: 'completionist',
    blocks: ['banners', 'intro', 'counts', 'stats', ['finished', 'since'], 'shelf:shows', ['thisYear', 'streak'], 'activity:2x1', 'shelf:fav-shows', 'shelf:movies', 'shelf:fav-movies', 'lists', 'extra'],
  },
  {
    id: 'cinema',
    banner: require('@/assets/templates/cinema.jpg'),
    primary: '#E11D48',
    secondary: '#F59E0B',
    layout: 'poster',
    persona: 'critic',
    blocks: ['banners', 'intro', 'counts', 'topRated:2x2', ['rated', 'finished'], 'emotions:2x1', 'shelf:fav-shows', 'shelf:fav-movies', 'stats', 'shelf:shows', 'shelf:movies', 'lists', 'extra'],
  },
  {
    id: 'noir',
    banner: require('@/assets/templates/noir.jpg'),
    primary: '#A1A1AA',
    secondary: '#E4E4E7',
    layout: 'classic',
    persona: 'curator',
    blocks: ['banners', 'intro', 'counts', 'lists', 'shelf:fav-shows', 'shelf:fav-movies', 'stats', 'shelf:shows', 'shelf:movies', 'extra'],
  },
  {
    id: 'gold',
    banner: require('@/assets/templates/gold.jpg'),
    primary: '#EAB308',
    secondary: '#F59E0B',
    layout: 'poster',
    persona: 'devotee',
    blocks: ['banners', 'intro', 'counts', 'shelf:fav-shows', ['binge', 'since'], 'topRated:2x1', 'stats', 'activity:2x1', 'shelf:shows', 'shelf:fav-movies', 'shelf:movies', 'lists', 'extra'],
  },
  {
    id: 'pastel',
    banner: require('@/assets/templates/pastel.jpg'),
    primary: '#C084FC',
    secondary: '#FDA4AF',
    layout: 'cards',
    persona: 'feeler',
    blocks: ['banners', 'intro', 'counts', 'emotions:2x1', 'emotionCalendar:2x2', ['rated', 'thisYear'], 'shelf:fav-shows', 'shelf:fav-movies', 'shelf:shows', 'shelf:movies', 'lists', 'extra'],
  },
  {
    id: 'retro',
    banner: require('@/assets/templates/retro.jpg'),
    primary: '#F59E0B',
    secondary: '#B45309',
    layout: 'classic',
    persona: 'newcomer',
    blocks: ['banners', 'intro', 'counts', 'nowWatching:2x1', 'shelf:shows', ['since', 'thisYear'], 'shelf:movies', 'activity:2x1', 'shelf:fav-shows', 'shelf:fav-movies', 'lists', 'extra'],
  },
];

/** The same four the profile tab draws (see `(tabs)/profile.tsx`). */
const SHELF_KEYS = ['shows', 'fav-shows', 'movies', 'fav-movies'];

/** The template's blocks as an arrangement, in order, each at its size. */
export function templateItems(tpl: Template): Placed[] {
  // `id:span` only when what follows the colon IS a size — a shelf's own id
  // (`shelf:shows`) has a colon in it too.
  const one = (ref: string): Placed => {
    const m = /^(.*):(1x1|2x1|2x2)$/.exec(ref);
    const id = m ? m[1]! : ref;
    return { uid: id, id, span: (m?.[2] as WidgetSpan | undefined) ?? specOf(id).span };
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

const TITLE_CACHE = 'templateTitlesCache';

/**
 * THE SMALL COPY of an artwork URL: TheTVDB serves one at `_t` (80 KB against
 * 550 KB for a backdrop) and TMDB at `w300`. Reading colours or drawing a
 * card from the full picture was most of the wait (8 Oct).
 */
export function smallArt(url: string): string {
  if (url.includes('image.tmdb.org')) return url.replace(/\/w\d+\//, '/w300/');
  if (url.includes('thetvdb.com')) return url.replace(/(_t)?\.(jpe?g|png)$/i, '_t.$2');
  return url;
}

/**
 * WHICH TITLES, NOT HOW FAR INTO THEM. The set of titles the templates are
 * made from, order ignored — a new favourite or a new film changes it, another
 * episode of a show already there does not.
 */
function titlesKey(titles: Title[]): string {
  // `v2`: templates gained a persona (8 Oct); saved ones from before have none.
  return 'v2|' + titles
    .map((x) => `${x.kind}:${x.tvdbId ?? x.tmdbId ?? x.name}`)
    .sort()
    .join('|');
}

/** The saved templates, if they were made from the titles there are now. */
export function cachedTitleTemplates(): Template[] | null {
  try {
    const c = JSON.parse(getMeta(TITLE_CACHE) ?? 'null') as { key: string; items: Template[] } | null;
    return c && c.key === titlesKey(templateTitles()) ? c.items : null;
  } catch {
    return null;
  }
}

/**
 * TEMPLATES FROM YOUR OWN SHOWS AND FILMS: each title's artwork as the banner,
 * its colours as the theme, and the layout and blocks of one of the ten made
 * templates in turn. A title with no artwork is left out.
 *
 * MADE ONCE AND KEPT (8 Oct): fetching artwork and reading its colours for ten
 * titles is seconds of spinner, so the result is saved and only made again
 * when the titles themselves change. No AI and nothing random: the artwork is
 * each title's best-rated backdrop, the colours are read from its pixels, and
 * the layout is the made template at the same position.
 */
export async function titleTemplates(onEach?: (soFar: Template[]) => void): Promise<Template[]> {
  const cached = cachedTitleTemplates();
  if (cached) return cached;
  const titles = templateTitles();
  // Each one reported as it lands, in library order — the first card does not
  // wait for the slowest server.
  const slots: (Template | null)[] = titles.map(() => null);
  const report = () => onEach?.(slots.filter((x): x is Template => x != null));
  await Promise.all(
    titles.map(async (title, i) => {
      const banner = await backdropFor(title);
      if (!banner) return;
      const base = TEMPLATES[i % TEMPLATES.length]!;
      const thumb = smallArt(banner);
      let pal = await paletteFromImage(thumb);
      if (!pal.read && thumb !== banner) pal = await paletteFromImage(banner);
      slots[i] = {
        id: `title-${i}`,
        banner,
        thumb,
        title: title.name,
        primary: pal.accent ?? base.primary,
        secondary: pal.secondary ?? pal.accent ?? base.secondary,
        layout: base.layout,
        persona: base.persona,
        blocks: base.blocks,
      };
      report();
    }),
  );
  const items = slots.filter((x): x is Template => x != null);
  // Only a complete answer is kept: offline, nothing comes back, and an empty
  // list saved now would stand until the library changed.
  if (items.length) setMeta(TITLE_CACHE, JSON.stringify({ key: titlesKey(titles), items }));
  return items;
}
