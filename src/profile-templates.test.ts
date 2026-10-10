jest.mock('expo-asset', () => ({ Asset: {} }));
jest.mock('@/community-appearance', () => ({}));
jest.mock('@/community-profiles', () => ({}));
jest.mock('@/components/profile-widgets', () => ({}));
jest.mock('@/components/profile-template', () => ({}));
jest.mock('@/cover-frame-live', () => ({}));
const meta: Record<string, string> = {};
let titles: { kind: 'show' | 'movie'; name: string; tvdbId: number | null; tmdbId: number | null }[] = [];
jest.mock('@/db', () => ({
  getMeta: (k: string) => meta[k] ?? null,
  setMeta: (k: string, v: string) => {
    meta[k] = v;
  },
  templateTitles: () => titles,
}));
jest.mock('@/theme', () => ({}));
jest.mock('@/theme-from-art', () => ({ paletteFromImage: async () => ({ accent: '#123456', secondary: null, read: true }) }));
jest.mock('@/tmdb', () => ({}));
const fetched: number[] = [];
jest.mock('@/tvdb', () => ({
  TVDB_ART_BACKGROUND: 3,
  tvdbArtworks: async (id: number) => {
    fetched.push(id);
    return [`https://art/${id}.jpg`];
  },
}));

import { WIDGETS, SHELF_PREFIX } from '@/profile-layout';
import { cachedTitleTemplates, parseServerTemplate, templateItems, TEMPLATES, titleTemplates } from '@/profile-templates';

describe('profile templates', () => {
  it('ten of them, every block a real widget at a size it allows, the shelves included once', () => {
    expect(TEMPLATES).toHaveLength(12);
    for (const tpl of TEMPLATES) {
      const items = templateItems(tpl);
      expect(new Set(items.map((i) => i.uid)).size).toBe(items.length);
      expect(items[0]!.id).toBe('banners');
      for (const it of items) {
        if (it.id.startsWith(SHELF_PREFIX)) continue;
        const spec = WIDGETS[it.id];
        expect(spec).toBeDefined();
        expect(spec!.spans).toContain(it.span);
        expect(spec!.private).toBeFalsy();
      }
      expect(items.filter((i) => i.id.startsWith(SHELF_PREFIX))).toHaveLength(4);
      // Squares come in side-by-side pairs, so no row is left half empty.
      let run = 0;
      for (const it of [...items, { span: '2x1' }]) {
        if (it.span === '1x1') run++;
        else {
          expect(run % 2).toBe(0);
          run = 0;
        }
      }
      // A persona leads: the block after the identity rows is never a square.
      expect(items[3]!.span).not.toBe('1x1');
    }
  });
});

describe('templates from your titles', () => {
  it('are made once, and again only when the titles change — not their order', async () => {
    titles = [
      { kind: 'show', name: 'A', tvdbId: 1, tmdbId: null },
      { kind: 'show', name: 'B', tvdbId: 2, tmdbId: null },
    ];
    expect((await titleTemplates()).map((x) => x.title)).toEqual(['A', 'B']);
    expect(fetched).toEqual([1, 2]);
    // More episodes of B lift it above A: same titles, nothing fetched.
    titles = [titles[1]!, titles[0]!];
    expect(cachedTitleTemplates()).not.toBeNull();
    await titleTemplates();
    expect(fetched).toEqual([1, 2]);
    // A new show in the top: made again.
    titles = [...titles, { kind: 'show', name: 'C', tvdbId: 3, tmdbId: null }];
    expect(cachedTitleTemplates()).toBeNull();
    expect(await titleTemplates()).toHaveLength(3);
  });
});

describe('smallArt', () => {
  it('asks each server for its small copy', () => {
    const { smallArt } = jest.requireActual<typeof import('@/profile-templates')>('@/profile-templates');
    expect(smallArt('https://artworks.thetvdb.com/banners/fanart/original/121361-19.jpg')).toBe(
      'https://artworks.thetvdb.com/banners/fanart/original/121361-19_t.jpg',
    );
    expect(smallArt('https://artworks.thetvdb.com/x/y_t.jpg')).toBe('https://artworks.thetvdb.com/x/y_t.jpg');
    expect(smallArt('https://image.tmdb.org/t/p/w1280/abc.jpg')).toBe('https://image.tmdb.org/t/p/w300/abc.jpg');
  });
});

/**
 * Templates from the server (2.0.0). The rule under test: a row is shown whole
 * or not at all — every field checked against what this build can draw, so a
 * newer dashboard can never put a block on a page this app cannot render.
 */
describe('templates from the server', () => {
  const row = {
    id: 'abc-1',
    name: 'Ramadan Nights',
    banner: 'https://api.example.com/v1/templates/abc-1.jpg',
    primary: '#D4A537',
    secondary: '#0F766E',
    layout: 'cards',
    persona: 'devotee',
    blocks: ['banners', 'intro', 'counts', 'shelf:fav-shows', ['binge', 'streak'], 'nowWatching:2x1', 'stats', 'lists'],
    event: null as string | null,
    created_at: '2026-10-01T00:00:00.000Z',
  };
  const now = Date.parse('2026-10-10T00:00:00.000Z');

  it('maps a row onto a template the arranger can place, marked new for a month', () => {
    const tpl = parseServerTemplate(row, now)!;
    expect(tpl).toMatchObject({ id: 'server-abc-1', title: 'Ramadan Nights', primary: '#D4A537', layout: 'cards', persona: 'devotee', marker: 'new', event: null });
    expect(tpl.season).toBeUndefined();
    const items = templateItems(tpl);
    expect(items[0]!.id).toBe('banners');
    expect(items.find((i) => i.id === 'nowWatching')!.span).toBe('2x1');
    expect(items.filter((i) => i.span === '1x1').map((i) => i.id)).toEqual(['binge', 'streak']);
    // A month on, the chip goes; the template stays.
    expect(parseServerTemplate({ ...row, created_at: '2026-08-01T00:00:00.000Z' }, now)!.marker).toBeUndefined();
  });

  it('an event-tied one wears its event, the way the built-in Halloween one does, and says so on the card', () => {
    const tpl = parseServerTemplate({ ...row, event: 'ramadan' }, now)!;
    expect(tpl.season).toBe('ramadan');
    expect(tpl.event).toBe('ramadan');
    expect(tpl.marker).toBe('ramadan');
    expect(parseServerTemplate({ ...row, event: 'easter' }, now)).toBeNull();
  });

  it('is left out whole when any part is something this build cannot draw', () => {
    const bad: Partial<typeof row>[] = [
      { banner: 'http://insecure.example.com/x.jpg' },
      { banner: 'javascript:alert(1)' },
      { primary: 'gold' },
      { secondary: '#12345' },
      { layout: 'grid' },
      { persona: 'hero' },
      { blocks: ['banners', 'photos'] },
      { blocks: ['banners', 'stats:1x1'] },
      // Private widgets, and the ones that need content of their own.
      { blocks: ['banners', 'watchlist'] },
      { blocks: ['banners', 'gif'] },
      { blocks: ['banners', 'shelf:fav-films'] },
      // A pair is two squares; a wide block in one breaks the row.
      { blocks: ['banners', ['stats', 'since']] },
      { blocks: ['intro', 'banners'] },
      { blocks: [] },
      { id: '../x' },
      { name: '  ' },
    ];
    for (const over of bad) expect(parseServerTemplate({ ...row, ...over }, now)).toBeNull();
    expect(parseServerTemplate(null, now)).toBeNull();
    expect(parseServerTemplate('x', now)).toBeNull();
  });
});
