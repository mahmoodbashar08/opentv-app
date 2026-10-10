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
import { storedServerTemplates } from '@/links';
import {
  notifyLayoutSaved,
  publishableWidgets,
  serialise,
  SHELF_PREFIX,
  specOf,
  WIDGETS,
  type Placed,
  type WidgetSpan,
} from '@/profile-layout';
import { CENTRE_FRAME, coverFrameString, isSafeLinkUrl } from '@/pure';
import { applyPreset, SEASONS, type SeasonId } from '@/season';
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
  /** A seasonal template also puts on that season's look (decoration, ring, effect). */
  season?: SeasonId;
  /** A server template's chip on the picker: new, or the event it belongs to. */
  marker?: 'new' | SeasonId;
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
  | 'newcomer'
  | 'spooky'
  | 'festive';

/** The personas this build can name — what a server template is checked against. */
export const PERSONAS: readonly Persona[] = [
  'binger', 'filmBuff', 'explorer', 'nostalgic', 'completionist', 'critic',
  'curator', 'devotee', 'feeler', 'newcomer', 'spooky', 'festive',
];

export const TEMPLATES: readonly Template[] = [
  {
    id: 'halloween',
    banner: require('@/assets/templates/halloween.jpg'),
    primary: '#FF7A1A',
    secondary: '#8B5CF6',
    layout: 'cards',
    persona: 'spooky',
    season: 'halloween',
    blocks: ['banners', 'intro', 'counts', 'shelf:fav-shows', ['binge', 'streak'], 'nowWatching:2x1', 'stats', 'shelf:fav-movies', 'shelf:shows', 'shelf:movies', 'lists', 'extra'],
  },
  {
    id: 'holiday',
    banner: require('@/assets/templates/holiday.jpg'),
    primary: '#E11D48',
    secondary: '#16A34A',
    layout: 'poster',
    persona: 'festive',
    season: 'christmas',
    blocks: ['banners', 'intro', 'counts', 'shelf:fav-movies', ['thisYear', 'finished'], 'topRated:2x1', 'shelf:fav-shows', 'stats', 'shelf:movies', 'shelf:shows', 'lists', 'extra'],
  },
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

/** The last applied template's arrangement and name — see `applyTemplate`. */
export const TEMPLATE_LAYOUT = 'templateLayout';
export const TEMPLATE_NAME = 'templateName';

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
 * A banner into Documents, where every banner lives — bundled art or a URL —
 * returning its file name. Shared with the banner picker's OpenTV tab.
 */
export async function bannerToDocuments(banner: number | string): Promise<string> {
  const name = `profile-cover-${Date.now()}.jpg`;
  const dest = new File(Paths.document, name);
  if (typeof banner === 'string' && banner.startsWith('file:')) {
    // A server template's banner, already in Documents (see `serverTemplates`):
    // copied like a bundled one, so Use it works with no network.
    new File(banner).copy(dest);
  } else if (typeof banner === 'string') {
    const res = await fetch(banner);
    if (!res.ok) throw new Error('download failed');
    dest.write(new Uint8Array(await res.arrayBuffer()));
  } else {
    const asset = await Asset.fromModule(banner).downloadAsync();
    new File(asset.localUri ?? asset.uri).copy(dest);
  }
  return name;
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
  const name = await bannerToDocuments(tpl.banner);
  const old = getMeta('coverFile');
  if (old) {
    try {
      const f = new File(Paths.document, old);
      if (f.exists) f.delete();
    } catch {}
  }
  setMeta('coverFile', name);
  // A file in Documents has no address to publish — the cover goes up as an
  // upload, like a bundled banner's. Only a catalogue artwork keeps its URL.
  setMeta('coverUrl', typeof tpl.banner === 'string' && !tpl.banner.startsWith('file:') ? tpl.banner : '');
  setMeta('coverStillFile', '');
  // The banner melts into the page's gradient instead of ending on a line.
  setMeta(
    'coverFrame',
    coverFrameString({ ...CENTRE_FRAME, fade: true, strength: 0.8 }),
  );

  const items = templateItems(tpl);
  setProfileLayout(serialise(items, getProfileLayout()));
  // REMEMBERED, so the arranger's Reset can go back to THIS template rather
  // than to OpenTV's own order (9 Oct).
  setMeta(TEMPLATE_LAYOUT, JSON.stringify(items));
  setMeta(TEMPLATE_NAME, tpl.title ?? tpl.id);
  notifyLayoutSaved();
  await pushWidgets(JSON.stringify(publishableWidgets(items, (id, span, data) => widgetValue(id, span, data)))).catch(() => {});

  // A seasonal template wears the season too: its own look, at its first preset.
  const season = SEASONS.find((x) => x.id === tpl.season);
  if (season) applyPreset(season, season.presets[0]!);

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
  // `v3`: templates gained a persona, then seasonal ones joined the list (8 Oct).
  return 'v3|' + titles
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
      // Never a seasonal one: a show's template has the show's colours, not Halloween's.
      const plain = TEMPLATES.filter((x) => !x.season);
      const base = plain[i % plain.length]!;
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

// ── templates from the server ───────────────────────────────────────────────

/**
 * TEMPLATES THE DASHBOARD MAKES (2.0.0), on top of the twelve built in: a
 * banner on our server, two colours, a layout, a persona and the blocks —
 * optionally tied to an event, so a Ramadan or New Year template ships on the
 * day with no app update. They ride `/v1/links` and are stored by `links.ts`;
 * only a phone with an account ever asks, which is why the built-in twelve
 * are what there is without one.
 */

/** A template the server sent. `banner` is its address until `serverTemplates`
 *  has put the picture in Documents, then the file. */
export type ServerTemplate = Template & { banner: string; event: SeasonId | null };

const LAYOUTS: readonly ProfileLayout[] = ['classic', 'cards', 'poster'];
/** "New" on the card for this long after the dashboard made it. */
const NEW_FOR_MS = 30 * 86400000;
const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v);

/**
 * One block reference as the server sent it (`id` or `id:span`), checked
 * against what THIS build can draw: a widget the arranger knows that is
 * neither private nor one needing content of its own, at a size it allows; or
 * one of the four shelves, which are always large.
 */
function parseRef(ref: unknown): { id: string; span: WidgetSpan } | null {
  if (typeof ref !== 'string') return null;
  const m = /^(.*):(1x1|2x1|2x2)$/.exec(ref);
  const id = m ? m[1]! : ref;
  const span = (m?.[2] as WidgetSpan | undefined) ?? specOf(id).span;
  if (id.startsWith(SHELF_PREFIX)) {
    return SHELF_KEYS.includes(id.slice(SHELF_PREFIX.length)) && span === '2x2' ? { id, span } : null;
  }
  const spec = WIDGETS[id];
  if (!spec || spec.private || spec.needsData || !spec.spans.includes(span)) return null;
  return { id, span };
}

/** A block, or a pair — which is two squares, so a wide one in it breaks the row. */
function validBlock(b: unknown): b is Block {
  if (typeof b === 'string') return parseRef(b) != null;
  return Array.isArray(b) && b.length === 2 && b.every((x) => parseRef(x)?.span === '1x1');
}

/**
 * A server row onto the Template type, or null — never a half-made one. Every
 * field is checked against what this build knows, because the server's lists
 * are copies of ours and a newer dashboard may name a persona or a block an
 * older app has never heard of: that template is left out here and shows on
 * the phones that have updated. An event-tied one wears its event the way the
 * built-in Halloween template does, and carries it as the card's chip; the
 * rest say "new" for a month.
 */
export function parseServerTemplate(raw: unknown, nowMs = Date.now()): ServerTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const { id, name, banner, primary, secondary, layout, persona, blocks, event, created_at: createdAt } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  if (typeof name !== 'string' || !name.trim()) return null;
  if (typeof banner !== 'string' || !isSafeLinkUrl(banner)) return null;
  if (!isHex(primary) || !isHex(secondary)) return null;
  if (!LAYOUTS.includes(layout as ProfileLayout)) return null;
  if (!PERSONAS.includes(persona as Persona)) return null;
  if (!Array.isArray(blocks) || blocks[0] !== 'banners' || !blocks.every(validBlock)) return null;
  const season = SEASONS.find((s) => s.id === event)?.id ?? null;
  if (event != null && !season) return null;
  const fresh = typeof createdAt === 'string' && nowMs - Date.parse(createdAt) < NEW_FOR_MS;
  return {
    // Prefixed so it can never collide with a built-in id on the picker.
    id: `server-${id}`,
    title: name.trim(),
    banner,
    primary,
    secondary,
    layout: layout as ProfileLayout,
    persona: persona as Persona,
    blocks,
    season: season ?? undefined,
    event: season,
    marker: season ?? (fresh ? 'new' : undefined),
  };
}

/** The picture's extension, so a PNG is not kept under a JPEG's name. */
const bannerExt = (url: string): string => /\.(jpe?g|png|webp)$/i.exec(url)?.[1]?.toLowerCase() ?? 'jpg';

/**
 * THE SERVER'S TEMPLATES, WITH THEIR BANNERS HERE. Each banner is downloaded
 * once into Documents (`template-<id>.<ext>`) and read from there after: the
 * picker draws from the file, and Use it copies it like a bundled one, so a
 * template seen once works offline. One whose banner will not come is LEFT
 * OUT rather than drawn blank — a card with a hole where the picture should be
 * is the one thing this screen must never show; it reappears the next time
 * the download succeeds.
 *
 * ponytail: no sweep of the files of templates since deleted — a few hundred
 * KB per template the dashboard ever makes; add a Directory.list() sweep if
 * it ever matters.
 */
export async function serverTemplates(): Promise<ServerTemplate[]> {
  const rows = storedServerTemplates()
    .map((r) => parseServerTemplate(r))
    .filter((x): x is ServerTemplate => x != null);
  const kept = await Promise.all(
    rows.map(async (tpl): Promise<ServerTemplate | null> => {
      const file = new File(Paths.document, `template-${tpl.id}.${bannerExt(tpl.banner)}`);
      try {
        if (!file.exists) {
          const res = await fetch(tpl.banner);
          if (!res.ok) return null;
          file.write(new Uint8Array(await res.arrayBuffer()));
        }
        return { ...tpl, banner: file.uri };
      } catch {
        return null;
      }
    }),
  );
  return kept.filter((x): x is ServerTemplate => x != null);
}
