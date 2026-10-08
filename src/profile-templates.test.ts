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
import { cachedTitleTemplates, templateItems, TEMPLATES, titleTemplates } from '@/profile-templates';

describe('profile templates', () => {
  it('ten of them, every block a real widget at a size it allows, the shelves included once', () => {
    expect(TEMPLATES).toHaveLength(10);
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
      // Squares come in pairs, so no row is left half empty.
      expect(items.filter((i) => i.span === '1x1').length % 2).toBe(0);
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
